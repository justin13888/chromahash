namespace ChromaHash;

/// <summary>
/// Gamut identifiers for source color spaces. Values match the chromahash-c ABI
/// enum (and the Rust core's Gamut), so the value crosses the FFI directly.
/// </summary>
public enum Gamut
{
    Srgb,
    DisplayP3,
    AdobeRgb,
    Bt2020,
    ProPhotoRgb,
}
