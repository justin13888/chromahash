use crate::math_utils::{portable_ln, portable_pow, round_half_away_from_zero};

/// Derive adaptive DCT grid (nx, ny) from aspect byte and base_n. Per spec §6.3.
/// All round() calls use round_half_away_from_zero. Uses portable_pow for determinism.
pub fn derive_grid(aspect_byte: u8, base_n: u32) -> (usize, usize) {
    let ratio = portable_pow(2.0, aspect_byte as f64 / 255.0 * 8.0 - 4.0);
    let base = base_n as f64;

    let (nx, ny) = if ratio >= 1.0 {
        let scale = ratio.min(16.0);
        let s = portable_pow(scale, 0.25);
        let nx = round_half_away_from_zero(base * s) as i64;
        let ny = round_half_away_from_zero(base / s) as i64;
        (nx, ny)
    } else {
        let scale = (1.0 / ratio).min(16.0);
        let s = portable_pow(scale, 0.25);
        let nx = round_half_away_from_zero(base / s) as i64;
        let ny = round_half_away_from_zero(base * s) as i64;
        (nx, ny)
    };

    (nx.max(3) as usize, ny.max(3) as usize)
}

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

/// Decode output size from aspect byte. Longer side = 32px. Per spec §8.2.
pub fn decode_output_size(byte: u8) -> (u32, u32) {
    let ratio = decode_aspect(byte);
    if ratio > 1.0 {
        let h = round_half_away_from_zero(32.0 / ratio).max(1.0) as u32;
        (32, h)
    } else {
        let w = round_half_away_from_zero(32.0 * ratio).max(1.0) as u32;
        (w, 32)
    }
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
        let (w, h) = decode_output_size(128);
        assert!(w <= 32 && h <= 32);
    }

    #[test]
    fn derive_grid_square() {
        // byte=128 ≈ 1:1 ratio → (7,7) for base_n=7
        let (nx, ny) = derive_grid(128, 7);
        assert_eq!((nx, ny), (7, 7), "square should give (7,7) for base_n=7");
    }

    #[test]
    fn derive_grid_portrait_extreme() {
        // byte=0 → ratio=1/16 (1:16) → scale=16, s=2 → (4,14) for base_n=7
        let (nx, ny) = derive_grid(0, 7);
        assert_eq!((nx, ny), (4, 14), "byte=0 base_n=7 should give (4,14)");
    }

    #[test]
    fn derive_grid_landscape_extreme() {
        // byte=255 → ratio=16 (16:1) → scale=16, s=2 → (14,4) for base_n=7
        let (nx, ny) = derive_grid(255, 7);
        assert_eq!((nx, ny), (14, 4), "byte=255 base_n=7 should give (14,4)");
    }

    #[test]
    fn derive_grid_chroma_base4() {
        // byte=128 ≈ 1:1 → (4,4) for base_n=4
        let (nx, ny) = derive_grid(128, 4);
        assert_eq!((nx, ny), (4, 4), "square should give (4,4) for base_n=4");
        // byte=0 → ratio=1/16, scale=16, s=2 → nx=round(4/2)=2→3, ny=round(4*2)=8 → (3,8)
        let (nx, ny) = derive_grid(0, 4);
        assert_eq!((nx, ny), (3, 8), "byte=0 base_n=4 should give (3,8)");
        // byte=255 → ratio=16, scale=16, s=2 → nx=round(4*2)=8, ny=round(4/2)=2→3 → (8,3)
        let (nx, ny) = derive_grid(255, 4);
        assert_eq!((nx, ny), (8, 3), "byte=255 base_n=4 should give (8,3)");
    }

    #[test]
    fn derive_grid_alpha_base6() {
        // byte=0 → ratio=1/16, scale=16, s=2 → nx=round(6/2)=3, ny=round(6*2)=12 → (3,12)
        let (nx, ny) = derive_grid(0, 6);
        assert_eq!((nx, ny), (3, 12), "byte=0 base_n=6 should give (3,12)");
        // byte=255 → ratio=16, scale=16, s=2 → nx=round(6*2)=12, ny=round(6/2)=3 → (12,3)
        let (nx, ny) = derive_grid(255, 6);
        assert_eq!((nx, ny), (12, 3), "byte=255 base_n=6 should give (12,3)");
    }

    #[test]
    fn derive_grid_min_floor() {
        // All results should be >= 3
        for byte in 0u8..=255 {
            for &base_n in &[3u32, 4, 6, 7] {
                let (nx, ny) = derive_grid(byte, base_n);
                assert!(nx >= 3, "nx={nx} < 3 for byte={byte} base_n={base_n}");
                assert!(ny >= 3, "ny={ny} < 3 for byte={byte} base_n={base_n}");
            }
        }
    }

    #[test]
    fn decode_output_size_landscape() {
        let byte = encode_aspect(2, 1);
        let (w, h) = decode_output_size(byte);
        assert_eq!(w, 32);
        assert!(h < 32);
    }

    #[test]
    fn decode_output_size_portrait() {
        let byte = encode_aspect(1, 2);
        let (w, h) = decode_output_size(byte);
        assert!(w < 32);
        assert_eq!(h, 32);
    }
}
