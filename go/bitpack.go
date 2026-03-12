package chromahash

// writeBits writes count bits of value starting at bitpos in little-endian byte order.
// Per spec §12.7 writeBits.
func writeBits(hash []byte, bitpos, count, value int) {
	for i := 0; i < count; i++ {
		byteIdx := (bitpos + i) / 8
		bitIdx := (bitpos + i) % 8
		if (value>>i)&1 != 0 {
			hash[byteIdx] |= 1 << bitIdx
		}
	}
}

// readBits reads count bits starting at bitpos in little-endian byte order.
// Per spec §12.7 readBits.
func readBits(hash []byte, bitpos, count int) int {
	value := 0
	for i := 0; i < count; i++ {
		byteIdx := (bitpos + i) / 8
		bitIdx := (bitpos + i) % 8
		if hash[byteIdx]&(1<<bitIdx) != 0 {
			value |= 1 << i
		}
	}
	return value
}
