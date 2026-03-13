"""DCT encode/decode for ChromaHash channels."""

import math

from chromahash._math_utils import portable_cos


def triangular_scan_order(nx: int, ny: int) -> list[tuple[int, int]]:
    """Compute the triangular scan order for an nx×ny grid, excluding DC.
    Per spec §6.6: row-major, condition cx*ny < nx*(ny-cy), skip (0,0).
    """
    order = []
    for cy in range(ny):
        cx = 1 if cy == 0 else 0
        while cx * ny < nx * (ny - cy):
            order.append((cx, cy))
            cx += 1
    return order


def dct_encode(
    channel: list[float],
    w: int,
    h: int,
    nx: int,
    ny: int,
) -> tuple[float, list[float], float]:
    """Forward DCT encode for a channel. Per spec §12.7 dctEncode.
    Returns (dc, ac_coefficients, scale).
    """
    wh = w * h
    dc = 0.0
    ac: list[float] = []
    scale = 0.0

    for cy in range(ny):
        cx = 0
        while cx * ny < nx * (ny - cy):
            f = 0.0
            for y in range(h):
                fy = portable_cos(math.pi / h * cy * (y + 0.5))
                for x in range(w):
                    f += channel[x + y * w] * portable_cos(math.pi / w * cx * (x + 0.5)) * fy
            f /= wh
            if cx > 0 or cy > 0:
                ac.append(f)
                scale = max(scale, abs(f))
            else:
                dc = f
            cx += 1

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
