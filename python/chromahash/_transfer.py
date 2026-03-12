"""Transfer functions (EOTF and OETF) for supported color gamuts."""


def srgb_eotf(x: float) -> float:
    """sRGB EOTF (gamma → linear), per spec §5.4."""
    if x <= 0.04045:
        return x / 12.92
    return ((x + 0.055) / 1.055) ** 2.4


def srgb_gamma(x: float) -> float:
    """sRGB gamma (linear → gamma), per spec §12.7."""
    if x <= 0.0031308:
        return 12.92 * x
    return 1.055 * x ** (1.0 / 2.4) - 0.055


def adobe_rgb_eotf(x: float) -> float:
    """Adobe RGB EOTF (gamma → linear): x^2.2."""
    return x**2.2


def prophoto_rgb_eotf(x: float) -> float:
    """ProPhoto RGB EOTF (gamma → linear): x^1.8."""
    return x**1.8


def bt2020_pq_eotf(x: float) -> float:
    """BT.2020 PQ (ST 2084) inverse EOTF → linear light, then Reinhard tone-map to SDR."""
    m1 = 0.1593017578125
    m2 = 78.84375
    c1 = 0.8359375
    c2 = 18.8515625
    c3 = 18.6875

    n = x ** (1.0 / m2)
    num = max(0.0, n - c1)
    den = c2 - c3 * n
    y_linear = (num / den) ** (1.0 / m1)

    # PQ output is in [0, 10000] cd/m²
    y_nits = y_linear * 10000.0

    # Simple Reinhard tone mapping: L / (1 + L), SDR reference white = 203 nits
    lum = y_nits / 203.0
    return lum / (1.0 + lum)
