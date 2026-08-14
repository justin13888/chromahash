# chromahash justfile — cross-language task runner
# Run `just` to see available recipes.

default:
    @just --list

# ─── All languages ───────────────────────────────────────────────────────────

# Format all implementations
[parallel]
format: format-rust format-c format-wasm format-ts format-jvm format-swift format-go format-python format-csharp format-android format-compare format-thumbhash format-gamutref

# Lint all implementations
[parallel]
lint: lint-rust lint-c lint-wasm lint-ts lint-jvm lint-swift lint-go lint-python lint-csharp lint-android lint-compare lint-thumbhash lint-gamutref

# Auto-fix formatting in all implementations
[parallel]
format-fix: format-fix-rust format-fix-c format-fix-wasm format-fix-ts format-fix-jvm format-fix-swift format-fix-go format-fix-python format-fix-csharp format-fix-android format-fix-compare format-fix-thumbhash format-fix-gamutref

# Auto-fix linting in all implementations
[parallel]
lint-fix: lint-fix-rust lint-fix-c lint-fix-wasm lint-fix-ts lint-fix-jvm lint-fix-swift lint-fix-go lint-fix-python lint-fix-csharp lint-fix-android lint-fix-compare lint-fix-thumbhash lint-fix-gamutref

# Run all tests
[parallel]
test: test-rust test-c test-wasm test-ts test-jvm test-swift test-go test-python test-csharp test-android

# Build all implementations
[parallel]
build: build-rust build-c build-wasm build-ts build-jvm build-swift build-go build-python build-csharp build-android-crate

# Check formatting (no writes) across all implementations
[parallel]
format-check: format-check-rust format-check-c format-check-wasm format-check-ts format-check-jvm format-check-swift format-check-go format-check-python format-check-csharp format-check-android format-check-compare format-check-thumbhash format-check-gamutref

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

# ─── Gamut → sRGB reference (delegates to gamut-color) ────────────────────────
# Standalone crate (keeps the core chromahash crate zero-dep). Wraps gamut's
# color primitives for the comparison harness's metric-reference conversion.

format-gamutref:
    cargo fmt --manifest-path tools/gamut-ref-stdin/Cargo.toml

format-fix-gamutref: format-gamutref

format-check-gamutref:
    cargo fmt --manifest-path tools/gamut-ref-stdin/Cargo.toml --check

lint-gamutref:
    cargo clippy --manifest-path tools/gamut-ref-stdin/Cargo.toml -- -D warnings

lint-fix-gamutref:
    cargo clippy --manifest-path tools/gamut-ref-stdin/Cargo.toml --fix --allow-staged --allow-dirty
    cargo clippy --manifest-path tools/gamut-ref-stdin/Cargo.toml -- -D warnings

# Build the comparison tool (installs node deps first so a clean checkout works)
build-compare:
    mise exec -- pnpm --prefix tools/comparison install --frozen-lockfile
    mise exec -- pnpm --prefix tools/comparison run build

# Install iqa-cli (the iqa-rs metrics CLI) — prerequisite for `compare`'s quality
# metrics. Pulls in ssimulacra2/butteraugli, which build vendored C++ (needs a C/C++
# toolchain). Without it the report still builds, but metrics show as N/A.
install-iqa:
    cargo install iqa-cli --locked --version 0.2.0

# Run the visual comparison. Emits output/report.html, output/report.json, and
# standalone images under output/images/ (the HTML and JSON both reference them).
# Requires iqa-cli on PATH for quality metrics — run `just install-iqa` once first.
# The harnesses are now binding-backed, so stage each language's native lib
# first (the C + JVM harnesses self-build inside the comparison tool).
compare: build-compare go-cbuild swift-cbuild ts-cbuild python-cbuild csharp-cbuild
    mise exec -- pnpm --prefix tools/comparison run compare

# Local-only: compare chromahash's own format versions (v0.2–v0.6 + the current
# working tree, the primary variant) to gauge whether current changes improve
# quality. v0.6 is the immediate predecessor and the one baseline that matters
# for an A/B — it and a tier-0 working tree are both exactly 32 bytes, so the
# comparison is equal-budget. Each tag is built as a release encode_stdin in a
# cached git worktree under tools/comparison/.versions/ (gitignored). Not run in
# CI. Requires iqa-cli on PATH (run `just install-iqa` once). Writes
# output/versions-report.{html,json}.
compare-versions: build-compare
    mise exec -- node tools/comparison/dist/main.js --versions v0.2,v0.3,v0.4,v0.5,v0.6,current

# Rate–distortion comparison: sweep every format's quality knob (ChromaHash
# tiers 0–3, BlurHash components, lqip-modern sizes) plus equal-byte WebP/JPEG/
# AVIF (+JXL when cjxl/djxl are on PATH) and raw-RGB565 baselines at the four
# ChromaHash tier byte anchors (32/108/411/1623 B), on the photographic corpus
# only. Requires iqa-cli on PATH (run `just install-iqa` once). Writes
# output/rd-report.{html,json} — never clobbers the standard report.
compare-rd: build-compare
    cargo build --manifest-path rust/Cargo.toml --release --example encode_stdin
    mise exec -- node tools/comparison/dist/main.js --rd

# Score CHROMAHASH_TUNE variants over the tune split and emit a decision table
# (config = a name under tools/comparison/sweeps/, e.g. `just sweep companding-family`;
# results → output/sweeps/<name>.json). Pass `--split holdout` only to validate a
# finished winner against the pre-registered rule — never to tune.
sweep config *args: build-compare
    cargo build --manifest-path rust/Cargo.toml --release --example encode_stdin
    mise exec -- node tools/comparison/dist/sweep.js tools/comparison/sweeps/{{config}}.json {{args}}

# Train Lloyd-Max codebooks and run the chroma VQ probe on the tune split's
# dumped coefficients (→ output/sweeps/tables.json with ready-to-paste
# CHROMAHASH_TUNE fragments for the companding-family sweep).
train-tables *args: build-compare
    cargo build --manifest-path rust/Cargo.toml --release --example encode_stdin
    mise exec -- node tools/comparison/dist/train-tables.js {{args}}

# ─── Benchmark ──────────────────────────────────────────────────────────────

# Build benchmark harnesses (release mode), incl. both ThumbHash baselines (native Rust + JS)
build-benchmark: go-cbuild swift-cbuild ts-cbuild python-cbuild csharp-cbuild
    cargo build --manifest-path rust/Cargo.toml --release --example encode_stdin
    mise exec node@24 -- pnpm --prefix typescript run build
    cd go && CGO_ENABLED=1 go build -o encode-stdin ./cmd/encode-stdin
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd bindings/uniffi/jvm && ./gradlew installDist -q'
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
bench-batch: bench-batch-rust bench-batch-go bench-batch-swift bench-batch-jvm bench-batch-csharp bench-batch-python bench-batch-ts

bench-batch-rust:
    cargo run --manifest-path rust/Cargo.toml --release --example batch_bench

bench-batch-ts: ts-cbuild
    mise exec node@24 -- pnpm --prefix typescript run bench

bench-batch-jvm:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd bindings/uniffi/jvm && ./gradlew bench -q'

bench-batch-swift: swift-cbuild
    cd swift && mise exec swift@6.2.4 -- swift run -c release ChromaHashBatchBench

bench-batch-go: go-cbuild
    cd go && CGO_ENABLED=1 go test -bench=Encode -benchmem -run='^$' ./...

bench-batch-python: python-cbuild
    cd python && uv run python benchmarks/batch_bench.py

bench-batch-csharp: csharp-cbuild
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

# Pin every vector backend this CPU/arch actually provides (AVX2/SSE2, NEON, …)
# against the scalar reference. The `full` feature turns on `simd-diff-tests`,
# which *fails* rather than silently skipping if the host can't run a backend it
# was asked to validate. Other targets: `just test-simd-emulated`.
# Run the native-host SIMD differential tests.
test-simd-diff:
    cargo test --manifest-path rust/Cargo.toml --features full simd::

# Install the rustup targets the emulated SIMD sweep cross-compiles to.
setup-simd-targets:
    rustup target add x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu wasm32-wasip1

# Emulate each target and run its differential suite: x86_64 AVX2 and SSE2-only
# via QEMU, aarch64 NEON via QEMU, wasm32 simd128 via wasmtime — the combinations
# the per-target CI jobs cover, on a single host (e.g. an Apple-silicon laptop).
# QEMU user-mode emulates Linux targets, so on a non-Linux host run inside a Linux
# container. Prereqs (not via mise): `just setup-simd-targets`, plus `qemu-user`,
# `gcc-aarch64-linux-gnu`, and `wasmtime` on PATH.
# Run the SIMD differential tests across every emulated target.
test-simd-emulated:
    #!/usr/bin/env bash
    set -euo pipefail
    for tool in qemu-x86_64 qemu-aarch64 aarch64-linux-gnu-gcc wasmtime; do
        command -v "$tool" >/dev/null 2>&1 || {
            echo "test-simd-emulated: missing '$tool'. Install qemu-user, gcc-aarch64-linux-gnu and wasmtime, then run 'just setup-simd-targets'." >&2
            exit 1
        }
    done
    cd rust
    echo '== x86_64 · AVX2 (+SSE2) =='
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER='qemu-x86_64 -cpu max' \
        cargo test --target x86_64-unknown-linux-gnu --features full simd::
    echo '== x86_64 · SSE2-only (no AVX2) =='
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_RUNNER='qemu-x86_64 -cpu Nehalem' \
        cargo test --target x86_64-unknown-linux-gnu --features full simd:: -- --skip avx2
    echo '== aarch64 · NEON =='
    sysroot="$(aarch64-linux-gnu-gcc -print-sysroot)"
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER='aarch64-linux-gnu-gcc' \
    CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUNNER="qemu-aarch64 -L ${sysroot:-/usr/aarch64-linux-gnu}" \
        cargo test --target aarch64-unknown-linux-gnu --features full simd::
    echo '== wasm32 · simd128 =='
    RUSTFLAGS='-C target-feature=+simd128' CARGO_TARGET_WASM32_WASIP1_RUNNER='wasmtime' \
        cargo test --lib --target wasm32-wasip1 --features full simd::

# cargo-mutants applies small code mutations and checks the tests catch each one;
# a surviving (MISSED) mutant is a test gap. ARGS pass through to cargo-mutants.
# Full sweep of the core crate — slow (~1100 mutants); lefthook/CI use the diff form
mutants-rust *ARGS:
    cargo mutants -d rust {{ ARGS }}

# Incremental sweep: only mutate core lines changed vs BASE (default origin/master)
mutants-rust-diff base="origin/master":
    #!/usr/bin/env bash
    set -euo pipefail
    diff="$(mktemp)"
    trap 'rm -f "$diff"' EXIT
    git -C rust diff --relative "{{ base }}" -- . > "$diff"
    if [ ! -s "$diff" ]; then
        echo "mutants-rust-diff: no core Rust changes vs {{ base }} — nothing to test"
        exit 0
    fi
    cargo mutants -d rust --in-diff "$diff"

# ─── C binding (chromahash-c) ─────────────────────────────────────────────────
# Hand-written extern "C" surface + cbindgen header. The header is regenerated on
# every build (build.rs) into bindings/c/include/chromahash.h (a committed artifact).

format-c:
    cargo fmt --manifest-path bindings/c/Cargo.toml

format-fix-c: format-c

format-check-c:
    cargo fmt --manifest-path bindings/c/Cargo.toml --check

lint-c:
    cargo clippy --manifest-path bindings/c/Cargo.toml -- -D warnings

lint-fix-c:
    cargo clippy --manifest-path bindings/c/Cargo.toml --fix --allow-staged --allow-dirty
    cargo clippy --manifest-path bindings/c/Cargo.toml -- -D warnings

# Build the staticlib + cdylib (also regenerates include/chromahash.h via build.rs)
build-c:
    cargo build --manifest-path bindings/c/Cargo.toml

# Explicit alias: regenerate include/chromahash.h (build.rs runs cbindgen on build)
gen-c-header: build-c

# Compile + link + run the C example against the freshly built cdylib (proves linkage)
test-c-example: build-c
    #!/usr/bin/env bash
    set -euo pipefail
    lib="bindings/c/target/debug"
    out="$(mktemp -d)/roundtrip"
    cc bindings/c/examples/roundtrip.c -I bindings/c/include -L "$lib" -lchromahash_c -o "$out"
    case "$(uname)" in
      Darwin) DYLD_LIBRARY_PATH="$lib" "$out" ;;
      *)      LD_LIBRARY_PATH="$lib" "$out" ;;
    esac

# Runs the spec vectors through the C ABI (the parity gate) + the C linkage smoke test
test-c: build-c test-c-example
    cargo test --manifest-path bindings/c/Cargo.toml

# ─── WASM binding (chromahash-wasm) ───────────────────────────────────────────
# wasm-bindgen wrapper for the TypeScript web package. Built with wasm-pack
# (mise-managed). clippy/build target the wasm32-unknown-unknown triple.

format-wasm:
    cargo fmt --manifest-path bindings/wasm/Cargo.toml

format-fix-wasm: format-wasm

format-check-wasm:
    cargo fmt --manifest-path bindings/wasm/Cargo.toml --check

lint-wasm:
    cargo clippy --manifest-path bindings/wasm/Cargo.toml --target wasm32-unknown-unknown -- -D warnings

lint-fix-wasm:
    cargo clippy --manifest-path bindings/wasm/Cargo.toml --target wasm32-unknown-unknown --fix --allow-staged --allow-dirty
    cargo clippy --manifest-path bindings/wasm/Cargo.toml --target wasm32-unknown-unknown -- -D warnings

# Build the web + nodejs packages (.wasm + JS glue + .d.ts) under bindings/wasm/pkg*
build-wasm:
    mise exec -- wasm-pack build --target web bindings/wasm --out-dir pkg
    mise exec -- wasm-pack build --target nodejs bindings/wasm --out-dir pkg-node

# Runs the spec vectors through the wasm-bindgen surface, compiled to wasm + run in Node
test-wasm:
    mise exec node@24 -- wasm-pack test --node bindings/wasm

# ─── Android binding (chromahash-uniffi) ──────────────────────────────────────
# Host-only recipes (no Android NDK/SDK required) — wired into the aggregates so
# the lefthook gates stay green. The AAR build (`build-android-aar`) needs the NDK
# + SDK and is intentionally kept OUT of the aggregates.

format-android:
    cargo fmt --manifest-path bindings/uniffi/Cargo.toml

format-fix-android: format-android

format-check-android:
    cargo fmt --manifest-path bindings/uniffi/Cargo.toml --check

lint-android:
    cargo clippy --manifest-path bindings/uniffi/Cargo.toml -- -D warnings

lint-fix-android:
    cargo clippy --manifest-path bindings/uniffi/Cargo.toml --fix --allow-staged --allow-dirty
    cargo clippy --manifest-path bindings/uniffi/Cargo.toml -- -D warnings

# Runs the spec test vectors through the binding (the enforced correctness gate)
test-android:
    cargo test --manifest-path bindings/uniffi/Cargo.toml

# Host build of the binding crate (lib + cdylib + bindgen bin); no cross-compile
build-android-crate:
    cargo build --manifest-path bindings/uniffi/Cargo.toml

# Cross-compile every ABI + generate Kotlin + assemble the AAR.
# Requires the Android NDK (ANDROID_NDK_HOME / ANDROID_NDK_LATEST_HOME) + SDK and
# the android rustup targets. cargo-ndk is mise-managed (`cargo:cargo-ndk`).
# Not part of `just build`.
build-android-aar:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd bindings/uniffi/android && ./gradlew assembleRelease'

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
# The package wraps the wasm-pack glue (full encode+decode path) plus a synced
# pure-TS decode-only module. `ts-cbuild` stages the glue into typescript/wasm/
# (gitignored build output); tsc + the test runner consume it from there.

ts-cbuild:
    mise exec -- wasm-pack build --target web bindings/wasm --out-dir ../../typescript/wasm

format-ts:
    mise exec node@24 -- pnpm --prefix typescript run format

format-fix-ts: format-ts

format-check-ts:
    mise exec node@24 -- pnpm --prefix typescript run format:check

lint-ts:
    mise exec node@24 -- pnpm --prefix typescript run lint

lint-fix-ts:
    mise exec node@24 -- pnpm --prefix typescript run lint:fix

test-ts: ts-cbuild
    mise exec node@24 -- pnpm --prefix typescript run test

build-ts: ts-cbuild
    mise exec node@24 -- pnpm --prefix typescript run build

# ─── JVM binding (chromahash-jvm) ─────────────────────────────────────────────
# Desktop/server JAR over the shared chromahash-uniffi crate. format/lint run
# ktlint on the hand-written Kotlin (CLI + tests); the generated bindings under
# build/ are excluded. test/build run the full pipeline (cargo cdylib +
# uniffi-bindgen + JNA-bundled native lib), so they need the Rust toolchain.

format-jvm:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd bindings/uniffi/jvm && ./gradlew ktlintFormat'

format-fix-jvm: format-jvm

format-check-jvm:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd bindings/uniffi/jvm && ./gradlew ktlintCheck'

lint-jvm:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd bindings/uniffi/jvm && ./gradlew ktlintCheck'

lint-fix-jvm: format-jvm

# Runs the spec test vectors through the binding (the enforced correctness gate)
test-jvm:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd bindings/uniffi/jvm && ./gradlew test'

build-jvm:
    mise exec java@21 gradle@9.4.0 -- sh -c 'cd bindings/uniffi/jvm && ./gradlew build'

# ─── Swift ───────────────────────────────────────────────────────────────────

format-swift:
    @command -v swift-format >/dev/null 2>&1 && (cd swift && swift-format format -i -r Sources Tests) || echo "swift-format not found, skipping"

format-fix-swift: format-swift

format-check-swift:
    @command -v swift-format >/dev/null 2>&1 && (cd swift && swift-format lint -r Sources Tests) || echo "swift-format not found, skipping"

lint-swift: format-check-swift

lint-fix-swift: format-swift

# Build the UniFFI static lib, generate Swift bindings, and assemble the
# ChromaHashFFI.xcframework the Swift package consumes. The xcframework step is
# macOS-only (xcodebuild); on other platforms this skips with a warning so the
# recipes that depend on it (compare, build-benchmark) still run — the Swift
# harness is simply absent there.
swift-cbuild:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ "$(uname)" != "Darwin" ]; then
        echo "swift-cbuild: skipping — the xcframework build needs macOS/xcodebuild." >&2
        exit 0
    fi
    cargo build --release --manifest-path bindings/uniffi/Cargo.toml
    gen="$(mktemp -d)"
    ( cd bindings/uniffi && cargo run --release --quiet --bin uniffi-bindgen -- \
        generate --library target/release/libchromahash_uniffi.dylib \
        --language swift --out-dir "$gen" )
    mkdir -p swift/Sources/ChromaHashBindings
    cp "$gen/chromahash_uniffi.swift" swift/Sources/ChromaHashBindings/
    hdr="$(mktemp -d)"
    cp "$gen/chromahash_uniffiFFI.h" "$hdr/"
    cp "$gen/chromahash_uniffiFFI.modulemap" "$hdr/module.modulemap"
    rm -rf swift/ChromaHashFFI.xcframework
    xcodebuild -create-xcframework \
        -library bindings/uniffi/target/release/libchromahash_uniffi.a \
        -headers "$hdr" -output swift/ChromaHashFFI.xcframework

# Run the Swift spec-vector tests. --no-parallel: the blocking OperationQueue in
# BatchEncoder deadlocks Swift Testing's parallel pool on low-core machines (see
# ci-swift.yml); the suite runs in ~0.05s, so serial costs nothing. Package.swift
# is at the repo root; CHROMAHASH_LOCAL_XCFRAMEWORK selects the locally built
# xcframework over the released remote one.
test-swift: swift-cbuild
    CHROMAHASH_LOCAL_XCFRAMEWORK=1 mise exec swift@6.2.4 -- swift test --no-parallel

build-swift: swift-cbuild
    CHROMAHASH_LOCAL_XCFRAMEWORK=1 mise exec swift@6.2.4 -- swift build

# Assemble the multi-platform release xcframework (macOS + iOS device/simulator)
# that release-swift.yml zips, checksums, and attaches to the GitHub release.
# macOS-only. tvOS/watchOS/visionOS slices are a follow-up.
swift-xcframework:
    #!/usr/bin/env bash
    set -euo pipefail
    # Host dylib drives uniffi-bindgen (metadata) and the committed Swift bindings.
    cargo build --release --manifest-path bindings/uniffi/Cargo.toml
    gen="$(mktemp -d)"
    ( cd bindings/uniffi && cargo run --release --quiet --bin uniffi-bindgen -- \
        generate --library target/release/libchromahash_uniffi.dylib \
        --language swift --out-dir "$gen" )
    mkdir -p swift/Sources/ChromaHashBindings
    cp "$gen/chromahash_uniffi.swift" swift/Sources/ChromaHashBindings/
    hdr="$(mktemp -d)"
    cp "$gen/chromahash_uniffiFFI.h" "$hdr/"
    cp "$gen/chromahash_uniffiFFI.modulemap" "$hdr/module.modulemap"
    for t in aarch64-apple-darwin x86_64-apple-darwin aarch64-apple-ios aarch64-apple-ios-sim x86_64-apple-ios; do
        rustup target add "$t" >/dev/null 2>&1 || true
        cargo build --release --manifest-path bindings/uniffi/Cargo.toml --target "$t"
    done
    base=bindings/uniffi/target
    rm -rf swift/.xcf-slices && mkdir -p swift/.xcf-slices/{macos,ios,ios-sim}
    lipo -create "$base/aarch64-apple-darwin/release/libchromahash_uniffi.a" \
                 "$base/x86_64-apple-darwin/release/libchromahash_uniffi.a" \
                 -output swift/.xcf-slices/macos/libchromahash_uniffi.a
    cp "$base/aarch64-apple-ios/release/libchromahash_uniffi.a" swift/.xcf-slices/ios/libchromahash_uniffi.a
    lipo -create "$base/aarch64-apple-ios-sim/release/libchromahash_uniffi.a" \
                 "$base/x86_64-apple-ios/release/libchromahash_uniffi.a" \
                 -output swift/.xcf-slices/ios-sim/libchromahash_uniffi.a
    rm -rf swift/ChromaHashFFI.xcframework
    xcodebuild -create-xcframework \
        -library swift/.xcf-slices/macos/libchromahash_uniffi.a -headers "$hdr" \
        -library swift/.xcf-slices/ios/libchromahash_uniffi.a -headers "$hdr" \
        -library swift/.xcf-slices/ios-sim/libchromahash_uniffi.a -headers "$hdr" \
        -output swift/ChromaHashFFI.xcframework
    rm -rf swift/.xcf-slices

# ─── Go ──────────────────────────────────────────────────────────────────────

format-go:
    cd go && gofmt -w .

format-fix-go: format-go

format-check-go:
    cd go && test -z "$(gofmt -l .)"

# Build the chromahash-c static library + header and stage them for the cgo build
# (go/lib, go/include — both gitignored). The Go package is a cgo wrapper, so a
# bare `go build`/`go test` requires these to be present first.
go-cbuild:
    cargo build --manifest-path bindings/c/Cargo.toml --release
    mkdir -p go/lib go/include
    cp bindings/c/target/release/libchromahash_c.a go/lib/
    cp bindings/c/include/chromahash.h go/include/

lint-go: go-cbuild
    cd go && CGO_ENABLED=1 go vet ./...

lint-fix-go: lint-go

test-go: go-cbuild
    cd go && CGO_ENABLED=1 go test ./... -v

build-go: go-cbuild
    cd go && CGO_ENABLED=1 go build ./...

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

# Build the UniFFI static lib, generate the ctypes bindings, and stage them + the
# native lib into the package (chromahash/_uniffi.py + libchromahash_uniffi.*).
python-cbuild:
    #!/usr/bin/env bash
    set -euo pipefail
    case "$(uname)" in
      Darwin) lib=libchromahash_uniffi.dylib ;;
      *)      lib=libchromahash_uniffi.so ;;
    esac
    cargo build --release --manifest-path bindings/uniffi/Cargo.toml
    gen="$(mktemp -d)"
    ( cd bindings/uniffi && cargo run --release --quiet --bin uniffi-bindgen -- \
        generate --library "target/release/$lib" --language python --out-dir "$gen" )
    cp "$gen/chromahash_uniffi.py" python/chromahash/_uniffi.py
    cp "bindings/uniffi/target/release/$lib" python/chromahash/

test-python: python-cbuild
    cd python && uv run pytest tests/ -v

build-python: python-cbuild
    cd python && uv build

# ─── C# ──────────────────────────────────────────────────────────────────────

format-csharp:
    mise exec dotnet@9 -- dotnet format csharp/Chromahash.sln --verbosity quiet

format-fix-csharp: format-csharp

format-check-csharp:
    mise exec dotnet@9 -- dotnet format csharp/Chromahash.sln --verify-no-changes --verbosity quiet

# Build the chromahash-c cdylib (release); the lib csproj copies it next to the
# managed assembly so P/Invoke resolves it at runtime.
csharp-cbuild:
    cargo build --manifest-path bindings/c/Cargo.toml --release

lint-csharp:
    mise exec dotnet@9 -- dotnet build csharp/Chromahash.sln -warnaserror --verbosity quiet

lint-fix-csharp: lint-csharp

test-csharp: csharp-cbuild
    mise exec dotnet@9 -- dotnet test csharp/Chromahash.sln --verbosity quiet

build-csharp: csharp-cbuild
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
