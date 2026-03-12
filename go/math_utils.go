package chromahash

import "math"

// roundHalfAwayFromZero rounds x to the nearest integer, with ties going away
// from zero. MUST NOT use math.Round (which uses banker's rounding).
// Per spec §2.2: floor(x+0.5) for x≥0, ceil(x-0.5) for x<0.
func roundHalfAwayFromZero(x float64) float64 {
	if x >= 0.0 {
		return math.Floor(x + 0.5)
	}
	return math.Ceil(x - 0.5)
}

// cbrtSigned is the signed cube root per spec §2.4: sign(x) × |x|^(1/3).
func cbrtSigned(x float64) float64 {
	if x == 0.0 {
		return 0.0
	}
	return math.Copysign(math.Cbrt(math.Abs(x)), x)
}

// clamp01 clamps x to [0, 1].
func clamp01(x float64) float64 {
	if x < 0.0 {
		return 0.0
	}
	if x > 1.0 {
		return 1.0
	}
	return x
}

// clampNeg1To1 clamps x to [-1, 1].
func clampNeg1To1(x float64) float64 {
	if x < -1.0 {
		return -1.0
	}
	if x > 1.0 {
		return 1.0
	}
	return x
}

// matvec3 multiplies a 3×3 matrix by a 3-vector.
func matvec3(m *[3][3]float64, v [3]float64) [3]float64 {
	return [3]float64{
		m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
		m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
		m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
	}
}
