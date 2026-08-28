# Changelog

All notable changes to ChromaHash are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

ChromaHash is a **Draft** format. While pre-1.0, the bitstream is not guaranteed to be
stable between minor versions. From 0.7.0 the wire format carries a 3-bit `version` field
in byte 0 and a decoder rejects a generation it does not implement; before it, v0.2, v0.3
and v0.4 all shared header bit 47 = 1, so an older decoder applied to a newer hash
silently produced garbled output. Applications spanning the 0.6/0.7 boundary MUST track
the format version via producer-side metadata. See `spec/README.md` §2.5 for details.

<!-- git-cliff-unreleased-start -->
## [Unreleased]
<!-- git-cliff-unreleased-end -->

## [0.6.0] - 2026-06-13

### Added

- **comparison**: Output JSON report with standalone images
- **comparison**: Color-manage gamut metric references, add --formats filter
- **rust**: V0.6 bitstream — top-K selection, exact-zero µ-law, DC search, gamut clamp v2
- **c**: Add chromahash-c C ABI binding with cbindgen header
- **uniffi**: Expose is_version_supported and BatchEncoder
- **wasm**: Add chromahash-wasm wasm-bindgen binding
- **go**: Convert Go to a cgo wrapper over the C ABI
- **csharp**: Convert C# to a P/Invoke wrapper over the C ABI
- **swift**: Convert Swift to a UniFFI-generated binding
- **py**: Convert Python to a UniFFI-generated binding
- **ts**: Convert TypeScript to a wasm-bindgen binding + pure-TS decode
- **jvm**: Replace the pure-Kotlin port with a UniFFI JVM binding
- **comparison**: Add chromahash version-comparison report (#35)
- **rust**: Decode to a caller-chosen output gamut (sRGB/P3/Adobe)
- **comparison**: Showcase ChromaHash wide-gamut output on Display P3

### Changed

- **uniffi**: Rename bindings/android to bindings/uniffi
- **comparison**: Convert gamut→sRGB reference to gamut-color

### Fixed

- **swift**: Run tests serially to avoid the BatchEncoder deadlock
- **comparison**: Color-manage gamut originals so they match a correct decode
- **rust**: Map out-of-gamut colors by relative-colorimetric clip

### Documentation

- **spec**: Specify the v0.6 format
- Drop the redundant Architecture section from the README
- Correct decode-gamut and out-of-gamut claims in README
- Add language library/registry table to README
- **rust**: Document MSRV 1.85 in crate README
- Trim AGENTS.md to enforceable requirements
- Slim RELEASING.md to human-facing steps
- **rust**: Pin encode_stdin example to the Tunables definition
- **c**: Expand Cargo.toml rationale for edition 2021 and handwritten ABI
- **c**: Remove Layout section from README
- **go**: Add package README
- **py**: Add package README
- Update benchmark results on Apple M3 Pro


## [0.5.0] - 2026-06-10

### Added

- **rust**: Add stateful BatchEncoder with persistent thread pool
- **go**: Add BatchEncoder with owned goroutine pool
- **swift**: Add BatchEncoder with owned OperationQueue pool
- **kotlin**: Add BatchEncoder with owned ExecutorService pool
- **csharp**: Add BatchEncoder with owned thread pool
- **py**: Add serial BatchEncoder for API parity
- **ts**: Add serial BatchEncoder for API parity
- **android**: Add UniFFI binding crate, AAR module, CI, and docs
- **comparison**: Deploy report to Cloudflare Pages with commit-hash footer
- Add cross-language encode/decode benchmark vs ThumbHash (#20)
- Add native Rust ThumbHash baseline for fair algorithm comparison
- **tools**: Add --timeout flag and native ThumbHash baseline
- **comparison**: Use CIEDE2000 (via iqa-cli) as the primary quality metric
- **android**: Publish AAR to Maven Central and GitHub Packages

### Changed

- **rust**: Use precomputed cosine tables in decode
- **ts**: Precompute separable cosine tables in encode and decode
- **py**: Precompute separable cosine tables in encode and decode
- **go**: Precompute separable cosine tables in encode and decode
- **swift**: Precompute separable cosine tables in encode and decode
- **kotlin**: Precompute separable cosine tables in encode and decode
- **csharp**: Precompute separable cosine tables in encode and decode

### Documentation

- Fix LICENSE-APACHE
- Add Android integration guide
- Add chromahash benchmark results
- Add pre-v1 CHANGELOG
- Clean up README (#23)
- Highlight key features in README

### Removed

- **comparison**: Remove the in-house PSNR/DSSIM/OKLAB ΔE metrics and the normalized
  composite score; all quality metrics now come from `iqa-cli`, with CIEDE2000 (ΔE00) as
  the primary metric and every format scored at identical (source) dimensions (#26)


## [0.4.0] - 2026-05-22

v0.4 changes the coefficient scan order and `deriveGrid` and is **bitstream-incompatible
with v0.3**, despite sharing header bit 47 = 1.

### Changed
- New per-pixel frequency-priority scan order, replacing the v0.3 diagonal order.
- Adaptive `deriveGrid` now widens grids for non-square aspect ratios (e.g. 16:9 yields a
  1.8:1 grid instead of v0.3's ~1.3:1), improving layout fidelity for wide content.
- Product preservation guarantees raw AC ≥ cap for all grids, so zero-padding of
  coefficients is never required.

### Added
- Ported v0.4 to TypeScript, Python, Go, Swift, Kotlin, and C# so all six implementations
  stay in sync with the Rust reference (#15).
- Parallelized common `just` recipes and added format/lint recipes for the comparison tool.

### Fixed
- Python now uses portable math helpers for cross-language determinism.

### Removed
- Dropped `td` for task management.

## [0.3.0] - 2026-04-08

### Added
- ChromaHash v0.3 implemented across all six language implementations.
- Comparison tooling gained SSIM/DSSIM, OKLAB ΔE, and composite quality metrics.

### Changed
- Comparison adapter switched from the TypeScript v0.1 CLI to the Rust v0.2 CLI.
- Bumped version to 0.3.0 across all implementations and tools.

### Fixed
- Added a near-zero DCT threshold, corrected slice bounds, and clarified spec ambiguities.
- `averageColor` now applies `softGamutClamp` and uses portable math.
- Kotlin and Swift decoders/encoders use the adaptive `deriveGrid()`.
- Corrected pseudocode assertions and section references in the spec.

### Documentation
- Added spec §3.4 clarifying that string representation is application-defined.

## [0.2.0] - 2026-03-22

The v0.2 reference reworked the format: adaptive grids, `MAX_CHROMA` lowered from 0.5 to
0.45, soft gamut clamping, and full-resolution encoding (header bit 47 set to 1).

### Added
- Rust v0.2 reference implementation.
- C#, Python, and Go implementations of ChromaHash.
- Visual comparison tool with portable, cross-platform-deterministic math; natural test
  images from Picsum Photos; and dimensions/blur/12MP+ comparison support.
- `decode` and `average-color` subcommands across the CLI harnesses and benchmark tool.

### Changed
- Finalized the public API surface for Rust, TypeScript, and Kotlin before publishing.
- Enabled the Gradle configuration cache for Kotlin.

### Fixed
- Completed encode pseudocode and expanded the spec test vectors.
- Tightened the decode spec and added `deriveGrid` validation.

### Documentation
- Updated README and TESTING for all seven implementations.
- Explained why round-half-away-from-zero was chosen over banker's rounding.

## [0.1.0] - 2026-03-12

### Added
- Initial ChromaHash encode/decode implementations across the first four languages.
- Official format specification under `spec/`.
- Monorepo scaffolding, README, and development guide.

[Unreleased]: https://github.com/visualcommons/chromahash/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/visualcommons/chromahash/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/visualcommons/chromahash/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/visualcommons/chromahash/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/visualcommons/chromahash/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/visualcommons/chromahash/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/visualcommons/chromahash/releases/tag/v0.1.0
