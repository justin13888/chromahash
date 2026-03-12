namespace ChromaHash;

using static Constants;
using static MathUtils;

internal static class Encoder
{
    /// <summary>Encode an image into a 32-byte ChromaHash. Per spec §10.</summary>
    public static byte[] Encode(uint w, uint h, byte[] rgba, Gamut gamut)
    {
        if (w < 1 || w > 100)
            throw new ArgumentOutOfRangeException(nameof(w), "width must be 1–100");
        if (h < 1 || h > 100)
            throw new ArgumentOutOfRangeException(nameof(h), "height must be 1–100");
        if (rgba.Length != (int)w * (int)h * 4)
            throw new ArgumentException("rgba length mismatch", nameof(rgba));

        int iw = (int)w;
        int ih = (int)h;
        int pixelCount = iw * ih;

        // 1-2. Convert all pixels to OKLAB, accumulate alpha-weighted average
        double[][] oklabPixels = new double[pixelCount][];
        double[] alphaPixels = new double[pixelCount];
        double avgL = 0.0,
            avgA = 0.0,
            avgB = 0.0,
            avgAlpha = 0.0;

        for (int i = 0; i < pixelCount; i++)
        {
            double r = rgba[i * 4] / 255.0;
            double g = rgba[i * 4 + 1] / 255.0;
            double b = rgba[i * 4 + 2] / 255.0;
            double a = rgba[i * 4 + 3] / 255.0;

            double[] lab = Color.GammaRgbToOklab(r, g, b, gamut);

            avgL += a * lab[0];
            avgA += a * lab[1];
            avgB += a * lab[2];
            avgAlpha += a;

            oklabPixels[i] = lab;
            alphaPixels[i] = a;
        }

        // 3. Compute alpha-weighted average color
        if (avgAlpha > 0.0)
        {
            avgL /= avgAlpha;
            avgA /= avgAlpha;
            avgB /= avgAlpha;
        }

        // 4. Composite transparent pixels over average
        bool hasAlpha = avgAlpha < pixelCount;
        double[] lChan = new double[pixelCount];
        double[] aChan = new double[pixelCount];
        double[] bChan = new double[pixelCount];

        for (int i = 0; i < pixelCount; i++)
        {
            double alpha = alphaPixels[i];
            lChan[i] = avgL * (1.0 - alpha) + alpha * oklabPixels[i][0];
            aChan[i] = avgA * (1.0 - alpha) + alpha * oklabPixels[i][1];
            bChan[i] = avgB * (1.0 - alpha) + alpha * oklabPixels[i][2];
        }

        // 5. DCT encode each channel
        (double lDc, List<double> lAc, double lScale) = hasAlpha
            ? Dct.DctEncode(lChan, iw, ih, 6, 6)
            : Dct.DctEncode(lChan, iw, ih, 7, 7);
        (double aDc, List<double> aAc, double aScale) = Dct.DctEncode(aChan, iw, ih, 4, 4);
        (double bDc, List<double> bAc, double bScale) = Dct.DctEncode(bChan, iw, ih, 4, 4);

        double alphaDc = 0.0,
            alphaScale = 0.0;
        List<double> alphaAc = [];

        if (hasAlpha)
            (alphaDc, alphaAc, alphaScale) = Dct.DctEncode(alphaPixels, iw, ih, 3, 3);

        // 6. Quantize header values
        ulong lDcQ = (ulong)RoundHalfAwayFromZero(127.0 * Clamp01(lDc));
        ulong aDcQ = (ulong)RoundHalfAwayFromZero(64.0 + 63.0 * ClampNeg1To1(aDc / MaxChromaA));
        ulong bDcQ = (ulong)RoundHalfAwayFromZero(64.0 + 63.0 * ClampNeg1To1(bDc / MaxChromaB));
        ulong lSclQ = (ulong)RoundHalfAwayFromZero(63.0 * Clamp01(lScale / MaxLScale));
        ulong aSclQ = (ulong)RoundHalfAwayFromZero(63.0 * Clamp01(aScale / MaxAScale));
        ulong bSclQ = (ulong)RoundHalfAwayFromZero(31.0 * Clamp01(bScale / MaxBScale));

        // 7. Compute aspect byte
        ulong aspectByte = Aspect.EncodeAspect(w, h);

        // 8. Pack header (48 bits = 6 bytes)
        ulong header =
            lDcQ
            | (aDcQ << 7)
            | (bDcQ << 14)
            | (lSclQ << 21)
            | (aSclQ << 27)
            | (bSclQ << 33)
            | (aspectByte << 38)
            | ((hasAlpha ? 1ul : 0ul) << 46);
        // bit 47 reserved = 0

        byte[] hash = new byte[32];
        for (int i = 0; i < 6; i++)
            hash[i] = (byte)((header >> (i * 8)) & 0xFF);

        // 9. Pack AC coefficients with µ-law companding
        int bitpos = 48;

        uint QuantizeAc(double value, double scale, int bits)
        {
            if (scale == 0.0)
                return MuLaw.MuLawQuantize(0.0, bits);
            else
                return MuLaw.MuLawQuantize(value / scale, bits);
        }

        if (hasAlpha)
        {
            uint alphaDcQ = (uint)RoundHalfAwayFromZero(31.0 * Clamp01(alphaDc));
            uint alphaSclQ = (uint)RoundHalfAwayFromZero(15.0 * Clamp01(alphaScale / MaxAlphaScale));
            BitPack.WriteBits(hash, bitpos, 5, alphaDcQ);
            bitpos += 5;
            BitPack.WriteBits(hash, bitpos, 4, alphaSclQ);
            bitpos += 4;

            // L AC: first 7 at 6 bits, remaining 13 at 5 bits
            for (int i = 0; i < 7; i++)
            {
                uint q = QuantizeAc(lAc[i], lScale, 6);
                BitPack.WriteBits(hash, bitpos, 6, q);
                bitpos += 6;
            }
            for (int i = 7; i < 20; i++)
            {
                uint q = QuantizeAc(lAc[i], lScale, 5);
                BitPack.WriteBits(hash, bitpos, 5, q);
                bitpos += 5;
            }
        }
        else
        {
            // L AC: all 27 at 5 bits
            for (int i = 0; i < 27; i++)
            {
                uint q = QuantizeAc(lAc[i], lScale, 5);
                BitPack.WriteBits(hash, bitpos, 5, q);
                bitpos += 5;
            }
        }

        // a AC: 9 at 4 bits
        foreach (double acVal in aAc)
        {
            uint q = QuantizeAc(acVal, aScale, 4);
            BitPack.WriteBits(hash, bitpos, 4, q);
            bitpos += 4;
        }

        // b AC: 9 at 4 bits
        foreach (double acVal in bAc)
        {
            uint q = QuantizeAc(acVal, bScale, 4);
            BitPack.WriteBits(hash, bitpos, 4, q);
            bitpos += 4;
        }

        if (hasAlpha)
        {
            // Alpha AC: 5 at 4 bits
            foreach (double acVal in alphaAc)
            {
                uint q = QuantizeAc(acVal, alphaScale, 4);
                BitPack.WriteBits(hash, bitpos, 4, q);
                bitpos += 4;
            }
        }

        // Padding bit (no-alpha mode): already 0 since hash is initialized to 0
        System.Diagnostics.Debug.Assert(bitpos <= 256);

        return hash;
    }
}
