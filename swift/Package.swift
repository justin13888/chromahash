// swift-tools-version: 6.0
import PackageDescription

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
        .target(name: "ChromaHash"),
        .executableTarget(
            name: "ChromaHashCLI",
            dependencies: ["ChromaHash"]
        ),
        .executableTarget(
            name: "ChromaHashBatchBench",
            dependencies: ["ChromaHash"]
        ),
        .testTarget(
            name: "ChromaHashTests",
            dependencies: ["ChromaHash"]
        ),
    ]
)
