package chromahash

import "math"

// srgbEotf converts sRGB gamma-encoded value to linear, per spec §5.4.
func srgbEotf(x float64) float64 {
	if x <= 0.04045 {
		return x / 12.92
	}
	return math.Pow((x+0.055)/1.055, 2.4)
}

// srgbGamma converts linear to sRGB gamma-encoded value, per spec §12.7.
func srgbGamma(x float64) float64 {
	if x <= 0.0031308 {
		return 12.92 * x
	}
	return 1.055*math.Pow(x, 1.0/2.4) - 0.055
}

// adobeRgbEotf converts Adobe RGB gamma-encoded value to linear: x^2.2.
func adobeRgbEotf(x float64) float64 {
	return math.Pow(x, 2.2)
}

// proPhotoRgbEotf converts ProPhoto RGB gamma-encoded value to linear: x^1.8.
func proPhotoRgbEotf(x float64) float64 {
	return math.Pow(x, 1.8)
}

// bt2020PqEotf converts BT.2020 PQ (ST 2084) signal to linear light,
// then applies Reinhard tone mapping to SDR.
func bt2020PqEotf(x float64) float64 {
	const (
		pqM1 = 0.1593017578125
		pqM2 = 78.84375
		pqC1 = 0.8359375
		pqC2 = 18.8515625
		pqC3 = 18.6875
	)

	n := math.Pow(x, 1.0/pqM2)
	num := math.Max(n-pqC1, 0.0)
	den := pqC2 - pqC3*n
	yLinear := math.Pow(num/den, 1.0/pqM1)

	// PQ output is in [0, 10000] cd/m²
	yNits := yLinear * 10000.0

	// Simple Reinhard tone mapping: L / (1 + L)
	// SDR reference white = 203 nits
	l := yNits / 203.0
	return l / (1.0 + l)
}
