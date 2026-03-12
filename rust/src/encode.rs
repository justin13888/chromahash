use crate::aspect::encode_aspect;
use crate::bitpack::write_bits;
use crate::color::gamma_rgb_to_oklab;
use crate::constants::*;
use crate::dct::dct_encode;
use crate::math_utils::{clamp_neg1_1, clamp01, round_half_away_from_zero};
use crate::mulaw::mu_law_quantize;

/// Encode an image into a 32-byte ChromaHash. Per spec §10.
pub fn encode(w: u32, h: u32, rgba: &[u8], gamut: Gamut) -> [u8; 32] {
    assert!((1..=100).contains(&w), "width must be 1–100");
    assert!((1..=100).contains(&h), "height must be 1–100");
    assert!(
        rgba.len() == (w as usize) * (h as usize) * 4,
        "rgba length mismatch"
    );

    let w = w as usize;
    let h = h as usize;
    let pixel_count = w * h;

    // 1-2. Convert all pixels to OKLAB, accumulate alpha-weighted average
    let mut oklab_pixels = vec![[0.0f64; 3]; pixel_count];
    let mut alpha_pixels = vec![0.0f64; pixel_count];
    let mut avg_l = 0.0;
    let mut avg_a = 0.0;
    let mut avg_b = 0.0;
    let mut avg_alpha = 0.0;

    for i in 0..pixel_count {
        let r = rgba[i * 4] as f64 / 255.0;
        let g = rgba[i * 4 + 1] as f64 / 255.0;
        let b = rgba[i * 4 + 2] as f64 / 255.0;
        let a = rgba[i * 4 + 3] as f64 / 255.0;

        let lab = gamma_rgb_to_oklab(r, g, b, gamut);

        avg_l += a * lab[0];
        avg_a += a * lab[1];
        avg_b += a * lab[2];
        avg_alpha += a;

        oklab_pixels[i] = lab;
        alpha_pixels[i] = a;
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

    // 5. DCT encode each channel
    let (l_dc, l_ac, l_scale) = if has_alpha {
        dct_encode(&l_chan, w, h, 6, 6)
    } else {
        dct_encode(&l_chan, w, h, 7, 7)
    };
    let (a_dc, a_ac, a_scale) = dct_encode(&a_chan, w, h, 4, 4);
    let (b_dc, b_ac, b_scale) = dct_encode(&b_chan, w, h, 4, 4);
    let (alpha_dc, alpha_ac, alpha_scale) = if has_alpha {
        dct_encode(&alpha_pixels, w, h, 3, 3)
    } else {
        (0.0, vec![], 0.0)
    };

    // 6. Quantize header values
    let l_dc_q = round_half_away_from_zero(127.0 * clamp01(l_dc)) as u64;
    let a_dc_q = round_half_away_from_zero(64.0 + 63.0 * clamp_neg1_1(a_dc / MAX_CHROMA_A)) as u64;
    let b_dc_q = round_half_away_from_zero(64.0 + 63.0 * clamp_neg1_1(b_dc / MAX_CHROMA_B)) as u64;
    let l_scl_q = round_half_away_from_zero(63.0 * clamp01(l_scale / MAX_L_SCALE)) as u64;
    let a_scl_q = round_half_away_from_zero(63.0 * clamp01(a_scale / MAX_A_SCALE)) as u64;
    let b_scl_q = round_half_away_from_zero(31.0 * clamp01(b_scale / MAX_B_SCALE)) as u64;

    // 7. Compute aspect byte
    let aspect = encode_aspect(w as u32, h as u32) as u64;

    // 8. Pack header (48 bits = 6 bytes)
    let header: u64 = l_dc_q
        | (a_dc_q << 7)
        | (b_dc_q << 14)
        | (l_scl_q << 21)
        | (a_scl_q << 27)
        | (b_scl_q << 33)
        | (aspect << 38)
        | (if has_alpha { 1u64 } else { 0u64 } << 46);
    // bit 47 reserved = 0

    let mut hash = [0u8; 32];
    for (i, byte) in hash.iter_mut().enumerate().take(6) {
        *byte = ((header >> (i * 8)) & 0xFF) as u8;
    }

    // 9. Pack AC coefficients with µ-law companding
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

    // Padding bit (no-alpha mode): already 0 since hash is initialized to 0
    debug_assert!(bitpos <= 256);

    hash
}
