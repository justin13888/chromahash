package chromahash

import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.pow
import kotlin.math.sign

/** mu-law compress: value in [-1, 1] -> compressed in [-1, 1]. */
internal fun muCompress(value: Double): Double {
    val v = value.coerceIn(-1.0, 1.0)
    return sign(v) * ln(1.0 + MU * abs(v)) / ln(1.0 + MU)
}

/** mu-law expand: compressed in [-1, 1] -> value in [-1, 1]. */
internal fun muExpand(compressed: Double): Double = sign(compressed) * ((1.0 + MU).pow(abs(compressed)) - 1.0) / MU

/** Quantize a value in [-1, 1] using mu-law to an integer index. */
internal fun muLawQuantize(
    value: Double,
    bits: Int,
): Int {
    val compressed = muCompress(value)
    val maxVal = (1 shl bits) - 1
    val index = roundHalfAwayFromZero((compressed + 1.0) / 2.0 * maxVal.toDouble())
    return index.toLong().coerceIn(0L, maxVal.toLong()).toInt()
}

/** Dequantize an integer index back to a value in [-1, 1] using mu-law. */
internal fun muLawDequantize(
    index: Int,
    bits: Int,
): Double {
    val maxVal = (1 shl bits) - 1
    val compressed = index.toDouble() / maxVal.toDouble() * 2.0 - 1.0
    return muExpand(compressed)
}
