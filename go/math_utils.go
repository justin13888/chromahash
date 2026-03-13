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

// portableLn computes the natural logarithm using only basic IEEE 754 arithmetic.
// Range-reduces to [1, 2) then uses the series ln(m) = 2·Σ u^(2k+1)/(2k+1)
// where u = (m-1)/(m+1).
func portableLn(x float64) float64 {
	const ln2 = 0.6931471805599453

	if x <= 0.0 {
		return math.Inf(-1)
	}
	if x == 1.0 {
		return 0.0
	}

	// Range reduce to m ∈ [1, 2)
	m := x
	e := 0
	for m >= 2.0 {
		m /= 2.0
		e++
	}
	for m < 1.0 {
		m *= 2.0
		e--
	}

	// Series: ln(m) = 2·(u + u³/3 + u⁵/5 + ...) where u = (m-1)/(m+1)
	// For m ∈ [1, 2), u ∈ [0, 1/3), converges fast
	u := (m - 1.0) / (m + 1.0)
	u2 := u * u
	term := u
	sum := u
	for k := 1; k <= 20; k++ {
		term *= u2
		sum += term / float64(2*k+1)
	}

	return 2.0*sum + float64(e)*ln2
}

// portableExp computes the exponential function using only basic IEEE 754 arithmetic.
// Range-reduces via exp(x) = 2^k · exp(r) where r ∈ [-ln2/2, ln2/2],
// then uses a degree-25 Taylor polynomial for exp(r).
func portableExp(x float64) float64 {
	const ln2 = 0.6931471805599453

	if x == 0.0 {
		return 1.0
	}

	// Range reduction: k = round(x / ln2), r = x - k·ln2
	k := int(math.Floor(x/ln2 + 0.5))
	r := x - float64(k)*ln2

	// Taylor polynomial for exp(r), |r| < 0.347
	term := 1.0
	sum := 1.0
	for i := 1; i <= 25; i++ {
		term *= r / float64(i)
		sum += term
	}

	// Multiply by 2^k
	result := sum
	if k >= 0 {
		for j := 0; j < k; j++ {
			result *= 2.0
		}
	} else {
		for j := 0; j < -k; j++ {
			result /= 2.0
		}
	}

	return result
}

// portablePow computes base^exponent using only basic IEEE 754 arithmetic.
// Computes exp(exponent · ln(base)).
func portablePow(base, exponent float64) float64 {
	if base == 0.0 {
		return 0.0
	}
	if exponent == 0.0 {
		return 1.0
	}
	if base == 1.0 {
		return 1.0
	}
	return portableExp(exponent * portableLn(base))
}

// cbrtSigned is the signed cube root per spec §2.4: sign(x) × |x|^(1/3).
// Uses portablePow for cross-platform determinism.
func cbrtSigned(x float64) float64 {
	if x == 0 {
		return 0
	}
	if x > 0 {
		return portablePow(x, 1.0/3.0)
	}
	return -portablePow(-x, 1.0/3.0)
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

// portableCos computes cosine using only basic IEEE 754 arithmetic (+, -, *, /).
// This produces bit-identical results across all platforms, unlike math.Cos()
// which can differ at the last ULP due to different runtime implementations.
func portableCos(x float64) float64 {
	const pi = 3.141592653589793
	const twoPi = 6.283185307179586
	const halfPi = 1.5707963267948966

	// cos is even
	if x < 0 {
		x = -x
	}

	// Range reduce to [0, 2π)
	if x >= twoPi {
		x -= math.Floor(x/twoPi) * twoPi
	}

	// Reduce to [0, π] using cos(2π - x) = cos(x)
	if x > pi {
		x = twoPi - x
	}

	// Reduce to [0, π/2] using cos(π - x) = -cos(x)
	negate := x > halfPi
	if negate {
		x = pi - x
	}

	// Horner form of degree-16 Taylor polynomial for cos(x) on [0, π/2]
	x2 := x * x
	r := 1.0 + x2*(-1.0/2.0+x2*(1.0/24.0+x2*(-1.0/720.0+x2*(1.0/40320.0+x2*(-1.0/3628800.0+x2*(1.0/479001600.0+x2*(-1.0/87178291200.0+x2*(1.0/20922789888000.0))))))))

	if negate {
		return -r
	}
	return r
}

// matvec3 multiplies a 3×3 matrix by a 3-vector.
func matvec3(m *[3][3]float64, v [3]float64) [3]float64 {
	return [3]float64{
		m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
		m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
		m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
	}
}
