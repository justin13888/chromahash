use std::f64::consts::PI;

use crate::aspect::decode_output_size;
use crate::math_utils::portable_cos;

/// The AC coefficients selected for one channel, in transmission order.
/// Per spec §6 (v0.6).
pub struct Selection {
    /// Selected (cx, cy) frequency pairs, ascending by priority.
    pub coeffs: Vec<(usize, usize)>,
    /// Integer priority of each selected pair: (cx·H)² + (cy·W)².
    pub priorities: Vec<u64>,
    /// Priority of the last (highest-frequency) selected pair.
    pub p_k: u64,
}

/// Select the K lowest-spatial-frequency AC coefficients for an aspect byte at
/// a given quality `tier`. Per spec §6.1 (v1).
///
/// Candidates are all (cx, cy) in [0, W) × [0, H) except DC, where (W, H) =
/// decodeOutputSize(aspect_byte, tier) — exactly the frequencies representable
/// at the natural render, which makes selecting an unrepresentable (aliasing)
/// frequency structurally impossible. Priority (cx·H)² + (cy·W)² is the
/// squared isotropic per-pixel frequency scaled by (W·H)²; ties break by
/// (cx, cy) ascending. Pure integer ordering ⇒ bit-exact across languages.
///
/// The candidate count is ≥ 64·4^tier − 1 for every aspect byte (the 16:1
/// extreme), and every per-channel K(tier) the format uses is < that bound, so
/// the selection is always fully satisfied.
pub fn select_coefficients(aspect_byte: u8, tier: u8, k: usize) -> Selection {
    let (w, h) = decode_output_size(aspect_byte, tier);
    let (w, h) = (w as usize, h as usize);
    let mut entries = candidate_entries(w, h);
    entries.sort_unstable_by_key(|&(p, cx, cy)| (p, cx, cy));
    build_selection(entries, k)
}

/// [`select_coefficients`] with an anisotropic (CSF oblique-effect) weight —
/// sweep-only. Human contrast sensitivity is lower for diagonal frequencies,
/// so candidates sort by `priority · (1 + aniso · sin²2θ)` (sin²2θ = 0 on the
/// axes, 1 on the diagonal), spending the budget on axis-aligned detail first.
///
/// `aniso = 0.0` takes the shipped pure-integer path bit-exactly. The weighted
/// order compares f64 keys (`total_cmp`), which is fine for a doc-hidden
/// experiment but would need an integer reformulation before entering the
/// spec. `priorities`/`p_k` always report the unweighted integer priorities.
pub fn select_coefficients_weighted(aspect_byte: u8, tier: u8, k: usize, aniso: f64) -> Selection {
    if aniso == 0.0 {
        return select_coefficients(aspect_byte, tier, k);
    }
    let (w, h) = decode_output_size(aspect_byte, tier);
    let (w, h) = (w as usize, h as usize);
    let mut entries = candidate_entries(w, h);
    entries.sort_unstable_by(|&(pa, cxa, cya), &(pb, cxb, cyb)| {
        let key = |p: u64, cx: usize, cy: usize| -> f64 {
            let px = (cx * h) as f64;
            let py = (cy * w) as f64;
            // sin²2θ = (2·px·py)² / (px²+py²)²; p = px²+py².
            let sin2_2theta = (2.0 * px * py) * (2.0 * px * py) / (p as f64 * p as f64);
            p as f64 * (1.0 + aniso * sin2_2theta)
        };
        key(pa, cxa, cya)
            .total_cmp(&key(pb, cxb, cyb))
            .then_with(|| (cxa, cya).cmp(&(cxb, cyb)))
    });
    build_selection(entries, k)
}

/// Every non-DC (priority, cx, cy) candidate on the natural render grid.
fn candidate_entries(w: usize, h: usize) -> Vec<(u64, usize, usize)> {
    let mut entries: Vec<(u64, usize, usize)> = Vec::with_capacity(w * h - 1);
    for cy in 0..h {
        for cx in 0..w {
            if cx == 0 && cy == 0 {
                continue;
            }
            let px = (cx * h) as u64;
            let py = (cy * w) as u64;
            entries.push((px * px + py * py, cx, cy));
        }
    }
    entries
}

/// Truncate sorted candidates to K and package them as a [`Selection`].
fn build_selection(mut entries: Vec<(u64, usize, usize)>, k: usize) -> Selection {
    entries.truncate(k);
    let p_k = entries.last().map(|&(p, _, _)| p).unwrap_or(1);
    Selection {
        coeffs: entries.iter().map(|&(_, cx, cy)| (cx, cy)).collect(),
        priorities: entries.iter().map(|&(p, _, _)| p).collect(),
        p_k,
    }
}

/// Decode-side synthesis window weights for a selection. Per spec §11 (v0.6).
///
/// w_j = w_min + (1 − w_min) · ((1 + cos(π·ρ_j)) / 2)^w_exp with
/// ρ_j = sqrt(priority_j / P_K) ∈ (0, 1]. Tapering high-frequency amplitudes
/// suppresses the Gibbs ringing/banding that sparse unwindowed cosines
/// produce — and because it is applied after dequantization, it attenuates
/// quantization noise by the same factor. w_min = 1.0 disables the window.
/// Portable: integer priorities, IEEE-correctly-rounded sqrt, portable_cos,
/// and an integer exponent evaluated as repeated multiplication.
pub fn window_weights(selection: &Selection, w_min: f64, w_exp: u32) -> Vec<f64> {
    selection
        .priorities
        .iter()
        .map(|&p| {
            if w_min >= 1.0 {
                return 1.0;
            }
            let rho = (p as f64 / selection.p_k as f64).sqrt();
            let hann = (1.0 + portable_cos(PI * rho)) / 2.0;
            let mut powed = 1.0;
            for _ in 0..w_exp {
                powed *= hann;
            }
            w_min + (1.0 - w_min) * powed
        })
        .collect()
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

/// Forward DCT over the selected coefficients. Per spec §10 (v0.6).
/// Returns (dc, ac_in_selection_order, scale).
///
/// Frequency clamp: a selected (cx, cy) with cx ≥ w or cy ≥ h cannot be
/// represented by the w×h source samples — the basis is not orthogonal there
/// and the projection degenerates (e.g. F(2, cy) ≈ −DC on a 1-px-wide image,
/// the v0.5 dim-1xN catastrophe). Such coefficients are emitted as exact 0
/// and excluded from the scale max.
pub fn dct_encode_selected(
    channel: &[f64],
    w: usize,
    h: usize,
    coeffs: &[(usize, usize)],
    cos_x: &[Vec<f64>],
    cos_y: &[Vec<f64>],
) -> (f64, Vec<f64>, f64) {
    let wh = (w * h) as f64;

    // DC = mean (cos_x[0] and cos_y[0] are all-ones by construction)
    let dc: f64 = channel.iter().sum::<f64>() / wh;

    let mut ac = Vec::with_capacity(coeffs.len());
    let mut scale = 0.0_f64;

    for &(cx, cy) in coeffs {
        if cx >= w || cy >= h {
            ac.push(0.0);
            continue;
        }
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

    // Floor near-zero scale to exactly zero. When the channel is (near-)constant,
    // floating-point noise in cosine sums produces tiny AC values. Without this
    // threshold, dividing AC/scale amplifies platform-specific ULP differences
    // into divergent quantized codes.
    if scale < 1e-10 {
        ac.fill(0.0);
        scale = 0.0;
    }

    (dc, ac, scale)
}

/// Inverse DCT at a single pixel using precomputed cosine tables. Per spec §12.6.
/// The cx/cy factors stay as separate multiplies to preserve the exact
/// floating-point operation order. cos_x/cos_y must cover all (cx, cy) in scan.
pub fn dct_decode_pixel_separable(
    dc: f64,
    ac: &[f64],
    scan: &[(usize, usize)],
    x: usize,
    y: usize,
    cos_x: &[Vec<f64>],
    cos_y: &[Vec<f64>],
) -> f64 {
    let mut value = dc;
    for (j, &(cx, cy)) in scan.iter().enumerate() {
        let cx_factor = if cx > 0 { 2.0 } else { 1.0 };
        let cy_factor = if cy > 0 { 2.0 } else { 1.0 };
        let fx = cos_x[cx][x];
        let fy = cos_y[cy][y];
        value += ac[j] * fx * fy * cx_factor * cy_factor;
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_counts() {
        for byte in [0u8, 64, 128, 191, 255] {
            for k in [5usize, 9, 11, 24, 27] {
                let sel = select_coefficients(byte, 0, k);
                assert_eq!(sel.coeffs.len(), k, "byte={byte} k={k}");
                assert_eq!(sel.priorities.len(), k);
            }
        }
    }

    #[test]
    fn weighted_selection_zero_matches_integer_path() {
        // aniso = 0.0 must be the shipped selection, coefficient for coefficient.
        for byte in [0u8, 64, 128, 191, 255] {
            for tier in [0u8, 1] {
                let base = select_coefficients(byte, tier, 26);
                let weighted = select_coefficients_weighted(byte, tier, 26, 0.0);
                assert_eq!(base.coeffs, weighted.coeffs, "byte={byte} tier={tier}");
                assert_eq!(base.priorities, weighted.priorities);
                assert_eq!(base.p_k, weighted.p_k);
            }
        }
    }

    #[test]
    fn weighted_selection_penalizes_diagonals() {
        // Square grid: (1,1) has priority 2·32² = 2048 and sin²2θ = 1, while
        // (2,0)/(0,2) have priority 4096 and sin²2θ = 0. With aniso = 1.5 the
        // diagonal's weighted key (5120) exceeds the axis pair's (4096), so the
        // axis frequencies must now be selected first.
        let sel = select_coefficients_weighted(128, 0, 4, 1.5);
        let first_four = &sel.coeffs[..4];
        assert!(first_four.contains(&(2, 0)), "got {first_four:?}");
        assert!(first_four.contains(&(0, 2)), "got {first_four:?}");
        assert!(!first_four.contains(&(1, 1)), "got {first_four:?}");
        // The unweighted order keeps (1,1) ahead of (2,0).
        let base = select_coefficients(128, 0, 4);
        assert!(base.coeffs[..3].contains(&(1, 1)));
    }

    #[test]
    fn selection_scales_with_tier() {
        // Priority (cx·H)² + (cy·W)² scales uniformly by 4^tier when the grid
        // doubles, so the *same* K returns the *same* low frequencies at any
        // tier. The higher tier's larger grid is what lets K itself scale by
        // 4^tier and reach genuinely higher frequencies — always satisfiable.
        assert_eq!(
            select_coefficients(128, 0, 26).coeffs,
            select_coefficients(128, 2, 26).coeffs,
            "same K ⇒ same low frequencies across tiers"
        );
        for tier in 0u8..=3 {
            let k = 26usize << (2 * tier as usize); // 26·4^tier
            assert_eq!(
                select_coefficients(255, tier, k).coeffs.len(),
                k,
                "K(tier) must be fully satisfied even at 16:1, tier={tier}"
            );
        }
        let max0 = select_coefficients(128, 0, 26)
            .coeffs
            .iter()
            .map(|&(cx, cy)| cx.max(cy))
            .max()
            .unwrap();
        let max3 = select_coefficients(128, 3, 26 << 6)
            .coeffs
            .iter()
            .map(|&(cx, cy)| cx.max(cy))
            .max()
            .unwrap();
        assert!(
            max3 > max0,
            "tier 3 must reach higher frequencies: {max3} vs {max0}"
        );
    }

    #[test]
    fn selection_square_is_radial_l2_ball() {
        // byte=128 → (W,H) = (32,32); priority ∝ cx² + cy².
        let sel = select_coefficients(128, 0, 9);
        let expected = vec![
            (0, 1), // 1
            (1, 0), // 1 (tie broken by cx? no: (0,1) has cx=0 < 1)
            (1, 1), // 2
            (0, 2), // 4
            (2, 0), // 4
            (1, 2), // 5
            (2, 1), // 5
            (2, 2), // 8
            (0, 3), // 9
        ];
        assert_eq!(sel.coeffs, expected);
    }

    #[test]
    fn selection_square_27_includes_diagonals_over_axis_extremes() {
        // The ℓ2 ball (v0.6) should include (3,4)/(4,3) (priority 25) and
        // exclude (6,0)/(0,6) (priority 36) at K=27 — the opposite of the
        // v0.5 ℓ1 triangle.
        let sel = select_coefficients(128, 0, 27);
        assert!(sel.coeffs.contains(&(3, 4)));
        assert!(sel.coeffs.contains(&(4, 3)));
        assert!(!sel.coeffs.contains(&(6, 0)));
        assert!(!sel.coeffs.contains(&(0, 6)));
    }

    #[test]
    fn selection_priorities_ascending() {
        for byte in [0u8, 100, 128, 200, 255] {
            let sel = select_coefficients(byte, 0, 24);
            for pair in sel.priorities.windows(2) {
                assert!(pair[0] <= pair[1], "priorities must be ascending");
            }
            assert_eq!(*sel.priorities.last().unwrap(), sel.p_k);
        }
    }

    #[test]
    fn selection_bounded_by_output_size() {
        // No selected frequency may equal or exceed the natural render dims.
        for byte in 0u8..=255 {
            let (w, h) = decode_output_size(byte, 0);
            let sel = select_coefficients(byte, 0, 27);
            for &(cx, cy) in &sel.coeffs {
                assert!(cx < w as usize, "cx={cx} ≥ W={w} for byte={byte}");
                assert!(cy < h as usize, "cy={cy} ≥ H={h} for byte={byte}");
            }
        }
    }

    #[test]
    fn selection_extreme_landscape_prefers_long_axis() {
        // byte=255 → (W,H)=(32,2): cy is twice as expensive as 16·cx,
        // so the selection should be dominated by (cx, 0) terms.
        let sel = select_coefficients(255, 0, 24);
        let cy0 = sel.coeffs.iter().filter(|&&(_, cy)| cy == 0).count();
        assert!(cy0 >= 15, "expected mostly cy=0 terms, got {cy0}");
    }

    #[test]
    fn window_weights_disabled_at_one() {
        let sel = select_coefficients(128, 0, 24);
        let w = window_weights(&sel, 1.0, 1);
        assert!(w.iter().all(|&x| x == 1.0));
    }

    #[test]
    fn window_weights_monotone_and_bounded() {
        let sel = select_coefficients(128, 0, 24);
        let w = window_weights(&sel, 0.3, 1);
        for pair in w.windows(2) {
            assert!(
                pair[0] >= pair[1] - 1e-12,
                "weights should be non-increasing in priority"
            );
        }
        // Boundary coefficient gets exactly w_min (ρ=1 → hann=0).
        assert!((w.last().unwrap() - 0.3).abs() < 1e-12);
        assert!(w.iter().all(|&x| (0.3..=1.0).contains(&x)));
    }

    #[test]
    fn dc_of_constant_channel() {
        let w = 4;
        let h = 4;
        let val = 0.7;
        let channel = vec![val; w * h];
        let sel = select_coefficients(128, 0, 9);
        let cos_x = precompute_cos_table(w, 8);
        let cos_y = precompute_cos_table(h, 8);
        let (dc, _, _) = dct_encode_selected(&channel, w, h, &sel.coeffs, &cos_x, &cos_y);
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
        let sel = select_coefficients(128, 0, 9);
        let cos_x = precompute_cos_table(w, 8);
        let cos_y = precompute_cos_table(h, 8);
        let (_, ac, scale) = dct_encode_selected(&channel, w, h, &sel.coeffs, &cos_x, &cos_y);
        assert_eq!(scale, 0.0, "AC scale of constant channel should be 0");
        assert!(ac.iter().all(|&v| v == 0.0));
    }

    #[test]
    fn frequency_clamp_zeroes_unrepresentable() {
        // 1-px-wide source: every cx ≥ 1 coefficient must be exactly 0 and
        // must not contaminate the scale (the v0.5 dim-1xN catastrophe).
        let w = 1;
        let h = 16;
        let channel: Vec<f64> = (0..h).map(|y| y as f64 / 15.0).collect();
        let sel = select_coefficients(0, 0, 24); // byte 0, tier 0 → (W,H)=(2,32)
        let cos_x = precompute_cos_table(w, 2);
        let cos_y = precompute_cos_table(h, 32);
        let (_, ac, scale) = dct_encode_selected(&channel, w, h, &sel.coeffs, &cos_x, &cos_y);
        for (j, &(cx, _)) in sel.coeffs.iter().enumerate() {
            if cx >= w {
                assert_eq!(ac[j], 0.0, "clamped coefficient {j} must be 0");
            }
        }
        // The vertical gradient has strong (0,1) energy; scale must reflect
        // it rather than a degenerate ±DC junk value.
        assert!(scale > 0.05 && scale < 0.5, "scale={scale}");
    }

    #[test]
    fn encode_decode_roundtrip_constant() {
        let w = 8;
        let h = 8;
        let val = 0.42;
        let channel = vec![val; w * h];
        let sel = select_coefficients(128, 0, 9);
        let cos_x = precompute_cos_table(w, 8);
        let cos_y = precompute_cos_table(h, 8);
        let (dc, ac, _) = dct_encode_selected(&channel, w, h, &sel.coeffs, &cos_x, &cos_y);

        for y in 0..h {
            for x in 0..w {
                let r = dct_decode_pixel_separable(dc, &ac, &sel.coeffs, x, y, &cos_x, &cos_y);
                assert!(
                    (r - val).abs() < 1e-10,
                    "constant roundtrip failed at ({x},{y}): got {r}"
                );
            }
        }
    }

    #[test]
    fn encode_decode_gradient_reasonable() {
        let w = 8;
        let h = 8;
        let mut channel = vec![0.0; w * h];
        for y in 0..h {
            for x in 0..w {
                channel[x + y * w] = (x as f64 / w as f64 + y as f64 / h as f64) / 2.0;
            }
        }
        let sel = select_coefficients(128, 0, 27);
        let cos_x = precompute_cos_table(w, 32);
        let cos_y = precompute_cos_table(h, 32);
        let (dc, ac, _) = dct_encode_selected(&channel, w, h, &sel.coeffs, &cos_x, &cos_y);

        let mut max_err = 0.0_f64;
        for y in 0..h {
            for x in 0..w {
                let r = dct_decode_pixel_separable(dc, &ac, &sel.coeffs, x, y, &cos_x, &cos_y);
                max_err = max_err.max((r - channel[x + y * w]).abs());
            }
        }
        assert!(
            max_err < 0.02,
            "gradient reconstruction max error too large: {max_err}"
        );
    }
}
