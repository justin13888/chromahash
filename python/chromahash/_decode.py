"""ChromaHash decoder. Per spec §11."""

from ._aspect import decode_output_size
from ._bitpack import read_bits
from ._color import oklab_to_srgb
from ._constants import (
    MAX_A_ALPHA_SCALE,
    MAX_A_SCALE,
    MAX_B_SCALE,
    MAX_CHROMA_A,
    MAX_CHROMA_B,
    MAX_L_SCALE,
)
from ._dct import dct_decode_pixel, triangular_scan_order
from ._math_utils import clamp01, round_half_away_from_zero
from ._mulaw import mu_law_dequantize


def decode(hash_bytes: bytes) -> tuple[int, int, bytes]:
    """Decode a ChromaHash into RGBA pixel data. Per spec §11.
    Returns (width, height, rgba_pixels).
    """
    # 1. Unpack header (48 bits)
    header = 0
    for i in range(6):
        header |= hash_bytes[i] << (i * 8)

    l_dc_q = header & 0x7F
    a_dc_q = (header >> 7) & 0x7F
    b_dc_q = (header >> 14) & 0x7F
    l_scl_q = (header >> 21) & 0x3F
    a_scl_q = (header >> 27) & 0x3F
    b_scl_q = (header >> 33) & 0x1F
    aspect = (header >> 38) & 0xFF
    has_alpha = ((header >> 46) & 1) == 1

    # 2. Decode DC values and scale factors
    l_dc = l_dc_q / 127.0
    a_dc = (a_dc_q - 64.0) / 63.0 * MAX_CHROMA_A
    b_dc = (b_dc_q - 64.0) / 63.0 * MAX_CHROMA_B
    l_scale = l_scl_q / 63.0 * MAX_L_SCALE
    a_scale = a_scl_q / 63.0 * MAX_A_SCALE
    b_scale = b_scl_q / 31.0 * MAX_B_SCALE

    # 3-4. Decode aspect ratio and compute output size
    w, h = decode_output_size(aspect)

    # 5. Dequantize AC coefficients
    bitpos = 48

    if has_alpha:
        alpha_dc_val = read_bits(hash_bytes, bitpos, 5) / 31.0
        bitpos += 5
        alpha_scale_val = read_bits(hash_bytes, bitpos, 4) / 15.0 * MAX_A_ALPHA_SCALE
        bitpos += 4
    else:
        alpha_dc_val = 1.0
        alpha_scale_val = 0.0

    if has_alpha:
        l_ac: list[float] = []
        for _ in range(7):
            q = read_bits(hash_bytes, bitpos, 6)
            bitpos += 6
            l_ac.append(mu_law_dequantize(q, 6) * l_scale)
        for _ in range(7, 20):
            q = read_bits(hash_bytes, bitpos, 5)
            bitpos += 5
            l_ac.append(mu_law_dequantize(q, 5) * l_scale)
        lx, ly = 6, 6
    else:
        l_ac = []
        for _ in range(27):
            q = read_bits(hash_bytes, bitpos, 5)
            bitpos += 5
            l_ac.append(mu_law_dequantize(q, 5) * l_scale)
        lx, ly = 7, 7

    a_ac: list[float] = []
    for _ in range(9):
        q = read_bits(hash_bytes, bitpos, 4)
        bitpos += 4
        a_ac.append(mu_law_dequantize(q, 4) * a_scale)

    b_ac: list[float] = []
    for _ in range(9):
        q = read_bits(hash_bytes, bitpos, 4)
        bitpos += 4
        b_ac.append(mu_law_dequantize(q, 4) * b_scale)

    if has_alpha:
        alpha_ac: list[float] = []
        for _ in range(5):
            q = read_bits(hash_bytes, bitpos, 4)
            bitpos += 4
            alpha_ac.append(mu_law_dequantize(q, 4) * alpha_scale_val)
    else:
        alpha_ac = []

    # Precompute scan orders
    l_scan = triangular_scan_order(lx, ly)
    chroma_scan = triangular_scan_order(4, 4)
    alpha_scan = triangular_scan_order(3, 3) if has_alpha else []

    # 6. Render output image
    rgba = bytearray(w * h * 4)

    for y in range(h):
        for x in range(w):
            ok_l = dct_decode_pixel(l_dc, l_ac, l_scan, x, y, w, h)
            ok_a = dct_decode_pixel(a_dc, a_ac, chroma_scan, x, y, w, h)
            ok_b = dct_decode_pixel(b_dc, b_ac, chroma_scan, x, y, w, h)
            alpha = (
                dct_decode_pixel(alpha_dc_val, alpha_ac, alpha_scan, x, y, w, h)
                if has_alpha
                else 1.0
            )

            srgb = oklab_to_srgb([ok_l, ok_a, ok_b])
            idx = (y * w + x) * 4
            rgba[idx] = int(round_half_away_from_zero(255.0 * clamp01(srgb[0])))
            rgba[idx + 1] = int(round_half_away_from_zero(255.0 * clamp01(srgb[1])))
            rgba[idx + 2] = int(round_half_away_from_zero(255.0 * clamp01(srgb[2])))
            rgba[idx + 3] = int(round_half_away_from_zero(255.0 * clamp01(alpha)))

    return (w, h, bytes(rgba))


def average_color(hash_bytes: bytes) -> tuple[int, int, int, int]:
    """Extract the average color without full decode. Per spec §11.2.
    Returns (r, g, b, a) as int values in [0, 255].
    """
    header = 0
    for i in range(6):
        header |= hash_bytes[i] << (i * 8)

    l_dc_q = header & 0x7F
    a_dc_q = (header >> 7) & 0x7F
    b_dc_q = (header >> 14) & 0x7F
    has_alpha = ((header >> 46) & 1) == 1

    l_dc = l_dc_q / 127.0
    a_dc = (a_dc_q - 64.0) / 63.0 * MAX_CHROMA_A
    b_dc = (b_dc_q - 64.0) / 63.0 * MAX_CHROMA_B

    srgb = oklab_to_srgb([l_dc, a_dc, b_dc])

    alpha = read_bits(hash_bytes, 48, 5) / 31.0 if has_alpha else 1.0

    return (
        int(round_half_away_from_zero(255.0 * clamp01(srgb[0]))),
        int(round_half_away_from_zero(255.0 * clamp01(srgb[1]))),
        int(round_half_away_from_zero(255.0 * clamp01(srgb[2]))),
        int(round_half_away_from_zero(255.0 * clamp01(alpha))),
    )
