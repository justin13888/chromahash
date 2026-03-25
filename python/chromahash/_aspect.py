"""Aspect ratio encoding and decoding. Per spec §8."""

import math

from ._math_utils import round_half_away_from_zero


def encode_aspect(w: int, h: int) -> int:
    """Encode aspect ratio as a single byte. Per spec §8.1 (v0.3)."""
    ratio = w / h
    raw = (math.log2(ratio) + 4.0) / 8.0 * 255.0
    byte = int(round_half_away_from_zero(raw))
    return max(0, min(255, byte))


def decode_aspect(byte: int) -> float:
    """Decode aspect ratio from byte. Per spec §8.1 (v0.3)."""
    return 2.0 ** (byte / 255.0 * 8.0 - 4.0)


def decode_output_size(byte: int) -> tuple[int, int]:
    """Decode output size from aspect byte. Longer side = 32px. Per spec §8.4."""
    ratio = decode_aspect(byte)
    if ratio > 1.0:
        h = int(max(1.0, round_half_away_from_zero(32.0 / ratio)))
        return (32, h)
    w = int(max(1.0, round_half_away_from_zero(32.0 * ratio)))
    return (w, 32)


def derive_grid(aspect_byte: int, base_n: int) -> tuple[int, int]:
    """Derive adaptive DCT grid (nx, ny) from aspect byte and base_n. Per spec §3.2."""
    from ._math_utils import portable_pow, round_half_away_from_zero

    ratio = portable_pow(2.0, aspect_byte / 255.0 * 8.0 - 4.0)
    base = float(base_n)
    if ratio >= 1.0:
        scale = min(ratio, 16.0)
        s = portable_pow(scale, 0.25)
        nx = int(round_half_away_from_zero(base * s))
        ny = int(round_half_away_from_zero(base / s))
    else:
        scale = min(1.0 / ratio, 16.0)
        s = portable_pow(scale, 0.25)
        nx = int(round_half_away_from_zero(base / s))
        ny = int(round_half_away_from_zero(base * s))
    return (max(nx, 3), max(ny, 3))
