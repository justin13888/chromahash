package chromahash

import "math"

// linearRgbToOklab converts linear RGB to OKLAB using the gamut's M1 matrix.
func linearRgbToOklab(rgb [3]float64, gamut Gamut) [3]float64 {
	m1 := gamut.m1Matrix()
	lms := matvec3(m1, rgb)
	lmsCbrt := [3]float64{
		cbrtHalley(lms[0]),
		cbrtHalley(lms[1]),
		cbrtHalley(lms[2]),
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

// inGamut checks whether all RGB channels are in [0, 1].
func inGamut(rgb [3]float64) bool {
	return rgb[0] >= 0.0 && rgb[0] <= 1.0 &&
		rgb[1] >= 0.0 && rgb[1] <= 1.0 &&
		rgb[2] >= 0.0 && rgb[2] <= 1.0
}

// softGamutClamp clamps an OKLAB color into sRGB gamut via OKLch bisection. Per spec §6.1.
// Preserves L and hue; reduces chroma until all sRGB channels fit [0, 1].
// Precondition: L must be in [0, 1].
func softGamutClamp(l, a, b float64) [3]float64 {
	rgb := oklabToLinearSrgb([3]float64{l, a, b})
	if inGamut(rgb) {
		return [3]float64{l, a, b}
	}
	c := math.Sqrt(a*a + b*b)
	if c < 1e-10 {
		return [3]float64{l, 0.0, 0.0}
	}
	hCos := a / c
	hSin := b / c
	lo := 0.0
	hi := c
	// Exactly 16 iterations — deterministic per spec §6.1
	for range 16 {
		mid := (lo + hi) / 2.0
		rgbTest := oklabToLinearSrgb([3]float64{l, mid * hCos, mid * hSin})
		if inGamut(rgbTest) {
			lo = mid
		} else {
			hi = mid
		}
	}
	return [3]float64{l, lo * hCos, lo * hSin}
}

// gammaLUT is a 4096-entry sRGB gamma LUT: lut[i] = sRGB8(i/4095). Per spec §6.2.
var gammaLUT = func() [4096]byte {
	var lut [4096]byte
	for i := range lut {
		x := float64(i) / 4095.0
		lut[i] = byte(int(roundHalfAwayFromZero(srgbGamma(x) * 255.0)))
	}
	return lut
}()

// linearToSrgb8 maps a linear [0,1] value to sRGB u8 via the gamma LUT. Per spec §6.2.
func linearToSrgb8(x float64) byte {
	idx := int(roundHalfAwayFromZero(x * 4095.0))
	if idx < 0 {
		idx = 0
	}
	if idx > 4095 {
		idx = 4095
	}
	return gammaLUT[idx]
}
