//! WebAssembly bindings for ChromaHash.
//!
//! A thin `wasm-bindgen` wrapper over the zero-dependency [`chromahash`] core,
//! built with `wasm-pack` and consumed by the TypeScript web package. Exposes the
//! full encode + decode surface; output is byte-identical to every other
//! ChromaHash implementation.
//!
//! Batch encoding is deliberately *not* exposed here: WebAssembly cannot use the
//! core's worker pool without `SharedArrayBuffer` + COOP/COEP, so the TypeScript
//! layer implements `encodeBatch` by looping this single-image `encode`.

use chromahash::{ChromaHash as CoreHash, Gamut as CoreGamut};
use wasm_bindgen::prelude::*;

/// Source/target color space. Mirrors [`chromahash::Gamut`].
#[wasm_bindgen]
#[derive(Debug, Clone, Copy)]
pub enum Gamut {
    Srgb,
    DisplayP3,
    AdobeRgb,
    Bt2020,
    ProPhotoRgb,
}

impl From<Gamut> for CoreGamut {
    fn from(g: Gamut) -> Self {
        match g {
            Gamut::Srgb => CoreGamut::Srgb,
            Gamut::DisplayP3 => CoreGamut::DisplayP3,
            Gamut::AdobeRgb => CoreGamut::AdobeRgb,
            Gamut::Bt2020 => CoreGamut::Bt2020,
            Gamut::ProPhotoRgb => CoreGamut::ProPhotoRgb,
        }
    }
}

/// A decoded RGBA image (≤ 32×32 px). `rgba` is row-major, 4 bytes/pixel
/// (R, G, B, A) and crosses to JS as a `Uint8Array`.
#[wasm_bindgen]
pub struct DecodeResult {
    #[wasm_bindgen(readonly)]
    pub width: u32,
    #[wasm_bindgen(readonly)]
    pub height: u32,
    rgba: Vec<u8>,
}

#[wasm_bindgen]
impl DecodeResult {
    #[wasm_bindgen(getter)]
    pub fn rgba(&self) -> Vec<u8> {
        self.rgba.clone()
    }
}

/// A 32-byte ChromaHash placeholder. Mirrors [`chromahash::ChromaHash`].
#[wasm_bindgen]
pub struct ChromaHash {
    inner: CoreHash,
}

#[wasm_bindgen]
impl ChromaHash {
    /// Encode an RGBA image (4 bytes/pixel) into a 32-byte ChromaHash.
    pub fn encode(w: u32, h: u32, rgba: &[u8], gamut: Gamut) -> ChromaHash {
        ChromaHash {
            inner: CoreHash::encode(w, h, rgba, gamut.into()),
        }
    }

    /// Reconstruct from a raw 32-byte hash. Throws if `bytes` is not exactly 32
    /// bytes long.
    #[wasm_bindgen(js_name = fromBytes)]
    pub fn from_bytes(bytes: &[u8]) -> Result<ChromaHash, JsError> {
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| JsError::new("expected a 32-byte ChromaHash"))?;
        Ok(ChromaHash {
            inner: CoreHash::from_bytes(arr),
        })
    }

    /// Decode into an RGBA image (≤ 32×32 px).
    pub fn decode(&self) -> DecodeResult {
        let (width, height, rgba) = self.inner.decode();
        DecodeResult {
            width,
            height,
            rgba,
        }
    }

    /// Decode into an RGBA image, capped at the given maximum dimensions.
    #[wasm_bindgen(js_name = decodeCapped)]
    pub fn decode_capped(&self, max_w: u32, max_h: u32) -> DecodeResult {
        let (width, height, rgba) = self.inner.decode_capped(max_w, max_h);
        DecodeResult {
            width,
            height,
            rgba,
        }
    }

    /// Extract the average color without a full decode, as `[r, g, b, a]`.
    #[wasm_bindgen(js_name = averageColor)]
    pub fn average_color(&self) -> Vec<u8> {
        self.inner.average_color().to_vec()
    }

    /// The raw 32-byte hash data.
    #[wasm_bindgen(js_name = asBytes)]
    pub fn as_bytes(&self) -> Vec<u8> {
        self.inner.as_bytes().to_vec()
    }

    /// Whether this hash uses the v0.6 bitstream this library implements. Decoding
    /// an unsupported (legacy v0.2–v0.5) hash produces garbage, not an error.
    #[wasm_bindgen(js_name = isVersionSupported)]
    pub fn is_version_supported(&self) -> bool {
        self.inner.is_version_supported()
    }
}
