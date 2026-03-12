use crate::math_utils::round_half_away_from_zero;

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
