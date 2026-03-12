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

/// Signed cube root per spec: cbrt(x) = sign(x) * |x|^(1/3).
/// Uses `pow(|x|, 1/3)` because it produces bit-identical results to Rust's
/// `f64::cbrt()` on x86_64 Linux (Rust uses its own libm, not glibc's cbrt).
func cbrtSigned(_ x: Double) -> Double {
  if x == 0.0 {
    return 0.0
  } else if x > 0.0 {
    return pow(x, 1.0 / 3.0)
  } else {
    return -pow(-x, 1.0 / 3.0)
  }
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
