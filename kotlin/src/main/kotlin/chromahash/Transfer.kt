package chromahash

import kotlin.math.max
import kotlin.math.pow

/** sRGB EOTF (gamma -> linear), per spec. */
fun srgbEotf(x: Double): Double =
    if (x <= 0.04045) {
        x / 12.92
    } else {
        ((x + 0.055) / 1.055).pow(2.4)
    }

/** sRGB gamma (linear -> gamma), per spec. */
fun srgbGamma(x: Double): Double =
    if (x <= 0.0031308) {
        12.92 * x
    } else {
        1.055 * x.pow(1.0 / 2.4) - 0.055
    }

/** Adobe RGB EOTF (gamma -> linear): x^2.2. */
fun adobeRgbEotf(x: Double): Double = x.pow(2.2)

/** ProPhoto RGB EOTF (gamma -> linear): x^1.8. */
fun proPhotoRgbEotf(x: Double): Double = x.pow(1.8)

/** BT.2020 PQ (ST 2084) inverse EOTF -> linear light, then Reinhard tone-map to SDR. */
fun bt2020PqEotf(x: Double): Double {
    // PQ inverse EOTF constants (ST 2084)
    val m1 = 0.1593017578125
    val m2 = 78.84375
    val c1 = 0.8359375
    val c2 = 18.8515625
    val c3 = 18.6875

    val n = x.pow(1.0 / m2)
    val num = max(n - c1, 0.0)
    val den = c2 - c3 * n
    val yLinear = (num / den).pow(1.0 / m1)

    // PQ output is in [0, 10000] cd/m^2
    val yNits = yLinear * 10000.0

    // Simple Reinhard tone mapping: L / (1 + L)
    // SDR reference white = 203 nits
    val l = yNits / 203.0
    return l / (1.0 + l)
}
