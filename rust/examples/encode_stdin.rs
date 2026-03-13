use chromahash::{ChromaHash, Gamut};
use std::io::{self, Read, Write};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("Usage: encode_stdin <width> <height> <gamut>");
        std::process::exit(1);
    }

    let w: u32 = args[1].parse().expect("invalid width");
    let h: u32 = args[2].parse().expect("invalid height");
    let gamut = match args[3].as_str() {
        "srgb" => Gamut::Srgb,
        "displayp3" => Gamut::DisplayP3,
        "adobergb" => Gamut::AdobeRgb,
        "bt2020" => Gamut::Bt2020,
        "prophoto" => Gamut::ProPhotoRgb,
        other => {
            eprintln!("unknown gamut: {other}");
            std::process::exit(1);
        }
    };

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
