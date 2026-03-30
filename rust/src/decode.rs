use crate::aspect::{decode_output_size, derive_grid};
use crate::bitpack::read_bits;
use crate::color::{oklab_to_linear_srgb, soft_gamut_clamp};
use crate::constants::*;
use crate::dct::{dct_decode_pixel, triangular_scan_order};
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

/// Render a ChromaHash at the given pixel dimensions. Per spec §11 (v0.2).
fn render_at_size(hash: &[u8; 32], w: usize, h: usize) -> Vec<u8> {
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
    // bit 47: version (informational; always use v0.2 logic)

    // 2. Decode DC values and scale factors (v0.2: MAX_CHROMA = 0.45)
    let l_dc = l_dc_q as f64 / 127.0;
    let a_dc = (a_dc_q as f64 - 64.0) / 63.0 * MAX_CHROMA_A;
    let b_dc = (b_dc_q as f64 - 64.0) / 63.0 * MAX_CHROMA_B;
    let l_scale = l_scl_q as f64 / 63.0 * MAX_L_SCALE;
    let a_scale = a_scl_q as f64 / 63.0 * MAX_A_SCALE;
    let b_scale = b_scl_q as f64 / 31.0 * MAX_B_SCALE;

    // 3. Derive adaptive grid dimensions (v0.2)
    let (l_nx, l_ny) = if has_alpha {
        derive_grid(aspect, 6)
    } else {
        derive_grid(aspect, 7)
    };
    let (c_nx, c_ny) = derive_grid(aspect, 4);

    // 4. Compute scan orders and usable AC counts
    let l_scan = triangular_scan_order(l_nx, l_ny);
    let chroma_scan = triangular_scan_order(c_nx, c_ny);
    let l_cap = if has_alpha { 20usize } else { 27 };
    let c_cap = 9usize;
    let l_usable = l_cap.min(l_scan.len());
    let c_usable = c_cap.min(chroma_scan.len());

    // 5. Dequantize AC coefficients from bitstream (always read exactly cap values)
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

    let l_ac = if has_alpha {
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
        lac
    } else {
        let mut lac = Vec::with_capacity(27);
        for _ in 0..27 {
            let q = read_bits(hash, bitpos, 5);
            bitpos += 5;
            lac.push(mu_law_dequantize(q, 5) * l_scale);
        }
        lac
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

    // Alpha channel: derive its adaptive grid and usable count
    let (alpha_ac, alpha_scan, alpha_usable) = if has_alpha {
        let (a_nx, a_ny) = derive_grid(aspect, 3);
        let alpha_scan_inner = triangular_scan_order(a_nx, a_ny);
        let a_usable = 5usize.min(alpha_scan_inner.len());
        let mut aac = Vec::with_capacity(5);
        for _ in 0..5 {
            let q = read_bits(hash, bitpos, 4);
            bitpos += 4;
            aac.push(mu_law_dequantize(q, 4) * alpha_scale_val);
        }
        (aac, alpha_scan_inner, a_usable)
    } else {
        (vec![], vec![], 0)
    };

    // 6. Build gamma LUT (v0.2)
    let gamma_lut = build_gamma_lut();

    // 7. Render output image
    let mut rgba_out = vec![0u8; w * h * 4];

    for y in 0..h {
        for x in 0..w {
            let l = dct_decode_pixel(l_dc, &l_ac[..l_usable], &l_scan[..l_usable], x, y, w, h);
            let a = dct_decode_pixel(
                a_dc,
                &a_ac[..c_usable],
                &chroma_scan[..c_usable],
                x,
                y,
                w,
                h,
            );
            let b = dct_decode_pixel(
                b_dc,
                &b_ac[..c_usable],
                &chroma_scan[..c_usable],
                x,
                y,
                w,
                h,
            );
            let alpha = if has_alpha {
                dct_decode_pixel(
                    alpha_dc_val,
                    &alpha_ac[..alpha_usable],
                    &alpha_scan[..alpha_usable],
                    x,
                    y,
                    w,
                    h,
                )
            } else {
                1.0
            };

            // Clamp L from DCT ringing, then soft gamut clamp (v0.2)
            let l_clamped = clamp01(l);
            let [l_out, a_out, b_out] = soft_gamut_clamp(l_clamped, a, b);

            // OKLAB → linear sRGB → gamma LUT (v0.2)
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

/// Decode a ChromaHash into RGBA pixel data. Per spec §11 (v0.2).
/// Returns (width, height, rgba_pixels).
pub fn decode(hash: &[u8; 32]) -> (u32, u32, Vec<u8>) {
    let aspect = read_aspect(hash);
    let (w, h) = decode_output_size(aspect);
    let rgba = render_at_size(hash, w as usize, h as usize);
    (w, h, rgba)
}

/// Decode a ChromaHash into RGBA pixel data, capped at the given max dimensions.
/// The shorter decoded dimension is also capped proportionally.
/// Returns (width, height, rgba_pixels).
pub fn decode_capped(hash: &[u8; 32], max_w: u32, max_h: u32) -> (u32, u32, Vec<u8>) {
    let aspect = read_aspect(hash);
    let (nat_w, nat_h) = decode_output_size(aspect);
    let w = nat_w.min(max_w);
    let h = nat_h.min(max_h);
    let rgba = render_at_size(hash, w as usize, h as usize);
    (w, h, rgba)
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

    // Apply soft gamut clamp to DC values (v0.2)
    let l_clamped = clamp01(l_dc);
    let [l_out, a_out, b_out] = soft_gamut_clamp(l_clamped, a_dc, b_dc);

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
