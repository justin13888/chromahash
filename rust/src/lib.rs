mod aspect;
mod bitpack;
mod color;
mod constants;
mod dct;
mod decode;
mod encode;
mod math_utils;
mod mulaw;
mod test_vectors;
mod transfer;

pub use constants::Gamut;

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
    pub fn encode(w: u32, h: u32, rgba: &[u8], gamut: Gamut) -> Self {
        Self {
            hash: encode::encode(w, h, rgba, gamut),
        }
    }

    /// Decode a ChromaHash into an RGBA image.
    /// Returns (width, height, rgba_pixels).
    pub fn decode(&self) -> (u32, u32, Vec<u8>) {
        decode::decode(&self.hash)
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
    fn decode_solid_color_pixels_uniform() {
        let rgba = solid_image(4, 4, 128, 128, 128, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        let (w, h, pixels) = hash.decode();

        // All decoded pixels should be similar for a solid color
        let r0 = pixels[0];
        let g0 = pixels[1];
        let b0 = pixels[2];
        for i in 0..(w * h) as usize {
            let r = pixels[i * 4];
            let g = pixels[i * 4 + 1];
            let b = pixels[i * 4 + 2];
            assert!(
                (r as i32 - r0 as i32).unsigned_abs() <= 2,
                "pixel {i} R diverges: {r} vs {r0}"
            );
            assert!(
                (g as i32 - g0 as i32).unsigned_abs() <= 2,
                "pixel {i} G diverges: {g} vs {g0}"
            );
            assert!(
                (b as i32 - b0 as i32).unsigned_abs() <= 2,
                "pixel {i} B diverges: {b} vs {b0}"
            );
        }
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
    fn version_bit_set() {
        // v0.2: bit 47 of header must be 1
        let rgba = solid_image(4, 4, 128, 128, 128, 255);
        let hash = ChromaHash::encode(4, 4, &rgba, Gamut::Srgb);
        let header: u64 = (0..6).fold(0u64, |acc, i| {
            acc | ((hash.as_bytes()[i] as u64) << (i * 8))
        });
        let version = (header >> 47) & 1;
        assert_eq!(version, 1, "v0.2 must set bit 47 to 1");
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
}
