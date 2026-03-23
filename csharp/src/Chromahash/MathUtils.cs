namespace ChromaHash;

internal static class MathUtils
{
    /// <summary>Round half away from zero (NOT .NET's default banker's rounding). Per spec §2.2.</summary>
    public static double RoundHalfAwayFromZero(double x)
    {
        if (x >= 0.0)
            return Math.Floor(x + 0.5);
        else
            return Math.Ceiling(x - 0.5);
    }

    /// <summary>Cube root via Halley's method with biased-exponent seed.
    /// Matches Rust cbrt_halley for cross-language bit-exact determinism.</summary>
    public static double CbrtHalley(double x)
    {
        if (x == 0.0) return 0.0;
        bool sign = x < 0.0;
        double ax = sign ? -x : x;

        // Seed via signed int64 biased-exponent division
        long signedBits = BitConverter.DoubleToInt64Bits(ax);
        const long bias = 1023L << 52;
        long seedBits = (signedBits - bias) / 3L + bias;
        double y = BitConverter.Int64BitsToDouble(seedBits);

        // 3 Halley iterations
        for (int k = 0; k < 3; k++)
        {
            double t1 = y * y;
            double y3 = t1 * y;
            double t2 = 2.0 * ax;
            double num = y3 + t2;
            double t3 = 2.0 * y3;
            double den = t3 + ax;
            double t4 = y * num;
            y = t4 / den;
        }

        return sign ? -y : y;
    }

    /// <summary>Clamp to [0, 1].</summary>
    public static double Clamp01(double x) => Math.Clamp(x, 0.0, 1.0);

    /// <summary>Clamp to [-1, 1].</summary>
    public static double ClampNeg1To1(double x) => Math.Clamp(x, -1.0, 1.0);

    /// <summary>3×3 matrix × 3-vector multiplication.</summary>
    public static double[] Matvec3(double[,] m, double[] v) =>
        [
            m[0, 0] * v[0] + m[0, 1] * v[1] + m[0, 2] * v[2],
            m[1, 0] * v[0] + m[1, 1] * v[1] + m[1, 2] * v[2],
            m[2, 0] * v[0] + m[2, 1] * v[1] + m[2, 2] * v[2],
        ];

    /// <summary>
    /// Portable natural logarithm using only basic IEEE 754 arithmetic.
    /// Range-reduces to [1, 2) then uses the series ln(m) = 2·Σ u^(2k+1)/(2k+1)
    /// where u = (m-1)/(m+1).
    /// </summary>
    internal static double PortableLn(double x)
    {
        const double LN2 = 0.6931471805599453;

        if (x <= 0.0)
            return double.NegativeInfinity;
        if (x == 1.0)
            return 0.0;

        // Range reduce to m ∈ [1, 2)
        double m = x;
        int e = 0;
        while (m >= 2.0)
        {
            m /= 2.0;
            e += 1;
        }
        while (m < 1.0)
        {
            m *= 2.0;
            e -= 1;
        }

        // Series: ln(m) = 2·(u + u³/3 + u⁵/5 + ...) where u = (m-1)/(m+1)
        double u = (m - 1.0) / (m + 1.0);
        double u2 = u * u;
        double term = u;
        double sum = u;
        for (int k = 1; k <= 20; k++)
        {
            term *= u2;
            sum += term / (2 * k + 1);
        }

        return 2.0 * sum + e * LN2;
    }

    /// <summary>
    /// Portable exponential using only basic IEEE 754 arithmetic.
    /// Range-reduces via exp(x) = 2^k · exp(r) where r ∈ [-ln2/2, ln2/2],
    /// then uses a degree-25 Taylor polynomial for exp(r).
    /// </summary>
    internal static double PortableExp(double x)
    {
        const double LN2 = 0.6931471805599453;

        if (x == 0.0)
            return 1.0;

        // Range reduction: k = round(x / ln2), r = x - k·ln2
        int k = (int)Math.Floor(x / LN2 + 0.5);
        double r = x - k * LN2;

        // Taylor polynomial for exp(r), |r| < 0.347
        double term = 1.0;
        double sum = 1.0;
        for (int i = 1; i <= 25; i++)
        {
            term *= r / i;
            sum += term;
        }

        // Multiply by 2^k
        double result = sum;
        if (k >= 0)
        {
            for (int j = 0; j < k; j++)
                result *= 2.0;
        }
        else
        {
            for (int j = 0; j < -k; j++)
                result /= 2.0;
        }

        return result;
    }

    /// <summary>
    /// Portable power function: base^exponent using only basic IEEE 754 arithmetic.
    /// Computes exp(exponent · ln(base)).
    /// </summary>
    internal static double PortablePow(double baseVal, double exponent)
    {
        if (baseVal == 0.0)
            return 0.0;
        if (exponent == 0.0)
            return 1.0;
        if (baseVal == 1.0)
            return 1.0;
        return PortableExp(exponent * PortableLn(baseVal));
    }

    /// <summary>
    /// Portable cosine using only basic IEEE 754 arithmetic.
    /// Produces bit-identical results across all platforms.
    /// </summary>
    internal static double PortableCos(double x)
    {
        const double Pi = 3.141592653589793;
        const double TwoPi = 6.283185307179586;
        const double HalfPi = 1.5707963267948966;

        if (x < 0.0) x = -x;

        if (x >= TwoPi)
        {
            x -= Math.Floor(x / TwoPi) * TwoPi;
        }

        if (x > Pi)
        {
            x = TwoPi - x;
        }

        bool negate = x > HalfPi;
        if (negate)
        {
            x = Pi - x;
        }

        double x2 = x * x;
        double r = 1.0 + x2 * (-1.0 / 2.0 + x2 * (1.0 / 24.0 + x2 * (-1.0 / 720.0 + x2 * (1.0 / 40320.0 + x2 * (-1.0 / 3628800.0 + x2 * (1.0 / 479001600.0 + x2 * (-1.0 / 87178291200.0 + x2 * (1.0 / 20922789888000.0))))))));

        return negate ? -r : r;
    }
}
