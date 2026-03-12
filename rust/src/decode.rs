use crate::aspect::decode_output_size;
use crate::bitpack::read_bits;
use crate::color::oklab_to_srgb;
use crate::constants::*;
use crate::dct::{dct_decode_pixel, triangular_scan_order};
use crate::math_utils::{clamp01, round_half_away_from_zero};
use crate::mulaw::mu_law_dequantize;

/// Decode a ChromaHash into RGBA pixel data. Per spec §11.
/// Returns (width, height, rgba_pixels).
pub fn decode(hash: &[u8; 32]) -> (u32, u32, Vec<u8>) {
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

    // 2. Decode DC values and scale factors
    let l_dc = l_dc_q as f64 / 127.0;
    let a_dc = (a_dc_q as f64 - 64.0) / 63.0 * MAX_CHROMA_A;
    let b_dc = (b_dc_q as f64 - 64.0) / 63.0 * MAX_CHROMA_B;
    let l_scale = l_scl_q as f64 / 63.0 * MAX_L_SCALE;
    let a_scale = a_scl_q as f64 / 63.0 * MAX_A_SCALE;
    let b_scale = b_scl_q as f64 / 31.0 * MAX_B_SCALE;

    // 3-4. Decode aspect ratio and compute output size
    let (w, h) = decode_output_size(aspect);

    // 5. Dequantize AC coefficients
    let mut bitpos = 48usize;

    let (alpha_dc_val, alpha_scale_val) = if has_alpha {
        let adc = read_bits(hash, bitpos, 5) as f64 / 31.0;
        bitpos += 5;
        let ascl = read_bits(hash, bitpos, 4) as f64 / 15.0 * MAX_A_ALPHA_SCALE;
        bitpos += 4;
        (adc, ascl)
    } else {
        (1.0, 0.0)
    };

    let (l_ac, lx, ly) = if has_alpha {
        let mut lac = Vec::with_capacity(20);
        for _ in 0..7 {
            let q = read_bits(hash, bitpos, 6);
            bitpos += 6;
            lac.push(mu_law_dequantize(q, 6) * l_scale);
        }
        for _ in 7..20 {
            let q = read_bits(hash, bitpos, 5);
            bitpos += 5;
            lac.push(mu_law_dequantize(q, 5) * l_scale);
        }
        (lac, 6usize, 6usize)
    } else {
        let mut lac = Vec::with_capacity(27);
        for _ in 0..27 {
            let q = read_bits(hash, bitpos, 5);
            bitpos += 5;
            lac.push(mu_law_dequantize(q, 5) * l_scale);
        }
        (lac, 7usize, 7usize)
    };

    let mut a_ac = Vec::with_capacity(9);
    for _ in 0..9 {
        let q = read_bits(hash, bitpos, 4);
        bitpos += 4;
        a_ac.push(mu_law_dequantize(q, 4) * a_scale);
    }

    let mut b_ac = Vec::with_capacity(9);
    for _ in 0..9 {
        let q = read_bits(hash, bitpos, 4);
        bitpos += 4;
        b_ac.push(mu_law_dequantize(q, 4) * b_scale);
    }

    let alpha_ac = if has_alpha {
        let mut aac = Vec::with_capacity(5);
        for _ in 0..5 {
            let q = read_bits(hash, bitpos, 4);
            bitpos += 4;
            aac.push(mu_law_dequantize(q, 4) * alpha_scale_val);
        }
        aac
    } else {
        vec![]
    };

    // Precompute scan orders
    let l_scan = triangular_scan_order(lx, ly);
    let chroma_scan = triangular_scan_order(4, 4);
    let alpha_scan = if has_alpha {
        triangular_scan_order(3, 3)
    } else {
        vec![]
    };

    // 6. Render output image
    let w = w as usize;
    let h = h as usize;
    let mut rgba = vec![0u8; w * h * 4];

    for y in 0..h {
        for x in 0..w {
            let l = dct_decode_pixel(l_dc, &l_ac, &l_scan, x, y, w, h);
            let a = dct_decode_pixel(a_dc, &a_ac, &chroma_scan, x, y, w, h);
            let b = dct_decode_pixel(b_dc, &b_ac, &chroma_scan, x, y, w, h);
            let alpha = if has_alpha {
                dct_decode_pixel(alpha_dc_val, &alpha_ac, &alpha_scan, x, y, w, h)
            } else {
                1.0
            };

            let srgb = oklab_to_srgb([l, a, b]);
            let idx = (y * w + x) * 4;
            rgba[idx] = round_half_away_from_zero(255.0 * clamp01(srgb[0])) as u8;
            rgba[idx + 1] = round_half_away_from_zero(255.0 * clamp01(srgb[1])) as u8;
            rgba[idx + 2] = round_half_away_from_zero(255.0 * clamp01(srgb[2])) as u8;
            rgba[idx + 3] = round_half_away_from_zero(255.0 * clamp01(alpha)) as u8;
        }
    }

    (w as u32, h as u32, rgba)
}

/// Extract the average color from a ChromaHash without full decode.
/// Returns [r, g, b, a] as u8 values. Per spec §11.2.
pub fn average_color(hash: &[u8; 32]) -> [u8; 4] {
    let header: u64 = hash[..6]
        .iter()
        .enumerate()
        .fold(0u64, |acc, (i, &b)| acc | ((b as u64) << (i * 8)));

    let l_dc_q = (header & 0x7F) as u32;
    let a_dc_q = ((header >> 7) & 0x7F) as u32;
    let b_dc_q = ((header >> 14) & 0x7F) as u32;
    let has_alpha = ((header >> 46) & 1) == 1;

    let l_dc = l_dc_q as f64 / 127.0;
    let a_dc = (a_dc_q as f64 - 64.0) / 63.0 * MAX_CHROMA_A;
    let b_dc = (b_dc_q as f64 - 64.0) / 63.0 * MAX_CHROMA_B;

    let srgb = oklab_to_srgb([l_dc, a_dc, b_dc]);

    let alpha = if has_alpha {
        read_bits(hash, 48, 5) as f64 / 31.0
    } else {
        1.0
    };

    [
        round_half_away_from_zero(255.0 * clamp01(srgb[0])) as u8,
        round_half_away_from_zero(255.0 * clamp01(srgb[1])) as u8,
        round_half_away_from_zero(255.0 * clamp01(srgb[2])) as u8,
        round_half_away_from_zero(255.0 * clamp01(alpha)) as u8,
    ]
}
