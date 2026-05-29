"""DCT encode/decode for ChromaHash channels."""

import math

from chromahash._aspect import decode_output_size
from chromahash._math_utils import portable_cos


def scan_order(nx: int, ny: int, aspect_byte: int) -> list[tuple[int, int]]:
    """Compute the AC coefficient scan order for an nx×ny grid keyed on aspect_byte.
    Per spec §6.2 (v0.4): coefficients are sorted ascending by per-pixel frequency priority
    `(cx*h)^2 + (cy*w)^2` where (w,h) = decodeOutputSize(aspect_byte).
    Ties broken by (cx, cy). Excludes DC at (0,0).
    """
    w, h = decode_output_size(aspect_byte)
    entries: list[tuple[int, int, int]] = []
    for cy in range(ny):
        cx = 1 if cy == 0 else 0
        while cx * ny < nx * (ny - cy):
            priority = (cx * h) * (cx * h) + (cy * w) * (cy * w)
            entries.append((priority, cx, cy))
            cx += 1
    entries.sort()
    return [(cx, cy) for (_, cx, cy) in entries]


def dct_encode(
    channel: list[float],
    w: int,
    h: int,
    scan: list[tuple[int, int]],
) -> tuple[float, list[float], float]:
    """Forward DCT encode for a channel. Per spec §12.6 dctEncode (v0.4).
    Returns (dc, ac_coefficients, scale). AC values are emitted in `scan` order.
    """
    wh = w * h
    dc = sum(channel) / wh

    ac: list[float] = []
    scale = 0.0
    for cx, cy in scan:
        f = 0.0
        for y in range(h):
            fy = portable_cos(math.pi / h * cy * (y + 0.5))
            for x in range(w):
                f += channel[x + y * w] * portable_cos(math.pi / w * cx * (x + 0.5)) * fy
        f /= wh
        ac.append(f)
        scale = max(scale, abs(f))

    # Floor near-zero scale to exactly zero. When the channel is (near-)constant,
    # floating-point noise produces tiny AC values. Without this threshold,
    # dividing AC/scale amplifies platform-specific ULP differences into
    # divergent quantized codes.
    if scale < 1e-10:
        ac = [0.0] * len(ac)
        scale = 0.0

    return (dc, ac, scale)


def precompute_cos_table(dim: int, max_freq: int) -> list[list[float]]:
    """Precompute cosine table for DCT: table[freq][pos] = cos(pi/dim * freq * (pos+0.5)).
    Per spec §12.6. Uses portable_cos for cross-platform determinism.
    """
    return [
        [portable_cos(math.pi / dim * freq * (pos + 0.5)) for pos in range(dim)]
        for freq in range(max_freq)
    ]


def dct_encode_separable(
    channel: list[float],
    w: int,
    h: int,
    scan: list[tuple[int, int]],
    cos_x: list[list[float]],
    cos_y: list[list[float]],
) -> tuple[float, list[float], float]:
    """Forward DCT encode using precomputed cosine tables. Per spec §12.6 (v0.4).
    Semantically identical to dct_encode but avoids redundant cosine evaluations.
    cos_x/cos_y must have rows for all (cx, cy) in `scan`.
    """
    wh = w * h
    dc = sum(channel) / wh

    ac: list[float] = []
    scale = 0.0
    for cx, cy in scan:
        cx_row = cos_x[cx]
        cy_row = cos_y[cy]
        f = 0.0
        for y in range(h):
            fy = cy_row[y]
            for x in range(w):
                f += channel[x + y * w] * cx_row[x] * fy
        f /= wh
        ac.append(f)
        scale = max(scale, abs(f))

    if scale < 1e-10:
        ac = [0.0] * len(ac)
        scale = 0.0

    return (dc, ac, scale)


def dct_decode_pixel(
    dc: float,
    ac: list[float],
    scan_order: list[tuple[int, int]],
    x: int,
    y: int,
    w: int,
    h: int,
) -> float:
    """Inverse DCT at a single pixel (x, y) for a channel."""
    value = dc
    for j, (cx, cy) in enumerate(scan_order):
        cx_factor = 2.0 if cx > 0 else 1.0
        cy_factor = 2.0 if cy > 0 else 1.0
        fx = portable_cos(math.pi / w * cx * (x + 0.5))
        fy = portable_cos(math.pi / h * cy * (y + 0.5))
        value += ac[j] * fx * fy * cx_factor * cy_factor
    return value


def dct_decode_pixel_separable(
    dc: float,
    ac: list[float],
    scan_order: list[tuple[int, int]],
    x: int,
    y: int,
    cos_x: list[list[float]],
    cos_y: list[list[float]],
) -> float:
    """Inverse DCT at a single pixel using precomputed cosine tables. Per spec §12.6.
    Semantically identical to dct_decode_pixel but reads cos_x[cx][x] / cos_y[cy][y].
    The cx/cy factors stay as separate multiplies to preserve the float operation order.
    """
    value = dc
    for j, (cx, cy) in enumerate(scan_order):
        cx_factor = 2.0 if cx > 0 else 1.0
        cy_factor = 2.0 if cy > 0 else 1.0
        fx = cos_x[cx][x]
        fy = cos_y[cy][y]
        value += ac[j] * fx * fy * cx_factor * cy_factor
    return value
