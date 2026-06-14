//! ChromaHash — a compact, perceptual image placeholder (LQIP).
//!
//! ChromaHash encodes any image into a fixed **32-byte** code that decodes back
//! into a smooth, color-accurate thumbnail — the kind of blurred placeholder you
//! show while the full image loads. It works in the perceptual
//! [OKLab](https://bottosson.github.io/posts/oklab/) color space, supports
//! wide-gamut sources (Display P3, Adobe RGB, BT.2020, ProPhoto RGB) and an
//! alpha channel, and is bit-exact across platforms and languages: the same
//! input always produces the same 32 bytes. The core crate has **zero runtime
//! dependencies**.
//!
//! # Quick start
//!
//! ```
//! use chromahash::{ChromaHash, Gamut};
//!
//! // A 2×2 RGBA image (4 bytes per pixel).
//! let rgba: [u8; 16] = [
//!     255, 0, 0, 255, /**/ 0, 255, 0, 255,
//!     0, 0, 255, 255, /**/ 255, 255, 0, 255,
//! ];
//!
//! // Encode to a 32-byte hash, tagging the source color space.
//! let hash = ChromaHash::encode(2, 2, &rgba, Gamut::Srgb);
//! let bytes: &[u8; 32] = hash.as_bytes(); // store or transmit these
//!
//! // Later: reconstruct a placeholder at its natural size, or…
//! let (w, h, pixels) = ChromaHash::from_bytes(*bytes).decode();
//! assert_eq!(pixels.len(), (w * h * 4) as usize);
//!
//! // …grab just the average color for an instant solid-color fill.
//! let [r, g, b, a] = hash.average_color();
//! # let _ = (r, g, b, a);
//! ```
//!
//! # API surface
//!
//! [`ChromaHash`] is the whole public API:
//!
//! - [`ChromaHash::encode`] — image → hash.
//! - [`ChromaHash::decode`] / [`decode_to`](ChromaHash::decode_to) — hash → RGBA
//!   at its natural size, optionally in a chosen output [`Gamut`].
//! - [`decode_capped`](ChromaHash::decode_capped) /
//!   [`decode_capped_to`](ChromaHash::decode_capped_to) — render no larger than
//!   the given bounds (a band-limited render, free of aliasing).
//! - [`average_color`](ChromaHash::average_color) — the DC color, without a full
//!   decode.
//! - [`from_bytes`](ChromaHash::from_bytes) / [`as_bytes`](ChromaHash::as_bytes)
//!   — round-trip the raw 32 bytes.
//! - [`is_version_supported`](ChromaHash::is_version_supported) — see
//!   [Versioning](#versioning).
//!
//! [`BatchEncoder`] amortizes setup across many images for higher throughput;
//! its output is byte-identical to calling [`ChromaHash::encode`] per image.
//!
//! # Versioning
//!
//! This crate implements the **v0.6** bitstream. A hash carries its version
//! in-band; [`ChromaHash::is_version_supported`] reports whether this build can
//! decode it. Decoding an unsupported (legacy v0.2–v0.5) hash does not error —
//! it produces unspecified output — so check the version first when handling
//! hashes of unknown provenance. The bitstream is a pre-1.0 **draft** and is not
//! yet guaranteed stable across releases.
//!
//! # Feature flags
//!
//! - **`simd`** *(default)* — enable the SIMD backends (AVX2/SSE2, NEON,
//!   wasm simd128). Each replays the scalar path op-for-op, so output is
//!   byte-identical; disabling it only changes speed.
//! - **`spec-vectors`** *(default)* — compile the shared `spec/test-vectors`
//!   integration test. Test-only; no effect on the library.
//! - **`simd-diff-tests`** / **`full`** — opt-in scalar-vs-SIMD differential
//!   tests (dev-only). See `TESTING.md`.

mod aspect;
mod batch;
mod bitpack;
mod color;
mod constants;
mod dct;
mod decode;
mod encode;
mod math_utils;
mod mulaw;
mod simd;
mod test_vectors;
mod transfer;

pub use batch::{BatchEncoder, ImageInput};
pub use constants::Gamut;

// Tuning interface for the comparison harness: not part of the public API.
// `Tunables::DEFAULT` is the v0.6 format; overrides exist solely so the
// corpus sweep (tools/comparison) can explore constants before they are
// locked into the spec.
#[doc(hidden)]
pub use constants::{AcLayout, LAYOUT_A, LAYOUT_B, LAYOUT_C, LAYOUT_D, Tunables};

/// ChromaHash: a 32-byte LQIP (Low Quality Image Placeholder).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChromaHash {
    hash: [u8; 32],
}

impl ChromaHash {
    /// Encode an image into a ChromaHash.
    ///
    /// - `w`, `h`: image dimensions (>= 1 each)
    /// - `rgba`: pixel data in RGBA format (4 bytes per pixel)
    /// - `gamut`: source color space
    ///
    /// # Panics
    ///
    /// Panics if `w` or `h` is 0, or if `rgba.len()` is not exactly
    /// `w * h * 4`.
    pub fn encode(w: u32, h: u32, rgba: &[u8], gamut: Gamut) -> Self {
        Self {
            hash: encode::encode(w, h, rgba, gamut),
        }
    }

    /// Decode a ChromaHash into an RGBA image.
    /// Returns (width, height, rgba_pixels).
    ///
    /// Output is unspecified for a hash this build does not support; check
    /// [`is_version_supported`](Self::is_version_supported) first when the hash's
    /// provenance is unknown.
    pub fn decode(&self) -> (u32, u32, Vec<u8>) {
        decode::decode(&self.hash)
    }

    /// Decode a ChromaHash into an RGBA image in the given output gamut.
    ///
    /// `output` selects the display gamut to render into: `Srgb`, `DisplayP3`,
    /// or `AdobeRgb`. Wide-gamut colors are rendered at full saturation when the
    /// target gamut can represent them, and clipped (relative-colorimetric) to
    /// the target otherwise. `Bt2020` and `ProPhotoRgb` are not display-output
    /// gamuts and fall back to sRGB. Returns (width, height, rgba_pixels).
    pub fn decode_to(&self, output: Gamut) -> (u32, u32, Vec<u8>) {
        decode::decode_to(&self.hash, output)
    }

    /// Decode a ChromaHash into an RGBA image, capped at the given max dimensions.
    /// Useful when the decoded size would exceed the source image dimensions.
    /// Returns (width, height, rgba_pixels).
    pub fn decode_capped(&self, max_w: u32, max_h: u32) -> (u32, u32, Vec<u8>) {
        decode::decode_capped(&self.hash, max_w, max_h)
    }

    /// Decode capped at the given max dimensions, in the given output gamut.
    /// Returns (width, height, rgba_pixels).
    pub fn decode_capped_to(&self, max_w: u32, max_h: u32, output: Gamut) -> (u32, u32, Vec<u8>) {
        decode::decode_capped_to(&self.hash, max_w, max_h, output)
    }

    /// Extract the average color without full decode.
    /// Returns [r, g, b, a] as u8 values.
    pub fn average_color(&self) -> [u8; 4] {
        decode::average_color(&self.hash)
    }

    /// Create a ChromaHash from raw 32-byte data.
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self { hash: bytes }
    }

    /// Whether this hash uses the v0.6 bitstream this library implements.
    ///
    /// Header bit 47 is 0 for v0.6 and 1 for the legacy v0.2–v0.5 bitstreams
    /// (which used a different coefficient selection, quantizer, and layout).
    /// Decoding an unsupported hash produces garbage, not an error — callers
    /// holding hashes of unknown provenance should check this first. Per spec §2.5.
    pub fn is_version_supported(&self) -> bool {
        (self.hash[5] >> 7) & 1 == 0
    }

    /// Encode with explicit tunables (comparison-harness sweep interface).
    #[doc(hidden)]
    pub fn encode_tuned(w: u32, h: u32, rgba: &[u8], gamut: Gamut, t: &Tunables) -> Self {
        Self {
            hash: encode::encode_with(w, h, rgba, gamut, t),
        }
    }

    /// Decode with explicit tunables (comparison-harness sweep interface).
    #[doc(hidden)]
    pub fn decode_tuned(&self, t: &Tunables) -> (u32, u32, Vec<u8>) {
        decode::decode_with(&self.hash, t)
    }

    /// Decode to an output gamut with explicit tunables (harness interface).
    #[doc(hidden)]
    pub fn decode_to_tuned(&self, output: Gamut, t: &Tunables) -> (u32, u32, Vec<u8>) {
        decode::decode_to_with(&self.hash, t, output)
    }

    /// Capped decode with explicit tunables (comparison-harness sweep interface).
    #[doc(hidden)]
    pub fn decode_capped_tuned(&self, max_w: u32, max_h: u32, t: &Tunables) -> (u32, u32, Vec<u8>) {
        decode::decode_capped_with(&self.hash, max_w, max_h, t)
    }

    /// Capped decode to an output gamut with explicit tunables (harness interface).
    #[doc(hidden)]
    pub fn decode_capped_to_tuned(
        &self,
        max_w: u32,
        max_h: u32,
        output: Gamut,
        t: &Tunables,
    ) -> (u32, u32, Vec<u8>) {
        decode::decode_capped_to_with(&self.hash, max_w, max_h, t, output)
    }

    /// Get the raw 32-byte hash data.
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Create a solid-color RGBA image.
    fn solid_image(w: u32, h: u32, r: u8, g: u8, b: u8, a: u8) -> Vec<u8> {
        let pixel_count = (w * h) as usize;
        let mut rgba = vec![0u8; pixel_count * 4];
        for i in 0..pixel_count {
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = a;
        }
        rgba
    }

    /// Create a horizontal gradient RGBA image.
    fn horizontal_gradient(w: u32, h: u32) -> Vec<u8> {
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let t = x as f64 / (w - 1).max(1) as f64;
                let idx = ((y * w + x) * 4) as usize;
                rgba[idx] = (t * 255.0) as u8;
                rgba[idx + 1] = ((1.0 - t) * 255.0) as u8;
                rgba[idx + 2] = 128;
                rgba[idx + 3] = 255;
            }
        }
        rgba
    }

    /// Create a vertical gradient RGBA image.
    fn vertical_gradient(w: u32, h: u32) -> Vec<u8> {
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            let t = y as f64 / (h - 1).max(1) as f64;
            for x in 0..w {
                let idx = ((y * w + x) * 4) as usize;
                rgba[idx] = (t * 255.0) as u8;
                rgba[idx + 1] = (t * 128.0) as u8;
                rgba[idx + 2] = ((1.0 - t) * 255.0) as u8;
                rgba[idx + 3] = 255;
            }
        }
        rgba
    }

    #[test]
    fn encode_produces_32_bytes() {
        let rgba = solid_image(4, 4, 128, 128, 128, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        assert_eq!(hash.as_bytes().len(), 32);
    }

    #[test]
    fn solid_color_roundtrip() {
        let rgba = solid_image(4, 4, 200, 100, 50, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        let avg = hash.average_color();

        // DC color should be close to input
        assert!(
            (avg[0] as i32 - 200).unsigned_abs() <= 3,
            "R: expected ~200, got {}",
            avg[0]
        );
        assert!(
            (avg[1] as i32 - 100).unsigned_abs() <= 3,
            "G: expected ~100, got {}",
            avg[1]
        );
        assert!(
            (avg[2] as i32 - 50).unsigned_abs() <= 3,
            "B: expected ~50, got {}",
            avg[2]
        );
        assert_eq!(avg[3], 255);
    }

    #[test]
    fn solid_black_roundtrip() {
        let rgba = solid_image(4, 4, 0, 0, 0, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        let avg = hash.average_color();
        assert!(avg[0] <= 2, "R should be ~0, got {}", avg[0]);
        assert!(avg[1] <= 2, "G should be ~0, got {}", avg[1]);
        assert!(avg[2] <= 2, "B should be ~0, got {}", avg[2]);
    }

    #[test]
    fn solid_white_roundtrip() {
        let rgba = solid_image(4, 4, 255, 255, 255, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        let avg = hash.average_color();
        assert!(avg[0] >= 253, "R should be ~255, got {}", avg[0]);
        assert!(avg[1] >= 253, "G should be ~255, got {}", avg[1]);
        assert!(avg[2] >= 253, "B should be ~255, got {}", avg[2]);
    }

    #[test]
    fn has_alpha_flag_set_correctly() {
        // Opaque
        let rgba_opaque = solid_image(4, 4, 128, 128, 128, 255);
        let hash = ChromaHash::encode(4, 4, &rgba_opaque, Gamut::Srgb);
        let has_alpha = (hash.as_bytes()[5] >> 6) & 1;
        assert_eq!(has_alpha, 0, "opaque image should not have alpha flag");

        // Transparent
        let rgba_alpha = solid_image(4, 4, 128, 128, 128, 128);
        let hash = ChromaHash::encode(4, 4, &rgba_alpha, Gamut::Srgb);
        let header: u64 = (0..6).fold(0u64, |acc, i| {
            acc | ((hash.as_bytes()[i] as u64) << (i * 8))
        });
        let has_alpha = ((header >> 46) & 1) == 1;
        assert!(has_alpha, "semi-transparent image should have alpha flag");
    }

    #[test]
    fn decode_produces_valid_dimensions() {
        let rgba = solid_image(4, 4, 128, 64, 32, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        let (w, h, pixels) = hash.decode();
        assert!(w > 0 && w <= 32);
        assert!(h > 0 && h <= 32);
        assert_eq!(pixels.len(), (w * h * 4) as usize);
    }

    #[test]
    fn decode_solid_color_pixels_exactly_uniform() {
        // v0.6's exact-zero quantizer means a solid color stores all-zero AC,
        // so every decoded pixel must be bit-identical — not just close.
        let rgba = solid_image(4, 4, 128, 128, 128, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        let (w, h, pixels) = hash.decode();

        let first = &pixels[0..4];
        for i in 0..(w * h) as usize {
            assert_eq!(
                &pixels[i * 4..i * 4 + 4],
                first,
                "pixel {i} diverges from pixel 0"
            );
        }
    }

    #[test]
    fn solid_corner_colors_roundtrip_closely() {
        // The decode-aware DC search must keep saturated gamut-corner solids
        // near-exact. v0.5 decoded solid blue as (0, 58, 214) — ΔE00 7.75.
        for &(r, g, b) in &[
            (0u8, 0u8, 255u8),
            (255, 0, 0),
            (0, 255, 0),
            (255, 255, 0),
            (255, 0, 255),
            (0, 255, 255),
        ] {
            let rgba = solid_image(8, 8, r, g, b, 255);
            let hash = ChromaHash::encode(8, 8, &rgba, Gamut::Srgb);
            let avg = hash.average_color();
            let err = (avg[0] as i32 - r as i32)
                .abs()
                .max((avg[1] as i32 - g as i32).abs())
                .max((avg[2] as i32 - b as i32).abs());
            // 8/255 per channel at a gamut corner is well under 1 ΔE00 in the
            // insensitive regions (green) and ~1 in the sensitive ones (blue);
            // v0.5's failure mode was 58/255 on the blue corner.
            assert!(
                err <= 8,
                "solid ({r},{g},{b}) decoded as ({},{},{}) — max channel err {err}",
                avg[0],
                avg[1],
                avg[2]
            );
        }
    }

    #[test]
    fn strip_capped_decode_is_not_blank() {
        // v0.5 regression: a 1×100 red→blue strip decoded at max dims (1, 100)
        // rendered solid white (aliased cx=2 basis at a 1-px raster).
        let h = 100u32;
        let mut rgba = vec![0u8; (h * 4) as usize];
        for y in 0..h as usize {
            let t = y as f64 / 99.0;
            rgba[y * 4] = (255.0 * (1.0 - t)) as u8;
            rgba[y * 4 + 2] = (255.0 * t) as u8;
            rgba[y * 4 + 3] = 255;
        }
        let hash = ChromaHash::encode(1, h, &rgba, Gamut::Srgb);
        let (dw, dh, pixels) = hash.decode_capped(1, h);
        assert_eq!(dw, 1);
        assert!(dh > 1);

        // Red must dominate at the top and blue at the bottom.
        let top = &pixels[0..4];
        let bottom = &pixels[(dh as usize - 1) * 4..];
        assert!(
            top[0] > top[2] + 50,
            "top pixel should be red-dominant: {top:?}"
        );
        assert!(
            bottom[2] > bottom[0] + 50,
            "bottom pixel should be blue-dominant: {bottom:?}"
        );
    }

    #[test]
    fn all_layouts_fit_bit_budget_for_all_aspects() {
        // encode_with debug_asserts the exact AC payload bit position; running
        // every layout over opaque and transparent images across extreme
        // dimensions exercises those asserts for both alpha modes.
        for layout in [LAYOUT_A, LAYOUT_B, LAYOUT_C, LAYOUT_D] {
            let t = Tunables {
                layout,
                ..Tunables::DEFAULT
            };
            for &(w, h) in &[(1u32, 1u32), (1, 100), (100, 1), (16, 9), (9, 16), (32, 2)] {
                let opaque = solid_image(w, h, 200, 100, 50, 255);
                let translucent = solid_image(w, h, 200, 100, 50, 128);
                let h1 = ChromaHash::encode_tuned(w, h, &opaque, Gamut::Srgb, &t);
                let h2 = ChromaHash::encode_tuned(w, h, &translucent, Gamut::Srgb, &t);
                let (dw, dh, px) = h1.decode_tuned(&t);
                assert_eq!(px.len(), (dw * dh * 4) as usize);
                let (dw2, dh2, px2) = h2.decode_tuned(&t);
                assert_eq!(px2.len(), (dw2 * dh2 * 4) as usize);
            }
        }
    }

    #[test]
    fn version_support_check() {
        let rgba = solid_image(4, 4, 128, 128, 128, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        assert!(hash.is_version_supported(), "v0.6 hash must be supported");

        // Flip bit 47 to simulate a legacy v0.2–v0.5 hash.
        let mut legacy = *hash.as_bytes();
        legacy[5] |= 0x80;
        assert!(
            !ChromaHash::from_bytes(legacy).is_version_supported(),
            "bit 47 = 1 must be reported as unsupported"
        );
    }

    #[test]
    fn gradient_encode_decode() {
        let w = 16;
        let h = 16;
        let rgba = horizontal_gradient(w, h);
        let hash = ChromaHash::encode(w, h, &rgba, Gamut::Srgb);
        let (dw, dh, _pixels) = hash.decode();
        assert!(dw > 0 && dh > 0);
    }

    #[test]
    fn vertical_gradient_encode_decode() {
        let w = 16;
        let h = 16;
        let rgba = vertical_gradient(w, h);
        let hash = ChromaHash::encode(w, h, &rgba, Gamut::Srgb);
        let (dw, dh, _pixels) = hash.decode();
        assert!(dw > 0 && dh > 0);
    }

    #[test]
    fn one_by_one_pixel() {
        let rgba = solid_image(1, 1, 200, 100, 50, 255);
        let hash = ChromaHash::encode(1, 1, &rgba, Gamut::Srgb);
        assert_eq!(hash.as_bytes().len(), 32);
        let avg = hash.average_color();
        assert!(
            (avg[0] as i32 - 200).unsigned_abs() <= 3,
            "1×1 R: expected ~200, got {}",
            avg[0]
        );
    }

    #[test]
    fn large_image_100x100() {
        let w = 100;
        let h = 100;
        let rgba = horizontal_gradient(w, h);
        let hash = ChromaHash::encode(w, h, &rgba, Gamut::Srgb);
        assert_eq!(hash.as_bytes().len(), 32);
    }

    #[test]
    fn version_bit_clear() {
        // v0.6: bit 47 of the header is 0 (v0.2–v0.5 hashes have it set to 1),
        // making v0.6 hashes distinguishable in-band from all prior versions.
        let rgba = solid_image(4, 4, 128, 128, 128, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        let header: u64 = (0..6).fold(0u64, |acc, i| {
            acc | ((hash.as_bytes()[i] as u64) << (i * 8))
        });
        let version = (header >> 47) & 1;
        assert_eq!(version, 0, "v0.6 must clear bit 47");
    }

    #[test]
    fn large_image_encode_decode() {
        // Full-res encoding: dimensions well beyond the old 100×100 limit
        let w = 200u32;
        let h = 150u32;
        let rgba = horizontal_gradient(w, h);
        let hash = ChromaHash::encode(w, h, &rgba, Gamut::Srgb);
        assert_eq!(hash.as_bytes().len(), 32);
        let (dw, dh, pixels) = hash.decode();
        assert!(dw > 0 && dh > 0);
        assert_eq!(pixels.len(), (dw * dh * 4) as usize);
    }

    #[test]
    fn panorama_encode_decode() {
        // 4:1 panorama exercises adaptive grid (should produce 10×5 for L)
        let w = 200u32;
        let h = 50u32;
        let rgba = horizontal_gradient(w, h);
        let hash = ChromaHash::encode(w, h, &rgba, Gamut::Srgb);
        assert_eq!(hash.as_bytes().len(), 32);
        let (dw, dh, pixels) = hash.decode();
        assert!(dw > dh, "panorama output should be wider than tall");
        assert_eq!(pixels.len(), (dw * dh * 4) as usize);
    }

    #[test]
    fn various_aspect_ratios() {
        for &(w, h) in &[(16, 4), (4, 16), (10, 10), (3, 7), (100, 25)] {
            let rgba = solid_image(w, h, 128, 64, 32, 255);
            let hash = ChromaHash::encode(w, h, &rgba, Gamut::Srgb);
            let (dw, dh, pixels) = hash.decode();
            assert!(dw > 0 && dh > 0, "decode dims should be > 0 for {w}×{h}");
            assert_eq!(
                pixels.len(),
                (dw * dh * 4) as usize,
                "pixel data length mismatch for {w}×{h}"
            );
        }
    }

    #[test]
    fn all_gamuts_produce_output() {
        let rgba = solid_image(4, 4, 200, 100, 50, 255);
        for gamut in [
            Gamut::Srgb,
            Gamut::DisplayP3,
            Gamut::AdobeRgb,
            Gamut::Bt2020,
            Gamut::ProPhotoRgb,
        ] {
            let hash = ChromaHash::encode(4, 4, &rgba, gamut);
            assert_eq!(
                hash.as_bytes().len(),
                32,
                "gamut {gamut:?} should produce 32 bytes"
            );
        }
    }

    #[test]
    fn transparency_roundtrip() {
        let w = 8;
        let h = 8;
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        // Top half opaque red, bottom half transparent
        for y in 0..h {
            for x in 0..w {
                let idx = ((y * w + x) * 4) as usize;
                if y < h / 2 {
                    rgba[idx] = 255;
                    rgba[idx + 3] = 255;
                } else {
                    rgba[idx + 3] = 0;
                }
            }
        }
        let hash = ChromaHash::encode(w, h, &rgba, Gamut::Srgb);
        let header: u64 = (0..6).fold(0u64, |acc, i| {
            acc | ((hash.as_bytes()[i] as u64) << (i * 8))
        });
        let has_alpha = ((header >> 46) & 1) == 1;
        assert!(has_alpha, "should detect alpha");

        let (dw, dh, pixels) = hash.decode();
        assert!(dw > 0 && dh > 0);
        // Alpha values should vary
        let a_min = pixels.iter().skip(3).step_by(4).copied().min().unwrap();
        let a_max = pixels.iter().skip(3).step_by(4).copied().max().unwrap();
        assert!(a_max > a_min, "alpha should vary across decoded image");
    }

    #[test]
    fn from_bytes_roundtrip() {
        let rgba = solid_image(4, 4, 128, 64, 32, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        let bytes = *hash.as_bytes();
        let hash2 = ChromaHash::from_bytes(bytes);
        assert_eq!(hash, hash2);
    }

    #[test]
    fn deterministic_encoding() {
        let rgba = horizontal_gradient(16, 16);
        let hash1 = ChromaHash::encode(16, 16, &rgba, Gamut::Srgb);
        let hash2 = ChromaHash::encode(16, 16, &rgba, Gamut::Srgb);
        assert_eq!(
            hash1.as_bytes(),
            hash2.as_bytes(),
            "encoding should be deterministic"
        );
    }

    #[test]
    fn highfreq_roundtrip_golden() {
        // A spectrally rich image is the only thing that pins decode's synthesis
        // window and its cx≥w / cy≥h frequency filter: every spec vector is a
        // smooth gradient, so its high-frequency AC is ≈0 and those paths go
        // unexercised. Hash and decoded pixels are this build's own output — a
        // regression (or surviving mutant) that shifts them is caught.
        let (w, h) = (16u32, 16u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                rgba[i] = ((x * 37 + y * 101) % 256) as u8;
                rgba[i + 1] = ((x * 53) ^ (y * 191)) as u8;
                rgba[i + 2] = ((x * x + y * y * 3) % 256) as u8;
                rgba[i + 3] = 255;
            }
        }
        let hash = ChromaHash::encode(w, h, &rgba, Gamut::Srgb);
        assert_eq!(
            hash.as_bytes(),
            &[
                79, 97, 48, 16, 8, 32, 70, 4, 144, 72, 52, 104, 169, 132, 70, 18, 244, 156, 98,
                102, 49, 162, 169, 8, 152, 26, 44, 105, 119, 30, 166, 89
            ]
        );

        // Full render: the window-attenuated high-frequency coefficients carry
        // real amplitude here, so `ac · weight` (not `ac / weight`) is pinned.
        let (dw, dh, px) = hash.decode();
        assert_eq!((dw, dh), (32, 32));
        let p = |i: usize| &px[i * 4..i * 4 + 4];
        assert_eq!(p(0), [84, 67, 0, 255]);
        assert_eq!(p(17), [145, 122, 70, 255]);
        assert_eq!(p(500), [146, 139, 154, 255]);
        assert_eq!(p(1000), [150, 135, 147, 255]);

        // Aggressive cap: coefficients with cx ≥ 4 or cy ≥ 4 must be dropped, not
        // kept — asserting the whole 4×4 pins the off-axis pixels where those
        // dropped bases are non-zero (so `||` can't degrade to `&&`).
        let (cw, ch, cpx) = hash.decode_capped(4, 4);
        assert_eq!((cw, ch), (4, 4));
        let expected: [[u8; 4]; 16] = [
            [127, 110, 0, 255],
            [156, 131, 42, 255],
            [143, 127, 115, 255],
            [137, 136, 198, 255],
            [152, 140, 125, 255],
            [137, 127, 124, 255],
            [147, 137, 153, 255],
            [144, 135, 165, 255],
            [145, 136, 146, 255],
            [141, 134, 148, 255],
            [143, 137, 142, 255],
            [142, 133, 125, 255],
            [137, 127, 145, 255],
            [149, 133, 138, 255],
            [143, 130, 131, 255],
            [133, 129, 139, 255],
        ];
        for (i, e) in expected.iter().enumerate() {
            assert_eq!(&cpx[i * 4..i * 4 + 4], e, "capped pixel {i}");
        }

        // The synthesis window is only active under non-default tunables
        // (w_min < 1); the default render keeps every weight at 1.0, where
        // `ac * weight` and `ac / weight` coincide. Decode the same hash with the
        // window engaged so the per-coefficient weight application is pinned.
        let windowed = Tunables {
            w_min_l: 0.55,
            w_exp_l: 2,
            w_min_c: 0.6,
            w_exp_c: 2,
            ..Tunables::DEFAULT
        };
        let (ww, wh, wpx) = hash.decode_tuned(&windowed);
        assert_eq!((ww, wh), (32, 32));
        let wp = |i: usize| &wpx[i * 4..i * 4 + 4];
        assert_eq!(wp(0), [105, 90, 0, 255]);
        assert_eq!(wp(17), [144, 126, 93, 255]);
        assert_eq!(wp(500), [145, 137, 148, 255]);
        assert_eq!(wp(1000), [147, 134, 144, 255]);
    }

    #[test]
    fn tuned_default_matches_public_api() {
        // The doc-hidden `*_tuned` sweep entry points must be exactly the public
        // API at `Tunables::DEFAULT`. Comparing full results (not just lengths)
        // pins them against whole-body replacement with a trivial tuple.
        for &(w, h) in &[(8u32, 6u32), (1, 1), (16, 9), (9, 16)] {
            let rgba = horizontal_gradient(w, h);
            let hash = ChromaHash::encode(w, h, &rgba, Gamut::Srgb);
            assert_eq!(
                hash.decode_tuned(&Tunables::DEFAULT),
                hash.decode(),
                "decode_tuned diverges from decode for {w}×{h}"
            );
            assert_eq!(
                hash.decode_capped_tuned(4, 4, &Tunables::DEFAULT),
                hash.decode_capped(4, 4),
                "decode_capped_tuned diverges from decode_capped for {w}×{h}"
            );
        }
    }

    #[test]
    fn gamut_wrappers_match_public_api() {
        // The gamut-aware decode wrappers — decode_capped_to (public) and the
        // doc-hidden decode_to_tuned / decode_capped_to_tuned — are otherwise
        // never called, so whole-body replacement with a trivial tuple survives.
        // Pin each against the already-golden free-function behaviour at
        // Tunables::DEFAULT, and assert the output gamut actually flows through.
        //
        // A saturated P3 green clips in sRGB but not in P3, so the renders differ
        // by gamut — that gives both an equality oracle (per gamut) and an
        // inequality oracle (P3 ≠ sRGB) that the constant-tuple mutants fail.
        let p3_green = [0u8, 200, 80, 255].repeat(16);
        for &(w, h) in &[(8u32, 6u32), (1, 1), (16, 9), (9, 16)] {
            let mut rgba = vec![0u8; (w * h * 4) as usize];
            for px in rgba.chunks_exact_mut(4) {
                px.copy_from_slice(&p3_green[0..4]);
            }
            let hash = ChromaHash::encode(w, h, &rgba, Gamut::DisplayP3);

            for output in [Gamut::Srgb, Gamut::DisplayP3, Gamut::AdobeRgb] {
                assert_eq!(
                    hash.decode_to_tuned(output, &Tunables::DEFAULT),
                    hash.decode_to(output),
                    "decode_to_tuned diverges from decode_to for {w}×{h} {output:?}"
                );
                assert_eq!(
                    hash.decode_capped_to_tuned(4, 4, output, &Tunables::DEFAULT),
                    hash.decode_capped_to(4, 4, output),
                    "decode_capped_to_tuned diverges from decode_capped_to for {w}×{h} {output:?}"
                );
            }

            // decode_capped_to at sRGB must equal the non-gamut decode_capped.
            assert_eq!(
                hash.decode_capped_to(4, 4, Gamut::Srgb),
                hash.decode_capped(4, 4),
                "decode_capped_to(Srgb) diverges from decode_capped for {w}×{h}"
            );

            // The output gamut must change the pixels, not be ignored.
            assert_ne!(
                hash.decode_to_tuned(Gamut::DisplayP3, &Tunables::DEFAULT),
                hash.decode_to_tuned(Gamut::Srgb, &Tunables::DEFAULT),
                "decode_to_tuned must honour the output gamut for {w}×{h}"
            );
            assert_ne!(
                hash.decode_capped_to(4, 4, Gamut::DisplayP3),
                hash.decode_capped_to(4, 4, Gamut::Srgb),
                "decode_capped_to must honour the output gamut for {w}×{h}"
            );
        }
    }
}
