namespace ChromaHash;

using static Constants;
using static MathUtils;

internal static class MuLaw
{
    /// <summary>µ-law compress: value in [-1, 1] → compressed in [-1, 1].</summary>
    public static double MuCompress(double value)
    {
        double v = Math.Clamp(value, -1.0, 1.0);
        return Math.Sign(v) * Math.Log(1.0 + Mu * Math.Abs(v)) / Math.Log(1.0 + Mu);
    }

    /// <summary>µ-law expand: compressed in [-1, 1] → value in [-1, 1].</summary>
    public static double MuExpand(double compressed)
    {
        return Math.Sign(compressed) * (Math.Pow(1.0 + Mu, Math.Abs(compressed)) - 1.0) / Mu;
    }

    /// <summary>Quantize a value in [-1, 1] using µ-law to an integer index. Per spec §12.7 muLawQuantize.</summary>
    public static uint MuLawQuantize(double value, int bits)
    {
        double compressed = MuCompress(value);
        uint maxVal = (1u << bits) - 1;
        double index = RoundHalfAwayFromZero((compressed + 1.0) / 2.0 * maxVal);
        return (uint)Math.Clamp((long)index, 0L, (long)maxVal);
    }

    /// <summary>Dequantize an integer index back to a value in [-1, 1] using µ-law. Per spec §12.7 muLawDequantize.</summary>
    public static double MuLawDequantize(uint index, int bits)
    {
        uint maxVal = (1u << bits) - 1;
        double compressed = (double)index / maxVal * 2.0 - 1.0;
        return MuExpand(compressed);
    }
}
