use crate::math_utils::portable_pow;

/// sRGB EOTF (gamma → linear), per spec §5.3.
pub fn srgb_eotf(x: f64) -> f64 {
    if x <= 0.04045 {
        x / 12.92
    } else {
        portable_pow((x + 0.055) / 1.055, 2.4)
    }
}

/// sRGB gamma (linear → gamma), per spec §12.6.
pub fn srgb_gamma(x: f64) -> f64 {
    if x <= 0.0031308 {
        12.92 * x
    } else {
        1.055 * portable_pow(x, 1.0 / 2.4) - 0.055
    }
}

/// Adobe RGB EOTF (gamma → linear): x^2.2.
pub fn adobe_rgb_eotf(x: f64) -> f64 {
    portable_pow(x, 2.2)
}

/// ProPhoto RGB EOTF (gamma → linear): x^1.8.
pub fn prophoto_rgb_eotf(x: f64) -> f64 {
    portable_pow(x, 1.8)
}

/// BT.2020 PQ (ST 2084) inverse EOTF → linear light, then Reinhard tone-map to SDR.
pub fn bt2020_pq_eotf(x: f64) -> f64 {
    // PQ inverse EOTF constants (ST 2084)
    const M1: f64 = 0.1593017578125;
    const M2: f64 = 78.84375;
    const C1: f64 = 0.8359375;
    const C2: f64 = 18.8515625;
    const C3: f64 = 18.6875;

    let n = portable_pow(x, 1.0 / M2);
    let num = (n - C1).max(0.0);
    let den = C2 - C3 * n;
    let y_linear = portable_pow(num / den, 1.0 / M1);

    // PQ output is in [0, 10000] cd/m²
    let y_nits = y_linear * 10000.0;

    // Simple Reinhard tone mapping: L / (1 + L)
    // SDR reference white = 203 nits
    let l = y_nits / 203.0;
    l / (1.0 + l)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srgb_roundtrip() {
        for &x in &[0.0, 0.01, 0.04045, 0.1, 0.5, 0.9, 1.0] {
            let linear = srgb_eotf(x);
            let gamma = srgb_gamma(linear);
            // Tolerance accounts for piecewise boundary discontinuity in sRGB standard
            assert!(
                (gamma - x).abs() < 1e-4,
                "sRGB roundtrip failed at x={x}: got {gamma}"
            );
        }
    }

    #[test]
    fn srgb_eotf_threshold() {
        // At the threshold, both branches should give same result
        let below = srgb_eotf(0.04045);
        let at = 0.04045 / 12.92;
        assert!((below - at).abs() < 1e-12);
    }

    #[test]
    fn srgb_gamma_threshold() {
        let below = srgb_gamma(0.0031308);
        let at = 12.92 * 0.0031308;
        assert!((below - at).abs() < 1e-12);
    }

    #[test]
    fn srgb_boundaries() {
        assert_eq!(srgb_eotf(0.0), 0.0);
        assert!((srgb_eotf(1.0) - 1.0).abs() < 1e-12);
        assert_eq!(srgb_gamma(0.0), 0.0);
        assert!((srgb_gamma(1.0) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn adobe_rgb_boundaries() {
        assert_eq!(adobe_rgb_eotf(0.0), 0.0);
        assert!((adobe_rgb_eotf(1.0) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn prophoto_boundaries() {
        assert_eq!(prophoto_rgb_eotf(0.0), 0.0);
        assert!((prophoto_rgb_eotf(1.0) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn bt2020_pq_boundaries() {
        // PQ(0) should give 0
        assert_eq!(bt2020_pq_eotf(0.0), 0.0);
        // PQ(1) should give tone-mapped value near 1.0 (10000 nits → ~0.98)
        let max = bt2020_pq_eotf(1.0);
        assert!(
            max > 0.9 && max < 1.0,
            "PQ(1.0) should be near 1.0, got {max}"
        );
    }
}
