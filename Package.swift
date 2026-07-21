// swift-tools-version: 6.0
import Foundation
import PackageDescription

// ChromaHash for Swift is a thin facade over UniFFI-generated bindings to the Rust
// core (no native algorithm). This manifest lives at the repo ROOT — SwiftPM and
// the Swift Package Index only resolve a package whose manifest is at the root, so
// `github.com/visualcommons/chromahash` would not resolve with it under swift/. The
// sources still live under swift/ (see each target's `path:`).
//
// The native code ships as ChromaHashFFI.xcframework:
//   • local dev / CI build it from the current source with `just swift-cbuild` and
//     select it by setting CHROMAHASH_LOCAL_XCFRAMEWORK (so unreleased changes are
//     testable);
//   • released consumers download the prebuilt, checksum-pinned xcframework attached
//     to the matching GitHub release (the .binaryTarget url/checksum below are
//     pinned per release by .github/workflows/release-swift.yml).
let ffiTarget: Target =
    if ProcessInfo.processInfo.environment["CHROMAHASH_LOCAL_XCFRAMEWORK"] != nil {
        .binaryTarget(
            name: "chromahash_uniffiFFI",
            path: "swift/ChromaHashFFI.xcframework"
        )
    } else {
        .binaryTarget(
            name: "chromahash_uniffiFFI",
            url: "https://github.com/visualcommons/chromahash/releases/download/v0.6.0/ChromaHashFFI.xcframework.zip",
            checksum: "0000000000000000000000000000000000000000000000000000000000000000"
        )
    }

let package = Package(
    name: "ChromaHash",
    // `Synchronization.Mutex` (used by BatchEncoder) requires these minimums on
    // Apple platforms. No effect on Linux, where `Mutex` is always available.
    platforms: [
        .macOS(.v15),
        .iOS(.v18),
        .tvOS(.v18),
        .watchOS(.v11),
        .visionOS(.v2),
    ],
    products: [
        .library(name: "ChromaHash", targets: ["ChromaHash"]),
        .executable(name: "ChromaHashCLI", targets: ["ChromaHashCLI"]),
        .executable(name: "ChromaHashBatchBench", targets: ["ChromaHashBatchBench"]),
    ],
    targets: [
        // The Rust core's UniFFI scaffolding: static lib + C header/modulemap.
        ffiTarget,
        // UniFFI-generated Swift bindings (import the public ChromaHash facade, not this).
        .target(
            name: "ChromaHashBindings",
            dependencies: [.target(name: "chromahash_uniffiFFI")],
            path: "swift/Sources/ChromaHashBindings"
        ),
        // Public API: a thin facade preserving the idiomatic Swift surface.
        .target(
            name: "ChromaHash",
            dependencies: ["ChromaHashBindings"],
            path: "swift/Sources/ChromaHash"
        ),
        .executableTarget(
            name: "ChromaHashCLI",
            dependencies: ["ChromaHash"],
            path: "swift/Sources/ChromaHashCLI"
        ),
        .executableTarget(
            name: "ChromaHashBatchBench",
            dependencies: ["ChromaHash"],
            path: "swift/Sources/ChromaHashBatchBench"
        ),
        .testTarget(
            name: "ChromaHashTests",
            dependencies: ["ChromaHash"],
            path: "swift/Tests/ChromaHashTests"
        ),
    ]
)
