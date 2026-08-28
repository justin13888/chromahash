//! Wide-gamut → sRGB reference conversion for the comparison harness, over the
//! `gamut` ecosystem's color primitives rather than a TypeScript reimplementation.
//!
//! Protocol mirrors the other stdin harnesses (`encode_stdin` / `thumbhash-stdin`):
//!
//! ```text
//! gamut-ref-stdin <gamut>
//! ```
//!
//! reads RGBA bytes (length a multiple of 4) from stdin and writes the same
//! number of sRGB-appearance RGBA bytes to stdout. `<gamut>` is one of `srgb`,
//! `displayp3`, `adobergb`, `bt2020`, `prophoto` (the harness's normalized keys);
//! `srgb` and any unrecognized value pass the bytes through unchanged. The
//! conversion is per-pixel and resolution-independent, so no width/height is
//! needed.
//!
//! Why this exists: the gamut fixtures store pixel bytes *tagged* with a non-sRGB
//! gamut. Comparing decoded previews against those raw bytes as if they were sRGB
//! penalizes formats that color-manage correctly, so the harness first converts a
//! gamut-tagged image to its true sRGB appearance (relative-colorimetric, with
//! per-channel clipping) — the exact interpretation chromahash's encoder applies.
//!
//! Determinism is **Tier-1** (correctness only): `gamut-color` uses `std` `f64`,
//! not chromahash's bit-reproducible substrate. That is correct here — this is
//! metric-reference code, not on the format's bit-exact cross-language path.

use std::io::{self, Read, Write};

use gamut_color::oklab::M1_INV_SRGB;
use gamut_color::profile::SourceProfile;
use gamut_color::transfer::srgb_oetf;

fn usage() -> ! {
    eprintln!("Usage: gamut-ref-stdin <gamut>");
    eprintln!("  <gamut>: srgb | displayp3 | adobergb | bt2020 | prophoto");
    std::process::exit(1);
}

/// The source profile for a harness gamut key, or `None` for sRGB / any
/// unrecognized key (both pass through unchanged, matching the TS reference).
fn profile_for(gamut: &str) -> Option<SourceProfile> {
    match gamut {
        "displayp3" => Some(SourceProfile::DISPLAY_P3),
        "adobergb" => Some(SourceProfile::ADOBE_RGB),
        "bt2020" => Some(SourceProfile::BT2020),
        "prophoto" => Some(SourceProfile::PROPHOTO_RGB),
        _ => None,
    }
}

/// 3×3 matrix × 3-vector (the only arithmetic not owned by gamut; the matrices
/// themselves are gamut's).
fn matvec3(m: &[[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        usage();
    }

    let mut rgba = Vec::new();
    io::stdin()
        .read_to_end(&mut rgba)
        .expect("failed to read RGBA from stdin");

    // sRGB / unknown is the identity (the input is already the metric target).
    if let Some(profile) = profile_for(&args[1]) {
        let m1 = profile.gamut.m1_matrix();

        // 256-entry EOTF LUT (gamut owns the encoder-exact transfer per gamut:
        // sRGB piecewise, Adobe x^2.2, ProPhoto x^1.8, BT.2020 PQ→Reinhard@203).
        let mut lut = [0.0f64; 256];
        for (i, e) in lut.iter_mut().enumerate() {
            *e = profile.eotf(i as f64 / 255.0);
        }

        // `as_chunks_mut` over `chunks_exact_mut`: the RGBA stride is a constant, so
        // the chunk length is known to the compiler and the remainder is `&mut []`.
        let (pixels, _rest) = rgba.as_chunks_mut::<4>();
        for px in pixels {
            // gamut-linear RGB → LMS (M1[gamut]) → linear sRGB (M1⁻¹[sRGB]).
            let lin = matvec3(
                m1,
                [
                    lut[px[0] as usize],
                    lut[px[1] as usize],
                    lut[px[2] as usize],
                ],
            );
            let srgb = matvec3(&M1_INV_SRGB, lin);
            for (c, &v) in srgb.iter().enumerate() {
                // Per-channel clip (relative-colorimetric), then sRGB inverse-EOTF.
                px[c] = (255.0 * srgb_oetf(v.clamp(0.0, 1.0))).round() as u8;
            }
            // px[3] (alpha) passes through unchanged.
        }
    }

    io::stdout().write_all(&rgba).expect("failed to write RGBA");
}
