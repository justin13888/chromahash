import math


def round_half_away_from_zero(x: float) -> float:
    """Round half away from zero. Per spec §2.2."""
    if x >= 0.0:
        return math.floor(x + 0.5)
    return math.ceil(x - 0.5)


def cbrt_signed(x: float) -> float:
    """Signed cube root per spec §2.4: cbrt(x) = sign(x) × |x|^(1/3)."""
    if x == 0.0:
        return 0.0
    return math.copysign(abs(x) ** (1.0 / 3.0), x)


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def clamp_neg1_1(x: float) -> float:
    return max(-1.0, min(1.0, x))


def matvec3(m: list[list[float]], v: list[float]) -> list[float]:
    """3×3 matrix × 3-vector multiplication."""
    return [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
