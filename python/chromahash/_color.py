"""Color space conversion utilities."""

from . import _transfer as transfer
from ._constants import M1_INV_SRGB, M1_MATRICES, M2, M2_INV, Gamut
from ._math_utils import cbrt_halley, clamp01, matvec3


def linear_rgb_to_oklab(rgb: list[float], gamut: Gamut) -> list[float]:
    """Convert linear RGB to OKLAB using the specified source gamut's M1 matrix."""
    m1 = M1_MATRICES[gamut]
    lms = matvec3(m1, rgb)
    lms_cbrt = [cbrt_halley(lms[0]), cbrt_halley(lms[1]), cbrt_halley(lms[2])]
    return matvec3(M2, lms_cbrt)


def oklab_to_linear_srgb(lab: list[float]) -> list[float]:
    """Convert OKLAB to linear sRGB."""
    lms_cbrt = matvec3(M2_INV, lab)
    lms = [lms_cbrt[0] ** 3, lms_cbrt[1] ** 3, lms_cbrt[2] ** 3]
    return matvec3(M1_INV_SRGB, lms)


def gamma_rgb_to_oklab(r: float, g: float, b: float, gamut: Gamut) -> list[float]:
    """Convert gamma-encoded source RGB to OKLAB."""
    if gamut in (Gamut.SRGB, Gamut.DISPLAY_P3):
        eotf = transfer.srgb_eotf
    elif gamut == Gamut.ADOBE_RGB:
        eotf = transfer.adobe_rgb_eotf
    elif gamut == Gamut.PROPHOTO_RGB:
        eotf = transfer.prophoto_rgb_eotf
    else:  # BT2020
        eotf = transfer.bt2020_pq_eotf
    return linear_rgb_to_oklab([eotf(r), eotf(g), eotf(b)], gamut)


def oklab_to_srgb(lab: list[float]) -> list[float]:
    """Convert OKLAB to gamma-encoded sRGB [0,1] with clamping."""
    rgb_linear = oklab_to_linear_srgb(lab)
    return [
        transfer.srgb_gamma(clamp01(rgb_linear[0])),
        transfer.srgb_gamma(clamp01(rgb_linear[1])),
        transfer.srgb_gamma(clamp01(rgb_linear[2])),
    ]


def in_gamut(rgb: list[float]) -> bool:
    """Check whether all RGB channels are in [0, 1]."""
    return all(0.0 <= c <= 1.0 for c in rgb)


def soft_gamut_clamp(l_val: float, a: float, b: float) -> list[float]:
    """Soft gamut clamp via OKLch bisection. Per spec §6.1.
    Preserves L and hue; reduces chroma until all sRGB channels fit [0, 1].
    Precondition: L must be in [0, 1].
    """
    import math

    rgb = oklab_to_linear_srgb([l_val, a, b])
    if in_gamut(rgb):
        return [l_val, a, b]
    c = math.sqrt(a * a + b * b)
    if c < 1e-10:
        return [l_val, 0.0, 0.0]
    h_cos = a / c
    h_sin = b / c
    lo = 0.0
    hi = c
    # Exactly 16 iterations — deterministic per spec §6.1
    for _ in range(16):
        mid = (lo + hi) / 2.0
        rgb_test = oklab_to_linear_srgb([l_val, mid * h_cos, mid * h_sin])
        if in_gamut(rgb_test):
            lo = mid
        else:
            hi = mid
    return [l_val, lo * h_cos, lo * h_sin]


def _build_gamma_lut() -> list[int]:
    """Build 4096-entry sRGB gamma LUT. Per spec §6.2."""
    from ._math_utils import round_half_away_from_zero

    lut = []
    for i in range(4096):
        x = i / 4095.0
        lut.append(int(round_half_away_from_zero(transfer.srgb_gamma(x) * 255.0)))
    return lut


GAMMA_LUT: list[int] = _build_gamma_lut()


def linear_to_srgb8(x: float) -> int:
    """Map a linear [0,1] value to sRGB u8 via the gamma LUT. Per spec §6.2."""
    from ._math_utils import round_half_away_from_zero

    idx = int(round_half_away_from_zero(x * 4095.0))
    if idx < 0:
        idx = 0
    if idx > 4095:
        idx = 4095
    return GAMMA_LUT[idx]
