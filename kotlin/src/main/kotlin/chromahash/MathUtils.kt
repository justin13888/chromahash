package chromahash

import kotlin.math.ceil
import kotlin.math.floor

/**
 * Round half away from zero (NOT Kotlin's default banker's rounding).
 * Per spec: round(x) = floor(x + 0.5) for x >= 0, ceil(x - 0.5) for x < 0.
 * Adding 0.0 eliminates negative zero from IEEE 754.
 */
internal fun roundHalfAwayFromZero(x: Double): Double =
    if (x >= 0.0) {
        floor(x + 0.5)
    } else {
        ceil(x - 0.5) + 0.0
    }

/**
 * Portable natural logarithm using only basic IEEE 754 arithmetic.
 * Range-reduces to [1, 2) then uses the series ln(m) = 2 * sum(u^(2k+1)/(2k+1))
 * where u = (m-1)/(m+1).
 */
internal fun portableLn(x: Double): Double {
    val ln2 = 0.6931471805599453

    if (x <= 0.0) return Double.NEGATIVE_INFINITY
    if (x == 1.0) return 0.0

    // Range reduce to m in [1, 2)
    var m = x
    var e = 0
    while (m >= 2.0) {
        m /= 2.0
        e += 1
    }
    while (m < 1.0) {
        m *= 2.0
        e -= 1
    }

    // Series: ln(m) = 2*(u + u^3/3 + u^5/5 + ...) where u = (m-1)/(m+1)
    val u = (m - 1.0) / (m + 1.0)
    val u2 = u * u
    var term = u
    var sum = u
    var k = 1
    while (k <= 20) {
        term *= u2
        sum += term / (2 * k + 1).toDouble()
        k += 1
    }

    return 2.0 * sum + e.toDouble() * ln2
}

/**
 * Portable exponential using only basic IEEE 754 arithmetic.
 * Range-reduces via exp(x) = 2^k * exp(r) where r in [-ln2/2, ln2/2],
 * then uses a degree-25 Taylor polynomial for exp(r).
 */
internal fun portableExp(x: Double): Double {
    val ln2 = 0.6931471805599453

    if (x == 0.0) return 1.0

    // Range reduction: k = round(x / ln2), r = x - k*ln2
    val k = floor(x / ln2 + 0.5).toInt()
    val r = x - k.toDouble() * ln2

    // Taylor polynomial for exp(r), |r| < 0.347
    var term = 1.0
    var sum = 1.0
    var i = 1
    while (i <= 25) {
        term *= r / i.toDouble()
        sum += term
        i += 1
    }

    // Multiply by 2^k
    var result = sum
    if (k >= 0) {
        var j = 0
        while (j < k) {
            result *= 2.0
            j += 1
        }
    } else {
        var j = 0
        while (j < -k) {
            result /= 2.0
            j += 1
        }
    }

    return result
}

/**
 * Portable power function: base^exponent using only basic IEEE 754 arithmetic.
 * Computes exp(exponent * ln(base)).
 */
internal fun portablePow(
    base: Double,
    exponent: Double,
): Double {
    if (base == 0.0) return 0.0
    if (exponent == 0.0) return 1.0
    if (base == 1.0) return 1.0
    return portableExp(exponent * portableLn(base))
}

/**
 * Cube root via Halley's method with biased-exponent seed.
 * Matches Rust cbrt_halley for cross-language bit-exact determinism.
 */
internal fun cbrtHalley(x: Double): Double {
    if (x == 0.0) return 0.0
    val sign = x < 0.0
    val ax = if (sign) -x else x

    // Seed via signed int64 biased-exponent division
    val signedBits = java.lang.Double.doubleToRawLongBits(ax)
    val bias = 1023L shl 52
    val seedBits = (signedBits - bias) / 3L + bias
    var y = java.lang.Double.longBitsToDouble(seedBits)

    // 3 Halley iterations
    repeat(3) {
        val t1 = y * y
        val y3 = t1 * y
        val t2 = 2.0 * ax
        val num = y3 + t2
        val t3 = 2.0 * y3
        val den = t3 + ax
        val t4 = y * num
        y = t4 / den
    }

    return if (sign) -y else y
}

/**
 * Portable cosine using only basic IEEE 754 arithmetic (+, -, *, /).
 * Produces bit-identical results across all platforms.
 */
internal fun portableCos(x: Double): Double {
    val pi = 3.141592653589793
    val twoPi = 6.283185307179586
    val halfPi = 1.5707963267948966

    var t = if (x < 0.0) -x else x

    if (t >= twoPi) {
        t -= floor(t / twoPi) * twoPi
    }

    if (t > pi) {
        t = twoPi - t
    }

    val negate = t > halfPi
    if (negate) {
        t = pi - t
    }

    val x2 = t * t
    val r =
        1.0 +
            x2 *
            (
                -1.0 / 2.0 +
                    x2 *
                    (
                        1.0 / 24.0 +
                            x2 *
                            (
                                -1.0 / 720.0 +
                                    x2 *
                                    (
                                        1.0 / 40320.0 +
                                            x2 *
                                            (
                                                -1.0 / 3628800.0 +
                                                    x2 *
                                                    (
                                                        1.0 / 479001600.0 +
                                                            x2 *
                                                            (
                                                                -1.0 / 87178291200.0 +
                                                                    x2 * (1.0 / 20922789888000.0)
                                                            )
                                                    )
                                            )
                                    )
                            )
                    )
            )

    return if (negate) -r else r
}

/** Clamp to [0, 1]. */
internal fun clamp01(x: Double): Double = x.coerceIn(0.0, 1.0)

/** Clamp to [-1, 1]. */
internal fun clampNeg1To1(x: Double): Double = x.coerceIn(-1.0, 1.0)

/** 3x3 matrix * 3-vector multiplication. */
internal fun matvec3(
    m: Array<DoubleArray>,
    v: DoubleArray,
): DoubleArray =
    doubleArrayOf(
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    )
