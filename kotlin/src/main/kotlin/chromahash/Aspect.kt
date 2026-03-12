package chromahash

import kotlin.math.log2
import kotlin.math.max
import kotlin.math.pow

/** Encode aspect ratio as a single byte. Per spec. */
fun encodeAspect(
    w: Int,
    h: Int,
): Int {
    val ratio = w.toDouble() / h.toDouble()
    val raw = (log2(ratio) + 2.0) / 4.0 * 255.0
    val byte = roundHalfAwayFromZero(raw).toLong()
    return byte.coerceIn(0L, 255L).toInt()
}

/** Decode aspect ratio from byte. Per spec. */
fun decodeAspect(byte: Int): Double = 2.0.pow(byte.toDouble() / 255.0 * 4.0 - 2.0)

/** Decode output size from aspect byte. Longer side = 32px. Per spec. */
fun decodeOutputSize(byte: Int): Pair<Int, Int> {
    val ratio = decodeAspect(byte)
    return if (ratio > 1.0) {
        val h = max(roundHalfAwayFromZero(32.0 / ratio).toInt(), 1)
        Pair(32, h)
    } else {
        val w = max(roundHalfAwayFromZero(32.0 * ratio).toInt(), 1)
        Pair(w, 32)
    }
}
