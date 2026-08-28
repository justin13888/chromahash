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

### ⚠ Breaking changes

- **spec**: V1 wire format — quality-multiplier tiers + self-describing validation
- **rust**: Implement v1 format — quality tiers, variable-length hashes, fallible from_bytes
- **c**: Sync C binding to v1 wire format
- **go**: Sync Go binding to v1 variable-length hashes
- **csharp**: Sync C# binding to v1 variable-length hashes
- **uniffi**: Sync UniFFI binding crate to v1 wire format
- **jvm**: Sync JVM harness + Kotlin tests to v1
- **py**: Sync Python binding to v1 variable-length hashes
- **swift**: Sync Swift binding to v1 variable-length hashes
- **wasm**: Sync WASM binding to v1 wire format
- **rust**: Tier-0 output moves. Hashes produced by earlier v1 builds decode to different pixels; regenerate any stored placeholder.
- **rust**: Add the compact tier (code 4, 21 bytes)
- **rust**: Alpha-mode output moves at every tier, and alpha-mode byte lengths change above tier 0. Regenerate any stored alpha placeholder.
- **spec**: Normative compact tier, alpha allocation, and v0.7 stable
- **spec**: The Python reference rendered the compact tier at 512 px
- **spec**: Order the tier codes by quality
- Renumber the tier codes across every implementation
- **ts**: Port the pure-TS decoder to v1 and expose tiers
- **c**: `ChromaHashImageInput` gains a `quality` field; Go's `FromBytes` returns `(ChromaHash, error)`; C#'s `FromBytes` throws on malformed input.
- **uniffi**: `encode`, `encodeWithQuality` and `encodeBatch` are fallible in Python, Kotlin, Swift, and TypeScript's WASM layer; Swift's `fromBytes` and Python's `from_bytes` now raise on malformed input; `ImageInput` gains a `quality` field.


### Added

- **spec**: V1 wire format — quality-multiplier tiers + self-describing validation
- **rust**: Implement v1 format — quality tiers, variable-length hashes, fallible from_bytes
- **tools**: Evaluate higher-fidelity tiers in benchmark and comparison
- **c**: Sync C binding to v1 wire format
- **go**: Sync Go binding to v1 variable-length hashes
- **csharp**: Sync C# binding to v1 variable-length hashes
- **uniffi**: Sync UniFFI binding crate to v1 wire format
- **jvm**: Sync JVM harness + Kotlin tests to v1
- **py**: Sync Python binding to v1 variable-length hashes
- **swift**: Sync Swift binding to v1 variable-length hashes
- **wasm**: Sync WASM binding to v1 wire format
- **tools**: Score against a display-resolution reference
- **rust**: Experimental quantizer and selection knobs
- **spec**: Pin the canonical BT.2020 tone mapping
- **tools**: Corpus expansion and tune/holdout split
- **tools**: Rate-distortion baselines at matched byte budgets
- **tools**: Quantizer-family and allocation sweep runner
- **tools**: Follow-up sweep configs from first results
- **tools**: Paired per-image deltas for version comparison
- **tools**: V0.6 baseline point in the R-D lineup
- **tools**: Allow a released tag as the sweep incumbent
- **rust**: Encoder-only scale fitting and nearest-reconstruction AC codes
- **tools**: Byte-budget R-D, CfL and coefficient-statistics probes
- **tools**: Content-pin the corpus and extend it to 39 photographs
- **tools**: Guard-aware cross-format scoring in the R-D ladder
- **tools**: Entropy-coding budget probe with an honest coder
- **rust**: Adopt the optimized v1 recipe as the default
- **spec**: Mirror the adopted constants in the Python reference
- **comparison**: Sweep configs for the round-2 roadmap items
- **tools**: Tier-0 R-D quality gate in CI
- **comparison**: Select the corpus a sweep measures against
- **rust**: Scope raw layout overrides to one row of the table
- **rust**: Make the alpha field widths and AC count tunable
- **comparison**: Score alpha over multiple backdrops and on its own
- **comparison**: Sweep configs for the v0.7 stabilization experiments
- **rust**: Quantize the alpha AC plane through the channel quantizer
- **comparison**: Sweep config for the alpha-channel quantizer
- **comparison**: Size-matched codecs and all four metrics in the report
- **comparison**: Show real codecs at their byte floor, not as N/A
- **comparison**: Alpha and graphics evaluation corpora
- **tools**: Just recipes for the four standalone probes
- **comparison**: ForceOpaque control, alpha AC ladder, tie-break configs
- **rust**: Add the compact tier (code 4, 21 bytes)
- **spec**: Mirror the compact tier in the Python reference
- **rust**: Fix the alpha-mode allocation
- **comparison**: Tier-1 alpha allocation sweep
- **comparison**: Declare a sweep's byte budget and enforce it
- **comparison**: Categorize the alpha and graphics corpora in the report
- Renumber the tier codes across every implementation
- **ts**: Port the pure-TS decoder to v1 and expose tiers
- **comparison**: Show every tier in the cross-format report
- **comparison**: Add the compact tier to the R-D lineup
- **tools**: Read CHROMAHASH_TIER in every encode-stdin harness
- **tools**: Benchmark every tier
- Implement preview normalization with row-based box scaling
- **tools**: Check EXPERIMENTS.md against the sweeps that produced it
- **comparison**: Report paired CIs and win counts from the sweep itself
- **c**: Finalize the v1 C-ABI surface — tier constants, batch tiers, eager from_bytes
- **uniffi**: Validate at the FFI boundary and let a batch item pick its tier

### Fixed

- **tools**: Fail without metrics and measure timing fairly
- **tools**: Add the codec-thumb and raw-pixels R-D adapters
- **tools**: Include v0.6 in the version-comparison lineup
- **tools**: Reject a quality tier for pre-v1 version builds
- **tools**: Exclude achromatic channels from the CfL probe means
- **rust**: Let the deadzone survive the nearest-reconstruction search
- **comparison**: Pin the alpha allocation in the alpha sweep configs
- **comparison**: Run the shipped tiers at the R-D byte anchors
- **spec**: The Python reference rendered the compact tier at 512 px
- **comparison**: The codec "floor" row was the codec's largest 4px output
- **tools**: Follow the tier renumbering
- **spec**: Pin the reference's K set to the default tier
- **comparison**: Bound previews to their cell
- **wasm**: The length test still assumed the pre-renumbering tier codes
- **rust**: The sweep harness defaulted to the compact tier
- **tools**: Satisfy clippy's chunks_exact_to_as_chunks in gamut-ref-stdin
- **tools**: Let `just test` run off macOS
- Bring every manifest to the core crate's 0.7.0
- **rust**: Keep the example within the declared MSRV

### Documentation

- **spec**: Fix v1 documentation drift
- **spec**: Design rationale record and future work
- **spec**: Record the measured v0.6 to v1 tier-0 cost
- **spec**: Record the v0.7 byte-budget rate-distortion study
- **spec**: Normative two-row layout, Q12 selection and encoder rules
- **spec**: Rationale for the adopted constants
- **spec**: The byte-budget study, the roadmap results and the adoption
- **spec**: The v0.7 stabilization experiments (§11)
- **spec**: Normative compact tier, alpha allocation, and v0.7 stable
- **spec**: Close the resolved rationale open questions
- **spec**: Re-measured cross-format positioning (§11.14)
- **spec**: Correct §11 against an adversarial re-check of the raw data
- **spec**: Order the tier codes by quality
- Name tiers by code, not byte budget
- **spec**: Correct EXPERIMENTS.md against the sweeps that produced it

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
