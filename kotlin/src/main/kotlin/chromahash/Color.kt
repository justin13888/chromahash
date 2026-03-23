package chromahash

/** Convert linear RGB to OKLAB using the specified source gamut's M1 matrix. */
internal fun linearRgbToOklab(
    rgb: DoubleArray,
    gamut: Gamut,
): DoubleArray {
    val m1 = gamut.m1Matrix()
    val lms = matvec3(m1, rgb)
    val lmsCbrt =
        doubleArrayOf(
            cbrtHalley(lms[0]),
            cbrtHalley(lms[1]),
            cbrtHalley(lms[2]),
        )
    return matvec3(M2, lmsCbrt)
}

/** Convert OKLAB to linear sRGB. */
internal fun oklabToLinearSrgb(lab: DoubleArray): DoubleArray {
    val lmsCbrt = matvec3(M2_INV, lab)
    val lms =
        doubleArrayOf(
            lmsCbrt[0] * lmsCbrt[0] * lmsCbrt[0],
            lmsCbrt[1] * lmsCbrt[1] * lmsCbrt[1],
            lmsCbrt[2] * lmsCbrt[2] * lmsCbrt[2],
        )
    return matvec3(M1_INV_SRGB, lms)
}

/** Convert gamma-encoded source RGB to OKLAB. */
internal fun gammaRgbToOklab(
    r: Double,
    g: Double,
    b: Double,
    gamut: Gamut,
): DoubleArray {
    val eotf: (Double) -> Double =
        when (gamut) {
            Gamut.SRGB, Gamut.DISPLAY_P3 -> ::srgbEotf
            Gamut.ADOBE_RGB -> ::adobeRgbEotf
            Gamut.PROPHOTO_RGB -> ::proPhotoRgbEotf
            Gamut.BT2020 -> ::bt2020PqEotf
        }
    return linearRgbToOklab(doubleArrayOf(eotf(r), eotf(g), eotf(b)), gamut)
}

/** Convert OKLAB to gamma-encoded sRGB [0,1] with clamping. */
internal fun oklabToSrgb(lab: DoubleArray): DoubleArray {
    val rgbLinear = oklabToLinearSrgb(lab)
    return doubleArrayOf(
        srgbGamma(clamp01(rgbLinear[0])),
        srgbGamma(clamp01(rgbLinear[1])),
        srgbGamma(clamp01(rgbLinear[2])),
    )
}

/** Check whether all RGB channels are in [0, 1]. */
internal fun inGamut(rgb: DoubleArray): Boolean =
    rgb[0] >= 0.0 && rgb[0] <= 1.0 &&
        rgb[1] >= 0.0 && rgb[1] <= 1.0 &&
        rgb[2] >= 0.0 && rgb[2] <= 1.0

/** Soft gamut clamp via OKLch bisection. Per spec §6.1.
 * Preserves L and hue; reduces chroma until all sRGB channels fit [0, 1].
 * Precondition: L must be in [0, 1].
 */
internal fun softGamutClamp(
    l: Double,
    a: Double,
    b: Double,
): DoubleArray {
    val rgb = oklabToLinearSrgb(doubleArrayOf(l, a, b))
    if (inGamut(rgb)) return doubleArrayOf(l, a, b)

    val c = kotlin.math.sqrt(a * a + b * b)
    if (c < 1e-10) return doubleArrayOf(l, 0.0, 0.0)

    val hCos = a / c
    val hSin = b / c
    var lo = 0.0
    var hi = c
    // Exactly 16 iterations — deterministic per spec §6.1
    repeat(16) {
        val mid = (lo + hi) / 2.0
        val rgbTest = oklabToLinearSrgb(doubleArrayOf(l, mid * hCos, mid * hSin))
        if (inGamut(rgbTest)) lo = mid else hi = mid
    }
    return doubleArrayOf(l, lo * hCos, lo * hSin)
}

/** 4096-entry sRGB gamma LUT: lut[i] = sRGB8(i/4095). Per spec §6.2. */
internal val GAMMA_LUT: IntArray = IntArray(4096) { i ->
    roundHalfAwayFromZero(srgbGamma(i.toDouble() / 4095.0) * 255.0).toInt()
}

/** Map a linear [0,1] value to sRGB u8 via the gamma LUT. Per spec §6.2. */
internal fun linearToSrgb8(x: Double): Int {
    val idx = roundHalfAwayFromZero(x * 4095.0).toLong().coerceIn(0L, 4095L).toInt()
    return GAMMA_LUT[idx]
}
