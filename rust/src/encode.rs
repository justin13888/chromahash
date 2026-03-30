use crate::aspect::{derive_grid, encode_aspect};
use crate::bitpack::write_bits;
use crate::color::linear_rgb_to_oklab;
use crate::constants::*;
use crate::dct::{dct_encode_separable, precompute_cos_table};
use crate::math_utils::{clamp_neg1_1, clamp01, round_half_away_from_zero};
use crate::mulaw::mu_law_quantize;
use crate::transfer::{adobe_rgb_eotf, bt2020_pq_eotf, prophoto_rgb_eotf, srgb_eotf};

/// Build a 256-entry EOTF lookup table for the given gamut. Per spec §5.2.
fn build_eotf_lut(gamut: Gamut) -> [f64; 256] {
    let mut lut = [0.0f64; 256];
    for (i, entry) in lut.iter_mut().enumerate() {
        let x = i as f64 / 255.0;
        *entry = match gamut {
            Gamut::Srgb | Gamut::DisplayP3 => srgb_eotf(x),
            Gamut::AdobeRgb => adobe_rgb_eotf(x),
            Gamut::ProPhotoRgb => prophoto_rgb_eotf(x),
            Gamut::Bt2020 => bt2020_pq_eotf(x),
        };
    }
    lut
}

/// Encode an image into a 32-byte ChromaHash. Per spec §10 (v0.2).
pub fn encode(w: u32, h: u32, rgba: &[u8], gamut: Gamut) -> [u8; 32] {
    assert!(w >= 1, "width must be >= 1");
    assert!(h >= 1, "height must be >= 1");
    assert!(
        rgba.len() == (w as usize) * (h as usize) * 4,
        "rgba length mismatch"
    );

    let w = w as usize;
    let h = h as usize;
    let pixel_count = w * h;

    // 1. Precompute EOTF LUT (256 entries, eliminates per-pixel portable_pow)
    let eotf_lut = build_eotf_lut(gamut);

    // 2. Per-pixel OKLAB conversion with alpha accumulation
    let mut oklab_pixels = vec![[0.0f64; 3]; pixel_count];
    let mut alpha_pixels = vec![0.0f64; pixel_count];
    let mut avg_l = 0.0;
    let mut avg_a = 0.0;
    let mut avg_b = 0.0;
    let mut avg_alpha = 0.0;

    for i in 0..pixel_count {
        let r_lin = eotf_lut[rgba[i * 4] as usize];
        let g_lin = eotf_lut[rgba[i * 4 + 1] as usize];
        let b_lin = eotf_lut[rgba[i * 4 + 2] as usize];
        let alpha = rgba[i * 4 + 3] as f64 / 255.0;

        let lab = linear_rgb_to_oklab([r_lin, g_lin, b_lin], gamut);

        avg_l += alpha * lab[0];
        avg_a += alpha * lab[1];
        avg_b += alpha * lab[2];
        avg_alpha += alpha;

        oklab_pixels[i] = lab;
        alpha_pixels[i] = alpha;
    }

    // 3. Compute alpha-weighted average color
    if avg_alpha > 0.0 {
        avg_l /= avg_alpha;
        avg_a /= avg_alpha;
        avg_b /= avg_alpha;
    }

    // 4. Composite transparent pixels over average
    let has_alpha = avg_alpha < pixel_count as f64;
    let mut l_chan = vec![0.0f64; pixel_count];
    let mut a_chan = vec![0.0f64; pixel_count];
    let mut b_chan = vec![0.0f64; pixel_count];

    for i in 0..pixel_count {
        let alpha = alpha_pixels[i];
        l_chan[i] = avg_l * (1.0 - alpha) + alpha * oklab_pixels[i][0];
        a_chan[i] = avg_a * (1.0 - alpha) + alpha * oklab_pixels[i][1];
        b_chan[i] = avg_b * (1.0 - alpha) + alpha * oklab_pixels[i][2];
    }

    // 5. Derive adaptive grid dimensions
    let aspect = encode_aspect(w as u32, h as u32);
    let (l_nx, l_ny) = if has_alpha {
        derive_grid(aspect, 6)
    } else {
        derive_grid(aspect, 7)
    };
    let (c_nx, c_ny) = derive_grid(aspect, 4);
    let (alpha_nx, alpha_ny) = if has_alpha {
        derive_grid(aspect, 3)
    } else {
        (3, 3) // unused placeholder
    };

    // 6. Precompute cosine tables (alpha dims always <= L dims)
    let max_cx = l_nx.max(c_nx);
    let max_cy = l_ny.max(c_ny);
    let cos_x = precompute_cos_table(w, max_cx);
    let cos_y = precompute_cos_table(h, max_cy);

    // 7. DCT encode each channel
    let (l_dc, mut l_ac, l_scale) = dct_encode_separable(&l_chan, w, h, l_nx, l_ny, &cos_x, &cos_y);
    let (a_dc, mut a_ac, a_scale) = dct_encode_separable(&a_chan, w, h, c_nx, c_ny, &cos_x, &cos_y);
    let (b_dc, mut b_ac, b_scale) = dct_encode_separable(&b_chan, w, h, c_nx, c_ny, &cos_x, &cos_y);

    let (alpha_dc, mut alpha_ac, alpha_scale) = if has_alpha {
        dct_encode_separable(&alpha_pixels, w, h, alpha_nx, alpha_ny, &cos_x, &cos_y)
    } else {
        (0.0, vec![], 0.0)
    };

    // Cap to bit budget; zero-pad if under cap (only 4×8/8×4 alpha-mode L grids)
    let l_cap = if has_alpha { 20 } else { 27 };
    l_ac.truncate(l_cap);
    while l_ac.len() < l_cap {
        l_ac.push(0.0);
    }
    a_ac.truncate(9);
    b_ac.truncate(9);
    if has_alpha {
        alpha_ac.truncate(5);
    }

    // 8. Quantize header values
    let l_dc_q = round_half_away_from_zero(127.0 * clamp01(l_dc)) as u64;
    let a_dc_q = round_half_away_from_zero(64.0 + 63.0 * clamp_neg1_1(a_dc / MAX_CHROMA_A)) as u64;
    let b_dc_q = round_half_away_from_zero(64.0 + 63.0 * clamp_neg1_1(b_dc / MAX_CHROMA_B)) as u64;
    let l_scl_q = round_half_away_from_zero(63.0 * clamp01(l_scale / MAX_L_SCALE)) as u64;
    let a_scl_q = round_half_away_from_zero(63.0 * clamp01(a_scale / MAX_A_SCALE)) as u64;
    let b_scl_q = round_half_away_from_zero(31.0 * clamp01(b_scale / MAX_B_SCALE)) as u64;

    // 9. Pack header (48 bits = 6 bytes, little-endian); bit 47 = 1 for v0.2
    let header: u64 = l_dc_q
        | (a_dc_q << 7)
        | (b_dc_q << 14)
        | (l_scl_q << 21)
        | (a_scl_q << 27)
        | (b_scl_q << 33)
        | ((aspect as u64) << 38)
        | (if has_alpha { 1u64 } else { 0u64 } << 46)
        | (1u64 << 47); // v0.2: version bit = 1

    let mut hash = [0u8; 32];
    for (i, byte) in hash.iter_mut().enumerate().take(6) {
        *byte = ((header >> (i * 8)) & 0xFF) as u8;
    }

    // 10. Pack AC coefficients with µ-law companding
    let mut bitpos = 48usize;

    let quantize_ac = |value: f64, scale: f64, bits: u32| -> u32 {
        if scale == 0.0 {
            mu_law_quantize(0.0, bits)
        } else {
            mu_law_quantize(value / scale, bits)
        }
    };

    if has_alpha {
        let alpha_dc_q = round_half_away_from_zero(31.0 * clamp01(alpha_dc)) as u32;
        let alpha_scl_q =
            round_half_away_from_zero(15.0 * clamp01(alpha_scale / MAX_A_ALPHA_SCALE)) as u32;
        write_bits(&mut hash, bitpos, 5, alpha_dc_q);
        bitpos += 5;
        write_bits(&mut hash, bitpos, 4, alpha_scl_q);
        bitpos += 4;

        // L AC: first 7 at 6 bits, remaining 13 at 5 bits
        for ac_val in &l_ac[..7] {
            let q = quantize_ac(*ac_val, l_scale, 6);
            write_bits(&mut hash, bitpos, 6, q);
            bitpos += 6;
        }
        for ac_val in &l_ac[7..20] {
            let q = quantize_ac(*ac_val, l_scale, 5);
            write_bits(&mut hash, bitpos, 5, q);
            bitpos += 5;
        }
    } else {
        // L AC: all 27 at 5 bits
        for ac_val in &l_ac[..27] {
            let q = quantize_ac(*ac_val, l_scale, 5);
            write_bits(&mut hash, bitpos, 5, q);
            bitpos += 5;
        }
    }

    // a AC: 9 at 4 bits
    for ac_val in &a_ac {
        let q = quantize_ac(*ac_val, a_scale, 4);
        write_bits(&mut hash, bitpos, 4, q);
        bitpos += 4;
    }

    // b AC: 9 at 4 bits
    for ac_val in &b_ac {
        let q = quantize_ac(*ac_val, b_scale, 4);
        write_bits(&mut hash, bitpos, 4, q);
        bitpos += 4;
    }

    if has_alpha {
        // Alpha AC: 5 at 4 bits
        for ac_val in &alpha_ac {
            let q = quantize_ac(*ac_val, alpha_scale, 4);
            write_bits(&mut hash, bitpos, 4, q);
            bitpos += 4;
        }
    }

    // Verify exact bit budget: no-alpha ends at 255 (bit 255 = padding), alpha at 256
    if has_alpha {
        debug_assert_eq!(bitpos, 256);
    } else {
        debug_assert_eq!(bitpos, 255);
    }

    hash
}
