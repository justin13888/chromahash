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
            cbrtSigned(lms[0]),
            cbrtSigned(lms[1]),
            cbrtSigned(lms[2]),
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
