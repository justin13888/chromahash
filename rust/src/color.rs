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

/// Convert OKLAB to linear RGB in the given **output** gamut (LMS → gamut RGB).
/// sRGB / Display P3 / Adobe RGB are real display targets; BT.2020 / ProPhoto
/// fall back to sRGB (see `Gamut::m1_inv_matrix`). The caller clips each channel
/// to [0, 1] before the gamma encode (relative-colorimetric, §12.6).
pub fn oklab_to_linear_output(lab: [f64; 3], output: Gamut) -> [f64; 3] {
    let lms_cbrt = matvec3(&M2_INV, lab);
    let lms = [
        lms_cbrt[0] * lms_cbrt[0] * lms_cbrt[0],
        lms_cbrt[1] * lms_cbrt[1] * lms_cbrt[1],
        lms_cbrt[2] * lms_cbrt[2] * lms_cbrt[2],
    ];
    matvec3(output.m1_inv_matrix(), lms)
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
    fn p3_vs_srgb_red_differ() {
        let srgb_red = linear_rgb_to_oklab([1.0, 0.0, 0.0], Gamut::Srgb);
        let p3_red = linear_rgb_to_oklab([1.0, 0.0, 0.0], Gamut::DisplayP3);
        // P3 red is more saturated — different OKLAB values
        assert!(
            (srgb_red[1] - p3_red[1]).abs() > 0.01,
            "P3 and sRGB red should differ in OKLAB a"
        );
    }

    #[test]
    fn gamma_rgb_to_oklab_white_and_linear_path() {
        // White gamma sRGB → OKLAB ≈ (1, 0, 0). Pins the (generation-only)
        // reference fn against whole-body replacement (e.g. [0;3] / [1;3]).
        let white = gamma_rgb_to_oklab(1.0, 1.0, 1.0, Gamut::Srgb);
        assert!((white[0] - 1.0).abs() < 1e-6, "white L: {}", white[0]);
        assert!(white[1].abs() < 1e-6, "white a: {}", white[1]);
        assert!(white[2].abs() < 1e-6, "white b: {}", white[2]);

        // It must equal applying the gamut EOTF then the linear OKLAB path.
        let (r, g, b) = (0.5, 0.3, 0.8);
        let via_linear = linear_rgb_to_oklab(
            [
                transfer::srgb_eotf(r),
                transfer::srgb_eotf(g),
                transfer::srgb_eotf(b),
            ],
            Gamut::Srgb,
        );
        assert_eq!(gamma_rgb_to_oklab(r, g, b, Gamut::Srgb), via_linear);
    }

    #[test]
    fn oklab_to_srgb_known_and_linear_path() {
        // Mid-gray survives the OKLAB round-trip back to gamma sRGB ≈ 0.5 — a
        // value distinct from every constant the body could be replaced with.
        let lab_gray = gamma_rgb_to_oklab(0.5, 0.5, 0.5, Gamut::Srgb);
        let srgb = oklab_to_srgb(lab_gray);
        for (i, &c) in srgb.iter().enumerate() {
            assert!((c - 0.5).abs() < 1e-6, "gray channel {i}: {c}");
        }

        // It must equal oklab→linear→clamp→gamma applied channel-wise.
        let lab = [0.6, 0.05, -0.04];
        let lin = oklab_to_linear_srgb(lab);
        let expected = [
            srgb_gamma(clamp01(lin[0])),
            srgb_gamma(clamp01(lin[1])),
            srgb_gamma(clamp01(lin[2])),
        ];
        assert_eq!(oklab_to_srgb(lab), expected);
    }
}
