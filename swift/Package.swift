// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ChromaHash",
    products: [
        .library(name: "ChromaHash", targets: ["ChromaHash"]),
        .executable(name: "ChromaHashCLI", targets: ["ChromaHashCLI"]),
    ],
    targets: [
        .target(name: "ChromaHash"),
        .executableTarget(
            name: "ChromaHashCLI",
            dependencies: ["ChromaHash"]
        ),
        .testTarget(
            name: "ChromaHashTests",
            dependencies: ["ChromaHash"]
        ),
    ]
)
