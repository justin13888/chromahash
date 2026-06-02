# chromahash

> Modern, high-quality image placeholder representation for professional formats (LQIP)

chromahash is a multi-language library implementing a compact, high-fidelity Low Quality Image Placeholder (LQIP) format. All seven implementations are spec-compatible — identical input produces identical output across languages.

## Implementations

| Language   | Directory        | Runtime / Build     | Status |
| ---------- | ---------------- | ------------------- | ------ |
| Rust       | [`rust/`]        | Cargo (stable)      | WIP    |
| TypeScript | [`typescript/`]  | Node 24 + pnpm      | WIP    |
| Kotlin     | [`kotlin/`]      | Gradle 9.4 + JDK 21 | WIP    |
| Swift      | [`swift/`]       | SPM (Swift 6.2)     | WIP    |
| Go         | [`go/`]          | Go 1.24             | WIP    |
| Python     | [`python/`]      | Python 3.13 + uv    | WIP    |
| C#         | [`csharp/`]      | .NET 9              | WIP    |

The canonical format is defined in [`spec/`](spec/).

## Bindings

| Target  | Directory             | What it is                                                               |
| ------- | --------------------- | ------------------------------------------------------------------------ |
| Android | [`bindings/android/`] | UniFFI binding crate + Gradle library module — the Rust core as a Kotlin AAR over JNI, for fast placeholder decoding on-device |

## Guides

- [Decoding on Android](docs/android.md) — how the [`bindings/android/`] AAR wraps the native Rust core for fast, SIMD-ready placeholder decoding

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

# Kotlin (pre-cache Gradle dependencies)
cd kotlin && ./gradlew dependencies

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
just benchmark  # run performance benchmark
just changelog  # regenerate the [Unreleased] CHANGELOG section from commits
just release X.Y.Z # cut a release section in the CHANGELOG (see RELEASING.md)
```

### Per-language commands

```bash
just format-check-rust   / just format-fix-rust   / just lint-rust   / just test-rust   / just build-rust
just format-check-ts     / just format-fix-ts     / just lint-ts     / just test-ts     / just build-ts
just format-check-kotlin / just format-fix-kotlin / just lint-kotlin / just test-kotlin / just build-kotlin
just format-check-swift  / just format-fix-swift  / just lint-swift  / just test-swift  / just build-swift
just format-check-go     / just format-fix-go     / just lint-go     / just test-go     / just build-go
just format-check-python / just format-fix-python / just lint-python / just test-python / just build-python
just format-check-csharp / just format-fix-csharp / just lint-csharp / just test-csharp / just build-csharp
```

### Formatting & linting tools

| Language   | Formatter      | Linter                    |
| ---------- | -------------- | ------------------------- |
| Rust       | rustfmt        | Clippy                    |
| TypeScript | Biome          | Biome                     |
| Kotlin     | ktlint         | ktlint                    |
| Swift      | swift-format   | swift-format              |
| Go         | gofmt          | go vet                    |
| Python     | Ruff           | Ruff                      |
| C#         | dotnet-format  | build -warnaserror        |

## Git hooks

[Lefthook](https://github.com/evilmartians/lefthook) enforces code quality via three hooks:

| Hook         | Action                                                       |
| ------------ | ------------------------------------------------------------ |
| `commit-msg` | Lint the commit message as a conventional commit (convco)    |
| `pre-commit` | Auto-fix formatting and linting on staged files              |
| `pre-push`   | Check formatting, linting (no fix), and run tests            |

## CI

GitHub Actions runs a separate workflow per language, triggered only when files in that implementation's directory change. One repo-wide workflow, [ci-commits](.github/workflows/ci-commits.yml), runs on every PR and validates that each commit (and the PR title, for squash merges) is a conventional commit.

| Workflow                                             | Trigger path        |
| ---------------------------------------------------- | ------------------- |
| [ci-commits](.github/workflows/ci-commits.yml)       | all PRs             |
| [ci-rust](.github/workflows/ci-rust.yml)             | `rust/**`           |
| [ci-typescript](.github/workflows/ci-typescript.yml) | `typescript/**`     |
| [ci-kotlin](.github/workflows/ci-kotlin.yml)         | `kotlin/**`         |
| [ci-swift](.github/workflows/ci-swift.yml)           | `swift/**`          |
| [ci-go](.github/workflows/ci-go.yml)                 | `go/**`             |
| [ci-python](.github/workflows/ci-python.yml)         | `python/**`         |
| [ci-csharp](.github/workflows/ci-csharp.yml)         | `csharp/**`         |
| [ci-android](.github/workflows/ci-android.yml)       | `bindings/android/**` |

Each per-language workflow runs format check, lint, and tests. `ci-android` additionally cross-compiles the native ABIs and assembles the AAR.

## Project structure

```
chromahash/
├── rust/               # Rust implementation (Cargo library crate)
├── typescript/         # TypeScript implementation (pnpm + Biome)
├── kotlin/             # Kotlin implementation (Gradle + ktlint)
├── swift/              # Swift implementation (SPM)
├── go/                 # Go implementation (standard library only)
├── python/             # Python implementation (uv + Ruff)
├── csharp/             # C# implementation (.NET 9)
├── bindings/android/   # Android binding: UniFFI crate + Gradle library module (AAR)
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

## Conventions

- All seven implementations **must** produce identical output for the same input — [`spec/`](spec/) is the source of truth
- Strict TypeScript — no `any` types
- Kotlin DSL only (`.gradle.kts`), target JVM 21
- Swift 6 concurrency model, no `@unchecked Sendable` hacks
- Go: zero external dependencies, all math uses `float64`, use `roundHalfAwayFromZero`
- Python: zero external runtime dependencies, use `round_half_away_from_zero`, use Ruff for formatting and linting
- Write tests for all public API surface
- Use [conventional commits](https://www.conventionalcommits.org/): `type(scope): description` — enforced by the `commit-msg` hook and the `ci-commits` workflow (convco)
  - scope = `rust`, `ts`, `kotlin`, `swift`, `go`, `py`, `csharp`, `android`, `spec`, `tools`, or `comparison`
- The CHANGELOG's `[Unreleased]` section is generated from commits by `just changelog` (git-cliff) — don't hand-edit it except to add `Removed` entries (see [RELEASING.md](RELEASING.md))
- Keep implementations in sync — a feature in one language should land in all seven

## License

Licensed under either of:

- [MIT License](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

at your option.
