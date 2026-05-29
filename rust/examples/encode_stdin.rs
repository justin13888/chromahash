use chromahash::{BatchEncoder, ChromaHash, Gamut, ImageInput};
use std::io::{self, Read, Write};
use std::sync::Arc;

fn usage() -> ! {
    eprintln!("Usage:");
    eprintln!("  encode_stdin encode <width> <height> <gamut>");
    eprintln!("  encode_stdin decode [max_width max_height]");
    eprintln!("  encode_stdin average-color");
    eprintln!("  encode_stdin batch-encode <width> <height> <gamut> <count>");
    eprintln!("  encode_stdin batch-decode <count>");
    std::process::exit(1);
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

            let hash = ChromaHash::encode(w, h, &rgba, gamut);
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
            let (w, h, rgba) = if args.len() == 4 {
                let max_w: u32 = args[2].parse().expect("invalid max_width");
                let max_h: u32 = args[3].parse().expect("invalid max_height");
                ch.decode_capped(max_w, max_h)
            } else {
                ch.decode()
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
