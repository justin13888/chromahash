namespace ChromaHash;

using static Constants;
using static MathUtils;

internal static class Decoder
{
    /// <summary>Decode a ChromaHash into RGBA pixel data. Per spec §11. Returns (width, height, rgba_pixels).</summary>
    public static (uint W, uint H, byte[] Rgba) Decode(byte[] hash)
    {
        // 1. Unpack header (48 bits)
        ulong header = 0;
        for (int i = 0; i < 6; i++)
            header |= ((ulong)hash[i]) << (i * 8);

        uint lDcQ = (uint)(header & 0x7F);
        uint aDcQ = (uint)((header >> 7) & 0x7F);
        uint bDcQ = (uint)((header >> 14) & 0x7F);
        uint lSclQ = (uint)((header >> 21) & 0x3F);
        uint aSclQ = (uint)((header >> 27) & 0x3F);
        uint bSclQ = (uint)((header >> 33) & 0x1F);
        byte aspect = (byte)((header >> 38) & 0xFF);
        bool hasAlpha = ((header >> 46) & 1) == 1;

        // 2. Decode DC values and scale factors
        double lDc = lDcQ / 127.0;
        double aDc = (aDcQ - 64.0) / 63.0 * MaxChromaA;
        double bDc = (bDcQ - 64.0) / 63.0 * MaxChromaB;
        double lScale = lSclQ / 63.0 * MaxLScale;
        double aScale = aSclQ / 63.0 * MaxAScale;
        double bScale = bSclQ / 31.0 * MaxBScale;

        // 3-4. Decode aspect ratio and compute output size
        (uint w, uint h) = Aspect.DecodeOutputSize(aspect);

        // 5. Dequantize AC coefficients
        int bitpos = 48;

        double alphaDcVal = 1.0;
        double alphaScaleVal = 0.0;

        if (hasAlpha)
        {
            alphaDcVal = BitPack.ReadBits(hash, bitpos, 5) / 31.0;
            bitpos += 5;
            alphaScaleVal = BitPack.ReadBits(hash, bitpos, 4) / 15.0 * MaxAlphaScale;
            bitpos += 4;
        }

        List<double> lAc;
        int lx,
            ly;

        if (hasAlpha)
        {
            lAc = new List<double>(20);
            for (int i = 0; i < 7; i++)
            {
                uint q = BitPack.ReadBits(hash, bitpos, 6);
                bitpos += 6;
                lAc.Add(MuLaw.MuLawDequantize(q, 6) * lScale);
            }
            for (int i = 7; i < 20; i++)
            {
                uint q = BitPack.ReadBits(hash, bitpos, 5);
                bitpos += 5;
                lAc.Add(MuLaw.MuLawDequantize(q, 5) * lScale);
            }
            lx = 6;
            ly = 6;
        }
        else
        {
            lAc = new List<double>(27);
            for (int i = 0; i < 27; i++)
            {
                uint q = BitPack.ReadBits(hash, bitpos, 5);
                bitpos += 5;
                lAc.Add(MuLaw.MuLawDequantize(q, 5) * lScale);
            }
            lx = 7;
            ly = 7;
        }

        var aAc = new List<double>(9);
        for (int i = 0; i < 9; i++)
        {
            uint q = BitPack.ReadBits(hash, bitpos, 4);
            bitpos += 4;
            aAc.Add(MuLaw.MuLawDequantize(q, 4) * aScale);
        }

        var bAc = new List<double>(9);
        for (int i = 0; i < 9; i++)
        {
            uint q = BitPack.ReadBits(hash, bitpos, 4);
            bitpos += 4;
            bAc.Add(MuLaw.MuLawDequantize(q, 4) * bScale);
        }

        List<double> alphaAc = [];
        if (hasAlpha)
        {
            alphaAc = new List<double>(5);
            for (int i = 0; i < 5; i++)
            {
                uint q = BitPack.ReadBits(hash, bitpos, 4);
                bitpos += 4;
                alphaAc.Add(MuLaw.MuLawDequantize(q, 4) * alphaScaleVal);
            }
        }

        // Precompute scan orders
        var lScan = Dct.TriangularScanOrder(lx, ly);
        var chromaScan = Dct.TriangularScanOrder(4, 4);
        var alphaScan = hasAlpha ? Dct.TriangularScanOrder(3, 3) : [];

        // 6. Render output image
        int iw = (int)w;
        int ih = (int)h;
        byte[] rgba = new byte[iw * ih * 4];

        for (int y = 0; y < ih; y++)
        {
            for (int x = 0; x < iw; x++)
            {
                double l = Dct.DctDecodePixel(lDc, lAc, lScan, x, y, iw, ih);
                double a = Dct.DctDecodePixel(aDc, aAc, chromaScan, x, y, iw, ih);
                double b = Dct.DctDecodePixel(bDc, bAc, chromaScan, x, y, iw, ih);
                double alpha = hasAlpha
                    ? Dct.DctDecodePixel(alphaDcVal, alphaAc, alphaScan, x, y, iw, ih)
                    : 1.0;

                double[] srgb = Color.OklabToSrgb([l, a, b]);
                int idx = (y * iw + x) * 4;
                rgba[idx] = (byte)RoundHalfAwayFromZero(255.0 * Clamp01(srgb[0]));
                rgba[idx + 1] = (byte)RoundHalfAwayFromZero(255.0 * Clamp01(srgb[1]));
                rgba[idx + 2] = (byte)RoundHalfAwayFromZero(255.0 * Clamp01(srgb[2]));
                rgba[idx + 3] = (byte)RoundHalfAwayFromZero(255.0 * Clamp01(alpha));
            }
        }

        return (w, h, rgba);
    }

    /// <summary>Extract the average color from a ChromaHash without full decode. Per spec §11.2.</summary>
    public static byte[] AverageColor(byte[] hash)
    {
        ulong header = 0;
        for (int i = 0; i < 6; i++)
            header |= ((ulong)hash[i]) << (i * 8);

        uint lDcQ = (uint)(header & 0x7F);
        uint aDcQ = (uint)((header >> 7) & 0x7F);
        uint bDcQ = (uint)((header >> 14) & 0x7F);
        bool hasAlpha = ((header >> 46) & 1) == 1;

        double lDc = lDcQ / 127.0;
        double aDc = (aDcQ - 64.0) / 63.0 * MaxChromaA;
        double bDc = (bDcQ - 64.0) / 63.0 * MaxChromaB;

        double[] srgb = Color.OklabToSrgb([lDc, aDc, bDc]);

        double alpha = hasAlpha ? BitPack.ReadBits(hash, 48, 5) / 31.0 : 1.0;

        return
        [
            (byte)RoundHalfAwayFromZero(255.0 * Clamp01(srgb[0])),
            (byte)RoundHalfAwayFromZero(255.0 * Clamp01(srgb[1])),
            (byte)RoundHalfAwayFromZero(255.0 * Clamp01(srgb[2])),
            (byte)RoundHalfAwayFromZero(255.0 * Clamp01(alpha)),
        ];
    }
}
