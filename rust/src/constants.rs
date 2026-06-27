/// Gamut identifiers for source color spaces.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gamut {
    Srgb,
    DisplayP3,
    AdobeRgb,
    Bt2020,
    ProPhotoRgb,
}

// ── v1 wire format ─────────────────────────────────────────────────────────
//
// chromahash ships as release 0.7.0, but the on-wire format carries its own
// generation number, independent of the package semver. This is wire-format
// generation **v1**. Every framing parameter below is a named constant so the
// encoder, decoder, and `spec/constants.py` agree without scattered literals.

/// Wire-format generation, stored in the 3-bit `version` field of byte 0.
///
/// `0` is format **v1** (this redesign; chromahash 0.7.x). Future incompatible
/// formats increment the field: `1` → v2, `2` → v3, `3` → v4, … A decoder MUST
/// reject any value it does not implement.
pub const FORMAT_VERSION: u8 = 0;

/// Width of the byte-0 `version` field (bits 0..3).
pub const VERSION_BITS: u32 = 3;
/// Width of the byte-0 `tier` field (bits 3..6).
pub const TIER_BITS: u32 = 3;
/// Bit position of the `hasAlpha` flag within byte 0.
pub const ALPHA_FLAG_BIT: u32 = 6;
/// Bit position of the reserved flag within byte 0 (MUST be 0 in v1).
pub const RESERVED_FLAG_BIT: u32 = 7;

/// Highest quality tier the v1 format defines. Tiers `0..=MAX_TIER` are valid;
/// `4..=7` are reserved and MUST be rejected by a v1 decoder.
pub const MAX_TIER: u8 = 3;

/// Natural render long-edge in pixels at tier 0. The natural render size scales
/// to `BASE_LONG_EDGE << tier` on the long edge (32 / 64 / 128 / 256 px).
pub const BASE_LONG_EDGE: u32 = 32;

/// DC code bit widths (L, a, b) — identical quantization to v0.6.
pub const L_DC_BITS: u32 = 7;
pub const A_DC_BITS: u32 = 7;
pub const B_DC_BITS: u32 = 7;
/// AC scale code bit widths (L, a, b).
pub const L_SCALE_BITS: u32 = 6;
pub const A_SCALE_BITS: u32 = 6;
pub const B_SCALE_BITS: u32 = 5;
/// Alpha DC / scale code bit widths (present only in alpha mode).
pub const ALPHA_DC_BITS: u32 = 5;
pub const ALPHA_SCALE_BITS: u32 = 4;

/// Byte 0 (descriptor) + byte 1 (aspect) = 16 bits.
pub const DESCRIPTOR_BITS: u32 = 16;
/// DC + scale prefix after the descriptor/aspect bytes
/// (L/a/b DC = 21 bits, L/a/b scale = 17 bits).
pub const DC_SCALE_BITS: u32 =
    L_DC_BITS + A_DC_BITS + B_DC_BITS + L_SCALE_BITS + A_SCALE_BITS + B_SCALE_BITS;
/// Fixed prefix before the AC payload: descriptor + aspect + DC + scales = 54 bits.
pub const PREFIX_BITS: u32 = DESCRIPTOR_BITS + DC_SCALE_BITS;
/// Extra prefix bits present only in alpha mode (alpha DC 5 + alpha scale 4).
pub const ALPHA_PREFIX_BITS: u32 = ALPHA_DC_BITS + ALPHA_SCALE_BITS;

/// AC bit layout: how the per-channel AC budget is split. Counts are the
/// **tier-0 base**; tier `m` scales every count by `4^m` (bits per coefficient
/// stay constant — higher tiers carry *more* coefficients, not finer ones).
///
/// L coefficients are written in selection order through up to two precision
/// tiers (a tier with count 0 is unused). Chroma a/b each get `c_count`
/// coefficients at `c_bits`. The `la_*`/`ca_*` fields are the alpha-mode
/// equivalents (alpha mode additionally stores alpha DC 5b + scale 4b + scaled
/// alpha AC). Trailing bits to the final byte boundary are padding zeros.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AcLayout {
    pub l_tiers: [(usize, u32); 2],
    pub c_count: usize,
    pub c_bits: u32,
    pub la_tiers: [(usize, u32); 2],
    pub ca_count: usize,
    pub ca_bits: u32,
}

/// Layout A: rebalance 15 bits from L to chroma (primary v0.6 candidate).
pub const LAYOUT_A: AcLayout = AcLayout {
    l_tiers: [(24, 5), (0, 5)],
    c_count: 11,
    c_bits: 4,
    la_tiers: [(19, 5), (0, 5)],
    ca_count: 10,
    ca_bits: 4,
};

/// Layout B: the **v1 tier-0 base** (the shipped default). Sized so a tier-0
/// hash is exactly 32 bytes — the v0.6 footprint — for equal-budget comparison:
/// no-alpha = 54 prefix + 26·5 L + 2·9·4 chroma = 256 bits; alpha = 54 + 9 +
/// 20·5 L + 2·9·4 chroma + 5·4 alpha = 255 bits (both → 32 bytes).
pub const LAYOUT_B: AcLayout = AcLayout {
    l_tiers: [(26, 5), (0, 5)],
    c_count: 9,
    c_bits: 4,
    la_tiers: [(20, 5), (0, 5)],
    ca_count: 9,
    ca_bits: 4,
};

/// Layout C: tiered L precision (6-bit low band) with widened chroma.
pub const LAYOUT_C: AcLayout = AcLayout {
    l_tiers: [(8, 6), (14, 5)],
    c_count: 11,
    c_bits: 4,
    la_tiers: [(6, 6), (12, 5)],
    ca_count: 10,
    ca_bits: 4,
};

/// Layout D: fewer but finer (5-bit) chroma coefficients.
pub const LAYOUT_D: AcLayout = AcLayout {
    l_tiers: [(23, 5), (0, 5)],
    c_count: 9,
    c_bits: 5,
    la_tiers: [(19, 5), (0, 5)],
    ca_count: 8,
    ca_bits: 5,
};

/// Number of alpha-channel AC coefficients at tier 0 (alpha mode only).
pub const ALPHA_AC_COUNT: usize = 5;
/// Bits per alpha AC coefficient.
pub const ALPHA_AC_BITS: u32 = 4;

/// Per-channel AC counts/bit-widths resolved for one (alpha mode, tier). The
/// base [`AcLayout`] describes tier 0; tier `m` scales every coefficient *count*
/// by `4^m` while bit widths stay fixed.
#[derive(Debug, Clone, Copy)]
pub(crate) struct AcShape {
    /// L coefficient precision tiers (count, bits), in write order.
    pub l_tiers: [(usize, u32); 2],
    /// Chroma a/b coefficient count (each channel) and bit width.
    pub c_count: usize,
    pub c_bits: u32,
    /// Alpha AC coefficient count (0 when not in alpha mode).
    pub alpha_ac_count: usize,
}

impl AcShape {
    /// Total L coefficient count across both precision tiers.
    pub fn l_count(&self) -> usize {
        self.l_tiers[0].0 + self.l_tiers[1].0
    }
}

/// `4^tier` — the count multiplier for a quality tier (1, 4, 16, 64).
#[inline]
pub(crate) fn tier_count_scale(tier: u8) -> usize {
    1usize << (2 * tier as usize)
}

/// Resolve the base [`AcLayout`] for a (alpha mode, tier): pick the alpha or
/// no-alpha base counts, then scale them by `4^tier`.
pub(crate) fn ac_shape(layout: &AcLayout, has_alpha: bool, tier: u8) -> AcShape {
    let s = tier_count_scale(tier);
    if has_alpha {
        AcShape {
            l_tiers: [
                (layout.la_tiers[0].0 * s, layout.la_tiers[0].1),
                (layout.la_tiers[1].0 * s, layout.la_tiers[1].1),
            ],
            c_count: layout.ca_count * s,
            c_bits: layout.ca_bits,
            alpha_ac_count: ALPHA_AC_COUNT * s,
        }
    } else {
        AcShape {
            l_tiers: [
                (layout.l_tiers[0].0 * s, layout.l_tiers[0].1),
                (layout.l_tiers[1].0 * s, layout.l_tiers[1].1),
            ],
            c_count: layout.c_count * s,
            c_bits: layout.c_bits,
            alpha_ac_count: 0,
        }
    }
}

/// AC payload bits for a resolved shape: L tiers + both chroma channels + alpha
/// AC. Excludes the prefix and the alpha DC/scale (see [`body_len_bytes`]).
pub(crate) fn ac_payload_bits(shape: &AcShape) -> usize {
    let l_bits: usize = shape.l_tiers.iter().map(|&(n, b)| n * b as usize).sum();
    l_bits
        + 2 * shape.c_count * shape.c_bits as usize
        + shape.alpha_ac_count * ALPHA_AC_BITS as usize
}

/// Total encoded length in bytes for a (layout, alpha mode, tier): the fixed
/// prefix (+ alpha DC/scale in alpha mode) plus the AC payload, rounded up to a
/// whole number of bytes. This is the deterministic length formula a decoder
/// recomputes to validate a hash.
pub(crate) fn body_len_bytes(layout: &AcLayout, has_alpha: bool, tier: u8) -> usize {
    let shape = ac_shape(layout, has_alpha, tier);
    let mut bits = PREFIX_BITS as usize + ac_payload_bits(&shape);
    if has_alpha {
        bits += ALPHA_PREFIX_BITS as usize;
    }
    bits.div_ceil(8)
}

/// All v0.6 format parameters. The shipped format uses [`Tunables::DEFAULT`];
/// the comparison harness can override these while sweeping the corpus to lock
/// the final constants, via the `CHROMAHASH_TUNE` env parser in the
/// `rust/examples/encode_stdin.rs` example binary.
///
/// NOTE: every field below is mirrored by a `key=value` knob in that example's
/// `tunables_from_env()`. When adding, removing, or renaming a field here, update
/// that parser in lockstep — an unhandled key aborts the whole sweep.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Tunables {
    pub layout: AcLayout,
    /// DC chroma quantization ranges. Sized to the union OKLab hull of the
    /// display-output gamuts (sRGB ∪ Display P3 ∪ Adobe RGB: max |a| ≈ 0.347,
    /// max |b| ≈ 0.321) so wide-gamut colors are stored faithfully for
    /// rendering to a P3/Adobe display (§5.1), not truncated to the sRGB hull.
    pub max_chroma_a: f64,
    pub max_chroma_b: f64,
    pub max_l_scale: f64,
    pub max_a_scale: f64,
    pub max_b_scale: f64,
    pub max_alpha_scale: f64,
    /// µ-law companding parameter per channel group.
    pub mu_l: f64,
    pub mu_c: f64,
    pub mu_alpha: f64,
    /// Decode-side synthesis window: w = w_min + (1−w_min)·hann(ρ)^w_exp.
    /// w_min = 1.0 disables the window.
    pub w_min_l: f64,
    pub w_exp_l: u32,
    pub w_min_c: f64,
    pub w_exp_c: u32,
    /// Encoder-only: search the ±1 neighborhood of the DC codes for the
    /// triple minimizing post-clip sRGB error (off only for ablation).
    pub dc_search: bool,
}

impl Tunables {
    /// v0.6 format constants, locked by the 2026-06 corpus sweep
    /// (tools/comparison, 52 images; see spec §12.1 once regenerated).
    ///
    /// Sweep conclusions: layout B (the v0.5 channel split) beats chroma-
    /// rebalanced layouts on natural images; chroma AC scale range 0.125
    /// (v0.5: 0.5) is the single largest quality win (the corpus maximum
    /// chroma scale is 0.113 — the old range wasted two bits); chroma DC
    /// ranges sized to the display-output gamut hull (sRGB ∪ P3 ∪ Adobe);
    /// µ_C=8 exploits the finer chroma
    /// scale near zero; out-of-gamut chroma is clipped per-channel at decode
    /// (relative-colorimetric, §12.6); the synthesis window is DISABLED (w_min=1.0) — with fine
    /// chroma scales it costs more detail than the banding it suppresses,
    /// and v0.5's visible striping turned out to be chroma quantization
    /// noise, not luma ringing.
    pub const DEFAULT: Tunables = Tunables {
        layout: LAYOUT_B,
        max_chroma_a: 0.35,
        max_chroma_b: 0.33,
        max_l_scale: 0.5,
        max_a_scale: 0.125,
        max_b_scale: 0.125,
        max_alpha_scale: 0.5,
        mu_l: 5.0,
        mu_c: 8.0,
        mu_alpha: 5.0,
        w_min_l: 1.0,
        w_exp_l: 1,
        w_min_c: 1.0,
        w_exp_c: 1,
        dc_search: true,
    };
}

impl Default for Tunables {
    fn default() -> Self {
        Self::DEFAULT
    }
}

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

/// M1_INV[Display P3]: LMS → Linear Display P3 (inverse of M1_DISPLAY_P3).
pub const M1_INV_DISPLAY_P3: [[f64; 3]; 3] = [
    [3.1277689869, -2.2571357957, 0.1293668089],
    [-1.0910090475, 2.4133317585, -0.3223227108],
    [-0.0260108130, -0.5080413260, 1.5340521389],
];

/// M1_INV[Adobe RGB]: LMS → Linear Adobe RGB (inverse of M1_ADOBE_RGB).
pub const M1_INV_ADOBE_RGB: [[f64; 3]; 3] = [
    [2.5540368478, -1.6219762024, 0.0679393544],
    [-1.2684380042, 2.6097574007, -0.3413193963],
    [-0.0562347471, -0.5670418342, 1.6232765812],
];

impl Gamut {
    /// Return the M1 matrix for this gamut (linear gamut RGB → LMS), used at
    /// encode to ingest any source gamut.
    pub(crate) fn m1_matrix(self) -> &'static [[f64; 3]; 3] {
        match self {
            Gamut::Srgb => &M1_SRGB,
            Gamut::DisplayP3 => &M1_DISPLAY_P3,
            Gamut::AdobeRgb => &M1_ADOBE_RGB,
            Gamut::Bt2020 => &M1_BT2020,
            Gamut::ProPhotoRgb => &M1_PROPHOTO_RGB,
        }
    }

    /// Return the inverse M1 matrix (LMS → linear gamut RGB) for rendering
    /// decode output **to** this gamut. Only sRGB / Display P3 / Adobe RGB are
    /// valid display-output gamuts; BT.2020 (HDR PQ, no clean SDR inverse) and
    /// ProPhoto (not a display gamut) fall back to sRGB output.
    pub(crate) fn m1_inv_matrix(self) -> &'static [[f64; 3]; 3] {
        match self {
            Gamut::DisplayP3 => &M1_INV_DISPLAY_P3,
            Gamut::AdobeRgb => &M1_INV_ADOBE_RGB,
            Gamut::Srgb | Gamut::Bt2020 | Gamut::ProPhotoRgb => &M1_INV_SRGB,
        }
    }

    /// Whether decode output to this gamut uses the Adobe RGB gamma (γ = 2.2).
    /// sRGB and Display P3 share the sRGB piecewise transfer; the sRGB fallback
    /// gamuts (BT.2020/ProPhoto) use sRGB too.
    pub(crate) fn output_uses_adobe_gamma(self) -> bool {
        matches!(self, Gamut::AdobeRgb)
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
    fn output_inverse_matrices_invert_their_m1() {
        // Each display-output gamut's M1_INV must be the inverse of its M1.
        for (name, m1, m1_inv) in [
            ("Display P3", &M1_DISPLAY_P3, &M1_INV_DISPLAY_P3),
            ("Adobe RGB", &M1_ADOBE_RGB, &M1_INV_ADOBE_RGB),
        ] {
            let product = matmul3(m1, m1_inv);
            assert!(
                identity_error(&product) < 5e-8,
                "M1[{name}] × M1_INV[{name}] should be identity"
            );
        }
    }

    #[test]
    fn output_gamut_selectors_resolve() {
        // sRGB / P3 / Adobe are real output gamuts; BT.2020 / ProPhoto fall back
        // to sRGB (no clean SDR display inverse).
        assert_eq!(*Gamut::Srgb.m1_inv_matrix(), M1_INV_SRGB);
        assert_eq!(*Gamut::DisplayP3.m1_inv_matrix(), M1_INV_DISPLAY_P3);
        assert_eq!(*Gamut::AdobeRgb.m1_inv_matrix(), M1_INV_ADOBE_RGB);
        assert_eq!(*Gamut::Bt2020.m1_inv_matrix(), M1_INV_SRGB);
        assert_eq!(*Gamut::ProPhotoRgb.m1_inv_matrix(), M1_INV_SRGB);
        assert!(Gamut::AdobeRgb.output_uses_adobe_gamma());
        assert!(!Gamut::DisplayP3.output_uses_adobe_gamma());
        assert!(!Gamut::Srgb.output_uses_adobe_gamma());
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
