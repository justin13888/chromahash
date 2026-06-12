use chromahash::{BatchEncoder, ChromaHash, Gamut, ImageInput, Tunables};
use std::io::{self, Read, Write};
use std::sync::Arc;

fn usage() -> ! {
    eprintln!("Usage:");
    eprintln!("  encode_stdin encode <width> <height> <gamut>");
    eprintln!("  encode_stdin decode [max_width max_height]");
    eprintln!("  encode_stdin average-color");
    eprintln!("  encode_stdin batch-encode <width> <height> <gamut> <count>");
    eprintln!("  encode_stdin batch-decode <count>");
    eprintln!();
    eprintln!("Sweep interface: set CHROMAHASH_TUNE to space-separated key=value");
    eprintln!("pairs to override v0.6 format constants, e.g.");
    eprintln!("  CHROMAHASH_TUNE=\"layout=B w_min_l=1.0 mu_c=8\"");
    std::process::exit(1);
}

/// Parse CHROMAHASH_TUNE overrides on top of the v0.6 defaults.
/// Unknown keys or malformed values abort loudly — a silently ignored knob
/// would corrupt a whole sweep.
fn tunables_from_env() -> Tunables {
    let mut t = Tunables::DEFAULT;
    let Ok(spec) = std::env::var("CHROMAHASH_TUNE") else {
        return t;
    };
    for pair in spec.split_whitespace() {
        let Some((key, value)) = pair.split_once('=') else {
            eprintln!("CHROMAHASH_TUNE: malformed pair '{pair}'");
            std::process::exit(1);
        };
        let parse_f64 = || -> f64 {
            value.parse().unwrap_or_else(|_| {
                eprintln!("CHROMAHASH_TUNE: invalid number for {key}: '{value}'");
                std::process::exit(1);
            })
        };
        let parse_u32 = || -> u32 {
            value.parse().unwrap_or_else(|_| {
                eprintln!("CHROMAHASH_TUNE: invalid integer for {key}: '{value}'");
                std::process::exit(1);
            })
        };
        match key {
            "layout" => {
                t.layout = match value {
                    "A" => chromahash::LAYOUT_A,
                    "B" => chromahash::LAYOUT_B,
                    "C" => chromahash::LAYOUT_C,
                    "D" => chromahash::LAYOUT_D,
                    _ => {
                        eprintln!("CHROMAHASH_TUNE: unknown layout '{value}'");
                        std::process::exit(1);
                    }
                }
            }
            "max_chroma_a" => t.max_chroma_a = parse_f64(),
            "max_chroma_b" => t.max_chroma_b = parse_f64(),
            "max_l_scale" => t.max_l_scale = parse_f64(),
            "max_a_scale" => t.max_a_scale = parse_f64(),
            "max_b_scale" => t.max_b_scale = parse_f64(),
            "max_alpha_scale" => t.max_alpha_scale = parse_f64(),
            "mu_l" => t.mu_l = parse_f64(),
            "mu_c" => t.mu_c = parse_f64(),
            "mu_alpha" => t.mu_alpha = parse_f64(),
            "w_min_l" => t.w_min_l = parse_f64(),
            "w_exp_l" => t.w_exp_l = parse_u32(),
            "w_min_c" => t.w_min_c = parse_f64(),
            "w_exp_c" => t.w_exp_c = parse_u32(),
            "dc_search" => t.dc_search = value == "1" || value == "true",
            _ => {
                eprintln!("CHROMAHASH_TUNE: unknown key '{key}'");
                std::process::exit(1);
            }
        }
    }
    t
}

fn parse_gamut(s: &str) -> Gamut {
    match s {
        "srgb" => Gamut::Srgb,
        "displayp3" => Gamut::DisplayP3,
        "adobergb" => Gamut::AdobeRgb,
        "bt2020" => Gamut::Bt2020,
        "prophoto" => Gamut::ProPhotoRgb,
        other => {
            eprintln!("unknown gamut: {other}");
            std::process::exit(1);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        usage();
    }

    match args[1].as_str() {
        "encode" => {
            if args.len() != 5 {
                eprintln!("Usage: encode_stdin encode <width> <height> <gamut>");
                std::process::exit(1);
            }
            let w: u32 = args[2].parse().expect("invalid width");
            let h: u32 = args[3].parse().expect("invalid height");
            let gamut = parse_gamut(&args[4]);

            let expected_len = (w as usize) * (h as usize) * 4;
            let mut rgba = vec![0u8; expected_len];
            io::stdin()
                .read_exact(&mut rgba)
                .expect("failed to read RGBA from stdin");

            let hash = ChromaHash::encode_tuned(w, h, &rgba, gamut, &tunables_from_env());
            io::stdout()
                .write_all(hash.as_bytes())
                .expect("failed to write hash");
        }
        "decode" => {
            if args.len() != 2 && args.len() != 4 {
                eprintln!("Usage: encode_stdin decode [max_width max_height]");
                std::process::exit(1);
            }
            let mut hash = [0u8; 32];
            io::stdin()
                .read_exact(&mut hash)
                .expect("failed to read hash from stdin");
            let ch = ChromaHash::from_bytes(hash);
            let t = tunables_from_env();
            // Output gamut via env (keeps positional args stable for the
            // comparison harness): srgb (default) | displayp3 | adobergb.
            let out_gamut = match std::env::var("CHROMAHASH_OUT").as_deref() {
                Ok("displayp3") => Gamut::DisplayP3,
                Ok("adobergb") => Gamut::AdobeRgb,
                _ => Gamut::Srgb,
            };
            let (w, h, rgba) = if args.len() == 4 {
                let max_w: u32 = args[2].parse().expect("invalid max_width");
                let max_h: u32 = args[3].parse().expect("invalid max_height");
                ch.decode_capped_to_tuned(max_w, max_h, out_gamut, &t)
            } else {
                ch.decode_to_tuned(out_gamut, &t)
            };
            let header = format!("{w} {h}\n");
            io::stdout()
                .write_all(header.as_bytes())
                .expect("failed to write header");
            io::stdout().write_all(&rgba).expect("failed to write RGBA");
        }
        "average-color" => {
            let mut hash = [0u8; 32];
            io::stdin()
                .read_exact(&mut hash)
                .expect("failed to read hash from stdin");
            let rgba = ChromaHash::from_bytes(hash).average_color();
            io::stdout()
                .write_all(&rgba)
                .expect("failed to write average color");
        }
        "batch-encode" => {
            // Read one image, encode it `count` times through the parallel
            // BatchEncoder. Used to benchmark bulk throughput.
            if args.len() != 6 {
                eprintln!("Usage: encode_stdin batch-encode <width> <height> <gamut> <count>");
                std::process::exit(1);
            }
            let w: u32 = args[2].parse().expect("invalid width");
            let h: u32 = args[3].parse().expect("invalid height");
            let gamut = parse_gamut(&args[4]);
            let count: usize = args[5].parse().expect("invalid count");

            let expected_len = (w as usize) * (h as usize) * 4;
            let mut rgba = vec![0u8; expected_len];
            io::stdin()
                .read_exact(&mut rgba)
                .expect("failed to read RGBA from stdin");
            let rgba: Arc<[u8]> = Arc::from(rgba);

            let items: Vec<ImageInput> = (0..count)
                .map(|_| ImageInput {
                    w,
                    h,
                    rgba: Arc::clone(&rgba),
                    gamut,
                })
                .collect();

            let encoder = BatchEncoder::new();
            let hashes = encoder.encode_batch(&items);
            // Write one result-derived byte so the work cannot be optimized away.
            io::stdout()
                .write_all(&[hashes[0].as_bytes()[0]])
                .expect("failed to write checksum");
        }
        "batch-decode" => {
            // No batch decode API exists; loop the single decode `count` times.
            if args.len() != 3 {
                eprintln!("Usage: encode_stdin batch-decode <count>");
                std::process::exit(1);
            }
            let count: usize = args[2].parse().expect("invalid count");
            let mut hash = [0u8; 32];
            io::stdin()
                .read_exact(&mut hash)
                .expect("failed to read hash from stdin");
            let ch = ChromaHash::from_bytes(hash);
            let mut acc = 0u8;
            for _ in 0..count {
                let (_w, _h, rgba) = ch.decode();
                acc ^= rgba[0];
            }
            io::stdout()
                .write_all(&[acc])
                .expect("failed to write checksum");
        }
        _ => usage(),
    }
}
