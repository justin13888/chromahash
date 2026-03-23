import Foundation

/// Encode aspect ratio as a single byte. Per spec §8.1 (v0.3).
func encodeAspect(w: Int, h: Int) -> UInt8 {
  let ratio = Double(w) / Double(h)
  let raw = (log2(ratio) + 4.0) / 8.0 * 255.0
  let byte = Int64(roundHalfAwayFromZero(raw))
  return UInt8(min(max(byte, 0), 255))
}

/// Decode aspect ratio from byte. Per spec §8.1 (v0.3).
func decodeAspect(byte: UInt8) -> Double {
  return pow(2.0, Double(byte) / 255.0 * 8.0 - 4.0)
}

/// Decode output size from aspect byte. Longer side = 32px. Per spec.
func decodeOutputSize(byte: UInt8) -> (width: Int, height: Int) {
  let ratio = decodeAspect(byte: byte)
  if ratio > 1.0 {
    let h = max(Int(roundHalfAwayFromZero(32.0 / ratio)), 1)
    return (32, h)
  } else {
    let w = max(Int(roundHalfAwayFromZero(32.0 * ratio)), 1)
    return (w, 32)
  }
}

/// Derive adaptive DCT grid (nx, ny) from aspect byte and baseN. Per spec §3.2.
func deriveGrid(_ aspectByte: Int, _ baseN: Int) -> (Int, Int) {
  let ratio = portablePow(2.0, Double(aspectByte) / 255.0 * 8.0 - 4.0)
  let base = Double(baseN)
  var nx: Int
  var ny: Int
  if ratio >= 1.0 {
    let scale = min(ratio, 16.0)
    let s = portablePow(scale, 0.25)
    nx = Int(roundHalfAwayFromZero(base * s))
    ny = Int(roundHalfAwayFromZero(base / s))
  } else {
    let scale = min(1.0 / ratio, 16.0)
    let s = portablePow(scale, 0.25)
    nx = Int(roundHalfAwayFromZero(base / s))
    ny = Int(roundHalfAwayFromZero(base * s))
  }
  return (max(nx, 3), max(ny, 3))
}
