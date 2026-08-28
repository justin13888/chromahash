using System.Runtime.InteropServices;

namespace ChromaHash;

/// <summary>
/// P/Invoke bindings to the chromahash-c C ABI (the cdylib that wraps the Rust
/// core). Source-generated via <see cref="LibraryImportAttribute"/>. The native
/// library is copied next to the managed assembly at build time (see
/// Chromahash.csproj) and resolved from the application directory at runtime.
/// </summary>
internal static partial class Native
{
    private const string Lib = "chromahash_c";

    /// <summary>Status codes returned by the C ABI. <c>Ok</c> is 0.</summary>
    internal enum Status
    {
        Ok = 0,
        NullPointer = 1,
        InvalidLength = 2,
        InvalidDimensions = 3,
        Internal = 4,
        InvalidData = 5,
    }

    /// <summary>Mirror of the C <c>ChromaHashImage</c> (library-owned RGBA buffer).</summary>
    [StructLayout(LayoutKind.Sequential)]
    internal struct Image
    {
        public uint Width;
        public uint Height;
        public IntPtr Rgba;
        public nuint RgbaLen;
    }

    /// <summary>Mirror of the C <c>ChromaHashColor</c>.</summary>
    [StructLayout(LayoutKind.Sequential)]
    internal struct Color
    {
        public byte R;
        public byte G;
        public byte B;
        public byte A;
    }

    [LibraryImport(Lib)]
    internal static partial Status chromahash_encode(
        uint width,
        uint height,
        [In] byte[] rgba,
        nuint rgbaLen,
        Gamut gamut,
        out IntPtr outHash
    );

    [LibraryImport(Lib)]
    internal static partial Status chromahash_encode_with_quality(
        uint width,
        uint height,
        [In] byte[] rgba,
        nuint rgbaLen,
        Gamut gamut,
        byte quality,
        out IntPtr outHash
    );

    [LibraryImport(Lib)]
    internal static partial Status chromahash_from_bytes(
        [In] byte[] bytes,
        nuint len,
        out IntPtr outHash
    );

    [LibraryImport(Lib)]
    internal static partial void chromahash_free(IntPtr hash);

    [LibraryImport(Lib)]
    internal static partial nuint chromahash_byte_len(IntPtr hash);

    [LibraryImport(Lib)]
    internal static partial Status chromahash_as_bytes(IntPtr hash, [Out] byte[] outBuf, nuint outCap);

    [LibraryImport(Lib)]
    internal static partial Status chromahash_average_color(IntPtr hash, out Color outColor);

    [LibraryImport(Lib)]
    internal static partial Status chromahash_decode(IntPtr hash, out Image outImage);

    [LibraryImport(Lib)]
    internal static partial Status chromahash_decode_to(IntPtr hash, Gamut output, out Image outImage);

    [LibraryImport(Lib)]
    internal static partial Status chromahash_decode_capped(
        IntPtr hash,
        uint maxWidth,
        uint maxHeight,
        out Image outImage
    );

    [LibraryImport(Lib)]
    internal static partial Status chromahash_decode_capped_to(
        IntPtr hash,
        uint maxWidth,
        uint maxHeight,
        Gamut output,
        out Image outImage
    );

    [LibraryImport(Lib)]
    internal static partial void chromahash_image_free(ref Image image);

    /// <summary>
    /// Read one of the C ABI's exported <c>uint8_t</c> constants
    /// (<c>CHROMAHASH_COMPACT_TIER</c> and friends) by name.
    /// </summary>
    /// <remarks>
    /// The tier codes are declared as C# <c>const</c>s on <see cref="ChromaHash"/>
    /// so they can be used in constant expressions, but the format owns them and
    /// the native ABI exports them. This is how the test suite proves the two
    /// agree; <c>LibraryImport</c> binds functions only, so the symbol is
    /// resolved by hand.
    /// </remarks>
    internal static byte ReadExportedByte(string symbol)
    {
        IntPtr lib = NativeLibrary.Load(Lib, typeof(Native).Assembly, null);
        return Marshal.ReadByte(NativeLibrary.GetExport(lib, symbol));
    }
}
