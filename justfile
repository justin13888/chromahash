# chromahash justfile — cross-language task runner
# Run `just` to see available recipes.

default:
    @just --list

# ─── All languages ───────────────────────────────────────────────────────────

# Format all implementations
[parallel]
format: format-rust format-ts format-kotlin format-swift format-go format-python format-csharp format-android format-compare format-thumbhash

# Lint all implementations
[parallel]
lint: lint-rust lint-ts lint-kotlin lint-swift lint-go lint-python lint-csharp lint-android lint-compare lint-thumbhash

# Auto-fix formatting in all implementations
[parallel]
format-fix: format-fix-rust format-fix-ts format-fix-kotlin format-fix-swift format-fix-go format-fix-python format-fix-csharp format-fix-android format-fix-compare format-fix-thumbhash

# Auto-fix linting in all implementations
[parallel]
lint-fix: lint-fix-rust lint-fix-ts lint-fix-kotlin lint-fix-swift lint-fix-go lint-fix-python lint-fix-csharp lint-fix-android lint-fix-compare lint-fix-thumbhash

# Run all tests
[parallel]
test: test-rust test-ts test-kotlin test-swift test-go test-python test-csharp test-android

# Build all implementations
[parallel]
build: build-rust build-ts build-kotlin build-swift build-go build-python build-csharp build-android-crate

# Check formatting (no writes) across all implementations
[parallel]
format-check: format-check-rust format-check-ts format-check-kotlin format-check-swift format-check-go format-check-python format-check-csharp format-check-android format-check-compare format-check-thumbhash

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

# ─── ThumbHash baseline (native Rust) ─────────────────────────────────────────
# Standalone benchmark harness crate (keeps the core chromahash crate zero-dep).

format-thumbhash:
    cargo fmt --manifest-path tools/thumbhash-rs/Cargo.toml

format-fix-thumbhash: format-thumbhash

format-check-thumbhash:
    cargo fmt --manifest-path tools/thumbhash-rs/Cargo.toml --check

lint-thumbhash:
    cargo clippy --manifest-path tools/thumbhash-rs/Cargo.toml -- -D warnings

lint-fix-thumbhash:
    cargo clippy --manifest-path tools/thumbhash-rs/Cargo.toml --fix --allow-staged --allow-dirty
    cargo clippy --manifest-path tools/thumbhash-rs/Cargo.toml -- -D warnings

# Build the comparison tool
build-compare:
    mise exec -- pnpm --prefix tools/comparison run build

# Install iqa-cli (the iqa-rs metrics CLI) — prerequisite for `compare`'s quality
# metrics. Pulls in ssimulacra2/butteraugli, which build vendored C++ (needs a C/C++
# toolchain). Without it the report still builds, but metrics show as N/A.
install-iqa:
    cargo install iqa-cli --locked --version 0.2.0

# Run the visual comparison. Emits output/report.html, output/report.json, and
# standalone images under output/images/ (the HTML and JSON both reference them).
# Requires iqa-cli on PATH for quality metrics — run `just install-iqa` once first.
compare: build-compare
    mise exec -- pnpm --prefix tools/comparison run compare

# ─── Benchmark ──────────────────────────────────────────────────────────────

# Build benchmark harnesses (release mode), incl. both ThumbHash baselines (native Rust + JS)
build-benchmark:
    cargo build --manifest-path rust/Cargo.toml --release --example encode_stdin
    mise exec node@24 -- pnpm --prefix typescript run build
    cd go && go build -o encode-stdin ./cmd/encode-stdin
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd kotlin && ./gradlew installDist -q'
    cd swift && mise exec swift@6.2.4 -- swift build -c release
    mise exec dotnet@9 -- dotnet build csharp/src/Chromahash.Cli -c Release --verbosity quiet
    cargo build --manifest-path tools/thumbhash-rs/Cargo.toml --release
    mise exec node@24 -- pnpm --prefix tools/comparison run build

# Run performance benchmark (encode/decode × single/bulk, chromahash vs ThumbHash)
benchmark: build-benchmark
    cd tools/benchmark && uv run benchmark.py --skip-build

# ─── Batch benchmarks ─────────────────────────────────────────────────────────

# Intentionally sequential — running these in parallel would skew the numbers,
# since each benchmark wants the whole machine.

# Run every BatchEncoder throughput benchmark (serial vs. batch + scaling sweep)
bench-batch: bench-batch-rust bench-batch-go bench-batch-swift bench-batch-kotlin bench-batch-csharp bench-batch-python bench-batch-ts

bench-batch-rust:
    cargo run --manifest-path rust/Cargo.toml --release --example batch_bench

bench-batch-ts:
    mise exec node@24 -- pnpm --prefix typescript run bench

bench-batch-kotlin:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd kotlin && ./gradlew bench -q'

bench-batch-swift:
    cd swift && mise exec swift@6.2.4 -- swift run -c release ChromaHashBatchBench

bench-batch-go:
    cd go && go test -bench=Encode -benchmem -run='^$' ./...

bench-batch-python:
    cd python && uv run python benchmarks/batch_bench.py

bench-batch-csharp:
    mise exec dotnet@9 -- dotnet run -c Release --project csharp/benchmarks/Chromahash.Bench

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

# ─── Android binding (chromahash-uniffi) ──────────────────────────────────────
# Host-only recipes (no Android NDK/SDK required) — wired into the aggregates so
# the lefthook gates stay green. The AAR build (`build-android-aar`) needs the NDK
# + SDK and is intentionally kept OUT of the aggregates.

format-android:
    cargo fmt --manifest-path bindings/android/Cargo.toml

format-fix-android: format-android

format-check-android:
    cargo fmt --manifest-path bindings/android/Cargo.toml --check

lint-android:
    cargo clippy --manifest-path bindings/android/Cargo.toml -- -D warnings

lint-fix-android:
    cargo clippy --manifest-path bindings/android/Cargo.toml --fix --allow-staged --allow-dirty
    cargo clippy --manifest-path bindings/android/Cargo.toml -- -D warnings

# Runs the spec test vectors through the binding (the enforced correctness gate)
test-android:
    cargo test --manifest-path bindings/android/Cargo.toml

# Host build of the binding crate (lib + cdylib + bindgen bin); no cross-compile
build-android-crate:
    cargo build --manifest-path bindings/android/Cargo.toml

# Cross-compile every ABI + generate Kotlin + assemble the AAR.
# Requires the Android NDK (ANDROID_NDK_HOME / ANDROID_NDK_LATEST_HOME) + SDK and
# the android rustup targets. cargo-ndk is mise-managed (`cargo:cargo-ndk`).
# Not part of `just build`.
build-android-aar:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd bindings/android/android && ./gradlew assembleRelease'

# ─── Android publishing bootstrap (issue #17) ─────────────────────────────────
# One-time helpers for Maven Central. Full walkthrough in RELEASING.md →
# "Publishing the Android AAR". `gpg` is the one external tool (key generation).

# Generate a GPG signing key, export it to gitignored files, upload the public key (one-time).
android-gen-signing-key email="2daegu@hopnine.com" name="Justin Chung":
    #!/usr/bin/env bash
    set -euo pipefail
    command -v gpg >/dev/null 2>&1 || { echo "gpg not found — install GnuPG (e.g. brew install gnupg)"; exit 1; }
    if [ -f signing-key.asc ]; then echo "signing-key.asc already exists — remove it first to regenerate"; exit 1; fi
    # Read a bounded chunk first, then truncate with bash — piping urandom
    # straight into `head -c 32` makes `head` close the pipe early, killing the
    # upstream reader with SIGPIPE, which `pipefail` turns into a 141 crash.
    raw="$(LC_ALL=C tr -dc 'A-Za-z0-9' < <(head -c 256 /dev/urandom))"
    pass="${raw:0:32}"
    batch="$(mktemp)"
    trap 'rm -f "$batch"' EXIT
    cat > "$batch" <<EOF
    %echo Generating ChromaHash Android signing key
    Key-Type: RSA
    Key-Length: 4096
    Subkey-Type: RSA
    Subkey-Length: 4096
    Name-Real: {{ name }}
    Name-Email: {{ email }}
    Expire-Date: 0
    Passphrase: $pass
    %commit
    %echo done
    EOF
    gpg --batch --generate-key "$batch"
    keyid="$(gpg --list-secret-keys --keyid-format=long --with-colons "{{ email }}" | awk -F: '/^sec:/ {print $5; exit}')"
    gpg --batch --pinentry-mode loopback --passphrase "$pass" --armor --export-secret-keys "$keyid" > signing-key.asc
    printf '%s' "$pass" > signing-password.txt
    echo
    echo "Generated key $keyid. Uploading the PUBLIC key (Maven Central verifies signatures against it)…"
    gpg --keyserver keyserver.ubuntu.com --send-keys "$keyid" \
        || echo "  upload failed — retry later: gpg --keyserver keys.openpgp.org --send-keys $keyid"
    echo
    echo "Wrote (BOTH gitignored — never commit, delete after setting secrets):"
    echo "  signing-key.asc       → SIGNING_KEY secret"
    echo "  signing-password.txt  → SIGNING_PASSWORD secret"
    echo
    echo "Next: just android-set-secrets"

# Set the 4 Maven Central GitHub secrets via gh (prompts for the Portal token).
android-set-secrets:
    #!/usr/bin/env bash
    set -euo pipefail
    test -f signing-key.asc || { echo "signing-key.asc missing — run: just android-gen-signing-key"; exit 1; }
    test -f signing-password.txt || { echo "signing-password.txt missing — run: just android-gen-signing-key"; exit 1; }
    read -rp "Central Portal token username: " cu
    read -rsp "Central Portal token password: " cp; echo
    mise exec -- gh secret set MAVEN_CENTRAL_USERNAME --body "$cu"
    mise exec -- gh secret set MAVEN_CENTRAL_PASSWORD --body "$cp"
    mise exec -- gh secret set SIGNING_KEY < signing-key.asc
    mise exec -- gh secret set SIGNING_PASSWORD --body "$(cat signing-password.txt)"
    echo "Set MAVEN_CENTRAL_USERNAME, MAVEN_CENTRAL_PASSWORD, SIGNING_KEY, SIGNING_PASSWORD on $(mise exec -- gh repo view --json nameWithOwner -q .nameWithOwner)"
    echo "Now delete the local key files: rm signing-key.asc signing-password.txt"

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

# ─── Changelog / Release ─────────────────────────────────────────────────────
# git-cliff generates the [Unreleased] section from conventional commits; the
# curated history and Keep a Changelog preamble are preserved. See RELEASING.md.

# Regenerate the CHANGELOG [Unreleased] section from conventional commits (idempotent)
changelog:
    #!/usr/bin/env bash
    set -euo pipefail
    frag="$(mktemp)"
    mise exec -- git-cliff --unreleased --config cliff.toml > "$frag"
    awk -v frag="$frag" '
        /<!-- git-cliff-unreleased-start -->/ { print; while ((getline l < frag) > 0) { if (l=="" && !seen) continue; seen=1; print l } close(frag); skip=1; next }
        /<!-- git-cliff-unreleased-end -->/ { skip=0 }
        !skip { print }
    ' CHANGELOG.md > CHANGELOG.md.tmp
    mv CHANGELOG.md.tmp CHANGELOG.md
    rm -f "$frag"
    echo "Updated [Unreleased] in CHANGELOG.md — review and add any manual 'Removed' entries."

# Cut a CHANGELOG release section from [Unreleased] (see RELEASING.md for full steps)
release version:
    #!/usr/bin/env bash
    set -euo pipefail
    frag="$(mktemp)"
    mise exec -- git-cliff --tag "v{{version}}" --unreleased --config cliff.toml > "$frag"
    awk -v frag="$frag" '
        /<!-- git-cliff-unreleased-start -->/ {
            print "<!-- git-cliff-unreleased-start -->"
            print "## [Unreleased]"
            print "<!-- git-cliff-unreleased-end -->"
            print ""
            while ((getline l < frag) > 0) { if (l=="" && !seen) continue; seen=1; print l }
            close(frag)
            skip=1; next
        }
        /<!-- git-cliff-unreleased-end -->/ { skip=0; next }
        !skip { print }
    ' CHANGELOG.md > CHANGELOG.md.tmp
    mv CHANGELOG.md.tmp CHANGELOG.md
    rm -f "$frag"
    echo "Cut [{{version}}] in CHANGELOG.md. Remaining manual steps:"
    echo "  1. Update the link-reference block at the bottom of CHANGELOG.md:"
    echo "       [Unreleased]: .../compare/v{{version}}...HEAD"
    echo "       [{{version}}]: .../compare/<prev>...v{{version}}"
    echo "  2. Bump the version to {{version}} across all implementations and tools."
    echo "  3. Commit, then: git tag -a v{{version}} -m 'v{{version}}' && git push --tags"
