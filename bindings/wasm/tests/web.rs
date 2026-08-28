//! Runs the shared spec test vectors through the wasm-bindgen surface, compiled to
//! wasm and executed in Node via `wasm-pack test --node`. The vectors are embedded
//! with `include_str!` because the wasm test runner has no filesystem. Mirrors the
//! C and UniFFI parity gates.

use chromahash::MAX_TIER;
use chromahash_wasm::{ChromaHash, Gamut};
use serde_json::Value;
use wasm_bindgen_test::*;

const ENCODE_VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../spec/test-vectors/integration-encode.json"
));
const DECODE_VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../spec/test-vectors/integration-decode.json"
));

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

fn bytes(v: &Value) -> Vec<u8> {
    v.as_array()
        .expect("expected a JSON array of bytes")
        .iter()
        .map(|n| n.as_u64().expect("byte should be a number") as u8)
        .collect()
}

#[wasm_bindgen_test]
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
        let tier = input["tier"].as_u64().expect("tier") as u8;
        let rgba = bytes(&input["rgba"]);

        let hash = ChromaHash::encode_with_quality(w, h, &rgba, gamut, tier);
        assert_eq!(
            hash.as_bytes(),
            bytes(&case["expected"]["hash"]),
            "{name}: hash mismatch"
        );

        if let Some(avg) = case["expected"].get("average_color") {
            assert_eq!(
                hash.average_color(),
                bytes(avg),
                "{name}: average_color mismatch"
            );
        }
    }
}

#[wasm_bindgen_test]
fn integration_decode_vectors() {
    let cases: Value = serde_json::from_str(DECODE_VECTORS).expect("parse decode vectors");
    let cases = cases.as_array().expect("decode vectors should be an array");
    assert!(!cases.is_empty(), "no decode vectors found");

    for case in cases {
        let name = case["name"].as_str().unwrap_or("<unnamed>");
        let hash_bytes = bytes(&case["input"]["hash"]);
        let hash = ChromaHash::from_bytes(&hash_bytes)
            .unwrap_or_else(|_| panic!("{name}: from_bytes rejected a 32-byte hash"));
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
            result.rgba(),
            bytes(&expected["rgba"]),
            "{name}: rgba mismatch"
        );
    }
}

/// Every tier has its own exact byte length, so a fixed length is not a valid
/// assertion for any of them. Derive each length from a real encode rather than
/// hard-coding one — that is what let the pre-renumbering `[0u8; 32]` assertion
/// survive the tier renumbering, when byte 0 = 0 stopped meaning the 32-byte tier
/// and started meaning the 21-byte compact one.
#[wasm_bindgen_test]
fn from_bytes_accepts_every_tier_and_rejects_wrong_lengths() {
    let rgba = vec![128u8; 4 * 4 * 4];

    for tier in 0..=MAX_TIER {
        let encoded = ChromaHash::encode_with_quality(4, 4, &rgba, Gamut::Srgb, tier).as_bytes();

        assert!(
            ChromaHash::from_bytes(&encoded).is_ok(),
            "tier {tier}: from_bytes rejected its own {} byte encoding",
            encoded.len()
        );

        let short = &encoded[..encoded.len() - 1];
        assert!(
            ChromaHash::from_bytes(short).is_err(),
            "tier {tier}: from_bytes accepted a buffer one byte short"
        );

        let mut long = encoded.clone();
        long.push(0);
        assert!(
            ChromaHash::from_bytes(&long).is_err(),
            "tier {tier}: from_bytes accepted a buffer one byte long"
        );
    }
}
