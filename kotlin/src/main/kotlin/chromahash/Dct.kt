package chromahash

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max

/**
 * Compute the AC coefficient scan order for an nx×ny grid keyed on aspectByte.
 * Per spec §6.2 (v0.4): coefficients sorted ascending by per-pixel frequency priority
 * `(cx*h)^2 + (cy*w)^2` where (w,h) = decodeOutputSize(aspectByte).
 * Ties broken by (cx, cy). Excludes DC at (0,0).
 */
internal fun scanOrder(
    nx: Int,
    ny: Int,
    aspectByte: Int,
): List<Pair<Int, Int>> {
    val (w, h) = decodeOutputSize(aspectByte)

    data class Entry(val priority: Long, val cx: Int, val cy: Int)
    val entries = mutableListOf<Entry>()
    for (cy in 0 until ny) {
        val cxStart = if (cy == 0) 1 else 0
        var cx = cxStart
        while (cx * ny < nx * (ny - cy)) {
            val a = cx.toLong() * h.toLong()
            val b = cy.toLong() * w.toLong()
            entries.add(Entry(a * a + b * b, cx, cy))
            cx++
        }
    }
    entries.sortWith(
        compareBy<Entry> { it.priority }.thenBy { it.cx }.thenBy { it.cy },
    )
    return entries.map { Pair(it.cx, it.cy) }
}

/**
 * Forward DCT encode for a channel. Per spec §12.6 dctEncode (v0.4).
 * AC values are emitted in `scan` order.
 * Returns Triple(dc, acCoefficients, scale).
 */
internal fun dctEncode(
    channel: DoubleArray,
    w: Int,
    h: Int,
    scan: List<Pair<Int, Int>>,
): Triple<Double, DoubleArray, Double> {
    val wh = (w * h).toDouble()

    // DC = mean (cos(0)=1 everywhere)
    var sum = 0.0
    for (v in channel) sum += v
    val dc = sum / wh

    val acList = DoubleArray(scan.size)
    var scale = 0.0

    for ((idx, pair) in scan.withIndex()) {
        val (cx, cy) = pair
        var f = 0.0
        for (y in 0 until h) {
            val fy = portableCos(PI / h.toDouble() * cy.toDouble() * (y.toDouble() + 0.5))
            for (x in 0 until w) {
                f +=
                    channel[x + y * w] *
                    portableCos(PI / w.toDouble() * cx.toDouble() * (x.toDouble() + 0.5)) *
                    fy
            }
        }
        f /= wh
        acList[idx] = f
        scale = max(scale, abs(f))
    }

    // Floor near-zero scale to exactly zero. When the channel is (near-)constant,
    // floating-point noise in cosine sums produces tiny AC values. Without this
    // threshold, dividing AC/scale amplifies platform-specific ULP differences
    // (e.g. different cbrt implementations) into divergent quantized codes.
    if (scale < 1e-10) {
        for (i in acList.indices) acList[i] = 0.0
        scale = 0.0
    }

    return Triple(dc, acList, scale)
}

/** Inverse DCT at a single pixel (x, y) for a channel. */
internal fun dctDecodePixel(
    dc: Double,
    ac: DoubleArray,
    scanOrder: List<Pair<Int, Int>>,
    x: Int,
    y: Int,
    w: Int,
    h: Int,
): Double {
    var value = dc
    for ((j, pair) in scanOrder.withIndex()) {
        val (cx, cy) = pair
        val cxFactor = if (cx > 0) 2.0 else 1.0
        val cyFactor = if (cy > 0) 2.0 else 1.0
        val fx = portableCos(PI / w.toDouble() * cx.toDouble() * (x.toDouble() + 0.5))
        val fy = portableCos(PI / h.toDouble() * cy.toDouble() * (y.toDouble() + 0.5))
        value += ac[j] * fx * fy * cxFactor * cyFactor
    }
    return value
}
