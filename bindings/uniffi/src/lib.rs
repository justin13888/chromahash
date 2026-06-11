//! UniFFI binding crate for ChromaHash.
//!
//! Exposes the zero-dependency [`chromahash`] core to Kotlin/Android (and any other
//! UniFFI target) across the FFI boundary. The core crate is left untouched and
//! dependency-free; only this thin wrapper carries the `uniffi` dependency.
//!
//! The generated Kotlin lives in package `io.chromahash.ffi` (see `uniffi.toml`) and
//! mirrors the pure-JVM `chromahash` API 1:1, with two deliberate differences at the
//! FFI boundary:
//!   - [`ChromaHash::from_bytes`] is **fallible** (throws on a non-32-byte input)
//!     rather than panicking — a panic across FFI is unsafe.
//!   - Integer record fields are signed (`i32` → Kotlin `Int`), matching the
//!     pure-Kotlin `DecodeResult`/`RgbaColor` types and Android's `Bitmap`/ARGB APIs.

use std::sync::Arc;

use chromahash::{ChromaHash as CoreHash, Gamut as CoreGamut};

uniffi::setup_scaffolding!();

/// Source/target color space. Mirrors [`chromahash::Gamut`].
#[derive(Debug, Clone, Copy, uniffi::Enum)]
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

/// Errors surfaced across the FFI boundary. Maps to a thrown Kotlin exception.
#[derive(Debug, uniffi::Error)]
pub enum ChromaHashError {
    /// `from_bytes` was called with a buffer that was not exactly 32 bytes long.
    InvalidLength { got: u32 },
}

impl std::fmt::Display for ChromaHashError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChromaHashError::InvalidLength { got } => {
                write!(f, "expected a 32-byte ChromaHash, got {got} bytes")
            }
        }
    }
}

impl std::error::Error for ChromaHashError {}

/// A decoded RGBA image (≤ 32×32 px). `rgba` is row-major, 4 bytes/pixel (R, G, B, A).
#[derive(Debug, uniffi::Record)]
pub struct DecodeResult {
    pub width: i32,
    pub height: i32,
    pub rgba: Vec<u8>,
}

/// An 8-bit-per-channel RGBA color. Each field is in the range `0..=255`.
#[derive(Debug, uniffi::Record)]
pub struct RgbaColor {
    pub r: i32,
    pub g: i32,
    pub b: i32,
    pub a: i32,
}

/// A 32-byte ChromaHash placeholder. Mirrors [`chromahash::ChromaHash`].
#[derive(Debug, uniffi::Object)]
pub struct ChromaHash {
    inner: CoreHash,
}

#[uniffi::export]
impl ChromaHash {
    /// Encode an image (RGBA, 4 bytes/pixel) into a 32-byte ChromaHash.
    #[uniffi::constructor]
    pub fn encode(w: u32, h: u32, rgba: Vec<u8>, gamut: Gamut) -> Arc<Self> {
        Arc::new(Self {
            inner: CoreHash::encode(w, h, &rgba, gamut.into()),
        })
    }

    /// Reconstruct from a raw 32-byte hash. Throws [`ChromaHashError::InvalidLength`]
    /// if `bytes` is not exactly 32 bytes long.
    #[uniffi::constructor]
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Arc<Self>, ChromaHashError> {
        let arr: [u8; 32] =
            bytes
                .as_slice()
                .try_into()
                .map_err(|_| ChromaHashError::InvalidLength {
                    got: bytes.len() as u32,
                })?;
        Ok(Arc::new(Self {
            inner: CoreHash::from_bytes(arr),
        }))
    }

    /// Decode into an RGBA image (≤ 32×32 px).
    pub fn decode(&self) -> DecodeResult {
        let (width, height, rgba) = self.inner.decode();
        DecodeResult {
            width: width as i32,
            height: height as i32,
            rgba,
        }
    }

    /// Decode into an RGBA image, capped at the given maximum dimensions.
    pub fn decode_capped(&self, max_w: u32, max_h: u32) -> DecodeResult {
        let (width, height, rgba) = self.inner.decode_capped(max_w, max_h);
        DecodeResult {
            width: width as i32,
            height: height as i32,
            rgba,
        }
    }

    /// Extract the average color without a full decode.
    pub fn average_color(&self) -> RgbaColor {
        let [r, g, b, a] = self.inner.average_color();
        RgbaColor {
            r: r as i32,
            g: g as i32,
            b: b as i32,
            a: a as i32,
        }
    }

    /// The raw 32-byte hash data.
    pub fn as_bytes(&self) -> Vec<u8> {
        self.inner.as_bytes().to_vec()
    }
}
