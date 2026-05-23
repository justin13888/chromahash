use std::f64::consts::PI;

use crate::aspect::decode_output_size;
use crate::math_utils::portable_cos;

/// Compute the AC coefficient scan order for an nx×ny grid keyed on aspect_byte.
/// Per spec §6.2 (v0.4): coefficients are sorted ascending by per-pixel frequency priority
/// `(cx*h)² + (cy*w)²` where (w,h) = decodeOutputSize(aspect_byte). Ties broken by (cx, cy).
/// Excludes DC at (0,0).
pub fn scan_order(nx: usize, ny: usize, aspect_byte: u8) -> Vec<(usize, usize)> {
    let (w, h) = decode_output_size(aspect_byte);
    let w = w as u64;
    let h = h as u64;

    let mut entries: Vec<(u64, usize, usize)> = Vec::new();
    for cy in 0..ny {
        let cx_start = if cy == 0 { 1 } else { 0 };
        let mut cx = cx_start;
        while cx * ny < nx * (ny - cy) {
            let priority = (cx as u64 * h) * (cx as u64 * h) + (cy as u64 * w) * (cy as u64 * w);
            entries.push((priority, cx, cy));
            cx += 1;
        }
    }
    entries.sort_unstable_by_key(|&(p, cx, cy)| (p, cx, cy));
    entries.into_iter().map(|(_, cx, cy)| (cx, cy)).collect()
}

/// Forward DCT encode for a channel. Per spec §12.6 dctEncode (v0.4).
/// Returns (dc, ac_coefficients, scale). AC values are emitted in `scan` order.
/// Superseded by dct_encode_separable for production use; retained for test verification.
#[allow(dead_code)]
pub fn dct_encode(
    channel: &[f64],
    w: usize,
    h: usize,
    scan: &[(usize, usize)],
) -> (f64, Vec<f64>, f64) {
    let wh = (w * h) as f64;

    // DC = mean (cos(0) = 1 for all positions)
    let dc: f64 = channel.iter().sum::<f64>() / wh;

    let mut ac = Vec::with_capacity(scan.len());
    let mut scale = 0.0_f64;

    for &(cx, cy) in scan {
        let mut f = 0.0;
        for y in 0..h {
            let fy = portable_cos(PI / h as f64 * cy as f64 * (y as f64 + 0.5));
            for x in 0..w {
                f += channel[x + y * w]
                    * portable_cos(PI / w as f64 * cx as f64 * (x as f64 + 0.5))
                    * fy;
            }
        }
        f /= wh;
        ac.push(f);
        scale = scale.max(f.abs());
    }

    // Floor near-zero scale to exactly zero. When the channel is (near-)constant,
    // floating-point noise in cosine sums produces tiny AC values. Without this
    // threshold, dividing AC/scale amplifies platform-specific ULP differences
    // (e.g. different cbrt implementations) into divergent quantized codes.
    if scale < 1e-10 {
        ac.fill(0.0);
        scale = 0.0;
    }

    (dc, ac, scale)
}

/// Precompute cosine table for DCT: table[freq][pos] = cos(π/dim · freq · (pos+0.5)).
/// Per spec §12.6. Uses portable_cos for cross-platform determinism.
pub fn precompute_cos_table(dim: usize, max_freq: usize) -> Vec<Vec<f64>> {
    let mut table = Vec::with_capacity(max_freq);
    for freq in 0..max_freq {
        let mut row = Vec::with_capacity(dim);
        for pos in 0..dim {
            row.push(portable_cos(
                PI / dim as f64 * freq as f64 * (pos as f64 + 0.5),
            ));
        }
        table.push(row);
    }
    table
}

/// Forward DCT encode using precomputed cosine tables. Per spec §12.6 (v0.4).
/// Semantically identical to dct_encode but avoids redundant cosine evaluations.
/// AC values are emitted in `scan` order; cos_x/cos_y must have entries for all (cx,cy) in scan.
pub fn dct_encode_separable(
    channel: &[f64],
    w: usize,
    h: usize,
    scan: &[(usize, usize)],
    cos_x: &[Vec<f64>],
    cos_y: &[Vec<f64>],
) -> (f64, Vec<f64>, f64) {
    let wh = (w * h) as f64;

    // DC = mean (cos_x[0] and cos_y[0] are all-ones by construction)
    let dc: f64 = channel.iter().sum::<f64>() / wh;

    let mut ac = Vec::with_capacity(scan.len());
    let mut scale = 0.0_f64;

    for &(cx, cy) in scan {
        let cy_row = &cos_y[cy];
        let cx_row = &cos_x[cx];
        let mut f = 0.0;
        for y in 0..h {
            let fy = cy_row[y];
            for x in 0..w {
                f += channel[x + y * w] * cx_row[x] * fy;
            }
        }
        f /= wh;
        ac.push(f);
        scale = scale.max(f.abs());
    }

    if scale < 1e-10 {
        ac.fill(0.0);
        scale = 0.0;
    }

    (dc, ac, scale)
}

/// Inverse DCT at a single pixel (x, y) for a channel.
pub fn dct_decode_pixel(
    dc: f64,
    ac: &[f64],
    scan_order: &[(usize, usize)],
    x: usize,
    y: usize,
    w: usize,
    h: usize,
) -> f64 {
    let mut value = dc;
    for (j, &(cx, cy)) in scan_order.iter().enumerate() {
        let cx_factor = if cx > 0 { 2.0 } else { 1.0 };
        let cy_factor = if cy > 0 { 2.0 } else { 1.0 };
        let fx = portable_cos(PI / w as f64 * cx as f64 * (x as f64 + 0.5));
        let fy = portable_cos(PI / h as f64 * cy as f64 * (y as f64 + 0.5));
        value += ac[j] * fx * fy * cx_factor * cy_factor;
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_order_counts() {
        // AC count depends only on (nx, ny), not on aspect_byte. Use byte=128 (square).
        assert_eq!(scan_order(3, 3, 128).len(), 5);
        assert_eq!(scan_order(4, 4, 128).len(), 9);
        assert_eq!(scan_order(6, 6, 128).len(), 20);
        assert_eq!(scan_order(7, 7, 128).len(), 27);
    }

    #[test]
    fn scan_order_4x4_square_is_radial() {
        // aspect_byte=128 → w=32, h=32 (square). Priorities ∝ cx²+cy².
        // Tied priorities broken by cx first.
        let order = scan_order(4, 4, 128);
        let expected = vec![
            (0, 1), // priority 1024
            (1, 0), // priority 1024
            (1, 1), // priority 2048
            (0, 2), // priority 4096
            (2, 0), // priority 4096
            (1, 2), // priority 5120
            (2, 1), // priority 5120
            (0, 3), // priority 9216
            (3, 0), // priority 9216
        ];
        assert_eq!(
            order, expected,
            "4×4 square should produce radial scan order"
        );
    }

    #[test]
    fn scan_order_3x3_square_is_radial() {
        let order = scan_order(3, 3, 128);
        let expected = vec![
            (0, 1), // priority 1024
            (1, 0), // priority 1024
            (1, 1), // priority 2048
            (0, 2), // priority 4096
            (2, 0), // priority 4096
        ];
        assert_eq!(
            order, expected,
            "3×3 square should produce radial scan order"
        );
    }

    #[test]
    fn scan_order_extreme_landscape_is_rowmajor() {
        // byte=255 → ratio=16 → w=32, h=2 for decode_output_size.
        // 14×4 grid: priority = (cx*2)² + (cy*32)² = 4cx² + 1024cy².
        // All cy=0 entries (max 4*13²=676) < all cy=1 entries (min 1024). Row-major preserved.
        let order = scan_order(14, 4, 255);
        assert_eq!(order.len(), 35, "14×4 should have 35 AC coefficients");
        // Verify all cy=0 entries appear before any cy>=1 entry
        let first_nonzero_cy = order.iter().position(|&(_, cy)| cy > 0).unwrap();
        let last_zero_cy = order.iter().rposition(|&(_, cy)| cy == 0).unwrap();
        assert!(
            first_nonzero_cy > last_zero_cy,
            "all cy=0 entries should precede cy>0 entries for extreme landscape"
        );
    }

    #[test]
    fn dc_of_constant_channel() {
        let w = 4;
        let h = 4;
        let val = 0.7;
        let channel = vec![val; w * h];
        let scan = scan_order(4, 4, 128);
        let (dc, _, _) = dct_encode(&channel, w, h, &scan);
        assert!(
            (dc - val).abs() < 1e-12,
            "DC of constant channel should = {val}, got {dc}"
        );
    }

    #[test]
    fn ac_of_constant_channel_is_zero() {
        let w = 4;
        let h = 4;
        let channel = vec![0.5; w * h];
        let scan = scan_order(4, 4, 128);
        let (_, ac, scale) = dct_encode(&channel, w, h, &scan);
        assert!(scale < 1e-12, "AC of constant channel should be 0");
        for (i, &v) in ac.iter().enumerate() {
            assert!(v.abs() < 1e-12, "AC[{i}] should be 0, got {v}");
        }
    }

    #[test]
    fn encode_decode_roundtrip_constant() {
        // Constant channel: perfectly reconstructed by DC alone
        let w = 8;
        let h = 8;
        let val = 0.42;
        let channel = vec![val; w * h];
        let scan = scan_order(4, 4, 128);
        let (dc, ac, _) = dct_encode(&channel, w, h, &scan);

        for y in 0..h {
            for x in 0..w {
                let reconstructed = dct_decode_pixel(dc, &ac, &scan, x, y, w, h);
                assert!(
                    (reconstructed - val).abs() < 1e-10,
                    "constant roundtrip failed at ({x},{y}): got {reconstructed}"
                );
            }
        }
    }

    #[test]
    fn separable_matches_dct_encode() {
        // dct_encode_separable must produce bit-identical output to dct_encode
        let w = 8;
        let h = 6;
        let mut channel = vec![0.0; w * h];
        for y in 0..h {
            for x in 0..w {
                channel[x + y * w] = (x as f64 * 0.13 + y as f64 * 0.07).sin();
            }
        }
        let nx = 5;
        let ny = 4;
        let scan = scan_order(nx, ny, 128);
        let cos_x = precompute_cos_table(w, nx);
        let cos_y = precompute_cos_table(h, ny);
        let (dc1, ac1, s1) = dct_encode(&channel, w, h, &scan);
        let (dc2, ac2, s2) = dct_encode_separable(&channel, w, h, &scan, &cos_x, &cos_y);
        assert_eq!(dc1, dc2, "DC must be bit-identical");
        assert_eq!(s1, s2, "scale must be bit-identical");
        assert_eq!(ac1.len(), ac2.len(), "AC count must match");
        for (i, (v1, v2)) in ac1.iter().zip(ac2.iter()).enumerate() {
            assert_eq!(v1, v2, "AC[{i}] must be bit-identical");
        }
    }

    #[test]
    fn encode_decode_gradient_reasonable() {
        // Gradient: triangular DCT is lossy, but should be close
        let w = 8;
        let h = 8;
        let mut channel = vec![0.0; w * h];
        for y in 0..h {
            for x in 0..w {
                channel[x + y * w] = (x as f64 / w as f64 + y as f64 / h as f64) / 2.0;
            }
        }
        let scan = scan_order(7, 7, 128);
        let (dc, ac, _) = dct_encode(&channel, w, h, &scan);

        let mut max_err = 0.0_f64;
        for y in 0..h {
            for x in 0..w {
                let reconstructed = dct_decode_pixel(dc, &ac, &scan, x, y, w, h);
                let original = channel[x + y * w];
                max_err = max_err.max((reconstructed - original).abs());
            }
        }
        // Triangular DCT is lossy but should be close for smooth gradients
        assert!(
            max_err < 0.02,
            "gradient reconstruction max error too large: {max_err}"
        );
    }
}
