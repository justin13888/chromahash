use crate::constants::BASE_LONG_EDGE;
use crate::math_utils::{portable_ln, portable_pow, round_half_away_from_zero};

/// Encode aspect ratio as a single byte. Per spec §8.1 (v0.3).
pub fn encode_aspect(w: u32, h: u32) -> u8 {
    let ratio = w as f64 / h as f64;
    let raw = (portable_ln(ratio) / portable_ln(2.0) + 4.0) / 8.0 * 255.0;
    let byte = round_half_away_from_zero(raw) as i64;
    byte.clamp(0, 255) as u8
}

/// Decode aspect ratio from byte. Per spec §8.1 (v0.3).
pub fn decode_aspect(byte: u8) -> f64 {
    portable_pow(2.0, byte as f64 / 255.0 * 8.0 - 4.0)
}

/// Base (tier-0) output size from an aspect byte. Longer side = `BASE_LONG_EDGE`
/// (32 px), shorter side ≥ 2 across the whole aspect range. Per spec §8.2.
fn base_output_size(byte: u8) -> (u32, u32) {
    let edge = BASE_LONG_EDGE as f64;
    let ratio = decode_aspect(byte);
    if ratio > 1.0 {
        let h = round_half_away_from_zero(edge / ratio).max(1.0) as u32;
        (BASE_LONG_EDGE, h)
    } else {
        let w = round_half_away_from_zero(edge * ratio).max(1.0) as u32;
        (w, BASE_LONG_EDGE)
    }
}

/// Decode the natural output size for an aspect byte at a given quality `tier`.
/// The tier-0 size is scaled by a power of two — `(w << tier, h << tier)` — so
/// the long edge is `32 · 2^tier` (32 / 64 / 128 / 256 px). Per spec §8.2 (v1).
///
/// Scaling the *already-rounded* base size by a bit shift (rather than
/// re-rounding `32 · 2^tier / ratio`) is mandatory: the two disagree
/// (`round(64/3) = 21` vs `round(32/3) << 1 = 22`), and the encoder and decoder
/// MUST derive identical grids or the reconstruction desynchronizes.
pub fn decode_output_size(byte: u8, tier: u8) -> (u32, u32) {
    let (w, h) = base_output_size(byte);
    (w << tier, h << tier)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_ratios() {
        let cases: &[(f64, f64, &str)] = &[
            (1.0, 1.0, "1:1"),
            (3.0, 2.0, "3:2"),
            (4.0, 3.0, "4:3"),
            (16.0, 9.0, "16:9"),
            (4.0, 1.0, "4:1"),
            (1.0, 4.0, "1:4"),
            (16.0, 1.0, "16:1"),
            (1.0, 16.0, "1:16"),
        ];
        for &(w, h, label) in cases {
            let byte = encode_aspect(w as u32, h as u32);
            let decoded = decode_aspect(byte);
            let actual = w / h;
            let err = (decoded - actual).abs() / actual * 100.0;
            assert!(err < 1.1, "Aspect {label}: error={err:.3}% ≥ 1.1%");
        }
    }

    #[test]
    fn square_encodes_to_128() {
        let byte = encode_aspect(1, 1);
        assert_eq!(byte, 128);
    }

    #[test]
    fn extreme_4_1() {
        // 4:1 no longer maps to 255 — that's reserved for 16:1 in v0.3
        let byte = encode_aspect(4, 1);
        assert_eq!(byte, 191);
    }

    #[test]
    fn extreme_1_4() {
        // 1:4 no longer maps to 0 — that's reserved for 1:16 in v0.3
        let byte = encode_aspect(1, 4);
        assert_eq!(byte, 64);
    }

    #[test]
    fn extreme_16_1() {
        let byte = encode_aspect(16, 1);
        assert_eq!(byte, 255);
    }

    #[test]
    fn extreme_1_16() {
        let byte = encode_aspect(1, 16);
        assert_eq!(byte, 0);
    }

    #[test]
    fn decode_output_size_square() {
        let (w, h) = decode_output_size(128, 0);
        assert!(w <= 32 && h <= 32);
    }

    #[test]
    fn decode_output_size_min_dims() {
        // The short side never collapses below 2 px — the selection domain
        // (§6.2) relies on (W, H) ≥ (2, 2) to offer ≥ 63 candidates at tier 0.
        for byte in 0u8..=255 {
            let (w, h) = decode_output_size(byte, 0);
            assert!(w >= 2 && h >= 2, "byte={byte} gave {w}x{h}");
            assert!(w.max(h) == 32, "long side must be 32 for byte={byte}");
        }
    }

    #[test]
    fn decode_output_size_landscape() {
        let byte = encode_aspect(2, 1);
        let (w, h) = decode_output_size(byte, 0);
        assert_eq!(w, 32);
        assert!(h < 32);
    }

    #[test]
    fn decode_output_size_portrait() {
        let byte = encode_aspect(1, 2);
        let (w, h) = decode_output_size(byte, 0);
        assert!(w < 32);
        assert_eq!(h, 32);
    }

    #[test]
    fn decode_output_size_tier_is_base_bit_shifted() {
        // Each tier doubles both dimensions: the natural long edge is 32·2^tier.
        // Scaling must be a bit shift of the rounded base size, NOT a re-rounded
        // 32·2^tier/ratio — those disagree for non-power-of-two ratios.
        for byte in [0u8, 64, 100, 128, 159, 191, 255] {
            let (bw, bh) = decode_output_size(byte, 0);
            for tier in 0u8..=3 {
                let (w, h) = decode_output_size(byte, tier);
                assert_eq!((w, h), (bw << tier, bh << tier), "byte={byte} tier={tier}");
                assert_eq!(w.max(h), 32u32 << tier, "long side must be 32·2^tier");
                assert!(w >= 2 << tier && h >= 2 << tier);
            }
        }
    }
}
