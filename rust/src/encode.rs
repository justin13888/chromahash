use crate::aspect::encode_aspect;
use crate::bitpack::write_bits;
use crate::color::oklab_to_linear_srgb;
use crate::constants::{
    A_DC_BITS, A_SCALE_BITS, ALPHA_AC_BITS, ALPHA_DC_BITS, ALPHA_FLAG_BIT, ALPHA_PREFIX_BITS,
    ALPHA_SCALE_BITS, B_DC_BITS, B_SCALE_BITS, DESCRIPTOR_BITS, FORMAT_VERSION, Gamut, L_DC_BITS,
    L_SCALE_BITS, MAX_TIER, PREFIX_BITS, Tunables, VERSION_BITS, ac_payload_bits, ac_shape,
    body_len_bytes,
};
use crate::dct::{Selection, dct_encode_selected, precompute_cos_table, select_coefficients};
use crate::math_utils::{clamp_neg1_1, clamp01, round_half_away_from_zero};
use crate::mulaw::mu_law_quantize;
use crate::transfer::{adobe_rgb_eotf, bt2020_pq_eotf, prophoto_rgb_eotf, srgb_eotf, srgb_gamma};

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

/// Simulate the decoder's DC-only path for a quantized (L, a, b) code triple:
/// dequantize → clamp L → linear sRGB → per-channel clip → gamma. Returns the
/// gamma-encoded sRGB triple the decoder would render for a flat region.
fn dc_decode_sim(l_q: u32, a_q: u32, b_q: u32, t: &Tunables) -> [f64; 3] {
    let l = l_q as f64 / 127.0;
    let a = (a_q as f64 - 64.0) / 63.0 * t.max_chroma_a;
    let b = (b_q as f64 - 64.0) / 63.0 * t.max_chroma_b;
    let rgb = oklab_to_linear_srgb([clamp01(l), a, b]);
    [
        srgb_gamma(clamp01(rgb[0])),
        srgb_gamma(clamp01(rgb[1])),
        srgb_gamma(clamp01(rgb[2])),
    ]
}

/// Decode-aware DC code selection. Per spec §10 (v0.6).
///
/// Plain rounding of the DC triple, combined with quantization and the
/// decoder's per-channel clip of out-of-gamut chroma, can land the decoded
/// flat color away from the true average. Searching the ±1 neighborhood of the
/// nominal codes — scoring each by the simulated decoded color against the
/// clipped target — costs 27 DC simulations (~10 µs) and zero bits. Fixed
/// iteration order and strict improvement (`<`) keep it deterministic; ties
/// keep the nominal codes.
fn select_dc_codes(l_mean: f64, a_mean: f64, b_mean: f64, t: &Tunables) -> (u32, u32, u32) {
    let l0 = round_half_away_from_zero(127.0 * clamp01(l_mean)) as i64;
    let a0 = round_half_away_from_zero(64.0 + 63.0 * clamp_neg1_1(a_mean / t.max_chroma_a)) as i64;
    let b0 = round_half_away_from_zero(64.0 + 63.0 * clamp_neg1_1(b_mean / t.max_chroma_b)) as i64;

    if !t.dc_search {
        return (l0 as u32, a0 as u32, b0 as u32);
    }

    // Target = what the decoder could at best show for the true average color
    // (out-of-gamut targets are clipped per-channel, same as the decoder).
    let target_rgb = oklab_to_linear_srgb([clamp01(l_mean), a_mean, b_mean]);
    let target = [
        srgb_gamma(clamp01(target_rgb[0])),
        srgb_gamma(clamp01(target_rgb[1])),
        srgb_gamma(clamp01(target_rgb[2])),
    ];

    let mut best = (l0 as u32, a0 as u32, b0 as u32);
    let mut best_err = f64::INFINITY;
    for dl in [0i64, -1, 1] {
        for da in [0i64, -1, 1] {
            for db in [0i64, -1, 1] {
                let l_q = (l0 + dl).clamp(0, 127) as u32;
                let a_q = (a0 + da).clamp(1, 127) as u32;
                let b_q = (b0 + db).clamp(1, 127) as u32;
                let cand = dc_decode_sim(l_q, a_q, b_q, t);
                let dr = cand[0] - target[0];
                let dg = cand[1] - target[1];
                let db_ = cand[2] - target[2];
                let err = dr * dr + dg * dg + db_ * db_;
                if err < best_err {
                    best_err = err;
                    best = (l_q, a_q, b_q);
                }
            }
        }
    }
    best
}

/// Encode an image into a ChromaHash body with explicit tunables and quality
/// `tier`. Per spec §10 (v1). Returns the variable-length encoded bytes
/// (tier 0 = 32 bytes; each higher tier roughly quadruples the length).
pub fn encode_with(w: u32, h: u32, rgba: &[u8], gamut: Gamut, t: &Tunables, tier: u8) -> Box<[u8]> {
    assert!(w >= 1, "width must be >= 1");
    assert!(h >= 1, "height must be >= 1");
    assert!(
        rgba.len() == (w as usize) * (h as usize) * 4,
        "rgba length mismatch"
    );
    assert!(tier <= MAX_TIER, "quality tier must be <= {MAX_TIER}");

    let w = w as usize;
    let h = h as usize;
    let pixel_count = w * h;

    // 1. Precompute EOTF LUT (256 entries, eliminates per-pixel portable_pow)
    let eotf_lut = build_eotf_lut(gamut);

    // 2. Per-pixel OKLAB conversion with alpha accumulation.
    //
    // The linear-RGB → OKLAB transform is independent per pixel, so it runs
    // through the SIMD batch path (`simd::oklab_forward_batch`), whose output is
    // byte-identical to per-pixel `linear_rgb_to_oklab`. The alpha-weighted
    // average is a reduction, so it stays a scalar pass in pixel order to keep
    // the floating-point summation bit-exact.
    let mut lin_r = vec![0.0f64; pixel_count];
    let mut lin_g = vec![0.0f64; pixel_count];
    let mut lin_b = vec![0.0f64; pixel_count];
    let mut alpha_pixels = vec![0.0f64; pixel_count];
    for i in 0..pixel_count {
        lin_r[i] = eotf_lut[rgba[i * 4] as usize];
        lin_g[i] = eotf_lut[rgba[i * 4 + 1] as usize];
        lin_b[i] = eotf_lut[rgba[i * 4 + 2] as usize];
        alpha_pixels[i] = rgba[i * 4 + 3] as f64 / 255.0;
    }

    let mut oklab_pixels = vec![[0.0f64; 3]; pixel_count];
    crate::simd::oklab_forward_batch(&lin_r, &lin_g, &lin_b, gamut, &mut oklab_pixels);

    let mut avg_l = 0.0;
    let mut avg_a = 0.0;
    let mut avg_b = 0.0;
    let mut avg_alpha = 0.0;
    for i in 0..pixel_count {
        let alpha = alpha_pixels[i];
        let lab = oklab_pixels[i];
        avg_l += alpha * lab[0];
        avg_a += alpha * lab[1];
        avg_b += alpha * lab[2];
        avg_alpha += alpha;
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

    // 5. Select coefficients (top-K isotropic frequencies, scaled to the tier)
    let aspect = encode_aspect(w as u32, h as u32);
    let shape = ac_shape(&t.layout, has_alpha, tier);
    let l_count = shape.l_count();
    let c_count = shape.c_count;
    let l_sel: Selection = select_coefficients(aspect, tier, l_count);
    let c_sel: Selection = select_coefficients(aspect, tier, c_count);
    let alpha_sel = if has_alpha {
        select_coefficients(aspect, tier, shape.alpha_ac_count)
    } else {
        Selection {
            coeffs: vec![],
            priorities: vec![],
            p_k: 1,
        }
    };

    // 6. Precompute cosine tables over the source dims, covering every
    // selected frequency (rows for frequencies ≥ source dims exist but are
    // never read — dct_encode_selected clamps them to exact zero).
    let max_cx = l_sel
        .coeffs
        .iter()
        .chain(c_sel.coeffs.iter())
        .chain(alpha_sel.coeffs.iter())
        .map(|&(cx, _)| cx)
        .max()
        .unwrap_or(0);
    let max_cy = l_sel
        .coeffs
        .iter()
        .chain(c_sel.coeffs.iter())
        .chain(alpha_sel.coeffs.iter())
        .map(|&(_, cy)| cy)
        .max()
        .unwrap_or(0);
    let cos_x = precompute_cos_table(w, (max_cx + 1).min(w.max(1)));
    let cos_y = precompute_cos_table(h, (max_cy + 1).min(h.max(1)));

    // 7. DCT encode each channel (frequency clamp to source dims built in)
    let (l_dc, l_ac, l_scale) = dct_encode_selected(&l_chan, w, h, &l_sel.coeffs, &cos_x, &cos_y);
    let (a_dc, a_ac, a_scale) = dct_encode_selected(&a_chan, w, h, &c_sel.coeffs, &cos_x, &cos_y);
    let (b_dc, b_ac, b_scale) = dct_encode_selected(&b_chan, w, h, &c_sel.coeffs, &cos_x, &cos_y);
    let (alpha_dc, alpha_ac, alpha_scale) = if has_alpha {
        dct_encode_selected(&alpha_pixels, w, h, &alpha_sel.coeffs, &cos_x, &cos_y)
    } else {
        (0.0, vec![], 0.0)
    };

    // 8. Quantize header values (decode-aware DC code search, v0.6)
    let (l_dc_q, a_dc_q, b_dc_q) = select_dc_codes(l_dc, a_dc, b_dc, t);
    let l_scl_q = round_half_away_from_zero(63.0 * clamp01(l_scale / t.max_l_scale)) as u64;
    let a_scl_q = round_half_away_from_zero(63.0 * clamp01(a_scale / t.max_a_scale)) as u64;
    let b_scl_q = round_half_away_from_zero(31.0 * clamp01(b_scale / t.max_b_scale)) as u64;

    // 9. Allocate the variable-length body and write the descriptor bytes.
    //    Byte 0: version (bits 0..3) | tier (bits 3..6) | hasAlpha (bit 6) |
    //    reserved (bit 7, 0). Byte 1: aspect. (v1, spec §3.1)
    let body_len = body_len_bytes(&t.layout, has_alpha, tier);
    let mut hash = vec![0u8; body_len];
    hash[0] = FORMAT_VERSION | (tier << VERSION_BITS) | ((has_alpha as u8) << ALPHA_FLAG_BIT);
    hash[1] = aspect;

    // 10. DC + scale prefix (bits 16..54).
    let mut bitpos = DESCRIPTOR_BITS as usize;
    write_bits(&mut hash, bitpos, L_DC_BITS, l_dc_q);
    bitpos += L_DC_BITS as usize;
    write_bits(&mut hash, bitpos, A_DC_BITS, a_dc_q);
    bitpos += A_DC_BITS as usize;
    write_bits(&mut hash, bitpos, B_DC_BITS, b_dc_q);
    bitpos += B_DC_BITS as usize;
    write_bits(&mut hash, bitpos, L_SCALE_BITS, l_scl_q as u32);
    bitpos += L_SCALE_BITS as usize;
    write_bits(&mut hash, bitpos, A_SCALE_BITS, a_scl_q as u32);
    bitpos += A_SCALE_BITS as usize;
    write_bits(&mut hash, bitpos, B_SCALE_BITS, b_scl_q as u32);
    bitpos += B_SCALE_BITS as usize;
    debug_assert_eq!(bitpos, PREFIX_BITS as usize);

    // 11. AC payload with µ-law companding.
    let quantize_ac = |value: f64, scale: f64, bits: u32, mu: f64| -> u32 {
        if scale == 0.0 {
            mu_law_quantize(0.0, bits, mu)
        } else {
            mu_law_quantize(value / scale, bits, mu)
        }
    };

    if has_alpha {
        let alpha_dc_q = round_half_away_from_zero(31.0 * clamp01(alpha_dc)) as u32;
        let alpha_scl_q =
            round_half_away_from_zero(15.0 * clamp01(alpha_scale / t.max_alpha_scale)) as u32;
        write_bits(&mut hash, bitpos, ALPHA_DC_BITS, alpha_dc_q);
        bitpos += ALPHA_DC_BITS as usize;
        write_bits(&mut hash, bitpos, ALPHA_SCALE_BITS, alpha_scl_q);
        bitpos += ALPHA_SCALE_BITS as usize;
    }

    // L AC in selection order across the precision tiers (counts scaled by tier)
    let mut l_idx = 0usize;
    for &(count, bits) in &shape.l_tiers {
        for _ in 0..count {
            let q = quantize_ac(l_ac[l_idx], l_scale, bits, t.mu_l);
            write_bits(&mut hash, bitpos, bits, q);
            bitpos += bits as usize;
            l_idx += 1;
        }
    }

    // Chroma AC
    let c_bits = shape.c_bits;
    for ac_val in &a_ac {
        let q = quantize_ac(*ac_val, a_scale, c_bits, t.mu_c);
        write_bits(&mut hash, bitpos, c_bits, q);
        bitpos += c_bits as usize;
    }
    for ac_val in &b_ac {
        let q = quantize_ac(*ac_val, b_scale, c_bits, t.mu_c);
        write_bits(&mut hash, bitpos, c_bits, q);
        bitpos += c_bits as usize;
    }

    if has_alpha {
        for ac_val in &alpha_ac {
            let q = quantize_ac(*ac_val, alpha_scale, ALPHA_AC_BITS, t.mu_alpha);
            write_bits(&mut hash, bitpos, ALPHA_AC_BITS, q);
            bitpos += ALPHA_AC_BITS as usize;
        }
    }

    // Exact bit budget; trailing bits to the byte boundary are padding zeros.
    let alpha_prefix = if has_alpha {
        ALPHA_PREFIX_BITS as usize
    } else {
        0
    };
    debug_assert_eq!(
        bitpos,
        PREFIX_BITS as usize + alpha_prefix + ac_payload_bits(&shape)
    );
    debug_assert_eq!(body_len, bitpos.div_ceil(8));

    hash.into_boxed_slice()
}

/// Encode an image into a ChromaHash at tier 0. Per spec §10 (v1).
pub fn encode(w: u32, h: u32, rgba: &[u8], gamut: Gamut) -> Box<[u8]> {
    encode_with(w, h, rgba, gamut, &Tunables::DEFAULT, 0)
}

/// Encode an image at a given quality `tier` (0..=`MAX_TIER`). Per spec §10 (v1).
pub fn encode_quality(w: u32, h: u32, rgba: &[u8], gamut: Gamut, tier: u8) -> Box<[u8]> {
    encode_with(w, h, rgba, gamut, &Tunables::DEFAULT, tier)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Self-contained golden vectors copied from `spec/test-vectors/`. The
    // crate's full golden cross-check lives in `tests/spec_vectors.rs`, but that
    // reads the sibling `spec/` dir, which cargo-mutants' isolated per-crate
    // build doesn't stage — so the encode pipeline is pinned here too, in-crate,
    // where the mutation sweep (`cargo mutants`, library tests only) can use it.

    fn solid(w: u32, h: u32, r: u8, g: u8, b: u8, a: u8) -> Vec<u8> {
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for px in rgba.chunks_exact_mut(4) {
            px.copy_from_slice(&[r, g, b, a]);
        }
        rgba
    }

    #[test]
    fn select_dc_codes_searches_l_neighbors() {
        // The decode-aware DC search must explore the L code's ±1 neighbours, not
        // only the rounded nominal `l0`. At a near-black, maximally-green-chroma
        // working point the decoder's per-channel gamut clip makes a neighbour
        // strictly better, so the search returns `l0 ± 1`.
        //
        // The `(l0 + dl)` → `(l0 * dl)` mutation collapses the L candidate set to
        // {l0*0, l0*-1→clamp0, l0*1} = {0, l0} over dl ∈ {0,-1,1}, which can reach
        // neither neighbour. Every golden solid happens to have `l0` optimal, so
        // only an input that genuinely selects a neighbour pins this out. These
        // are at the v0.6 working point (max_chroma_b = 0.33); the exact tuples
        // are this build's own search output.
        let t = &Tunables::DEFAULT;
        let l = 14.0_f64 / 60.0; // l0 = round(127 · 0.2333…) = 30
        let l0 = round_half_away_from_zero(127.0 * clamp01(l)) as u32;
        assert_eq!(l0, 30, "fixture assumes nominal L code 30");
        assert!(t.dc_search, "search must be enabled for the ± scan");

        // Maximally-green a (−max_chroma_a) with two nearby b values that tip the
        // clipped decode toward the opposite L neighbours.
        let b_up = (5.0_f64 / 60.0 - 0.5) * 2.0 * 0.33; // -0.275 → picks l0 + 1
        let b_dn = (8.0_f64 / 60.0 - 0.5) * 2.0 * 0.33; // -0.242 → picks l0 - 1
        assert_eq!(
            select_dc_codes(l, -0.35, b_up, t),
            (31, 1, 13),
            "search must reach l0 + 1 = 31"
        );
        assert_eq!(
            select_dc_codes(l, -0.35, b_dn, t),
            (29, 2, 17),
            "search must reach l0 - 1 = 29"
        );
    }

    #[test]
    fn encode_golden_solids() {
        // Saturated gamut corners exercise the decode-aware DC code search; the
        // neutral/extreme tones pin the DC and scale quantizers and the header
        // packing. (spec/test-vectors/integration-encode.json)
        // v1: byte 0 = descriptor (0 = version 0, tier 0, opaque), byte 1 =
        // aspect (128 for 1:1), then the 38-bit DC/scale prefix, then AC.
        #[rustfmt::skip]
        let cases: &[(u8, u8, u8, Gamut, [u8; 32])] = &[
            (128, 128, 128, Gamut::Srgb,
                [0, 128, 76, 32, 16, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
            (255, 0, 0, Gamut::Srgb,
                [0, 128, 208, 116, 22, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
            (0, 255, 0, Gamut::Srgb,
                [0, 128, 238, 202, 24, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
            (0, 0, 255, Gamut::Srgb,
                [0, 128, 57, 29, 1, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
            (255, 255, 255, Gamut::Srgb,
                [0, 128, 127, 32, 16, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
            (0, 0, 0, Gamut::Srgb,
                [0, 128, 0, 32, 16, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
            // Wide-gamut solids: the same pixels map through a different M1
            // matrix (and EOTF for ProPhoto) → distinct OKLAB and DC codes.
            (200, 100, 50, Gamut::DisplayP3,
                [0, 128, 79, 171, 21, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
            (220, 50, 30, Gamut::ProPhotoRgb,
                [0, 128, 85, 62, 22, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
            // Adobe RGB (γ = 2.2 EOTF) and BT.2020 (PQ→Reinhard EOTF) are the two
            // source-gamut transfer arms no other golden vector exercises.
            (200, 100, 50, Gamut::AdobeRgb,
                [0, 128, 211, 171, 21, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
            (200, 100, 50, Gamut::Bt2020,
                [0, 128, 89, 52, 23, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119]),
        ];
        for &(r, g, b, gamut, expected) in cases {
            let rgba = solid(4, 4, r, g, b, 255);
            assert_eq!(
                encode(4, 4, &rgba, gamut).as_ref(),
                &expected,
                "solid ({r},{g},{b}) {gamut:?}"
            );
        }

        // 1×1 solid (aspect-byte extreme, single-pixel DCT).
        #[rustfmt::skip]
        let one = [0, 128, 78, 233, 20, 0, 192, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 123, 119, 119, 119, 119, 119, 119, 119, 119, 119];
        assert_eq!(
            encode(1, 1, &solid(1, 1, 200, 100, 50, 255), Gamut::Srgb).as_ref(),
            &one
        );
    }

    #[test]
    fn encode_golden_gradients() {
        // Non-constant channels drive every AC slot: pins the per-tier write
        // order, the scale factors, and the µ-law quantizer. Inputs and hashes
        // are the gradient_8x4 / gradient_4x8 spec vectors verbatim.
        let g8x4: [u8; 128] = [
            0, 0, 255, 255, 36, 0, 255, 255, 72, 0, 255, 255, 109, 0, 255, 255, 145, 0, 255, 255,
            182, 0, 255, 255, 218, 0, 255, 255, 255, 0, 255, 255, 0, 85, 170, 255, 36, 72, 170,
            255, 72, 60, 170, 255, 109, 48, 170, 255, 145, 36, 170, 255, 182, 24, 170, 255, 218,
            12, 170, 255, 255, 0, 170, 255, 0, 170, 85, 255, 36, 145, 85, 255, 72, 121, 85, 255,
            109, 97, 85, 255, 145, 72, 85, 255, 182, 48, 85, 255, 218, 24, 85, 255, 255, 0, 85,
            255, 0, 255, 0, 255, 36, 218, 0, 255, 72, 182, 0, 255, 109, 145, 0, 255, 145, 109, 0,
            255, 182, 72, 0, 255, 218, 36, 0, 255, 255, 0, 0, 255,
        ];
        #[rustfmt::skip]
        let h8x4 = [0, 159, 72, 166, 141, 120, 245, 9, 29, 160, 230, 56, 181, 206, 185, 231, 94, 140, 16, 186, 247, 222, 123, 192, 151, 118, 87, 87, 144, 117, 119, 118];
        assert_eq!(encode(8, 4, &g8x4, Gamut::Srgb).as_ref(), &h8x4);

        let g4x8: [u8; 128] = [
            0, 0, 255, 255, 85, 0, 255, 255, 170, 0, 255, 255, 255, 0, 255, 255, 0, 36, 218, 255,
            85, 24, 218, 255, 170, 12, 218, 255, 255, 0, 218, 255, 0, 72, 182, 255, 85, 48, 182,
            255, 170, 24, 182, 255, 255, 0, 182, 255, 0, 109, 145, 255, 85, 72, 145, 255, 170, 36,
            145, 255, 255, 0, 145, 255, 0, 145, 109, 255, 85, 97, 109, 255, 170, 48, 109, 255, 255,
            0, 109, 255, 0, 182, 72, 255, 85, 121, 72, 255, 170, 60, 72, 255, 255, 0, 72, 255, 0,
            218, 36, 255, 85, 145, 36, 255, 170, 72, 36, 255, 255, 0, 36, 255, 0, 255, 0, 255, 85,
            170, 0, 255, 170, 85, 0, 255, 255, 0, 0, 255,
        ];
        #[rustfmt::skip]
        let h4x8 = [0, 96, 201, 38, 142, 144, 113, 208, 5, 84, 232, 166, 71, 209, 189, 247, 30, 116, 15, 186, 247, 222, 123, 91, 144, 118, 119, 7, 86, 116, 119, 151];
        assert_eq!(encode(4, 8, &g4x8, Gamut::Srgb).as_ref(), &h4x8);
    }

    #[test]
    fn encode_golden_alpha() {
        // Any α < 255 flips the alpha layout (6×6 L grid + alpha channel). Pins
        // the alpha-DC/scale write and the alpha-weighted average. checkerboard
        // alternates opaque red / transparent blue → average is red at α≈132.
        let cb: [u8; 256] = [
            255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255,
            0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0,
            255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0,
            255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0,
            0, 255, 0, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
            255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0,
            255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0,
            255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0,
            0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
            255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0, 0,
            255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0,
            0, 255,
        ];
        #[rustfmt::skip]
        let expected = [64, 128, 208, 116, 22, 0, 0, 132, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 187, 187, 187, 187, 187, 187, 187, 187, 187, 187, 243, 59];
        assert_eq!(encode(8, 8, &cb, Gamut::Srgb).as_ref(), &expected);
    }

    #[test]
    fn encode_fully_transparent() {
        // Every pixel α = 0 → the alpha-weighted sum is zero, so the average must
        // default to black rather than divide by zero (`avg_alpha > 0.0` guard).
        let hash = encode(4, 4, &[0u8; 4 * 4 * 4], Gamut::Srgb);
        #[rustfmt::skip]
        let expected = [64, 128, 0, 32, 16, 0, 0, 128, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 187, 187, 187, 187, 187, 187, 187, 187, 187, 187, 187, 59];
        assert_eq!(hash.as_ref(), &expected);
    }

    #[test]
    fn encode_alpha_gradient() {
        // A smooth left→right alpha ramp over a solid colour gives the alpha
        // channel a non-zero scale and real AC content — pins the alpha-scale
        // quantizer (the checkerboard's extreme α saturates it to a constant).
        let (w, h) = (8u32, 8u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let idx = ((y * w + x) * 4) as usize;
                rgba[idx..idx + 4].copy_from_slice(&[
                    200,
                    60,
                    40,
                    (x as f64 / (w - 1) as f64 * 255.0) as u8,
                ]);
            }
        }
        #[rustfmt::skip]
        let expected = [64, 128, 71, 174, 20, 0, 192, 187, 247, 222, 123, 239, 189, 247, 222, 123, 239, 189, 247, 222, 187, 187, 187, 187, 187, 187, 187, 187, 187, 59, 184, 59];
        assert_eq!(encode(w, h, &rgba, Gamut::Srgb).as_ref(), &expected);
    }
}
