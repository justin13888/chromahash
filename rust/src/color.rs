use crate::constants::{Gamut, M1_INV_SRGB, M2, M2_INV};
use crate::math_utils::{cbrt_signed, clamp01, matvec3};
use crate::transfer::{self, srgb_gamma};

/// Convert linear RGB to OKLAB using the specified source gamut's M1 matrix.
pub fn linear_rgb_to_oklab(rgb: [f64; 3], gamut: Gamut) -> [f64; 3] {
    let m1 = gamut.m1_matrix();
    let lms = matvec3(m1, rgb);
    let lms_cbrt = [
        cbrt_signed(lms[0]),
        cbrt_signed(lms[1]),
        cbrt_signed(lms[2]),
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

/// Convert gamma-encoded source RGB to OKLAB.
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
}
