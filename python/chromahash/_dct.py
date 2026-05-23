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
