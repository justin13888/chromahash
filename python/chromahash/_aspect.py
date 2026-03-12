"""Aspect ratio encoding and decoding. Per spec §8."""

import math

from ._math_utils import round_half_away_from_zero


def encode_aspect(w: int, h: int) -> int:
    """Encode aspect ratio as a single byte. Per spec §8.1."""
    ratio = w / h
    raw = (math.log2(ratio) + 2.0) / 4.0 * 255.0
    byte = int(round_half_away_from_zero(raw))
    return max(0, min(255, byte))


def decode_aspect(byte: int) -> float:
    """Decode aspect ratio from byte. Per spec §8.1."""
    return 2.0 ** (byte / 255.0 * 4.0 - 2.0)


def decode_output_size(byte: int) -> tuple[int, int]:
    """Decode output size from aspect byte. Longer side = 32px. Per spec §8.4."""
    ratio = decode_aspect(byte)
    if ratio > 1.0:
        h = int(max(1.0, round_half_away_from_zero(32.0 / ratio)))
        return (32, h)
    w = int(max(1.0, round_half_away_from_zero(32.0 * ratio)))
    return (w, 32)
