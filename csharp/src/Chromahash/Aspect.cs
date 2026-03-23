namespace ChromaHash;

using static MathUtils;

internal static class Aspect
{
    /// <summary>Encode aspect ratio as a single byte. Per spec §8.1 (v0.3).</summary>
    public static byte EncodeAspect(uint w, uint h)
    {
        double ratio = (double)w / h;
        double raw = (Math.Log2(ratio) + 4.0) / 8.0 * 255.0;
        long b = (long)RoundHalfAwayFromZero(raw);
        return (byte)Math.Clamp(b, 0L, 255L);
    }

    /// <summary>Decode aspect ratio from byte. Per spec §8.1 (v0.3).</summary>
    public static double DecodeAspect(byte b)
    {
        return Math.Pow(2.0, (double)b / 255.0 * 8.0 - 4.0);
    }

    /// <summary>Decode output size from aspect byte. Longer side = 32px. Per spec §8.4.</summary>
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

    /// <summary>Derive adaptive DCT grid (nx, ny) from aspect byte and base_n. Per spec §3.2.</summary>
    public static (int Nx, int Ny) DeriveGrid(byte aspectByte, int baseN)
    {
        double ratio = PortablePow(2.0, (double)aspectByte / 255.0 * 8.0 - 4.0);
        double baseD = (double)baseN;
        int nx, ny;
        if (ratio >= 1.0)
        {
            double scale = Math.Min(ratio, 16.0);
            double s = PortablePow(scale, 0.25);
            nx = (int)RoundHalfAwayFromZero(baseD * s);
            ny = (int)RoundHalfAwayFromZero(baseD / s);
        }
        else
        {
            double scale = Math.Min(1.0 / ratio, 16.0);
            double s = PortablePow(scale, 0.25);
            nx = (int)RoundHalfAwayFromZero(baseD / s);
            ny = (int)RoundHalfAwayFromZero(baseD * s);
        }
        return (Math.Max(nx, 3), Math.Max(ny, 3));
    }
}
