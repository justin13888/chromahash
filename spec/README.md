# ChromaHash Format Specification

**Version:** 0.3.0-draft
**Status:** Draft
**Date:** 2026-03-23

> ChromaHash is a fixed-size, 32-byte Low Quality Image Placeholder (LQIP) format
> designed for professional photo management at scale. It encodes a perceptually
> accurate thumbnail representation of an image using OKLAB color space, DCT-based
> frequency decomposition, and µ-law companded quantization.

---

## Table of Contents

1. [Design Goals](#1-design-goals)
2. [Conventions](#2-conventions)
3. [Binary Format](#3-binary-format)
4. [Color Space: OKLAB](#4-color-space-oklab)
5. [Multi-Gamut Encoding](#5-multi-gamut-encoding)
6. [DCT & Coefficient Selection](#6-dct--coefficient-selection)
7. [Quantization](#7-quantization)
8. [Aspect Ratio Encoding](#8-aspect-ratio-encoding)
9. [Alpha Channel Support](#9-alpha-channel-support)
10. [Encoding Algorithm](#10-encoding-algorithm)
11. [Decoding Algorithm](#11-decoding-algorithm)
12. [Constants & Matrices](#12-constants--matrices)
13. [Trade-offs & Limitations](#13-trade-offs--limitations)
14. [Appendix A: ThumbHash Comparison](#appendix-a-thumbhash-comparison--acknowledgment)

---

## 1. Design Goals

ChromaHash targets professional photo management workloads where perceptual quality,
layout precision, and wide-gamut support matter more than minimizing byte count.

| Goal | Rationale |
|------|-----------|
| Fixed 32 bytes | Memory-aligned, cache-friendly, predictable storage. Zero-overhead database column or cache key. |
| OKLAB color space | Perceptually uniform — quantization levels are maximally efficient. |
| 8-bit log₂ aspect ratio | ~1.09% max error for all photographic ratios. Covers 1:16 to 16:1. |
| Adaptive grid geometry | DCT grid dimensions adapt to aspect ratio, eliminating coefficient waste on non-square images. |
| Higher chroma resolution | Base 4×4 triangular grid (9 AC) per chroma channel with adaptive reshaping for complex color transitions. |
| 5-bit luminance AC | 32 levels for the most perceptually important channel. |
| µ-law companding (µ=5) | Non-linear quantization matching natural image DCT coefficient distributions. |
| Multi-gamut encode | Accepts sRGB, Display P3, Adobe RGB, BT.2020, or ProPhoto RGB sources. |
| Single decode target | Always sRGB output. One set of matrices, zero ambiguity. |
| Alpha support | Transparent images supported within the fixed 32-byte size. |

### Design Priorities (ordered)

1. **Perceptual accuracy** — placeholder should look as close to the original as possible.
2. **Layout precision** — decoded aspect ratio must closely match the original.
3. **Wide-gamut correctness** — colors from P3/Adobe RGB/BT.2020 sources preserved accurately.
4. **Decode simplicity and speed** — trivially implementable, fast (<1ms in JavaScript).
5. **Fixed size** — predictable storage and zero parsing complexity.

---

## 2. Conventions

### 2.1 Pseudocode Notation

- **Ranges:** `for i in 0..N` iterates from 0 to N **inclusive** (N+1 iterations).
- **Integer types:** All bit-field values are unsigned integers unless stated otherwise.

### 2.2 Rounding

All `round()` operations use **round half away from zero**:

```
round(x) = floor(x + 0.5)    for x ≥ 0
round(x) = ceil(x − 0.5)     for x < 0
```

Implementations MUST use this rounding mode. Cross-implementation bit-exactness is the
primary constraint.

### 2.3 Numerical Precision

Intermediate computations SHALL use at minimum IEEE 754 binary64 (float64) for encoding.
The decoder MAY use float32 since output is 8-bit RGBA, but SHOULD use float64 for matrix
multiplications to match reference test vectors.

The encoding pipeline requires int64/uint64 bit reinterpretation for the optimized cube
root computation (see §12.6).

### 2.4 Cube Root of Negative Values

The OKLAB transform uses cube roots. Out-of-gamut colors can produce negative LMS values.
Implementations MUST handle negative inputs:

```
cbrt(x) = sign(x) × |x|^(1/3)
```

Implementations MUST NOT use `pow(x, 1.0/3.0)`, which is undefined for negative `x` in
many languages. See §12.6 for the recommended IEEE 754 bit-seed implementation.

### 2.5 Version Bit (Bit 47)

Bit 47 in the header serves as a version discriminator:

| Version | Bit 47 | Notes |
|---------|--------|-------|
| v0.1    | 0      | Original spec — fixed grids, MAX_CHROMA=0.5, hard gamut clamp |
| v0.2+   | 1      | Adaptive grids, MAX_CHROMA=0.45, soft gamut clamp, full-res encoding |

Encoders MUST set bit 47 to 1. Decoders MAY check bit 47. Since v0.1 was never publicly
released, all valid hashes have bit 47 = 1.

### 2.6 Padding Bits

In no-alpha mode, bit 255 is padding. Encoders MUST set it to 0; decoders MUST ignore it.

### 2.7 Authoritative Constants

All constants, matrices, and scalar parameters are defined in `spec/constants.py`. That
file is the single source of truth. Run `spec/validate.py` to verify.

---

## 3. Binary Format

A ChromaHash is exactly **32 bytes (256 bits)**: a 6-byte header followed by a 26-byte
AC coefficient block.

### 3.1 Header (48 bits)

All multi-bit fields are packed little-endian:

```
header48 = hash[0] | (hash[1] << 8) | (hash[2] << 16) | (hash[3] << 24) | (hash[4] << 32) | (hash[5] << 40)
```

| Bits | Field | Width | Range | Description |
|------|-------|-------|-------|-------------|
| 0–6 | `L_dc` | 7 | 0–127 | OKLAB L (lightness) |
| 7–13 | `a_dc` | 7 | 0–127 | OKLAB a (green–red), centered |
| 14–20 | `b_dc` | 7 | 0–127 | OKLAB b (blue–yellow), centered |
| 21–26 | `L_scale` | 6 | 0–63 | Luminance AC max amplitude |
| 27–32 | `a_scale` | 6 | 0–63 | Chroma-a AC max amplitude |
| 33–37 | `b_scale` | 5 | 0–31 | Chroma-b AC max amplitude |
| 38–45 | `aspect` | 8 | 0–255 | Log₂ aspect ratio (see §8) |
| 46 | `hasAlpha` | 1 | 0/1 | Alpha channel present |
| 47 | `version` | 1 | 1 | Version bit (0=v0.1, 1=v0.2+) |

### 3.2 AC Block (26 bytes = 208 bits)

#### No-alpha mode (`hasAlpha = 0`)

```
Field           Coefficients   Bits/coeff   Total bits
────────────────────────────────────────────────────────
L AC            27             5            135
a AC (chroma)   9              4             36
b AC (chroma)   9              4             36
Padding         —              —              1
                                            ─────
                                            208
```

#### Alpha mode (`hasAlpha = 1`)

```
Field           Coefficients   Bits/coeff   Total bits
────────────────────────────────────────────────────────
alpha_dc        1              5              5
alpha_scale     1              4              4
L AC            20             mixed*       107
a AC (chroma)   9              4             36
b AC (chroma)   9              4             36
A AC (alpha)    5              4             20
                                            ─────
                                            208

* L AC mixed: first 7 at 6 bits (42), remaining 13 at 5 bits (65) = 107.
```

Both modes: 48 + 208 = **256 bits = 32 bytes**. ✓

### 3.3 Layout Diagram

```
No-alpha:
┌──────────────────────────────────────────────┬───────────────────────────────────────────────────┐
│              Header (6 bytes, 48 bits)        │           AC Block (26 bytes, 208 bits)           │
│ L_dc|a_dc|b_dc|L_scl|a_scl|b_scl|aspect|α|v │ L_ac×27(5b) | a_ac×9(4b) | b_ac×9(4b) | pad(1b)│
└──────────────────────────────────────────────┴───────────────────────────────────────────────────┘

Alpha:
┌──────────────────────────────────────────────┬───────────────────────────────────────────────────┐
│              Header (6 bytes, 48 bits)        │           AC Block (26 bytes, 208 bits)           │
│ L_dc|a_dc|b_dc|L_scl|a_scl|b_scl|aspect|α|v │ A_dc(5b)|A_scl(4b)|L_ac×7(6b)+13(5b)|           │
│                                              │ a_ac×9(4b)|b_ac×9(4b)|A_ac×5(4b)                 │
└──────────────────────────────────────────────┴───────────────────────────────────────────────────┘
```

### 3.4 String Representation

ChromaHash is a binary format. This specification does not define a canonical UTF-8 string
encoding; the reference implementation does not provide one. Applications are responsible
for choosing an encoding appropriate to their context (e.g. base64url per RFC 4648 §5 for
web and API use, hex for debugging). Because the binary layout is fixed at 32 bytes, any
consistently applied encoding is unambiguous without additional framing.

---

## 4. Color Space: OKLAB

### 4.1 Choice Justification

| Candidate | Verdict |
|-----------|---------|
| **LPQA** (ThumbHash) | Not perceptually uniform. Gamma-encoded sRGB averaging. |
| **CIELAB** (CIE 1976) | Hue linearity problems — blue shifts toward purple. Requires D50 adaptation. |
| **YCbCr** (BT.601/709) | Not perceptually uniform. Designed for signal compression. |
| **ICtCp** (BT.2100) | Overkill for SDR placeholders. Requires PQ/HLG transfer functions. |
| **OKLCH** (cylindrical) | Hue angle discontinuity at 0°/360° breaks DCT encoding. |
| **OKLAB** | **Selected.** Perceptually uniform, hue-linear, D65 native, simple transform, industry-adopted (CSS Color Level 4). |

Key properties: equal L steps = equal perceived lightness changes; no hue shift during
interpolation (unlike CIELAB); D65 white point matches all target gamuts natively;
gamut-agnostic via CIE XYZ; simple transform (two 3×3 matrices + cube root).

### 4.2 OKLAB Transform

**Forward (RGB → OKLAB):**

```
1. Linearize RGB using the source gamut's transfer function
2. Linear RGB → LMS:   lms = M1[source_gamut] × rgb_linear
3. Cube root:          lms_cbrt = [cbrt(l), cbrt(m), cbrt(s)]
4. LMS → OKLAB:        [L, a, b] = M2 × lms_cbrt
```

**Inverse (OKLAB → sRGB):**

```
1. OKLAB → LMS_cbrt:   lms_cbrt = M2_inv × [L, a, b]
2. Cube:               lms = [l³, m³, s³]
3. LMS → sRGB linear:  rgb_linear = M1_inv[sRGB] × lms
4. Apply sRGB gamma:   rgb = srgb_gamma(clamp(rgb_linear, 0, 1))
```

Matrices are defined in §12.

---

## 5. Multi-Gamut Encoding

### 5.1 Encoding Pipeline

```
Source RGB → Linearize (source EOTF) → LMS (M1[source_gamut]) → OKLAB (M2)
```

The resulting OKLAB values are **absolute** — the same physical color produces the same
(L, a, b) regardless of source gamut. No gamut flag is stored; no decode-time branching.
Wide-gamut colors are preserved at their true OKLAB coordinates.

### 5.2 Decoding Pipeline

```
OKLAB → LMS_cbrt (M2_inv) → LMS (cube) → sRGB linear (M1_inv[sRGB]) → sRGB gamma → clamp → 8-bit RGBA
```

Decode target is always sRGB. At placeholder resolution with DCT blurring, the DC of real
photographs almost never clips when converted to sRGB.

### 5.3 Transfer Functions

| Gamut | Transfer function (gamma → linear) |
|-------|-------------------------------------|
| sRGB / Display P3 | `x ≤ 0.04045 ? x/12.92 : ((x+0.055)/1.055)^2.4` |
| Adobe RGB | `x^2.2` |
| ProPhoto RGB | `x^1.8` |
| BT.2020 PQ (ST 2084) | Inverse PQ EOTF (tone-map to SDR first) |

> **Note:** BT.2020 in this spec means BT.2020 with PQ transfer (ST 2084). SDR BT.2020
> content (e.g. BT.709-like OETF with BT.2020 primaries) SHOULD be encoded using the
> sRGB transfer function with the BT.2020 M1 matrix.

> **Note:** The ProPhoto RGB entry uses the simplified `x^1.8` power function. The full
> ROMM RGB standard specifies a piecewise function with a linear toe below ~0.001808; for
> typical photographic values this difference is negligible.

The decoder always applies the **sRGB inverse EOTF** (linear → gamma):

```
gamma(x) = x ≤ 0.0031308 ? 12.92 × x : 1.055 × x^(1/2.4) − 0.055
```

For HDR PQ content, the encoder MUST tone-map to SDR before OKLAB conversion. The
specific tone-mapping algorithm is implementation-defined.

---

## 6. DCT & Coefficient Selection

### 6.1 Transform

**Forward transform** for a channel with grid dimensions `nx × ny`:

```
F(cx, cy) = (1 / (w × h)) × Σ_y Σ_x  channel[x + y×w] × cos(π/w × cx × (x + 0.5))
                                                         × cos(π/h × cy × (y + 0.5))
```

where `w` and `h` are the source image dimensions.

**Inverse transform** (decode):

```
value = DC + Σ_j  AC[j] × cos(π/w × cx_j × (x + 0.5)) × cos(π/h × cy_j × (y + 0.5)) × C(cx_j, cy_j)
```

Normalization factor: `C(cx, cy) = (cx > 0 ? 2 : 1) × (cy > 0 ? 2 : 1)`

### 6.2 Triangular Coefficient Selection

The condition selecting which `(cx, cy)` pairs to include (excluding DC at `(0, 0)`):

```
cx × ny < nx × (ny − cy)
```

This selects coefficients below the diagonal in frequency space. Example for a 4×4 grid
(9 AC coefficients):

```
cy\cx  0    1    2    3
  0   [DC]  ✓    ✓    ✓
  1    ✓    ✓    ✓
  2    ✓    ✓
  3    ✓
```

Coefficients are scanned **row-major** within the triangle:

```
for cy in 0 .. ny-1:
    cx_start = (cy == 0) ? 1 : 0
    for cx in cx_start .. while cx×ny < nx×(ny−cy):
        emit coefficient (cx, cy)
```

Run `spec/scan_order.py` for all scan orders.

### 6.3 Adaptive Grid Geometry

DCT grid dimensions (nx, ny) are **derived deterministically from the aspect byte**. No
mode flag or extra storage — grid geometry is self-describing.

```
function deriveGrid(aspect_byte, base_n):
    ratio = 2^(aspect_byte / 255 × 8 − 4)

    if ratio >= 1.0:
        scale = min(ratio, 16.0)
        nx = round(base_n × scale^0.25)
        ny = round(base_n / scale^0.25)
    else:
        scale = min(1.0 / ratio, 16.0)
        nx = round(base_n / scale^0.25)
        ny = round(base_n × scale^0.25)

    nx = max(nx, 3)
    ny = max(ny, 3)
    return (nx, ny)
```

All `round()` calls use round half away from zero (§2.2). The result is converted to
integer before the `max()` clamping. The `scale^0.25` exponent provides gentle adaptation.

| Channel | Mode | base_n | AC cap | Bit budget |
|---|---|---|---|---|
| L luminance | no-alpha | 7 | 27 | 27×5 = 135 bits |
| L luminance | alpha | 6 | 20 | 7×6 + 13×5 = 107 bits |
| a chroma | both | 4 | 9 | 9×4 = 36 bits |
| b chroma | both | 4 | 9 | 9×4 = 36 bits |
| Alpha | alpha | 3 | 5 | 5×4 = 20 bits |

### 6.4 Capping and Zero-Padding

The **bit budget per channel is fixed** regardless of grid shape — the bitstream layout
never changes, only the mapping from positions to frequency coordinates.

**Encode (capping):** When the scan order produces more AC positions than the cap, store
only the first `cap` in scan order. Higher-frequency coefficients are dropped.

**Encode (zero-padding):** When the scan order produces fewer positions than the cap
(only occurs for alpha-mode L with 4×8/8×4 grids producing 19 vs cap 20), pad with zeros.

**Decode:** Read exactly `cap` AC values from the bitstream. Map the first
`min(cap, len(scan))` to scan positions. Extra scan positions beyond cap have implicit
zero coefficients. Extra bitstream values beyond `len(scan)` are discarded.

### 6.5 Exhaustive Grid Tables

All unique (nx, ny) pairs produced by `deriveGrid` across all 256 aspect byte values.
Portrait grids mirror landscape (e.g. 4×14 mirrors 14×4).

**L no-alpha (base_n=7, cap=27) — 21 shapes, all raw AC ≥ 27:**

| Bytes | nx | ny | Raw AC | | Bytes | nx | ny | Raw AC |
|---|---|---|---|---|---|---|---|---|
| 0–6 | 4 | 14 | 35 | | 115–140 | 7 | 7 | 27 |
| 7–20 | 4 | 13 | 33 | | 141 | 8 | 7 | 34 |
| 21–36 | 4 | 12 | 29 | | 142–163 | 8 | 6 | 29 |
| 37–46 | 4 | 11 | 28 | | 164–171 | 9 | 6 | 32 |
| 47–52 | 5 | 11 | 34 | | 172–183 | 9 | 5 | 28 |
| 53–71 | 5 | 10 | 29 | | 184–202 | 10 | 5 | 29 |
| 72–83 | 5 | 9 | 28 | | 203–208 | 11 | 5 | 34 |
| 84–91 | 6 | 9 | 32 | | 209–218 | 11 | 4 | 28 |
| 92–113 | 6 | 8 | 29 | | 219–234 | 12 | 4 | 29 |
| 114 | 7 | 8 | 34 | | 235–248 | 13 | 4 | 33 |
| | | | | | 249–255 | 14 | 4 | 35 |

**Chroma a/b (base_n=4, cap=9) — 11 shapes, all raw AC ≥ 9:**

| Bytes | nx | ny | Raw AC | | Bytes | nx | ny | Raw AC |
|---|---|---|---|---|---|---|---|---|
| 0–11 | 3 | 8 | 16 | | 150–152 | 5 | 4 | 13 |
| 12–38 | 3 | 7 | 14 | | 153–186 | 5 | 3 | 10 |
| 39–68 | 3 | 6 | 11 | | 187–216 | 6 | 3 | 11 |
| 69–102 | 3 | 5 | 10 | | 217–243 | 7 | 3 | 14 |
| 103–105 | 4 | 5 | 13 | | 244–255 | 8 | 3 | 16 |
| 106–149 | 4 | 4 | 9 | | | | | |

**Alpha-mode L (base_n=6, cap=20) — 19 shapes:**

| Bytes | nx | ny | Raw AC | | Bytes | nx | ny | Raw AC |
|---|---|---|---|---|---|---|---|---|
| 0–7 | 3 | 12 | 23 | | 143 | 7 | 6 | 26 |
| 8–24 | 3 | 11 | 22 | | 144–168 | 7 | 5 | 22 |
| 25–28 | 3 | 10 | 20 | | 169–180 | 8 | 5 | 25 |
| 29–42 | 4 | 10 | 25 | | 181–191 | 8 | 4 | **19** |
| 43–63 | 4 | 9 | 23 | | 192–212 | 9 | 4 | 23 |
| 64–74 | 4 | 8 | **19** | | 213–226 | 10 | 4 | 25 |
| 75–86 | 5 | 8 | 25 | | 227–230 | 10 | 3 | 20 |
| 87–111 | 5 | 7 | 22 | | 231–247 | 11 | 3 | 22 |
| 112 | 6 | 7 | 26 | | 248–255 | 12 | 3 | 23 |
| 113–142 | 6 | 6 | 20 | | | | | |

Entries marked **19** have raw AC < cap (20); the 20th bitstream slot is zero-padded.

**Alpha channel (base_n=3, cap=5) — 7 shapes, all raw AC ≥ 5:**

| Bytes | nx | ny | Raw AC |
|---|---|---|---|
| 0–16 | 3 | 6 | 11 |
| 17–52 | 3 | 5 | 10 |
| 53–99 | 3 | 4 | 8 |
| 100–155 | 3 | 3 | 5 |
| 156–202 | 4 | 3 | 8 |
| 203–238 | 5 | 3 | 10 |
| 239–255 | 6 | 3 | 11 |

---

## 7. Quantization

### 7.1 DC Quantization

| Channel | Bits | Encode | Decode |
|---------|------|--------|--------|
| L | 7 | `round(127 × clamp(L_dc, 0, 1))` | `raw / 127.0` |
| a | 7 | `round(64 + 63 × clamp(a_dc/MAX_CHROMA_A, -1, 1))` | `(raw - 64) / 63.0 × MAX_CHROMA_A` |
| b | 7 | `round(64 + 63 × clamp(b_dc/MAX_CHROMA_B, -1, 1))` | `(raw - 64) / 63.0 × MAX_CHROMA_B` |
| Alpha | 5 | `round(31 × clamp(A_dc, 0, 1))` | `raw / 31.0` |

> **Note:** The a/b DC encode formula `round(64 + 63×x)` produces indices in [1, 127],
> never 0. Decoding raw=0 gives `(0 − 64) / 63 × MAX_CHROMA = −1.016 × MAX_CHROMA`, which
> is outside the valid ±MAX_CHROMA range. Conforming encoders MUST NOT produce raw=0 for
> a/b DC. Decoders encountering raw=0 will reconstruct a slightly out-of-range chroma
> value; this is handled by the downstream soft gamut clamp.

### 7.2 Scale Factor Quantization

| Channel | Bits | Encode | Decode |
|---------|------|--------|--------|
| L scale | 6 | `round(63 × clamp(L_scale/MAX_L_SCALE, 0, 1))` | `raw / 63.0 × MAX_L_SCALE` |
| a scale | 6 | `round(63 × clamp(a_scale/MAX_A_SCALE, 0, 1))` | `raw / 63.0 × MAX_A_SCALE` |
| b scale | 5 | `round(31 × clamp(b_scale/MAX_B_SCALE, 0, 1))` | `raw / 31.0 × MAX_B_SCALE` |
| Alpha scale | 4 | `round(15 × clamp(A_scale/MAX_A_ALPHA_SCALE, 0, 1))` | `raw / 15.0 × MAX_A_ALPHA_SCALE` |

### 7.3 AC Coefficient Quantization: µ-law Companding

All AC coefficients use **µ-law companding** with **µ = 5**. This allocates finer steps
near zero (where most DCT coefficients cluster) and coarser steps in the tails.

**Compress:** `compressed = sign(v) × log(1 + µ × |v|) / log(1 + µ)`

**Quantize:** `index = clamp(round((compressed + 1) / 2 × (2^bits − 1)), 0, 2^bits − 1)`

**Dequantize:** `compressed = index / (2^bits − 1) × 2 − 1`

**Expand:** `v = sign(compressed) × ((1 + µ)^|compressed| − 1) / µ`

> **Note:** The zero-point has a small positive quantization bias. A zero AC input
> encodes to the index above the midpoint (5-bit: 16/31, 4-bit: 8/15, 6-bit: 32/63),
> which dequantizes to a small positive value before expansion: ≈ +0.012 (5-bit),
> ≈ +0.025 (4-bit), ≈ +0.006 (6-bit) in normalized units. After scale multiplication,
> the absolute bias is proportionally small and has no practical effect on decoded images.

### 7.4 AC Bit Depths

| Channel | No-alpha | Alpha |
|---------|----------|-------|
| L AC | 5 bits (all 27) | 6 bits (first 7) + 5 bits (remaining 13) |
| a AC | 4 bits (all 9) | 4 bits (all 9) |
| b AC | 4 bits (all 9) | 4 bits (all 9) |
| Alpha AC | — | 4 bits (all 5) |

In alpha mode, the first 7 L AC coefficients (lowest frequencies, highest perceptual
impact) are promoted to 6 bits to partially compensate for the reduced grid.

---

## 8. Aspect Ratio Encoding

### 8.1 Encoding Formula

```
Encode: byte = clamp(round((log₂(w / h) + 4) / 8 × 255), 0, 255)
Decode: ratio = 2^(byte / 255 × 8 − 4)
```

This maps log₂(ratio) from [−4, +4] to [0, 255], covering ratios from **1:16** (0.0625)
to **16:1** (16.0). The encoding is symmetric about 1:1 — portrait and landscape ratios
of the same proportions have the same error.

Maximum error: `2^(8/255/2) − 1 ≈ 1.09%`. Notable values: 1:1 → byte 128, 4:1 → 191,
16:1 → 255, 1:4 → 64, 1:16 → 0.

### 8.2 Decode Output Size

The longer side is 32 pixels by convention:

```
if ratio > 1:
    w = 32; h = round(32 / ratio)
else:
    w = round(32 × ratio); h = 32
```

Implementations MAY allow the caller to specify a different target size.

---

## 9. Alpha Channel Support

### 9.1 Detection

An image has alpha if any pixel's alpha value < 255. The `hasAlpha` flag records this.

### 9.2 Alpha Compositing Before Encoding

Before encoding, transparent pixels are composited over the alpha-weighted average color
in OKLAB space:

```
1. Compute alpha-weighted average OKLAB (avg_L, avg_a, avg_b)
2. For each pixel:
     L_chan[i] = avg_L × (1 − alpha) + alpha × oklab[i].L
     a_chan[i] = avg_a × (1 − alpha) + alpha × oklab[i].a
     b_chan[i] = avg_b × (1 − alpha) + alpha × oklab[i].b
```

This ensures L, a, b channels represent opaque color values while alpha is encoded
separately.

### 9.3 Alpha Channel Encoding

When `hasAlpha = 1`: DC (5 bits), scale (4 bits), 5 AC coefficients (adaptive grid with
base_n=3, capped at 5, 4 bits each, µ-law companded). The luminance grid shrinks from
base_n=7 to base_n=6, with freed bits accommodating the alpha channel (29 bits total).

---

## 10. Encoding Algorithm

### 10.1 Input Requirements

- Image dimensions: any size (full-resolution encoding — no downscale required)
- Pixel format: RGBA, 8 bits per channel
- Source gamut: one of {sRGB, Display P3, Adobe RGB, BT.2020, ProPhoto RGB}

### 10.2 Pseudocode

```
function encode(W, H, rgba, gamut) -> byte[32]:
    // 1. Precompute EOTF lookup table (256 entries per 8-bit input value)
    lut = precompute_eotf_lut(gamut)

    // 2. Convert all pixels to OKLAB
    oklab = array[W*H*3]; alphas = array[W*H]
    avg_L = 0; avg_a = 0; avg_b = 0; avg_alpha = 0

    for i in 0 .. W*H-1:
        alpha = rgba[i*4+3] / 255.0
        r_lin = lut[rgba[i*4+0]]
        g_lin = lut[rgba[i*4+1]]
        b_lin = lut[rgba[i*4+2]]
        lms = M1[gamut] × [r_lin, g_lin, b_lin]
        lms_cbrt = [cbrt(lms[0]), cbrt(lms[1]), cbrt(lms[2])]
        lab = M2 × lms_cbrt
        avg_L += alpha*lab[0]; avg_a += alpha*lab[1]; avg_b += alpha*lab[2]
        avg_alpha += alpha
        oklab[i*3..] = lab; alphas[i] = alpha

    // 3. Alpha-weighted average
    if avg_alpha > 0:
        avg_L /= avg_alpha; avg_a /= avg_alpha; avg_b /= avg_alpha
    else:
        avg_L = 0; avg_a = 0; avg_b = 0

    // 4. Composite transparent pixels over average
    hasAlpha = avg_alpha < W * H
    L_chan = array[W*H]; a_chan = array[W*H]; b_chan = array[W*H]
    for i in 0 .. W*H-1:
        a = alphas[i]
        L_chan[i] = avg_L*(1-a) + a*oklab[i*3+0]
        a_chan[i] = avg_a*(1-a) + a*oklab[i*3+1]
        b_chan[i] = avg_b*(1-a) + a*oklab[i*3+2]

    // 5. Derive adaptive grid dimensions
    aspect_byte = clamp(round((log2(W/H) + 4) / 8 * 255), 0, 255)
    if hasAlpha:
        (L_nx, L_ny) = deriveGrid(aspect_byte, 6)
        (A_nx, A_ny) = deriveGrid(aspect_byte, 3)
    else:
        (L_nx, L_ny) = deriveGrid(aspect_byte, 7)
    (C_nx, C_ny) = deriveGrid(aspect_byte, 4)

    // 6. Precompute cosine tables
    max_cx = max(L_nx, C_nx); max_cy = max(L_ny, C_ny)
    // Alpha grid dims (base_n=3) are always <= L grid dims (base_n=6 in alpha mode),
    // so L dims subsume alpha; no separate alpha cosine table needed.
    cos_x = precompute_cos_table(W, max_cx)
    cos_y = precompute_cos_table(H, max_cy)

    // 7. DCT encode each channel
    (L_dc, L_ac, L_scale) = dctEncode(L_chan, W, H, L_nx, L_ny, cos_x, cos_y)
    (a_dc, a_ac, a_scale) = dctEncode(a_chan, W, H, C_nx, C_ny, cos_x, cos_y)
    (b_dc, b_ac, b_scale) = dctEncode(b_chan, W, H, C_nx, C_ny, cos_x, cos_y)
    if hasAlpha:
        (A_dc, A_ac, A_scale) = dctEncode(alphas, W, H, A_nx, A_ny, cos_x, cos_y)

    // 8. Cap/zero-pad AC to fixed bit budget
    // Use min() guards: only alpha-mode L grids 4×8/8×4 produce fewer raw AC than cap.
    L_cap = 20 if hasAlpha else 27
    L_ac = L_ac[0 .. min(L_cap, len(L_ac)) - 1]; while len(L_ac) < L_cap: L_ac.append(0)
    a_ac = a_ac[0 .. min(9, len(a_ac)) - 1]; b_ac = b_ac[0 .. min(9, len(b_ac)) - 1]
    if hasAlpha: A_ac = A_ac[0 .. min(5, len(A_ac)) - 1]

    // 9. Quantize header
    L_dc_q  = round(127 * clamp(L_dc, 0, 1))
    a_dc_q  = round(64 + 63 * clamp(a_dc / MAX_CHROMA_A, -1, 1))
    b_dc_q  = round(64 + 63 * clamp(b_dc / MAX_CHROMA_B, -1, 1))
    L_scl_q = round(63 * clamp(L_scale / MAX_L_SCALE, 0, 1))
    a_scl_q = round(63 * clamp(a_scale / MAX_A_SCALE, 0, 1))
    b_scl_q = round(31 * clamp(b_scale / MAX_B_SCALE, 0, 1))

    // 10. Pack header (48 bits, little-endian)
    header = L_dc_q | (a_dc_q << 7) | (b_dc_q << 14)
           | (L_scl_q << 21) | (a_scl_q << 27) | (b_scl_q << 33)
           | (aspect_byte << 38)
           | ((1 if hasAlpha else 0) << 46)
           | (1 << 47)                            // version bit
    hash = new byte[32]
    for i in 0..5: hash[i] = (header >> (i*8)) & 0xFF

    // 11. Pack AC with µ-law companding
    //     When scale=0 (solid color), write the µ-law midpoint for zero.
    function qAC(value, scale, mu, bits):
        if scale == 0: return muLawQuantize(0, mu, bits)
        return muLawQuantize(value / scale, mu, bits)

    bitpos = 48
    if hasAlpha:
        writeBits(hash, bitpos, 5, round(31*clamp(A_dc,0,1))); bitpos += 5
        writeBits(hash, bitpos, 4, round(15*clamp(A_scale/MAX_A_ALPHA_SCALE,0,1))); bitpos += 4
        for i in 0..6:  writeBits(hash, bitpos, 6, qAC(L_ac[i],L_scale,5,6)); bitpos += 6
        for i in 7..19: writeBits(hash, bitpos, 5, qAC(L_ac[i],L_scale,5,5)); bitpos += 5
    else:
        for i in 0..26: writeBits(hash, bitpos, 5, qAC(L_ac[i],L_scale,5,5)); bitpos += 5

    for i in 0..8: writeBits(hash, bitpos, 4, qAC(a_ac[i],a_scale,5,4)); bitpos += 4
    for i in 0..8: writeBits(hash, bitpos, 4, qAC(b_ac[i],b_scale,5,4)); bitpos += 4

    if hasAlpha:
        for i in 0..4: writeBits(hash, bitpos, 4, qAC(A_ac[i],A_scale,5,4)); bitpos += 4

    if not hasAlpha:
        assert bitpos == 255    // bit 255 is padding (§2.6), implicit zero
    else:
        assert bitpos == 256
    return hash
```

---

## 11. Decoding Algorithm

### 11.1 Pseudocode

```
function decode(hash) -> (w, h, rgba):
    // 1. Unpack header
    header = 0
    for i in 0..5: header |= hash[i] << (i*8)

    L_dc_q  = header & 0x7F
    a_dc_q  = (header >> 7) & 0x7F
    b_dc_q  = (header >> 14) & 0x7F
    L_scl_q = (header >> 21) & 0x3F
    a_scl_q = (header >> 27) & 0x3F
    b_scl_q = (header >> 33) & 0x1F
    aspect  = (header >> 38) & 0xFF
    hasAlpha = (header >> 46) & 1
    version  = (header >> 47) & 1
    // Decoders MAY check version; since v0.1 was never released, valid hashes have version=1 (§2.5)

    // 2. Decode DC and scale factors
    L_dc    = L_dc_q / 127.0
    a_dc    = (a_dc_q - 64) / 63.0 * MAX_CHROMA_A
    b_dc    = (b_dc_q - 64) / 63.0 * MAX_CHROMA_B
    L_scale = L_scl_q / 63.0 * MAX_L_SCALE
    a_scale = a_scl_q / 63.0 * MAX_A_SCALE
    b_scale = b_scl_q / 31.0 * MAX_B_SCALE

    // 3. Derive adaptive grids and scan orders
    if hasAlpha:
        (L_nx, L_ny) = deriveGrid(aspect, 6)
        (A_nx, A_ny) = deriveGrid(aspect, 3)
    else:
        (L_nx, L_ny) = deriveGrid(aspect, 7)
    (C_nx, C_ny) = deriveGrid(aspect, 4)

    L_scan = triangular_scan_order(L_nx, L_ny)
    C_scan = triangular_scan_order(C_nx, C_ny)
    L_cap = 20 if hasAlpha else 27; C_cap = 9

    // 4. Decode aspect ratio and output size
    ratio = 2^(aspect / 255.0 * 8 - 4)
    if ratio > 1: w = 32; h = round(32 / ratio)
    else: w = round(32 * ratio); h = 32

    // 5. Dequantize AC from bitstream (read exactly cap values per channel)
    bitpos = 48
    if hasAlpha:
        A_dc    = readBits(hash, bitpos, 5) / 31.0; bitpos += 5
        A_scale = readBits(hash, bitpos, 4) / 15.0 * MAX_A_ALPHA_SCALE; bitpos += 4
        A_scan  = triangular_scan_order(A_nx, A_ny); A_cap = 5

        L_ac = []
        for i in 0..6:  L_ac.append(muLawDequantize(readBits(hash,bitpos,6),5,6)*L_scale); bitpos += 6
        for i in 7..19: L_ac.append(muLawDequantize(readBits(hash,bitpos,5),5,5)*L_scale); bitpos += 5
    else:
        L_ac = []
        for i in 0..26: L_ac.append(muLawDequantize(readBits(hash,bitpos,5),5,5)*L_scale); bitpos += 5

    a_ac = []; for i in 0..8: a_ac.append(muLawDequantize(readBits(hash,bitpos,4),5,4)*a_scale); bitpos += 4
    b_ac = []; for i in 0..8: b_ac.append(muLawDequantize(readBits(hash,bitpos,4),5,4)*b_scale); bitpos += 4
    if hasAlpha:
        A_ac = []; for i in 0..4: A_ac.append(muLawDequantize(readBits(hash,bitpos,4),5,4)*A_scale); bitpos += 4

    // 6. Map bitstream values to coefficient grids
    L_coeff = grid initialized to 0.0
    L_usable = min(L_cap, len(L_scan))
    for j in 0..L_usable-1: L_coeff[L_scan[j]] = L_ac[j]

    C_usable = min(C_cap, len(C_scan))
    C_coeff_a = grid init 0.0; C_coeff_b = grid init 0.0
    for j in 0..C_usable-1: C_coeff_a[C_scan[j]] = a_ac[j]; C_coeff_b[C_scan[j]] = b_ac[j]

    if hasAlpha:
        A_usable = min(A_cap, len(A_scan))
        A_coeff = grid init 0.0
        for j in 0..A_usable-1: A_coeff[A_scan[j]] = A_ac[j]

    // 7. Build sRGB gamma LUT and render output
    gamma_lut = buildGammaLut()
    rgba = new byte[w * h * 4]

    for y in 0..h-1:
        for x in 0..w-1:
            // Inverse DCT for L channel (adaptive grid)
            L = L_dc
            for (cx, cy) in L_scan[0..L_usable-1]:
                L += L_coeff[cx,cy] * cos(π/w*cx*(x+0.5)) * cos(π/h*cy*(y+0.5))
                                    * ((cx>0?2:1) * (cy>0?2:1))

            // Inverse DCT for a, b channels (adaptive grid)
            a = a_dc; b = b_dc
            for (cx, cy) in C_scan[0..C_usable-1]:
                fx = cos(π/w*cx*(x+0.5)) * cos(π/h*cy*(y+0.5)) * ((cx>0?2:1) * (cy>0?2:1))
                a += C_coeff_a[cx,cy] * fx
                b += C_coeff_b[cx,cy] * fx

            // Inverse DCT for alpha channel
            alpha = hasAlpha ? A_dc : 1.0
            if hasAlpha:
                for (cx, cy) in A_scan[0..A_usable-1]:
                    alpha += A_coeff[cx,cy] * cos(π/w*cx*(x+0.5)) * cos(π/h*cy*(y+0.5))
                                            * ((cx>0?2:1) * (cy>0?2:1))

            // Soft gamut clamp (preserves hue, reduces chroma)
            L = clamp(L, 0.0, 1.0)
            (L, a, b) = softGamutClamp(L, a, b)

            // OKLAB → sRGB via gamma LUT
            rgb_lin = oklabToLinearRgb(L, a, b)
            idx = (y*w + x) * 4
            rgba[idx+0] = linearToSrgb8(clamp(rgb_lin[0], 0, 1), gamma_lut)
            rgba[idx+1] = linearToSrgb8(clamp(rgb_lin[1], 0, 1), gamma_lut)
            rgba[idx+2] = linearToSrgb8(clamp(rgb_lin[2], 0, 1), gamma_lut)
            rgba[idx+3] = round(255 * clamp(alpha, 0, 1))

    return (w, h, rgba)
```

### 11.2 Average Color Extraction

The DC coefficients can be converted to an average RGBA color without full decode:

```
function averageColor(hash) -> (r, g, b, a):
    ...extract L_dc, a_dc, b_dc, hasAlpha from header...
    L_dc = clamp(L_dc, 0, 1)
    (L_dc, a_dc, b_dc) = softGamutClamp(L_dc, a_dc, b_dc)
    lms_cbrt = M2_inv × [L_dc, a_dc, b_dc]
    lms = [lms_cbrt[0]³, lms_cbrt[1]³, lms_cbrt[2]³]
    rgb_lin = M1_inv_sRGB × lms
    r = srgbGamma(clamp(rgb_lin[0], 0, 1))
    g = srgbGamma(clamp(rgb_lin[1], 0, 1))
    b = srgbGamma(clamp(rgb_lin[2], 0, 1))
    a = hasAlpha ? (decode alpha_dc from AC block) : 1.0
    return (round(255×r), round(255×g), round(255×b), round(255×a))
```

---

## 12. Constants & Matrices

All constants are authoritatively defined in `spec/constants.py`.

### 12.1 Scalar Constants

```
MAX_CHROMA_A       = 0.45    # Max absolute OKLAB 'a' DC value (covers BT.2020 |a|=0.416)
MAX_CHROMA_B       = 0.45    # Max absolute OKLAB 'b' DC value (covers ProPhoto |b|=0.427)
MAX_L_SCALE        = 0.5     # Max luminance AC amplitude
MAX_A_SCALE        = 0.5     # Max chroma-a AC amplitude
MAX_B_SCALE        = 0.5     # Max chroma-b AC amplitude
MAX_A_ALPHA_SCALE  = 0.5     # Max alpha AC amplitude
µ                  = 5       # µ-law companding parameter
```

> **Note:** Scale constants are preliminary and may be tightened after empirical
> tuning against a reference image corpus. See `constants.py` for details.

### 12.2 M2 — LMS (cube-root) → OKLAB

```
  ┌                                           ┐
  │  0.2104542553   0.7936177850  -0.0040720468 │
  │  1.9779984951  -2.4285922050   0.4505937099 │
  │  0.0259040371   0.7827717662  -0.8086757660 │
  └                                           ┘
```

### 12.3 M2_inv — OKLAB → LMS (cube-root)

```
  ┌                                           ┐
  │  1.0000000000   0.3963377774   0.2158037573 │
  │  1.0000000000  -0.1055613458  -0.0638541728 │
  │  1.0000000000  -0.0894841775  -1.2914855480 │
  └                                           ┘
```

### 12.4 M1 — Source Gamut Matrices (Linear RGB → LMS)

Derived as `M_LMS × M_XYZ[gamut]`. Property: `M1 × [1,1,1]^T ≈ [1,1,1]^T`.

**M1[sRGB]:** (Ottosson published)
```
  0.4122214708   0.5363325363   0.0514459929
  0.2119034982   0.6806995451   0.1073969566
  0.0883024619   0.2817188376   0.6299787005
```

**M1[Display P3]:**
```
  0.4813798544   0.4621183697   0.0565017758
  0.2288319449   0.6532168128   0.1179512422
  0.0839457557   0.2241652689   0.6918889754
```

**M1[Adobe RGB]:**
```
  0.5764322615   0.3699132211   0.0536545174
  0.2963164739   0.5916761266   0.1120073994
  0.1234782548   0.2194986958   0.6570230494
```

**M1[BT.2020]:**
```
  0.6167557872   0.3601983994   0.0230458134
  0.2651330640   0.6358393641   0.0990275718
  0.1001026342   0.2039065194   0.6959908464
```

**M1[ProPhoto RGB]:** (includes Bradford D50→D65 adaptation)
```
  0.7154484635   0.3527915480  -0.0682400115
  0.2744116551   0.6677976408   0.0577907040
  0.1097844385   0.1861982875   0.7040172740
```

### 12.5 M1_inv[sRGB] — Decoder Matrix (LMS → sRGB linear)

This is the **only** M1 inverse the decoder needs:

```
  4.0767416621  -3.3077115913   0.2309699292
 -1.2684380046   2.6097574011  -0.3413193965
 -0.0041960863  -0.7034186147   1.7076147010
```

### 12.6 Helper Functions

**Cube root — IEEE 754 bit-seed + 3 Halley iterations** (recommended for performance):

```
cbrt(x):
    if x == 0: return 0
    sign = (x < 0); if sign: x = -x
    bits = double_to_uint64(x)
    signed_bits = reinterpret_as_int64(bits)
    seed_signed = (signed_bits - (1023 << 52)) / 3 + (1023 << 52)  // signed int64 division
    y = uint64_to_double(reinterpret_as_uint64(seed_signed))
    repeat 3 times:                        // Halley iteration (cubic convergence)
        t1 = y * y;   y3 = t1 * y         // explicit temporaries prevent FMA
        t2 = 2.0 * x; num = y3 + t2
        t3 = 2.0 * y3; den = t3 + x
        t4 = y * num;  y = t4 / den
    return sign ? -y : y
```

Max error ≤ 2 ULP. The seed division MUST use **signed int64** arithmetic — unsigned
wraps for inputs < 1.0.

**Soft gamut clamp** (Oklch bisection, 16 iterations):

```
softGamutClamp(L, a, b):
    rgb = oklabToLinearRgb(L, a, b)
    if inGamut(rgb): return (L, a, b)
    C = sqrt(a*a + b*b)
    if C < 1e-10: return (L, 0.0, 0.0)
    h_cos = a / C; h_sin = b / C
    lo = 0.0; hi = C
    for i in 0..15:                          // fixed 16 iterations, no early exit
        mid = (lo + hi) / 2.0
        rgb = oklabToLinearRgb(L, mid * h_cos, mid * h_sin)
        if inGamut(rgb): lo = mid
        else: hi = mid
    return (L, lo * h_cos, lo * h_sin)
```

Precondition: L must be in [0, 1] (caller clamps before calling). Preserves lightness
and hue; only reduces chroma. Precision: C / 2^16 < 1.5e-5.

```
oklabToLinearRgb(L, a, b):
    lms_cbrt = M2_inv × [L, a, b]
    lms = [lms_cbrt[0]³, lms_cbrt[1]³, lms_cbrt[2]³]
    return M1_inv_sRGB × lms

inGamut(rgb):
    return rgb[0] >= 0.0 and rgb[0] <= 1.0
       and rgb[1] >= 0.0 and rgb[1] <= 1.0
       and rgb[2] >= 0.0 and rgb[2] <= 1.0
```

**sRGB gamma LUT** (decode, 4096-entry):

```
buildGammaLut():
    lut = array[4096] of uint8
    for i in 0..4095:
        x = i / 4095.0
        srgb = x ≤ 0.0031308 ? 12.92*x : 1.055*x^(1/2.4) - 0.055
        lut[i] = round(clamp(srgb, 0, 1) * 255)
    return lut

linearToSrgb8(x, lut):
    return lut[clamp(round(x * 4095), 0, 4095)]
```

**EOTF LUT** (encode, 256-entry):

```
precompute_eotf_lut(gamut):
    lut = array[256] of float64
    for i in 0..255: lut[i] = eotf[gamut](i / 255.0)
    return lut
```

The EOTF LUT applies to RGB channels only. Alpha is linearly normalized: `alpha = rgba[i*4+3] / 255.0`.

**Cosine precomputation** (encode):

```
precompute_cos_table(dim, max_freq):
    table = array[max_freq][dim] of float64
    for freq in 0..max_freq-1:
        for pos in 0..dim-1:
            table[freq][pos] = cos(π / dim * freq * (pos + 0.5))
    return table
```

**sRGB transfer functions:**

```
srgbGamma(x) = x ≤ 0.0031308 ? 12.92 × x : 1.055 × x^(1/2.4) − 0.055
srgbEOTF(x)  = x ≤ 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055)^2.4
```

**DCT encode:**

If the maximum AC magnitude after the main loop is below 1e-10, implementations MUST zero
all AC values and set scale to 0. This prevents amplification of floating-point noise for
near-constant channels (e.g., solid colors): dividing by a near-zero scale amplifies
platform-specific ULP differences into divergent quantized codes across implementations.

```
dctEncode(channel, w, h, nx, ny, cos_x, cos_y):
    dc = 0; ac = []; scale = 0
    for cy in 0..ny-1:
        for cx in 0.. while cx*ny < nx*(ny-cy):
            f = 0
            for y in 0..h-1:
                for x in 0..w-1:
                    f += channel[x + y*w] * cos_x[cx][x] * cos_y[cy][y]
            f /= w * h
            if cx > 0 or cy > 0: ac.append(f); scale = max(scale, abs(f))
            else: dc = f
    if scale < 1e-10:
        for i in 0..len(ac)-1: ac[i] = 0
        scale = 0
    return (dc, ac, scale)
```

**Bit packing:**

```
writeBits(hash, bitpos, count, value):
    for i in 0..count-1:
        byte_idx = (bitpos + i) / 8; bit_idx = (bitpos + i) % 8
        if (value >> i) & 1: hash[byte_idx] |= (1 << bit_idx)

readBits(hash, bitpos, count):
    value = 0
    for i in 0..count-1:
        byte_idx = (bitpos + i) / 8; bit_idx = (bitpos + i) % 8
        if hash[byte_idx] & (1 << bit_idx): value |= (1 << i)
    return value
```

---

## 13. Trade-offs & Limitations

| Trade-off | Details |
|-----------|---------|
| **Larger size** | Always 32 bytes vs 5–25 for variable-length formats. At 1B photos: 32 GB vs ~17 GB. Fixed size enables memory alignment and cache-friendly access. |
| **Encode cost** | Full-resolution encoding: ~400ms for 12MP in Rust (single-threaded) with all portable optimizations. |
| **Decode cost** | ~36µs native / ~182µs JS. OKLAB is 18× costlier per pixel than linear color, but both are <1ms. |
| **Solid images** | 26 bytes of zero AC coefficients wasted. Irrelevant for photographs. |
| **Extreme ratios** | Ratios beyond 16:1 clamp to 16:1. Rare in photography. |
| **Gamut clamp** | Out-of-sRGB OKLAB values are soft-clamped via Oklch bisection (hue-preserving). Almost always imperceptible at placeholder resolution. |
| **No progressive decode** | All 32 bytes must be received first. Never a practical bottleneck. |

---

## Appendix A: ThumbHash Comparison & Acknowledgment

ChromaHash is directly inspired by [ThumbHash](https://evanw.github.io/thumbhash/) by
Evan Wallace. Key inherited ideas: DCT with triangular coefficient selection, alpha
compositing over average color, and average color extraction from header.

| Feature | ThumbHash | ChromaHash |
|---------|-----------|------------|
| **Size** | 5–25 bytes (variable) | 32 bytes (fixed) |
| **Color space** | LPQA (gamma sRGB) | OKLAB (perceptually uniform) |
| **L DC / Chroma DC** | 6 / 6 bits | 7 / 7 bits |
| **L AC grid** | 3×3 to 7×7 (adaptive) | Adaptive via `deriveGrid` (up to 14×4) |
| **Chroma AC grid** | 3×3 (5 coeff) | 4×4 (9 coeff) |
| **L AC quantization** | 4-bit linear | 5-bit µ-law |
| **Aspect ratio** | 3-bit (~7% error) | 8-bit log₂ (~1.1% error) |
| **Aspect range** | up to ~7:1 | up to 16:1 |
| **Source gamuts** | sRGB only | sRGB, P3, Adobe RGB, BT.2020, ProPhoto |
| **Gamut clamping** | Hard per-channel | Soft Oklch bisection (hue-preserving) |
| **Input dimensions** | Any (library resizes) | Any (full-resolution DCT) |
| **Memory alignment** | No (variable length) | 32-byte aligned |

---

*This specification is licensed under the same terms as the ChromaHash project (MIT OR Apache-2.0).*
