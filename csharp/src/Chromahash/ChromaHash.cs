namespace ChromaHash;

/// <summary>ChromaHash: a 32-byte LQIP (Low Quality Image Placeholder).</summary>
/// <remarks>
/// A thin managed wrapper over the chromahash-c C ABI (which exposes the Rust
/// core via P/Invoke). Output is byte-identical to every other ChromaHash
/// implementation. The hash is held as a 32-byte value; native handles are
/// created transiently per operation.
/// </remarks>
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
    /// <param name="width">Image width (>= 1).</param>
    /// <param name="height">Image height (>= 1).</param>
    /// <param name="rgba">Pixel data in RGBA format (4 bytes per pixel, row-major).</param>
    /// <param name="gamut">Source color space.</param>
    public static ChromaHash Encode(uint width, uint height, byte[] rgba, Gamut gamut)
    {
        ArgumentNullException.ThrowIfNull(rgba);
        var status = Native.chromahash_encode(
            width,
            height,
            rgba,
            (nuint)rgba.Length,
            gamut,
            out IntPtr handle
        );
        ThrowOnEncodeError(status, nameof(width));
        try
        {
            byte[] hash = new byte[32];
            var st = Native.chromahash_as_bytes(handle, hash, 32);
            if (st != Native.Status.Ok)
                throw new InvalidOperationException($"chromahash as_bytes failed: {st}");
            return new ChromaHash(hash);
        }
        finally
        {
            Native.chromahash_free(handle);
        }
    }

    /// <summary>
    /// Decode a ChromaHash into an RGBA image in the given output gamut
    /// (Srgb / DisplayP3 / AdobeRgb; others fall back to sRGB).
    /// Returns (width, height, rgba_pixels).
    /// </summary>
    public (uint Width, uint Height, byte[] Rgba) Decode(Gamut output = Gamut.Srgb)
    {
        IntPtr handle = CreateHandle();
        try
        {
            var st = Native.chromahash_decode_to(handle, output, out Native.Image img);
            if (st != Native.Status.Ok)
                throw new InvalidOperationException($"chromahash decode failed: {st}");
            return ReadImage(ref img);
        }
        finally
        {
            Native.chromahash_free(handle);
        }
    }

    /// <summary>
    /// Decode a ChromaHash into an RGBA image, capped at the given maximum
    /// dimensions, in the given output gamut. Returns (width, height, rgba_pixels).
    /// </summary>
    public (uint Width, uint Height, byte[] Rgba) DecodeCapped(
        uint maxWidth, uint maxHeight, Gamut output = Gamut.Srgb)
    {
        IntPtr handle = CreateHandle();
        try
        {
            var st = Native.chromahash_decode_capped_to(handle, maxWidth, maxHeight, output, out Native.Image img);
            if (st != Native.Status.Ok)
                throw new InvalidOperationException($"chromahash decode_capped failed: {st}");
            return ReadImage(ref img);
        }
        finally
        {
            Native.chromahash_free(handle);
        }
    }

    /// <summary>Extract the average color without full decode. Returns [r, g, b, a] as byte values.</summary>
    public byte[] AverageColor()
    {
        IntPtr handle = CreateHandle();
        try
        {
            var st = Native.chromahash_average_color(handle, out Native.Color c);
            if (st != Native.Status.Ok)
                throw new InvalidOperationException($"chromahash average_color failed: {st}");
            return [c.R, c.G, c.B, c.A];
        }
        finally
        {
            Native.chromahash_free(handle);
        }
    }

    /// <summary>
    /// Whether this hash uses the v0.6 bitstream this library implements. Decoding
    /// an unsupported (legacy) hash produces garbage, not an error — check this
    /// first for hashes of unknown provenance.
    /// </summary>
    public bool IsVersionSupported()
    {
        IntPtr handle = CreateHandle();
        try
        {
            return Native.chromahash_is_version_supported(handle);
        }
        finally
        {
            Native.chromahash_free(handle);
        }
    }

    /// <summary>Create a ChromaHash from raw 32-byte data.</summary>
    public static ChromaHash FromBytes(byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);
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

    // ── internals ──────────────────────────────────────────────────────────────

    private IntPtr CreateHandle()
    {
        var status = Native.chromahash_from_bytes(_hash, (nuint)_hash.Length, out IntPtr handle);
        if (status != Native.Status.Ok || handle == IntPtr.Zero)
            throw new InvalidOperationException($"chromahash from_bytes failed: {status}");
        return handle;
    }

    private static (uint Width, uint Height, byte[] Rgba) ReadImage(ref Native.Image img)
    {
        try
        {
            int n = (int)img.RgbaLen;
            byte[] rgba = new byte[n];
            if (n > 0)
                System.Runtime.InteropServices.Marshal.Copy(img.Rgba, rgba, 0, n);
            return (img.Width, img.Height, rgba);
        }
        finally
        {
            Native.chromahash_image_free(ref img);
        }
    }

    private static void ThrowOnEncodeError(Native.Status status, string paramName)
    {
        switch (status)
        {
            case Native.Status.Ok:
                return;
            case Native.Status.InvalidDimensions:
                throw new ArgumentOutOfRangeException(paramName, "width and height must be >= 1");
            case Native.Status.InvalidLength:
                throw new ArgumentException("rgba length must equal width * height * 4", paramName);
            case Native.Status.NullPointer:
                throw new ArgumentNullException(paramName);
            default:
                throw new InvalidOperationException($"chromahash encode failed: {status}");
        }
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
