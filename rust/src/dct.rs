use std::f64::consts::PI;

use crate::math_utils::portable_cos;

/// Compute the triangular scan order for an nx×ny grid, excluding DC.
/// Per spec §6.6: row-major, condition cx*ny < nx*(ny-cy), skip (0,0).
pub fn triangular_scan_order(nx: usize, ny: usize) -> Vec<(usize, usize)> {
    let mut order = Vec::new();
    for cy in 0..ny {
        let cx_start = if cy == 0 { 1 } else { 0 };
        let mut cx = cx_start;
        while cx * ny < nx * (ny - cy) {
            order.push((cx, cy));
            cx += 1;
        }
    }
    order
}

/// Forward DCT encode for a channel. Per spec §12.7 dctEncode.
/// Returns (dc, ac_coefficients, scale).
pub fn dct_encode(
    channel: &[f64],
    w: usize,
    h: usize,
    nx: usize,
    ny: usize,
) -> (f64, Vec<f64>, f64) {
    let wh = (w * h) as f64;
    let mut dc = 0.0;
    let mut ac = Vec::new();
    let mut scale = 0.0_f64;

    for cy in 0..ny {
        let mut cx = 0;
        while cx * ny < nx * (ny - cy) {
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
            if cx > 0 || cy > 0 {
                ac.push(f);
                scale = scale.max(f.abs());
            } else {
                dc = f;
            }
            cx += 1;
        }
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
        assert_eq!(triangular_scan_order(3, 3).len(), 5);
        assert_eq!(triangular_scan_order(4, 4).len(), 9);
        assert_eq!(triangular_scan_order(6, 6).len(), 20);
        assert_eq!(triangular_scan_order(7, 7).len(), 27);
    }

    #[test]
    fn scan_order_4x4() {
        let order = triangular_scan_order(4, 4);
        let expected = vec![
            (1, 0),
            (2, 0),
            (3, 0),
            (0, 1),
            (1, 1),
            (2, 1),
            (0, 2),
            (1, 2),
            (0, 3),
        ];
        assert_eq!(order, expected);
    }

    #[test]
    fn scan_order_3x3() {
        let order = triangular_scan_order(3, 3);
        let expected = vec![(1, 0), (2, 0), (0, 1), (1, 1), (0, 2)];
        assert_eq!(order, expected);
    }

    #[test]
    fn dc_of_constant_channel() {
        let w = 4;
        let h = 4;
        let val = 0.7;
        let channel = vec![val; w * h];
        let (dc, _, _) = dct_encode(&channel, w, h, 4, 4);
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
        let (_, ac, scale) = dct_encode(&channel, w, h, 4, 4);
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
        let nx = 4;
        let ny = 4;
        let (dc, ac, _) = dct_encode(&channel, w, h, nx, ny);
        let scan = triangular_scan_order(nx, ny);

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
        let nx = 7;
        let ny = 7;
        let (dc, ac, _) = dct_encode(&channel, w, h, nx, ny);
        let scan = triangular_scan_order(nx, ny);

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
