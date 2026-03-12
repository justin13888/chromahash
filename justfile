# chromahash justfile — cross-language task runner
# Run `just` to see available recipes.

default:
    @just --list

# ─── All languages ───────────────────────────────────────────────────────────

# Format all implementations
format: format-rust format-ts format-kotlin format-swift format-go format-python

# Lint all implementations
lint: lint-rust lint-ts lint-kotlin lint-swift lint-go lint-python

# Auto-fix formatting in all implementations
format-fix: format-fix-rust format-fix-ts format-fix-kotlin format-fix-swift format-fix-go format-fix-python

# Auto-fix linting in all implementations
lint-fix: lint-fix-rust lint-fix-ts lint-fix-kotlin lint-fix-swift lint-fix-go lint-fix-python

# Run all tests
test: test-rust test-ts test-kotlin test-swift test-go test-python

# Build all implementations
build: build-rust build-ts build-kotlin build-swift build-go build-python

# Check formatting (no writes) across all implementations
format-check: format-check-rust format-check-ts format-check-kotlin format-check-swift format-check-go format-check-python

# ─── Rust ────────────────────────────────────────────────────────────────────

format-rust:
    cargo fmt --manifest-path rust/Cargo.toml

format-fix-rust: format-rust

format-check-rust:
    cargo fmt --manifest-path rust/Cargo.toml --check

lint-rust:
    cargo clippy --manifest-path rust/Cargo.toml -- -D warnings

lint-fix-rust:
    cargo clippy --manifest-path rust/Cargo.toml --fix --allow-staged --allow-dirty

test-rust:
    cargo test --manifest-path rust/Cargo.toml

build-rust:
    cargo build --manifest-path rust/Cargo.toml

# ─── TypeScript ──────────────────────────────────────────────────────────────

format-ts:
    mise exec node@24 -- pnpm --prefix typescript run format

format-fix-ts: format-ts

format-check-ts:
    mise exec node@24 -- pnpm --prefix typescript run format:check

lint-ts:
    mise exec node@24 -- pnpm --prefix typescript run lint

lint-fix-ts:
    mise exec node@24 -- pnpm --prefix typescript run lint:fix

test-ts:
    mise exec node@24 -- pnpm --prefix typescript run test

build-ts:
    mise exec node@24 -- pnpm --prefix typescript run build

# ─── Kotlin ──────────────────────────────────────────────────────────────────

format-kotlin:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd kotlin && ./gradlew ktlintFormat'

format-fix-kotlin: format-kotlin

format-check-kotlin:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd kotlin && ./gradlew ktlintCheck'

lint-kotlin:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd kotlin && ./gradlew ktlintCheck'

lint-fix-kotlin: format-kotlin

test-kotlin:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd kotlin && ./gradlew test'

build-kotlin:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd kotlin && ./gradlew build'

# ─── Swift ───────────────────────────────────────────────────────────────────

format-swift:
    @command -v swift-format >/dev/null 2>&1 && (cd swift && swift-format format -i -r Sources Tests) || echo "swift-format not found, skipping"

format-fix-swift: format-swift

format-check-swift:
    @command -v swift-format >/dev/null 2>&1 && (cd swift && swift-format lint -r Sources Tests) || echo "swift-format not found, skipping"

lint-swift: format-check-swift

lint-fix-swift: format-swift

test-swift:
    cd swift && mise exec swift@6.2.4 -- swift test

build-swift:
    cd swift && mise exec swift@6.2.4 -- swift build

# ─── Go ──────────────────────────────────────────────────────────────────────

format-go:
    cd go && gofmt -w .

format-fix-go: format-go

format-check-go:
    cd go && test -z "$(gofmt -l .)"

lint-go:
    cd go && go vet ./...

lint-fix-go: lint-go

test-go:
    cd go && go test ./... -v

build-go:
    cd go && go build ./...

# ─── Python ──────────────────────────────────────────────────────────────────

format-python:
    cd python && uv run ruff format .

format-fix-python: format-python

format-check-python:
    cd python && uv run ruff format --check .

lint-python:
    cd python && uv run ruff check .

lint-fix-python:
    cd python && uv run ruff check --fix .

test-python:
    cd python && uv run pytest tests/ -v

build-python:
    cd python && uv build
