import math


def round_half_away_from_zero(x: float) -> float:
    """Round half away from zero. Per spec §2.2."""
    if x >= 0.0:
        return math.floor(x + 0.5)
    return math.ceil(x - 0.5)


def portable_ln(x: float) -> float:
    """Portable natural logarithm using only basic IEEE 754 arithmetic.

    Range-reduces to [1, 2) then uses the series ln(m) = 2*sum(u^(2k+1)/(2k+1))
    where u = (m-1)/(m+1).
    """
    _LN2 = 0.6931471805599453

    if x <= 0.0:
        return float("-inf")
    if x == 1.0:
        return 0.0

    # Range reduce to m in [1, 2)
    m = x
    e = 0
    while m >= 2.0:
        m /= 2.0
        e += 1
    while m < 1.0:
        m *= 2.0
        e -= 1

    # Series: ln(m) = 2*(u + u^3/3 + u^5/5 + ...) where u = (m-1)/(m+1)
    u = (m - 1.0) / (m + 1.0)
    u2 = u * u
    term = u
    total = u
    for k in range(1, 21):
        term *= u2
        total += term / (2 * k + 1)

    return 2.0 * total + e * _LN2


def portable_exp(x: float) -> float:
    """Portable exponential using only basic IEEE 754 arithmetic.

    Range-reduces via exp(x) = 2^k * exp(r) where r in [-ln2/2, ln2/2],
    then uses a degree-25 Taylor polynomial for exp(r).
    """
    _LN2 = 0.6931471805599453

    if x == 0.0:
        return 1.0

    # Range reduction: k = round(x / ln2), r = x - k*ln2
    k = int(math.floor(x / _LN2 + 0.5))
    r = x - k * _LN2

    # Taylor polynomial for exp(r), |r| < 0.347
    term = 1.0
    total = 1.0
    for i in range(1, 26):
        term *= r / i
        total += term

    # Multiply by 2^k
    result = total
    if k >= 0:
        for _ in range(k):
            result *= 2.0
    else:
        for _ in range(-k):
            result /= 2.0

    return result


def portable_pow(base: float, exponent: float) -> float:
    """Portable power function: base^exponent using only basic IEEE 754 arithmetic.

    Computes exp(exponent * ln(base)).
    """
    if base == 0.0:
        return 0.0
    if exponent == 0.0:
        return 1.0
    if base == 1.0:
        return 1.0
    return portable_exp(exponent * portable_ln(base))


def cbrt_halley(x: float) -> float:
    """Cube root via Halley's method with biased-exponent seed.

    Matches Rust cbrt_halley for cross-language bit-exact determinism.
    """
    import struct

    if x == 0.0:
        return 0.0
    sign = x < 0.0
    ax = -x if sign else x

    # Seed via signed int64 biased-exponent division
    (bits,) = struct.unpack("<q", struct.pack("<d", ax))
    bias = 1023 << 52
    seed = (bits - bias) // 3 + bias
    y = struct.unpack("<d", struct.pack("<q", seed))[0]

    # 3 Halley iterations
    for _ in range(3):
        t1 = y * y
        y3 = t1 * y
        t2 = 2.0 * ax
        num = y3 + t2
        t3 = 2.0 * y3
        den = t3 + ax
        t4 = y * num
        y = t4 / den

    return -y if sign else y


def portable_cos(x: float) -> float:
    """Portable cosine using only basic IEEE 754 arithmetic.
    Produces bit-identical results across all platforms.
    """
    _PI = 3.141592653589793
    _TWO_PI = 6.283185307179586
    _HALF_PI = 1.5707963267948966

    if x < 0.0:
        x = -x

    if x >= _TWO_PI:
        x -= math.floor(x / _TWO_PI) * _TWO_PI

    if x > _PI:
        x = _TWO_PI - x

    negate = x > _HALF_PI
    if negate:
        x = _PI - x

    x2 = x * x
    r = 1.0 + x2 * (
        -1.0 / 2.0
        + x2
        * (
            1.0 / 24.0
            + x2
            * (
                -1.0 / 720.0
                + x2
                * (
                    1.0 / 40320.0
                    + x2
                    * (
                        -1.0 / 3628800.0
                        + x2
                        * (
                            1.0 / 479001600.0
                            + x2 * (-1.0 / 87178291200.0 + x2 * (1.0 / 20922789888000.0))
                        )
                    )
                )
            )
        )
    )

    return -r if negate else r


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
