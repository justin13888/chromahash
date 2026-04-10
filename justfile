# chromahash justfile — cross-language task runner
# Run `just` to see available recipes.

default:
    @just --list

# ─── All languages ───────────────────────────────────────────────────────────

# Format all implementations
[parallel]
format: format-rust format-ts format-kotlin format-swift format-go format-python format-csharp format-compare

# Lint all implementations
[parallel]
lint: lint-rust lint-ts lint-kotlin lint-swift lint-go lint-python lint-csharp lint-compare

# Auto-fix formatting in all implementations
[parallel]
format-fix: format-fix-rust format-fix-ts format-fix-kotlin format-fix-swift format-fix-go format-fix-python format-fix-csharp format-fix-compare

# Auto-fix linting in all implementations
[parallel]
lint-fix: lint-fix-rust lint-fix-ts lint-fix-kotlin lint-fix-swift lint-fix-go lint-fix-python lint-fix-csharp lint-fix-compare

# Run all tests
[parallel]
test: test-rust test-ts test-kotlin test-swift test-go test-python test-csharp

# Build all implementations
[parallel]
build: build-rust build-ts build-kotlin build-swift build-go build-python build-csharp

# Check formatting (no writes) across all implementations
[parallel]
format-check: format-check-rust format-check-ts format-check-kotlin format-check-swift format-check-go format-check-python format-check-csharp format-check-compare

# ─── Comparison tool ────────────────────────────────────────────────────────

format-compare:
    mise exec -- pnpm --prefix tools/comparison run format

format-fix-compare: format-compare

format-check-compare:
    mise exec -- pnpm --prefix tools/comparison run format:check

lint-compare:
    mise exec -- pnpm --prefix tools/comparison run lint

lint-fix-compare:
    mise exec -- pnpm --prefix tools/comparison run lint:fix

# Build the comparison tool
build-compare:
    mise exec -- pnpm --prefix tools/comparison run build

# Run the visual comparison (generates HTML report)
compare: build-compare
    mise exec -- pnpm --prefix tools/comparison run compare

# ─── Benchmark ──────────────────────────────────────────────────────────────

# Build benchmark harnesses (release mode)
build-benchmark:
    cargo build --manifest-path rust/Cargo.toml --release --example encode_stdin
    mise exec node@24 -- pnpm --prefix typescript run build
    cd go && go build -o encode-stdin ./cmd/encode-stdin
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd kotlin && ./gradlew installDist -q'
    cd swift && mise exec swift@6.2.4 -- swift build -c release
    mise exec dotnet@9 -- dotnet build csharp/src/Chromahash.Cli -c Release --verbosity quiet

# Run performance benchmark
benchmark: build-benchmark
    cd tools/benchmark && uv run benchmark.py

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
    cargo clippy --manifest-path rust/Cargo.toml -- -D warnings

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

# ─── C# ──────────────────────────────────────────────────────────────────────

format-csharp:
    mise exec dotnet@9 -- dotnet format csharp/Chromahash.sln --verbosity quiet

format-fix-csharp: format-csharp

format-check-csharp:
    mise exec dotnet@9 -- dotnet format csharp/Chromahash.sln --verify-no-changes --verbosity quiet

lint-csharp:
    mise exec dotnet@9 -- dotnet build csharp/Chromahash.sln -warnaserror --verbosity quiet

lint-fix-csharp: lint-csharp

test-csharp:
    mise exec dotnet@9 -- dotnet test csharp/Chromahash.sln --verbosity quiet

build-csharp:
    mise exec dotnet@9 -- dotnet build csharp/Chromahash.sln --verbosity quiet
