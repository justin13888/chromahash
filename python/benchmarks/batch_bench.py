"""Throughput benchmark: serial per-image encode vs. BatchEncoder.

Zero dependencies — uses only ``time.perf_counter``. Run with:

    uv run python benchmarks/batch_bench.py

The Python BatchEncoder is serial (CPython's GIL prevents CPU-bound thread
parallelism), so the batch and serial figures are expected to match (~1.0x).
This harness documents that honestly and mirrors the other languages'
benchmarks.
"""

from __future__ import annotations

import os
import time

from chromahash import BatchEncoder, ChromaHash, Gamut, ImageInput

N = 300

_GAMUTS = [
    Gamut.SRGB,
    Gamut.DISPLAY_P3,
    Gamut.ADOBE_RGB,
    Gamut.BT2020,
    Gamut.PROPHOTO_RGB,
]


def make_image(seed: int) -> ImageInput:
    w = 24 + seed % 40
    h = 24 + (seed * 7) % 40
    rgba = bytearray(w * h * 4)
    for p in range(w * h):
        rgba[p * 4] = (p * 3 + seed) % 256
        rgba[p * 4 + 1] = (p * 5 + seed * 2) % 256
        rgba[p * 4 + 2] = (p * 7 + seed * 3) % 256
        rgba[p * 4 + 3] = 200 if seed % 3 == 0 else 255
    return ImageInput(w, h, bytes(rgba), _GAMUTS[seed % len(_GAMUTS)])


def encode_serial(items: list[ImageInput]) -> list[ChromaHash]:
    return [ChromaHash.encode(it.w, it.h, it.rgba, it.gamut) for it in items]


def images_per_sec(n: int, secs: float) -> float:
    return n / secs if secs > 0 else float("inf")


def main() -> None:
    print(f"chromahash batch benchmark — {N} images, {os.cpu_count()} cores available (serial)\n")
    items = [make_image(i) for i in range(N)]

    # Verify correctness.
    assert encode_serial(items) == BatchEncoder().encode_batch(items)

    start = time.perf_counter()
    serial = encode_serial(items)
    serial_secs = time.perf_counter() - start
    assert len(serial) == N
    print(
        f"serial            : {serial_secs:8.4f}s  "
        f"{images_per_sec(N, serial_secs):10.0f} img/s  (1.00x)"
    )

    enc = BatchEncoder()
    start = time.perf_counter()
    enc.encode_batch(items)
    batch_secs = time.perf_counter() - start
    print(
        f"batch (serial)    : {batch_secs:8.4f}s  {images_per_sec(N, batch_secs):10.0f} img/s  "
        f"({serial_secs / batch_secs:.2f}x)"
    )


if __name__ == "__main__":
    main()
