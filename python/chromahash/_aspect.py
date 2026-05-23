"""Aspect ratio encoding and decoding. Per spec §8."""

import math

from ._math_utils import portable_ln, portable_pow, round_half_away_from_zero


def encode_aspect(w: int, h: int) -> int:
    """Encode aspect ratio as a single byte. Per spec §8.1."""
    ratio = w / h
    raw = (portable_ln(ratio) / portable_ln(2.0) + 4.0) / 8.0 * 255.0
    byte = int(round_half_away_from_zero(raw))
    return max(0, min(255, byte))


def decode_aspect(byte: int) -> float:
    """Decode aspect ratio from byte. Per spec §8.1."""
    return portable_pow(2.0, byte / 255.0 * 8.0 - 4.0)


def decode_output_size(byte: int) -> tuple[int, int]:
    """Decode output size from aspect byte. Longer side = 32px. Per spec §8.2."""
    ratio = decode_aspect(byte)
    if ratio > 1.0:
        h = int(max(1.0, round_half_away_from_zero(32.0 / ratio)))
        return (32, h)
    w = int(max(1.0, round_half_away_from_zero(32.0 * ratio)))
    return (w, 32)


def derive_grid(aspect_byte: int, base_n: int) -> tuple[int, int]:
    """Derive adaptive DCT grid (nx, ny) from aspect byte and base_n. Per spec §6.3 (v0.4).
    Uses sqrt(scale) with nx_cap = 2*base_n and product preservation
    (ny = round(base_n^2 / nx)). sqrt is IEEE 754 correctly-rounded.
    """
    ratio = portable_pow(2.0, aspect_byte / 255.0 * 8.0 - 4.0)
    base = float(base_n)
    nx_cap = 2 * base_n
    if ratio >= 1.0:
        scale = min(ratio, 16.0)
        nx = min(int(round_half_away_from_zero(base * math.sqrt(scale))), nx_cap)
        ny = int(round_half_away_from_zero(base * base / nx))
    else:
        scale = min(1.0 / ratio, 16.0)
        ny = min(int(round_half_away_from_zero(base * math.sqrt(scale))), nx_cap)
        nx = int(round_half_away_from_zero(base * base / ny))
    return (max(nx, 3), max(ny, 3))
