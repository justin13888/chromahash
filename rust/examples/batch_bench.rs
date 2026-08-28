//! Throughput benchmark: serial per-image encode vs. `BatchEncoder`.
//!
//! Zero dependencies — uses only `std::time::Instant`. Run with:
//!
//! ```sh
//! cargo run --release --example batch_bench
//! ```
//!
//! Prints images/sec and speedup for the batch path, plus a scaling sweep over
//! worker-thread counts. Asserts the batch output is byte-identical to serial
//! before timing.

use std::sync::Arc;
use std::time::Instant;

use chromahash::{BatchEncoder, ChromaHash, DEFAULT_TIER, Gamut, ImageInput};

/// Number of images per run.
const N: usize = 2_000;

fn make_image(seed: usize) -> ImageInput {
    // Vary size, content, gamut, and alpha so the workload resembles a real
    // bulk job rather than a single hot cache line.
    let w = 24 + (seed % 40) as u32;
    let h = 24 + ((seed * 7) % 40) as u32;
    let gamut = match seed % 5 {
        0 => Gamut::Srgb,
        1 => Gamut::DisplayP3,
        2 => Gamut::AdobeRgb,
        3 => Gamut::Bt2020,
        _ => Gamut::ProPhotoRgb,
    };
    let pixels = (w * h) as usize;
    let mut rgba = vec![0u8; pixels * 4];
    for (i, chunk) in rgba.chunks_exact_mut(4).enumerate() {
        chunk[0] = ((i * 3 + seed) % 256) as u8;
        chunk[1] = ((i * 5 + seed * 2) % 256) as u8;
        chunk[2] = ((i * 7 + seed * 3) % 256) as u8;
        // `%` rather than `is_multiple_of`, which is stable only from 1.87 —
        // above this crate's declared MSRV (rust-version = 1.85).
        chunk[3] = if seed % 3 == 0 { 200 } else { 255 };
    }
    ImageInput {
        w,
        h,
        rgba: Arc::from(rgba),
        gamut,
        // Not a bare `0`: the tier codes are ordered by quality, so 0 is the
        // 21-byte compact tier. This literal was the 32-byte default before the
        // renumbering and silently became compact after it, which made the
        // serial-vs-batch equality check below compare two different tiers.
        quality: DEFAULT_TIER,
    }
}

fn encode_serial(items: &[ImageInput]) -> Vec<ChromaHash> {
    // Honour each item's tier, so the equality check below stays a comparison of
    // the two code paths rather than of two tiers.
    items
        .iter()
        .map(|it| ChromaHash::encode_with_quality(it.w, it.h, &it.rgba, it.gamut, it.quality))
        .collect()
}

fn images_per_sec(n: usize, secs: f64) -> f64 {
    if secs > 0.0 {
        n as f64 / secs
    } else {
        f64::INFINITY
    }
}

fn main() {
    let items: Vec<ImageInput> = (0..N).map(make_image).collect();
    let available = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);

    println!("chromahash batch benchmark — {N} images, {available} cores available\n");

    // Warm up (allocator, caches, branch predictors).
    let warm_serial = encode_serial(&items);
    let warm_batch = BatchEncoder::new().encode_batch(&items);
    assert_eq!(warm_serial, warm_batch, "batch output must equal serial");

    // Serial baseline.
    let t0 = Instant::now();
    let serial = encode_serial(&items);
    let serial_secs = t0.elapsed().as_secs_f64();
    std::hint::black_box(&serial);
    println!(
        "serial            : {serial_secs:>8.4}s  {:>10.0} img/s  (1.00x)",
        images_per_sec(N, serial_secs)
    );

    // Batch at the default (available) thread count.
    let encoder = BatchEncoder::new();
    let t0 = Instant::now();
    let batch = encoder.encode_batch(&items);
    let batch_secs = t0.elapsed().as_secs_f64();
    std::hint::black_box(&batch);
    println!(
        "batch (default)   : {batch_secs:>8.4}s  {:>10.0} img/s  ({:.2}x)",
        images_per_sec(N, batch_secs),
        serial_secs / batch_secs
    );

    println!("\nscaling sweep (batch):");
    let mut thread_counts = vec![1usize, 2, 4, 8];
    if !thread_counts.contains(&available) {
        thread_counts.push(available);
    }
    for &t in &thread_counts {
        let encoder = BatchEncoder::with_threads(t);
        // Warm this pool once before timing.
        std::hint::black_box(encoder.encode_batch(&items));
        let start = Instant::now();
        let out = encoder.encode_batch(&items);
        let secs = start.elapsed().as_secs_f64();
        std::hint::black_box(&out);
        println!(
            "  threads={t:<3}      : {secs:>8.4}s  {:>10.0} img/s  ({:.2}x)",
            images_per_sec(N, secs),
            serial_secs / secs
        );
    }
}
