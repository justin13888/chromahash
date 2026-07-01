"""End-to-end parity tests for the ChromaHash Python binding.

The package is now a thin facade over the UniFFI-generated bindings to the Rust
core, so these tests exercise the public API against the shared spec vectors —
the cross-language parity gate. Per-function unit tests of the algorithm live in
the Rust core (the single source of truth).
"""

import json
import os

from chromahash import ChromaHash, Gamut

SPEC_VECTORS = os.path.join(os.path.dirname(__file__), "../../spec/test-vectors")


def load_vectors(name: str) -> list:
    with open(os.path.join(SPEC_VECTORS, name)) as f:
        return json.load(f)


def gamut_from_name(name: str) -> Gamut:
    return {
        "sRGB": Gamut.SRGB,
        "Display P3": Gamut.DISPLAY_P3,
        "Adobe RGB": Gamut.ADOBE_RGB,
        "BT.2020": Gamut.BT2020,
        "ProPhoto RGB": Gamut.PROPHOTO_RGB,
    }.get(name, Gamut.SRGB)


def solid_image(w: int, h: int, r: int, g: int, b: int, a: int) -> bytes:
    return bytes([r, g, b, a]) * (w * h)


def test_integration_encode():
    cases = load_vectors("integration-encode.json")
    assert cases
    for tc in cases:
        name = tc["name"]
        inp = tc["input"]
        rgba = bytes(inp["rgba"])
        ch = ChromaHash.encode_with_quality(
            inp["width"], inp["height"], rgba, gamut_from_name(inp["gamut"]), inp["tier"]
        )
        assert list(ch.as_bytes()) == tc["expected"]["hash"], f"{name}: hash mismatch"
        if "average_color" in tc["expected"]:
            assert list(ch.average_color()) == tc["expected"]["average_color"], (
                f"{name}: average_color mismatch"
            )


def test_integration_decode():
    cases = load_vectors("integration-decode.json")
    assert cases
    for tc in cases:
        name = tc["name"]
        ch = ChromaHash.from_bytes(bytes(tc["input"]["hash"]))
        w, h, rgba = ch.decode()
        assert w == tc["expected"]["width"], f"{name}: width"
        assert h == tc["expected"]["height"], f"{name}: height"
        assert list(rgba) == tc["expected"]["rgba"], f"{name}: rgba mismatch"


def test_integration_decode_capped():
    cases = load_vectors("integration-decode-capped.json")
    assert cases
    for tc in cases:
        name = tc["name"]
        inp = tc["input"]
        ch = ChromaHash.from_bytes(bytes(inp["hash"]))
        w, h, rgba = ch.decode_capped(inp["max_width"], inp["max_height"])
        assert w == tc["expected"]["width"], f"{name}: width"
        assert h == tc["expected"]["height"], f"{name}: height"
        assert list(rgba) == tc["expected"]["rgba"], f"{name}: rgba mismatch"


def test_encode_produces_32_bytes():
    ch = ChromaHash.encode(4, 4, solid_image(4, 4, 128, 128, 128, 255), Gamut.SRGB)
    assert len(ch.as_bytes()) == 32


def test_decode_valid_dimensions():
    ch = ChromaHash.encode(4, 4, solid_image(4, 4, 128, 64, 32, 255), Gamut.SRGB)
    w, h, pixels = ch.decode()
    assert 0 < w <= 32
    assert 0 < h <= 32
    assert len(pixels) == w * h * 4


def test_from_bytes_roundtrip():
    ch = ChromaHash.encode(4, 4, solid_image(4, 4, 128, 64, 32, 255), Gamut.SRGB)
    assert ChromaHash.from_bytes(ch.as_bytes()) == ch
