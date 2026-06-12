use crate::aspect::decode_output_size;
use crate::bitpack::read_bits;
use crate::color::{oklab_to_linear_srgb, soft_gamut_clamp};
use crate::constants::{ALPHA_AC_BITS, ALPHA_AC_COUNT, Tunables};
use crate::dct::{
    dct_decode_pixel_separable, precompute_cos_table, select_coefficients, window_weights,
};
use crate::math_utils::{clamp01, round_half_away_from_zero};
use crate::mulaw::mu_law_dequantize;
use crate::transfer::srgb_gamma;

/// Build 4096-entry sRGB gamma LUT: lut[i] = sRGB8(i/4095). Per spec §12.6.
fn build_gamma_lut() -> [u8; 4096] {
    let mut lut = [0u8; 4096];
    for (i, entry) in lut.iter_mut().enumerate() {
        let x = i as f64 / 4095.0;
        let srgb = srgb_gamma(x);
        *entry = round_half_away_from_zero(srgb.clamp(0.0, 1.0) * 255.0) as u8;
    }
    lut
}

/// Map linear [0,1] to sRGB u8 via LUT. Per spec §12.6.
fn linear_to_srgb8(x: f64, lut: &[u8; 4096]) -> u8 {
    let idx = (round_half_away_from_zero(x * 4095.0) as i64).clamp(0, 4095) as usize;
    lut[idx]
}

/// Extract the aspect byte from a ChromaHash (bits 38–45 of the header).
fn read_aspect(hash: &[u8; 32]) -> u8 {
    let header: u64 = hash[..6]
        .iter()
        .enumerate()
        .fold(0u64, |acc, (i, &b)| acc | ((b as u64) << (i * 8)));
    ((header >> 38) & 0xFF) as u8
}

/// One channel's AC data ready for rendering: windowed coefficient values and
/// their (cx, cy) pairs, filtered to frequencies representable at the render
/// dimensions (cx < w, cy < h). Per spec §11 (v0.6) — rendering below the
/// natural size is a band-limited reconstruction at the coarser raster, which
/// is what makes capped decodes of extreme aspect ratios artifact-free
/// (v0.5 rendered 1×N strips as solid white through basis aliasing).
fn prepare_channel(
    ac: &[f64],
    coeffs: &[(usize, usize)],
    weights: &[f64],
    w: usize,
    h: usize,
) -> (Vec<f64>, Vec<(usize, usize)>) {
    let mut vals = Vec::with_capacity(ac.len());
    let mut scan = Vec::with_capacity(ac.len());
    for (j, &(cx, cy)) in coeffs.iter().enumerate() {
        if cx >= w || cy >= h {
            continue;
        }
        vals.push(ac[j] * weights[j]);
        scan.push((cx, cy));
    }
    (vals, scan)
}

/// Render a ChromaHash at the given pixel dimensions. Per spec §11 (v0.6).
fn render_at_size(hash: &[u8; 32], w: usize, h: usize, t: &Tunables) -> Vec<u8> {
    // 1. Unpack header (48 bits)
    let header: u64 = hash[..6]
        .iter()
        .enumerate()
        .fold(0u64, |acc, (i, &b)| acc | ((b as u64) << (i * 8)));

    let l_dc_q = (header & 0x7F) as u32;
    let a_dc_q = ((header >> 7) & 0x7F) as u32;
    let b_dc_q = ((header >> 14) & 0x7F) as u32;
    let l_scl_q = ((header >> 21) & 0x3F) as u32;
    let a_scl_q = ((header >> 27) & 0x3F) as u32;
    let b_scl_q = ((header >> 33) & 0x1F) as u32;
    let aspect = ((header >> 38) & 0xFF) as u8;
    let has_alpha = ((header >> 46) & 1) == 1;
    // bit 47: version. 0 = v0.6; 1 = legacy v0.2–v0.5 (different selection,
    // quantizer and layout — decoding it here produces garbage; the spec
    // phase will define rejection semantics for the public API).

    // 2. Decode DC values and scale factors
    let l_dc = l_dc_q as f64 / 127.0;
    let a_dc = (a_dc_q as f64 - 64.0) / 63.0 * t.max_chroma_a;
    let b_dc = (b_dc_q as f64 - 64.0) / 63.0 * t.max_chroma_b;
    let l_scale = l_scl_q as f64 / 63.0 * t.max_l_scale;
    let a_scale = a_scl_q as f64 / 63.0 * t.max_a_scale;
    let b_scale = b_scl_q as f64 / 31.0 * t.max_b_scale;

    // 3. Coefficient selection (mirrors the encoder exactly)
    let lay = &t.layout;
    let (l_count, c_count) = if has_alpha {
        (lay.la_tiers[0].0 + lay.la_tiers[1].0, lay.ca_count)
    } else {
        (lay.l_tiers[0].0 + lay.l_tiers[1].0, lay.c_count)
    };
    let l_sel = select_coefficients(aspect, l_count);
    let c_sel = select_coefficients(aspect, c_count);

    // 4. Read AC payload
    let mut bitpos = 48usize;

    let (alpha_dc_val, alpha_scale_val) = if has_alpha {
        let adc = read_bits(hash, bitpos, 5) as f64 / 31.0;
        bitpos += 5;
        let ascl = read_bits(hash, bitpos, 4) as f64 / 15.0 * t.max_alpha_scale;
        bitpos += 4;
        (adc, ascl)
    } else {
        (1.0, 0.0)
    };

    let l_tiers = if has_alpha {
        &lay.la_tiers
    } else {
        &lay.l_tiers
    };
    let mut l_ac = Vec::with_capacity(l_count);
    for &(count, bits) in l_tiers {
        for _ in 0..count {
            let q = read_bits(hash, bitpos, bits);
            bitpos += bits as usize;
            l_ac.push(mu_law_dequantize(q, bits, t.mu_l) * l_scale);
        }
    }

    let c_bits = if has_alpha { lay.ca_bits } else { lay.c_bits };
    let mut a_ac = Vec::with_capacity(c_count);
    for _ in 0..c_count {
        let q = read_bits(hash, bitpos, c_bits);
        bitpos += c_bits as usize;
        a_ac.push(mu_law_dequantize(q, c_bits, t.mu_c) * a_scale);
    }
    let mut b_ac = Vec::with_capacity(c_count);
    for _ in 0..c_count {
        let q = read_bits(hash, bitpos, c_bits);
        bitpos += c_bits as usize;
        b_ac.push(mu_law_dequantize(q, c_bits, t.mu_c) * b_scale);
    }

    let (alpha_ac, alpha_sel) = if has_alpha {
        let sel = select_coefficients(aspect, ALPHA_AC_COUNT);
        let mut aac = Vec::with_capacity(ALPHA_AC_COUNT);
        for _ in 0..ALPHA_AC_COUNT {
            let q = read_bits(hash, bitpos, ALPHA_AC_BITS);
            bitpos += ALPHA_AC_BITS as usize;
            aac.push(mu_law_dequantize(q, ALPHA_AC_BITS, t.mu_alpha) * alpha_scale_val);
        }
        (aac, Some(sel))
    } else {
        (vec![], None)
    };

    // 5. Synthesis window + frequency filter for the render raster
    let l_weights = window_weights(&l_sel, t.w_min_l, t.w_exp_l);
    let c_weights = window_weights(&c_sel, t.w_min_c, t.w_exp_c);

    let (l_vals, l_scan) = prepare_channel(&l_ac, &l_sel.coeffs, &l_weights, w, h);
    let (a_vals, a_scan) = prepare_channel(&a_ac, &c_sel.coeffs, &c_weights, w, h);
    let (b_vals, b_scan) = prepare_channel(&b_ac, &c_sel.coeffs, &c_weights, w, h);
    let (alpha_vals, alpha_scan) = if let Some(sel) = &alpha_sel {
        // Alpha is structural, not chromatic — share the luma window shape.
        let weights = window_weights(sel, t.w_min_l, t.w_exp_l);
        prepare_channel(&alpha_ac, &sel.coeffs, &weights, w, h)
    } else {
        (vec![], vec![])
    };

    // 6. Cosine tables sized to the surviving frequencies
    let max_cx = l_scan
        .iter()
        .chain(a_scan.iter())
        .chain(alpha_scan.iter())
        .map(|&(cx, _)| cx)
        .max()
        .unwrap_or(0);
    let max_cy = l_scan
        .iter()
        .chain(a_scan.iter())
        .chain(alpha_scan.iter())
        .map(|&(_, cy)| cy)
        .max()
        .unwrap_or(0);
    let cos_x = precompute_cos_table(w, max_cx + 1);
    let cos_y = precompute_cos_table(h, max_cy + 1);

    // 7. Build gamma LUT and render
    let gamma_lut = build_gamma_lut();
    let mut rgba_out = vec![0u8; w * h * 4];

    for y in 0..h {
        for x in 0..w {
            let l = dct_decode_pixel_separable(l_dc, &l_vals, &l_scan, x, y, &cos_x, &cos_y);
            let a = dct_decode_pixel_separable(a_dc, &a_vals, &a_scan, x, y, &cos_x, &cos_y);
            let b = dct_decode_pixel_separable(b_dc, &b_vals, &b_scan, x, y, &cos_x, &cos_y);
            let alpha = if has_alpha {
                dct_decode_pixel_separable(
                    alpha_dc_val,
                    &alpha_vals,
                    &alpha_scan,
                    x,
                    y,
                    &cos_x,
                    &cos_y,
                )
            } else {
                1.0
            };

            // Clamp L from DCT ringing, then soft gamut clamp (v0.6)
            let l_clamped = clamp01(l);
            let [l_out, a_out, b_out] = soft_gamut_clamp(l_clamped, a, b, t.gamut_l_blend);

            let rgb_linear = oklab_to_linear_srgb([l_out, a_out, b_out]);
            let idx = (y * w + x) * 4;
            rgba_out[idx] = linear_to_srgb8(clamp01(rgb_linear[0]), &gamma_lut);
            rgba_out[idx + 1] = linear_to_srgb8(clamp01(rgb_linear[1]), &gamma_lut);
            rgba_out[idx + 2] = linear_to_srgb8(clamp01(rgb_linear[2]), &gamma_lut);
            rgba_out[idx + 3] = round_half_away_from_zero(255.0 * clamp01(alpha)) as u8;
        }
    }

    rgba_out
}

/// Decode a ChromaHash into RGBA pixel data with explicit tunables.
/// Returns (width, height, rgba_pixels).
pub fn decode_with(hash: &[u8; 32], t: &Tunables) -> (u32, u32, Vec<u8>) {
    let aspect = read_aspect(hash);
    let (w, h) = decode_output_size(aspect);
    let rgba = render_at_size(hash, w as usize, h as usize, t);
    (w, h, rgba)
}

/// Decode a ChromaHash into RGBA pixel data. Per spec §11 (v0.6).
/// Returns (width, height, rgba_pixels).
pub fn decode(hash: &[u8; 32]) -> (u32, u32, Vec<u8>) {
    decode_with(hash, &Tunables::DEFAULT)
}

/// Decode capped at the given max dimensions, with explicit tunables.
pub fn decode_capped_with(
    hash: &[u8; 32],
    max_w: u32,
    max_h: u32,
    t: &Tunables,
) -> (u32, u32, Vec<u8>) {
    let aspect = read_aspect(hash);
    let (nat_w, nat_h) = decode_output_size(aspect);
    let w = nat_w.min(max_w);
    let h = nat_h.min(max_h);
    let rgba = render_at_size(hash, w as usize, h as usize, t);
    (w, h, rgba)
}

/// Decode a ChromaHash into RGBA pixel data, capped at the given max dimensions.
/// The shorter decoded dimension is also capped proportionally.
/// Returns (width, height, rgba_pixels).
pub fn decode_capped(hash: &[u8; 32], max_w: u32, max_h: u32) -> (u32, u32, Vec<u8>) {
    decode_capped_with(hash, max_w, max_h, &Tunables::DEFAULT)
}

/// Extract the average color from a ChromaHash without full decode, with
/// explicit tunables. Returns [r, g, b, a] as u8 values. Per spec §11.2.
pub fn average_color_with(hash: &[u8; 32], t: &Tunables) -> [u8; 4] {
    let header: u64 = hash[..6]
        .iter()
        .enumerate()
        .fold(0u64, |acc, (i, &b)| acc | ((b as u64) << (i * 8)));

    let l_dc_q = (header & 0x7F) as u32;
    let a_dc_q = ((header >> 7) & 0x7F) as u32;
    let b_dc_q = ((header >> 14) & 0x7F) as u32;
    let has_alpha = ((header >> 46) & 1) == 1;

    let l_dc = l_dc_q as f64 / 127.0;
    let a_dc = (a_dc_q as f64 - 64.0) / 63.0 * t.max_chroma_a;
    let b_dc = (b_dc_q as f64 - 64.0) / 63.0 * t.max_chroma_b;

    let l_clamped = clamp01(l_dc);
    let [l_out, a_out, b_out] = soft_gamut_clamp(l_clamped, a_dc, b_dc, t.gamut_l_blend);

    let rgb_linear = oklab_to_linear_srgb([l_out, a_out, b_out]);
    let gamma_lut = build_gamma_lut();

    let alpha = if has_alpha {
        read_bits(hash, 48, 5) as f64 / 31.0
    } else {
        1.0
    };

    [
        linear_to_srgb8(clamp01(rgb_linear[0]), &gamma_lut),
        linear_to_srgb8(clamp01(rgb_linear[1]), &gamma_lut),
        linear_to_srgb8(clamp01(rgb_linear[2]), &gamma_lut),
        round_half_away_from_zero(255.0 * clamp01(alpha)) as u8,
    ]
}

/// Extract the average color from a ChromaHash without full decode.
/// Returns [r, g, b, a] as u8 values. Per spec §11.2.
pub fn average_color(hash: &[u8; 32]) -> [u8; 4] {
    average_color_with(hash, &Tunables::DEFAULT)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Self-contained golden vectors copied from `spec/test-vectors/`. The full
    // golden cross-check lives in `tests/spec_vectors.rs`, but that reads the
    // sibling `spec/` dir which cargo-mutants' isolated per-crate build doesn't
    // stage — so the decode pipeline is pinned here too, in-crate, for the
    // mutation sweep (library tests only).

    fn assert_uniform(rgba: &[u8], px: [u8; 4]) {
        for (i, chunk) in rgba.chunks_exact(4).enumerate() {
            assert_eq!(chunk, px, "pixel {i} diverges from {px:?}");
        }
    }

    #[test]
    fn decode_golden_solids() {
        // Solid hashes decode to a uniform field — pins the header unpack, the
        // DC dequantize, and the gamut clamp. (integration-decode.json)
        let gray = [
            76, 32, 16, 0, 0, 32, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247,
            222, 123, 239, 189, 187, 187, 187, 187, 187, 187, 187, 187, 59,
        ];
        let (w, h, rgba) = decode(&gray);
        assert_eq!((w, h), (32, 32));
        assert_uniform(&rgba, [128, 128, 128, 255]);

        let blue = [
            185, 220, 0, 0, 0, 32, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247,
            222, 123, 239, 189, 187, 187, 187, 187, 187, 187, 187, 187, 59,
        ];
        let (w, h, rgba) = decode(&blue);
        assert_eq!((w, h), (32, 32));
        assert_uniform(&rgba, [3, 0, 252, 255]);
    }

    #[test]
    fn decode_golden_alpha() {
        // Alpha hash: the 6×6 layout + alpha channel must be read at the right
        // bit offsets, and `average_color` must report the sub-255 alpha — pins
        // the alpha-DC read in both the full render and the header-only path.
        let cb = [
            207, 121, 22, 0, 0, 96, 16, 190, 239, 251, 190, 239, 123, 239, 189, 247, 222, 123, 239,
            189, 119, 119, 119, 119, 119, 119, 119, 119, 119, 119, 231, 119,
        ];
        let (w, h, rgba) = decode(&cb);
        assert_eq!((w, h), (32, 32));
        assert_uniform(&rgba, [251, 1, 0, 132]);
        assert_eq!(average_color(&cb), [251, 1, 0, 132]);
    }

    #[test]
    fn decode_golden_gradient() {
        // A non-flat field exercises the AC read loops and the separable IDCT at
        // every pixel. gradient_200x50 → 32×8; sampled pixels are verbatim from
        // the spec vector.
        let hash = [
            197, 168, 109, 88, 237, 47, 163, 183, 80, 1, 106, 174, 73, 247, 220, 142, 245, 57, 247,
            222, 123, 239, 65, 184, 227, 75, 187, 171, 60, 184, 186, 59,
        ];
        let (w, h, rgba) = decode(&hash);
        assert_eq!((w, h), (32, 8));
        let px = |i: usize| &rgba[i * 4..i * 4 + 4];
        assert_eq!(px(0), [47, 29, 222, 255]);
        assert_eq!(px(31), [245, 0, 231, 255]);
        assert_eq!(px(128), [0, 133, 122, 255]);
        assert_eq!(px(255), [248, 10, 0, 255]);
    }

    #[test]
    fn decode_golden_gradient_16x16() {
        // A 32×32 render reaches the windowed high-frequency coefficients, so the
        // per-coefficient window weight actually shapes the output here (it's ≈1
        // for the low frequencies the 32×8 case keeps). (integration-decode.json)
        let hash = [
            70, 232, 109, 104, 47, 32, 129, 128, 237, 43, 114, 175, 57, 247, 220, 172, 177, 189,
            247, 222, 123, 206, 57, 134, 172, 51, 195, 131, 42, 203, 187, 51,
        ];
        let (w, h, rgba) = decode(&hash);
        assert_eq!((w, h), (32, 32));
        let px = |i: usize| &rgba[i * 4..i * 4 + 4];
        assert_eq!(px(0), [24, 34, 245, 255]);
        assert_eq!(px(16), [138, 0, 247, 255]);
        assert_eq!(px(400), [139, 48, 155, 255]);
        assert_eq!(px(600), [195, 38, 100, 255]);
        assert_eq!(px(1000), [21, 179, 0, 255]);
    }

    #[test]
    fn decode_alpha_gradient_varies() {
        // Decoded alpha must ramp across the row — pins the alpha AC bit offsets
        // and scale, which a uniform-alpha vector (checkerboard) can't reach.
        // Hash is `encode_alpha_gradient`'s output; expected pixels are its decode.
        let hash = [
            199, 177, 20, 0, 0, 96, 239, 190, 239, 251, 190, 239, 123, 239, 189, 247, 222, 123,
            239, 189, 119, 119, 119, 119, 119, 119, 119, 119, 119, 119, 112, 119,
        ];
        let (w, h, rgba) = decode(&hash);
        assert_eq!((w, h), (32, 32));
        let px = |i: usize| &rgba[i * 4..i * 4 + 4];
        // First row: alpha climbs left→right; RGB stays put.
        assert_eq!(px(0), [200, 59, 42, 5]);
        assert_eq!(px(16), [200, 59, 42, 129]);
        assert_eq!(px(31), [200, 59, 42, 242]);
        assert_eq!(px(1023), [200, 59, 42, 242]);
    }

    #[test]
    fn decode_capped_golden() {
        // Capping renders at a coarser raster — pins decode_capped's size math and
        // the frequency filter that drops coefficients with cx ≥ w or cy ≥ h.
        // Sampling along the strip (not just pixel 0) makes that filter observable.
        // (integration-decode-capped.json)
        let strip = [
            59, 174, 171, 232, 52, 0, 126, 191, 9, 227, 131, 15, 62, 248, 222, 123, 239, 189, 247,
            222, 123, 239, 61, 31, 196, 187, 187, 115, 188, 187, 187, 59,
        ];
        let (w, h, rgba) = decode_capped(&strip, 1, 100);
        assert_eq!((w, h), (1, 32));
        let px = |i: usize| &rgba[i * 4..i * 4 + 4];
        assert_eq!(px(0), [243, 31, 0, 255]);
        assert_eq!(px(8), [186, 0, 64, 255]);
        assert_eq!(px(16), [124, 0, 132, 255]);
        assert_eq!(px(24), [59, 0, 200, 255]);
        assert_eq!(px(31), [9, 30, 244, 255]);

        let grad = [
            70, 232, 109, 104, 47, 32, 129, 128, 237, 43, 114, 175, 57, 247, 220, 172, 177, 189,
            247, 222, 123, 206, 57, 134, 172, 51, 195, 131, 42, 203, 187, 51,
        ];
        let (w, h, rgba) = decode_capped(&grad, 8, 8);
        assert_eq!((w, h), (8, 8));
        assert_eq!(&rgba[0..4], [27, 37, 242, 255]);
    }
}
