# chromahash

## MANDATORY: Use td for Task Management

Run td usage --new-session at conversation start (or after /clear). This tells you what to work on next.

Sessions are automatic (based on terminal/agent context). Optional:
- td session "name" to label the current session
- td session --new to force a new session in the same context

Use td usage -q after first read.

Modern, high-quality image placeholder representation for professional formats (LQIP).

This is a **monorepo** with six language implementations of the same format specification.

## Tech Stack

| Language   | Runtime / Build Tool | Formatter      | Linter       |
| ---------- | -------------------- | -------------- | ------------ |
| Rust       | Cargo (stable)       | rustfmt        | Clippy       |
| TypeScript | Node 24 + pnpm       | Biome          | Biome        |
| Kotlin     | Gradle 9.4 + JDK 21  | ktlint         | ktlint       |
| Swift      | SPM (Swift 6.2)      | swift-format   | swift-format |
| Go         | go 1.24              | gofmt          | go vet       |
| Python     | Python 3.13 + uv     | Ruff           | Ruff         |

Tool versions are pinned in `.mise.toml`. Use `mise install` to get all of them.

## Project Structure

```
chromahash/
├── rust/               # Rust implementation (Cargo library crate)
├── typescript/         # TypeScript implementation (pnpm + Biome)
├── kotlin/             # Kotlin implementation (Gradle + ktlint)
├── swift/              # Swift implementation (SPM)
├── go/                 # Go implementation (standard library only)
├── python/             # Python implementation (uv + Ruff)
├── spec/               # Format specification
├── .github/workflows/  # Per-language GitHub Actions CI
├── justfile            # Cross-language task runner
├── lefthook.yml        # Git hooks (pre-commit fix, pre-push check)
├── .mise.toml          # Pinned tool versions
├── LICENSE             # Dual license notice
├── LICENSE-MIT         # MIT license
├── LICENSE-APACHE      # Apache 2.0 license
└── AGENTS.md           # This file (CLAUDE.md symlinks here)
```

## Development

### Setup

```bash
mise install          # install all pinned tools
lefthook install      # activate git hooks
cd typescript && pnpm install
cd kotlin && ./gradlew dependencies
cd python && uv sync
```

### Cross-language commands (via just)

```bash
just              # list all recipes
just format       # format all
just lint         # lint all
just test         # test all
just build        # build all
just format-fix   # auto-fix formatting everywhere
just lint-fix     # auto-fix lint errors everywhere
```

### Per-language commands

```bash
just format-rust   / lint-rust   / test-rust   / build-rust
just format-ts     / lint-ts     / test-ts     / build-ts
just format-kotlin / lint-kotlin / test-kotlin / build-kotlin
just format-swift  / lint-swift  / test-swift  / build-swift
just format-go     / lint-go     / test-go     / build-go
just format-python / lint-python / test-python / build-python
```

## Conventions

- All six implementations MUST produce identical output for the same input — the spec in `spec/` is the source of truth
- Use strict TypeScript — no `any` types
- Rust: `#![deny(warnings)]` on public crates once stable
- Kotlin: Kotlin DSL only (`.gradle.kts`), target JVM 21
- Swift: Swift 6 concurrency model, no `@unchecked Sendable` hacks
- Write tests for all public API surface
- Go: zero external dependencies, all math uses `float64`, use `roundHalfAwayFromZero` (not `math.Round`)
- Use conventional commits: `type(scope): description` — scope = `rust`, `ts`, `kotlin`, `swift`, `go`, `py`, or `spec`
- Keep implementations in sync — a feature in one language should land in all six
- Python: zero external runtime dependencies, use `round_half_away_from_zero` (not Python's built-in `round()`), use Ruff for both formatting and linting

## Architecture

Each sub-project is an independent library implementing the chromahash LQIP format:
- **Encoding**: convert an image into a compact placeholder representation
- **Decoding**: reconstruct a low-fidelity preview from the placeholder
- **Format spec**: defined in `spec/` — all implementations must pass the same test vectors

CI runs on each implementation independently, triggered only when files in that implementation's directory change.
