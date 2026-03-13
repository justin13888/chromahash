use chromahash::{ChromaHash, Gamut};
use std::io::{self, Read, Write};

fn usage() -> ! {
    eprintln!("Usage:");
    eprintln!("  encode_stdin encode <width> <height> <gamut>");
    eprintln!("  encode_stdin decode");
    eprintln!("  encode_stdin average-color");
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
            let mut hash = [0u8; 32];
            io::stdin()
                .read_exact(&mut hash)
                .expect("failed to read hash from stdin");
            let ch = ChromaHash::from_bytes(hash);
            let (_w, _h, rgba) = ch.decode();
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
        _ => usage(),
    }
}
