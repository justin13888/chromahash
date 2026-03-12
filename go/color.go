package chromahash

// linearRgbToOklab converts linear RGB to OKLAB using the gamut's M1 matrix.
func linearRgbToOklab(rgb [3]float64, gamut Gamut) [3]float64 {
	m1 := gamut.m1Matrix()
	lms := matvec3(m1, rgb)
	lmsCbrt := [3]float64{
		cbrtSigned(lms[0]),
		cbrtSigned(lms[1]),
		cbrtSigned(lms[2]),
	}
	return matvec3(&m2, lmsCbrt)
}

// oklabToLinearSrgb converts OKLAB to linear sRGB.
func oklabToLinearSrgb(lab [3]float64) [3]float64 {
	lmsCbrt := matvec3(&m2Inv, lab)
	lms := [3]float64{
		lmsCbrt[0] * lmsCbrt[0] * lmsCbrt[0],
		lmsCbrt[1] * lmsCbrt[1] * lmsCbrt[1],
		lmsCbrt[2] * lmsCbrt[2] * lmsCbrt[2],
	}
	return matvec3(&m1InvSRGB, lms)
}

// gammaRgbToOklab converts gamma-encoded source RGB to OKLAB.
func gammaRgbToOklab(r, g, b float64, gamut Gamut) [3]float64 {
	var eotf func(float64) float64
	switch gamut {
	case GamutSRGB, GamutDisplayP3:
		eotf = srgbEotf
	case GamutAdobeRGB:
		eotf = adobeRgbEotf
	case GamutProPhotoRGB:
		eotf = proPhotoRgbEotf
	case GamutBT2020:
		eotf = bt2020PqEotf
	default:
		eotf = srgbEotf
	}
	return linearRgbToOklab([3]float64{eotf(r), eotf(g), eotf(b)}, gamut)
}

// oklabToSrgb converts OKLAB to gamma-encoded sRGB [0,1] with clamping.
func oklabToSrgb(lab [3]float64) [3]float64 {
	rgbLinear := oklabToLinearSrgb(lab)
	return [3]float64{
		srgbGamma(clamp01(rgbLinear[0])),
		srgbGamma(clamp01(rgbLinear[1])),
		srgbGamma(clamp01(rgbLinear[2])),
	}
}
