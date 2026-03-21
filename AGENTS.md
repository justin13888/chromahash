# chromahash

Modern, high-quality image placeholder representation for professional formats (LQIP).

This is a **monorepo** with six language implementations of the same format specification.

## Development

Language tooling is mostly managed by `mise` and common commands are run via `just`.

## Implementation Notes

- All six implementations MUST produce identical output for the same input — the spec in `spec/` is the source of truth
- Use strict TypeScript — no `any` types
- Rust: `#![deny(warnings)]` on public crates once stable
- Kotlin: Kotlin DSL only (`.gradle.kts`), target JVM 21
- Swift: Swift 6 concurrency model, no `@unchecked Sendable` hacks
- Write tests for all public API surface and ensure they are consistent across languages and validates the specification in `spec/` completely
- Go: zero external dependencies, all math uses `float64`, use `roundHalfAwayFromZero` (not `math.Round`)
- Use conventional commits: `type(scope): description` — scope = `rust`, `ts`, `kotlin`, `swift`, `go`, `py`, or `spec`
- Keep implementations in sync — a feature in one language should land in all six
- Python: zero external runtime dependencies, use `round_half_away_from_zero` (not Python's built-in `round()`), use Ruff for both formatting and linting

## Architecture

Each sub-project is an independent library implementing the chromahash LQIP format:
- **Encoding**: convert an image into a compact placeholder representation
- **Decoding**: reconstruct a low-fidelity preview from the placeholder
- **Format spec**: defined in `spec/` — all implementations must pass the same test vectors

## MANDATORY: Use td for Task Management

Run td usage --new-session at conversation start (or after /clear). This tells you what to work on next.

Sessions are automatic (based on terminal/agent context). Optional:
- td session "name" to label the current session
- td session --new to force a new session in the same context

Use td usage -q after first read.
