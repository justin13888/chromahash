# ChromaHash Format Specification

**Version:** 0.1.0-draft
**Status:** Draft
**Date:** 2026-03-11

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
14. [Appendix A: ThumbHash Comparison & Acknowledgment](#appendix-a-thumbhash-comparison--acknowledgment)

---

## 1. Design Goals

ChromaHash targets professional photo management workloads (Google Photos-scale services
for creative professionals) where perceptual quality, layout precision, and wide-gamut
support matter more than minimizing byte count.

| Goal | Rationale |
|------|-----------|
| Fixed 32 bytes (256 bits) | Memory-aligned, cache-friendly, predictable storage. No variable-length parsing. Enables direct use as a database column, array element, or cache key with zero overhead. |
| OKLAB color space | Perceptually uniform — quantization levels are maximally efficient. Equal numerical steps correspond to equal perceived differences, unlike gamma-domain color spaces. |
| 8-bit log₂ aspect ratio | <0.55% error for all common photographic ratios. Eliminates the layout jank caused by coarse aspect ratio encoding (5–7% error in prior formats). |
| Higher chroma resolution | 4×4 triangular grid (9 AC coefficients) per chroma channel. Professional photography features complex color transitions (sunsets, fabric, foliage) that demand more than minimal chroma detail. |
| 5-bit luminance AC | 32 levels for the most perceptually important channel. Human vision is dominated by luminance — allocating extra precision here yields the largest quality gain per bit. |
| µ-law companding (µ=5) | Non-linear quantization matching the Laplacian distribution of natural image DCT coefficients. Finer resolution near zero where most coefficients cluster; coarser resolution in the rarely-used tails. |
| Multi-gamut encode | Source can be sRGB, Display P3, Adobe RGB, BT.2020, or ProPhoto RGB. Modern cameras and smartphones produce images in diverse color spaces — the encoder must handle all of them without gamut clipping at encode time. |
| Single decode target | Always sRGB output. One set of matrices, zero ambiguity, universal display compatibility. |
| Self-contained | No sidecar metadata — everything needed for decoding is in the 32 bytes. |
| Alpha support | Transparent images supported with graceful quality degradation, maintaining the fixed 32-byte size. |

### Design Priorities (ordered)

1. **Perceptual accuracy** — the placeholder should look as close to the original as possible within 32 bytes.
2. **Layout precision** — the decoded aspect ratio must closely match the original to prevent reflow when the real image loads.
3. **Wide-gamut correctness** — colors from P3/Adobe RGB/BT.2020 sources should be preserved as accurately as possible.
4. **Decode simplicity and speed** — the decoder should be trivially implementable and fast (<1ms even in JavaScript).
5. **Fixed size** — predictable storage and zero parsing complexity.

---

## 2. Conventions

### 2.1 Pseudocode Notation

- **Ranges:** `for i in 0..N` iterates from 0 to N **inclusive** (N+1 iterations).
- **Integer types:** All bit-field values are unsigned integers unless stated otherwise.

### 2.2 Rounding

All `round()` operations in this specification use **round half away from zero**:

```
round(x) = floor(x + 0.5)    for x ≥ 0
round(x) = ceil(x − 0.5)     for x < 0
```

Implementations MUST use this rounding mode. Banker's rounding (round half to even) is
statistically unbiased but is the default in only some target languages (e.g. Python 3),
requiring an explicit override in all others — offering no practical advantage over RHAFZ
while adding implementation complexity. Truncation introduces systematic negative bias and
is unsuitable for perceptual quantization. Cross-implementation bit-exactness is the
primary constraint; at the bit depths used here (5–7 bits) the bias from RHAFZ is
imperceptible.

### 2.3 Numerical Precision

Intermediate computations SHALL use at minimum IEEE 754 binary64 (float64) precision for
the encoding pipeline. The decoder MAY use float32 since the output is 8-bit RGBA, but
SHOULD use float64 for the M1/M2 matrix multiplications to match reference test vectors.

### 2.4 Cube Root of Negative Values

The OKLAB transform uses cube roots. Out-of-gamut colors can produce negative LMS values
after the M1 matrix multiplication. Implementations MUST handle negative inputs:

```
cbrt(x) = sign(x) × |x|^(1/3)
```

Implementations MUST NOT use `pow(x, 1.0/3.0)`, which is undefined for negative `x` in
many languages.

### 2.5 Reserved and Padding Bits

- **Bit 47 (reserved):** Encoders MUST set this to 0. Decoders MUST ignore this bit. This
  allows future revisions to repurpose it without breaking existing decoders.
- **Padding bit (no-alpha mode, bit 255):** Encoders MUST set this to 0. Decoders MUST
  ignore this bit.

### 2.6 Authoritative Constants

All constants, matrices, and scalar parameters are defined in `spec/constants.py`. That
file is the single source of truth. The matrices reproduced in §12 of this document are
for reference only — if there is a discrepancy, `constants.py` governs. Run
`spec/validate.py` to verify the constants against first-principles derivations.

---

## 3. Binary Format

A ChromaHash is exactly **32 bytes (256 bits)**. It consists of a 6-byte header followed by a 26-byte AC coefficient block.

### 3.1 Header (6 bytes = 48 bits)

All multi-bit fields are packed little-endian. The 48-bit header is read as:

```
header48 = hash[0] | (hash[1] << 8) | (hash[2] << 16) | (hash[3] << 24) | (hash[4] << 32) | (hash[5] << 40)
```

| Bits | Field | Width | Range | Description |
|------|-------|-------|-------|-------------|
| 0–6 | `L_dc` | 7 | 0–127 | OKLAB L (lightness), `round(127 × L_dc)` |
| 7–13 | `a_dc` | 7 | 0–127 | OKLAB a (green–red), centered: `round(64 + 63 × a_dc/MAX_CHROMA_A)` |
| 14–20 | `b_dc` | 7 | 0–127 | OKLAB b (blue–yellow), centered: `round(64 + 63 × b_dc/MAX_CHROMA_B)` |
| 21–26 | `L_scale` | 6 | 0–63 | Luminance AC max amplitude |
| 27–32 | `a_scale` | 6 | 0–63 | Chroma-a AC max amplitude |
| 33–37 | `b_scale` | 5 | 0–31 | Chroma-b AC max amplitude |
| 38–45 | `aspect` | 8 | 0–255 | Log₂ aspect ratio (see §8) |
| 46 | `hasAlpha` | 1 | 0/1 | Alpha channel present |
| 47 | `reserved` | 1 | 0 | Must be 0; reserved for future use |

**Bit allocation justification:**

- **`L_dc` (7 bits, 128 levels):** Luminance precision is the single most important factor
  for placeholder quality. Human vision is far more sensitive to lightness differences than
  chrominance differences. 128 levels (double the 64 levels typical in prior formats) ensure
  that the dominant visual impression — overall brightness — is accurately captured.

- **`a_dc` (7 bits, 128 levels):** The green–red axis is critical for skin tone accuracy.
  Skin colors occupy a narrow range on this axis, and professional photography is dominated
  by portraits. Matching `L_dc` precision here ensures subtle warmth differences between
  skin tones are preserved.

- **`b_dc` (7 bits, 128 levels):** The blue–yellow axis completes the trichromatic
  representation. Equal precision across all three DC components simplifies the codec and
  avoids introducing a systematic bias toward any perceptual axis.

- **`a_scale` (6 bits):** Matches `L_scale` precision because green–red AC variation
  matters most for skin tones — the dominant subject matter in professional photography.

- **`b_scale` (5 bits):** The blue–yellow axis carries less perceptually critical AC detail
  in most photographic content. Saving 1 bit here frees it for other fields without
  meaningful quality loss.

- **`aspect` (8 bits, 256 levels):** A full byte enables <0.55% error for all common
  photographic ratios. This is a major upgrade from the 3-bit encoding found in prior
  formats, which caused 5–7% errors and visible layout jank.

### 3.2 AC Block (26 bytes = 208 bits)

The AC block immediately follows the header at byte offset 6. Its internal layout depends
on the `hasAlpha` flag.

#### No-alpha mode (`hasAlpha = 0`)

```
Field           Coefficients   Bits/coeff   Total bits
────────────────────────────────────────────────────────
L AC            27 (7×7 tri)   5            135
a AC (chroma)   9 (4×4 tri)    4             36
b AC (chroma)   9 (4×4 tri)    4             36
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
L AC            20 (6×6 tri)   mixed*       107
a AC (chroma)   9 (4×4 tri)    4             36
b AC (chroma)   9 (4×4 tri)    4             36
A AC (alpha)    5 (3×3 tri)    4             20
                                            ─────
                                            208

* L AC mixed: first 7 coefficients at 6 bits (42 bits),
              remaining 13 at 5 bits (65 bits) = 107 total.
  Lowest-frequency L coefficients get extra precision.
```

**Verification:** Both modes produce exactly 48 + 208 = **256 bits = 32 bytes**. ✓

**Alpha mode design justification:** When alpha is present, the luminance grid shrinks from
7×7 to 6×6 (27 → 20 AC coefficients) and the freed bits accommodate the alpha channel's
DC value, scale factor, and 5 AC coefficients (3×3 grid). The first 7 luminance
coefficients (lowest frequencies, highest perceptual impact) are promoted to 6 bits to
partially compensate for the reduced grid. This ensures alpha support fits within the fixed
32-byte budget while minimizing quality degradation.

### 3.3 Complete Layout Diagram

```
No-alpha:
┌──────────────────────────────────────────────┬───────────────────────────────────────────────────┐
│              Header (6 bytes, 48 bits)        │           AC Block (26 bytes, 208 bits)           │
│ L_dc|a_dc|b_dc|L_scl|a_scl|b_scl|aspect|α|r │ L_ac×27(5b) | a_ac×9(4b) | b_ac×9(4b) | pad(1b)│
└──────────────────────────────────────────────┴───────────────────────────────────────────────────┘
 byte 0                                     5   6                                              31

Alpha:
┌──────────────────────────────────────────────┬───────────────────────────────────────────────────┐
│              Header (6 bytes, 48 bits)        │           AC Block (26 bytes, 208 bits)           │
│ L_dc|a_dc|b_dc|L_scl|a_scl|b_scl|aspect|α|r │ A_dc(5b)|A_scl(4b)|L_ac×7(6b)+13(5b)|           │
│                                              │ a_ac×9(4b)|b_ac×9(4b)|A_ac×5(4b)                 │
└──────────────────────────────────────────────┴───────────────────────────────────────────────────┘
 byte 0                                     5   6                                              31
```

---

## 4. Color Space: OKLAB

### 4.1 Choice Justification

ChromaHash uses OKLAB as its internal color space. This was selected after evaluating six
candidate color spaces against the design priorities of a professional photo management
service:

| Candidate | Verdict | Key issue |
|-----------|---------|-----------|
| **LPQA** (ThumbHash) | Rejected | Not perceptually uniform. Equal L steps ≠ equal perceived brightness. Skin tones occupy a tiny slice of P/Q and receive minimal quantization resolution. Operates in gamma-encoded sRGB — technically incorrect averaging. |
| **CIELAB** (CIE 1976) | Rejected | Known hue linearity problems — blue hues shift toward purple during interpolation. Requires chromatic adaptation to D50 (images are D65), adding complexity. |
| **YCbCr** (BT.601/709) | Rejected | Not perceptually uniform — designed for signal compression, not human perception. Equal Cb/Cr steps ≠ equal perceived color changes. |
| **ICtCp** (BT.2100) | Rejected | Excellent perceptual uniformity but designed for HDR/BT.2020/PQ — overkill for SDR placeholders. Requires PQ or HLG transfer functions. |
| **OKLCH** (cylindrical OKLAB) | Rejected | Same perceptual uniformity as OKLAB, but cylindrical coordinates (hue angle) create discontinuities at the 0°/360° boundary that break DCT encoding. |
| **OKLAB** | **Selected** | Perceptually uniform. Excellent hue linearity. D65 white point matches all target gamuts. Simple transform (two 3×3 matrices + cube root). Gamut-agnostic via CIE XYZ. Industry-adopted (CSS Color Level 4). |

### 4.2 Key Properties

- **Perceptually uniform:** Equal L steps produce equal perceived lightness changes. Equal
  a/b steps produce equal perceived chromaticity changes. This means fixed quantization
  levels are maximally efficient — no bits are wasted on imperceptible distinctions and no
  perceptible distinctions are collapsed.

- **Hue linearity:** Interpolation between two colors in OKLAB does not produce hue shifts.
  This is critical for DCT-based encoding, which inherently interpolates between frequency
  components. CIELAB infamously shifts blues toward purple; OKLAB does not.

- **D65 white point:** Matches sRGB, Display P3, Rec. 2020, and Adobe RGB natively. No
  chromatic adaptation needed (unlike CIELAB, which uses D50).

- **Gamut-agnostic:** OKLAB values are absolute, defined via CIE XYZ. The same OKLAB
  triplet represents the same perceived color regardless of which RGB gamut it was encoded
  from. Only the RGB→LMS conversion matrices change per source gamut.

- **Simple transform:** Two 3×3 matrix multiplications plus a cube root (forward) or cube
  (inverse). No iterative methods, no complex transfer functions.

### 4.3 OKLAB Transform

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

The matrices M1, M2, and their inverses are defined in §12 and `constants.py`.

---

## 5. Multi-Gamut Encoding

### 5.1 The Problem

A professional photo management service ingests images from diverse sources:

| Source | Color Space |
|--------|-------------|
| Sony α, Canon EOS R, Nikon Z, Fujifilm X/GFX (JPEG) | sRGB or Adobe RGB (user-selectable) |
| Canon EOS R (HDR PQ HEIF) | BT.2100 PQ / Rec. 2020 |
| Sony α (HEIF, HLG on) | BT.2100 / BT.2020 |
| Hasselblad X2D, 907X (via Phocus) | sRGB, Adobe RGB, or ProPhoto RGB |
| Apple iPhone 7+ (HEIC) | Display P3 |
| Google Pixel 8+ (HEIC) | Display P3 |
| Samsung Galaxy S (HEIC) | Display P3 (varies) |

All these gamuts share the D65 white point (except ProPhoto RGB, which uses D50 and
requires Bradford chromatic adaptation to D65 — incorporated into its M1 matrix).

### 5.2 Encoding Pipeline

```
Source RGB → Linearize (source EOTF) → LMS (M1[source_gamut]) → OKLAB (M2)
```

The resulting OKLAB values are **absolute** — the same physical color produces the same
(L, a, b) regardless of which gamut it was encoded from. This means:

- **No gamut flag is stored in the hash.** The 32 bytes contain no information about the
  source gamut — it is not needed.
- **No decode-time branching.** The decoder always uses the same matrices.
- **Wide-gamut colors are preserved in OKLAB.** A saturated P3 red that falls outside sRGB
  is encoded at its true OKLAB coordinates.

### 5.3 Decoding Pipeline

```
OKLAB → LMS_cbrt (M2_inv) → LMS (cube) → sRGB linear (M1_inv[sRGB]) → sRGB gamma → clamp → 8-bit RGBA
```

The decode target is always sRGB. This is justified because:

- At 32×32 resolution with DCT blurring, the average color (DC) of real photographs is
  almost never saturated enough to clip when converted to sRGB — even for P3/Adobe RGB
  sources. AC variations add subtle shifts that rarely push individual pixels out of gamut.
- sRGB is universally supported. On P3 displays, the browser/OS renders sRGB content
  correctly (it is a subset of P3).
- One set of decode matrices = zero ambiguity, simpler implementation.

### 5.4 Transfer Functions

The encoder must apply the correct transfer function to linearize source RGB:

| Gamut | Transfer function (gamma → linear) |
|-------|-------------------------------------|
| sRGB / Display P3 | Piecewise: `x ≤ 0.04045 ? x/12.92 : ((x+0.055)/1.055)^2.4` |
| Adobe RGB | `x^2.2` |
| ProPhoto RGB | `x^1.8` |
| BT.2020 PQ (ST 2084) | Inverse PQ EOTF (see below) |

The decoder always applies the **sRGB inverse EOTF** (linear → gamma):

```
gamma(x) = x ≤ 0.0031308 ? 12.92 × x : 1.055 × x^(1/2.4) − 0.055
```

**BT.2020 PQ inverse EOTF:**

```
Y = ((max(N^(1/78.84375) − 0.8359375, 0)) / (18.8515625 − 18.6875 × N^(1/78.84375)))^(1/0.1593017578)
where N = x / 10000  (PQ-encoded value normalized to peak luminance)
```

For ChromaHash encoding of HDR PQ content, the encoder MUST tone-map to SDR before OKLAB
conversion, since the placeholder is inherently an SDR representation. The specific
tone-mapping algorithm is implementation-defined; implementations encoding HDR content
MUST document which tone-mapping operator they use.

---

## 6. DCT & Coefficient Selection

### 6.1 Transform

ChromaHash uses a Type-II Discrete Cosine Transform (DCT-II) on a 2D grid.

**Forward transform** for a channel with grid dimensions `nx × ny`:

```
F(cx, cy) = (1 / (w × h)) × Σ_y Σ_x  channel[x + y×w] × cos(π/w × cx × (x + 0.5))
                                                         × cos(π/h × cy × (y + 0.5))
```

where `w` and `h` are the source image dimensions (≤ 100 pixels on each side).

**Inverse transform** (decode):

```
value = DC + Σ_j  AC[j] × cos(π/w × cx_j × (x + 0.5)) × cos(π/h × cy_j × (y + 0.5)) × C(cx_j, cy_j)
```

where the normalization factor `C` is:

```
C(cx, cy) = (cx > 0 ? 2 : 1) × (cy > 0 ? 2 : 1)
```

| AC term type | cx | cy | Factor |
|---|---|---|---|
| Horizontal only | >0 | 0 | 2 |
| Vertical only | 0 | >0 | 2 |
| Diagonal (2D) | >0 | >0 | 4 |

This is the standard 2D DCT-II inverse normalization: each dimension independently
contributes a factor of 2 for its AC components.

### 6.2 Triangular Coefficient Selection

Not all coefficients in the `nx × ny` grid are used. The condition that selects which
`(cx, cy)` pairs to include is:

```
cx × ny < nx × (ny − cy)
```

This defines a triangular region in frequency space, selecting coefficients below the
diagonal. The DC term `(0, 0)` is always extracted separately and stored in the header.

**Justification:** The triangular cutoff captures the most perceptually important
low-frequency coefficients while discarding the high-frequency corners that contribute
least to perceived quality. This is more efficient than a rectangular grid of the same
coefficient count — for N×N, the triangle contains N×(N+1)/2 positions (including DC),
providing broad low-frequency coverage without wasting bits on high-frequency diagonal
terms.

### 6.3 Coefficient Count Formula

For an N×N grid, the number of AC coefficients (excluding DC) is:

```
AC_count = N × (N + 1) / 2 − 1
```

### 6.4 Triangular Patterns

**3×3 grid — 5 AC coefficients** (chroma-a, chroma-b in alpha mode; alpha channel):

```
cy\cx  0    1    2
  0   [DC]  ✓    ✓
  1    ✓    ✓
  2    ✓
```

**4×4 grid — 9 AC coefficients** (chroma-a, chroma-b):

```
cy\cx  0    1    2    3
  0   [DC]  ✓    ✓    ✓
  1    ✓    ✓    ✓
  2    ✓    ✓
  3    ✓
```

**6×6 grid — 20 AC coefficients** (luminance in alpha mode):

```
cy\cx  0    1    2    3    4    5
  0   [DC]  ✓    ✓    ✓    ✓    ✓
  1    ✓    ✓    ✓    ✓    ✓
  2    ✓    ✓    ✓    ✓
  3    ✓    ✓    ✓
  4    ✓    ✓
  5    ✓
```

**7×7 grid — 27 AC coefficients** (luminance in no-alpha mode):

```
cy\cx  0    1    2    3    4    5    6
  0   [DC]  ✓    ✓    ✓    ✓    ✓    ✓
  1    ✓    ✓    ✓    ✓    ✓    ✓
  2    ✓    ✓    ✓    ✓    ✓
  3    ✓    ✓    ✓    ✓
  4    ✓    ✓    ✓
  5    ✓    ✓
  6    ✓
```

### 6.5 Grid Size Assignments

ChromaHash uses **fixed** grid sizes (unlike adaptive schemes):

| Channel | No-alpha | Alpha | Justification |
|---------|----------|-------|---------------|
| L (luminance) | 7×7 (27 AC) | 6×6 (20 AC) | Largest grid — human vision is dominated by luminance spatial detail |
| a (green–red chroma) | 4×4 (9 AC) | 4×4 (9 AC) | Doubled from 3×3 vs prior formats — captures complex color transitions |
| b (blue–yellow chroma) | 4×4 (9 AC) | 4×4 (9 AC) | Same as a-channel — sufficient for gradients in sunsets, sky, fabric |
| A (alpha) | — | 3×3 (5 AC) | Alpha masks are typically simple shapes; 5 AC is adequate |

**Justification for fixed grids:** ChromaHash does not adapt the luminance grid to aspect
ratio (unlike ThumbHash, which scales `lx`/`ly` proportionally). The grid is always square.
This simplifies implementation and avoids storing grid dimensions in the header — the grid
size is fully determined by the `hasAlpha` flag. The fixed 7×7 grid always provides maximum
luminance detail regardless of aspect ratio.

### 6.6 Coefficient Scan Order

Coefficients are scanned in **row-major order** within the triangle:

```
for cy in 0 .. ny-1:
    cx_start = (cy == 0) ? 1 : 0    # skip DC at (0,0)
    for cx in cx_start .. while cx*ny < nx*(ny-cy):
        emit coefficient (cx, cy)
```

This produces a deterministic ordering that all implementations MUST follow.

---

## 7. Quantization

### 7.1 DC Quantization

| Channel | Bits | Levels | Encode | Decode |
|---------|------|--------|--------|--------|
| L (lightness) | 7 | 128 | `round(127 × clamp(L_dc, 0, 1))` | `raw / 127.0` |
| a (green–red) | 7 | 128 | `round(64 + 63 × clamp(a_dc/MAX_CHROMA_A, -1, 1))` | `(raw - 64) / 63.0 × MAX_CHROMA_A` |
| b (blue–yellow) | 7 | 128 | `round(64 + 63 × clamp(b_dc/MAX_CHROMA_B, -1, 1))` | `(raw - 64) / 63.0 × MAX_CHROMA_B` |
| Alpha DC | 5 | 32 | `round(31 × clamp(A_dc, 0, 1))` | `raw / 31.0` |

L ranges [0, 1]. The a and b channels use centered encoding to represent their signed
range symmetrically. Alpha ranges [0, 1].

### 7.2 Scale Factor Quantization

Scale factors encode the maximum absolute AC value for each channel:

| Channel | Bits | Levels | Encode | Decode |
|---------|------|--------|--------|--------|
| L scale | 6 | 64 | `round(63 × clamp(L_scale/MAX_L_SCALE, 0, 1))` | `raw / 63.0 × MAX_L_SCALE` |
| a scale | 6 | 64 | `round(63 × clamp(a_scale/MAX_A_SCALE, 0, 1))` | `raw / 63.0 × MAX_A_SCALE` |
| b scale | 5 | 32 | `round(31 × clamp(b_scale/MAX_B_SCALE, 0, 1))` | `raw / 31.0 × MAX_B_SCALE` |
| Alpha scale | 4 | 16 | `round(15 × clamp(A_scale/MAX_A_ALPHA_SCALE, 0, 1))` | `raw / 15.0 × MAX_A_ALPHA_SCALE` |

### 7.3 AC Coefficient Quantization: µ-law Companding

All AC coefficients are quantized using **µ-law companding** with **µ = 5**.

**Justification:** Natural image DCT coefficients follow a roughly Laplacian distribution —
most values cluster near zero with a long tail. Linear quantization (as used by ThumbHash)
allocates equal resolution to all magnitudes, wasting bits on rarely-used large values while
under-resolving the dense cluster near zero. µ-law companding allocates finer steps near
zero and coarser steps near the extremes, matching the actual signal distribution.

The parameter µ = 5 was chosen as a balance: it provides ~2.6× finer near-zero resolution
than linear quantization without excessive compression of the tails.

**Compress (before quantization):**

```
compressed = sign(v) × log(1 + µ × |v|) / log(1 + µ)
```

**Quantize:**

```
index = clamp(round((compressed + 1) / 2 × (2^bits − 1)), 0, 2^bits − 1)
```

**Dequantize:**

```
compressed = index / (2^bits − 1) × 2 − 1
```

**Expand (after dequantization):**

```
v = sign(compressed) × ((1 + µ)^|compressed| − 1) / µ
```

### 7.4 Step Size Comparison (µ=5 vs linear)

| Bits | Levels | Linear step (near 0) | µ-law step (near 0) | Improvement |
|------|--------|----------------------|----------------------|-------------|
| 4 | 16 | 0.133 | 0.051 | 2.6× finer |
| 5 | 32 | 0.065 | 0.024 | 2.7× finer |

The finer near-zero resolution directly addresses banding artifacts in smooth gradients
(common in studio photography — backdrops, sky, fabric). It also eliminates the need for
ad-hoc saturation boost hacks — the µ-law encoding inherently preserves subtle color
variations.

### 7.5 AC Bit Depth by Channel

| Channel | No-alpha | Alpha |
|---------|----------|-------|
| L AC | 5 bits (all 27) | 6 bits (first 7) + 5 bits (remaining 13) |
| a AC | 4 bits (all 9) | 4 bits (all 9) |
| b AC | 4 bits (all 9) | 4 bits (all 9) |
| Alpha AC | — | 4 bits (all 5) |

**Justification for mixed L AC in alpha mode:** When the luminance grid shrinks from 7×7
to 6×6, the first 7 AC coefficients (lowest frequencies) are promoted to 6 bits. These
lowest-frequency components have the highest perceptual impact, so giving them extra
precision partially compensates for the reduced grid size.

---

## 8. Aspect Ratio Encoding

### 8.1 Encoding Formula

The aspect ratio is encoded as a single byte using a log₂ mapping:

```
Encode: byte = clamp(round((log₂(w / h) + 2) / 4 × 255), 0, 255)
Decode: ratio = 2^(byte / 255 × 4 − 2)
```

This maps log₂(ratio) from the range [−2, +2] to [0, 255], covering aspect ratios from
**1:4** (0.25) to **4:1** (4.0).

### 8.2 Justification

The log₂ encoding is symmetric about 1:1 (square) — portrait and landscape ratios of the
same proportions have the same error. The logarithmic scale ensures that the *relative*
error is roughly constant across the entire range, which matches human perception of
aspect ratio differences.

The theoretical maximum error for any ratio within the encodable range is:

```
max_error ≈ 2^(4/255/2) − 1 ≈ 0.54%
```

### 8.3 Error Analysis for Common Photographic Ratios

| Ratio | Actual | log₂ | Byte | Decoded | Error |
|-------|--------|------|------|---------|-------|
| 1:1 | 1.000 | 0.000 | 128 | 1.005 | 0.54% |
| 3:2 | 1.500 | 0.585 | 165 | 1.503 | 0.23% |
| 4:3 | 1.333 | 0.415 | 154 | 1.334 | 0.04% |
| 5:4 | 1.250 | 0.322 | 148 | 1.250 | 0.02% |
| 16:9 | 1.778 | 0.830 | 180 | 1.770 | 0.46% |
| 3:1 | 3.000 | 1.585 | 229 | 3.014 | 0.47% |
| 4:1 | 4.000 | 2.000 | 255 | 4.000 | 0.00% |

All portrait ratios are symmetric — 2:3 has the same error as 3:2.

**Practical impact:** For a 400px-wide placeholder, the worst-case layout jank is
~2 pixels (0.54% of height), compared to ~27 pixels with 3-bit encoding.

### 8.4 Decode Output Size

The decoder reconstructs a thumbnail image. By convention, the longer side is 32 pixels:

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

An image has alpha if any pixel's alpha value is less than fully opaque (255 for 8-bit
input). The `hasAlpha` flag in the header records this.

### 9.2 Alpha Compositing Before Encoding

Before OKLAB conversion, transparent pixels are composited over the alpha-weighted average
color. This ensures the L, a, b channels represent opaque color values while the alpha
channel is encoded separately.

```
1. Compute alpha-weighted average OKLAB (avg_L, avg_a, avg_b)
2. For each pixel:
     L_chan[i] = avg_L × (1 − alpha) + alpha × oklab[i].L
     a_chan[i] = avg_a × (1 − alpha) + alpha × oklab[i].a
     b_chan[i] = avg_b × (1 − alpha) + alpha × oklab[i].b
```

### 9.3 Alpha Channel Encoding

When `hasAlpha = 1`, the alpha channel is encoded as:

- **DC** (5 bits): `round(31 × A_dc)` — average opacity
- **Scale** (4 bits): `round(15 × A_scale / MAX_A_ALPHA_SCALE)` — AC amplitude
- **AC** (5 coefficients, 4 bits each): 3×3 triangular grid with µ-law companding

### 9.4 Budget Reallocation

To maintain the fixed 32-byte size, alpha mode reallocates bits from luminance:

| | No-alpha | Alpha | Change |
|---|----------|-------|--------|
| L grid | 7×7 (27 AC) | 6×6 (20 AC) | −7 coefficients |
| L AC bits | 5 per coeff | 6 (first 7) + 5 (last 13) | +7 bits for low-freq |
| Alpha overhead | — | 5+4+20 = 29 bits | +29 bits |
| Total AC bits | 208 | 208 | 0 change |

---

## 10. Encoding Algorithm

### 10.1 Input Requirements

- Image dimensions: `w ≤ 100`, `h ≤ 100` (downscale before encoding if larger)
- Pixel format: RGBA, 8 bits per channel
- Source gamut: one of {sRGB, Display P3, Adobe RGB, BT.2020, ProPhoto RGB}

### 10.2 Pseudocode

```
function chromaHashEncode(w, h, rgba, sourceGamut) -> byte[32]:
    assert w ≤ 100 and h ≤ 100

    # 1. Determine source gamut transfer function and M1 matrix
    eotf = TRANSFER_FUNCTIONS[sourceGamut]
    M1   = M1_MATRICES[sourceGamut]

    # 2. Convert all pixels to OKLAB
    oklab_pixels = new float[w × h × 3]
    alpha_pixels = new float[w × h]
    avg_L = 0; avg_a = 0; avg_b = 0; avg_alpha = 0

    for i in 0 .. w×h − 1:
        alpha = rgba[i×4 + 3] / 255
        r_lin = eotf(rgba[i×4 + 0] / 255)
        g_lin = eotf(rgba[i×4 + 1] / 255)
        b_lin = eotf(rgba[i×4 + 2] / 255)

        lms = M1 × [r_lin, g_lin, b_lin]
        lms_cbrt = [cbrt(lms[0]), cbrt(lms[1]), cbrt(lms[2])]
        lab = M2 × lms_cbrt

        avg_L += alpha × lab[0]
        avg_a += alpha × lab[1]
        avg_b += alpha × lab[2]
        avg_alpha += alpha

        oklab_pixels[i×3 + 0] = lab[0]
        oklab_pixels[i×3 + 1] = lab[1]
        oklab_pixels[i×3 + 2] = lab[2]
        alpha_pixels[i] = alpha

    # 3. Compute alpha-weighted average color
    #    If all pixels are fully transparent, default to black (L=0, a=0, b=0).
    if avg_alpha > 0:
        avg_L /= avg_alpha
        avg_a /= avg_alpha
        avg_b /= avg_alpha
    else:
        avg_L = 0; avg_a = 0; avg_b = 0

    # 4. Composite transparent pixels over average
    hasAlpha = avg_alpha < w × h
    L_chan = new float[w × h]
    a_chan = new float[w × h]
    b_chan = new float[w × h]

    for i in 0 .. w×h − 1:
        alpha = alpha_pixels[i]
        L_chan[i] = avg_L × (1 − alpha) + alpha × oklab_pixels[i×3 + 0]
        a_chan[i] = avg_a × (1 − alpha) + alpha × oklab_pixels[i×3 + 1]
        b_chan[i] = avg_b × (1 − alpha) + alpha × oklab_pixels[i×3 + 2]

    # 5. DCT encode each channel
    if hasAlpha:
        (L_dc, L_ac, L_scale) = dctEncode(L_chan, w, h, 6, 6)
        (a_dc, a_ac, a_scale) = dctEncode(a_chan, w, h, 4, 4)
        (b_dc, b_ac, b_scale) = dctEncode(b_chan, w, h, 4, 4)
        (A_dc, A_ac, A_scale) = dctEncode(alpha_pixels, w, h, 3, 3)
    else:
        (L_dc, L_ac, L_scale) = dctEncode(L_chan, w, h, 7, 7)
        (a_dc, a_ac, a_scale) = dctEncode(a_chan, w, h, 4, 4)
        (b_dc, b_ac, b_scale) = dctEncode(b_chan, w, h, 4, 4)

    # 6. Quantize header values
    L_dc_q  = round(127 × clamp(L_dc, 0, 1))
    a_dc_q  = round(64 + 63 × clamp(a_dc / MAX_CHROMA_A, -1, 1))
    b_dc_q  = round(64 + 63 × clamp(b_dc / MAX_CHROMA_B, -1, 1))
    L_scl_q = round(63 × clamp(L_scale / MAX_L_SCALE, 0, 1))
    a_scl_q = round(63 × clamp(a_scale / MAX_A_SCALE, 0, 1))
    b_scl_q = round(31 × clamp(b_scale / MAX_B_SCALE, 0, 1))

    # 7. Compute aspect byte
    aspect = clamp(round((log2(w / h) + 2) / 4 × 255), 0, 255)

    # 8. Pack header (48 bits = 6 bytes, little-endian)
    header = L_dc_q
           | (a_dc_q << 7)
           | (b_dc_q << 14)
           | (L_scl_q << 21)
           | (a_scl_q << 27)
           | (b_scl_q << 33)
           | (aspect << 38)
           | ((1 if hasAlpha else 0) << 46)
           # bit 47 reserved = 0

    hash = new byte[32]
    for i in 0..5: hash[i] = (header >> (i × 8)) & 0xFF

    # 9. Pack AC coefficients with µ-law companding
    #    When a channel's scale is 0 (all AC coefficients are zero, e.g. solid
    #    color), skip normalization and write the µ-law midpoint for each
    #    coefficient (the quantized index representing approximately zero).
    bitpos = 48

    # Helper: quantize one AC coefficient, handling scale=0
    function quantizeAC(value, scale, mu, bits):
        if scale == 0:
            return muLawQuantize(0, mu, bits)
        return muLawQuantize(value / scale, mu, bits)

    if hasAlpha:
        A_dc_q = round(31 × clamp(A_dc, 0, 1))
        A_scl_q = round(15 × clamp(A_scale / MAX_A_ALPHA_SCALE, 0, 1))
        writeBits(hash, bitpos, 5, A_dc_q);  bitpos += 5
        writeBits(hash, bitpos, 4, A_scl_q); bitpos += 4

        for i in 0..6:
            q = quantizeAC(L_ac[i], L_scale, 5, 6)
            writeBits(hash, bitpos, 6, q); bitpos += 6
        for i in 7..19:
            q = quantizeAC(L_ac[i], L_scale, 5, 5)
            writeBits(hash, bitpos, 5, q); bitpos += 5
    else:
        for i in 0..26:
            q = quantizeAC(L_ac[i], L_scale, 5, 5)
            writeBits(hash, bitpos, 5, q); bitpos += 5

    for i in 0..8:
        q = quantizeAC(a_ac[i], a_scale, 5, 4)
        writeBits(hash, bitpos, 4, q); bitpos += 4

    for i in 0..8:
        q = quantizeAC(b_ac[i], b_scale, 5, 4)
        writeBits(hash, bitpos, 4, q); bitpos += 4

    if hasAlpha:
        for i in 0..4:
            q = quantizeAC(A_ac[i], A_scale, 5, 4)
            writeBits(hash, bitpos, 4, q); bitpos += 4

    assert bitpos ≤ 256
    return hash
```

---

## 11. Decoding Algorithm

### 11.1 Pseudocode

```
function chromaHashDecode(hash) -> (w, h, rgba):
    # 1. Unpack header (48 bits)
    header = 0
    for i in 0..5: header |= hash[i] << (i × 8)

    L_dc_q  = header & 0x7F
    a_dc_q  = (header >> 7) & 0x7F
    b_dc_q  = (header >> 14) & 0x7F
    L_scl_q = (header >> 21) & 0x3F
    a_scl_q = (header >> 27) & 0x3F
    b_scl_q = (header >> 33) & 0x1F
    aspect  = (header >> 38) & 0xFF
    hasAlpha = (header >> 46) & 1

    # 2. Decode DC values and scale factors
    L_dc    = L_dc_q / 127.0
    a_dc    = (a_dc_q - 64) / 63.0 × MAX_CHROMA_A
    b_dc    = (b_dc_q - 64) / 63.0 × MAX_CHROMA_B
    L_scale = L_scl_q / 63.0 × MAX_L_SCALE
    a_scale = a_scl_q / 63.0 × MAX_A_SCALE
    b_scale = b_scl_q / 31.0 × MAX_B_SCALE

    # 3. Decode aspect ratio
    ratio = 2^(aspect / 255.0 × 4 − 2)

    # 4. Compute output size (32px on longer side)
    if ratio > 1:
        w = 32; h = round(32 / ratio)
    else:
        w = round(32 × ratio); h = 32

    # 5. Dequantize AC coefficients
    bitpos = 48

    if hasAlpha:
        A_dc    = readBits(hash, bitpos, 5) / 31.0;                        bitpos += 5
        A_scale = readBits(hash, bitpos, 4) / 15.0 × MAX_A_ALPHA_SCALE;    bitpos += 4

        L_ac = []
        for i in 0..6:
            L_ac.append(muLawDequantize(readBits(hash, bitpos, 6), 5, 6) × L_scale)
            bitpos += 6
        for i in 7..19:
            L_ac.append(muLawDequantize(readBits(hash, bitpos, 5), 5, 5) × L_scale)
            bitpos += 5
        lx = 6; ly = 6
    else:
        L_ac = []
        for i in 0..26:
            L_ac.append(muLawDequantize(readBits(hash, bitpos, 5), 5, 5) × L_scale)
            bitpos += 5
        lx = 7; ly = 7

    a_ac = []
    for i in 0..8:
        a_ac.append(muLawDequantize(readBits(hash, bitpos, 4), 5, 4) × a_scale)
        bitpos += 4

    b_ac = []
    for i in 0..8:
        b_ac.append(muLawDequantize(readBits(hash, bitpos, 4), 5, 4) × b_scale)
        bitpos += 4

    if hasAlpha:
        A_ac = []
        for i in 0..4:
            A_ac.append(muLawDequantize(readBits(hash, bitpos, 4), 5, 4) × A_scale)
            bitpos += 4

    # 6. Render output image
    rgba = new byte[w × h × 4]

    # Precompute cosine tables for efficiency
    # cos_x[cx][x] = cos(π / w × cx × (x + 0.5))
    # cos_y[cy][y] = cos(π / h × cy × (y + 0.5))

    for y in 0 .. h−1:
        for x in 0 .. w−1:
            # 6a. Evaluate inverse DCT for L, a, b channels
            #     Normalization: C(cx,cy) = (cx>0 ? 2 : 1) × (cy>0 ? 2 : 1)
            L = L_dc; a = a_dc; b = b_dc
            alpha = hasAlpha ? A_dc : 1.0

            j = 0
            for cy in 0 .. ly−1:
                cx_start = (cy > 0) ? 0 : 1
                cy_factor = (cy > 0) ? 2 : 1
                fy = cos(π / h × cy × (y + 0.5)) × cy_factor
                for cx in cx_start .. while cx×ly < lx×(ly−cy):
                    cx_factor = (cx > 0) ? 2 : 1
                    L += L_ac[j] × cos(π / w × cx × (x + 0.5)) × cx_factor × fy
                    j += 1

            j = 0
            for cy in 0 .. 3:
                cx_start = (cy > 0) ? 0 : 1
                cy_factor = (cy > 0) ? 2 : 1
                fy = cos(π / h × cy × (y + 0.5)) × cy_factor
                for cx in cx_start .. while cx < 4−cy:
                    cx_factor = (cx > 0) ? 2 : 1
                    fx = cos(π / w × cx × (x + 0.5)) × cx_factor
                    a += a_ac[j] × fx × fy
                    b += b_ac[j] × fx × fy
                    j += 1

            if hasAlpha:
                j = 0
                for cy in 0 .. 2:
                    cx_start = (cy > 0) ? 0 : 1
                    cy_factor = (cy > 0) ? 2 : 1
                    fy = cos(π / h × cy × (y + 0.5)) × cy_factor
                    for cx in cx_start .. while cx < 3−cy:
                        cx_factor = (cx > 0) ? 2 : 1
                        alpha += A_ac[j] × cos(π / w × cx × (x + 0.5)) × cx_factor × fy
                        j += 1

            # 6b. Convert OKLAB → sRGB
            lms_cbrt = M2_inv × [L, a, b]
            lms = [lms_cbrt[0]³, lms_cbrt[1]³, lms_cbrt[2]³]
            rgb_linear = M1_inv_sRGB × lms

            r = srgbGamma(clamp(rgb_linear[0], 0, 1))
            g = srgbGamma(clamp(rgb_linear[1], 0, 1))
            b_out = srgbGamma(clamp(rgb_linear[2], 0, 1))
            a_out = clamp(alpha, 0, 1)

            # 6c. Output as 8-bit RGBA
            idx = (y × w + x) × 4
            rgba[idx + 0] = round(255 × r)
            rgba[idx + 1] = round(255 × g)
            rgba[idx + 2] = round(255 × b_out)
            rgba[idx + 3] = round(255 × a_out)

    return (w, h, rgba)
```

### 11.2 Average Color Extraction (Header-Only Decode)

The DC coefficients in the header can be directly converted to an average RGBA color
without evaluating the DCT:

```
function chromaHashAverageColor(hash) -> (r, g, b, a):
    # Unpack header (same as decode steps 1–2)
    ...extract L_dc, a_dc, b_dc, hasAlpha...

    # Convert OKLAB DC → sRGB
    lms_cbrt = M2_inv × [L_dc, a_dc, b_dc]
    lms = [lms_cbrt[0]³, lms_cbrt[1]³, lms_cbrt[2]³]
    rgb_linear = M1_inv_sRGB × lms

    r = srgbGamma(clamp(rgb_linear[0], 0, 1))
    g = srgbGamma(clamp(rgb_linear[1], 0, 1))
    b = srgbGamma(clamp(rgb_linear[2], 0, 1))
    a = hasAlpha ? (decode alpha_dc from AC block) : 1.0

    return (round(255 × r), round(255 × g), round(255 × b), round(255 × a))
```

This is useful for dominant-color extraction, color-based sorting, and search.

---

## 12. Constants & Matrices

All constants are authoritatively defined in `spec/constants.py`. The values below are
reproduced for reference. Run `spec/validate.py` to verify correctness.

### 12.1 Scale Factor Maximums

These constants define the maximum representable scale factors. They MUST be identical
across all implementations. Values exceeding these bounds are clamped.

```
MAX_CHROMA_A       = 0.5    # Maximum absolute OKLAB 'a' DC value
MAX_CHROMA_B       = 0.5    # Maximum absolute OKLAB 'b' DC value
MAX_L_SCALE        = 0.5    # Maximum luminance AC amplitude
MAX_A_SCALE        = 0.5    # Maximum chroma-a AC amplitude
MAX_B_SCALE        = 0.5    # Maximum chroma-b AC amplitude
MAX_A_ALPHA_SCALE  = 0.5    # Maximum alpha AC amplitude
```

**Note:** These are preliminary values validated against theoretical OKLAB bounds for all
supported gamuts (see `validate.py` §5). MAX_CHROMA_A covers all practical images
including BT.2020 (max |a| ≈ 0.42); the ProPhoto RGB blue primary (|a| ≈ 1.35) clips,
but no realistic photograph has this as an average color. These values may be tightened
in a future revision after empirical tuning against a reference image corpus.

### 12.2 µ-law Parameter

```
µ = 5
```

### 12.3 M2 — Universal OKLAB Matrix (Ottosson)

Converts LMS cube-root values to OKLAB (L, a, b):

```
         ┌                                           ┐
         │  0.2104542553   0.7936177850  -0.0040720468 │
  M2  =  │  1.9779984951  -2.4285922050   0.4505937099 │
         │  0.0259040371   0.7827717662  -0.8086757660 │
         └                                           ┘
```

### 12.4 M2_inv — Inverse OKLAB Matrix

Converts OKLAB (L, a, b) to LMS cube-root values:

```
           ┌                                           ┐
           │  1.0000000000   0.3963377774   0.2158037573 │
  M2_inv = │  1.0000000000  -0.1055613458  -0.0638541728 │
           │  1.0000000000  -0.0894841775  -1.2914855480 │
           └                                           ┘
```

### 12.5 M1 — Source Gamut Matrices (Linear RGB → LMS)

All M1 matrices are derived as `M_LMS × M_XYZ[gamut]`, where `M_LMS` is the implicit
XYZ→LMS matrix from Ottosson's OKLAB. M1[sRGB] uses Ottosson's published values; other
matrices are derived consistently from the same foundation. See `validate.py` for the
full derivation chain.

**Property:** For all D65 gamuts, `M1 × [1, 1, 1]^T ≈ [1, 1, 1]^T` — D65 white in any
gamut maps to LMS white, which yields OKLAB `L=1, a=0, b=0`.

**M1[sRGB]:** (Ottosson published)

```
  ┌                                           ┐
  │  0.4122214708   0.5363325363   0.0514459929 │
  │  0.2119034982   0.6806995451   0.1073969566 │
  │  0.0883024619   0.2817188376   0.6299787005 │
  └                                           ┘
```

**M1[Display P3]:**

```
  ┌                                           ┐
  │  0.4813798544   0.4621183697   0.0565017758 │
  │  0.2288319449   0.6532168128   0.1179512422 │
  │  0.0839457557   0.2241652689   0.6918889754 │
  └                                           ┘
```

**M1[Adobe RGB]:**

```
  ┌                                           ┐
  │  0.5764322615   0.3699132211   0.0536545174 │
  │  0.2963164739   0.5916761266   0.1120073994 │
  │  0.1234782548   0.2194986958   0.6570230494 │
  └                                           ┘
```

**M1[BT.2020]:**

```
  ┌                                           ┐
  │  0.6167557872   0.3601983994   0.0230458134 │
  │  0.2651330640   0.6358393641   0.0990275718 │
  │  0.1001026342   0.2039065194   0.6959908464 │
  └                                           ┘
```

**M1[ProPhoto RGB]:** (includes Bradford chromatic adaptation from D50 to D65)

```
  ┌                                           ┐
  │  0.7154484635   0.3527915480  -0.0682400115 │
  │  0.2744116551   0.6677976408   0.0577907040 │
  │  0.1097844385   0.1861982875   0.7040172740 │
  └                                           ┘
```

### 12.6 M1_inv[sRGB] — Decoder Matrix (LMS → sRGB linear)

This is the **only** M1 inverse matrix the decoder needs:

```
  ┌                                            ┐
  │  4.0767416621  -3.3077115913   0.2309699292 │
  │ -1.2684380046   2.6097574011  -0.3413193965 │
  │ -0.0041960863  -0.7034186147   1.7076147010 │
  └                                            ┘
```

### 12.7 Helper Functions

**Cube root (handles negative values, see §2.4):**

```
cbrt(x) = sign(x) × abs(x)^(1/3)
```

**sRGB gamma (linear → gamma):**

```
srgbGamma(x) = x ≤ 0.0031308 ? 12.92 × x : 1.055 × x^(1/2.4) − 0.055
```

**sRGB EOTF (gamma → linear):**

```
srgbEOTF(x) = x ≤ 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055)^2.4
```

**µ-law quantize:**

```
muLawQuantize(value, mu, bits):
    compressed = sign(value) × log(1 + mu × abs(value)) / log(1 + mu)
    index = round((compressed + 1) / 2 × (2^bits − 1))
    return clamp(index, 0, 2^bits − 1)
```

**µ-law dequantize:**

```
muLawDequantize(index, mu, bits):
    compressed = index / (2^bits − 1) × 2 − 1
    return sign(compressed) × ((1 + mu)^abs(compressed) − 1) / mu
```

**DCT encode:**

```
dctEncode(channel, w, h, nx, ny):
    dc = 0; ac = []; scale = 0
    for cy in 0 .. ny−1:
        for cx in 0 .. while cx×ny < nx×(ny−cy):
            f = 0
            for y in 0 .. h−1:
                fy = cos(π / h × cy × (y + 0.5))
                for x in 0 .. w−1:
                    f += channel[x + y×w] × cos(π / w × cx × (x + 0.5)) × fy
            f /= w × h
            if cx > 0 or cy > 0:
                ac.append(f)
                scale = max(scale, abs(f))
            else:
                dc = f
    return (dc, ac, scale)
```

**Bit packing:**

```
writeBits(hash, bitpos, count, value):
    # Write 'count' bits of 'value' starting at bit position 'bitpos'
    # in little-endian byte order within the hash byte array.
    for i in 0 .. count−1:
        byte_idx = (bitpos + i) / 8
        bit_idx  = (bitpos + i) % 8
        if (value >> i) & 1:
            hash[byte_idx] |= (1 << bit_idx)

readBits(hash, bitpos, count):
    value = 0
    for i in 0 .. count−1:
        byte_idx = (bitpos + i) / 8
        bit_idx  = (bitpos + i) % 8
        if hash[byte_idx] & (1 << bit_idx):
            value |= (1 << i)
    return value
```

---

## 13. Trade-offs & Limitations

ChromaHash makes deliberate trade-offs. These should be understood before adoption.

### 13.1 Larger Size

ChromaHash is always 32 bytes. Prior compact formats range from 5–25 bytes.

- **Worst case:** 32 vs 25 = 28% larger.
- **Typical case:** 32 vs ~17 = 88% larger.
- **At scale:** At 1 billion photos, ChromaHash uses 32 GB vs ~17 GB. The difference
  (15 GB) is meaningful but not prohibitive at this scale.

**Justification:** The fixed size enables memory alignment, cache-friendly access, and
zero-overhead storage. The 7–15 extra bytes buy substantially better perceptual quality,
layout precision, and wide-gamut support.

### 13.2 Higher Computational Cost

OKLAB conversion costs ~90 FLOPs/pixel vs ~5 FLOPs/pixel for simple linear color
transforms — an 18× per-pixel increase.

| | Simple linear color space | ChromaHash (OKLAB) |
|---|---|---|
| Native (estimated) | ~20µs | ~36µs |
| JavaScript (estimated) | ~100µs | ~182µs |

Both are well under 1ms. The DCT evaluation (~265K FLOPs for 32×32) dominates the total
cost regardless of color space choice. The perceptual quality gain outweighs the cost.

**Optimization:** The sRGB gamma curve (most expensive single step at ~18 FLOPs/pixel) can
be replaced with a 256-entry LUT for decode, reducing per-pixel cost to ~54 FLOPs.

### 13.3 Wasted Bits for Simple Images

A solid-color image needs only ~6 bytes of information. ChromaHash always uses 32,
wasting 26 bytes on zero-valued AC coefficients. For a photo management service, this is
irrelevant — photographs are never solid colors.

### 13.4 Aspect Ratio Range Limitation

The log₂ encoding covers ratios from 1:4 to 4:1. Ratios beyond this range clamp to the
extremes. In practice, ratios beyond 4:1 are rare in photography (panoramas are typically
3:1 or less).

### 13.5 Wide Gamut Saturation Clamping at Decode

During decode to sRGB, pixels with out-of-sRGB-gamut OKLAB coordinates are clamped. At
32×32 resolution with DCT blurring, this is almost always imperceptible — the DC of real
photographs nearly always falls within sRGB, and AC variations are small.

### 13.6 Encoder Complexity

The encoder carries M1 matrices for each supported source gamut (5 matrices). These are
precomputed constants — no runtime computation — but the encoder binary is slightly larger.
The decoder is unaffected: it needs only M1_inv[sRGB] and M2_inv.

### 13.7 No Progressive Decoding

The fixed 32 bytes must be fully received before decoding. At 32 bytes, this is never a
practical bottleneck.

### 13.8 µ-law Companding Overhead

The µ-law encode/decode adds `pow()` calls per AC coefficient (up to 45 in the no-alpha
case). This can be mitigated with small lookup tables (32 entries for 5-bit, 16 for 4-bit)
since the input domain is discrete.

---

## Appendix A: ThumbHash Comparison & Acknowledgment

### Acknowledgment

ChromaHash is directly inspired by [ThumbHash](https://evanw.github.io/thumbhash/) by
Evan Wallace. ThumbHash pioneered the approach of using DCT-based frequency decomposition
with triangular coefficient selection to create compact, self-describing image placeholders.
ChromaHash builds on ThumbHash's core ideas while targeting the specific requirements of
professional photo management.

The key innovations ChromaHash inherits from ThumbHash include:

- **DCT with triangular coefficient selection** — the `cx × ny < nx × (ny − cy)` condition
  that efficiently selects low-frequency coefficients
- **Self-describing format** — all information needed for decoding is in the hash itself
- **Alpha compositing over average color** — transparent pixels are composited before
  encoding to separate opacity from color
- **Average color extraction from header** — DC values in the header enable color queries
  without full decode

### Detailed Comparison

| Feature | ThumbHash | ChromaHash |
|---------|-----------|------------|
| **Size** | 5–25 bytes (variable) | 32 bytes (fixed) |
| **Color space** | LPQA (linear sRGB mix) | OKLAB (perceptually uniform) |
| **Perceptual uniformity** | No — gamma-domain, non-uniform axes | Yes — equal steps = equal perceived differences |
| **L DC precision** | 6 bits (64 levels) | 7 bits (128 levels) |
| **Chroma DC precision** | 6 bits each | 7 bits each |
| **L AC grid (no alpha)** | 3×3 to 7×7 (adaptive to aspect ratio) | 7×7 fixed |
| **L AC grid (alpha)** | 3×3 to 5×5 (adaptive) | 6×6 fixed |
| **Chroma AC grid** | 3×3 (5 coefficients) | 4×4 (9 coefficients) |
| **L AC quantization** | 4 bits, linear | 5 bits, µ-law (µ=5) |
| **Chroma AC quantization** | 4 bits, linear + 1.25× saturation boost | 4 bits, µ-law (µ=5) |
| **Inverse DCT normalization** | ×2 for all AC terms | Correct 2D: ×2 (axis-aligned) / ×4 (diagonal) |
| **Aspect ratio encoding** | 3-bit grid dimension (~13 values) | 8-bit log₂ (256 levels) |
| **Aspect ratio error (3:2)** | 6.67% (27px jank at 400px) | 0.23% (1px jank at 400px) |
| **Aspect ratio error (worst)** | 7.14% | 0.54% |
| **Alpha support** | Yes (variable size) | Yes (fixed 32 bytes) |
| **Source gamut support** | sRGB only | sRGB, Display P3, Adobe RGB, BT.2020, ProPhoto RGB |
| **Decode target** | sRGB (implicit) | sRGB (explicit, mandatory) |
| **Memory alignment** | No (variable length) | 32-byte aligned |
| **Decode speed (est.)** | ~20µs native / ~100µs JS | ~36µs native / ~182µs JS |
| **Average color extraction** | Yes (header-only) | Yes (header-only) |

### Where ThumbHash Remains Superior

- **Size:** ThumbHash is 28–88% smaller for typical photographs. When byte count is the
  primary constraint (e.g., embedding in URL query parameters, HTTP headers, or QR codes),
  ThumbHash's variable-length design is more efficient.

- **Decode speed:** ThumbHash's LPQA transform is ~18× cheaper per pixel than OKLAB. While
  both formats decode well under 1ms, ThumbHash is faster in absolute terms.

- **Simplicity:** ThumbHash requires no color space conversion matrices, no transfer
  function evaluation, and no µ-law companding. A ThumbHash decoder is roughly half the
  code of a ChromaHash decoder.

- **Extreme aspect ratios:** ThumbHash supports ratios up to 7:1; ChromaHash clamps at 4:1.

### Where ChromaHash Improves

- **Perceptual quality:** OKLAB + µ-law companding produces visibly better placeholders,
  especially for skin tones, dark scenes, and smooth gradients.

- **Layout precision:** <0.55% aspect ratio error eliminates visible reflow jank.

- **Wide-gamut correctness:** P3/Adobe RGB/BT.2020 source colors are preserved through
  OKLAB's gamut-independent representation.

- **Predictable storage:** Fixed 32 bytes enables array-based storage, SIMD operations,
  and cache-line-aligned access patterns.

---

*This specification is licensed under the same terms as the ChromaHash project (MIT OR Apache-2.0).*
