# chromahash

> Modern, high-quality image placeholder representation for professional formats (LQIP)

chromahash is a multi-language library implementing a compact, high-fidelity Low Quality Image Placeholder (LQIP) format. All nine implementations are spec-compatible — identical input produces identical output across languages.

## Packages

| Language | Package | Registry |
| -------- | ------- | -------- |
| Rust | `chromahash` | [crates.io](https://crates.io/crates/chromahash) |
| TypeScript | `@visualcommons/chromahash` | [npm](https://www.npmjs.com/package/@visualcommons/chromahash) |
| Python | `chromahash` | [PyPI](https://pypi.org/project/chromahash/) |
| C# | `ChromaHash` | [NuGet](https://www.nuget.org/packages/ChromaHash) |
| Java / Kotlin (JVM) | `io.github.visualcommons:chromahash-jvm` | [Maven Central](https://central.sonatype.com/artifact/io.github.visualcommons/chromahash-jvm) † |
| Android | `io.github.visualcommons:chromahash-android` | [Maven Central](https://central.sonatype.com/artifact/io.github.visualcommons/chromahash-android) † |
| Go | `github.com/visualcommons/chromahash/go` | [pkg.go.dev](https://pkg.go.dev/github.com/visualcommons/chromahash/go) |
| Swift | SwiftPM (`https://github.com/visualcommons/chromahash`) | [Swift Package Index](https://swiftpackageindex.com/visualcommons/chromahash) |
| C | `chromahash-c` | [source](bindings/c) (C ABI — the FFI foundation, no registry) |

> Every package is published to its registry automatically on each tagged release — see [`RELEASING.md`](RELEASING.md).
>
> The table lists where each package *publishes*, which is not the same as what
> is live today. As of 0.6.0: crates.io, PyPI, NuGet and the Go proxy are live;
> npm has not published yet (0.7.0 is the first release under the
> `@visualcommons` scope); and † the JVM/Android artifacts are still on Maven
> Central under the pre-rename `io.github.justin13888` coordinates —
> `io.github.visualcommons` takes over from 0.7.0. See
> [`RELEASING.md`](RELEASING.md#one-time-registry-bootstrap).

## Why ChromaHash?

ChromaHash is built for professional photo management at scale, where perceptual quality, layout precision, and wide-gamut correctness matter. Every claim below is defined and quantified in the [format specification](spec/).

- **Perceptual, human-centric quality.** Color is encoded in the [OKLAB](https://bottosson.github.io/posts/oklab/) perceptually-uniform color space (the same model adopted by CSS Color 4), so quantization steps map to evenly-perceived changes. AC coefficients use µ-law companding (µ=5 luma, µ=8 chroma) to spend precision where DCT energy actually clusters, a per-pixel frequency-priority scan order weights vertical and diagonal detail the way the eye does instead of biasing horizontal frequencies, and out-of-gamut colors are mapped back into the display gamut with a relative-colorimetric per-channel clip rather than hard-clipped in linear RGB.
- **Wide-gamut aware.** Encodes from sRGB, Display P3, Adobe RGB, BT.2020, or ProPhoto RGB sources into absolute OKLAB coordinates and decodes to a caller-chosen display gamut — sRGB, Display P3, or Adobe RGB — so wide-gamut color is preserved end-to-end instead of being flattened to sRGB-only like most LQIP formats.
- **Precise layout.** An 8-bit log₂ aspect ratio keeps placeholder dimensions within ~1.09% of the original across ratios up to 16:1 (vs ThumbHash's 3-bit ~7% and ~7:1). The DCT grid adaptively reshapes to the aspect ratio, so no coefficients are wasted on non-square images.
- **32 bytes by default, five tiers when you want more or less.** The default hash (tier code 1) is exactly 32 bytes — memory-aligned, cache-friendly, and a zero-overhead database column or cache key. Tier codes are ordered by quality: code 0 is a 21-byte **compact** tier at ThumbHash's footprint, and codes 2–4 quadruple the coefficient budget per step (~108/411/1623 bytes) while doubling the render resolution. The byte length is self-describing from the first byte, so there is no length framing to parse at any tier.
- **Fast decode with alpha.** Default-tier decoding runs in ~36µs native / ~182µs JS (well under 1ms), and transparent images are supported within the same 32-byte budget.
- **One core, first-class everywhere.** A single zero-dependency Rust core is exposed to every other language through thin FFI bindings (C, WebAssembly, and UniFFI), so a spec change lands once and every language stays **bit-exact** against the shared [`spec/`](spec/) test vectors. See [Appendix A of the spec](spec/README.md#appendix-a-thumbhash-comparison--acknowledgment) for the full ThumbHash comparison.

## Guides

- [Decoding on Android](docs/android.md) — how the [`bindings/uniffi/`] AAR wraps the native Rust core for fast, SIMD-ready placeholder decoding

## Setup

### Prerequisites

Install all pinned tools via [mise](https://mise.jdx.dev/):

```bash
mise install
```

This installs: Node 24, Gradle 9.4.0, Swift 6.2.4, Go 1.24, Python 3.13, .NET 9, plus the
[git-cliff](https://git-cliff.org/) (changelog) and [convco](https://convco.github.io/)
(conventional-commit lint) developer tools.

Then install per-language dependencies:

```bash
# TypeScript
cd typescript && pnpm install

# Java/Kotlin JVM (pre-cache Gradle dependencies)
cd bindings/uniffi/jvm && ./gradlew dependencies

# Python
cd python && uv sync

# C#
cd csharp && dotnet restore
```

Install git hooks:

```bash
lefthook install
```

### Tool versions

All tool versions are pinned in [`.mise.toml`](.mise.toml).

| Tool     | Version |
| -------- | ------- |
| Node.js  | 24      |
| Gradle   | 9.4.0   |
| Swift    | 6.2.4   |
| Go       | 1.24    |
| Python   | 3.13    |
| .NET     | 9       |
| git-cliff | 2.13.1 |
| convco   | 0.6.4   |

Rust is managed via [`rust/rust-toolchain.toml`](rust/rust-toolchain.toml) (stable channel).

## Development

### Cross-language commands

All commands are available via [`just`](https://github.com/casey/just):

```bash
just            # list all recipes
just format     # format all implementations
just lint       # lint all implementations
just test       # test all implementations
just build      # build all implementations
just format-fix # auto-fix formatting everywhere
just lint-fix   # auto-fix lint errors everywhere
just compare    # generate LQIP comparison report
just compare-versions # local-only: compare chromahash format versions (v0.2–v0.5 + current)
just benchmark  # run performance benchmark
just mutants-rust # mutation-test the core Rust crate (cargo-mutants; see TESTING.md)
just changelog  # regenerate the [Unreleased] CHANGELOG section from commits
just release X.Y.Z # cut a release section in the CHANGELOG (see RELEASING.md)
```

### Per-language commands

```bash
just format-check-rust   / just format-fix-rust   / just lint-rust   / just test-rust   / just build-rust
just format-check-c      / just format-fix-c      / just lint-c      / just test-c      / just build-c
just format-check-ts     / just format-fix-ts     / just lint-ts     / just test-ts     / just build-ts
just format-check-wasm   / just format-fix-wasm   / just lint-wasm   / just test-wasm   / just build-wasm
just format-check-jvm    / just format-fix-jvm    / just lint-jvm    / just test-jvm    / just build-jvm
just format-check-swift  / just format-fix-swift  / just lint-swift  / just test-swift  / just build-swift
just format-check-go     / just format-fix-go     / just lint-go     / just test-go     / just build-go
just format-check-python / just format-fix-python / just lint-python / just test-python / just build-python
just format-check-csharp / just format-fix-csharp / just lint-csharp / just test-csharp / just build-csharp
```

### Formatting & linting tools

| Language   | Formatter      | Linter                    |
| ---------- | -------------- | ------------------------- |
| Rust       | rustfmt        | Clippy                    |
| C / WASM   | rustfmt        | Clippy                    |
| TypeScript | Biome          | Biome                     |
| Java/Kotlin | ktlint        | ktlint                    |
| Swift      | swift-format   | swift-format              |
| Go         | gofmt          | go vet                    |
| Python     | Ruff           | Ruff                      |
| C#         | dotnet-format  | build -warnaserror        |

## CI

GitHub Actions runs a separate workflow per language, triggered only when files in that implementation's directory change. One repo-wide workflow, [ci-commits](.github/workflows/ci-commits.yml), runs on every PR and validates that each commit (and the PR title, for squash merges) is a conventional commit.

| Workflow                                             | Trigger path                          |
| ---------------------------------------------------- | ------------------------------------- |
| [ci-commits](.github/workflows/ci-commits.yml)       | all PRs                               |
| [ci-rust](.github/workflows/ci-rust.yml)             | `rust/**`                            |
| [ci-c](.github/workflows/ci-c.yml)                   | `bindings/c/**`, `rust/**`           |
| [ci-wasm](.github/workflows/ci-wasm.yml)             | `bindings/wasm/**`, `rust/**`        |
| [ci-typescript](.github/workflows/ci-typescript.yml) | `typescript/**`, `bindings/wasm/**`, `rust/**` |
| [ci-jvm](.github/workflows/ci-jvm.yml)               | `bindings/uniffi/**`, `rust/**`      |
| [ci-swift](.github/workflows/ci-swift.yml)           | `swift/**`, `bindings/uniffi/**`, `rust/**` |
| [ci-go](.github/workflows/ci-go.yml)                 | `go/**`, `bindings/c/**`, `rust/**`  |
| [ci-python](.github/workflows/ci-python.yml)         | `python/**`, `bindings/uniffi/**`, `rust/**` |
| [ci-csharp](.github/workflows/ci-csharp.yml)         | `csharp/**`, `bindings/c/**`, `rust/**` |
| [ci-android](.github/workflows/ci-android.yml)       | `bindings/uniffi/**`                 |

Each per-language workflow builds the binding it depends on (the C ABI, WASM, or
UniFFI lib over the Rust core) and then runs that language's format check, lint,
and tests. `ci-android` additionally cross-compiles the native ABIs and assembles the AAR.

## Project structure

```
chromahash/
├── rust/               # Rust core — the reference implementation (Cargo crate)
├── bindings/
│   ├── c/              # C ABI binding (extern "C" + cbindgen) — serves C, C#, Go
│   ├── uniffi/         # UniFFI binding — serves Swift, Java/Kotlin (jvm/ JAR + android/ AAR), Python
│   └── wasm/           # WebAssembly binding (wasm-bindgen) — serves TypeScript
├── typescript/         # TypeScript binding (WASM facade + pure-TS decode; pnpm + Biome)
├── swift/              # Swift binding (UniFFI facade; SPM)
├── go/                 # Go binding (cgo over the C ABI)
├── python/             # Python binding (UniFFI/ctypes; uv + Ruff)
├── csharp/             # C# binding (P/Invoke over the C ABI; .NET 9)
├── spec/               # Format specification and test vectors
├── docs/               # Integration guides (e.g. Android via Rust/JNI)
├── tools/              # Shared developer tooling (comparison, benchmarks)
├── .github/workflows/  # Per-language GitHub Actions CI
├── justfile            # Cross-language task runner
├── lefthook.yml        # Git hooks (commit-msg lint, pre-commit fix, pre-push check)
├── cliff.toml          # git-cliff changelog config
├── .mise.toml          # Pinned tool versions
├── CHANGELOG.md        # Keep a Changelog (Unreleased section generated by git-cliff)
├── RELEASING.md        # Release process
├── LICENSE             # Dual license notice
├── LICENSE-MIT         # MIT license
└── LICENSE-APACHE      # Apache 2.0 license
```

## License

Licensed under either of:

- [MIT License](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

at your option.
