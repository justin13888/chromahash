"""Tests for the serial BatchEncoder."""

from __future__ import annotations

import pytest

from chromahash import BatchEncoder, ChromaHash, ChromaHashError, Gamut, ImageInput


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


def mixed_items() -> list[ImageInput]:
    """A spread of dimensions, gamuts, and alpha, mirroring the bulk-migration use case."""
    return [
        ImageInput(4, 4, solid_image(4, 4, 200, 100, 50, 255), Gamut.SRGB),
        ImageInput(8, 4, horizontal_gradient(8, 4), Gamut.DISPLAY_P3),
        ImageInput(4, 8, solid_image(4, 8, 30, 200, 120, 128), Gamut.ADOBE_RGB),
        ImageInput(16, 16, horizontal_gradient(16, 16), Gamut.BT2020),
        ImageInput(1, 1, solid_image(1, 1, 255, 0, 0, 255), Gamut.PROPHOTO_RGB),
    ]


def encode_serial(items: list[ImageInput]) -> list[ChromaHash]:
    return [ChromaHash.encode(it.w, it.h, it.rgba, it.gamut) for it in items]


def test_batch_matches_serial() -> None:
    items = mixed_items()
    batch = BatchEncoder().encode_batch(items)
    assert batch == encode_serial(items)


def test_batch_preserves_order() -> None:
    items = [
        ImageInput(8, 8, solid_image(8, 8, i, 255 - i, (i * 3) % 256, 255), Gamut.SRGB)
        for i in range(64)
    ]
    assert BatchEncoder().encode_batch(items) == encode_serial(items)


def test_empty_batch() -> None:
    assert BatchEncoder().encode_batch([]) == []


def test_context_manager() -> None:
    items = mixed_items()
    with BatchEncoder() as enc:
        assert enc.encode_batch(items) == encode_serial(items)


def test_invalid_item_raises_with_index() -> None:
    """The typed error is the same one `encode_with_quality` raises — the batch
    path does not have a taxonomy of its own.
    """
    items = [
        ImageInput(2, 2, solid_image(2, 2, 0, 0, 0, 255), Gamut.SRGB),
        ImageInput(2, 2, bytes(3), Gamut.SRGB),  # wrong length
    ]
    with pytest.raises(ChromaHashError.InvalidLength, match="item 1"):
        BatchEncoder().encode_batch(items)
