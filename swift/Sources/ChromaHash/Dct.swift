import Foundation

/// Compute the AC coefficient scan order for an nx×ny grid keyed on aspectByte.
/// Per spec §6.2 (v0.4): coefficients sorted ascending by per-pixel frequency priority
/// `(cx*h)^2 + (cy*w)^2` where (w,h) = decodeOutputSize(aspectByte).
/// Ties broken by (cx, cy). Excludes DC at (0,0).
func scanOrder(nx: Int, ny: Int, aspectByte: UInt8) -> [(Int, Int)] {
  let (w, h) = decodeOutputSize(byte: aspectByte)
  struct Entry {
    let priority: UInt64
    let cx: Int
    let cy: Int
  }
  var entries: [Entry] = []
  for cy in 0..<ny {
    let cxStart = cy == 0 ? 1 : 0
    var cx = cxStart
    while cx * ny < nx * (ny - cy) {
      let a = UInt64(cx) * UInt64(h)
      let b = UInt64(cy) * UInt64(w)
      entries.append(Entry(priority: a * a + b * b, cx: cx, cy: cy))
      cx += 1
    }
  }
  entries.sort { lhs, rhs in
    if lhs.priority != rhs.priority { return lhs.priority < rhs.priority }
    if lhs.cx != rhs.cx { return lhs.cx < rhs.cx }
    return lhs.cy < rhs.cy
  }
  return entries.map { ($0.cx, $0.cy) }
}

/// Forward DCT encode for a channel. Per spec §12.6 dctEncode (v0.4).
/// AC values are emitted in `scan` order. Returns (dc, acCoefficients, scale).
func dctEncode(
  channel: [Double], w: Int, h: Int, scan: [(Int, Int)]
) -> (dc: Double, ac: [Double], scale: Double) {
  let wh = Double(w * h)

  // DC = mean (cos(0)=1 everywhere)
  var sum = 0.0
  for v in channel { sum += v }
  let dc = sum / wh

  var ac: [Double] = []
  ac.reserveCapacity(scan.count)
  var scale = 0.0
  for (cx, cy) in scan {
    var f = 0.0
    for y in 0..<h {
      let fy = portableCos(Double.pi / Double(h) * Double(cy) * (Double(y) + 0.5))
      for x in 0..<w {
        f +=
          channel[x + y * w]
          * portableCos(Double.pi / Double(w) * Double(cx) * (Double(x) + 0.5))
          * fy
      }
    }
    f /= wh
    ac.append(f)
    if abs(f) > scale { scale = abs(f) }
  }

  // Floor near-zero scale to exactly zero for cross-platform consistency
  if scale < 1e-10 {
    for i in ac.indices { ac[i] = 0.0 }
    scale = 0.0
  }

  return (dc, ac, scale)
}

/// Inverse DCT at a single pixel (x, y) for a channel.
func dctDecodePixel(
  dc: Double, ac: [Double], scanOrder: [(Int, Int)],
  x: Int, y: Int, w: Int, h: Int
) -> Double {
  var value = dc
  for (j, pair) in scanOrder.enumerated() {
    let (cx, cy) = pair
    let cxFactor: Double = cx > 0 ? 2.0 : 1.0
    let cyFactor: Double = cy > 0 ? 2.0 : 1.0
    let fx = portableCos(Double.pi / Double(w) * Double(cx) * (Double(x) + 0.5))
    let fy = portableCos(Double.pi / Double(h) * Double(cy) * (Double(y) + 0.5))
    value += ac[j] * fx * fy * cxFactor * cyFactor
  }
  return value
}
