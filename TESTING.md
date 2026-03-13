# Testing Methodology

Complete testing procedure for the ChromaHash monorepo. Run this after any change to be confident all implementations are correct and in sync.

See [README.md](README.md) for setup and prerequisites (mise, lefthook, per-language dependencies).

---

## Quick Check (run after every change)

```bash
just test
```

This runs all seven language test suites sequentially: Rust, TypeScript, Kotlin, Swift, Go, Python, C#. If this passes, the implementations agree on all golden test vectors.

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

Checks formatting across all implementations without modifying files. If this fails, run `just format-fix` and re-check.

### Step 4: Lint

```bash
just lint
```

Runs linters across all implementations. If this fails, run `just lint-fix` for auto-fixable issues.

### Step 5: Build

```bash
just build
```

Compiles all seven implementations. Catches type errors, missing imports, and compilation issues that tests alone might not surface (e.g., TypeScript type checking).

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

This regenerates all JSON test vectors from the Rust implementation, then re-runs every language's tests against the new vectors. All seven must still pass.

---

## One-Liner for Full Verification

```bash
(cd spec && python3 validate.py && python3 scan_order.py) && just format-check && just lint && just build && just test
```

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

## Test Fixture Coverage Requirements

This section defines all axes of variation that must be covered when building or extending the test vector dataset. Every combination that exercises a distinct code path should have at least one test case.

### Axis 1: Image Dimensions

Dimensions affect the aspect ratio encoding byte, the DCT basis function evaluation (cosine arguments scale with 1/w and 1/h), and whether AC coefficients are zero for trivially small images.

| Case | w | h | Purpose |
|------|---|---|---------|
| Minimum | 1 | 1 | Single pixel — all AC must be zero |
| Square small | 4 | 4 | Baseline for solid/gradient cases |
| Square medium | 8 | 8 | Higher-resolution AC detail |
| Square large | 16 | 16 | More pixels, richer AC spectrum |
| Square max | 100 | 100 | Enforces w/h ≤ 100 boundary |
| Landscape | 8 | 4 | aspect byte < 128 |
| Portrait | 4 | 8 | aspect byte > 128 |
| Extreme landscape | 100 | 1 | aspect byte = 255 (4:1 cap) |
| Extreme portrait | 1 | 100 | aspect byte = 0 (1:4 cap) |
| Photographic 3:2 | 9 | 6 | Common camera ratio |
| Photographic 16:9 | 16 | 9 | Widescreen ratio |

The aspect byte clamps at the representable extremes (ratio 4:1 → byte 255, ratio 1:4 → byte 0). Test images at the exact clamp boundary.

### Axis 2: Gamut

Each gamut uses a distinct M1 matrix and, for Adobe RGB and ProPhoto RGB, a different transfer function exponent. Identical sRGB-valued pixels fed through different gamuts must produce different OKLAB values and therefore different hashes.

| Gamut | Transfer function | Notes |
|-------|------------------|-------|
| sRGB | Piecewise (IEC 61966-2-1) | Baseline |
| Display P3 | Same as sRGB | Different primaries only |
| Adobe RGB | Power 2.2 | Different EOTF from sRGB |
| BT.2020 | Same as sRGB | Wider primaries |
| ProPhoto RGB | Power 1.8 + Bradford D50→D65 | Most extreme gamut |

At minimum, each gamut needs one solid-color encode case with a known OKLAB output. A saturated color (e.g. 100% red) is most useful because it diverges maximally between gamuts.

### Axis 3: Alpha Channel

The presence of any pixel with α < 255 flips `hasAlpha = 1`, which changes the entire AC block layout: the L channel drops from a 7×7 grid (27 coefficients × 5 bits) to a 6×6 grid (20 coefficients, first 7 at 6 bits then 13 at 5 bits), and an alpha channel is added (DC: 5 bits, scale: 4 bits, 5 AC coefficients × 4 bits).

| Case | Description | hasAlpha |
|------|-------------|----------|
| All opaque | Every pixel α = 255 | 0 |
| One transparent pixel | A single pixel with α < 255 among opaque pixels | 1 |
| Checkerboard alpha | Alternating fully-opaque / fully-transparent | 1 |
| Uniform partial alpha | All pixels at α = 128 | 1 |
| Fully transparent | All pixels α = 0 | 1, DC defaults to black |

The fully-transparent case exercises the edge case where alpha-weighted averaging produces a zero-weight sum: the implementation must default to black (L=0, a=0, b=0) rather than dividing by zero.

### Axis 4: Color Distribution (AC Coefficient Coverage)

Solid colors produce scale=0 and all AC coefficients at the μ-law midpoint — a distinct code path from images with spatial variation.

| Pattern | Scale factor result | AC coefficients |
|---------|--------------------|-----------------|
| Solid color (any) | scale = 0 | All at μ-law midpoint |
| Horizontal gradient | L/a/b scale > 0 | Non-zero in X-frequency bins |
| Vertical gradient | L/a/b scale > 0 | Non-zero in Y-frequency bins |
| 2D gradient | L/a/b scale > 0 | Non-zero in both axes |
| Checkerboard | scale > 0 | Energy in high-frequency bins |

For solid colors, test at least: white (255,255,255), black (0,0,0), neutral gray (128,128,128), pure red, pure green, pure blue, and an arbitrary mid-tone that exercises non-neutral a/b DC values.

For gradients, ensure both a horizontal-only and vertical-only case exist so that x-frequency and y-frequency AC paths are independently verified.

### Axis 5: Quantization Boundary Values

These cases target the clamping and rounding logic rather than general image variety.

**DC values near extremes:**
- Pure white → L_dc near 1.0, a_dc ≈ 0, b_dc ≈ 0 (encodes to byte 127, 64, 64)
- Pure black → L_dc = 0.0 (encodes to byte 0)
- Maximally saturated color that pushes |a_dc| or |b_dc| toward MAX_CHROMA (0.5) — tests clamping in the a/b DC encoder
- A color whose OKLAB a or b exceeds 0.5 (out-of-gamut for narrow-display input in wide-gamut mode) — must clamp, not overflow

**Scale factor = 0:**
When all pixels are identical, scale = 0. The AC encoder must still write valid bits (the μ-law midpoint value) rather than dividing by zero or writing garbage.

**μ-law boundary values (unit test):**
- v = 0.0 → midpoint of quantized range
- v = 1.0 and v = -1.0 → quantized to max/min
- Values landing exactly on 0.5 quantization steps → verify round-half-away-from-zero, not banker's rounding
- Test all three bit widths used: 4 bits (chroma AC, alpha AC), 5 bits (L AC no-alpha), 6 bits (L AC alpha low-freq)

**Aspect ratio boundary (unit test):**
- w/h = 1.0 → byte should be 128
- w/h = 4.0 → byte should be 255 (clamped)
- w/h = 0.25 → byte should be 0 (clamped)
- Ratios that land on exact half-integer byte steps → verify rounding

### Axis 6: Bit Packing

The 32-byte output is a tightly packed bitstream with no byte alignment between fields. Several fields straddle byte boundaries.

| Field | Bits | Byte boundary crossed? |
|-------|------|----------------------|
| L_dc | 0–6 | No |
| a_dc | 7–13 | Yes (crosses byte 0→1) |
| b_dc | 14–20 | Yes (crosses byte 1→2) |
| L_scale | 21–26 | Yes (crosses byte 2→3) |
| a_scale | 27–32 | Yes (crosses byte 3→4) |
| b_scale | 33–37 | No |
| aspect | 38–45 | Yes (crosses byte 4→5) |
| hasAlpha | 46 | No |
| reserved | 47 | No |

Unit tests for `writeBits`/`readBits` must cover writes that begin and end in different bytes. The reserved bit (bit 47) must be 0 in all encoder outputs and must be ignored (not rejected) by decoders.

### Axis 7: Round-trip Consistency

Encode→decode round-trips do not recover the exact original pixels (lossy format), but they must be deterministic: encoding the same input twice must produce the identical 32-byte hash, and decoding that hash must produce the identical pixel array.

| Check | What to verify |
|-------|---------------|
| Encode determinism | Same input → same 32 bytes, across multiple calls |
| Decode determinism | Same hash → same pixel array, across multiple calls |
| Cross-implementation | Rust hash == TypeScript hash == Kotlin hash == Swift hash == Go hash == Python hash == C# hash for the same input |
| Decode output dimensions | Decoder output w/h are derived from aspect byte, not stored exactly — verify they match the spec formula |

### Current Coverage Gaps

The following cases are not yet represented in `spec/test-vectors/` and should be added:

- Adobe RGB, BT.2020, and ProPhoto RGB gamut encode cases (only sRGB and Display P3 currently exist)
- 100×100 maximum-dimension image
- Fully transparent image (all α = 0)
- Uniform partial alpha (all pixels α = 128)
- Solid color with alpha mode triggered (hasAlpha=1 from a single transparent pixel)
- A color whose OKLAB a or b exceeds MAX_CHROMA (0.5) to exercise clamping
- Aspect ratio at exact clamp boundaries (100×1, 1×100)
- μ-law unit cases for 6-bit quantization (used only in alpha mode's low-frequency L AC)

---

## What to Check After Specific Changes

### Changed a constant or matrix in `spec/constants.py`

1. `python3 spec/validate.py` — verify derivation still holds
2. Update the constant in ALL seven implementations
3. Regenerate test vectors from Rust: `cd rust && cargo test -- --ignored generate_test_vectors --nocapture`
4. `just test` — all seven must pass

### Changed encoding logic

1. Update in ALL seven implementations (they must stay in sync)
2. Regenerate test vectors from Rust (it is the reference)
3. `just test` — all seven must pass against new vectors

### Changed decoding logic

1. Update in ALL seven implementations
2. Regenerate decode test vectors from Rust
3. `just test`

### Changed only one language implementation (bug fix)

1. `just test-<lang>` for the changed language
2. `just test` to confirm no regressions across all languages

### Changed the spec (`spec/README.md`)

1. Verify the spec text matches `constants.py`: `python3 spec/validate.py`
2. If the spec describes new behavior, ensure all seven implementations and test vectors reflect it
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
| `ci-go.yml` | `go/**` | fmt check, vet, test |
| `ci-python.yml` | `python/**` | fmt check, lint, test |
| `ci-csharp.yml` | `csharp/**` | fmt check, build (lint), test |

CI mirrors the local `just` commands. If local checks pass, CI should pass.

---

## Troubleshooting

### Tests pass locally but fail in CI

- Check tool versions match `.mise.toml` (node 24, java 21, gradle 9.4.0, swift 6.2.4, go 1.24, python 3.13, dotnet 9)
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
