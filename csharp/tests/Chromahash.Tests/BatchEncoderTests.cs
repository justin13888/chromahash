using ChromaHash;
using CH = ChromaHash.ChromaHash;

public class BatchEncoderTests
{
    /// <summary>A spread of dimensions, gamuts, and alpha, mirroring the bulk-migration use case.</summary>
    private static List<ImageInput> MixedItems() =>
        new()
        {
            new ImageInput(4, 4, Helpers.SolidImage(4, 4, 200, 100, 50, 255), Gamut.Srgb),
            new ImageInput(8, 4, Helpers.HorizontalGradient(8, 4), Gamut.DisplayP3),
            new ImageInput(4, 8, Helpers.SolidImage(4, 8, 30, 200, 120, 128), Gamut.AdobeRgb),
            new ImageInput(16, 16, Helpers.VerticalGradient(16, 16), Gamut.Bt2020),
            new ImageInput(1, 1, Helpers.SolidImage(1, 1, 255, 0, 0, 255), Gamut.ProPhotoRgb),
        };

    private static CH[] EncodeSerial(IReadOnlyList<ImageInput> items)
    {
        var output = new CH[items.Count];
        for (int i = 0; i < items.Count; i++)
            output[i] = CH.Encode(items[i].Width, items[i].Height, items[i].Rgba, items[i].Gamut);
        return output;
    }

    [Fact]
    public void BatchMatchesSerial()
    {
        var items = MixedItems();
        using var encoder = new BatchEncoder();
        var batch = encoder.EncodeBatch(items);
        var serial = EncodeSerial(items);
        Assert.Equal(serial.Length, batch.Length);
        for (int i = 0; i < items.Count; i++)
            Assert.Equal(serial[i], batch[i]);
    }

    [Fact]
    public void BatchPreservesOrder()
    {
        // Many same-shape items to exercise out-of-order completion.
        var items = new List<ImageInput>();
        for (int i = 0; i < 64; i++)
            items.Add(
                new ImageInput(
                    8,
                    8,
                    Helpers.SolidImage(8, 8, (byte)i, (byte)(255 - i), (byte)(i * 3), 255),
                    Gamut.Srgb
                )
            );
        using var encoder = new BatchEncoder(4);
        var batch = encoder.EncodeBatch(items);
        var serial = EncodeSerial(items);
        for (int i = 0; i < items.Count; i++)
            Assert.Equal(serial[i], batch[i]);
    }

    [Fact]
    public void EmptyBatchReturnsEmpty()
    {
        using var encoder = new BatchEncoder();
        Assert.Empty(encoder.EncodeBatch(new List<ImageInput>()));
    }

    [Fact]
    public void ReusableAcrossBatches()
    {
        var items = MixedItems();
        using var encoder = new BatchEncoder();
        var first = encoder.EncodeBatch(items);
        var second = encoder.EncodeBatch(items);
        for (int i = 0; i < items.Count; i++)
            Assert.Equal(first[i], second[i]);
    }

    [Fact]
    public void InvalidItemThrowsWithIndex()
    {
        using var encoder = new BatchEncoder();
        var items = new List<ImageInput>
        {
            new(2, 2, Helpers.SolidImage(2, 2, 0, 0, 0, 255), Gamut.Srgb),
            new(2, 2, new byte[3], Gamut.Srgb), // wrong length
        };
        var ex = Assert.Throws<ArgumentException>(() => encoder.EncodeBatch(items));
        Assert.Contains("item 1", ex.Message);
    }

    [Fact]
    public void DisposedEncoderThrows()
    {
        var encoder = new BatchEncoder();
        encoder.Dispose();
        Assert.Throws<ObjectDisposedException>(() =>
            encoder.EncodeBatch(new List<ImageInput>())
        );
    }
}
