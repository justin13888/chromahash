"""µ-law companding for AC coefficient quantization."""

import math

from ._constants import MU
from ._math_utils import portable_ln, portable_pow, round_half_away_from_zero


def mu_compress(value: float) -> float:
    """µ-law compress: value in [-1, 1] → compressed in [-1, 1]."""
    v = max(-1.0, min(1.0, value))
    return math.copysign(portable_ln(1.0 + MU * abs(v)) / portable_ln(1.0 + MU), v)


def mu_expand(compressed: float) -> float:
    """µ-law expand: compressed in [-1, 1] → value in [-1, 1]."""
    return math.copysign((portable_pow(1.0 + MU, abs(compressed)) - 1.0) / MU, compressed)


def mu_law_quantize(value: float, bits: int) -> int:
    """Quantize a value in [-1, 1] using µ-law to an integer index. Per spec §12.7."""
    compressed = mu_compress(value)
    max_val = (1 << bits) - 1
    index = round_half_away_from_zero((compressed + 1.0) / 2.0 * max_val)
    return int(max(0, min(max_val, index)))


def mu_law_dequantize(index: int, bits: int) -> float:
    """Dequantize an integer index back to a value in [-1, 1] using µ-law. Per spec §12.7."""
    max_val = (1 << bits) - 1
    compressed = index / max_val * 2.0 - 1.0
    return mu_expand(compressed)
