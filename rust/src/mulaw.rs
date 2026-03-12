use crate::constants::MU;
use crate::math_utils::round_half_away_from_zero;

/// µ-law compress: value in [-1, 1] → compressed in [-1, 1].
pub fn mu_compress(value: f64) -> f64 {
    let v = value.clamp(-1.0, 1.0);
    v.signum() * (1.0 + MU * v.abs()).ln() / (1.0 + MU).ln()
}

/// µ-law expand: compressed in [-1, 1] → value in [-1, 1].
pub fn mu_expand(compressed: f64) -> f64 {
    compressed.signum() * ((1.0 + MU).powf(compressed.abs()) - 1.0) / MU
}

/// Quantize a value in [-1, 1] using µ-law to an integer index.
/// Per spec §12.7 muLawQuantize.
pub fn mu_law_quantize(value: f64, bits: u32) -> u32 {
    let compressed = mu_compress(value);
    let max_val = (1u32 << bits) - 1;
    let index = round_half_away_from_zero((compressed + 1.0) / 2.0 * max_val as f64);
    (index as i64).clamp(0, max_val as i64) as u32
}

/// Dequantize an integer index back to a value in [-1, 1] using µ-law.
/// Per spec §12.7 muLawDequantize.
pub fn mu_law_dequantize(index: u32, bits: u32) -> f64 {
    let max_val = (1u32 << bits) - 1;
    let compressed = index as f64 / max_val as f64 * 2.0 - 1.0;
    mu_expand(compressed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_extremes() {
        for &v in &[-1.0, -0.5, 0.0, 0.5, 1.0] {
            let c = mu_compress(v);
            let rt = mu_expand(c);
            assert!(
                (rt - v).abs() < 1e-12,
                "µ-law roundtrip failed at v={v}: got {rt}"
            );
        }
    }

    #[test]
    fn compressed_range() {
        assert!((mu_compress(1.0) - 1.0).abs() < 1e-12);
        assert!((mu_compress(-1.0) + 1.0).abs() < 1e-12);
        assert!((mu_compress(0.0)).abs() < 1e-12);
    }

    #[test]
    fn quantize_dequantize_4bit() {
        // Midpoint should be near zero
        let mid = mu_law_quantize(0.0, 4);
        let max_val = (1u32 << 4) - 1; // 15
        // For 0.0, compressed = 0.0, index = round((0+1)/2 * 15) = round(7.5) = 8
        assert_eq!(mid, 8, "midpoint for 4-bit should be 8");

        // Extremes
        assert_eq!(mu_law_quantize(-1.0, 4), 0);
        assert_eq!(mu_law_quantize(1.0, 4), max_val);
    }

    #[test]
    fn quantize_dequantize_5bit() {
        let mid = mu_law_quantize(0.0, 5);
        let max_val = (1u32 << 5) - 1; // 31
        // index = round((0+1)/2 * 31) = round(15.5) = 16
        assert_eq!(mid, 16, "midpoint for 5-bit should be 16");

        assert_eq!(mu_law_quantize(-1.0, 5), 0);
        assert_eq!(mu_law_quantize(1.0, 5), max_val);
    }

    #[test]
    fn quantize_roundtrip_preserves_sign() {
        for bits in [4, 5, 6] {
            for &v in &[-0.9, -0.5, -0.1, 0.1, 0.5, 0.9] {
                let q = mu_law_quantize(v, bits);
                let dq = mu_law_dequantize(q, bits);
                // Should preserve sign
                if v > 0.0 {
                    assert!(dq >= 0.0, "sign should be preserved for v={v}");
                } else {
                    assert!(dq <= 0.0, "sign should be preserved for v={v}");
                }
            }
        }
    }
}
