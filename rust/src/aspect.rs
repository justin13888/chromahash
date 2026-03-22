use crate::math_utils::{portable_pow, round_half_away_from_zero};

/// Derive adaptive DCT grid (nx, ny) from aspect byte and base_n. Per spec §3.2.
/// All round() calls use round_half_away_from_zero. Uses portable_pow for determinism.
pub fn derive_grid(aspect_byte: u8, base_n: u32) -> (usize, usize) {
    let ratio = portable_pow(2.0, aspect_byte as f64 / 255.0 * 4.0 - 2.0);
    let base = base_n as f64;

    let (nx, ny) = if ratio >= 1.0 {
        let scale = ratio.min(4.0);
        let s = portable_pow(scale, 0.25);
        let nx = round_half_away_from_zero(base * s) as i64;
        let ny = round_half_away_from_zero(base / s) as i64;
        (nx, ny)
    } else {
        let scale = (1.0 / ratio).min(4.0);
        let s = portable_pow(scale, 0.25);
        let nx = round_half_away_from_zero(base / s) as i64;
        let ny = round_half_away_from_zero(base * s) as i64;
        (nx, ny)
    };

    (nx.max(3) as usize, ny.max(3) as usize)
}

/// Encode aspect ratio as a single byte. Per spec §8.1.
pub fn encode_aspect(w: u32, h: u32) -> u8 {
    let ratio = w as f64 / h as f64;
    let raw = (ratio.log2() + 2.0) / 4.0 * 255.0;
    let byte = round_half_away_from_zero(raw) as i64;
    byte.clamp(0, 255) as u8
}

/// Decode aspect ratio from byte. Per spec §8.1.
pub fn decode_aspect(byte: u8) -> f64 {
    2.0_f64.powf(byte as f64 / 255.0 * 4.0 - 2.0)
}

/// Decode output size from aspect byte. Longer side = 32px. Per spec §8.4.
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
        ];
        for &(w, h, label) in cases {
            let byte = encode_aspect(w as u32, h as u32);
            let decoded = decode_aspect(byte);
            let actual = w / h;
            let err = (decoded - actual).abs() / actual * 100.0;
            assert!(err < 0.55, "Aspect {label}: error={err:.3}% ≥ 0.55%");
        }
    }

    #[test]
    fn square_encodes_to_128() {
        let byte = encode_aspect(1, 1);
        assert_eq!(byte, 128);
    }

    #[test]
    fn extreme_4_1() {
        let byte = encode_aspect(4, 1);
        assert_eq!(byte, 255);
    }

    #[test]
    fn extreme_1_4() {
        let byte = encode_aspect(1, 4);
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
        // byte=0 → ratio=0.25 (1:4) → (5,10) for base_n=7
        let (nx, ny) = derive_grid(0, 7);
        assert_eq!((nx, ny), (5, 10), "byte=0 base_n=7 should give (5,10)");
    }

    #[test]
    fn derive_grid_landscape_extreme() {
        // byte=255 → ratio=4.0 (4:1) → (10,5) for base_n=7
        let (nx, ny) = derive_grid(255, 7);
        assert_eq!((nx, ny), (10, 5), "byte=255 base_n=7 should give (10,5)");
    }

    #[test]
    fn derive_grid_chroma_base4() {
        // byte=128 ≈ 1:1 → (4,4) for base_n=4
        let (nx, ny) = derive_grid(128, 4);
        assert_eq!((nx, ny), (4, 4), "square should give (4,4) for base_n=4");
        // byte=0 → (3,6) for base_n=4
        let (nx, ny) = derive_grid(0, 4);
        assert_eq!((nx, ny), (3, 6), "byte=0 base_n=4 should give (3,6)");
        // byte=255 → (6,3) for base_n=4
        let (nx, ny) = derive_grid(255, 4);
        assert_eq!((nx, ny), (6, 3), "byte=255 base_n=4 should give (6,3)");
    }

    #[test]
    fn derive_grid_alpha_base6() {
        // byte=0 → (4,8) for base_n=6
        let (nx, ny) = derive_grid(0, 6);
        assert_eq!((nx, ny), (4, 8), "byte=0 base_n=6 should give (4,8)");
        // byte=255 → (8,4) for base_n=6
        let (nx, ny) = derive_grid(255, 6);
        assert_eq!((nx, ny), (8, 4), "byte=255 base_n=6 should give (8,4)");
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
