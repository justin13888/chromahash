# ChromaHash v0.2 — Proposed Spec Improvements

**Status:** Research complete — ready for implementation
**Date:** 2026-03-16
**Base spec:** v0.1.0-draft (2026-03-11)

> This document captures all proposed changes for ChromaHash v0.2. No backwards
> compatibility is required — this is a clean spec iteration. v0.1 and v0.2
> hashes are **incompatible** — the version bit (bit 47) enables discrimination.

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Full-Resolution Encoding](#2-full-resolution-encoding)
3. [Adaptive Grid Geometry](#3-adaptive-grid-geometry)
4. [High-Res Color Accuracy](#4-high-res-color-accuracy)
5. [Portable Math Optimizations](#5-portable-math-optimizations)
6. [Decode Pipeline Improvements](#6-decode-pipeline-improvements)
7. [Spec Constant Tuning](#7-spec-constant-tuning)
8. [Version Discrimination](#8-version-discrimination)
9. [v0.1 Spec Sections Affected](#9-v01-spec-sections-affected)
10. [Test Vectors](#10-test-vectors)
11. [Open Questions](#11-open-questions)

---

## 1. Problem Statement

Two systematic quality issues dominate ChromaHash v0.1 output:

### 1.1 Gamma-Domain Averaging Error

Most image libraries (PIL, Go `image/draw`, browser canvas) resize in gamma
sRGB. The DC component — the single most important value, carrying ~80% of
visual energy — gets computed from a gamma-domain average rather than a
linear-light average.

**Concrete example:** Two pixels at sRGB 30 and sRGB 200:
- Gamma-domain average: sRGB 115
- Correct linear-light average: sRGB 144
- Error: **29/255 = 11.4%**

**Real-world impact:** 50% bright sky (sRGB 200) + 50% dark ground (sRGB 50):
- Gamma average: sRGB 125
- Correct linear average: sRGB 148
- Error: 23 sRGB units → ΔL = 0.052 in OKLAB ≈ **6.6 JND** (clearly visible)

This systematically **darkens midtones and crushes shadow detail**.

> **Note:** Sharp (used in the comparison tool) linearizes by default via
> Lanczos-3, so the comparison report does _not_ show this artifact — but most
> users in production will hit it.

### 1.2 Coefficient Waste on Non-Square Images

The fixed 7×7 luminance grid wastes coefficients for non-square images because
high-frequency terms along the shorter axis carry no useful information:

| Source aspect | Meaningful L AC | Wasted | Waste % |
|---------------|-----------------|--------|---------|
| 1:1           | 27              | 0      | 0%      |
| 2:1           | ~21             | ~6     | 22%     |
| 3:1           | ~14             | ~13    | 48%     |
| 4:1           | ~9              | ~18    | 67%     |
| 100:1         | ~6              | ~21    | 78%     |

For a 100×1 image with a fixed 7×7 grid: DCT y-cosine terms `cos(π·cy·0.5)` =
{1, 0, −1, 0, 1, 0, −1} for cy=0..6. Odd cy values produce identically zero
coefficients. Even cy>0 are just ±1 multiples of cx-only terms. Only 6 of 27 AC
carry unique information — **78% waste**.

### 1.3 Priority

The biggest wins come from **fixing the encoding pipeline** (gamma-domain DC
error), not from reshuffling bits within the header. The bit budget (256 bits) is
already well-allocated — no single reallocation yields more than ~5% quality
improvement.

---

## 2. Full-Resolution Encoding

### 2.1 Change

**Remove the ≤100×100 input dimension constraint** (spec §10.1). Accept any
image dimensions and compute DCT coefficients directly over all pixels.

The DCT formula works for any W×H:

```
F(cx,cy) = (1/WH) · Σ channel[x + y·W] · cos(π/W · cx · (x+0.5)) · cos(π/H · cy · (y+0.5))
```

The ≤100×100 constraint is purely an assertion; the DCT code is already correct
for arbitrary dimensions.

### 2.2 Why This Matters

**Four artifact categories from external downsampling:**

| Category | Severity | Detail |
|----------|----------|--------|
| Gamma-domain color averaging | **SEVERE** | DC gets 11.4% error (see §1.1). This is the dominant artifact. |
| Resampling filter roll-off | Moderate | At ChromaHash frequencies (cx=6 in a 4000px image = 0.0015× Nyquist), Lanczos-3 attenuation is ~0.1% — negligible. |
| 8-bit intermediate quantization | Negligible | ±0.002/channel. Averages out over ~10K pixels for DC; ~0.00002 noise per AC coefficient at 100×100. |
| Aliasing | Moderate | Textured content (fabric, foliage) can produce moiré if external resize doesn't fully anti-alias. |

**Full-resolution encoding eliminates all four**: every pixel is individually
linearized via EOTF LUT, converted to OKLAB individually, and the DC is the true
average in OKLAB space across all original pixels.

### 2.3 PSNR Improvement Estimates

| Scene type | Gamma error | DC error (OKLAB L) | Est. PSNR gain |
|------------|-------------|---------------------|----------------|
| Dark (sRGB 30–80 avg) | 15–20% | 0.05–0.08 (8–10 JND) | **3–5 dB** |
| High-contrast (sunset, backlit) | 10–15% | — | **2–4 dB** |
| Bright, even (sRGB 150–220 avg) | 3–5% | 0.01–0.02 (1–3 JND) | **1–2 dB** |

Estimates assume the user's external downsample is in gamma sRGB (the common
case). If their pipeline already linearizes (e.g., Sharp defaults), the gain is
smaller.

### 2.4 Approach

**Direct full-resolution DCT** (recommended over internal downsample):
- Mathematically optimal — no approximation from a resampling kernel
- Simpler — no Lanczos-3 implementation needed across seven languages
- Differentiator vs other LQIP formats

Fallback alternative: internal linear-light downsample (EOTF LUT → Lanczos-3 to
≤100×100 in float64 → OKLAB → DCT). ~30–50 ms for 12MP. Quality nearly
identical at ChromaHash's low frequencies, but requires implementing Lanczos-3 in
all seven languages.

---

## 3. Adaptive Grid Geometry

### 3.1 Design Decision

The DCT grid dimensions (nx, ny) are **derived deterministically from the aspect
byte**, which is already in the header. No mode flag, no reserved bit, no extra
storage. Grid geometry is self-describing.

This is a clean break from v0.1 — no backwards compatibility needed.

### 3.2 Grid Derivation Function

```
function deriveGrid(aspect_byte, base_n):
    ratio = 2^(aspect_byte / 255 * 4 - 2)    // same decode formula as spec §8.1

    if ratio >= 1.0:
        scale = min(ratio, 4.0)
        nx = round(base_n * scale^0.25)
        ny = round(base_n / scale^0.25)
    else:
        scale = min(1.0 / ratio, 4.0)
        nx = round(base_n / scale^0.25)
        ny = round(base_n * scale^0.25)

    nx = max(nx, 3)
    ny = max(ny, 3)
    return (nx, ny)
```

All `round()` calls use **round half away from zero** (spec §2.2). The `round()`
result is converted to integer before the `max()` clamping (necessary in
languages like Python where `round()` returns float).

The `scale^0.25` exponent provides **gentle adaptation** — the grid changes
slowly with aspect ratio, avoiding abrupt transitions. The `min(ratio, 4.0)`
clamping is defensive; the aspect byte encoding already constrains the ratio to
`[0.25, 4.0]`.

The `base_n` parameter selects the channel type:

| Channel | Mode | base_n | AC cap | Bit budget |
|---|---|---|---|---|
| L luminance | no-alpha | 7 | 27 | 27×5 = 135 bits |
| L luminance | alpha | 6 | 20 | 7×6 + 13×5 = 107 bits |
| a chroma | both | 4 | 9 | 9×4 = 36 bits |
| b chroma | both | 4 | 9 | 9×4 = 36 bits |
| Alpha | alpha | 3 | 5 | 5×4 = 20 bits |

### 3.2.1 Capping and Zero-Padding Rules

The **bit budget per channel is fixed** regardless of grid shape. This is the
fundamental invariant: the bitstream layout never changes — only the mapping from
bitstream positions to frequency coordinates changes.

**Encode (capping):** When `triangular_scan_order(nx, ny)` produces more AC
positions than the cap, the encoder computes all raw AC coefficients, then stores
only the first `cap` in scan order. Higher-frequency coefficients beyond the cap
are silently dropped.

**Encode (zero-padding):** When `triangular_scan_order(nx, ny)` produces fewer AC
positions than the cap (only occurs for alpha-mode luminance with 4×8 or 8×4
grids, which produce 19 vs cap 20), the encoder writes the real coefficients
followed by zero-valued padding to fill the remaining slots.

**Decode:** The decoder always reads exactly `cap` AC values from the bitstream.
It then derives the scan order from `deriveGrid` and maps values as follows:

1. Let `scan = triangular_scan_order(nx, ny)`, `n = min(cap, len(scan))`
2. The first `n` bitstream values map to scan positions `scan[0]` through
   `scan[n-1]`
3. If `len(scan) > cap`: positions beyond the cap have **implicit zero**
   coefficients (not stored in the bitstream, contribute zero to the inverse DCT)
4. If `len(scan) < cap`: the extra bitstream values (positions `len(scan)`
   through `cap-1`) are read and discarded — they are the zero padding the
   encoder wrote

### 3.3 No-Alpha Luminance Grid (base_n=7) — Exhaustive

The table below lists **every** unique (nx, ny) pair produced by `deriveGrid`
across all 256 aspect byte values. Implementations MUST handle all of them.

| Aspect bytes | Approx ratio | nx | ny | Raw AC | Stored |
|---|---|---|---|---|---|
| 0–15 | 1:4 – 1:3.4 | 5 | 10 | 29 | 27 |
| 16–38 | 1:3.4 – 1:2.6 | 5 | 9 | 28 | 27 |
| 39–56 | 1:2.6 – 1:2.2 | 6 | 9 | 32 | 27 |
| 57–100 | 1:2.2 – 3:4 | 6 | 8 | 29 | 27 |
| 101–102 | ~3:4 | 7 | 8 | 34 | 27 |
| 103–152 | 3:4 – 4:3 | 7 | 7 | 27 | 27 |
| 153–154 | ~4:3 | 8 | 7 | 34 | 27 |
| 155–198 | 4:3 – 2.2:1 | 8 | 6 | 29 | 27 |
| 199–216 | 2.2:1 – 2.6:1 | 9 | 6 | 32 | 27 |
| 217–239 | 2.6:1 – 3.4:1 | 9 | 5 | 28 | 27 |
| 240–255 | 3.4:1 – 4:1 | 10 | 5 | 29 | 27 |

11 unique grid shapes. The grid is symmetric: portrait grids mirror landscape
(e.g. 5×10 mirrors 10×5).

**Capping rule:** The bit budget is always **27 × 5 = 135 bits**. When the raw
triangular count exceeds the AC cap (27), take only the first 27 coefficients
in scan order (dropping the highest-frequency tail). When the raw count is
exactly 27 (the 7×7 square case), no capping is needed. All grids produce ≥ 27
raw AC, so no zero-padding is ever required for no-alpha luminance.

### 3.4 Chroma Grid (base_n=4) — Exhaustive

| Aspect bytes | Approx ratio | nx | ny | Raw AC | Stored |
|---|---|---|---|---|---|
| 0–10 | 1:4 – 1:3.6 | 3 | 6 | 11 | 9 |
| 11–78 | 1:3.6 – 1:1.7 | 3 | 5 | 10 | 9 |
| 79–84 | ~3:5 | 4 | 5 | 13 | 9 |
| 85–170 | 3:5 – 5:3 | 4 | 4 | 9 | 9 |
| 171–176 | ~5:3 | 5 | 4 | 13 | 9 |
| 177–244 | 5:3 – 3.6:1 | 5 | 3 | 10 | 9 |
| 245–255 | 3.6:1 – 4:1 | 6 | 3 | 11 | 9 |

7 unique grid shapes. All grids produce ≥ 9 raw AC, so no zero-padding is
required for chroma channels.

### 3.5 Alpha-Mode Luminance Grid (base_n=6) — Exhaustive

| Aspect bytes | Approx ratio | nx | ny | Raw AC | Stored |
|---|---|---|---|---|---|
| 0–21 | 1:4 – 1:3.2 | 4 | 8 | 19 | **19** |
| 22–45 | 1:3.2 – 1:2.4 | 5 | 8 | 25 | 20 |
| 46–95 | 1:2.4 – 1:1.4 | 5 | 7 | 22 | 20 |
| 96–98 | ~5:7 | 6 | 7 | 26 | 20 |
| 99–156 | 5:7 – 7:5 | 6 | 6 | 20 | 20 |
| 157–159 | ~7:5 | 7 | 6 | 26 | 20 |
| 160–209 | 7:5 – 2.4:1 | 7 | 5 | 22 | 20 |
| 210–233 | 2.4:1 – 3.2:1 | 8 | 5 | 25 | 20 |
| 234–255 | 3.2:1 – 4:1 | 8 | 4 | 19 | **19** |

9 unique grid shapes. The bitstream always encodes exactly 20 AC slots: 7 at 6
bits + 13 at 5 bits = 107 bits. For the 4×8 and 8×4 grids (19 raw AC
coefficients), the 20th slot is zero-padded by the encoder and discarded by the
decoder.

### 3.6 Alpha Channel Grid (base_n=3) — Exhaustive

| Aspect bytes | Approx ratio | nx | ny | Raw AC | Stored |
|---|---|---|---|---|---|
| 0–70 | 1:4 – 1:1.9 | 3 | 4 | 8 | 5 |
| 71–184 | 1:1.9 – 1.9:1 | 3 | 3 | 5 | 5 |
| 185–255 | 1.9:1 – 4:1 | 4 | 3 | 8 | 5 |

3 unique grid shapes. All grids produce ≥ 5 raw AC, so no zero-padding is
required for the alpha channel.

### 3.7 Quality Impact Example: 4:1 Panorama

**Fixed 7×7:** Only the top row (6 horizontal frequencies) carries useful
information. 67% waste.

**Adaptive 10×5:** All 27 coefficients meaningful — 9 horizontal frequencies (vs
6 before) plus well-distributed mixed and vertical terms. **50% more horizontal
frequency resolution.** Estimated PSNR improvement: 1–3 dB for images with
significant horizontal detail.

### 3.8 Implementation Note

`dct_encode`, `dct_decode_pixel`, and `triangular_scan_order` are already
parameterized on (nx, ny) and work correctly for any rectangular grid. The only
new code is `deriveGrid` (~15 lines per implementation).

---

## 4. High-Res Color Accuracy

### 4.1 DC Improvement

The DC component is the average color across all pixels. Full-resolution encoding
means every pixel is individually linearized and converted to OKLAB before
averaging, eliminating the gamma-domain error entirely.

Current small-image DC roundtrip errors (1×1 → encode → decode):

| Input RGB         | Output RGB        | Per-channel error |
|-------------------|-------------------|-------------------|
| (200, 100, 50)    | (202, 99, 47)     | ±2, ±1, ±3        |
| (255, 0, 0)       | (255, 11, 0)      | 0, **+11**, 0     |
| (0, 0, 255)       | (1, 0, 253)       | +1, 0, −2         |
| (0, 0, 0)         | (0, 0, 0)         | perfect            |
| (255, 255, 255)   | (255, 255, 255)   | perfect            |
| (128, 128, 128)   | (128, 128, 128)   | perfect            |

Pure red's +11 green-channel error: pure red in OKLAB has `a ≈ 0.276`, quantized
to index 99/127, introducing 0.002 OKLAB-a error, which the sRGB gamma curve
amplifies for saturated colors near the gamut boundary. This is a quantization
artifact, not a pipeline issue — it exists regardless of input resolution.

### 4.2 AC Improvement

For well-behaved resampling (Lanczos-3 in linear light), attenuation at
ChromaHash's low frequencies is negligible. The full-res advantage for AC is:
- No gamma-domain error propagating into frequency coefficients
- No 8-bit intermediate quantization noise
- Direct computation on original pixel values

---

## 5. Portable Math Optimizations

These optimizations make full-resolution encoding practical for large images
while preserving cross-platform determinism.

### 5.1 Performance Bottleneck Analysis (12MP / 4000×3000)

| Function | FLOPs/call | Calls (12MP) | Total FLOPs | Bottleneck? |
|----------|-----------|--------------|-------------|-------------|
| EOTF (`portable_pow`) | ~189 | 36M | 6.8G | **#1** |
| `cbrt_signed` (`portable_pow(x,1/3)`) | ~189 | 36M | 6.8G | **#2** |
| `portable_cos` (DCT) | ~21 | 18M | 378M | Moderate |
| `portable_ln` (µ-law) | ~120 | ~100 | 12K | No |
| `portable_exp` (µ-law) | ~68 | ~100 | 7K | No |

### 5.2 EOTF Lookup Table (eliminates bottleneck #1)

Input is always 8-bit RGBA → 256 possible values per channel. Precompute
`eotf_lut[256]` using existing `portable_pow` once at encode start.

- Replace 36M per-pixel `portable_pow` calls with table lookups
- Savings: 36M × 189 FLOPs → 256 × 189 FLOPs (effectively zero cost)
- Memory: 256 × 8 bytes = **2 KB** (LUT entries are float64, matching §2.3
  encode precision requirements)
- Determinism preserved: LUT built with the same `portable_pow`
- The EOTF LUT applies to RGB channels only. The alpha channel is linearly
  normalized: `alpha = rgba[i*4+3] / 255.0` with no transfer function applied.

The LUT is per-gamut (sRGB transfer function for sRGB/Display P3, gamma 2.2 for
Adobe RGB, BT.1886 for SDR BT.2020, gamma 1.8 for ProPhoto RGB), but only one
is needed per encode call. For HDR BT.2020 PQ content (10/12-bit), the encoder
MUST tone-map to SDR first (per v0.1 §5.4), after which BT.1886 applies to the
8-bit SDR result.

```
function precompute_eotf_lut(gamut):
    lut = array[256] of float64
    for i in 0..255:
        x = i / 255.0
        lut[i] = eotf[gamut](x)    // sRGB piecewise, Adobe gamma 2.2, etc.
    return lut
```

### 5.3 IEEE 754 Bit-Seed Cube Root (eliminates bottleneck #2)

Replace `portable_pow(x, 1/3)` with an IEEE 754 bit-manipulation seed followed
by 3 Halley iterations:

```
cbrt(x):
    if x == 0: return 0
    sign = (x < 0); if sign: x = -x

    // Seed: reinterpret double as uint64, divide biased exponent by 3
    bits = double_to_uint64(x)
    signed_bits = reinterpret_as_int64(bits)              // cast to signed
    seed_signed = (signed_bits - (1023 << 52)) / 3 + (1023 << 52)  // signed int64
    seed = reinterpret_as_uint64(seed_signed)             // cast back
    y = uint64_to_double(seed)                            // ~5% initial error

    // 3 Halley iterations (cubic convergence), FMA-safe decomposition:
    repeat 3 times:
        t1 = y * y;   y3 = t1 * y        // 2 roundings
        t2 = 2.0 * x; num = y3 + t2      // 2 roundings (no FMA)
        t3 = 2.0 * y3; den = t3 + x      // 2 roundings (no FMA)
        t4 = y * num; y = t4 / den        // 2 roundings

    return sign ? -y : y
```

**Signed arithmetic note:** The subtraction `signed_bits - (1023 << 52)` and
subsequent division MUST use **signed 64-bit integer** arithmetic. For inputs
`x < 1.0` (the common case for LMS values), the biased exponent is less than
1023, making the subtraction result negative. In unsigned types (`u64`,
`uint64`, `UInt64`, `ULong`), this wraps to a huge positive number, producing a
garbage seed. All 7 target languages support signed `int64` natively with zero
performance difference.

**Division semantics:** Either truncation-toward-zero (Rust, Go, C#, Swift,
Kotlin) or floor division (Python) is acceptable for the seed computation. Both
produce seeds within 1 ULP of each other, and 3 Halley iterations converge
regardless (verified: max error stays ≤ 2 ULP).

**~26 FLOPs total. Verified across full LMS domain [1e-6, 3.0]: max error ≤ 2
ULP (rel_err < 4e-16).**

**Why cbrt is a bottleneck:** OKLAB forward transform does `cbrt(lms[i])` per
pixel per channel = 36M calls at 12MP. After EOTF LUT eliminates bottleneck #1,
cbrt dominates encode time.

| Property | `portable_pow(x,1/3)` | **Bit-seed + 3 Halley** |
|---|---|---|
| FLOPs | ~189 | **~26** |
| Max rel error | <1e-15 | **<4e-16 (≤2 ULP)** |
| SIMD-friendly | No | **Yes (branchless core)** |
| Portability | All languages | **All 7 languages** |

All seven languages have double↔uint64 reinterpretation APIs:

| Language | To bits | From bits | Signed type |
|----------|---------|-----------|-------------|
| Rust | `f64::to_bits()` → `u64` | `f64::from_bits(u64)` | cast `as i64` / `as u64` |
| Go | `math.Float64bits()` → `uint64` | `math.Float64frombits(uint64)` | cast `int64(bits)` / `uint64(seed)` |
| TypeScript | `DataView.setFloat64()` / `getBigUint64()` | `setBigUint64()` / `getFloat64()` | `BigInt` handles sign natively |
| Python | `struct.pack('d', x)` / `struct.unpack('Q', ...)` | `struct.pack('Q', seed)` / `struct.unpack('d', ...)` | `struct.unpack('q', ...)` for signed |
| Kotlin | `Double.doubleToRawLongBits()` → `Long` | `Double.longBitsToDouble(Long)` | `Long` is signed int64 |
| Swift | `Double.bitPattern` → `UInt64` | `Double(bitPattern: UInt64)` | `Int64(bitPattern: bits)` |
| C# | `BitConverter.DoubleToInt64Bits()` → `long` | `BitConverter.Int64BitsToDouble(long)` | `long` is signed int64 |

**FMA hazard:** Some CPUs compute `a*b+c` with single rounding (FMA) instead of
two. The Halley iteration above decomposes each step into explicit
sub-expressions with named temporaries, forcing intermediate rounding.

**Language-specific FMA mitigations:**

| Language | Strategy |
|----------|----------|
| Rust | Explicit `let` bindings (no auto-FMA) |
| TypeScript | No FMA in language spec; V8/SpiderMonkey don't use for basic ops |
| Go | Explicit temporaries (or `go:noinline`) |
| Python | CPython interprets bytecode — safe |
| Kotlin/JVM | `strictfp` keyword (JVM < 17); on JVM 17+ (JEP 306), strict IEEE 754 semantics are the default — `strictfp` is a no-op |
| Swift | Explicit temporaries |
| C# | JIT may emit FMA; use explicit temporaries; consider `[MethodImpl(MethodImplOptions.NoOptimization)]` if needed |

**Python division semantics note:** Python MUST use integer floor division
(`//`), not float division (`/`), for the seed computation. `int(bits) // 3`
produces an integer; `int(bits) / 3` produces a float, breaking subsequent bit
manipulation.

### 5.4 Cosine Precomputation (reduces DCT cost ~40×)

For a W×H image with a max grid dimension of 10, precompute `cos_x[cx][x]` for
cx ∈ [0, max_cx], x ∈ [0, W−1] and similarly for y.

- max_grid × W + max_grid × H cosine evaluations precomputed once, reused for
  all coefficients
- For 4000×3000: **~70K calls instead of 18M** (99.6% reduction)
- Determinism preserved: uses the same `portable_cos`, just cached
- Memory for 12MP (4000×3000), max grid dim 10:
  - X table: 10 × 4000 × 8 bytes = 312 KB
  - Y table: 10 × 3000 × 8 bytes = 234 KB
  - **Total: ~547 KB**

```
function precompute_cos_table(dim, max_freq):
    table = array[max_freq][dim] of float64
    for freq in 0 .. max_freq-1:
        for pos in 0 .. dim-1:
            table[freq][pos] = portable_cos(pi / dim * freq * (pos + 0.5))
    return table
```

### 5.5 Combined Performance Estimate (12MP, single-threaded Rust)

| Configuration | Estimated time |
|---------------|----------------|
| Current (≤100×100 only) | <1 ms |
| Naive full-res (no optimizations) | ~7 s |
| + EOTF LUT only | ~3.8 s |
| + Bit-seed Halley cbrt | ~550 ms |
| + Cosine precomputation | ~430 ms |
| + All portable optimizations | ~400 ms |

**By image size (all portable optimizations, single-threaded):**

| Image size | Rust | Python (est.) | TypeScript (est.) | Kotlin (est.) |
|------------|------|---------------|-------------------|---------------|
| 100×100 | <1 ms | ~50 ms | ~5 ms | ~2 ms |
| 1MP (1000×1000) | ~35 ms | ~2 s | ~200 ms | ~80 ms |
| 4MP (2000×2000) | ~140 ms | ~8 s | ~800 ms | ~350 ms |
| 12MP (4000×3000) | ~400 ms | ~25 s | ~3 s | ~1 s |
| 24MP (6000×4000) | ~800 ms | ~50 s | ~6 s | ~2 s |

---

## 6. Decode Pipeline Improvements

### 6.1 Soft Gamut Clamping (Oklch Bisection)

**Current behavior:** Hard clamping in linear RGB (`clamp01(rgb_linear[ch])`).
Out-of-sRGB OKLAB values are clipped per-channel.

**Problem:** Hard clipping shifts hue. A slightly-out-of-gamut orange-red clips R
to 1.0 while G and B remain, shifting the perceived color toward yellow.

**Proposed:** Fixed 16-step Oklch bisection. Preserves lightness L and hue h;
only reduces chroma C until all RGB channels fit [0, 1].

**Helper definitions:**

```
function oklabToLinearRgb(L, a, b):
    // OKLAB → LMS cube-root → LMS → linear sRGB (same as spec §4.3 inverse)
    lms_cbrt = M2_inv × [L, a, b]
    lms = [lms_cbrt[0]³, lms_cbrt[1]³, lms_cbrt[2]³]
    return M1_inv_sRGB × lms

function inGamut(rgb):
    // Exact IEEE 754 comparison, no epsilon
    return rgb[0] >= 0.0 and rgb[0] <= 1.0
       and rgb[1] >= 0.0 and rgb[1] <= 1.0
       and rgb[2] >= 0.0 and rgb[2] <= 1.0
```

**Algorithm:**

```
function softGamutClamp(L, a, b):
    rgb = oklabToLinearRgb(L, a, b)
    if inGamut(rgb):                          // all channels in [0, 1]
        return (L, a, b)

    C = sqrt(a*a + b*b)
    if C < 1e-10:
        return (L, 0.0, 0.0)                 // achromatic edge case

    h_cos = a / C
    h_sin = b / C

    lo = 0.0
    hi = C
    for i in 0..15:                           // exactly 16 iterations
        mid = (lo + hi) / 2.0
        a_test = mid * h_cos
        b_test = mid * h_sin
        rgb = oklabToLinearRgb(L, a_test, b_test)
        if inGamut(rgb):
            lo = mid
        else:
            hi = mid

    return (L, lo * h_cos, lo * h_sin)       // lo is last known in-gamut
```

**Precondition:** L must be in [0, 1]. The caller is responsible for clamping L
before calling this function. DCT ringing can produce `L < 0` or `L > 1`, and
`softGamutClamp` only reduces chroma — it cannot fix L-induced gamut violations.

Properties:
- **Deterministic:** fixed 16 iterations, no early exit, uses only basic IEEE 754
  ops
- **Precision:** C / 2^16 < 1.5e-5 — far below quantization noise
- **Hue-preserving:** only reduces chroma; lightness and hue angle unchanged
- **Cost:** Applied per-pixel at decode resolution (~32×32), negligible

Most real photos don't hit this, but when it occurs soft clamping is noticeably
better.

**FMA note:** Implementations MAY produce ±1 LSB variation at 8-bit output for
pixels near the sRGB gamut boundary due to FMA and floating-point rounding
differences in `oklabToLinearRgb`. This is acceptable — the decode path already
tolerates float32 precision per §2.3, and the bisection precision (`C/2^16 <
1.5e-5`) is far below 1/255.

### 6.2 sRGB Gamma LUT for Decode

**Current:** `portable_pow(x, 1/2.4)` per channel per pixel. At 32×32×3 = 3072
calls, this accounts for ~25% of total decode time.

**Proposed:** 4096-entry LUT mapping 12-bit linear input to 8-bit sRGB output,
with linear interpolation.

```
function buildGammaLut():
    lut = array[4096] of uint8
    for i in 0..4095:
        x = i / 4095.0                       // linear [0, 1]
        if x <= 0.0031308:
            srgb = 12.92 * x
        else:
            srgb = 1.055 * portable_pow(x, 1/2.4) - 0.055
        lut[i] = round(clamp(srgb, 0.0, 1.0) * 255.0)
    return lut

function linearToSrgb8(x, lut):
    idx = clamp(round(x * 4095.0), 0, 4095)
    return lut[idx]
```

- Speedup: **~40× per call** (3 FLOPs vs 120 FLOPs)
- Quality loss: **at most ±1 LSB** (12-bit linear → 8-bit sRGB quantization)
- Memory: 4096 × 1 byte = **4 KB**

---

## 7. Spec Constant Tuning

### 7.1 Tighten MAX_CHROMA from 0.5 to 0.45

The current spec (§12.1) notes these are "preliminary values." Actual gamut
coverage analysis:

| Gamut | Max |a| | % of 0.5 used | Max |b| | % of 0.5 used |
|-------|---------|---------------|---------|---------------|
| sRGB | 0.275 | 55% | 0.312 | 62% |
| Display P3 | 0.316 | 63% | 0.321 | 64% |
| Adobe RGB | 0.347 | 69% | 0.316 | 63% |
| BT.2020 | 0.416 | 83% | 0.347 | 69% |
| ProPhoto RGB | 1.346 | 269% (clips) | 0.427 | 85% |

For sRGB (vast majority of images): **45% of the a-axis and 38% of the b-axis
quantization range is wasted.**

**Decision:** Tighten to `MAX_CHROMA_A = MAX_CHROMA_B = 0.45`. Covers BT.2020
(max |a| = 0.416) with margin. **~11% better quantization precision.** ProPhoto
RGB already clips at 0.5 and would continue to clip at 0.45 — no regression for
real-world content since the encoded values are always in OKLAB space relative to
the source gamut.

### 7.2 Validate µ-law Parameter (µ = 5) — Deferred

**Decision:** Keep µ = 5 (no change). No empirical data to justify a change.
Sweep µ ∈ {3, 4, 5, 6, 7} deferred to v0.3 with a reference corpus.

---

## 8. Version Discrimination

### 8.1 Version Bit (Bit 47)

Set reserved bit 47 to **1 for v0.2** (was 0 in v0.1). This provides zero-cost
version discrimination: v0.1 decoders already ignore this bit.

| Version | Bit 47 |
|---------|--------|
| v0.1    | 0      |
| v0.2    | 1      |

**Encoders MUST set bit 47 to 1 for v0.2.** Decoders SHOULD check bit 47 to
select the appropriate decode path.

### 8.2 Compatibility Note

v0.1 and v0.2 hashes are **not interchangeable**. Even though the bit positions
are unchanged, the **semantics** differ:
- MAX_CHROMA 0.5 → 0.45 changes DC dequantization
- Adaptive grid changes AC coefficient assignment for non-square images
- Soft gamut clamping changes decode output for out-of-gamut pixels

A v0.1 decoder applied to a v0.2 hash will produce subtly wrong colors and grid
geometry. The version bit enables correct routing.

A v0.2 implementation MAY support decoding v0.1 hashes (bit 47 = 0) by falling
back to fixed grids, MAX_CHROMA=0.5, and hard gamut clamping. This is OPTIONAL.

---

## 9. v0.1 Spec Sections Affected

| v0.1 Section | Change |
|---|---|
| §2.3 Numerical Precision | v0.2 requires int64/uint64 bit reinterpretation for Halley cbrt seed computation (see §5.3) |
| §2.4 Cube Root of Negative Values | Superseded by Halley implementation: `portable_pow(x, 1/3)` replaced by bit-seed + 3 Halley iterations (see §5.3) |
| §2.5 Reserved Bits | Bit 47: "Encoders MUST set to 1 for v0.2" (was 0) |
| §6.3 Coefficient Count Formula | Note that `N×(N+1)/2−1` applies only to square grids; for adaptive grids use `triangular_scan_order(nx, ny)` and apply the AC cap |
| §6.4 Triangular Patterns | Add non-square grid examples; note that v0.2 grids produce up to 11 unique shapes per channel |
| §6.5 Grid Size Assignments | Replace "fixed" with `deriveGrid(byte, base_n)`; add base_n table and exhaustive grid listings |
| §6.6 Scan Order | Already works for non-square grids (no change needed) |
| §10.1 Input Requirements | Remove `w ≤ 100, h ≤ 100` constraint |
| §10.2 Encode Pseudocode | Full-res pipeline: EOTF LUT, bit-seed Halley cbrt, cosine precompute, deriveGrid |
| §11.1 Decode Pseudocode | Replace all hardcoded grid dimensions (`lx=7/6`, `ly=7/6`, `for cy in 0..3`, `while cx < 4-cy`) with `deriveGrid`-derived (nx, ny); map bitstream values to scan positions via §3.2.1 capping rules; soft gamut clamp replaces hard clamp; sRGB gamma LUT replaces per-pixel `portable_pow` |
| §12.1 Constants | MAX_CHROMA_A = MAX_CHROMA_B = 0.45 (was 0.5) |
| §12.7 Helpers | Add `deriveGrid`, `softGamutClamp`, replace `cbrt_signed` with bit-seed Halley |
| §13.2 Computational Cost | Update for full-res encoding (~400ms for 12MP Rust) |
| §13.5 Gamut Clamping | Replace hard clamp with soft Oklch bisection |
| §3.1 Header Bit Layout | Bit 47 changes from `reserved = 0` to `version`: `0 = v0.1, 1 = v0.2` |
| §5.3 Decode Pipeline | v0.2 inserts `clamp(L)` + `softGamutClamp` after OKLAB reconstruction and replaces per-pixel gamma with LUT |
| §8 Aspect Encoding | Formula unchanged, but the aspect byte now also drives adaptive grid geometry via `deriveGrid` (see §3.2) |
| §9 Alpha Support Bit Budget | Grid dimensions are no longer fixed (`L 7×7 / 6×6`); they vary per `deriveGrid(aspect, base_n=7/6)`. Bit budgets remain the same. |
| §11.2 Average Color | Dequantize `a_dc`, `b_dc` with `MAX_CHROMA=0.45`; check version bit to select correct `MAX_CHROMA` |
| Appendix A | Update ThumbHash comparison: grid type is now adaptive (not "7×7 fixed"); gamut clamping is now soft Oklch bisection (not hard per-channel clip); input dimensions are unlimited (not ≤100×100); decode includes gamma LUT |

Sections unchanged: §4 (OKLAB), §5.1–5.2 (multi-gamut encoding), §7
(quantization formulas).

---

## 10. Test Vectors

All 7 JSON files in `spec/test-vectors/` must be **regenerated** under v0.2 due
to:
- MAX_CHROMA 0.5 → 0.45 (changes DC quantization)
- Adaptive grid geometry (changes AC coefficient assignment for non-square inputs)
- Soft gamut clamping (changes decode output for out-of-gamut pixels)

**Action:** Regenerate from Rust reference implementation after implementing v0.2
changes.

**New test vector categories for v0.2:**

- `unit-dct.json`: add non-square grid scan orders (e.g. 5×10, 8×6, 3×5, 4×8)
  — purely mathematical, no implementation dependency
- `unit-aspect.json`: add `deriveGrid` test cases mapping aspect bytes → (nx, ny)
  for all `base_n` values (7, 4, 6, 3)
- `unit-bitpack.json`: create missing file (referenced in README but absent) with
  `writeBits`/`readBits` round-trip tests at various bit positions and widths
- New unit tests for `softGamutClamp` (out-of-gamut inputs → clamped outputs) —
  requires Rust reference implementation for expected values. JSON schema:
  `{"input": {"L": float, "a": float, "b": float}, "expected": {"L": float, "a": float, "b": float}}`
- New unit tests for Halley `cbrt` (verify ≤2 ULP vs `portable_pow` across
  domain) — requires Rust reference implementation for expected values. JSON
  schema: `{"input": float, "expected": float, "max_ulp_error": int}`

---

## 11. Open Questions

These require empirical validation on a reference image corpus before finalizing:

1. **PSNR improvement from full-resolution encoding:** Estimates in §2.3 assume
   gamma-domain external downsampling. Need to measure on the 15 natural
   photographs (≥12MP from Picsum/Unsplash) and 37 synthetic fixtures.

2. **Adaptive grid quality gain:** Measure PSNR/SSIM for non-square images
   (especially 3:1+ panoramas and 9:16 vertical photos) with fixed vs adaptive
   grid.

3. **µ-law parameter sweep:** Sweep µ ∈ {3, 4, 5, 6, 7} — is µ = 5 actually
   optimal? (Deferred to v0.3.)

4. **MAX_CHROMA sweet spot:** 0.45 is conservative. Would 0.40 or 0.42 be
   better for sRGB/P3-dominated workloads without clipping BT.2020 in practice?

5. **Soft gamut clamping perceptibility:** On how many real photos does hard vs
   soft clamping produce a visible difference?

6. **Decode min dimension:** At 4:1 extreme with base_n=3, short side = 3px
   (from `max(ny, 3)` floor). Acceptable for placeholder quality.

---

## Appendix: Encode Architecture (Pseudocode)

`dct_encode_separable` is semantically identical to the v0.1 `dctEncode` (§12.7)
but uses precomputed cosine tables from §5.4 instead of computing cosines inline.
The DCT formula is unchanged — only the evaluation strategy differs.

```
function dct_encode_separable(channel, W, H, nx, ny, cos_x, cos_y):
    // Identical to v0.1 dctEncode but uses precomputed cos_x[cx][x], cos_y[cy][y]
    dc = 0; ac = []; scale = 0
    for cy in 0 .. ny-1:
        for cx in 0 .. while cx*ny < nx*(ny-cy):
            f = 0
            for y in 0 .. H-1:
                for x in 0 .. W-1:
                    f += channel[x + y*W] * cos_x[cx][x] * cos_y[cy][y]
            f /= W * H
            if cx > 0 or cy > 0:
                ac.append(f)
                scale = max(scale, abs(f))
            else:
                dc = f
    return (dc, ac, scale)

function encode_image(W, H, rgba, gamut):
    // --- Step 1: Precompute EOTF LUT ---
    lut = precompute_eotf_lut(gamut)              // 256 entries, 2KB; v0.2

    // --- Step 2: Per-pixel OKLAB conversion ---
    oklab_pixels = array[W*H * 3] of float64
    alpha_pixels = array[W*H] of float64
    avg_L = 0; avg_a = 0; avg_b = 0; avg_alpha = 0

    for i in 0 .. W*H-1:
        alpha = rgba[i*4 + 3] / 255.0
        r_lin = lut[rgba[i*4 + 0]]               // EOTF LUT lookup; v0.2
        g_lin = lut[rgba[i*4 + 1]]               // replaces eotf(x/255.0); v0.2
        b_lin = lut[rgba[i*4 + 2]]               // v0.2

        lms = M1[gamut] × [r_lin, g_lin, b_lin]
        lms_cbrt = [cbrt_halley(lms[0]), cbrt_halley(lms[1]), cbrt_halley(lms[2])]  // v0.2: replaces cbrt_signed
        lab = M2 × lms_cbrt

        avg_L += alpha * lab[0]
        avg_a += alpha * lab[1]
        avg_b += alpha * lab[2]
        avg_alpha += alpha

        oklab_pixels[i*3 + 0] = lab[0]
        oklab_pixels[i*3 + 1] = lab[1]
        oklab_pixels[i*3 + 2] = lab[2]
        alpha_pixels[i] = alpha

    // --- Step 3: Compute alpha-weighted average color ---
    // (from v0.1 §10.2 step 3) If all pixels fully transparent, default to black.
    if avg_alpha > 0:
        avg_L /= avg_alpha
        avg_a /= avg_alpha
        avg_b /= avg_alpha
    else:
        avg_L = 0; avg_a = 0; avg_b = 0

    // --- Step 4: Composite transparent pixels over average ---
    // (from v0.1 §10.2 step 4)
    hasAlpha = avg_alpha < W * H
    L_chan = array[W*H] of float64
    a_chan = array[W*H] of float64
    b_chan = array[W*H] of float64

    for i in 0 .. W*H-1:
        alpha = alpha_pixels[i]
        L_chan[i] = avg_L * (1 - alpha) + alpha * oklab_pixels[i*3 + 0]
        a_chan[i] = avg_a * (1 - alpha) + alpha * oklab_pixels[i*3 + 1]
        b_chan[i] = avg_b * (1 - alpha) + alpha * oklab_pixels[i*3 + 2]

    // --- Step 5: Derive adaptive grid dimensions ---         // v0.2
    aspect_byte = encode_aspect(W, H)
    if hasAlpha:
        (L_nx, L_ny) = deriveGrid(aspect_byte, base_n=6)     // v0.2
        (A_nx, A_ny) = deriveGrid(aspect_byte, base_n=3)     // v0.2
    else:
        (L_nx, L_ny) = deriveGrid(aspect_byte, base_n=7)     // v0.2
    (C_nx, C_ny) = deriveGrid(aspect_byte, base_n=4)         // v0.2

    // --- Step 6: Precompute cosine tables ---                // v0.2
    // A_nx ≤ L_nx and A_ny ≤ L_ny for all aspect bytes (base_n=3 ≤ base_n=6),
    // so alpha channel reuses the same cosine tables.
    max_cx = max(L_nx, C_nx)
    max_cy = max(L_ny, C_ny)
    cos_x = precompute_cos_table(W, max_cx)                  // v0.2
    cos_y = precompute_cos_table(H, max_cy)                  // v0.2

    // --- Step 7: DCT encode each channel ---
    (L_dc, L_ac, L_scale) = dct_encode_separable(L_chan, W, H, L_nx, L_ny, cos_x, cos_y)
    (a_dc, a_ac, a_scale) = dct_encode_separable(a_chan, W, H, C_nx, C_ny, cos_x, cos_y)
    (b_dc, b_ac, b_scale) = dct_encode_separable(b_chan, W, H, C_nx, C_ny, cos_x, cos_y)
    if hasAlpha:
        (A_dc, A_ac, A_scale) = dct_encode_separable(alpha_pixels, W, H, A_nx, A_ny, cos_x, cos_y)

    // Cap to bit budget; zero-pad if under cap (v0.2)
    L_cap = 20 if hasAlpha else 27
    L_ac = L_ac[0 .. L_cap-1]          // drop highest-frequency tail if over cap
    while len(L_ac) < L_cap: L_ac.append(0)  // zero-pad if under cap (4×8/8×4 grids)
    a_ac = a_ac[0..8]; b_ac = b_ac[0..8]     // chroma cap=9; always ≥9 raw AC
    if hasAlpha: A_ac = A_ac[0..4]            // alpha cap=5; always ≥5 raw AC

    // --- Step 8: Quantize header values ---
    L_dc_q  = round(127 * clamp(L_dc, 0, 1))
    a_dc_q  = round(64 + 63 * clamp(a_dc / MAX_CHROMA_A, -1, 1))
    b_dc_q  = round(64 + 63 * clamp(b_dc / MAX_CHROMA_B, -1, 1))
    L_scl_q = round(63 * clamp(L_scale / MAX_L_SCALE, 0, 1))
    a_scl_q = round(63 * clamp(a_scale / MAX_A_SCALE, 0, 1))
    b_scl_q = round(31 * clamp(b_scale / MAX_B_SCALE, 0, 1))

    // --- Step 9: Pack header (48 bits = 6 bytes, little-endian) ---
    header = L_dc_q
           | (a_dc_q << 7)
           | (b_dc_q << 14)
           | (L_scl_q << 21)
           | (a_scl_q << 27)
           | (b_scl_q << 33)
           | (aspect_byte << 38)
           | ((1 if hasAlpha else 0) << 46)
           | (1 << 47)                          // v0.2: version bit = 1

    hash = new byte[32]
    for i in 0..5: hash[i] = (header >> (i * 8)) & 0xFF

    // --- Step 10: Pack AC coefficients with µ-law companding ---
    // quantizeAC: normalize by scale; when scale=0 (solid color), write midpoint
    function quantizeAC(value, scale, mu, bits):
        if scale == 0:
            return muLawQuantize(0, mu, bits)
        return muLawQuantize(value / scale, mu, bits)

    bitpos = 48

    if hasAlpha:
        A_dc_q  = round(31 * clamp(A_dc, 0, 1))
        A_scl_q = round(15 * clamp(A_scale / MAX_A_ALPHA_SCALE, 0, 1))
        writeBits(hash, bitpos, 5, A_dc_q);  bitpos += 5
        writeBits(hash, bitpos, 4, A_scl_q); bitpos += 4

        for i in 0..6:                          // first 7 alpha-mode L AC at 6 bits
            q = quantizeAC(L_ac[i], L_scale, 5, 6)
            writeBits(hash, bitpos, 6, q); bitpos += 6
        for i in 7..19:                         // remaining 13 alpha-mode L AC at 5 bits
            q = quantizeAC(L_ac[i], L_scale, 5, 5)
            writeBits(hash, bitpos, 5, q); bitpos += 5
    else:
        for i in 0..26:                         // 27 no-alpha L AC at 5 bits each
            q = quantizeAC(L_ac[i], L_scale, 5, 5)
            writeBits(hash, bitpos, 5, q); bitpos += 5

    for i in 0..8:                              // 9 a-chroma AC at 4 bits each
        q = quantizeAC(a_ac[i], a_scale, 5, 4)
        writeBits(hash, bitpos, 4, q); bitpos += 4

    for i in 0..8:                              // 9 b-chroma AC at 4 bits each
        q = quantizeAC(b_ac[i], b_scale, 5, 4)
        writeBits(hash, bitpos, 4, q); bitpos += 4

    if hasAlpha:
        for i in 0..4:                          // 5 alpha AC at 4 bits each
            q = quantizeAC(A_ac[i], A_scale, 5, 4)
            writeBits(hash, bitpos, 4, q); bitpos += 4

    assert bitpos == 256
    return hash
```

## Appendix: Decode Architecture (Pseudocode)

Complete v0.2 decode algorithm. Changes from v0.1 are marked with `// v0.2`.

```
function decode(hash):
    // 1. Unpack header (identical to v0.1 §11.1 steps 1-4)
    header = 0
    for i in 0..5: header |= hash[i] << (i * 8)

    L_dc_q  = header & 0x7F
    a_dc_q  = (header >> 7) & 0x7F
    b_dc_q  = (header >> 14) & 0x7F
    L_scl_q = (header >> 21) & 0x3F
    a_scl_q = (header >> 27) & 0x3F
    b_scl_q = (header >> 33) & 0x1F
    aspect  = (header >> 38) & 0xFF
    hasAlpha = (header >> 46) & 1
    version = (header >> 47) & 1                    // v0.2: read version bit

    // 2. Decode DC and scale factors
    L_dc    = L_dc_q / 127.0
    a_dc    = (a_dc_q - 64) / 63.0 * MAX_CHROMA_A  // v0.2: MAX_CHROMA = 0.45
    b_dc    = (b_dc_q - 64) / 63.0 * MAX_CHROMA_B
    L_scale = L_scl_q / 63.0 * MAX_L_SCALE
    a_scale = a_scl_q / 63.0 * MAX_A_SCALE
    b_scale = b_scl_q / 31.0 * MAX_B_SCALE

    // 3. Derive adaptive grid dimensions                // v0.2: replaces fixed grids
    if hasAlpha:
        (L_nx, L_ny) = deriveGrid(aspect, base_n=6)
        (A_nx, A_ny) = deriveGrid(aspect, base_n=3)
    else:
        (L_nx, L_ny) = deriveGrid(aspect, base_n=7)
    (C_nx, C_ny) = deriveGrid(aspect, base_n=4)

    // 4. Compute scan orders and determine usable AC count
    L_scan = triangular_scan_order(L_nx, L_ny)
    C_scan = triangular_scan_order(C_nx, C_ny)

    if hasAlpha:
        A_scan = triangular_scan_order(A_nx, A_ny)
        L_cap = 20; C_cap = 9; A_cap = 5
    else:
        L_cap = 27; C_cap = 9

    // Usable coefficients: min of cap and actual scan order length
    L_usable = min(L_cap, len(L_scan))
    C_usable = min(C_cap, len(C_scan))

    // 5. Decode aspect ratio and output size (unchanged from v0.1)
    ratio = 2^(aspect / 255.0 * 4 - 2)
    if ratio > 1: w = 32; h = round(32 / ratio)
    else:         w = round(32 * ratio); h = 32

    // 6. Dequantize AC from bitstream (read exactly cap values per channel)
    bitpos = 48

    if hasAlpha:
        A_dc    = readBits(hash, bitpos, 5) / 31.0;                     bitpos += 5
        A_scale = readBits(hash, bitpos, 4) / 15.0 * MAX_A_ALPHA_SCALE; bitpos += 4
        A_usable = min(A_cap, len(A_scan))

        L_ac_raw = []
        for i in 0..6:                                  // first 7 at 6 bits
            L_ac_raw.append(muLawDequantize(readBits(hash, bitpos, 6), 5, 6) * L_scale)
            bitpos += 6
        for i in 7..19:                                 // remaining 13 at 5 bits
            L_ac_raw.append(muLawDequantize(readBits(hash, bitpos, 5), 5, 5) * L_scale)
            bitpos += 5
    else:
        L_ac_raw = []
        for i in 0..26:                                 // all 27 at 5 bits
            L_ac_raw.append(muLawDequantize(readBits(hash, bitpos, 5), 5, 5) * L_scale)
            bitpos += 5

    a_ac_raw = []
    for i in 0..8:                                      // 9 at 4 bits
        a_ac_raw.append(muLawDequantize(readBits(hash, bitpos, 4), 5, 4) * a_scale)
        bitpos += 4

    b_ac_raw = []
    for i in 0..8:
        b_ac_raw.append(muLawDequantize(readBits(hash, bitpos, 4), 5, 4) * b_scale)
        bitpos += 4

    if hasAlpha:
        A_ac_raw = []
        for i in 0..4:                                  // 5 at 4 bits
            A_ac_raw.append(muLawDequantize(readBits(hash, bitpos, 4), 5, 4) * A_scale)
            bitpos += 4

    // 7. Map bitstream AC values to (cx, cy) coefficient grids
    //    Only the first 'usable' bitstream values have corresponding grid positions.
    //    Grid positions beyond 'cap' have implicit zero coefficients.
    L_coeff = sparse grid initialized to 0.0
    for j in 0 .. L_usable-1:
        (cx, cy) = L_scan[j]
        L_coeff[cx][cy] = L_ac_raw[j]

    C_coeff_a = sparse grid initialized to 0.0
    C_coeff_b = sparse grid initialized to 0.0
    for j in 0 .. C_usable-1:
        (cx, cy) = C_scan[j]
        C_coeff_a[cx][cy] = a_ac_raw[j]
        C_coeff_b[cx][cy] = b_ac_raw[j]

    if hasAlpha:
        A_coeff = sparse grid initialized to 0.0
        for j in 0 .. A_usable-1:
            (cx, cy) = A_scan[j]
            A_coeff[cx][cy] = A_ac_raw[j]

    // 8. Build decode LUT                              // v0.2: gamma LUT
    gamma_lut = buildGammaLut()

    // 9. Render output image
    rgba = new byte[w * h * 4]

    for y in 0 .. h-1:
        for x in 0 .. w-1:
            // 9a. Inverse DCT for L channel (adaptive grid)  // v0.2
            L = L_dc
            for cy in 0 .. L_ny-1:
                cy_factor = (cy > 0) ? 2 : 1
                fy = cos(π / h * cy * (y + 0.5)) * cy_factor
                cx_start = (cy == 0) ? 1 : 0
                for cx in cx_start .. while cx*L_ny < L_nx*(L_ny-cy):
                    cx_factor = (cx > 0) ? 2 : 1
                    L += L_coeff[cx][cy] * cos(π / w * cx * (x + 0.5)) * cx_factor * fy

            // 9b. Inverse DCT for a, b channels (adaptive grid)  // v0.2
            a = a_dc; b = b_dc
            for cy in 0 .. C_ny-1:
                cy_factor = (cy > 0) ? 2 : 1
                fy = cos(π / h * cy * (y + 0.5)) * cy_factor
                cx_start = (cy == 0) ? 1 : 0
                for cx in cx_start .. while cx*C_ny < C_nx*(C_ny-cy):
                    cx_factor = (cx > 0) ? 2 : 1
                    fx = cos(π / w * cx * (x + 0.5)) * cx_factor
                    a += C_coeff_a[cx][cy] * fx * fy
                    b += C_coeff_b[cx][cy] * fx * fy

            // 9c. Inverse DCT for alpha channel (adaptive grid)
            alpha = hasAlpha ? A_dc : 1.0
            if hasAlpha:
                for cy in 0 .. A_ny-1:
                    cy_factor = (cy > 0) ? 2 : 1
                    fy = cos(π / h * cy * (y + 0.5)) * cy_factor
                    cx_start = (cy == 0) ? 1 : 0
                    for cx in cx_start .. while cx*A_ny < A_nx*(A_ny-cy):
                        cx_factor = (cx > 0) ? 2 : 1
                        alpha += A_coeff[cx][cy] * cos(π / w * cx * (x + 0.5)) * cx_factor * fy

            // 9d. Clamp L from DCT ringing, then soft gamut clamp (v0.2)
            L = clamp(L, 0.0, 1.0)
            (L, a, b) = softGamutClamp(L, a, b)

            // 9e. OKLAB → sRGB via LUT (v0.2)
            rgb_linear = oklabToLinearRgb(L, a, b)
            r = linearToSrgb8(clamp(rgb_linear[0], 0, 1), gamma_lut)
            g = linearToSrgb8(clamp(rgb_linear[1], 0, 1), gamma_lut)
            b_out = linearToSrgb8(clamp(rgb_linear[2], 0, 1), gamma_lut)
            a_out = round(255 * clamp(alpha, 0, 1))

            idx = (y * w + x) * 4
            rgba[idx+0] = r; rgba[idx+1] = g; rgba[idx+2] = b_out; rgba[idx+3] = a_out

    return (w, h, rgba)
```

**Note on coefficient grid access:** The "sparse grid" above is conceptual. In
practice, implementations can use a flat array indexed by scan order position —
iterating the scan order during the inverse DCT loop rather than storing a 2D
grid. The only requirement is that grid positions beyond `cap` contribute zero
and grid positions beyond `len(scan)` contribute zero.

**Note on decode cosine precomputation:** Decode operates at 32×32 output
resolution. Cosine precomputation (as described in §5.4 for encode) is optional
but recommended for decode — precomputing `cos_x[cx][x]` for `x ∈ [0, w-1]`
and `cos_y[cy][y]` for `y ∈ [0, h-1]` avoids redundant cosine evaluations.

## Appendix: Bit Allocation (256 bits, no-alpha mode)

The bit positions are unchanged from v0.1 — the same 256-bit format is
reinterpreted with adaptive grid geometry and updated constant ranges.

| Field | Bits | Notes |
|-------|------|-------|
| L DC | 7 | 128 levels, ~0.39 JND at mid-range |
| a DC | 7 | Dequantized with MAX_CHROMA=0.45 (was 0.5) |
| b DC | 7 | Dequantized with MAX_CHROMA=0.45 (was 0.5) |
| L scale | 6 | 64 levels |
| a scale | 6 | |
| b scale | 5 | 32 levels, deliberate trade |
| Aspect | 8 | Drives grid geometry via `deriveGrid` in v0.2 |
| hasAlpha | 1 | |
| Version | 1 | **0 = v0.1, 1 = v0.2** (was reserved) |
| L AC (27×5b) | 135 | Grid shape varies, count fixed at 27 |
| a AC (9×4b) | 36 | Grid shape varies, count fixed at 9 |
| b AC (9×4b) | 36 | Grid shape varies, count fixed at 9 |
| Padding | 1 | |

## Appendix: Bit Allocation (256 bits, alpha mode)

| Field | Bits | Notes |
|-------|------|-------|
| L DC | 7 | 128 levels |
| a DC | 7 | Dequantized with MAX_CHROMA=0.45 |
| b DC | 7 | Dequantized with MAX_CHROMA=0.45 |
| L scale | 6 | 64 levels |
| a scale | 6 | |
| b scale | 5 | 32 levels |
| Aspect | 8 | Drives grid geometry via `deriveGrid` in v0.2 |
| hasAlpha | 1 | |
| Version | 1 | **0 = v0.1, 1 = v0.2** |
| Alpha DC | 5 | 32 levels |
| Alpha scale | 4 | 16 levels |
| L AC (7×6b + 13×5b) | 107 | Grid shape varies, slot count fixed at 20 |
| a AC (9×4b) | 36 | Grid shape varies, count fixed at 9 |
| b AC (9×4b) | 36 | Grid shape varies, count fixed at 9 |
| A AC (5×4b) | 20 | Grid shape varies, count fixed at 5 |

## Appendix: Priority Ordering

1. **Full-resolution encoding** (EOTF LUT + bit-seed Halley cbrt + cosine
   precompute) — fixes the dominant quality issue
2. **Adaptive grid geometry** — additional quality for non-square images
3. **MAX_CHROMA tuning + Oklch soft clamping** — refinements for saturated colors
4. **Version bit** — enables v0.1/v0.2 discrimination

## Appendix: Spec Tooling Updates

- `constants.py`: `MAX_CHROMA_A = MAX_CHROMA_B = 0.45`
- `validate.py` §5: Updated OKLAB bounds checks for new MAX_CHROMA, added margin
  check over BT.2020
- `validate.py` §9: New `validate_derive_grid()` — verifies deriveGrid across all
  256 aspect bytes for all channel types, spot-checks known grid values,
  validates portrait/landscape symmetry, and confirms AC cap invariants
- `scan_order.py`: Exhaustive enumeration of all 30 unique grid configurations
  (4 square + 26 adaptive) produced by `deriveGrid` across all 256 aspect byte
  values and all channel types
