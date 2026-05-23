package chromahash

import kotlin.math.log2
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt

/** Encode aspect ratio as a single byte. Per spec §8.1. */
internal fun encodeAspect(
    w: Int,
    h: Int,
): Int {
    val ratio = w.toDouble() / h.toDouble()
    val raw = (log2(ratio) + 4.0) / 8.0 * 255.0
    val byte = roundHalfAwayFromZero(raw).toLong()
    return byte.coerceIn(0L, 255L).toInt()
}

/** Decode aspect ratio from byte. Per spec §8.1. */
internal fun decodeAspect(byte: Int): Double = 2.0.pow(byte.toDouble() / 255.0 * 8.0 - 4.0)

/** Decode output size from aspect byte. Longer side = 32px. Per spec §8.2. */
internal fun decodeOutputSize(byte: Int): Pair<Int, Int> {
    val ratio = decodeAspect(byte)
    return if (ratio > 1.0) {
        val h = max(roundHalfAwayFromZero(32.0 / ratio).toInt(), 1)
        Pair(32, h)
    } else {
        val w = max(roundHalfAwayFromZero(32.0 * ratio).toInt(), 1)
        Pair(w, 32)
    }
}

/** Derive adaptive DCT grid (nx, ny) from aspect byte and baseN. Per spec §6.3 (v0.4).
 *  Uses sqrt(scale) with nx_cap = 2*base_n and product preservation
 *  (ny = round(base_n^2 / nx)). sqrt is IEEE 754 correctly-rounded.
 */
internal fun deriveGrid(
    aspectByte: Int,
    baseN: Int,
): Pair<Int, Int> {
    val ratio = portablePow(2.0, aspectByte.toDouble() / 255.0 * 8.0 - 4.0)
    val base = baseN.toDouble()
    val nxCap = (2 * baseN).toLong()
    val (nx, ny) =
        if (ratio >= 1.0) {
            val scale = minOf(ratio, 16.0)
            val nxL = roundHalfAwayFromZero(base * sqrt(scale)).toLong().coerceAtMost(nxCap)
            val nyL = roundHalfAwayFromZero(base * base / nxL.toDouble()).toLong()
            Pair(nxL.coerceAtLeast(3L).toInt(), nyL.coerceAtLeast(3L).toInt())
        } else {
            val scale = minOf(1.0 / ratio, 16.0)
            val nyL = roundHalfAwayFromZero(base * sqrt(scale)).toLong().coerceAtMost(nxCap)
            val nxL = roundHalfAwayFromZero(base * base / nyL.toDouble()).toLong()
            Pair(nxL.coerceAtLeast(3L).toInt(), nyL.coerceAtLeast(3L).toInt())
        }
    return nx to ny
}
