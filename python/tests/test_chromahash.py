"""Tests for ChromaHash Python implementation.

Covers unit tests for each module plus integration tests using spec test vectors.
"""

import json
import math
import os

import pytest

from chromahash import ChromaHash, Gamut
from chromahash._aspect import decode_aspect, decode_output_size, encode_aspect
from chromahash._bitpack import read_bits, write_bits
from chromahash._color import (
    gamma_rgb_to_oklab,
    linear_rgb_to_oklab,
    oklab_to_linear_srgb,
)
from chromahash._dct import dct_decode_pixel, dct_encode, triangular_scan_order
from chromahash._math_utils import cbrt_signed, clamp01, matvec3, round_half_away_from_zero
from chromahash._mulaw import mu_compress, mu_expand, mu_law_dequantize, mu_law_quantize
from chromahash._transfer import (
    adobe_rgb_eotf,
    bt2020_pq_eotf,
    prophoto_rgb_eotf,
    srgb_eotf,
    srgb_gamma,
)

# ── helpers ───────────────────────────────────────────────────────────────────

SPEC_VECTORS = os.path.join(os.path.dirname(__file__), "../../spec/test-vectors")


def solid_image(w: int, h: int, r: int, g: int, b: int, a: int) -> bytes:
    rgba = bytearray(w * h * 4)
    for i in range(w * h):
        rgba[i * 4] = r
        rgba[i * 4 + 1] = g
        rgba[i * 4 + 2] = b
        rgba[i * 4 + 3] = a
    return bytes(rgba)


def horizontal_gradient(w: int, h: int) -> bytes:
    rgba = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            t = x / max(w - 1, 1)
            idx = (y * w + x) * 4
            rgba[idx] = int(t * 255)
            rgba[idx + 1] = int((1.0 - t) * 255)
            rgba[idx + 2] = 128
            rgba[idx + 3] = 255
    return bytes(rgba)


def vertical_gradient(w: int, h: int) -> bytes:
    rgba = bytearray(w * h * 4)
    for y in range(h):
        t = y / max(h - 1, 1)
        for x in range(w):
            idx = (y * w + x) * 4
            rgba[idx] = int(t * 255)
            rgba[idx + 1] = int(t * 128)
            rgba[idx + 2] = int((1.0 - t) * 255)
            rgba[idx + 3] = 255
    return bytes(rgba)


# ── math_utils ────────────────────────────────────────────────────────────────


def test_round_half_away_from_zero_positive():
    assert round_half_away_from_zero(0.5) == 1.0
    assert round_half_away_from_zero(1.5) == 2.0
    assert round_half_away_from_zero(2.5) == 3.0


def test_round_half_away_from_zero_negative():
    assert round_half_away_from_zero(-0.5) == -1.0
    assert round_half_away_from_zero(-1.5) == -2.0
    assert round_half_away_from_zero(-2.5) == -3.0


def test_round_half_away_from_zero_standard():
    assert round_half_away_from_zero(0.0) == 0.0
    assert round_half_away_from_zero(0.3) == 0.0
    assert round_half_away_from_zero(0.7) == 1.0
    assert round_half_away_from_zero(-0.3) == 0.0
    assert round_half_away_from_zero(-0.7) == -1.0


def test_cbrt_positive():
    assert abs(cbrt_signed(8.0) - 2.0) < 1e-12
    assert abs(cbrt_signed(27.0) - 3.0) < 1e-12
    assert abs(cbrt_signed(1.0) - 1.0) < 1e-12


def test_cbrt_negative():
    assert abs(cbrt_signed(-8.0) - (-2.0)) < 1e-12
    assert abs(cbrt_signed(-27.0) - (-3.0)) < 1e-12


def test_cbrt_zero():
    assert cbrt_signed(0.0) == 0.0


def test_clamp01():
    assert clamp01(-0.5) == 0.0
    assert clamp01(0.5) == 0.5
    assert clamp01(1.5) == 1.0


def test_matvec3_identity():
    identity = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    v = [3.0, 4.0, 5.0]
    assert matvec3(identity, v) == v


# ── transfer ──────────────────────────────────────────────────────────────────


def test_srgb_roundtrip():
    for x in [0.0, 0.01, 0.04045, 0.1, 0.5, 0.9, 1.0]:
        linear = srgb_eotf(x)
        gamma = srgb_gamma(linear)
        assert abs(gamma - x) < 1e-4, f"sRGB roundtrip at {x}: got {gamma}"


def test_srgb_boundaries():
    assert srgb_eotf(0.0) == 0.0
    assert abs(srgb_eotf(1.0) - 1.0) < 1e-12
    assert srgb_gamma(0.0) == 0.0
    assert abs(srgb_gamma(1.0) - 1.0) < 1e-12


def test_adobe_rgb_boundaries():
    assert adobe_rgb_eotf(0.0) == 0.0
    assert abs(adobe_rgb_eotf(1.0) - 1.0) < 1e-12


def test_prophoto_boundaries():
    assert prophoto_rgb_eotf(0.0) == 0.0
    assert abs(prophoto_rgb_eotf(1.0) - 1.0) < 1e-12


def test_bt2020_pq_boundaries():
    assert bt2020_pq_eotf(0.0) == 0.0
    max_val = bt2020_pq_eotf(1.0)
    assert 0.9 < max_val < 1.0, f"PQ(1.0) should be near 1.0, got {max_val}"


# ── color ─────────────────────────────────────────────────────────────────────


def test_white_to_oklab():
    lab = linear_rgb_to_oklab([1.0, 1.0, 1.0], Gamut.SRGB)
    assert abs(lab[0] - 1.0) < 1e-6, f"white L should ≈ 1, got {lab[0]}"
    assert abs(lab[1]) < 1e-6, f"white a should ≈ 0, got {lab[1]}"
    assert abs(lab[2]) < 1e-6, f"white b should ≈ 0, got {lab[2]}"


def test_black_to_oklab():
    lab = linear_rgb_to_oklab([0.0, 0.0, 0.0], Gamut.SRGB)
    assert abs(lab[0]) < 1e-12
    assert abs(lab[1]) < 1e-12
    assert abs(lab[2]) < 1e-12


def test_roundtrip_srgb():
    test_colors = [
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.5, 0.5, 0.5],
        [0.2, 0.7, 0.3],
    ]
    for rgb in test_colors:
        lab = linear_rgb_to_oklab(rgb, Gamut.SRGB)
        rgb2 = oklab_to_linear_srgb(lab)
        for i in range(3):
            assert abs(rgb[i] - rgb2[i]) < 1e-6, f"roundtrip failed for {rgb} at channel {i}"


def test_p3_vs_srgb_red_differ():
    srgb_red = linear_rgb_to_oklab([1.0, 0.0, 0.0], Gamut.SRGB)
    p3_red = linear_rgb_to_oklab([1.0, 0.0, 0.0], Gamut.DISPLAY_P3)
    assert abs(srgb_red[1] - p3_red[1]) > 0.01, "P3 and sRGB red should differ in OKLAB a"


# ── mulaw ─────────────────────────────────────────────────────────────────────


def test_mulaw_roundtrip():
    for v in [-1.0, -0.5, 0.0, 0.5, 1.0]:
        c = mu_compress(v)
        rt = mu_expand(c)
        assert abs(rt - v) < 1e-12, f"µ-law roundtrip failed at v={v}: got {rt}"


def test_mulaw_compressed_range():
    assert abs(mu_compress(1.0) - 1.0) < 1e-12
    assert abs(mu_compress(-1.0) + 1.0) < 1e-12
    assert abs(mu_compress(0.0)) < 1e-12


def test_quantize_4bit():
    mid = mu_law_quantize(0.0, 4)
    assert mid == 8, f"midpoint for 4-bit should be 8, got {mid}"
    assert mu_law_quantize(-1.0, 4) == 0
    assert mu_law_quantize(1.0, 4) == 15


def test_quantize_5bit():
    mid = mu_law_quantize(0.0, 5)
    assert mid == 16, f"midpoint for 5-bit should be 16, got {mid}"
    assert mu_law_quantize(-1.0, 5) == 0
    assert mu_law_quantize(1.0, 5) == 31


def test_quantize_roundtrip_sign():
    for bits in [4, 5, 6]:
        for v in [-0.9, -0.5, -0.1, 0.1, 0.5, 0.9]:
            q = mu_law_quantize(v, bits)
            dq = mu_law_dequantize(q, bits)
            if v > 0.0:
                assert dq >= 0.0, f"sign should be preserved for v={v}"
            else:
                assert dq <= 0.0, f"sign should be preserved for v={v}"


# ── bitpack ───────────────────────────────────────────────────────────────────


def test_bitpack_basic_roundtrip():
    buf = bytearray(4)
    write_bits(buf, 0, 8, 0xAB)
    assert read_bits(buf, 0, 8) == 0xAB


def test_bitpack_offset_roundtrip():
    buf = bytearray(4)
    write_bits(buf, 3, 5, 0x1F)
    assert read_bits(buf, 3, 5) == 0x1F


def test_bitpack_cross_byte():
    buf = bytearray(4)
    write_bits(buf, 6, 8, 0xCA)
    assert read_bits(buf, 6, 8) == 0xCA


def test_bitpack_multiple_fields():
    buf = bytearray(8)
    write_bits(buf, 0, 7, 100)
    write_bits(buf, 7, 7, 64)
    write_bits(buf, 14, 7, 80)
    write_bits(buf, 21, 6, 33)
    write_bits(buf, 27, 6, 20)
    write_bits(buf, 33, 5, 15)
    write_bits(buf, 38, 8, 128)
    write_bits(buf, 46, 1, 1)
    write_bits(buf, 47, 1, 0)

    assert read_bits(buf, 0, 7) == 100
    assert read_bits(buf, 7, 7) == 64
    assert read_bits(buf, 14, 7) == 80
    assert read_bits(buf, 21, 6) == 33
    assert read_bits(buf, 27, 6) == 20
    assert read_bits(buf, 33, 5) == 15
    assert read_bits(buf, 38, 8) == 128
    assert read_bits(buf, 46, 1) == 1
    assert read_bits(buf, 47, 1) == 0


def test_bitpack_max_values():
    for bits in range(1, 9):
        max_val = (1 << bits) - 1
        buf = bytearray(4)
        write_bits(buf, 0, bits, max_val)
        assert read_bits(buf, 0, bits) == max_val


# ── dct ───────────────────────────────────────────────────────────────────────


def test_scan_order_counts():
    assert len(triangular_scan_order(3, 3)) == 5
    assert len(triangular_scan_order(4, 4)) == 9
    assert len(triangular_scan_order(6, 6)) == 20
    assert len(triangular_scan_order(7, 7)) == 27


def test_scan_order_4x4():
    order = triangular_scan_order(4, 4)
    expected = [(1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (2, 1), (0, 2), (1, 2), (0, 3)]
    assert order == expected


def test_scan_order_3x3():
    order = triangular_scan_order(3, 3)
    expected = [(1, 0), (2, 0), (0, 1), (1, 1), (0, 2)]
    assert order == expected


def test_dc_of_constant_channel():
    val = 0.7
    channel = [val] * 16
    dc, _, _ = dct_encode(channel, 4, 4, 4, 4)
    assert abs(dc - val) < 1e-12, f"DC of constant channel should = {val}, got {dc}"


def test_ac_of_constant_channel_is_zero():
    channel = [0.5] * 16
    _, ac, scale = dct_encode(channel, 4, 4, 4, 4)
    assert scale < 1e-12, "AC of constant channel should be 0"
    for i, v in enumerate(ac):
        assert abs(v) < 1e-12, f"AC[{i}] should be 0, got {v}"


def test_dct_encode_decode_roundtrip_constant():
    val = 0.42
    channel = [val] * 64
    nx, ny = 4, 4
    dc, ac, _ = dct_encode(channel, 8, 8, nx, ny)
    scan = triangular_scan_order(nx, ny)
    for y in range(8):
        for x in range(8):
            reconstructed = dct_decode_pixel(dc, ac, scan, x, y, 8, 8)
            assert abs(reconstructed - val) < 1e-10, f"constant roundtrip failed at ({x},{y})"


def test_dct_encode_decode_gradient():
    w, h = 8, 8
    channel = [(x / w + y / h) / 2.0 for y in range(h) for x in range(w)]
    nx, ny = 7, 7
    dc, ac, _ = dct_encode(channel, w, h, nx, ny)
    scan = triangular_scan_order(nx, ny)
    max_err = 0.0
    for y in range(h):
        for x in range(w):
            reconstructed = dct_decode_pixel(dc, ac, scan, x, y, w, h)
            max_err = max(max_err, abs(reconstructed - channel[x + y * w]))
    assert max_err < 0.02, f"gradient reconstruction max error too large: {max_err}"


# ── aspect ────────────────────────────────────────────────────────────────────


def test_square_encodes_to_128():
    assert encode_aspect(1, 1) == 128


def test_extreme_4_1():
    assert encode_aspect(4, 1) == 255


def test_extreme_1_4():
    assert encode_aspect(1, 4) == 0


def test_known_aspect_ratios():
    for w, h, label in [(1, 1, "1:1"), (3, 2, "3:2"), (4, 3, "4:3"), (16, 9, "16:9")]:
        byte = encode_aspect(w, h)
        decoded = decode_aspect(byte)
        actual = w / h
        err = abs(decoded - actual) / actual * 100.0
        assert err < 0.55, f"Aspect {label}: error={err:.3f}% ≥ 0.55%"


def test_decode_output_size_landscape():
    byte = encode_aspect(2, 1)
    w, h = decode_output_size(byte)
    assert w == 32
    assert h < 32


def test_decode_output_size_portrait():
    byte = encode_aspect(1, 2)
    w, h = decode_output_size(byte)
    assert w < 32
    assert h == 32


# ── ChromaHash integration ────────────────────────────────────────────────────


def test_encode_produces_32_bytes():
    rgba = solid_image(4, 4, 128, 128, 128, 255)
    h = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
    assert len(h.as_bytes()) == 32


def test_solid_color_roundtrip():
    rgba = solid_image(4, 4, 200, 100, 50, 255)
    h = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
    r, g, b, a = h.average_color()
    assert abs(r - 200) <= 3, f"R: expected ~200, got {r}"
    assert abs(g - 100) <= 3, f"G: expected ~100, got {g}"
    assert abs(b - 50) <= 3, f"B: expected ~50, got {b}"
    assert a == 255


def test_solid_black_roundtrip():
    rgba = solid_image(4, 4, 0, 0, 0, 255)
    h = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
    r, g, b, _ = h.average_color()
    assert r <= 2, f"R should be ~0, got {r}"
    assert g <= 2, f"G should be ~0, got {g}"
    assert b <= 2, f"B should be ~0, got {b}"


def test_solid_white_roundtrip():
    rgba = solid_image(4, 4, 255, 255, 255, 255)
    h = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
    r, g, b, _ = h.average_color()
    assert r >= 253, f"R should be ~255, got {r}"
    assert g >= 253, f"G should be ~255, got {g}"
    assert b >= 253, f"B should be ~255, got {b}"


def test_has_alpha_flag_opaque():
    rgba = solid_image(4, 4, 128, 128, 128, 255)
    h = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
    has_alpha = (h.as_bytes()[5] >> 6) & 1
    assert has_alpha == 0, "opaque image should not have alpha flag"


def test_has_alpha_flag_semi_transparent():
    rgba = solid_image(4, 4, 128, 128, 128, 128)
    h = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
    header = sum(h.as_bytes()[i] << (i * 8) for i in range(6))
    has_alpha = ((header >> 46) & 1) == 1
    assert has_alpha, "semi-transparent image should have alpha flag"


def test_decode_produces_valid_dimensions():
    rgba = solid_image(4, 4, 128, 64, 32, 255)
    h = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
    w, hh, pixels = h.decode()
    assert 0 < w <= 32
    assert 0 < hh <= 32
    assert len(pixels) == w * hh * 4


def test_decode_solid_color_uniform():
    rgba = solid_image(4, 4, 128, 128, 128, 255)
    h = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
    w, hh, pixels = h.decode()
    r0, g0, b0 = pixels[0], pixels[1], pixels[2]
    for i in range(w * hh):
        r, g, b = pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2]
        assert abs(r - r0) <= 2, f"pixel {i} R diverges"
        assert abs(g - g0) <= 2, f"pixel {i} G diverges"
        assert abs(b - b0) <= 2, f"pixel {i} B diverges"


def test_gradient_encode_decode():
    rgba = horizontal_gradient(16, 16)
    h = ChromaHash.encode(16, 16, rgba, Gamut.SRGB)
    w, hh, _ = h.decode()
    assert w > 0 and hh > 0


def test_vertical_gradient_encode_decode():
    rgba = vertical_gradient(16, 16)
    h = ChromaHash.encode(16, 16, rgba, Gamut.SRGB)
    w, hh, _ = h.decode()
    assert w > 0 and hh > 0


def test_one_by_one_pixel():
    rgba = solid_image(1, 1, 200, 100, 50, 255)
    h = ChromaHash.encode(1, 1, rgba, Gamut.SRGB)
    assert len(h.as_bytes()) == 32
    r, _, _, _ = h.average_color()
    assert abs(r - 200) <= 3, f"1×1 R: expected ~200, got {r}"


def test_large_image_100x100():
    rgba = horizontal_gradient(100, 100)
    h = ChromaHash.encode(100, 100, rgba, Gamut.SRGB)
    assert len(h.as_bytes()) == 32


def test_various_aspect_ratios():
    for w, hh in [(16, 4), (4, 16), (10, 10), (3, 7), (100, 25)]:
        rgba = solid_image(w, hh, 128, 64, 32, 255)
        h = ChromaHash.encode(w, hh, rgba, Gamut.SRGB)
        dw, dh, pixels = h.decode()
        assert dw > 0 and dh > 0, f"decode dims should be > 0 for {w}×{hh}"
        assert len(pixels) == dw * dh * 4, f"pixel length mismatch for {w}×{hh}"


def test_all_gamuts_produce_output():
    rgba = solid_image(4, 4, 200, 100, 50, 255)
    for gamut in [Gamut.SRGB, Gamut.DISPLAY_P3, Gamut.ADOBE_RGB, Gamut.BT2020, Gamut.PROPHOTO_RGB]:
        h = ChromaHash.encode(4, 4, rgba, gamut)
        assert len(h.as_bytes()) == 32, f"gamut {gamut} should produce 32 bytes"


def test_transparency_roundtrip():
    w, hh = 8, 8
    rgba = bytearray(w * hh * 4)
    for y in range(hh):
        for x in range(w):
            idx = (y * w + x) * 4
            if y < hh // 2:
                rgba[idx] = 255
                rgba[idx + 3] = 255
            else:
                rgba[idx + 3] = 0
    h = ChromaHash.encode(w, hh, bytes(rgba), Gamut.SRGB)

    header = sum(h.as_bytes()[i] << (i * 8) for i in range(6))
    has_alpha = ((header >> 46) & 1) == 1
    assert has_alpha, "should detect alpha"

    dw, dh, pixels = h.decode()
    assert dw > 0 and dh > 0
    alpha_vals = [pixels[i * 4 + 3] for i in range(dw * dh)]
    assert max(alpha_vals) > min(alpha_vals), "alpha should vary across decoded image"


def test_from_bytes_roundtrip():
    rgba = solid_image(4, 4, 128, 64, 32, 255)
    h1 = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
    h2 = ChromaHash.from_bytes(h1.as_bytes())
    assert h1 == h2


def test_deterministic_encoding():
    rgba = horizontal_gradient(16, 16)
    h1 = ChromaHash.encode(16, 16, rgba, Gamut.SRGB)
    h2 = ChromaHash.encode(16, 16, rgba, Gamut.SRGB)
    assert h1.as_bytes() == h2.as_bytes(), "encoding should be deterministic"


# ── spec test vectors ──────────────────────────────────────────────────────────


def _gamut_from_string(s: str) -> Gamut:
    return {
        "Display P3": Gamut.DISPLAY_P3,
        "Adobe RGB": Gamut.ADOBE_RGB,
        "BT.2020": Gamut.BT2020,
        "ProPhoto RGB": Gamut.PROPHOTO_RGB,
    }.get(s, Gamut.SRGB)


def test_unit_color_vectors():
    path = os.path.join(SPEC_VECTORS, "unit-color.json")
    if not os.path.exists(path):
        pytest.skip("unit-color.json not found")
    with open(path) as f:
        cases = json.load(f)
    for tc in cases:
        gamut = _gamut_from_string(tc["input"]["gamut"])
        if "linear_rgb" in tc["input"]:
            lab = linear_rgb_to_oklab(tc["input"]["linear_rgb"], gamut)
        else:
            rgb = tc["input"]["gamma_rgb"]
            lab = gamma_rgb_to_oklab(rgb[0], rgb[1], rgb[2], gamut)
        for i in range(3):
            assert abs(lab[i] - tc["expected"]["oklab"][i]) < 1e-6, (
                f"{tc['name']}: oklab[{i}] got {lab[i]}, want {tc['expected']['oklab'][i]}"
            )
        if "roundtrip_srgb" in tc["expected"]:
            rt = oklab_to_linear_srgb(lab)
            for i in range(3):
                assert abs(rt[i] - tc["expected"]["roundtrip_srgb"][i]) < 1e-6, (
                    f"{tc['name']}: roundtrip sRGB[{i}] got {rt[i]}"
                )


def test_unit_mulaw_vectors():
    path = os.path.join(SPEC_VECTORS, "unit-mulaw.json")
    if not os.path.exists(path):
        pytest.skip("unit-mulaw.json not found")
    with open(path) as f:
        cases = json.load(f)
    for tc in cases:
        value = tc["input"]["value"]
        bits = tc["input"]["bits"]
        c = mu_compress(value)
        assert abs(c - tc["expected"]["compressed"]) < 1e-12, (
            f"{tc['name']}: compress({value}) = {c}, want {tc['expected']['compressed']}"
        )
        e = mu_expand(c)
        assert abs(e - tc["expected"]["expanded"]) < 1e-12, (
            f"{tc['name']}: expand = {e}, want {tc['expected']['expanded']}"
        )
        q = mu_law_quantize(value, bits)
        assert q == tc["expected"]["quantized"], (
            f"{tc['name']}: quantize({value}, {bits}) = {q}, want {tc['expected']['quantized']}"
        )
        dq = mu_law_dequantize(q, bits)
        assert abs(dq - tc["expected"]["dequantized"]) < 1e-12, (
            f"{tc['name']}: dequantize = {dq}, want {tc['expected']['dequantized']}"
        )


def test_unit_dct_vectors():
    path = os.path.join(SPEC_VECTORS, "unit-dct.json")
    if not os.path.exists(path):
        pytest.skip("unit-dct.json not found")
    with open(path) as f:
        cases = json.load(f)
    for tc in cases:
        nx, ny = tc["input"]["nx"], tc["input"]["ny"]
        order = triangular_scan_order(nx, ny)
        assert len(order) == tc["expected"]["ac_count"], (
            f"{tc['name']}: scan order count = {len(order)}, want {tc['expected']['ac_count']}"
        )
        for i, pair in enumerate(order):
            if i >= len(tc["expected"]["scan_order"]):
                break
            exp = tc["expected"]["scan_order"][i]
            assert pair == (exp[0], exp[1]), f"{tc['name']}: scan[{i}] = {pair}, want {exp}"


def test_unit_aspect_vectors():
    path = os.path.join(SPEC_VECTORS, "unit-aspect.json")
    if not os.path.exists(path):
        pytest.skip("unit-aspect.json not found")
    with open(path) as f:
        cases = json.load(f)
    for tc in cases:
        w, h = tc["input"]["width"], tc["input"]["height"]
        b = encode_aspect(w, h)
        assert b == tc["expected"]["byte"], (
            f"{tc['name']}: encodeAspect({w},{h}) = {b}, want {tc['expected']['byte']}"
        )
        ratio = decode_aspect(b)
        assert abs(ratio - tc["expected"]["decoded_ratio"]) < 1e-12, (
            f"{tc['name']}: decodeAspect = {ratio}"
        )
        ow, oh = decode_output_size(b)
        assert ow == tc["expected"]["output_width"], f"{tc['name']}: output_width mismatch"
        assert oh == tc["expected"]["output_height"], f"{tc['name']}: output_height mismatch"


def test_integration_encode_vectors():
    path = os.path.join(SPEC_VECTORS, "integration-encode.json")
    if not os.path.exists(path):
        pytest.skip("integration-encode.json not found")
    with open(path) as f:
        cases = json.load(f)
    for tc in cases:
        rgba = bytes(tc["input"]["rgba"])
        gamut = _gamut_from_string(tc["input"]["gamut"])
        ch = ChromaHash.encode(tc["input"]["width"], tc["input"]["height"], rgba, gamut)
        for i, want in enumerate(tc["expected"]["hash"]):
            assert ch.as_bytes()[i] == want, (
                f"{tc['name']}: hash[{i}] = {ch.as_bytes()[i]}, want {want}"
            )
        r, g, b, a = ch.average_color()
        avg = [r, g, b, a]
        for i in range(4):
            assert avg[i] == tc["expected"]["average_color"][i], (
                f"{tc['name']}: average_color[{i}] = {avg[i]}, "
                f"want {tc['expected']['average_color'][i]}"
            )


def test_integration_decode_vectors():
    path = os.path.join(SPEC_VECTORS, "integration-decode.json")
    if not os.path.exists(path):
        pytest.skip("integration-decode.json not found")
    with open(path) as f:
        cases = json.load(f)
    for tc in cases:
        hash_bytes = bytes(tc["input"]["hash"])
        ch = ChromaHash.from_bytes(hash_bytes)
        w, h, rgba = ch.decode()
        assert w == tc["expected"]["width"], (
            f"{tc['name']}: width = {w}, want {tc['expected']['width']}"
        )
        assert h == tc["expected"]["height"], (
            f"{tc['name']}: height = {h}, want {tc['expected']['height']}"
        )
        for i, want in enumerate(tc["expected"]["rgba"]):
            assert rgba[i] == want, f"{tc['name']}: rgba[{i}] = {rgba[i]}, want {want}"


# ── additional edge cases ──────────────────────────────────────────────────────


def test_gamma_rgb_all_gamuts():
    for gamut in [Gamut.SRGB, Gamut.DISPLAY_P3, Gamut.ADOBE_RGB, Gamut.BT2020, Gamut.PROPHOTO_RGB]:
        lab = gamma_rgb_to_oklab(0.5, 0.5, 0.5, gamut)
        assert len(lab) == 3
        assert all(math.isfinite(v) for v in lab)


def test_encode_invalid_dimensions():
    rgba = solid_image(4, 4, 128, 128, 128, 255)
    with pytest.raises((ValueError, AssertionError)):
        ChromaHash.encode(0, 4, rgba, Gamut.SRGB)
    with pytest.raises((ValueError, AssertionError)):
        ChromaHash.encode(4, 0, rgba, Gamut.SRGB)
    with pytest.raises((ValueError, AssertionError)):
        ChromaHash.encode(101, 4, rgba, Gamut.SRGB)
