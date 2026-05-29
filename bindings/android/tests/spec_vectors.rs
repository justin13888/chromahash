//! Runs the shared spec test vectors through the UniFFI binding wrappers and asserts
//! byte-exact output. Because the binding just forwards to the core crate, this is the
//! "thin marshalling check" of the contract in `spec/` (see docs/android.md §9): it
//! exercises the Gamut conversion, record packing, the i32 casts, and the fallible
//! `from_bytes` — without needing the Android NDK/SDK, so it runs in plain `cargo test`.

use chromahash_uniffi::{ChromaHash, Gamut};
use serde_json::Value;

const ENCODE_VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../spec/test-vectors/integration-encode.json"
));
const DECODE_VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../spec/test-vectors/integration-decode.json"
));

/// Map a spec-vector gamut string to the binding's `Gamut` enum.
fn gamut_from_str(s: &str) -> Gamut {
    match s {
        "sRGB" => Gamut::Srgb,
        "Display P3" => Gamut::DisplayP3,
        "Adobe RGB" => Gamut::AdobeRgb,
        "BT.2020" => Gamut::Bt2020,
        "ProPhoto RGB" => Gamut::ProPhotoRgb,
        other => panic!("unknown gamut in spec vector: {other:?}"),
    }
}

/// Read a JSON array of integers into a `Vec<u8>`.
fn bytes(v: &Value) -> Vec<u8> {
    v.as_array()
        .expect("expected a JSON array of bytes")
        .iter()
        .map(|n| n.as_u64().expect("byte should be a number") as u8)
        .collect()
}

#[test]
fn integration_encode_vectors() {
    let cases: Value = serde_json::from_str(ENCODE_VECTORS).expect("parse encode vectors");
    let cases = cases.as_array().expect("encode vectors should be an array");
    assert!(!cases.is_empty(), "no encode vectors found");

    for case in cases {
        let name = case["name"].as_str().unwrap_or("<unnamed>");
        let input = &case["input"];
        let w = input["width"].as_u64().expect("width") as u32;
        let h = input["height"].as_u64().expect("height") as u32;
        let gamut = gamut_from_str(input["gamut"].as_str().expect("gamut"));
        let rgba = bytes(&input["rgba"]);

        let hash = ChromaHash::encode(w, h, rgba, gamut);

        assert_eq!(
            hash.as_bytes(),
            bytes(&case["expected"]["hash"]),
            "{name}: hash mismatch"
        );

        // average_color is optional in the vectors but present today.
        if let Some(avg) = case["expected"].get("average_color") {
            let c = hash.average_color();
            assert_eq!(
                vec![c.r as u8, c.g as u8, c.b as u8, c.a as u8],
                bytes(avg),
                "{name}: average_color mismatch"
            );
        }
    }
}

#[test]
fn integration_decode_vectors() {
    let cases: Value = serde_json::from_str(DECODE_VECTORS).expect("parse decode vectors");
    let cases = cases.as_array().expect("decode vectors should be an array");
    assert!(!cases.is_empty(), "no decode vectors found");

    for case in cases {
        let name = case["name"].as_str().unwrap_or("<unnamed>");
        let hash = ChromaHash::from_bytes(bytes(&case["input"]["hash"]))
            .expect("spec vector hash should be exactly 32 bytes");
        let result = hash.decode();

        let expected = &case["expected"];
        assert_eq!(
            result.width as u64,
            expected["width"].as_u64().expect("width"),
            "{name}: width mismatch"
        );
        assert_eq!(
            result.height as u64,
            expected["height"].as_u64().expect("height"),
            "{name}: height mismatch"
        );
        assert_eq!(
            result.rgba,
            bytes(&expected["rgba"]),
            "{name}: rgba mismatch"
        );
    }
}

#[test]
fn from_bytes_rejects_wrong_length() {
    assert!(
        ChromaHash::from_bytes(vec![0u8; 16]).is_err(),
        "from_bytes should reject a 16-byte buffer"
    );
    assert!(
        ChromaHash::from_bytes(vec![0u8; 33]).is_err(),
        "from_bytes should reject a 33-byte buffer"
    );
    assert!(
        ChromaHash::from_bytes(vec![0u8; 32]).is_ok(),
        "from_bytes should accept a 32-byte buffer"
    );
}
