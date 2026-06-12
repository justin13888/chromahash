import ChromaHashBindings
import Foundation

/// Gamut identifiers for source color spaces.
public enum Gamut: Sendable {
    case sRGB
    case displayP3
    case adobeRGB
    case bt2020
    case proPhotoRGB

    /// Map to the UniFFI-generated enum that crosses the FFI.
    var binding: ChromaHashBindings.Gamut {
        switch self {
        case .sRGB: return .srgb
        case .displayP3: return .displayP3
        case .adobeRGB: return .adobeRgb
        case .bt2020: return .bt2020
        case .proPhotoRGB: return .proPhotoRgb
        }
    }
}

/// ChromaHash: a 32-byte LQIP (Low Quality Image Placeholder).
///
/// A thin facade over the UniFFI-generated bindings to the Rust core; output is
/// byte-identical to every other ChromaHash implementation. The hash is held as a
/// 32-byte value and native objects are created transiently per operation.
public struct ChromaHash: Sendable, Equatable {
    /// The raw 32-byte hash data.
    public let hash: [UInt8]

    /// Encode an image into a ChromaHash.
    ///
    /// - Parameters:
    ///   - width: image width (must be >= 1)
    ///   - height: image height (must be >= 1)
    ///   - rgba: pixel data in RGBA format (4 bytes per pixel)
    ///   - gamut: source color space
    public static func encode(width: Int, height: Int, rgba: [UInt8], gamut: Gamut) -> ChromaHash {
        precondition(width >= 1, "width must be >= 1")
        precondition(height >= 1, "height must be >= 1")
        precondition(rgba.count == width * height * 4, "rgba length mismatch")
        let obj = ChromaHashBindings.ChromaHash.encode(
            w: UInt32(width), h: UInt32(height), rgba: Data(rgba), gamut: gamut.binding)
        return ChromaHash(hash: [UInt8](obj.asBytes()))
    }

    /// Decode a ChromaHash into an RGBA image in the given output gamut
    /// (`.sRGB`, `.displayP3`, or `.adobeRGB`; others fall back to sRGB).
    /// Returns (width, height, rgba_pixels).
    public func decode(to output: Gamut = .sRGB) -> (width: Int, height: Int, rgba: [UInt8]) {
        let result = binding().decodeTo(output: output.binding)
        return (Int(result.width), Int(result.height), [UInt8](result.rgba))
    }

    /// Decode a ChromaHash into an RGBA image, capped at the given maximum
    /// dimensions, in the given output gamut. Returns (width, height, rgba_pixels).
    public func decodeCapped(maxWidth: Int, maxHeight: Int, to output: Gamut = .sRGB) -> (
        width: Int, height: Int, rgba: [UInt8]
    ) {
        let result = binding().decodeCappedTo(
            maxW: UInt32(maxWidth), maxH: UInt32(maxHeight), output: output.binding)
        return (Int(result.width), Int(result.height), [UInt8](result.rgba))
    }

    /// Extract the average color without full decode. Returns (r, g, b, a) as UInt8 values.
    public func averageColor() -> (r: UInt8, g: UInt8, b: UInt8, a: UInt8) {
        let c = binding().averageColor()
        return (UInt8(c.r), UInt8(c.g), UInt8(c.b), UInt8(c.a))
    }

    /// Whether this hash uses the v0.6 bitstream this library implements. Decoding
    /// an unsupported (legacy) hash produces garbage, not an error.
    public func isVersionSupported() -> Bool {
        return binding().isVersionSupported()
    }

    /// Create a ChromaHash from raw 32-byte data.
    public static func fromBytes(_ bytes: [UInt8]) -> ChromaHash {
        precondition(bytes.count == 32, "ChromaHash must be exactly 32 bytes")
        return ChromaHash(hash: bytes)
    }

    /// Reconstruct the UniFFI object from the stored bytes. The 32-byte value is
    /// always valid, so the fallible `fromBytes` cannot fail here.
    private func binding() -> ChromaHashBindings.ChromaHash {
        // swiftlint:disable:next force_try
        try! ChromaHashBindings.ChromaHash.fromBytes(bytes: Data(hash))
    }
}
