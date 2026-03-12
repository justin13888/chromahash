package chromahash

/**
 * Result of decoding a ChromaHash.
 * @param width  decoded image width in pixels
 * @param height decoded image height in pixels
 * @param rgba   decoded RGBA pixel data (4 bytes per pixel, row-major)
 */
data class DecodeResult(
    val width: Int,
    val height: Int,
    val rgba: ByteArray,
) {
    // ByteArray doesn't have structural equality — must override manually
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is DecodeResult) return false
        return width == other.width && height == other.height && rgba.contentEquals(other.rgba)
    }

    override fun hashCode(): Int {
        var result = width
        result = 31 * result + height
        result = 31 * result + rgba.contentHashCode()
        return result
    }
}
