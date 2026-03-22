use crate::constants::{Gamut, M1_INV_SRGB, M2, M2_INV};
use crate::math_utils::{cbrt_halley, clamp01, matvec3};
use crate::transfer::{self, srgb_gamma};

/// Convert linear RGB to OKLAB using the specified source gamut's M1 matrix.
pub fn linear_rgb_to_oklab(rgb: [f64; 3], gamut: Gamut) -> [f64; 3] {
    let m1 = gamut.m1_matrix();
    let lms = matvec3(m1, rgb);
    let lms_cbrt = [
        cbrt_halley(lms[0]),
        cbrt_halley(lms[1]),
        cbrt_halley(lms[2]),
    ];
    matvec3(&M2, lms_cbrt)
}

/// Convert OKLAB to linear sRGB.
pub fn oklab_to_linear_srgb(lab: [f64; 3]) -> [f64; 3] {
    let lms_cbrt = matvec3(&M2_INV, lab);
    let lms = [
        lms_cbrt[0] * lms_cbrt[0] * lms_cbrt[0],
        lms_cbrt[1] * lms_cbrt[1] * lms_cbrt[1],
        lms_cbrt[2] * lms_cbrt[2] * lms_cbrt[2],
    ];
    matvec3(&M1_INV_SRGB, lms)
}

/// Check whether all RGB channels are in [0, 1] (exact IEEE 754 comparison).
pub fn in_gamut(rgb: [f64; 3]) -> bool {
    rgb[0] >= 0.0
        && rgb[0] <= 1.0
        && rgb[1] >= 0.0
        && rgb[1] <= 1.0
        && rgb[2] >= 0.0
        && rgb[2] <= 1.0
}

/// Soft gamut clamp via Oklch bisection. Per spec §6.1.
/// Preserves L and hue; reduces chroma until all sRGB channels fit [0, 1].
/// Precondition: L must be in [0, 1].
pub fn soft_gamut_clamp(l: f64, a: f64, b: f64) -> [f64; 3] {
    let rgb = oklab_to_linear_srgb([l, a, b]);
    if in_gamut(rgb) {
        return [l, a, b];
    }

    let c = (a * a + b * b).sqrt();
    if c < 1e-10 {
        return [l, 0.0, 0.0];
    }

    let h_cos = a / c;
    let h_sin = b / c;

    let mut lo = 0.0_f64;
    let mut hi = c;
    // Exactly 16 iterations, no early exit — deterministic per spec §6.1
    for _ in 0..16 {
        let mid = (lo + hi) / 2.0;
        let a_test = mid * h_cos;
        let b_test = mid * h_sin;
        let rgb_test = oklab_to_linear_srgb([l, a_test, b_test]);
        if in_gamut(rgb_test) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    [l, lo * h_cos, lo * h_sin]
}

/// Convert gamma-encoded source RGB to OKLAB.
/// Used in test_vectors generation; encode pipeline uses EOTF LUT + linear_rgb_to_oklab.
#[allow(dead_code)]
pub fn gamma_rgb_to_oklab(r: f64, g: f64, b: f64, gamut: Gamut) -> [f64; 3] {
    let eotf: fn(f64) -> f64 = match gamut {
        Gamut::Srgb | Gamut::DisplayP3 => transfer::srgb_eotf,
        Gamut::AdobeRgb => transfer::adobe_rgb_eotf,
        Gamut::ProPhotoRgb => transfer::prophoto_rgb_eotf,
        Gamut::Bt2020 => transfer::bt2020_pq_eotf,
    };
    linear_rgb_to_oklab([eotf(r), eotf(g), eotf(b)], gamut)
}

/// Convert OKLAB to gamma-encoded sRGB [0,1] with clamping.
/// Retained for reference; decode pipeline uses oklab_to_linear_srgb + gamma LUT.
#[allow(dead_code)]
pub fn oklab_to_srgb(lab: [f64; 3]) -> [f64; 3] {
    let rgb_linear = oklab_to_linear_srgb(lab);
    [
        srgb_gamma(clamp01(rgb_linear[0])),
        srgb_gamma(clamp01(rgb_linear[1])),
        srgb_gamma(clamp01(rgb_linear[2])),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn white_to_oklab() {
        let lab = linear_rgb_to_oklab([1.0, 1.0, 1.0], Gamut::Srgb);
        assert!(
            (lab[0] - 1.0).abs() < 1e-6,
            "white L should ≈ 1, got {}",
            lab[0]
        );
        assert!(lab[1].abs() < 1e-6, "white a should ≈ 0, got {}", lab[1]);
        assert!(lab[2].abs() < 1e-6, "white b should ≈ 0, got {}", lab[2]);
    }

    #[test]
    fn black_to_oklab() {
        let lab = linear_rgb_to_oklab([0.0, 0.0, 0.0], Gamut::Srgb);
        assert!(lab[0].abs() < 1e-12, "black L should = 0, got {}", lab[0]);
        assert!(lab[1].abs() < 1e-12, "black a should = 0, got {}", lab[1]);
        assert!(lab[2].abs() < 1e-12, "black b should = 0, got {}", lab[2]);
    }

    #[test]
    fn roundtrip_srgb() {
        let test_colors: &[[f64; 3]] = &[
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.5, 0.5, 0.5],
            [0.2, 0.7, 0.3],
        ];
        for &rgb in test_colors {
            let lab = linear_rgb_to_oklab(rgb, Gamut::Srgb);
            let rgb2 = oklab_to_linear_srgb(lab);
            for i in 0..3 {
                assert!(
                    (rgb[i] - rgb2[i]).abs() < 1e-6,
                    "roundtrip failed for {rgb:?} at channel {i}: got {rgb2:?}"
                );
            }
        }
    }

    #[test]
    fn in_gamut_passthrough() {
        assert!(in_gamut([0.0, 0.0, 0.0]));
        assert!(in_gamut([1.0, 1.0, 1.0]));
        assert!(in_gamut([0.5, 0.3, 0.8]));
        assert!(!in_gamut([1.1, 0.5, 0.5]));
        assert!(!in_gamut([0.5, -0.1, 0.5]));
    }

    #[test]
    fn soft_gamut_clamp_in_gamut_passthrough() {
        // An in-gamut OKLAB color should pass through unchanged
        let [l, a, b] = soft_gamut_clamp(0.5, 0.0, 0.0);
        assert_eq!(l, 0.5);
        assert_eq!(a, 0.0);
        assert_eq!(b, 0.0);
    }

    #[test]
    fn soft_gamut_clamp_achromatic() {
        // Exactly zero chroma: C=0 → in-gamut passthrough returns (L, 0, 0)
        let [l, a, b] = soft_gamut_clamp(0.5, 0.0, 0.0);
        assert_eq!(l, 0.5);
        assert_eq!(a, 0.0);
        assert_eq!(b, 0.0);
    }

    #[test]
    fn soft_gamut_clamp_reduces_out_of_gamut() {
        // Highly saturated OKLAB that is out of sRGB gamut
        let (l_in, a_in, b_in) = (0.5f64, 0.4, 0.0);
        let rgb_before = oklab_to_linear_srgb([l_in, a_in, b_in]);
        // Verify it is actually out of gamut before clamping
        if !in_gamut(rgb_before) {
            let [l_out, a_out, b_out] = soft_gamut_clamp(l_in, a_in, b_in);
            // L and hue must be preserved
            assert_eq!(l_out, l_in, "L should be unchanged");
            let c_out = (a_out * a_out + b_out * b_out).sqrt();
            let c_in = (a_in * a_in + b_in * b_in).sqrt();
            assert!(c_out <= c_in + 1e-10, "chroma should not increase");
            // Result should be in gamut
            let rgb_out = oklab_to_linear_srgb([l_out, a_out, b_out]);
            assert!(in_gamut(rgb_out), "result should be in gamut: {rgb_out:?}");
        }
    }

    #[test]
    fn p3_vs_srgb_red_differ() {
        let srgb_red = linear_rgb_to_oklab([1.0, 0.0, 0.0], Gamut::Srgb);
        let p3_red = linear_rgb_to_oklab([1.0, 0.0, 0.0], Gamut::DisplayP3);
        // P3 red is more saturated — different OKLAB values
        assert!(
            (srgb_red[1] - p3_red[1]).abs() > 0.01,
            "P3 and sRGB red should differ in OKLAB a"
        );
    }
}
