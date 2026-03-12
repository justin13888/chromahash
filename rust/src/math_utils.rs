/// Round half away from zero (NOT Rust's default banker's rounding).
/// Per spec §2.2: round(x) = floor(x + 0.5) for x ≥ 0, ceil(x - 0.5) for x < 0.
pub fn round_half_away_from_zero(x: f64) -> f64 {
    if x >= 0.0 {
        (x + 0.5).floor()
    } else {
        (x - 0.5).ceil()
    }
}

/// Signed cube root per spec §2.4: cbrt(x) = sign(x) × |x|^(1/3).
pub fn cbrt_signed(x: f64) -> f64 {
    if x == 0.0 {
        0.0
    } else {
        x.signum() * x.abs().cbrt()
    }
}

/// Clamp to [0, 1].
pub fn clamp01(x: f64) -> f64 {
    x.clamp(0.0, 1.0)
}

/// Clamp to [-1, 1].
pub fn clamp_neg1_1(x: f64) -> f64 {
    x.clamp(-1.0, 1.0)
}

/// 3×3 matrix × 3-vector multiplication.
pub fn matvec3(m: &[[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_positive_half() {
        assert_eq!(round_half_away_from_zero(0.5), 1.0);
        assert_eq!(round_half_away_from_zero(1.5), 2.0);
        assert_eq!(round_half_away_from_zero(2.5), 3.0);
    }

    #[test]
    fn round_negative_half() {
        assert_eq!(round_half_away_from_zero(-0.5), -1.0);
        assert_eq!(round_half_away_from_zero(-1.5), -2.0);
        assert_eq!(round_half_away_from_zero(-2.5), -3.0);
    }

    #[test]
    fn round_standard_cases() {
        assert_eq!(round_half_away_from_zero(0.0), 0.0);
        assert_eq!(round_half_away_from_zero(0.3), 0.0);
        assert_eq!(round_half_away_from_zero(0.7), 1.0);
        assert_eq!(round_half_away_from_zero(-0.3), 0.0);
        assert_eq!(round_half_away_from_zero(-0.7), -1.0);
    }

    #[test]
    fn cbrt_positive() {
        assert!((cbrt_signed(8.0) - 2.0).abs() < 1e-12);
        assert!((cbrt_signed(27.0) - 3.0).abs() < 1e-12);
        assert!((cbrt_signed(1.0) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn cbrt_negative() {
        assert!((cbrt_signed(-8.0) - (-2.0)).abs() < 1e-12);
        assert!((cbrt_signed(-27.0) - (-3.0)).abs() < 1e-12);
    }

    #[test]
    fn cbrt_zero() {
        assert_eq!(cbrt_signed(0.0), 0.0);
    }

    #[test]
    fn clamp01_works() {
        assert_eq!(clamp01(-0.5), 0.0);
        assert_eq!(clamp01(0.5), 0.5);
        assert_eq!(clamp01(1.5), 1.0);
    }

    #[test]
    fn matvec3_identity() {
        let identity = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        let v = [3.0, 4.0, 5.0];
        let r = matvec3(&identity, v);
        assert_eq!(r, v);
    }
}
