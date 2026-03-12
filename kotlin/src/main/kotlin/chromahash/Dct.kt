package chromahash

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max

/**
 * Compute the triangular scan order for an nx*ny grid, excluding DC.
 * Per spec: row-major, condition cx*ny < nx*(ny-cy), skip (0,0).
 */
internal fun triangularScanOrder(
    nx: Int,
    ny: Int,
): List<Pair<Int, Int>> {
    val order = mutableListOf<Pair<Int, Int>>()
    for (cy in 0 until ny) {
        val cxStart = if (cy == 0) 1 else 0
        var cx = cxStart
        while (cx * ny < nx * (ny - cy)) {
            order.add(Pair(cx, cy))
            cx++
        }
    }
    return order
}

/**
 * Forward DCT encode for a channel. Per spec dctEncode.
 * Returns Triple(dc, acCoefficients, scale).
 */
internal fun dctEncode(
    channel: DoubleArray,
    w: Int,
    h: Int,
    nx: Int,
    ny: Int,
): Triple<Double, DoubleArray, Double> {
    val wh = (w * h).toDouble()
    var dc = 0.0
    val acList = mutableListOf<Double>()
    var scale = 0.0

    for (cy in 0 until ny) {
        var cx = 0
        while (cx * ny < nx * (ny - cy)) {
            var f = 0.0
            for (y in 0 until h) {
                val fy = cos(PI / h.toDouble() * cy.toDouble() * (y.toDouble() + 0.5))
                for (x in 0 until w) {
                    f +=
                        channel[x + y * w] *
                        cos(PI / w.toDouble() * cx.toDouble() * (x.toDouble() + 0.5)) *
                        fy
                }
            }
            f /= wh
            if (cx > 0 || cy > 0) {
                acList.add(f)
                scale = max(scale, abs(f))
            } else {
                dc = f
            }
            cx++
        }
    }

    // Floor near-zero scale to exactly zero. When the channel is (near-)constant,
    // floating-point noise in cosine sums produces tiny AC values. Without this
    // threshold, dividing AC/scale amplifies platform-specific ULP differences
    // (e.g. different cbrt implementations) into divergent quantized codes.
    if (scale < 1e-10) {
        acList.replaceAll { 0.0 }
        scale = 0.0
    }

    return Triple(dc, acList.toDoubleArray(), scale)
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
        val fx = cos(PI / w.toDouble() * cx.toDouble() * (x.toDouble() + 0.5))
        val fy = cos(PI / h.toDouble() * cy.toDouble() * (y.toDouble() + 0.5))
        value += ac[j] * fx * fy * cxFactor * cyFactor
    }
    return value
}
