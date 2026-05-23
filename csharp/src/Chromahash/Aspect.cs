namespace ChromaHash;

using static MathUtils;

internal static class Aspect
{
    /// <summary>Encode aspect ratio as a single byte. Per spec §8.1.</summary>
    public static byte EncodeAspect(uint w, uint h)
    {
        double ratio = (double)w / h;
        double raw = (Math.Log2(ratio) + 4.0) / 8.0 * 255.0;
        long b = (long)RoundHalfAwayFromZero(raw);
        return (byte)Math.Clamp(b, 0L, 255L);
    }

    /// <summary>Decode aspect ratio from byte. Per spec §8.1.</summary>
    public static double DecodeAspect(byte b)
    {
        return Math.Pow(2.0, (double)b / 255.0 * 8.0 - 4.0);
    }

    /// <summary>Decode output size from aspect byte. Longer side = 32px. Per spec §8.2.</summary>
    public static (uint W, uint H) DecodeOutputSize(byte b)
    {
        double ratio = DecodeAspect(b);
        if (ratio > 1.0)
        {
            double hd = RoundHalfAwayFromZero(32.0 / ratio);
            uint h = (uint)Math.Max(hd, 1.0);
            return (32u, h);
        }
        else
        {
            double wd = RoundHalfAwayFromZero(32.0 * ratio);
            uint w = (uint)Math.Max(wd, 1.0);
            return (w, 32u);
        }
    }

    /// <summary>Derive adaptive DCT grid (nx, ny) from aspect byte and base_n. Per spec §6.3 (v0.4).
    /// Uses sqrt(scale) with nx_cap = 2*base_n and product preservation
    /// (ny = round(base_n^2 / nx)). sqrt is IEEE 754 correctly-rounded.</summary>
    public static (int Nx, int Ny) DeriveGrid(byte aspectByte, int baseN)
    {
        double ratio = PortablePow(2.0, (double)aspectByte / 255.0 * 8.0 - 4.0);
        double baseD = (double)baseN;
        long nxCap = 2L * baseN;
        long nx, ny;
        if (ratio >= 1.0)
        {
            double scale = Math.Min(ratio, 16.0);
            nx = Math.Min((long)RoundHalfAwayFromZero(baseD * Math.Sqrt(scale)), nxCap);
            ny = (long)RoundHalfAwayFromZero(baseD * baseD / nx);
        }
        else
        {
            double scale = Math.Min(1.0 / ratio, 16.0);
            ny = Math.Min((long)RoundHalfAwayFromZero(baseD * Math.Sqrt(scale)), nxCap);
            nx = (long)RoundHalfAwayFromZero(baseD * baseD / ny);
        }
        return (Math.Max((int)nx, 3), Math.Max((int)ny, 3));
    }
}
