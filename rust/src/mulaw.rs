use crate::math_utils::{portable_ln, portable_pow, round_half_away_from_zero};

/// µ-law compress: value in [-1, 1] → compressed in [-1, 1].
pub fn mu_compress(value: f64, mu: f64) -> f64 {
    let v = value.clamp(-1.0, 1.0);
    v.signum() * portable_ln(1.0 + mu * v.abs()) / portable_ln(1.0 + mu)
}

/// µ-law expand: compressed in [-1, 1] → value in [-1, 1].
pub fn mu_expand(compressed: f64, mu: f64) -> f64 {
    compressed.signum() * (portable_pow(1.0 + mu, compressed.abs()) - 1.0) / mu
}

/// Quantize a value in [-1, 1] using µ-law to an integer index. Per spec §7.3 (v0.6).
///
/// v0.6 uses an odd level count (2^bits − 1): indices 0..=2^bits−2 with the
/// center index representing exactly 0.0. The top code (2^bits − 1) is never
/// written. This removes the v0.5 zero bias (+0.0119·scale at 5 bits), so
/// zeroed coefficients — solid colors, frequency-clamped slots — decode exactly.
pub fn mu_law_quantize(value: f64, bits: u32, mu: f64) -> u32 {
    let max_idx = (1u32 << bits) - 2;
    let compressed = mu_compress(value, mu);
    let index = round_half_away_from_zero((compressed + 1.0) / 2.0 * max_idx as f64);
    (index as i64).clamp(0, max_idx as i64) as u32
}

/// Dequantize an integer index back to a value in [-1, 1] using µ-law.
/// Per spec §7.3 (v0.6). The never-written top code clamps down for robustness.
pub fn mu_law_dequantize(index: u32, bits: u32, mu: f64) -> f64 {
    let max_idx = (1u32 << bits) - 2;
    let index = index.min(max_idx);
    let compressed = index as f64 / max_idx as f64 * 2.0 - 1.0;
    mu_expand(compressed, mu)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MU: f64 = 5.0;

    #[test]
    fn roundtrip_extremes() {
        for &v in &[-1.0, -0.5, 0.0, 0.5, 1.0] {
            let c = mu_compress(v, MU);
            let rt = mu_expand(c, MU);
            assert!(
                (rt - v).abs() < 1e-12,
                "µ-law roundtrip failed at v={v}: got {rt}"
            );
        }
    }

    #[test]
    fn compressed_range() {
        assert!((mu_compress(1.0, MU) - 1.0).abs() < 1e-12);
        assert!((mu_compress(-1.0, MU) + 1.0).abs() < 1e-12);
        assert!((mu_compress(0.0, MU)).abs() < 1e-12);
    }

    #[test]
    fn zero_is_exact() {
        // The defining v0.6 property: 0.0 quantizes to the center index and
        // dequantizes back to exactly 0.0 at every bit width.
        for bits in [4u32, 5, 6] {
            let center = (1u32 << (bits - 1)) - 1;
            assert_eq!(mu_law_quantize(0.0, bits, MU), center, "bits={bits}");
            assert_eq!(mu_law_dequantize(center, bits, MU), 0.0, "bits={bits}");
        }
    }

    #[test]
    fn extremes_quantize_to_bounds() {
        for bits in [4u32, 5, 6] {
            let max_idx = (1u32 << bits) - 2;
            assert_eq!(mu_law_quantize(-1.0, bits, MU), 0);
            assert_eq!(mu_law_quantize(1.0, bits, MU), max_idx);
        }
    }

    #[test]
    fn top_code_clamps_on_dequantize() {
        // The never-written top code (2^bits − 1) must decode like 2^bits − 2.
        for bits in [4u32, 5, 6] {
            let top = (1u32 << bits) - 1;
            assert_eq!(
                mu_law_dequantize(top, bits, MU),
                mu_law_dequantize(top - 1, bits, MU)
            );
        }
    }

    #[test]
    fn quantize_roundtrip_preserves_sign() {
        for bits in [4u32, 5, 6] {
            for &v in &[-0.9, -0.5, -0.1, 0.1, 0.5, 0.9] {
                let q = mu_law_quantize(v, bits, MU);
                let dq = mu_law_dequantize(q, bits, MU);
                if v > 0.0 {
                    assert!(dq >= 0.0, "sign should be preserved for v={v}");
                } else {
                    assert!(dq <= 0.0, "sign should be preserved for v={v}");
                }
            }
        }
    }

    #[test]
    fn symmetric_codes() {
        // With an odd level count, +v and −v should land symmetrically
        // around the center code.
        for bits in [4u32, 5, 6] {
            let center = (1u32 << (bits - 1)) - 1;
            for &v in &[0.1, 0.3, 0.7] {
                let qp = mu_law_quantize(v, bits, MU);
                let qn = mu_law_quantize(-v, bits, MU);
                assert_eq!(
                    qp - center,
                    center - qn,
                    "codes for ±{v} not symmetric at bits={bits}"
                );
            }
        }
    }
}
