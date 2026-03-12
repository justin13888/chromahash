package chromahash

/** Write [count] bits of [value] starting at [bitpos] in little-endian byte order. */
internal fun writeBits(
    hash: ByteArray,
    bitpos: Int,
    count: Int,
    value: Int,
) {
    for (i in 0 until count) {
        val byteIdx = (bitpos + i) / 8
        val bitIdx = (bitpos + i) % 8
        if ((value ushr i) and 1 != 0) {
            hash[byteIdx] = (hash[byteIdx].toInt() or (1 shl bitIdx)).toByte()
        }
    }
}

/** Read [count] bits starting at [bitpos] in little-endian byte order. */
internal fun readBits(
    hash: ByteArray,
    bitpos: Int,
    count: Int,
): Int {
    var value = 0
    for (i in 0 until count) {
        val byteIdx = (bitpos + i) / 8
        val bitIdx = (bitpos + i) % 8
        if ((hash[byteIdx].toInt() and 0xFF) and (1 shl bitIdx) != 0) {
            value = value or (1 shl i)
        }
    }
    return value
}
