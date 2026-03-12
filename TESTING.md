# Testing Methodology

Complete testing procedure for the ChromaHash monorepo. Run this after any change to be confident all implementations are correct and in sync.

## Prerequisites

```bash
mise install          # install pinned tool versions (node 24, java 21, gradle 9.4.0, swift 6.2.4)
lefthook install      # activate git hooks
cd typescript && pnpm install && cd ..
cd kotlin && ./gradlew dependencies && cd ..
```

Verify tools are available:

```bash
cargo --version       # Rust stable
node --version        # 24.x
pnpm --version
java --version        # 21
swift --version       # 6.2.4
```

---

## Quick Check (run after every change)

```bash
just test
```

This runs all four language test suites sequentially: Rust, TypeScript, Kotlin, Swift. If this passes, the implementations agree on all golden test vectors.

---

## Full Verification (run before pushing)

Run these in order. Each step must pass before proceeding.

### Step 1: Validate spec constants

```bash
cd spec && python3 validate.py && cd ..
```

Independently derives all M1 matrices from gamut chromaticity coordinates and verifies them against `constants.py`. Checks matrix inverse relationships, white point mapping, OKLAB bounds, mu-law round-trips, and aspect ratio encoding. Exit code 0 = pass.

### Step 2: Verify scan orders

```bash
cd spec && python3 scan_order.py && cd ..
```

Confirms triangular coefficient scan orders produce the expected AC counts (3x3=5, 4x4=9, 6x6=20, 7x7=27).

### Step 3: Format check

```bash
just format-check
```

Checks formatting across all four languages without modifying files:
- Rust: `cargo fmt --check`
- TypeScript: Biome format check
- Kotlin: ktlint check
- Swift: swift-format lint

If this fails, run `just format-fix` and re-check.

### Step 4: Lint

```bash
just lint
```

Runs linters across all four languages:
- Rust: `cargo clippy -- -D warnings`
- TypeScript: Biome lint
- Kotlin: ktlint check
- Swift: swift-format lint

If this fails, run `just lint-fix` for auto-fixable issues.

### Step 5: Build

```bash
just build
```

Compiles all four implementations. Catches type errors, missing imports, and compilation issues that tests alone might not surface (e.g., TypeScript type checking).

### Step 6: Test all implementations

```bash
just test
```

Runs the full test suite for each language. All implementations load the same golden test vectors from `spec/test-vectors/` and must produce identical results.

### Step 7: (If test vectors changed) Regenerate and re-test

If you modified encoding/decoding logic in Rust (the reference implementation):

```bash
cd rust && cargo test -- --ignored generate_test_vectors --nocapture && cd ..
just test
```

This regenerates all JSON test vectors from the Rust implementation, then re-runs every language's tests against the new vectors. All four must still pass.

---

## One-Liner for Full Verification

```bash
(cd spec && python3 validate.py && python3 scan_order.py) && just format-check && just lint && just build && just test
```

---

## Per-Language Commands

When iterating on a single language, use the targeted commands to save time:

| Action | Rust | TypeScript | Kotlin | Swift |
|--------|------|------------|--------|-------|
| Format check | `just format-check-rust` | `just format-check-ts` | `just format-check-kotlin` | `just format-check-swift` |
| Format fix | `just format-fix-rust` | `just format-fix-ts` | `just format-fix-kotlin` | `just format-fix-swift` |
| Lint | `just lint-rust` | `just lint-ts` | `just lint-kotlin` | `just lint-swift` |
| Test | `just test-rust` | `just test-ts` | `just test-kotlin` | `just test-swift` |
| Build | `just build-rust` | `just build-ts` | `just build-kotlin` | `just build-swift` |

---

## Test Architecture

### Golden Test Vectors

All cross-implementation conformance testing is driven by shared JSON test vectors in `spec/test-vectors/`. The Rust implementation is the reference that generates these vectors. Every other implementation loads and validates against them.

| File | What it tests | Cases |
|------|---------------|-------|
| `unit-color.json` | RGB to OKLAB conversion and sRGB round-trip | 10 cases across sRGB, Display P3, Adobe RGB |
| `unit-mulaw.json` | mu-law compress, expand, quantize, dequantize | 27 cases (9 values x 3 bit widths) |
| `unit-dct.json` | Triangular scan order for each grid size | 4 grids: 3x3, 4x4, 6x6, 7x7 |
| `unit-aspect.json` | Aspect ratio encode/decode and output dimensions | 9 ratios including extremes |
| `integration-encode.json` | Full image-to-hash encoding | 12 images: solid colors, gradients, alpha, multi-gamut |
| `integration-decode.json` | Full hash-to-image decoding | 4 hashes with complete pixel-level expected output |

### Test Layers

Each implementation should have tests at three layers:

**1. Unit tests** — individual functions in isolation:
- `roundHalfAwayFromZero` (spec section 2.2)
- `cbrtSigned` for negative values (spec section 2.4)
- `writeBits` / `readBits` round-trip (spec section 12.7)
- `muLawQuantize` / `muLawDequantize` round-trip (spec section 7.3)
- `triangularScanOrder` coefficient counts (spec section 6.2)
- `encodeAspect` / `decodeAspect` known ratios (spec section 8)
- `linearRgbToOklab` / `oklabToLinearSrgb` white/black/primary colors (spec section 4.3)
- Transfer functions: sRGB, Adobe RGB, ProPhoto, BT.2020 PQ boundaries (spec section 5.4)

**2. Unit tests against golden vectors** — loaded from `spec/test-vectors/unit-*.json`:
- Color conversion: exact OKLAB values for known inputs
- mu-law: exact compressed/expanded/quantized/dequantized values
- DCT scan order: exact (cx, cy) sequences
- Aspect ratio: exact byte values and decoded dimensions

**3. Integration tests against golden vectors** — loaded from `spec/test-vectors/integration-*.json`:
- Encode: given (width, height, RGBA pixels, gamut), the 32-byte hash must match exactly
- Decode: given a 32-byte hash, the output (width, height, RGBA pixels) must match exactly
- Average color: the header-only DC color extraction must match

### Tolerances

- **Integer outputs** (quantized values, byte arrays, pixel values): exact match, zero tolerance.
- **Floating-point intermediates** in test vectors: rounded to 15 significant digits. Implementations should match within `1e-10` for color conversions and `1e-12` for mu-law round-trips.
- **Rounding mode**: all implementations MUST use round-half-away-from-zero, not banker's rounding (spec section 2.2). This is the most common source of cross-implementation divergence.

---

## What to Check After Specific Changes

### Changed a constant or matrix in `spec/constants.py`

1. `python3 spec/validate.py` — verify derivation still holds
2. Update the constant in ALL four implementations
3. Regenerate test vectors from Rust: `cd rust && cargo test -- --ignored generate_test_vectors --nocapture`
4. `just test` — all four must pass

### Changed encoding logic

1. Update in ALL four implementations (they must stay in sync)
2. Regenerate test vectors from Rust (it is the reference)
3. `just test` — all four must pass against new vectors

### Changed decoding logic

1. Update in ALL four implementations
2. Regenerate decode test vectors from Rust
3. `just test`

### Changed only one language implementation (bug fix)

1. `just test-<lang>` for the changed language
2. `just test` to confirm no regressions across all languages

### Changed the spec (`spec/README.md`)

1. Verify the spec text matches `constants.py`: `python3 spec/validate.py`
2. If the spec describes new behavior, ensure all four implementations and test vectors reflect it
3. `just test`

---

## Git Hooks (Automated Safety Net)

Lefthook enforces checks automatically:

| Hook | What runs | Purpose |
|------|-----------|---------|
| `pre-commit` | `just format-fix`, `just lint-fix` | Auto-fix style issues before committing |
| `pre-push` | `just format-check`, `just lint`, `just test` | Block push if anything fails |

These hooks are installed via `lefthook install`. The pre-push hook runs the full test suite, so a successful `git push` implies all checks passed.

---

## CI (GitHub Actions)

Each language has an independent CI workflow triggered only when its directory changes:

| Workflow | Trigger path | Steps |
|----------|-------------|-------|
| `ci-rust.yml` | `rust/**` | fmt check, clippy, test |
| `ci-typescript.yml` | `typescript/**` | fmt check, lint, build, test |
| `ci-kotlin.yml` | `kotlin/**` | ktlint check, test, build |
| `ci-swift.yml` | `swift/**` | build, test |

CI mirrors the local `just` commands. If local checks pass, CI should pass.

---

## Troubleshooting

### Tests pass locally but fail in CI

- Check tool versions match `.mise.toml` (node 24, java 21, gradle 9.4.0, swift 6.2.4)
- CI installs specific versions; local `mise install` should match

### One language passes but another fails on the same test vector

- The failing implementation has a bug. The test vectors are authoritative.
- Common causes: wrong rounding mode, off-by-one in scan order loop, incorrect bit width, matrix typo

### Floating-point mismatch in color conversion

- Ensure float64 precision for encoding (spec section 2.3)
- Check `cbrt` handles negative values (spec section 2.4): must use `sign(x) * |x|^(1/3)`, not `pow(x, 1/3)`
- Verify the correct M1 matrix is selected for the source gamut

### Test vector regeneration produces different hashes

- Expected if you changed encoding logic. Update all implementations to match.
- Unexpected if you only changed one language. The Rust reference may have a bug — compare against spec pseudocode.
