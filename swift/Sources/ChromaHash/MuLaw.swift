import Foundation

/// mu-law compress: value in [-1, 1] -> compressed in [-1, 1].
func muCompress(_ value: Double) -> Double {
  let v = min(max(value, -1.0), 1.0)
  let sign: Double = v >= 0.0 ? 1.0 : -1.0
  return sign * log(1.0 + mu * abs(v)) / log(1.0 + mu)
}

/// mu-law expand: compressed in [-1, 1] -> value in [-1, 1].
func muExpand(_ compressed: Double) -> Double {
  let sign: Double = compressed >= 0.0 ? 1.0 : -1.0
  return sign * (pow(1.0 + mu, abs(compressed)) - 1.0) / mu
}

/// Quantize a value in [-1, 1] using mu-law to an integer index.
func muLawQuantize(_ value: Double, bits: UInt32) -> UInt32 {
  let compressed = muCompress(value)
  let maxVal = (1 << bits) - 1
  let index = roundHalfAwayFromZero((compressed + 1.0) / 2.0 * Double(maxVal))
  return UInt32(min(max(Int64(index), 0), Int64(maxVal)))
}

/// Dequantize an integer index back to a value in [-1, 1] using mu-law.
func muLawDequantize(_ index: UInt32, bits: UInt32) -> Double {
  let maxVal = (1 << bits) - 1
  let compressed = Double(index) / Double(maxVal) * 2.0 - 1.0
  return muExpand(compressed)
}
