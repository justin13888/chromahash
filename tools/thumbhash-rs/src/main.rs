//! Native ThumbHash CLI baseline — stdin/stdout, mirroring the chromahash
//! `encode_stdin` example and the JS `thumbhash-stdin` harness so the benchmark
//! can time the **native** ThumbHash reference as its fastest baseline.
//!
//! Uses Evan Wallace's official `thumbhash` crate (the algorithm's author), so
//! the baseline reflects ThumbHash at its best rather than a JS-on-Node runtime
//! artifact.
//!
//! ThumbHash takes no gamut argument and produces a variable-length hash, so
//! `decode`/`batch-decode` read all of stdin rather than a fixed 32 bytes.
//!
//! `batch-encode` spreads the N independent encodes across one worker thread per
//! core — the apples-to-apples counterpart to chromahash's parallel
//! `BatchEncoder`. `batch-decode` loops serially, matching chromahash (which has
//! no batch-decode API and loops its single decode).

use std::hint::black_box;
use std::io::{self, Read, Write};
use std::num::NonZeroUsize;
use std::thread;

use thumbhash::{rgba_to_thumb_hash, thumb_hash_to_rgba};

fn usage() -> ! {
    eprintln!("Usage:");
    eprintln!("  thumbhash-stdin encode <width> <height>");
    eprintln!("  thumbhash-stdin decode");
    eprintln!("  thumbhash-stdin batch-encode <width> <height> <count>");
    eprintln!("  thumbhash-stdin batch-decode <count>");
    std::process::exit(1);
}

fn read_all_stdin() -> Vec<u8> {
    let mut buf = Vec::new();
    io::stdin()
        .read_to_end(&mut buf)
        .expect("failed to read stdin");
    buf
}

fn read_exact_rgba(w: usize, h: usize) -> Vec<u8> {
    let mut rgba = vec![0u8; w * h * 4];
    io::stdin()
        .read_exact(&mut rgba)
        .expect("failed to read RGBA from stdin");
    rgba
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        usage();
    }

    match args[1].as_str() {
        "encode" => {
            if args.len() != 4 {
                usage();
            }
            let w: usize = args[2].parse().expect("invalid width");
            let h: usize = args[3].parse().expect("invalid height");
            let rgba = read_exact_rgba(w, h);
            let hash = rgba_to_thumb_hash(w, h, &rgba);
            io::stdout().write_all(&hash).expect("failed to write hash");
        }
        "decode" => {
            // The hash is variable-length — read all of stdin.
            let hash = read_all_stdin();
            let (_w, _h, rgba) = thumb_hash_to_rgba(&hash).expect("invalid thumbhash");
            io::stdout().write_all(&rgba).expect("failed to write RGBA");
        }
        "batch-encode" => {
            if args.len() != 5 {
                usage();
            }
            let w: usize = args[2].parse().expect("invalid width");
            let h: usize = args[3].parse().expect("invalid height");
            let count: usize = args[4].parse().expect("invalid count");
            let rgba = read_exact_rgba(w, h);

            // One worker per core, matching chromahash's parallel BatchEncoder.
            // XOR is associative/commutative, so folding the per-thread partials
            // reproduces the serial XOR exactly. `black_box` on the input forces
            // each encode to actually run (no loop-invariant hoisting), since the
            // N images are identical.
            let threads = thread::available_parallelism()
                .map(NonZeroUsize::get)
                .unwrap_or(1);
            let rgba_ref = &rgba;
            let acc = thread::scope(|s| {
                let base = count / threads;
                let rem = count % threads;
                let handles: Vec<_> = (0..threads)
                    .map(|t| {
                        let n = base + usize::from(t < rem);
                        s.spawn(move || {
                            let mut local = 0u8;
                            for _ in 0..n {
                                let hash = rgba_to_thumb_hash(w, h, black_box(rgba_ref));
                                local ^= hash[0];
                            }
                            local
                        })
                    })
                    .collect();
                handles.into_iter().fold(0u8, |a, h| a ^ h.join().unwrap())
            });
            // Write one result-derived byte so the work cannot be optimized away.
            io::stdout()
                .write_all(&[acc])
                .expect("failed to write checksum");
        }
        "batch-decode" => {
            if args.len() != 3 {
                usage();
            }
            let count: usize = args[2].parse().expect("invalid count");
            let hash = read_all_stdin();
            let mut acc = 0u8;
            for _ in 0..count {
                let (_w, _h, rgba) =
                    thumb_hash_to_rgba(black_box(&hash)).expect("invalid thumbhash");
                acc ^= rgba[0];
            }
            io::stdout()
                .write_all(&[acc])
                .expect("failed to write checksum");
        }
        _ => usage(),
    }
}
