import Foundation

/// Round half away from zero (NOT Swift's default banker's rounding).
/// Per spec: round(x) = floor(x + 0.5) for x >= 0, ceil(x - 0.5) for x < 0.
func roundHalfAwayFromZero(_ x: Double) -> Double {
  if x >= 0.0 {
    return floor(x + 0.5)
  } else {
    return ceil(x - 0.5)
  }
}

/// Portable natural logarithm using only basic IEEE 754 arithmetic.
/// Range-reduces to [1, 2) then uses the series ln(m) = 2 * sum(u^(2k+1)/(2k+1))
/// where u = (m-1)/(m+1).
func portableLn(_ x: Double) -> Double {
  let ln2 = 0.6931471805599453

  if x <= 0.0 {
    return -.infinity
  }
  if x == 1.0 {
    return 0.0
  }

  // Range reduce to m in [1, 2)
  var m = x
  var e = 0
  while m >= 2.0 {
    m /= 2.0
    e += 1
  }
  while m < 1.0 {
    m *= 2.0
    e -= 1
  }

  // Series: ln(m) = 2*(u + u^3/3 + u^5/5 + ...) where u = (m-1)/(m+1)
  let u = (m - 1.0) / (m + 1.0)
  let u2 = u * u
  var term = u
  var sum = u
  var k = 1
  while k <= 20 {
    term *= u2
    sum += term / Double(2 * k + 1)
    k += 1
  }

  return 2.0 * sum + Double(e) * ln2
}

/// Portable exponential using only basic IEEE 754 arithmetic.
/// Range-reduces via exp(x) = 2^k * exp(r) where r in [-ln2/2, ln2/2],
/// then uses a degree-25 Taylor polynomial for exp(r).
func portableExp(_ x: Double) -> Double {
  let ln2 = 0.6931471805599453

  if x == 0.0 {
    return 1.0
  }

  // Range reduction: k = round(x / ln2), r = x - k*ln2
  let k = Int((x / ln2 + 0.5).rounded(.down))
  let r = x - Double(k) * ln2

  // Taylor polynomial for exp(r), |r| < 0.347
  var term = 1.0
  var sum = 1.0
  var i = 1
  while i <= 25 {
    term *= r / Double(i)
    sum += term
    i += 1
  }

  // Multiply by 2^k
  var result = sum
  if k >= 0 {
    var j = 0
    while j < k {
      result *= 2.0
      j += 1
    }
  } else {
    var j = 0
    while j < -k {
      result /= 2.0
      j += 1
    }
  }

  return result
}

/// Portable power function: base^exponent using only basic IEEE 754 arithmetic.
/// Computes exp(exponent * ln(base)).
func portablePow(_ base: Double, _ exponent: Double) -> Double {
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

/// Signed cube root per spec: cbrt(x) = sign(x) * |x|^(1/3).
/// Uses portablePow for cross-platform determinism.
/// Cube root via Halley's method with biased-exponent seed.
/// Matches Rust cbrt_halley for cross-language bit-exact determinism.
func cbrtHalley(_ x: Double) -> Double {
  if x == 0.0 { return 0.0 }
  let sign = x < 0.0
  let ax = sign ? -x : x

  // Seed via signed int64 biased-exponent division
  let signedBits = Int64(bitPattern: ax.bitPattern)
  let bias: Int64 = 1023 << 52
  let seedBits = (signedBits - bias) / 3 + bias
  var y = Double(bitPattern: UInt64(bitPattern: seedBits))

  // 3 Halley iterations
  for _ in 0..<3 {
    let t1 = y * y
    let y3 = t1 * y
    let t2 = 2.0 * ax
    let num = y3 + t2
    let t3 = 2.0 * y3
    let den = t3 + ax
    let t4 = y * num
    y = t4 / den
  }

  return sign ? -y : y
}

/// Portable cosine using only basic IEEE 754 arithmetic.
/// Produces bit-identical results across all platforms.
func portableCos(_ x: Double) -> Double {
  let pi = 3.141592653589793
  let twoPi = 6.283185307179586
  let halfPi = 1.5707963267948966

  var t = x < 0.0 ? -x : x

  if t >= twoPi {
    t -= (t / twoPi).rounded(.down) * twoPi
  }

  if t > pi {
    t = twoPi - t
  }

  let negate = t > halfPi
  if negate {
    t = pi - t
  }

  let x2 = t * t
  let r =
    1.0 + x2
    * (-1.0 / 2.0 + x2
      * (1.0 / 24.0 + x2
        * (-1.0 / 720.0 + x2
          * (1.0 / 40320.0 + x2
            * (-1.0 / 3628800.0 + x2
              * (1.0 / 479001600.0 + x2 * (-1.0 / 87178291200.0 + x2 * (1.0 / 20922789888000.0))))))))

  return negate ? -r : r
}

/// Clamp to [0, 1].
func clamp01(_ x: Double) -> Double {
  return min(max(x, 0.0), 1.0)
}

/// Clamp to [-1, 1].
func clampNeg1To1(_ x: Double) -> Double {
  return min(max(x, -1.0), 1.0)
}

/// 3x3 matrix * 3-vector multiplication.
func matvec3(_ m: [[Double]], _ v: [Double]) -> [Double] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ]
}
