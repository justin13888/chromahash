/// Compute the triangular scan order for an nx*ny grid, excluding DC.
/// Per spec: row-major, condition cx*ny < nx*(ny-cy), skip (0,0).
func triangularScanOrder(nx: Int, ny: Int) -> [(Int, Int)] {
  var order: [(Int, Int)] = []
  for cy in 0..<ny {
    let cxStart = cy == 0 ? 1 : 0
    var cx = cxStart
    while cx * ny < nx * (ny - cy) {
      order.append((cx, cy))
      cx += 1
    }
  }
  return order
}

/// Forward DCT encode for a channel. Per spec dctEncode.
/// Returns (dc, acCoefficients, scale).
func dctEncode(
  channel: [Double], w: Int, h: Int, nx: Int, ny: Int
) -> (dc: Double, ac: [Double], scale: Double) {
  let wh = Double(w * h)
  var dc = 0.0
  var ac: [Double] = []
  var scale = 0.0

  for cy in 0..<ny {
    var cx = 0
    while cx * ny < nx * (ny - cy) {
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
      if cx > 0 || cy > 0 {
        ac.append(f)
        scale = max(scale, abs(f))
      } else {
        dc = f
      }
      cx += 1
    }
  }

  // Floor near-zero scale to exactly zero for cross-platform consistency
  if scale < 1e-10 {
    for i in ac.indices {
      ac[i] = 0.0
    }
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
