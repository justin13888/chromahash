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

/// ChromaHash: a compact LQIP (Low Quality Image Placeholder).
///
/// A thin facade over the UniFFI-generated bindings to the Rust core; output is
/// byte-identical to every other ChromaHash implementation. The hash is variable
/// length (32 bytes at the default quality tier) and native objects are created transiently
/// per operation.
public struct ChromaHash: Sendable, Equatable {
    /// The 21-byte compact tier — the smallest and lowest fidelity, rendered at
    /// ``defaultTier``'s resolution. Tier codes are ordered by quality (spec §2.5).
    public static let compactTier: UInt8 = 0
    /// The 32-byte tier ``encode(width:height:rgba:gamut:)`` produces. Pass this
    /// rather than a literal — a bare 0 is the compact tier.
    public static let defaultTier: UInt8 = 1
    /// The highest valid tier code; codes 5...7 are reserved.
    public static let maxTier: UInt8 = 4

    /// The raw hash bytes (32 at the default tier, more at higher tiers).
    public let hash: [UInt8]

    /// Encode an image into a default-tier (32-byte) ChromaHash.
    ///
    /// - Parameters:
    ///   - width: image width (must be >= 1)
    ///   - height: image height (must be >= 1)
    ///   - rgba: pixel data in RGBA format (4 bytes per pixel)
    ///   - gamut: source color space
    public static func encode(width: Int, height: Int, rgba: [UInt8], gamut: Gamut) -> ChromaHash {
        return encodeWithQuality(
            width: width, height: height, rgba: rgba, gamut: gamut, quality: Self.defaultTier)
    }

    /// Encode an image at an explicit quality tier (0...maxTier, ordered by
    /// quality). `defaultTier` is the 32-byte tier and `compactTier` the 21-byte
    /// one — pass those rather than a literal, since a bare 0 is the compact
    /// tier. Each higher code carries more detail in a larger hash.
    public static func encodeWithQuality(
        width: Int, height: Int, rgba: [UInt8], gamut: Gamut, quality: UInt8
    ) -> ChromaHash {
        precondition(width >= 1, "width must be >= 1")
        precondition(height >= 1, "height must be >= 1")
        precondition(rgba.count == width * height * 4, "rgba length mismatch")
        let obj = ChromaHashBindings.ChromaHash.encodeWithQuality(
            w: UInt32(width), h: UInt32(height), rgba: Data(rgba), gamut: gamut.binding,
            quality: quality)
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

    /// Create a ChromaHash from raw hash bytes. The bytes are validated lazily
    /// when the hash is used (`decode` / `averageColor` reconstruct and validate).
    public static func fromBytes(_ bytes: [UInt8]) -> ChromaHash {
        return ChromaHash(hash: bytes)
    }

    /// Reconstruct the UniFFI object from the stored bytes, validating the v1
    /// header. Traps if the stored bytes are not a valid ChromaHash.
    private func binding() -> ChromaHashBindings.ChromaHash {
        // swiftlint:disable:next force_try
        try! ChromaHashBindings.ChromaHash.fromBytes(bytes: Data(hash))
    }
}
