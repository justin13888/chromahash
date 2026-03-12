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

    /// <summary>Signed cube root per spec §2.4: cbrt(x) = sign(x) × |x|^(1/3).</summary>
    public static double CbrtSigned(double x)
    {
        if (x == 0.0)
            return 0.0;
        return Math.Sign(x) * Math.Cbrt(Math.Abs(x));
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
}
