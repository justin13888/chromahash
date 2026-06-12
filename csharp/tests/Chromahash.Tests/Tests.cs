using System.Text.Json;
using ChromaHash;
using CH = ChromaHash.ChromaHash;

// The C# library is now a thin P/Invoke wrapper over the chromahash-c C ABI, so
// these tests exercise the public API end-to-end against the shared spec vectors —
// the cross-language parity gate. Per-function unit tests of the algorithm live in
// the Rust core (the single source of truth).

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

// ── ChromaHash public-API behaviour ─────────────────────────────────────────────

public class ChromaHashTests
{
    [Fact]
    public void EncodeProduces32Bytes()
    {
        CH hash = CH.Encode(4, 4, Helpers.SolidImage(4, 4, 128, 128, 128, 255), Gamut.Srgb);
        Assert.Equal(32, hash.AsBytes().Length);
    }

    [Fact]
    public void DecodeProducesValidDimensions()
    {
        CH hash = CH.Encode(4, 4, Helpers.SolidImage(4, 4, 128, 64, 32, 255), Gamut.Srgb);
        var (w, h, pixels) = hash.Decode();
        Assert.True(w > 0 && w <= 32);
        Assert.True(h > 0 && h <= 32);
        Assert.Equal((int)(w * h * 4), pixels.Length);
    }

    [Fact]
    public void FromBytesRoundtrip()
    {
        CH hash = CH.Encode(4, 4, Helpers.SolidImage(4, 4, 128, 64, 32, 255), Gamut.Srgb);
        Assert.Equal(hash, CH.FromBytes(hash.AsBytes()));
    }

    [Fact]
    public void VersionSupported()
    {
        CH hash = CH.Encode(4, 4, Helpers.SolidImage(4, 4, 128, 128, 128, 255), Gamut.Srgb);
        Assert.True(hash.IsVersionSupported(), "v0.6 hash must be supported");

        byte[] legacy = hash.AsBytes();
        legacy[5] |= 0x80; // flip header bit 47 to simulate a legacy v0.2–v0.5 hash
        Assert.False(CH.FromBytes(legacy).IsVersionSupported());
    }

    [Theory]
    [InlineData(0u, 4u)]
    [InlineData(4u, 0u)]
    public void InvalidDimensionsThrow(uint w, uint h)
    {
        byte[] rgba = Helpers.SolidImage(4, 4, 128, 128, 128, 255);
        Assert.Throws<ArgumentOutOfRangeException>(() => CH.Encode(w, h, rgba, Gamut.Srgb));
    }
}

// ── Spec test vectors (parity gate) ─────────────────────────────────────────────

public class SpecVectorTests
{
    private static JsonElement[] LoadVectors(string name)
    {
        string path = Path.Combine(Helpers.SpecVectors, name);
        Assert.True(File.Exists(path), $"spec vector not found: {path}");
        return JsonSerializer.Deserialize<JsonElement[]>(File.ReadAllText(path))!;
    }

    private static byte[] Bytes(JsonElement arr) =>
        arr.EnumerateArray().Select(e => (byte)e.GetInt32()).ToArray();

    [Fact]
    public void IntegrationEncodeVectors()
    {
        var cases = LoadVectors("integration-encode.json");
        Assert.NotEmpty(cases);

        foreach (var tc in cases)
        {
            string name = tc.GetProperty("name").GetString()!;
            var input = tc.GetProperty("input");
            uint w = (uint)input.GetProperty("width").GetInt32();
            uint h = (uint)input.GetProperty("height").GetInt32();
            Gamut gamut = Helpers.GamutFromString(input.GetProperty("gamut").GetString()!);
            byte[] rgba = Bytes(input.GetProperty("rgba"));

            CH ch = CH.Encode(w, h, rgba, gamut);
            Assert.True(ch.AsBytes().SequenceEqual(Bytes(tc.GetProperty("expected").GetProperty("hash"))), $"{name}: hash mismatch");
            Assert.True(ch.AverageColor().SequenceEqual(Bytes(tc.GetProperty("expected").GetProperty("average_color"))), $"{name}: average_color mismatch");
        }
    }

    [Fact]
    public void IntegrationDecodeVectors()
    {
        var cases = LoadVectors("integration-decode.json");
        Assert.NotEmpty(cases);

        foreach (var tc in cases)
        {
            string name = tc.GetProperty("name").GetString()!;
            CH ch = CH.FromBytes(Bytes(tc.GetProperty("input").GetProperty("hash")));
            var (w, h, rgba) = ch.Decode();
            var expected = tc.GetProperty("expected");

            Assert.Equal((uint)expected.GetProperty("width").GetInt32(), w);
            Assert.Equal((uint)expected.GetProperty("height").GetInt32(), h);
            Assert.True(rgba.SequenceEqual(Bytes(expected.GetProperty("rgba"))), $"{name}: rgba mismatch");
        }
    }

    [Fact]
    public void IntegrationDecodeCappedVectors()
    {
        var cases = LoadVectors("integration-decode-capped.json");
        Assert.NotEmpty(cases);

        foreach (var tc in cases)
        {
            string name = tc.GetProperty("name").GetString()!;
            var input = tc.GetProperty("input");
            CH ch = CH.FromBytes(Bytes(input.GetProperty("hash")));
            uint maxW = (uint)input.GetProperty("max_width").GetInt32();
            uint maxH = (uint)input.GetProperty("max_height").GetInt32();
            var (w, h, rgba) = ch.DecodeCapped(maxW, maxH);
            var expected = tc.GetProperty("expected");

            Assert.Equal((uint)expected.GetProperty("width").GetInt32(), w);
            Assert.Equal((uint)expected.GetProperty("height").GetInt32(), h);
            Assert.True(rgba.SequenceEqual(Bytes(expected.GetProperty("rgba"))), $"{name}: rgba mismatch");
        }
    }
}
