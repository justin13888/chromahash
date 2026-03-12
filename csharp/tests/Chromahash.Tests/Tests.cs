using System.Text.Json;
using ChromaHash;
using CH = ChromaHash.ChromaHash;

// ── Helpers ───────────────────────────────────────────────────────────────────

static class Helpers
{
    public static readonly string SpecVectors = Path.Combine(
        AppContext.BaseDirectory,
        "..",
        "..",
        "..",
        "..",
        "..",
        "..",
        "spec",
        "test-vectors"
    );

    public static byte[] SolidImage(int w, int h, byte r, byte g, byte b, byte a)
    {
        byte[] rgba = new byte[w * h * 4];
        for (int i = 0; i < w * h; i++)
        {
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = g;
            rgba[i * 4 + 2] = b;
            rgba[i * 4 + 3] = a;
        }
        return rgba;
    }

    public static byte[] HorizontalGradient(int w, int h)
    {
        byte[] rgba = new byte[w * h * 4];
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                double t = (double)x / Math.Max(w - 1, 1);
                int idx = (y * w + x) * 4;
                rgba[idx] = (byte)(t * 255);
                rgba[idx + 1] = (byte)((1.0 - t) * 255);
                rgba[idx + 2] = 128;
                rgba[idx + 3] = 255;
            }
        }
        return rgba;
    }

    public static byte[] VerticalGradient(int w, int h)
    {
        byte[] rgba = new byte[w * h * 4];
        for (int y = 0; y < h; y++)
        {
            double t = (double)y / Math.Max(h - 1, 1);
            for (int x = 0; x < w; x++)
            {
                int idx = (y * w + x) * 4;
                rgba[idx] = (byte)(t * 255);
                rgba[idx + 1] = (byte)(t * 128);
                rgba[idx + 2] = (byte)((1.0 - t) * 255);
                rgba[idx + 3] = 255;
            }
        }
        return rgba;
    }

    public static Gamut GamutFromString(string s) =>
        s switch
        {
            "Display P3" => Gamut.DisplayP3,
            "Adobe RGB" => Gamut.AdobeRgb,
            "BT.2020" => Gamut.Bt2020,
            "ProPhoto RGB" => Gamut.ProPhotoRgb,
            _ => Gamut.Srgb,
        };
}

// ── MathUtils ─────────────────────────────────────────────────────────────────

// Access internal via InternalsVisibleTo or test via public API.
// We test math utils indirectly through encoding/decoding, and directly
// by accessing the internal static class via the same assembly in tests.

// Since internal access requires InternalsVisibleTo, we test via integration.
// We add the InternalsVisibleTo attribute in the library's AssemblyInfo.

public class MathUtilsTests
{
    [Theory]
    [InlineData(0.5, 1.0)]
    [InlineData(1.5, 2.0)]
    [InlineData(2.5, 3.0)]
    public void RoundHalfAwayFromZeroPositive(double input, double expected)
    {
        Assert.Equal(expected, MathUtilsAccessor.Round(input));
    }

    [Theory]
    [InlineData(-0.5, -1.0)]
    [InlineData(-1.5, -2.0)]
    [InlineData(-2.5, -3.0)]
    public void RoundHalfAwayFromZeroNegative(double input, double expected)
    {
        Assert.Equal(expected, MathUtilsAccessor.Round(input));
    }

    [Theory]
    [InlineData(0.0, 0.0)]
    [InlineData(0.3, 0.0)]
    [InlineData(0.7, 1.0)]
    [InlineData(-0.3, 0.0)]
    [InlineData(-0.7, -1.0)]
    public void RoundStandardCases(double input, double expected)
    {
        Assert.Equal(expected, MathUtilsAccessor.Round(input));
    }

    [Fact]
    public void CbrtPositive()
    {
        Assert.True(Math.Abs(MathUtilsAccessor.Cbrt(8.0) - 2.0) < 1e-12);
        Assert.True(Math.Abs(MathUtilsAccessor.Cbrt(27.0) - 3.0) < 1e-12);
        Assert.True(Math.Abs(MathUtilsAccessor.Cbrt(1.0) - 1.0) < 1e-12);
    }

    [Fact]
    public void CbrtNegative()
    {
        Assert.True(Math.Abs(MathUtilsAccessor.Cbrt(-8.0) - (-2.0)) < 1e-12);
        Assert.True(Math.Abs(MathUtilsAccessor.Cbrt(-27.0) - (-3.0)) < 1e-12);
    }

    [Fact]
    public void CbrtZero()
    {
        Assert.Equal(0.0, MathUtilsAccessor.Cbrt(0.0));
    }

    [Fact]
    public void Clamp01Works()
    {
        Assert.Equal(0.0, MathUtilsAccessor.Clamp01(-0.5));
        Assert.Equal(0.5, MathUtilsAccessor.Clamp01(0.5));
        Assert.Equal(1.0, MathUtilsAccessor.Clamp01(1.5));
    }
}

// ── Transfer ──────────────────────────────────────────────────────────────────

public class TransferTests
{
    [Theory]
    [InlineData(0.0)]
    [InlineData(0.01)]
    [InlineData(0.04045)]
    [InlineData(0.1)]
    [InlineData(0.5)]
    [InlineData(0.9)]
    [InlineData(1.0)]
    public void SrgbRoundtrip(double x)
    {
        double linear = TransferAccessor.SrgbEotf(x);
        double gamma = TransferAccessor.SrgbGamma(linear);
        Assert.True(Math.Abs(gamma - x) < 1e-4, $"sRGB roundtrip at {x}: got {gamma}");
    }

    [Fact]
    public void SrgbBoundaries()
    {
        Assert.Equal(0.0, TransferAccessor.SrgbEotf(0.0));
        Assert.True(Math.Abs(TransferAccessor.SrgbEotf(1.0) - 1.0) < 1e-12);
        Assert.Equal(0.0, TransferAccessor.SrgbGamma(0.0));
        Assert.True(Math.Abs(TransferAccessor.SrgbGamma(1.0) - 1.0) < 1e-12);
    }

    [Fact]
    public void AdobeRgbBoundaries()
    {
        Assert.Equal(0.0, TransferAccessor.AdobeRgbEotf(0.0));
        Assert.True(Math.Abs(TransferAccessor.AdobeRgbEotf(1.0) - 1.0) < 1e-12);
    }

    [Fact]
    public void ProPhotoBoundaries()
    {
        Assert.Equal(0.0, TransferAccessor.ProPhotoRgbEotf(0.0));
        Assert.True(Math.Abs(TransferAccessor.ProPhotoRgbEotf(1.0) - 1.0) < 1e-12);
    }

    [Fact]
    public void Bt2020PqBoundaries()
    {
        Assert.Equal(0.0, TransferAccessor.Bt2020PqEotf(0.0));
        double max = TransferAccessor.Bt2020PqEotf(1.0);
        Assert.True(max > 0.9 && max < 1.0, $"PQ(1.0) should be near 1.0, got {max}");
    }
}

// ── Color ─────────────────────────────────────────────────────────────────────

public class ColorTests
{
    [Fact]
    public void WhiteToOklab()
    {
        double[] lab = ColorAccessor.LinearRgbToOklab([1.0, 1.0, 1.0], Gamut.Srgb);
        Assert.True(Math.Abs(lab[0] - 1.0) < 1e-6, $"white L should ≈ 1, got {lab[0]}");
        Assert.True(Math.Abs(lab[1]) < 1e-6, $"white a should ≈ 0, got {lab[1]}");
        Assert.True(Math.Abs(lab[2]) < 1e-6, $"white b should ≈ 0, got {lab[2]}");
    }

    [Fact]
    public void BlackToOklab()
    {
        double[] lab = ColorAccessor.LinearRgbToOklab([0.0, 0.0, 0.0], Gamut.Srgb);
        Assert.True(Math.Abs(lab[0]) < 1e-12);
        Assert.True(Math.Abs(lab[1]) < 1e-12);
        Assert.True(Math.Abs(lab[2]) < 1e-12);
    }

    [Theory]
    [InlineData(1.0, 0.0, 0.0)]
    [InlineData(0.0, 1.0, 0.0)]
    [InlineData(0.0, 0.0, 1.0)]
    [InlineData(0.5, 0.5, 0.5)]
    [InlineData(0.2, 0.7, 0.3)]
    public void RoundtripSrgb(double r, double g, double b)
    {
        double[] rgb = [r, g, b];
        double[] lab = ColorAccessor.LinearRgbToOklab(rgb, Gamut.Srgb);
        double[] rgb2 = ColorAccessor.OklabToLinearSrgb(lab);
        for (int i = 0; i < 3; i++)
            Assert.True(Math.Abs(rgb[i] - rgb2[i]) < 1e-6, $"roundtrip failed at channel {i}");
    }

    [Fact]
    public void P3VsSrgbRedDiffer()
    {
        double[] srgbRed = ColorAccessor.LinearRgbToOklab([1.0, 0.0, 0.0], Gamut.Srgb);
        double[] p3Red = ColorAccessor.LinearRgbToOklab([1.0, 0.0, 0.0], Gamut.DisplayP3);
        Assert.True(Math.Abs(srgbRed[1] - p3Red[1]) > 0.01, "P3 and sRGB red should differ in OKLAB a");
    }
}

// ── MuLaw ─────────────────────────────────────────────────────────────────────

public class MuLawTests
{
    [Theory]
    [InlineData(-1.0)]
    [InlineData(-0.5)]
    [InlineData(0.0)]
    [InlineData(0.5)]
    [InlineData(1.0)]
    public void RoundtripExtremes(double v)
    {
        double c = MuLawAccessor.Compress(v);
        double rt = MuLawAccessor.Expand(c);
        Assert.True(Math.Abs(rt - v) < 1e-12, $"µ-law roundtrip failed at v={v}: got {rt}");
    }

    [Fact]
    public void CompressedRange()
    {
        Assert.True(Math.Abs(MuLawAccessor.Compress(1.0) - 1.0) < 1e-12);
        Assert.True(Math.Abs(MuLawAccessor.Compress(-1.0) + 1.0) < 1e-12);
        Assert.True(Math.Abs(MuLawAccessor.Compress(0.0)) < 1e-12);
    }

    [Fact]
    public void Quantize4Bit()
    {
        uint mid = MuLawAccessor.Quantize(0.0, 4);
        Assert.Equal(8u, mid);
        Assert.Equal(0u, MuLawAccessor.Quantize(-1.0, 4));
        Assert.Equal(15u, MuLawAccessor.Quantize(1.0, 4));
    }

    [Fact]
    public void Quantize5Bit()
    {
        uint mid = MuLawAccessor.Quantize(0.0, 5);
        Assert.Equal(16u, mid);
        Assert.Equal(0u, MuLawAccessor.Quantize(-1.0, 5));
        Assert.Equal(31u, MuLawAccessor.Quantize(1.0, 5));
    }

    [Theory]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    public void QuantizeRoundtripPreservesSign(int bits)
    {
        foreach (double v in new[] { -0.9, -0.5, -0.1, 0.1, 0.5, 0.9 })
        {
            uint q = MuLawAccessor.Quantize(v, bits);
            double dq = MuLawAccessor.Dequantize(q, bits);
            if (v > 0.0)
                Assert.True(dq >= 0.0, $"sign should be preserved for v={v}");
            else
                Assert.True(dq <= 0.0, $"sign should be preserved for v={v}");
        }
    }
}

// ── BitPack ───────────────────────────────────────────────────────────────────

public class BitPackTests
{
    [Fact]
    public void RoundtripBasic()
    {
        byte[] buf = new byte[4];
        BitPackAccessor.Write(buf, 0, 8, 0xAB);
        Assert.Equal(0xABu, BitPackAccessor.Read(buf, 0, 8));
    }

    [Fact]
    public void RoundtripAtOffset()
    {
        byte[] buf = new byte[4];
        BitPackAccessor.Write(buf, 3, 5, 0x1F);
        Assert.Equal(0x1Fu, BitPackAccessor.Read(buf, 3, 5));
    }

    [Fact]
    public void CrossByteBoundary()
    {
        byte[] buf = new byte[4];
        BitPackAccessor.Write(buf, 6, 8, 0xCA);
        Assert.Equal(0xCAu, BitPackAccessor.Read(buf, 6, 8));
    }

    [Fact]
    public void MultipleFields()
    {
        byte[] buf = new byte[8];
        BitPackAccessor.Write(buf, 0, 7, 100);
        BitPackAccessor.Write(buf, 7, 7, 64);
        BitPackAccessor.Write(buf, 14, 7, 80);
        BitPackAccessor.Write(buf, 21, 6, 33);
        BitPackAccessor.Write(buf, 27, 6, 20);
        BitPackAccessor.Write(buf, 33, 5, 15);
        BitPackAccessor.Write(buf, 38, 8, 128);
        BitPackAccessor.Write(buf, 46, 1, 1);
        BitPackAccessor.Write(buf, 47, 1, 0);

        Assert.Equal(100u, BitPackAccessor.Read(buf, 0, 7));
        Assert.Equal(64u, BitPackAccessor.Read(buf, 7, 7));
        Assert.Equal(80u, BitPackAccessor.Read(buf, 14, 7));
        Assert.Equal(33u, BitPackAccessor.Read(buf, 21, 6));
        Assert.Equal(20u, BitPackAccessor.Read(buf, 27, 6));
        Assert.Equal(15u, BitPackAccessor.Read(buf, 33, 5));
        Assert.Equal(128u, BitPackAccessor.Read(buf, 38, 8));
        Assert.Equal(1u, BitPackAccessor.Read(buf, 46, 1));
        Assert.Equal(0u, BitPackAccessor.Read(buf, 47, 1));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public void MaxValues(int bits)
    {
        uint max = (1u << bits) - 1;
        byte[] buf = new byte[4];
        BitPackAccessor.Write(buf, 0, bits, max);
        Assert.Equal(max, BitPackAccessor.Read(buf, 0, bits));
    }
}

// ── DCT ───────────────────────────────────────────────────────────────────────

public class DctTests
{
    [Theory]
    [InlineData(3, 3, 5)]
    [InlineData(4, 4, 9)]
    [InlineData(6, 6, 20)]
    [InlineData(7, 7, 27)]
    public void ScanOrderCounts(int nx, int ny, int expected)
    {
        Assert.Equal(expected, DctAccessor.ScanOrder(nx, ny).Count);
    }

    [Fact]
    public void ScanOrder4x4()
    {
        var order = DctAccessor.ScanOrder(4, 4);
        var expected = new List<(int, int)>
        {
            (1, 0),
            (2, 0),
            (3, 0),
            (0, 1),
            (1, 1),
            (2, 1),
            (0, 2),
            (1, 2),
            (0, 3),
        };
        Assert.Equal(expected, order);
    }

    [Fact]
    public void ScanOrder3x3()
    {
        var order = DctAccessor.ScanOrder(3, 3);
        var expected = new List<(int, int)> { (1, 0), (2, 0), (0, 1), (1, 1), (0, 2) };
        Assert.Equal(expected, order);
    }

    [Fact]
    public void DcOfConstantChannel()
    {
        double val = 0.7;
        double[] channel = Enumerable.Repeat(val, 16).ToArray();
        var (dc, _, _) = DctAccessor.Encode(channel, 4, 4, 4, 4);
        Assert.True(Math.Abs(dc - val) < 1e-12, $"DC of constant channel should = {val}, got {dc}");
    }

    [Fact]
    public void AcOfConstantChannelIsZero()
    {
        double[] channel = Enumerable.Repeat(0.5, 16).ToArray();
        var (_, ac, scale) = DctAccessor.Encode(channel, 4, 4, 4, 4);
        Assert.True(scale < 1e-12, "AC of constant channel should be 0");
        foreach (double v in ac)
            Assert.True(Math.Abs(v) < 1e-12, $"AC should be 0, got {v}");
    }

    [Fact]
    public void EncodeDecodeRoundtripConstant()
    {
        const double val = 0.42;
        double[] channel = Enumerable.Repeat(val, 64).ToArray();
        const int nx = 4,
            ny = 4;
        var (dc, ac, _) = DctAccessor.Encode(channel, 8, 8, nx, ny);
        var scan = DctAccessor.ScanOrder(nx, ny);
        for (int y = 0; y < 8; y++)
        {
            for (int x = 0; x < 8; x++)
            {
                double reconstructed = DctAccessor.DecodePixel(dc, ac, scan, x, y, 8, 8);
                Assert.True(
                    Math.Abs(reconstructed - val) < 1e-10,
                    $"constant roundtrip failed at ({x},{y}): got {reconstructed}"
                );
            }
        }
    }

    [Fact]
    public void EncodeDecodeGradientReasonable()
    {
        const int w = 8,
            h = 8;
        double[] channel = new double[w * h];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                channel[x + y * w] = (x / (double)w + y / (double)h) / 2.0;

        const int nx = 7,
            ny = 7;
        var (dc, ac, _) = DctAccessor.Encode(channel, w, h, nx, ny);
        var scan = DctAccessor.ScanOrder(nx, ny);

        double maxErr = 0.0;
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                double reconstructed = DctAccessor.DecodePixel(dc, ac, scan, x, y, w, h);
                maxErr = Math.Max(maxErr, Math.Abs(reconstructed - channel[x + y * w]));
            }
        }
        Assert.True(maxErr < 0.02, $"gradient reconstruction max error too large: {maxErr}");
    }
}

// ── Aspect ────────────────────────────────────────────────────────────────────

public class AspectTests
{
    [Fact]
    public void SquareEncodesTo128()
    {
        Assert.Equal(128, AspectAccessor.Encode(1, 1));
    }

    [Fact]
    public void Extreme4To1()
    {
        Assert.Equal(255, AspectAccessor.Encode(4, 1));
    }

    [Fact]
    public void Extreme1To4()
    {
        Assert.Equal(0, AspectAccessor.Encode(1, 4));
    }

    [Theory]
    [InlineData(1, 1, "1:1")]
    [InlineData(3, 2, "3:2")]
    [InlineData(4, 3, "4:3")]
    [InlineData(16, 9, "16:9")]
    [InlineData(4, 1, "4:1")]
    [InlineData(1, 4, "1:4")]
    public void KnownRatios(uint w, uint h, string label)
    {
        byte b = AspectAccessor.Encode(w, h);
        double decoded = AspectAccessor.Decode(b);
        double actual = (double)w / h;
        double err = Math.Abs(decoded - actual) / actual * 100.0;
        Assert.True(err < 0.55, $"Aspect {label}: error={err:F3}% ≥ 0.55%");
    }

    [Fact]
    public void DecodeOutputSizeLandscape()
    {
        byte b = AspectAccessor.Encode(2, 1);
        var (w, h) = AspectAccessor.OutputSize(b);
        Assert.Equal(32u, w);
        Assert.True(h < 32);
    }

    [Fact]
    public void DecodeOutputSizePortrait()
    {
        byte b = AspectAccessor.Encode(1, 2);
        var (w, h) = AspectAccessor.OutputSize(b);
        Assert.True(w < 32);
        Assert.Equal(32u, h);
    }
}

// ── ChromaHash Integration ────────────────────────────────────────────────────

public class ChromaHashTests
{
    [Fact]
    public void EncodeProduces32Bytes()
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 128, 128, 128, 255);
        CH hash = CH.Encode(4, 4, rgba, Gamut.Srgb);
        Assert.Equal(32, hash.AsBytes().Length);
    }

    [Fact]
    public void SolidColorRoundtrip()
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 200, 100, 50, 255);
        CH hash = CH.Encode(4, 4, rgba, Gamut.Srgb);
        byte[] avg = hash.AverageColor();
        Assert.True(Math.Abs(avg[0] - 200) <= 3, $"R: expected ~200, got {avg[0]}");
        Assert.True(Math.Abs(avg[1] - 100) <= 3, $"G: expected ~100, got {avg[1]}");
        Assert.True(Math.Abs(avg[2] - 50) <= 3, $"B: expected ~50, got {avg[2]}");
        Assert.Equal(255, avg[3]);
    }

    [Fact]
    public void SolidBlackRoundtrip()
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 0, 0, 0, 255);
        CH hash = CH.Encode(4, 4, rgba, Gamut.Srgb);
        byte[] avg = hash.AverageColor();
        Assert.True(avg[0] <= 2, $"R should be ~0, got {avg[0]}");
        Assert.True(avg[1] <= 2, $"G should be ~0, got {avg[1]}");
        Assert.True(avg[2] <= 2, $"B should be ~0, got {avg[2]}");
    }

    [Fact]
    public void SolidWhiteRoundtrip()
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 255, 255, 255, 255);
        CH hash = CH.Encode(4, 4, rgba, Gamut.Srgb);
        byte[] avg = hash.AverageColor();
        Assert.True(avg[0] >= 253, $"R should be ~255, got {avg[0]}");
        Assert.True(avg[1] >= 253, $"G should be ~255, got {avg[1]}");
        Assert.True(avg[2] >= 253, $"B should be ~255, got {avg[2]}");
    }

    [Fact]
    public void HasAlphaFlagSetCorrectlyOpaque()
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 128, 128, 128, 255);
        CH hash = CH.Encode(4, 4, rgba, Gamut.Srgb);
        int hasAlpha = (hash.AsBytes()[5] >> 6) & 1;
        Assert.Equal(0, hasAlpha);
    }

    [Fact]
    public void HasAlphaFlagSetCorrectlySemiTransparent()
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 128, 128, 128, 128);
        CH hash = CH.Encode(4, 4, rgba, Gamut.Srgb);
        byte[] bytes = hash.AsBytes();
        ulong header = 0;
        for (int i = 0; i < 6; i++)
            header |= ((ulong)bytes[i]) << (i * 8);
        bool hasAlpha = ((header >> 46) & 1) == 1;
        Assert.True(hasAlpha, "semi-transparent image should have alpha flag");
    }

    [Fact]
    public void DecodeProducesValidDimensions()
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 128, 64, 32, 255);
        CH hash = CH.Encode(4, 4, rgba, Gamut.Srgb);
        var (w, h, pixels) = hash.Decode();
        Assert.True(w > 0 && w <= 32);
        Assert.True(h > 0 && h <= 32);
        Assert.Equal((int)(w * h * 4), pixels.Length);
    }

    [Fact]
    public void DecodeSolidColorPixelsUniform()
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 128, 128, 128, 255);
        CH hash = CH.Encode(4, 4, rgba, Gamut.Srgb);
        var (w, h, pixels) = hash.Decode();
        byte r0 = pixels[0],
            g0 = pixels[1],
            b0 = pixels[2];
        for (int i = 0; i < (int)(w * h); i++)
        {
            byte r = pixels[i * 4],
                g = pixels[i * 4 + 1],
                b = pixels[i * 4 + 2];
            Assert.True(Math.Abs(r - r0) <= 2, $"pixel {i} R diverges: {r} vs {r0}");
            Assert.True(Math.Abs(g - g0) <= 2, $"pixel {i} G diverges: {g} vs {g0}");
            Assert.True(Math.Abs(b - b0) <= 2, $"pixel {i} B diverges: {b} vs {b0}");
        }
    }

    [Fact]
    public void GradientEncodeDecode()
    {
        byte[] rgba = Helpers.HorizontalGradient(16, 16);
        CH hash = CH.Encode(16, 16, rgba, Gamut.Srgb);
        var (w, h, _) = hash.Decode();
        Assert.True(w > 0 && h > 0);
    }

    [Fact]
    public void VerticalGradientEncodeDecode()
    {
        byte[] rgba = Helpers.VerticalGradient(16, 16);
        CH hash = CH.Encode(16, 16, rgba, Gamut.Srgb);
        var (w, h, _) = hash.Decode();
        Assert.True(w > 0 && h > 0);
    }

    [Fact]
    public void OneByOnePixel()
    {
        byte[] rgba = Helpers.SolidImage(1, 1, 200, 100, 50, 255);
        CH hash = CH.Encode(1, 1, rgba, Gamut.Srgb);
        Assert.Equal(32, hash.AsBytes().Length);
        byte[] avg = hash.AverageColor();
        Assert.True(Math.Abs(avg[0] - 200) <= 3, $"1×1 R: expected ~200, got {avg[0]}");
    }

    [Fact]
    public void LargeImage100x100()
    {
        byte[] rgba = Helpers.HorizontalGradient(100, 100);
        CH hash = CH.Encode(100, 100, rgba, Gamut.Srgb);
        Assert.Equal(32, hash.AsBytes().Length);
    }

    [Theory]
    [InlineData(16u, 4u)]
    [InlineData(4u, 16u)]
    [InlineData(10u, 10u)]
    [InlineData(3u, 7u)]
    [InlineData(100u, 25u)]
    public void VariousAspectRatios(uint w, uint h)
    {
        byte[] rgba = Helpers.SolidImage((int)w, (int)h, 128, 64, 32, 255);
        CH hash = CH.Encode(w, h, rgba, Gamut.Srgb);
        var (dw, dh, pixels) = hash.Decode();
        Assert.True(dw > 0 && dh > 0, $"decode dims should be > 0 for {w}×{h}");
        Assert.Equal((int)(dw * dh * 4), pixels.Length);
    }

    [Theory]
    [InlineData(Gamut.Srgb)]
    [InlineData(Gamut.DisplayP3)]
    [InlineData(Gamut.AdobeRgb)]
    [InlineData(Gamut.Bt2020)]
    [InlineData(Gamut.ProPhotoRgb)]
    public void AllGamutsProduceOutput(Gamut gamut)
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 200, 100, 50, 255);
        CH hash = CH.Encode(4, 4, rgba, gamut);
        Assert.Equal(32, hash.AsBytes().Length);
    }

    [Fact]
    public void TransparencyRoundtrip()
    {
        const int w = 8, h = 8;
        byte[] rgba = new byte[w * h * 4];
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int idx = (y * w + x) * 4;
                if (y < h / 2)
                {
                    rgba[idx] = 255;
                    rgba[idx + 3] = 255;
                }
                else
                {
                    rgba[idx + 3] = 0;
                }
            }
        }
        CH hash = CH.Encode(w, h, rgba, Gamut.Srgb);
        byte[] bytes = hash.AsBytes();
        ulong header = 0;
        for (int i = 0; i < 6; i++)
            header |= ((ulong)bytes[i]) << (i * 8);
        Assert.True(((header >> 46) & 1) == 1, "should detect alpha");

        var (dw, dh, pixels) = hash.Decode();
        Assert.True(dw > 0 && dh > 0);
        byte aMin = 255, aMax = 0;
        for (int i = 0; i < (int)(dw * dh); i++)
        {
            byte a = pixels[i * 4 + 3];
            if (a < aMin) aMin = a;
            if (a > aMax) aMax = a;
        }
        Assert.True(aMax > aMin, "alpha should vary across decoded image");
    }

    [Fact]
    public void FromBytesRoundtrip()
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 128, 64, 32, 255);
        CH hash = CH.Encode(4, 4, rgba, Gamut.Srgb);
        CH hash2 = CH.FromBytes(hash.AsBytes());
        Assert.Equal(hash, hash2);
    }

    [Fact]
    public void DeterministicEncoding()
    {
        byte[] rgba = Helpers.HorizontalGradient(16, 16);
        CH hash1 = CH.Encode(16, 16, rgba, Gamut.Srgb);
        CH hash2 = CH.Encode(16, 16, rgba, Gamut.Srgb);
        Assert.Equal(hash1.AsBytes(), hash2.AsBytes());
    }

    [Theory]
    [InlineData(0u, 4u)]
    [InlineData(4u, 0u)]
    [InlineData(101u, 4u)]
    public void InvalidDimensionsThrow(uint w, uint h)
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 128, 128, 128, 255);
        Assert.Throws<ArgumentOutOfRangeException>(() => CH.Encode(w, h, rgba, Gamut.Srgb));
    }
}

// ── Spec Test Vectors ─────────────────────────────────────────────────────────

public class SpecVectorTests
{
    private static T? LoadVectors<T>(string name)
    {
        string path = Path.Combine(Helpers.SpecVectors, name);
        if (!File.Exists(path))
            return default;
        return JsonSerializer.Deserialize<T>(File.ReadAllText(path));
    }

    [Fact]
    public void UnitColorVectors()
    {
        var cases = LoadVectors<JsonElement[]>("unit-color.json");
        if (cases is null)
            return;

        foreach (var tc in cases)
        {
            string name = tc.GetProperty("name").GetString()!;
            var input = tc.GetProperty("input");
            var expected = tc.GetProperty("expected");
            Gamut gamut = Helpers.GamutFromString(input.GetProperty("gamut").GetString()!);

            double[] lab;
            if (input.TryGetProperty("linear_rgb", out var linRgb))
            {
                double[] rgb = linRgb.EnumerateArray().Select(e => e.GetDouble()).ToArray();
                lab = ColorAccessor.LinearRgbToOklab(rgb, gamut);
            }
            else
            {
                var g = input.GetProperty("gamma_rgb");
                double r = g[0].GetDouble(), gr = g[1].GetDouble(), b = g[2].GetDouble();
                lab = ColorAccessor.GammaRgbToOklab(r, gr, b, gamut);
            }

            var expectedOklab = expected.GetProperty("oklab").EnumerateArray().Select(e => e.GetDouble()).ToArray();
            for (int i = 0; i < 3; i++)
                Assert.True(
                    Math.Abs(lab[i] - expectedOklab[i]) < 1e-6,
                    $"{name}: oklab[{i}] got {lab[i]}, want {expectedOklab[i]}"
                );

            if (expected.TryGetProperty("roundtrip_srgb", out var rtEl))
            {
                double[] rt = ColorAccessor.OklabToLinearSrgb(lab);
                double[] expectedRt = rtEl.EnumerateArray().Select(e => e.GetDouble()).ToArray();
                for (int i = 0; i < 3; i++)
                    Assert.True(
                        Math.Abs(rt[i] - expectedRt[i]) < 1e-6,
                        $"{name}: roundtrip sRGB[{i}] got {rt[i]}"
                    );
            }
        }
    }

    [Fact]
    public void UnitMulawVectors()
    {
        var cases = LoadVectors<JsonElement[]>("unit-mulaw.json");
        if (cases is null)
            return;

        foreach (var tc in cases)
        {
            string name = tc.GetProperty("name").GetString()!;
            double value = tc.GetProperty("input").GetProperty("value").GetDouble();
            int bits = tc.GetProperty("input").GetProperty("bits").GetInt32();
            var expected = tc.GetProperty("expected");

            double c = MuLawAccessor.Compress(value);
            Assert.True(
                Math.Abs(c - expected.GetProperty("compressed").GetDouble()) < 1e-12,
                $"{name}: compress({value}) = {c}"
            );

            double e = MuLawAccessor.Expand(c);
            Assert.True(
                Math.Abs(e - expected.GetProperty("expanded").GetDouble()) < 1e-12,
                $"{name}: expand = {e}"
            );

            uint q = MuLawAccessor.Quantize(value, bits);
            Assert.Equal(
                (uint)expected.GetProperty("quantized").GetUInt32(),
                q
            );

            double dq = MuLawAccessor.Dequantize(q, bits);
            Assert.True(
                Math.Abs(dq - expected.GetProperty("dequantized").GetDouble()) < 1e-12,
                $"{name}: dequantize = {dq}"
            );
        }
    }

    [Fact]
    public void UnitDctVectors()
    {
        var cases = LoadVectors<JsonElement[]>("unit-dct.json");
        if (cases is null)
            return;

        foreach (var tc in cases)
        {
            string name = tc.GetProperty("name").GetString()!;
            int nx = tc.GetProperty("input").GetProperty("nx").GetInt32();
            int ny = tc.GetProperty("input").GetProperty("ny").GetInt32();
            var expected = tc.GetProperty("expected");

            var order = DctAccessor.ScanOrder(nx, ny);
            Assert.True(
                order.Count == expected.GetProperty("ac_count").GetInt32(),
                $"{name}: scan order count = {order.Count}"
            );

            var expectedScan = expected.GetProperty("scan_order").EnumerateArray().ToArray();
            for (int i = 0; i < Math.Min(order.Count, expectedScan.Length); i++)
            {
                int expCx = expectedScan[i][0].GetInt32();
                int expCy = expectedScan[i][1].GetInt32();
                Assert.Equal((expCx, expCy), order[i]);
            }
        }
    }

    [Fact]
    public void UnitAspectVectors()
    {
        var cases = LoadVectors<JsonElement[]>("unit-aspect.json");
        if (cases is null)
            return;

        foreach (var tc in cases)
        {
            string name = tc.GetProperty("name").GetString()!;
            uint w = (uint)tc.GetProperty("input").GetProperty("width").GetInt32();
            uint h = (uint)tc.GetProperty("input").GetProperty("height").GetInt32();
            var expected = tc.GetProperty("expected");

            byte b = AspectAccessor.Encode(w, h);
            Assert.Equal((byte)expected.GetProperty("byte").GetInt32(), b);

            double ratio = AspectAccessor.Decode(b);
            Assert.True(
                Math.Abs(ratio - expected.GetProperty("decoded_ratio").GetDouble()) < 1e-12,
                $"{name}: decodeAspect = {ratio}"
            );

            var (ow, oh) = AspectAccessor.OutputSize(b);
            Assert.Equal((uint)expected.GetProperty("output_width").GetInt32(), ow);
            Assert.Equal((uint)expected.GetProperty("output_height").GetInt32(), oh);
        }
    }

    [Fact]
    public void IntegrationEncodeVectors()
    {
        var cases = LoadVectors<JsonElement[]>("integration-encode.json");
        if (cases is null)
            return;

        foreach (var tc in cases)
        {
            string name = tc.GetProperty("name").GetString()!;
            var input = tc.GetProperty("input");
            uint w = (uint)input.GetProperty("width").GetInt32();
            uint h = (uint)input.GetProperty("height").GetInt32();
            Gamut gamut = Helpers.GamutFromString(input.GetProperty("gamut").GetString()!);
            byte[] rgba = input.GetProperty("rgba").EnumerateArray().Select(e => (byte)e.GetInt32()).ToArray();

            CH ch = CH.Encode(w, h, rgba, gamut);
            byte[] hashBytes = ch.AsBytes();

            var expectedHash = tc.GetProperty("expected").GetProperty("hash").EnumerateArray().Select(e => (byte)e.GetInt32()).ToArray();
            for (int i = 0; i < 32; i++)
                Assert.True(
                    hashBytes[i] == expectedHash[i],
                    $"{name}: hash[{i}] = {hashBytes[i]}, want {expectedHash[i]}"
                );

            byte[] avg = ch.AverageColor();
            var expectedAvg = tc.GetProperty("expected").GetProperty("average_color").EnumerateArray().Select(e => (byte)e.GetInt32()).ToArray();
            for (int i = 0; i < 4; i++)
                Assert.True(
                    avg[i] == expectedAvg[i],
                    $"{name}: average_color[{i}] = {avg[i]}, want {expectedAvg[i]}"
                );
        }
    }

    [Fact]
    public void IntegrationDecodeVectors()
    {
        var cases = LoadVectors<JsonElement[]>("integration-decode.json");
        if (cases is null)
            return;

        foreach (var tc in cases)
        {
            string name = tc.GetProperty("name").GetString()!;
            byte[] hashBytes = tc.GetProperty("input").GetProperty("hash").EnumerateArray().Select(e => (byte)e.GetInt32()).ToArray();
            var expected = tc.GetProperty("expected");

            CH ch = CH.FromBytes(hashBytes);
            var (w, h, rgba) = ch.Decode();

            Assert.Equal((uint)expected.GetProperty("width").GetInt32(), w);
            Assert.Equal((uint)expected.GetProperty("height").GetInt32(), h);

            var expectedRgba = expected.GetProperty("rgba").EnumerateArray().Select(e => (byte)e.GetInt32()).ToArray();
            for (int i = 0; i < expectedRgba.Length; i++)
                Assert.True(
                    rgba[i] == expectedRgba[i],
                    $"{name}: rgba[{i}] = {rgba[i]}, want {expectedRgba[i]}"
                );
        }
    }
}

// ── Internal Accessors (for testing internal APIs) ────────────────────────────

// These static accessor classes expose internal methods for testing.
// They live in the test project and use InternalsVisibleTo.

internal static class MathUtilsAccessor
{
    public static double Round(double x) => MathUtils.RoundHalfAwayFromZero(x);
    public static double Cbrt(double x) => MathUtils.CbrtSigned(x);
    public static double Clamp01(double x) => MathUtils.Clamp01(x);
}

internal static class TransferAccessor
{
    public static double SrgbEotf(double x) => Transfer.SrgbEotf(x);
    public static double SrgbGamma(double x) => Transfer.SrgbGamma(x);
    public static double AdobeRgbEotf(double x) => Transfer.AdobeRgbEotf(x);
    public static double ProPhotoRgbEotf(double x) => Transfer.ProPhotoRgbEotf(x);
    public static double Bt2020PqEotf(double x) => Transfer.Bt2020PqEotf(x);
}

internal static class ColorAccessor
{
    public static double[] LinearRgbToOklab(double[] rgb, Gamut gamut) =>
        Color.LinearRgbToOklab(rgb, gamut);

    public static double[] OklabToLinearSrgb(double[] lab) => Color.OklabToLinearSrgb(lab);

    public static double[] GammaRgbToOklab(double r, double g, double b, Gamut gamut) =>
        Color.GammaRgbToOklab(r, g, b, gamut);
}

internal static class MuLawAccessor
{
    public static double Compress(double value) => MuLaw.MuCompress(value);
    public static double Expand(double compressed) => MuLaw.MuExpand(compressed);
    public static uint Quantize(double value, int bits) => MuLaw.MuLawQuantize(value, bits);
    public static double Dequantize(uint index, int bits) => MuLaw.MuLawDequantize(index, bits);
}

internal static class BitPackAccessor
{
    public static void Write(byte[] hash, int bitpos, int count, uint value) =>
        BitPack.WriteBits(hash, bitpos, count, value);

    public static uint Read(byte[] hash, int bitpos, int count) =>
        BitPack.ReadBits(hash, bitpos, count);
}

internal static class DctAccessor
{
    public static List<(int Cx, int Cy)> ScanOrder(int nx, int ny) =>
        Dct.TriangularScanOrder(nx, ny);

    public static (double Dc, List<double> Ac, double Scale) Encode(
        double[] channel,
        int w,
        int h,
        int nx,
        int ny
    ) => Dct.DctEncode(channel, w, h, nx, ny);

    public static double DecodePixel(
        double dc,
        List<double> ac,
        List<(int Cx, int Cy)> scan,
        int x,
        int y,
        int w,
        int h
    ) => Dct.DctDecodePixel(dc, ac, scan, x, y, w, h);
}

internal static class AspectAccessor
{
    public static byte Encode(uint w, uint h) => Aspect.EncodeAspect(w, h);
    public static double Decode(byte b) => Aspect.DecodeAspect(b);
    public static (uint W, uint H) OutputSize(byte b) => Aspect.DecodeOutputSize(b);
}
