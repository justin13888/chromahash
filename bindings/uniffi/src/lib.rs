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

use std::sync::{Arc, Mutex};

use chromahash::{
    BatchEncoder as CoreBatch, ChromaHash as CoreHash, Gamut as CoreGamut, ImageInput as CoreInput,
};

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

    /// Decode into an sRGB RGBA image (≤ 32×32 px).
    pub fn decode(&self) -> DecodeResult {
        self.decode_to(Gamut::Srgb)
    }

    /// Decode into an RGBA image in the given output gamut (sRGB / Display P3 /
    /// Adobe RGB; others fall back to sRGB).
    pub fn decode_to(&self, output: Gamut) -> DecodeResult {
        let (width, height, rgba) = self.inner.decode_to(output.into());
        DecodeResult {
            width: width as i32,
            height: height as i32,
            rgba,
        }
    }

    /// Decode into an sRGB RGBA image, capped at the given maximum dimensions.
    pub fn decode_capped(&self, max_w: u32, max_h: u32) -> DecodeResult {
        self.decode_capped_to(max_w, max_h, Gamut::Srgb)
    }

    /// Capped decode (see `decode_capped`) in the given output gamut.
    pub fn decode_capped_to(&self, max_w: u32, max_h: u32, output: Gamut) -> DecodeResult {
        let (width, height, rgba) = self.inner.decode_capped_to(max_w, max_h, output.into());
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

    /// Whether this hash uses the v0.6 bitstream this library implements. Decoding
    /// an unsupported (legacy v0.2–v0.5) hash produces garbage, not an error —
    /// check this first for hashes of unknown provenance. Per spec §2.5.
    pub fn is_version_supported(&self) -> bool {
        self.inner.is_version_supported()
    }
}

/// One image to encode in a batch. `rgba` is RGBA, 4 bytes/pixel
/// (length == `w * h * 4`). Mirrors [`chromahash::ImageInput`].
#[derive(Debug, Clone, uniffi::Record)]
pub struct ImageInput {
    pub w: u32,
    pub h: u32,
    pub rgba: Vec<u8>,
    pub gamut: Gamut,
}

/// A stateful batch encoder backed by a persistent worker pool. Output is
/// byte-identical to calling [`ChromaHash::encode`] on each image individually.
///
/// The core encoder is `!Sync` (it holds an `mpsc::Sender`), so it is wrapped in a
/// `Mutex` here to satisfy UniFFI's `Send + Sync` requirement for objects:
/// concurrent `encode_batch` calls on the same encoder serialize, but each call
/// still saturates the worker pool internally.
#[derive(uniffi::Object)]
pub struct BatchEncoder {
    inner: Mutex<CoreBatch>,
}

#[uniffi::export]
impl BatchEncoder {
    /// Create an encoder with a worker pool sized to the available parallelism.
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(CoreBatch::new()),
        })
    }

    /// Create an encoder with an explicit worker count (clamped to ≥ 1).
    #[uniffi::constructor]
    pub fn with_threads(threads: u32) -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(CoreBatch::with_threads(threads as usize)),
        })
    }

    /// Encode every item, returning hashes in the same order as `items`.
    pub fn encode_batch(&self, items: Vec<ImageInput>) -> Vec<Arc<ChromaHash>> {
        let inputs: Vec<CoreInput> = items
            .into_iter()
            .map(|it| CoreInput {
                w: it.w,
                h: it.h,
                rgba: Arc::from(it.rgba),
                gamut: it.gamut.into(),
            })
            .collect();
        let guard = self.inner.lock().expect("batch encoder mutex poisoned");
        guard
            .encode_batch(&inputs)
            .into_iter()
            .map(|inner| Arc::new(ChromaHash { inner }))
            .collect()
    }
}
