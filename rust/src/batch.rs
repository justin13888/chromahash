//! Stateful, self-parallelizing batch encoder.
//!
//! [`BatchEncoder`] owns a persistent pool of worker threads (created once,
//! reused across many [`BatchEncoder::encode_batch`] calls) so high-frequency
//! and bulk workloads avoid per-call thread spawning while saturating all
//! available cores. Output is byte-identical to calling [`ChromaHash::encode`]
//! on each image individually.

use crate::{ChromaHash, Gamut};
use std::num::NonZeroUsize;
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

/// One image to encode in a batch.
///
/// Pixel data is held as an [`Arc<[u8]>`] so items can be cheaply handed to
/// worker threads (a reference-count bump, not a copy) — and so the persistent
/// pool can outlive any single batch call without borrowing the caller's data.
#[derive(Debug, Clone)]
pub struct ImageInput {
    /// Image width (>= 1).
    pub w: u32,
    /// Image height (>= 1).
    pub h: u32,
    /// Pixel data in RGBA format (4 bytes per pixel, length == `w * h * 4`).
    pub rgba: Arc<[u8]>,
    /// Source color space.
    pub gamut: Gamut,
    /// Tier code (`0..=`[`crate::MAX_TIER`], ordered by quality).
    ///
    /// Use [`crate::DEFAULT_TIER`] for the 32-byte hash — a literal `0` here is
    /// [`crate::COMPACT_TIER`], which is 21 bytes.
    pub quality: u8,
}

/// A unit of work handed to a worker: which item it is, the image to encode,
/// and the channel to report the resulting hash back on.
struct Job {
    index: usize,
    input: ImageInput,
    result_tx: Sender<(usize, ChromaHash)>,
}

/// A stateful batch encoder backed by a persistent pool of worker threads.
///
/// ```
/// use std::sync::Arc;
/// use chromahash::{BatchEncoder, Gamut, ImageInput};
///
/// let encoder = BatchEncoder::new();
/// let items = vec![ImageInput {
///     w: 2,
///     h: 2,
///     rgba: Arc::from(vec![128u8; 2 * 2 * 4]),
///     gamut: Gamut::Srgb,
///     quality: chromahash::DEFAULT_TIER,
/// }];
/// let hashes = encoder.encode_batch(&items);
/// assert_eq!(hashes.len(), 1);
/// ```
pub struct BatchEncoder {
    /// Wrapped in `Option` so [`Drop`] can close the channel (signalling the
    /// workers to exit) before joining them.
    job_tx: Option<Sender<Job>>,
    workers: Vec<JoinHandle<()>>,
}

impl BatchEncoder {
    /// Create an encoder with a worker pool sized to the available parallelism.
    #[must_use]
    pub fn new() -> Self {
        let threads = thread::available_parallelism()
            .map(NonZeroUsize::get)
            .unwrap_or(1);
        Self::with_threads(threads)
    }

    /// Create an encoder with an explicit worker count (clamped to `>= 1`).
    #[must_use]
    pub fn with_threads(n: usize) -> Self {
        let n = n.max(1);
        let (job_tx, job_rx) = mpsc::channel::<Job>();
        let job_rx = Arc::new(Mutex::new(job_rx));

        let mut workers = Vec::with_capacity(n);
        for _ in 0..n {
            let job_rx = Arc::clone(&job_rx);
            workers.push(thread::spawn(move || {
                loop {
                    // Hold the lock only to dequeue a job; the guard is dropped
                    // at the end of this statement, so encoding runs unlocked
                    // and workers process in parallel.
                    let message = job_rx.lock().unwrap().recv();
                    match message {
                        Ok(job) => {
                            let hash = ChromaHash::encode_with_quality(
                                job.input.w,
                                job.input.h,
                                &job.input.rgba,
                                job.input.gamut,
                                job.input.quality,
                            );
                            // The receiver is dropped once the batch has
                            // collected all results; a failed send is benign.
                            let _ = job.result_tx.send((job.index, hash));
                        }
                        // Channel closed (encoder dropped): shut the worker down.
                        Err(_) => break,
                    }
                }
            }));
        }

        Self {
            job_tx: Some(job_tx),
            workers,
        }
    }

    /// Encode every item, returning hashes in the same order as `items`.
    ///
    /// All items are validated up front (before any work is dispatched), so an
    /// invalid item fails fast on the calling thread rather than panicking a
    /// worker mid-flight. Validation matches [`ChromaHash::encode`].
    ///
    /// # Panics
    /// Panics, identifying the offending index, if any item has `w < 1`,
    /// `h < 1`, `rgba.len() != w * h * 4`, or `quality` is not a valid tier
    /// code (see [`crate::is_valid_tier`]).
    #[must_use]
    pub fn encode_batch(&self, items: &[ImageInput]) -> Vec<ChromaHash> {
        for (i, item) in items.iter().enumerate() {
            assert!(item.w >= 1, "item {i}: width must be >= 1");
            assert!(item.h >= 1, "item {i}: height must be >= 1");
            assert!(
                item.rgba.len() == (item.w as usize) * (item.h as usize) * 4,
                "item {i}: rgba length mismatch"
            );
            assert!(
                crate::constants::is_valid_tier(item.quality),
                "item {i}: tier must be a valid code 0..={}",
                crate::MAX_TIER
            );
        }

        if items.is_empty() {
            return Vec::new();
        }

        let job_tx = self
            .job_tx
            .as_ref()
            .expect("BatchEncoder job channel is open while alive");
        let (result_tx, result_rx) = mpsc::channel::<(usize, ChromaHash)>();
        for (index, item) in items.iter().enumerate() {
            job_tx
                .send(Job {
                    index,
                    input: item.clone(),
                    result_tx: result_tx.clone(),
                })
                .expect("worker pool is running");
        }
        // Drop our sender so the only remaining ones live inside in-flight jobs.
        drop(result_tx);

        // Each index is filled exactly once; `None` is a transient placeholder
        // (a variable-length ChromaHash has no cheap fixed dummy value).
        let mut out: Vec<Option<ChromaHash>> = vec![None; items.len()];
        for _ in 0..items.len() {
            let (index, hash) = result_rx.recv().expect("every job reports a result");
            out[index] = Some(hash);
        }
        out.into_iter()
            .map(|h| h.expect("every index filled exactly once"))
            .collect()
    }
}

impl Default for BatchEncoder {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for BatchEncoder {
    fn drop(&mut self) {
        // Closing the job channel makes each worker's `recv` return `Err`,
        // breaking its loop; then we join the now-finished threads.
        self.job_tx = None;
        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_image(w: u32, h: u32, r: u8, g: u8, b: u8, a: u8) -> Arc<[u8]> {
        let pixel_count = (w * h) as usize;
        let mut rgba = vec![0u8; pixel_count * 4];
        for i in 0..pixel_count {
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = a;
        }
        Arc::from(rgba)
    }

    fn horizontal_gradient(w: u32, h: u32) -> Arc<[u8]> {
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
        Arc::from(rgba)
    }

    /// A spread of dimensions, gamuts, and alpha, mirroring the bulk-migration use case.
    fn mixed_items() -> Vec<ImageInput> {
        vec![
            ImageInput {
                w: 4,
                h: 4,
                rgba: solid_image(4, 4, 200, 100, 50, 255),
                gamut: Gamut::Srgb,
                quality: crate::DEFAULT_TIER,
            },
            ImageInput {
                w: 8,
                h: 4,
                rgba: horizontal_gradient(8, 4),
                gamut: Gamut::DisplayP3,
                quality: crate::DEFAULT_TIER,
            },
            ImageInput {
                w: 4,
                h: 8,
                rgba: solid_image(4, 8, 30, 200, 120, 128), // semi-transparent
                gamut: Gamut::AdobeRgb,
                quality: crate::DEFAULT_TIER,
            },
            ImageInput {
                w: 16,
                h: 16,
                rgba: horizontal_gradient(16, 16),
                gamut: Gamut::Bt2020,
                quality: crate::DEFAULT_TIER,
            },
            ImageInput {
                w: 1,
                h: 1,
                rgba: solid_image(1, 1, 255, 0, 0, 255),
                gamut: Gamut::ProPhotoRgb,
                quality: crate::DEFAULT_TIER,
            },
        ]
    }

    fn encode_serial(items: &[ImageInput]) -> Vec<ChromaHash> {
        items
            .iter()
            .map(|it| ChromaHash::encode_with_quality(it.w, it.h, &it.rgba, it.gamut, it.quality))
            .collect()
    }

    #[test]
    fn batch_matches_serial() {
        let items = mixed_items();
        let encoder = BatchEncoder::new();
        let batch = encoder.encode_batch(&items);
        let serial = encode_serial(&items);
        assert_eq!(batch, serial);
    }

    #[test]
    fn batch_matches_serial_at_mixed_tiers() {
        // Per-item quality must flow through the worker pool: a batch of mixed
        // tiers must still equal encoding each item serially at its own tier.
        let mut items = mixed_items();
        for (i, item) in items.iter_mut().enumerate() {
            item.quality = (i % 3) as u8 + crate::COMPACT_TIER; // codes 0, 1, 2, …
        }
        let batch = BatchEncoder::new().encode_batch(&items);
        assert_eq!(batch, encode_serial(&items));
    }

    #[test]
    fn batch_preserves_order() {
        // Many same-shape items to exercise out-of-order completion.
        let items: Vec<ImageInput> = (0..64)
            .map(|i| ImageInput {
                w: 8,
                h: 8,
                rgba: solid_image(8, 8, i as u8, (255 - i) as u8, (i * 3) as u8, 255),
                gamut: Gamut::Srgb,
                quality: crate::DEFAULT_TIER,
            })
            .collect();
        let batch = BatchEncoder::new().encode_batch(&items);
        assert_eq!(batch, encode_serial(&items));
    }

    #[test]
    fn empty_batch_returns_empty() {
        let encoder = BatchEncoder::new();
        assert!(encoder.encode_batch(&[]).is_empty());
    }

    #[test]
    fn single_thread_matches_default() {
        let items = mixed_items();
        let single = BatchEncoder::with_threads(1).encode_batch(&items);
        let default = BatchEncoder::new().encode_batch(&items);
        assert_eq!(single, default);
    }

    #[test]
    fn encoder_reusable_across_batches() {
        let encoder = BatchEncoder::new();
        let items = mixed_items();
        let first = encoder.encode_batch(&items);
        let second = encoder.encode_batch(&items);
        assert_eq!(first, second);
        assert_eq!(first, encode_serial(&items));
    }

    #[test]
    #[should_panic(expected = "item 1: rgba length mismatch")]
    fn invalid_item_panics_with_index() {
        let items = vec![
            ImageInput {
                w: 2,
                h: 2,
                rgba: solid_image(2, 2, 0, 0, 0, 255),
                gamut: Gamut::Srgb,
                quality: crate::DEFAULT_TIER,
            },
            ImageInput {
                w: 2,
                h: 2,
                rgba: Arc::from(vec![0u8; 3]), // wrong length
                gamut: Gamut::Srgb,
                quality: crate::DEFAULT_TIER,
            },
        ];
        let _ = BatchEncoder::new().encode_batch(&items);
    }
}
