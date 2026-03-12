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
 * Signed cube root per spec: cbrt(x) = sign(x) * |x|^(1/3).
 * Uses Math.cbrt which is correctly rounded on modern JVMs (HotSpot JDK 21+).
 */
internal fun cbrtSigned(x: Double): Double = Math.cbrt(x)

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
