//! Generate the public C header (`include/chromahash.h`) from this crate's
//! `extern "C"` surface via cbindgen, on every build. The committed header is the
//! artifact C consumers use; CI regenerates and `git diff --exit-code`s it so the
//! header can never drift from the Rust ABI.

use std::path::PathBuf;

fn main() {
    let crate_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let config =
        cbindgen::Config::from_file(crate_dir.join("cbindgen.toml")).expect("read cbindgen.toml");

    let include_dir = crate_dir.join("include");
    std::fs::create_dir_all(&include_dir).expect("create include/");

    cbindgen::Builder::new()
        .with_crate(&crate_dir)
        .with_config(config)
        .generate()
        .expect("generate the C header")
        .write_to_file(include_dir.join("chromahash.h"));

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=cbindgen.toml");
    println!("cargo:rerun-if-changed=build.rs");
}
