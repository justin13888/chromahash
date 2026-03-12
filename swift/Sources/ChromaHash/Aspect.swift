import Foundation

/// Encode aspect ratio as a single byte. Per spec.
func encodeAspect(w: Int, h: Int) -> UInt8 {
  let ratio = Double(w) / Double(h)
  let raw = (log2(ratio) + 2.0) / 4.0 * 255.0
  let byte = Int64(roundHalfAwayFromZero(raw))
  return UInt8(min(max(byte, 0), 255))
}

/// Decode aspect ratio from byte. Per spec.
func decodeAspect(byte: UInt8) -> Double {
  return pow(2.0, Double(byte) / 255.0 * 4.0 - 2.0)
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
