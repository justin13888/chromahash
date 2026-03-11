// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ChromaHash",
    products: [
        .library(name: "ChromaHash", targets: ["ChromaHash"]),
    ],
    targets: [
        .target(name: "ChromaHash"),
        .testTarget(
            name: "ChromaHashTests",
            dependencies: ["ChromaHash"]
        ),
    ]
)
