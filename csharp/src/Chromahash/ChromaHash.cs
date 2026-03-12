namespace ChromaHash;

/// <summary>ChromaHash: a 32-byte LQIP (Low Quality Image Placeholder).</summary>
public sealed class ChromaHash : IEquatable<ChromaHash>
{
    private readonly byte[] _hash;

    private ChromaHash(byte[] hash)
    {
        _hash = hash;
    }

    /// <summary>
    /// Encode an image into a ChromaHash.
    /// </summary>
    /// <param name="width">Image width (1–100).</param>
    /// <param name="height">Image height (1–100).</param>
    /// <param name="rgba">Pixel data in RGBA format (4 bytes per pixel, row-major).</param>
    /// <param name="gamut">Source color space.</param>
    public static ChromaHash Encode(uint width, uint height, byte[] rgba, Gamut gamut) =>
        new(Encoder.Encode(width, height, rgba, gamut));

    /// <summary>Decode a ChromaHash into an RGBA image. Returns (width, height, rgba_pixels).</summary>
    public (uint Width, uint Height, byte[] Rgba) Decode()
    {
        var (w, h, rgba) = Decoder.Decode(_hash);
        return (w, h, rgba);
    }

    /// <summary>Extract the average color without full decode. Returns [r, g, b, a] as byte values.</summary>
    public byte[] AverageColor() => Decoder.AverageColor(_hash);

    /// <summary>Create a ChromaHash from raw 32-byte data.</summary>
    public static ChromaHash FromBytes(byte[] data)
    {
        if (data.Length != 32)
            throw new ArgumentException("ChromaHash requires exactly 32 bytes", nameof(data));
        byte[] copy = new byte[32];
        data.CopyTo(copy, 0);
        return new ChromaHash(copy);
    }

    /// <summary>Get the raw 32-byte hash data.</summary>
    public byte[] AsBytes()
    {
        byte[] copy = new byte[32];
        _hash.CopyTo(copy, 0);
        return copy;
    }

    public bool Equals(ChromaHash? other)
    {
        if (other is null)
            return false;
        return _hash.AsSpan().SequenceEqual(other._hash);
    }

    public override bool Equals(object? obj) => obj is ChromaHash other && Equals(other);

    public override int GetHashCode()
    {
        var hc = new HashCode();
        foreach (byte b in _hash)
            hc.Add(b);
        return hc.ToHashCode();
    }

    public static bool operator ==(ChromaHash? left, ChromaHash? right) =>
        left?.Equals(right) ?? right is null;

    public static bool operator !=(ChromaHash? left, ChromaHash? right) => !(left == right);
}
