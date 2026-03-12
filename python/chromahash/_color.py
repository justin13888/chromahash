"""Color space conversion utilities."""

from . import _transfer as transfer
from ._constants import M1_INV_SRGB, M1_MATRICES, M2, M2_INV, Gamut
from ._math_utils import cbrt_signed, clamp01, matvec3


def linear_rgb_to_oklab(rgb: list[float], gamut: Gamut) -> list[float]:
    """Convert linear RGB to OKLAB using the specified source gamut's M1 matrix."""
    m1 = M1_MATRICES[gamut]
    lms = matvec3(m1, rgb)
    lms_cbrt = [cbrt_signed(lms[0]), cbrt_signed(lms[1]), cbrt_signed(lms[2])]
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
