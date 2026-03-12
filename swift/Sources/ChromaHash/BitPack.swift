import Foundation

/// Write `count` bits of `value` starting at `bitpos` in little-endian byte order.
func writeBits(_ hash: inout [UInt8], bitpos: Int, count: UInt32, value: UInt32) {
  for i in 0..<Int(count) {
    let byteIdx = (bitpos + i) / 8
    let bitIdx = (bitpos + i) % 8
    if (value >> i) & 1 != 0 {
      hash[byteIdx] |= 1 << bitIdx
    }
  }
}

/// Read `count` bits starting at `bitpos` in little-endian byte order.
func readBits(_ hash: [UInt8], bitpos: Int, count: UInt32) -> UInt32 {
  var value: UInt32 = 0
  for i in 0..<Int(count) {
    let byteIdx = (bitpos + i) / 8
    let bitIdx = (bitpos + i) % 8
    if hash[byteIdx] & (1 << bitIdx) != 0 {
      value |= 1 << i
    }
  }
  return value
}
