# chromahash

> Modern, high-quality image placeholder representation for professional formats (LQIP)

chromahash is a multi-language library implementing a compact, high-fidelity Low Quality Image Placeholder (LQIP) format. All four implementations are spec-compatible — identical input produces identical output across languages.

## Implementations

| Language   | Directory      | Runtime / Build     | Status |
| ---------- | -------------- | ------------------- | ------ |
| Rust       | [`rust/`]      | Cargo (stable)      | WIP    |
| TypeScript | [`typescript/`]| Node 24 + pnpm      | WIP    |
| Kotlin     | [`kotlin/`]    | Gradle 9.4 + JDK 21 | WIP    |
| Swift      | [`swift/`]     | SPM (Swift 6.2)     | WIP    |

The canonical format is defined in [`spec/`](spec/).

## Setup

### Prerequisites

Install all pinned tools via [mise](https://mise.jdx.dev/):

```bash
mise install
```

This installs: Node 24, Gradle 9.4.0, Swift 6.2.4.

Then install per-language dependencies:

```bash
# TypeScript
cd typescript && pnpm install

# Kotlin (pre-cache Gradle dependencies)
cd kotlin && ./gradlew dependencies

# Python
cd python && uv sync
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
```

### Per-language commands

```bash
just format-rust   / just lint-rust   / just test-rust   / just build-rust
just format-ts     / just lint-ts     / just test-ts     / just build-ts
just format-kotlin / just lint-kotlin / just test-kotlin / just build-kotlin
just format-swift  / just lint-swift  / just test-swift  / just build-swift
```

### Formatting & linting tools

| Language   | Formatter    | Linter       |
| ---------- | ------------ | ------------ |
| Rust       | rustfmt      | Clippy       |
| TypeScript | Biome        | Biome        |
| Kotlin     | ktlint       | ktlint       |
| Swift      | swift-format | swift-format |

## Git hooks

[Lefthook](https://github.com/evilmartians/lefthook) enforces code quality via two hooks:

| Hook         | Action                                              |
| ------------ | --------------------------------------------------- |
| `pre-commit` | Auto-fix formatting and linting on staged files     |
| `pre-push`   | Check formatting, linting (no fix), and run tests   |

## CI

GitHub Actions runs a separate workflow per language, triggered only when files in that implementation's directory change:

| Workflow                                             | Trigger path        |
| ---------------------------------------------------- | ------------------- |
| [ci-rust](.github/workflows/ci-rust.yml)             | `rust/**`           |
| [ci-typescript](.github/workflows/ci-typescript.yml) | `typescript/**`     |
| [ci-kotlin](.github/workflows/ci-kotlin.yml)         | `kotlin/**`         |
| [ci-swift](.github/workflows/ci-swift.yml)           | `swift/**`          |

Each workflow runs format check, lint, and tests.

## Project structure

```
chromahash/
├── rust/               # Rust implementation (Cargo library crate)
├── typescript/         # TypeScript implementation (pnpm + Biome)
├── kotlin/             # Kotlin implementation (Gradle + ktlint)
├── swift/              # Swift implementation (SPM)
├── spec/               # Format specification and test vectors
├── .github/workflows/  # Per-language GitHub Actions CI
├── justfile            # Cross-language task runner
├── lefthook.yml        # Git hooks (pre-commit fix, pre-push check)
├── .mise.toml          # Pinned tool versions
├── LICENSE             # Dual license notice
├── LICENSE-MIT         # MIT license
└── LICENSE-APACHE      # Apache 2.0 license
```

## Conventions

- All four implementations **must** produce identical output for the same input — [`spec/`](spec/) is the source of truth
- Strict TypeScript — no `any` types
- Kotlin DSL only (`.gradle.kts`), target JVM 21
- Swift 6 concurrency model, no `@unchecked Sendable` hacks
- Write tests for all public API surface
- Use [conventional commits](https://www.conventionalcommits.org/): `type(scope): description`
  - scope = `rust`, `ts`, `kotlin`, `swift`, or `spec`
- Keep implementations in sync — a feature in one language should land in all four

## License

Licensed under either of:

- [MIT License](LICENSE-MIT)
- [Apache License, Version 2.0](LICENSE-APACHE)

at your option.
