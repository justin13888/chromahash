//! Runs the shared spec test vectors through the C ABI (`extern "C"` functions
//! called as Rust fns) and asserts byte-exact output. This is the parity gate for
//! the C surface — and, transitively, for the C# (P/Invoke) and Go (cgo) bindings
//! that link this same library. Mirrors `bindings/uniffi/tests/spec_vectors.rs`.

use std::ptr;

use chromahash_c::{
    chromahash_as_bytes, chromahash_average_color, chromahash_batch_encode,
    chromahash_batch_encoder_free, chromahash_batch_encoder_new, chromahash_byte_len,
    chromahash_decode, chromahash_decode_capped, chromahash_encode, chromahash_encode_with_quality,
    chromahash_free, chromahash_from_bytes, chromahash_image_free, ChromaHash, ChromaHashColor,
    ChromaHashGamut, ChromaHashImage, ChromaHashImageInput, ChromaHashStatus,
};
use serde_json::Value;

const ENCODE_VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../spec/test-vectors/integration-encode.json"
));
const DECODE_VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../spec/test-vectors/integration-decode.json"
));
const DECODE_CAPPED_VECTORS: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../spec/test-vectors/integration-decode-capped.json"
));

fn gamut_from_str(s: &str) -> ChromaHashGamut {
    match s {
        "sRGB" => ChromaHashGamut::Srgb,
        "Display P3" => ChromaHashGamut::DisplayP3,
        "Adobe RGB" => ChromaHashGamut::AdobeRgb,
        "BT.2020" => ChromaHashGamut::Bt2020,
        "ProPhoto RGB" => ChromaHashGamut::ProPhotoRgb,
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

/// Encode through the C ABI at the given quality tier and return the resulting
/// handle (caller frees).
fn encode(w: u32, h: u32, rgba: &[u8], gamut: ChromaHashGamut, tier: u8) -> *mut ChromaHash {
    let mut handle: *mut ChromaHash = ptr::null_mut();
    let status = unsafe {
        chromahash_encode_with_quality(w, h, rgba.as_ptr(), rgba.len(), gamut, tier, &mut handle)
    };
    assert_eq!(status, ChromaHashStatus::Ok, "encode returned an error");
    assert!(!handle.is_null(), "encode produced a null handle");
    handle
}

fn hash_bytes(handle: *mut ChromaHash) -> Vec<u8> {
    let len = unsafe { chromahash_byte_len(handle) };
    let mut out = vec![0u8; len];
    let status = unsafe { chromahash_as_bytes(handle, out.as_mut_ptr(), out.len()) };
    assert_eq!(status, ChromaHashStatus::Ok, "as_bytes returned an error");
    out
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
        let tier = input["tier"].as_u64().expect("tier") as u8;
        let rgba = bytes(&input["rgba"]);

        let handle = encode(w, h, &rgba, gamut, tier);

        assert_eq!(
            hash_bytes(handle),
            bytes(&case["expected"]["hash"]),
            "{name}: hash mismatch"
        );

        if let Some(avg) = case["expected"].get("average_color") {
            let mut color = ChromaHashColor {
                r: 0,
                g: 0,
                b: 0,
                a: 0,
            };
            let status = unsafe { chromahash_average_color(handle, &mut color) };
            assert_eq!(status, ChromaHashStatus::Ok, "{name}: average_color error");
            assert_eq!(
                vec![color.r, color.g, color.b, color.a],
                bytes(avg),
                "{name}: average_color mismatch"
            );
        }

        unsafe { chromahash_free(handle) };
    }
}

#[test]
fn integration_decode_vectors() {
    let cases: Value = serde_json::from_str(DECODE_VECTORS).expect("parse decode vectors");
    let cases = cases.as_array().expect("decode vectors should be an array");
    assert!(!cases.is_empty(), "no decode vectors found");

    for case in cases {
        let name = case["name"].as_str().unwrap_or("<unnamed>");
        let hash = bytes(&case["input"]["hash"]);

        let mut handle: *mut ChromaHash = ptr::null_mut();
        let status = unsafe { chromahash_from_bytes(hash.as_ptr(), hash.len(), &mut handle) };
        assert_eq!(status, ChromaHashStatus::Ok, "{name}: from_bytes error");

        let mut image = ChromaHashImage {
            width: 0,
            height: 0,
            rgba: ptr::null_mut(),
            rgba_len: 0,
        };
        let status = unsafe { chromahash_decode(handle, &mut image) };
        assert_eq!(status, ChromaHashStatus::Ok, "{name}: decode error");

        let expected = &case["expected"];
        assert_eq!(
            image.width as u64,
            expected["width"].as_u64().expect("width"),
            "{name}: width mismatch"
        );
        assert_eq!(
            image.height as u64,
            expected["height"].as_u64().expect("height"),
            "{name}: height mismatch"
        );
        let rgba = unsafe { std::slice::from_raw_parts(image.rgba, image.rgba_len) };
        assert_eq!(
            rgba,
            bytes(&expected["rgba"]).as_slice(),
            "{name}: rgba mismatch"
        );

        unsafe { chromahash_image_free(&mut image) };
        assert!(image.rgba.is_null(), "image_free must null the buffer");
        unsafe { chromahash_free(handle) };
    }
}

#[test]
fn integration_decode_capped_vectors() {
    let cases: Value =
        serde_json::from_str(DECODE_CAPPED_VECTORS).expect("parse capped decode vectors");
    let cases = cases.as_array().expect("capped vectors should be an array");
    assert!(!cases.is_empty(), "no capped decode vectors found");

    for case in cases {
        let name = case["name"].as_str().unwrap_or("<unnamed>");
        let input = &case["input"];
        let hash = bytes(&input["hash"]);
        let max_w = input["max_width"].as_u64().expect("max_width") as u32;
        let max_h = input["max_height"].as_u64().expect("max_height") as u32;

        let mut handle: *mut ChromaHash = ptr::null_mut();
        let status = unsafe { chromahash_from_bytes(hash.as_ptr(), hash.len(), &mut handle) };
        assert_eq!(status, ChromaHashStatus::Ok, "{name}: from_bytes error");

        let mut image = ChromaHashImage {
            width: 0,
            height: 0,
            rgba: ptr::null_mut(),
            rgba_len: 0,
        };
        let status = unsafe { chromahash_decode_capped(handle, max_w, max_h, &mut image) };
        assert_eq!(status, ChromaHashStatus::Ok, "{name}: decode_capped error");

        let expected = &case["expected"];
        assert_eq!(
            image.width as u64,
            expected["width"].as_u64().expect("width"),
            "{name}: width mismatch"
        );
        assert_eq!(
            image.height as u64,
            expected["height"].as_u64().expect("height"),
            "{name}: height mismatch"
        );
        let rgba = unsafe { std::slice::from_raw_parts(image.rgba, image.rgba_len) };
        assert_eq!(
            rgba,
            bytes(&expected["rgba"]).as_slice(),
            "{name}: rgba mismatch"
        );

        unsafe { chromahash_image_free(&mut image) };
        unsafe { chromahash_free(handle) };
    }
}

#[test]
fn from_bytes_rejects_wrong_length() {
    // v1 self-describing validation: a tier-0 header implies exactly 32 bytes, so
    // any other length is InvalidData (the length does not match the header).
    let mut handle: *mut ChromaHash = ptr::null_mut();
    let buf = [0u8; 16];
    assert_eq!(
        unsafe { chromahash_from_bytes(buf.as_ptr(), buf.len(), &mut handle) },
        ChromaHashStatus::InvalidData,
        "from_bytes should reject a 16-byte buffer"
    );
    let buf = [0u8; 33];
    assert_eq!(
        unsafe { chromahash_from_bytes(buf.as_ptr(), buf.len(), &mut handle) },
        ChromaHashStatus::InvalidData,
        "from_bytes should reject a 33-byte buffer"
    );
}

#[test]
fn encode_rejects_bad_args() {
    let mut handle: *mut ChromaHash = ptr::null_mut();
    let rgba = [0u8; 16];
    // Zero dimension.
    assert_eq!(
        unsafe {
            chromahash_encode(
                0,
                1,
                rgba.as_ptr(),
                rgba.len(),
                ChromaHashGamut::Srgb,
                &mut handle,
            )
        },
        ChromaHashStatus::InvalidDimensions
    );
    // Length mismatch (2x2 needs 16 bytes; give 8).
    let short = [0u8; 8];
    assert_eq!(
        unsafe {
            chromahash_encode(
                2,
                2,
                short.as_ptr(),
                short.len(),
                ChromaHashGamut::Srgb,
                &mut handle,
            )
        },
        ChromaHashStatus::InvalidLength
    );
    // Null rgba.
    assert_eq!(
        unsafe { chromahash_encode(2, 2, ptr::null(), 16, ChromaHashGamut::Srgb, &mut handle) },
        ChromaHashStatus::NullPointer
    );
}

#[test]
fn batch_encode_matches_single_encode() {
    // Take the encode vectors, run them through the batch API, and compare each
    // result to the single-encode path — byte-identical per the core's contract.
    let cases: Value = serde_json::from_str(ENCODE_VECTORS).expect("parse encode vectors");
    let cases = cases.as_array().expect("encode vectors should be an array");

    // Keep the rgba buffers alive for the duration of the batch call.
    let owned: Vec<(u32, u32, Vec<u8>, ChromaHashGamut)> = cases
        .iter()
        .map(|case| {
            let input = &case["input"];
            (
                input["width"].as_u64().unwrap() as u32,
                input["height"].as_u64().unwrap() as u32,
                bytes(&input["rgba"]),
                gamut_from_str(input["gamut"].as_str().unwrap()),
            )
        })
        .collect();

    let items: Vec<ChromaHashImageInput> = owned
        .iter()
        .map(|(w, h, rgba, gamut)| ChromaHashImageInput {
            width: *w,
            height: *h,
            rgba: rgba.as_ptr(),
            rgba_len: rgba.len(),
            gamut: *gamut,
        })
        .collect();

    let encoder = chromahash_batch_encoder_new();
    assert!(!encoder.is_null(), "batch encoder creation failed");

    let mut out: Vec<*mut ChromaHash> = vec![ptr::null_mut(); items.len()];
    let status =
        unsafe { chromahash_batch_encode(encoder, items.as_ptr(), items.len(), out.as_mut_ptr()) };
    assert_eq!(status, ChromaHashStatus::Ok, "batch_encode error");

    for (i, (w, h, rgba, gamut)) in owned.iter().enumerate() {
        // The batch API encodes at tier 0, so compare against a tier-0 single encode.
        let single = encode(*w, *h, rgba, *gamut, 0);
        assert_eq!(
            hash_bytes(out[i]),
            hash_bytes(single),
            "batch item {i} diverges from single encode"
        );
        unsafe { chromahash_free(single) };
        unsafe { chromahash_free(out[i]) };
    }

    unsafe { chromahash_batch_encoder_free(encoder) };
}
