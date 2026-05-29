//! Entry point for UniFFI's `generate` CLI (library mode).
//!
//! Invoked as `cargo run --bin uniffi-bindgen -- generate --library <.so> --language kotlin ...`
//! to emit the Kotlin bindings from the compiled cdylib's embedded metadata.
fn main() {
    uniffi::uniffi_bindgen_main()
}
