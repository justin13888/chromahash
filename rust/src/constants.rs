/// Gamut identifiers for source color spaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gamut {
    Srgb,
    DisplayP3,
    AdobeRgb,
    Bt2020,
    ProPhotoRgb,
}

/// µ-law companding parameter (§7.3).
pub const MU: f64 = 5.0;

/// Scale factor maximums (§7.2, §12.1).
pub const MAX_CHROMA_A: f64 = 0.45;
pub const MAX_CHROMA_B: f64 = 0.45;
pub const MAX_L_SCALE: f64 = 0.5;
pub const MAX_A_SCALE: f64 = 0.5;
pub const MAX_B_SCALE: f64 = 0.5;
pub const MAX_A_ALPHA_SCALE: f64 = 0.5;

/// M2: LMS (cube-root) → OKLAB [L, a, b] (Ottosson).
pub const M2: [[f64; 3]; 3] = [
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660],
];

/// M2_INV: OKLAB [L, a, b] → LMS (cube-root).
pub const M2_INV: [[f64; 3]; 3] = [
    [1.0000000000, 0.3963377774, 0.2158037573],
    [1.0000000000, -0.1055613458, -0.0638541728],
    [1.0000000000, -0.0894841775, -1.2914855480],
];

/// M1[sRGB]: Linear sRGB → LMS (Ottosson published).
pub const M1_SRGB: [[f64; 3]; 3] = [
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
];

/// M1[Display P3]: Linear Display P3 → LMS.
pub const M1_DISPLAY_P3: [[f64; 3]; 3] = [
    [0.4813798544, 0.4621183697, 0.0565017758],
    [0.2288319449, 0.6532168128, 0.1179512422],
    [0.0839457557, 0.2241652689, 0.6918889754],
];

/// M1[Adobe RGB]: Linear Adobe RGB → LMS.
pub const M1_ADOBE_RGB: [[f64; 3]; 3] = [
    [0.5764322615, 0.3699132211, 0.0536545174],
    [0.2963164739, 0.5916761266, 0.1120073994],
    [0.1234782548, 0.2194986958, 0.6570230494],
];

/// M1[BT.2020]: Linear BT.2020 → LMS.
pub const M1_BT2020: [[f64; 3]; 3] = [
    [0.6167557872, 0.3601983994, 0.0230458134],
    [0.2651330640, 0.6358393641, 0.0990275718],
    [0.1001026342, 0.2039065194, 0.6959908464],
];

/// M1[ProPhoto RGB]: Linear ProPhoto RGB → LMS (includes Bradford D50→D65).
pub const M1_PROPHOTO_RGB: [[f64; 3]; 3] = [
    [0.7154484635, 0.3527915480, -0.0682400115],
    [0.2744116551, 0.6677976408, 0.0577907040],
    [0.1097844385, 0.1861982875, 0.7040172740],
];

/// M1_INV[sRGB]: LMS → Linear sRGB (decoder matrix, Ottosson published).
pub const M1_INV_SRGB: [[f64; 3]; 3] = [
    [4.0767416621, -3.3077115913, 0.2309699292],
    [-1.2684380046, 2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147, 1.7076147010],
];

impl Gamut {
    /// Return the M1 matrix for this gamut.
    pub(crate) fn m1_matrix(self) -> &'static [[f64; 3]; 3] {
        match self {
            Gamut::Srgb => &M1_SRGB,
            Gamut::DisplayP3 => &M1_DISPLAY_P3,
            Gamut::AdobeRgb => &M1_ADOBE_RGB,
            Gamut::Bt2020 => &M1_BT2020,
            Gamut::ProPhotoRgb => &M1_PROPHOTO_RGB,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::math_utils::matvec3;

    fn matmul3(a: &[[f64; 3]; 3], b: &[[f64; 3]; 3]) -> [[f64; 3]; 3] {
        let mut c = [[0.0; 3]; 3];
        for i in 0..3 {
            for j in 0..3 {
                for k in 0..3 {
                    c[i][j] += a[i][k] * b[k][j];
                }
            }
        }
        c
    }

    fn identity_error(m: &[[f64; 3]; 3]) -> f64 {
        let mut err = 0.0_f64;
        for i in 0..3 {
            for j in 0..3 {
                let expected = if i == j { 1.0 } else { 0.0 };
                err = err.max((m[i][j] - expected).abs());
            }
        }
        err
    }

    #[test]
    fn m2_times_m2_inv_is_identity() {
        let product = matmul3(&M2, &M2_INV);
        assert!(
            identity_error(&product) < 5e-8,
            "M2 × M2_INV should be identity"
        );
    }

    #[test]
    fn m1_srgb_times_m1_inv_srgb_is_identity() {
        let product = matmul3(&M1_SRGB, &M1_INV_SRGB);
        assert!(
            identity_error(&product) < 5e-8,
            "M1[sRGB] × M1_INV[sRGB] should be identity"
        );
    }

    #[test]
    fn m1_white_point_mapping() {
        let gamuts: &[(&str, &[[f64; 3]; 3])] = &[
            ("sRGB", &M1_SRGB),
            ("Display P3", &M1_DISPLAY_P3),
            ("Adobe RGB", &M1_ADOBE_RGB),
            ("BT.2020", &M1_BT2020),
            ("ProPhoto RGB", &M1_PROPHOTO_RGB),
        ];
        for (name, m1) in gamuts {
            let w = matvec3(m1, [1.0, 1.0, 1.0]);
            let err = (w[0] - 1.0)
                .abs()
                .max((w[1] - 1.0).abs())
                .max((w[2] - 1.0).abs());
            assert!(
                err < 1e-8,
                "M1[{name}] × (1,1,1) should ≈ (1,1,1), err={err}"
            );
        }
    }

    #[test]
    fn m2_white_maps_to_l1_a0_b0() {
        let r = matvec3(&M2, [1.0, 1.0, 1.0]);
        assert!((r[0] - 1.0).abs() < 5e-8, "M2×(1,1,1) L should ≈ 1");
        assert!(r[1].abs() < 5e-8, "M2×(1,1,1) a should ≈ 0");
        assert!(r[2].abs() < 5e-8, "M2×(1,1,1) b should ≈ 0");
    }
}
