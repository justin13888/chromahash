"""ChromaHash encoder. Per spec §10."""

from ._aspect import encode_aspect
from ._bitpack import write_bits
from ._color import gamma_rgb_to_oklab
from ._constants import (
    MAX_A_ALPHA_SCALE,
    MAX_A_SCALE,
    MAX_B_SCALE,
    MAX_CHROMA_A,
    MAX_CHROMA_B,
    MAX_L_SCALE,
    Gamut,
)
from ._dct import dct_encode
from ._math_utils import clamp01, clamp_neg1_1, round_half_away_from_zero
from ._mulaw import mu_law_quantize


def encode(w: int, h: int, rgba: bytes | bytearray, gamut: Gamut) -> bytes:
    """Encode an image into a 32-byte ChromaHash. Per spec §10."""
    if not (1 <= w <= 100):
        raise ValueError("width must be 1–100")
    if not (1 <= h <= 100):
        raise ValueError("height must be 1–100")
    if len(rgba) != w * h * 4:
        raise ValueError("rgba length mismatch")

    pixel_count = w * h

    # 1-2. Convert all pixels to OKLAB, accumulate alpha-weighted average
    oklab_pixels: list[list[float]] = []
    alpha_pixels: list[float] = []
    avg_l = avg_a = avg_b = avg_alpha = 0.0

    for i in range(pixel_count):
        r = rgba[i * 4] / 255.0
        g = rgba[i * 4 + 1] / 255.0
        b = rgba[i * 4 + 2] / 255.0
        a = rgba[i * 4 + 3] / 255.0

        lab = gamma_rgb_to_oklab(r, g, b, gamut)
        avg_l += a * lab[0]
        avg_a += a * lab[1]
        avg_b += a * lab[2]
        avg_alpha += a

        oklab_pixels.append(lab)
        alpha_pixels.append(a)

    # 3. Compute alpha-weighted average color
    if avg_alpha > 0.0:
        avg_l /= avg_alpha
        avg_a /= avg_alpha
        avg_b /= avg_alpha

    # 4. Composite transparent pixels over average
    has_alpha = avg_alpha < pixel_count
    l_chan: list[float] = []
    a_chan: list[float] = []
    b_chan: list[float] = []

    for i in range(pixel_count):
        alpha = alpha_pixels[i]
        l_chan.append(avg_l * (1.0 - alpha) + alpha * oklab_pixels[i][0])
        a_chan.append(avg_a * (1.0 - alpha) + alpha * oklab_pixels[i][1])
        b_chan.append(avg_b * (1.0 - alpha) + alpha * oklab_pixels[i][2])

    # 5. DCT encode each channel
    if has_alpha:
        l_dc, l_ac, l_scale = dct_encode(l_chan, w, h, 6, 6)
    else:
        l_dc, l_ac, l_scale = dct_encode(l_chan, w, h, 7, 7)
    a_dc, a_ac, a_scale = dct_encode(a_chan, w, h, 4, 4)
    b_dc, b_ac, b_scale = dct_encode(b_chan, w, h, 4, 4)
    if has_alpha:
        alpha_dc, alpha_ac, alpha_scale = dct_encode(alpha_pixels, w, h, 3, 3)
    else:
        alpha_dc, alpha_ac, alpha_scale = 0.0, [], 0.0

    # 6. Quantize header values
    l_dc_q = int(round_half_away_from_zero(127.0 * clamp01(l_dc)))
    a_dc_q = int(round_half_away_from_zero(64.0 + 63.0 * clamp_neg1_1(a_dc / MAX_CHROMA_A)))
    b_dc_q = int(round_half_away_from_zero(64.0 + 63.0 * clamp_neg1_1(b_dc / MAX_CHROMA_B)))
    l_scl_q = int(round_half_away_from_zero(63.0 * clamp01(l_scale / MAX_L_SCALE)))
    a_scl_q = int(round_half_away_from_zero(63.0 * clamp01(a_scale / MAX_A_SCALE)))
    b_scl_q = int(round_half_away_from_zero(31.0 * clamp01(b_scale / MAX_B_SCALE)))

    # 7. Compute aspect byte
    aspect = encode_aspect(w, h)

    # 8. Pack header (48 bits = 6 bytes)
    header = (
        l_dc_q
        | (a_dc_q << 7)
        | (b_dc_q << 14)
        | (l_scl_q << 21)
        | (a_scl_q << 27)
        | (b_scl_q << 33)
        | (aspect << 38)
        | ((1 if has_alpha else 0) << 46)
    )
    # bit 47 reserved = 0

    buf = bytearray(32)
    for i in range(6):
        buf[i] = (header >> (i * 8)) & 0xFF

    # 9. Pack AC coefficients with µ-law companding
    bitpos = 48

    def quantize_ac(value: float, scale: float, bits: int) -> int:
        if scale == 0.0:
            return mu_law_quantize(0.0, bits)
        return mu_law_quantize(value / scale, bits)

    if has_alpha:
        alpha_dc_q = int(round_half_away_from_zero(31.0 * clamp01(alpha_dc)))
        alpha_scl_q = int(
            round_half_away_from_zero(15.0 * clamp01(alpha_scale / MAX_A_ALPHA_SCALE))
        )
        write_bits(buf, bitpos, 5, alpha_dc_q)
        bitpos += 5
        write_bits(buf, bitpos, 4, alpha_scl_q)
        bitpos += 4

        # L AC: first 7 at 6 bits, remaining 13 at 5 bits
        for ac_val in l_ac[:7]:
            q = quantize_ac(ac_val, l_scale, 6)
            write_bits(buf, bitpos, 6, q)
            bitpos += 6
        for ac_val in l_ac[7:20]:
            q = quantize_ac(ac_val, l_scale, 5)
            write_bits(buf, bitpos, 5, q)
            bitpos += 5
    else:
        # L AC: all 27 at 5 bits
        for ac_val in l_ac[:27]:
            q = quantize_ac(ac_val, l_scale, 5)
            write_bits(buf, bitpos, 5, q)
            bitpos += 5

    # a AC: 9 at 4 bits
    for ac_val in a_ac:
        q = quantize_ac(ac_val, a_scale, 4)
        write_bits(buf, bitpos, 4, q)
        bitpos += 4

    # b AC: 9 at 4 bits
    for ac_val in b_ac:
        q = quantize_ac(ac_val, b_scale, 4)
        write_bits(buf, bitpos, 4, q)
        bitpos += 4

    if has_alpha:
        # Alpha AC: 5 at 4 bits
        for ac_val in alpha_ac:
            q = quantize_ac(ac_val, alpha_scale, 4)
            write_bits(buf, bitpos, 4, q)
            bitpos += 4

    assert bitpos <= 256

    return bytes(buf)
