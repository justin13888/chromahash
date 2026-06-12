# ChromaHash Format Specification

**Version:** 0.6.0
**Status:** Draft
**Date:** 2026-06-10

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
13. [Changes from v0.4/v0.5 to v0.6](#13-changes-from-v04v05-to-v06)
14. [Trade-offs & Limitations](#14-trade-offs--limitations)
15. [Appendix A: ThumbHash Comparison](#appendix-a-thumbhash-comparison--acknowledgment)

---

## 1. Design Goals

ChromaHash targets professional photo management workloads where perceptual quality,
layout precision, and wide-gamut support matter more than minimizing byte count.

| Goal | Rationale |
|------|-----------|
| Fixed 32 bytes | Memory-aligned, cache-friendly, predictable storage. Zero-overhead database column or cache key. |
| OKLAB color space | Perceptually uniform — quantization levels are maximally efficient. |
| 8-bit log₂ aspect ratio | ~1.09% max error for all photographic ratios. Covers 1:16 to 16:1. |
| Top-K coefficient selection | The K lowest spatial frequencies for the image's aspect ratio — a single deterministic rule, no grid machinery, no aliasing. |
| Quantization ranges sized to signal | Chroma DC spans the sRGB OKLAB hull; AC scale ranges match measured coefficient distributions. Every code level does work. |
| 5-bit luminance AC | 31 levels for the most perceptually important channel. |
| µ-law companding with exact zero | Non-linear quantization matching natural image DCT coefficient distributions; zero coefficients decode exactly. |
| Decode-aware DC selection | The encoder picks the DC codes whose *decoded* color is closest to the true average — gamut-corner solids round-trip nearly exactly. |
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
| v0.1 | 0 | Original spec — never publicly released |
| v0.2–v0.5 | 1 | Adaptive grids (`deriveGrid`), triangular selection, even-level µ-law, constant-L gamut clamp |
| **v0.6** | **0** | **This spec.** Top-K selection, exact-zero µ-law, decode-aware DC, relative-colorimetric gamut clip |

Encoders MUST set bit 47 to 0. Because v0.1 was never released, bit 47 = 0 unambiguously
identifies a v0.6 hash, and bit 47 = 1 identifies a legacy v0.2–v0.5 hash — the first
version break that is detectable from the hash bytes alone.

Decoders MUST treat bit 47 = 1 as an **unsupported version**: the legacy bitstreams use a
different coefficient selection, quantizer, and (in alpha mode) layout, so decoding them
with v0.6 logic produces garbage, not a degraded image. Where the API has an error path
(e.g. a fallible constructor or a `try_decode`), the hash SHOULD be rejected; otherwise
implementations MUST expose a version check (e.g. `is_version_supported()`) and document
that decode output for unsupported hashes is unspecified.

> **Pre-1.0 compatibility note:** v0.6 consumes the last in-band version value. Any
> post-v0.6 bitstream break would again require out-of-band version tracking (e.g. a
> database column or file-format tag). The v0.6 bitstream is intended to be carried
> forward to 1.0.

### 2.6 Padding Bits

In no-alpha mode, bit 255 is padding. Encoders MUST set it to 0; decoders MUST ignore it.
Alpha mode has no padding.

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
| 7–13 | `a_dc` | 7 | 1–127 | OKLAB a (green–red), centered |
| 14–20 | `b_dc` | 7 | 1–127 | OKLAB b (blue–yellow), centered |
| 21–26 | `L_scale` | 6 | 0–63 | Luminance AC max amplitude |
| 27–32 | `a_scale` | 6 | 0–63 | Chroma-a AC max amplitude |
| 33–37 | `b_scale` | 5 | 0–31 | Chroma-b AC max amplitude |
| 38–45 | `aspect` | 8 | 0–255 | Log₂ aspect ratio (see §8) |
| 46 | `hasAlpha` | 1 | 0/1 | Alpha channel present |
| 47 | `version` | 1 | 0 | Version bit (0 = v0.6; 1 = legacy v0.2–v0.5, unsupported) |

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

Coefficients are written in **selection order** (§6.2): the j-th value in each channel's
field corresponds to the j-th selected `(cx, cy)` frequency pair.

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

> **Note (v0.6):** DC chroma quantization ranges are sized to the sRGB OKLAB hull (§7.1).
> Wide-gamut colors outside the hull clip at encode — intentionally, because the decoder
> clips to sRGB anyway, so chroma range beyond the hull is unreachable and only wastes
> precision. The decode-aware DC selection (§10.3) chooses the codes whose decoded sRGB
> color is closest to the (clipped) true average, so clipping costs no decoded
> accuracy. AC coefficients are differences around the DC and are unaffected.

### 5.2 Decoding Pipeline

```
OKLAB → LMS_cbrt (M2_inv) → LMS (cube) → sRGB linear (M1_inv[sRGB]) → sRGB gamma → clamp → 8-bit RGBA
```

Decode target is always sRGB.

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

**Forward transform** over the source image (`w × h` pixels) for a selected frequency
pair `(cx, cy)`:

```
F(cx, cy) = (1 / (w × h)) × Σ_y Σ_x  channel[x + y×w] × cos(π/w × cx × (x + 0.5))
                                                         × cos(π/h × cy × (y + 0.5))
```

DC is `F(0, 0)` = the channel mean.

**Inverse transform** (decode, at render dimensions `w × h`):

```
value = DC + Σ_j  AC[j] × cos(π/w × cx_j × (x + 0.5)) × cos(π/h × cy_j × (y + 0.5)) × C(cx_j, cy_j)
```

Normalization factor: `C(cx, cy) = (cx > 0 ? 2 : 1) × (cy > 0 ? 2 : 1)`

### 6.2 Top-K Coefficient Selection

Which K frequency pairs each channel transmits is derived deterministically from the
aspect byte — no grid machinery, no mode flags:

```
function selectCoefficients(aspect_byte, K):
    (W, H) = decodeOutputSize(aspect_byte)         // §8.2; long side 32, short side ≥ 2
    entries = []
    for cy in 0 .. H−1:
        for cx in 0 .. W−1:
            if cx == 0 and cy == 0: continue       // DC is stored separately
            priority = (cx × H)² + (cy × W)²       // integer, fits in uint32
            entries.append((priority, cx, cy))
    sort entries ascending by (priority, cx, cy)   // lex tiebreak for determinism
    truncate entries to first K
    p_k = priority of the last (K-th) entry
    return ([(cx, cy) for (_, cx, cy) in entries], p_k)
```

**Candidate domain.** Candidates are exactly the frequencies representable at the
natural decode raster `[0, W) × [0, H)`. `cos(π/W × cx × (x+0.5))` with `cx = W`
evaluates to zero at every sample, and `cx > W` aliases to a lower frequency — the
bound makes selecting an unrepresentable frequency structurally impossible. The
candidate count is at least `2×32 − 1 = 63` for every aspect byte (short side ≥ 2),
so every K the format uses is always fully satisfied.

**Priority.** `(cx·H)² + (cy·W)²` is the squared isotropic per-pixel spatial frequency
scaled by `(W·H)²`: sorting ascending takes the K lowest spatial frequencies — an ℓ2
ball in frequency space, the ideal low-pass set for the radially decaying spectra of
natural images. Properties:

- **Square** (W = H = 32): priority ∝ `cx² + cy²` — radial order. First slots:
  `(0,1), (1,0)` (tied; lex tiebreak), then `(1,1)`, `(0,2)`, `(2,0)`, … At K = 27 the
  ball includes diagonals like `(3,4)/(4,3)` and excludes axis extremes like
  `(6,0)/(0,6)` — the opposite of v0.4's ℓ1 triangle, and the reason v0.6 does not
  produce v0.4's sparse high-frequency striping.
- **Extreme landscape** (byte 255: W = 32, H = 2): one `cy` step costs `(1×32)² = 1024`
  while one `cx` step costs `(1×2)² = 4` — the selection fills the long axis first, and
  no `cy ≥ 2` frequency can ever be selected.
- All arithmetic is integer (`priority ≤ 2×(31×32)² < 2³¹`); the sort is total via the
  `(priority, cx, cy)` key. Bit-exact across languages by construction.
- **Mirror symmetry caveat:** byte `b` and byte `255−b` have mirrored `(W, H)` and
  identical priority multisets, but when K cuts an equal-priority tie group the lex
  tiebreak may choose non-mirrored members (5 of 512 (byte, K) pairs). This is benign
  and pinned by the test vectors.

`p_k` (the K-th priority) is deterministic from the selection and is reserved for
frequency-normalized decoder extensions; it is pinned by the test vectors.

**K per channel:**

| Channel | Mode | K | Bits |
|---|---|---|---|
| L luminance | no-alpha | 27 | 5 each |
| L luminance | alpha | 20 | first 7 × 6, remaining 13 × 5 |
| a chroma | both | 9 | 4 each |
| b chroma | both | 9 | 4 each |
| Alpha | alpha | 5 | 4 each |

Run `python3 spec/selection.py --json` for all unique selections (one per `(W, H, K)`).

### 6.3 Encoder Frequency Clamp (Source Dimensions)

A selected pair `(cx, cy)` with `cx ≥ src_w` or `cy ≥ src_h` cannot be represented by
the source samples: the DCT basis is not orthogonal there and the projection
degenerates (e.g. `F(2, cy)` on a 1-pixel-wide image equals `−F(0, cy)` — a copy of
the DC masquerading as detail). Encoders MUST emit such coefficients as **exact zero**
and MUST exclude them from the scale computation (§7.2).

This is the guard for degenerate inputs (1×N strips, 1×1 images): without it, the junk
coefficient inflates the channel scale, crushes the real coefficients' precision, and
renders catastrophically at capped decode sizes.

### 6.4 Decoder Frequency Filter (Render Dimensions)

When rendering at dimensions `(w, h)` — natural or capped (§11.3) — decoders MUST skip
any coefficient with `cx ≥ w` or `cy ≥ h`. The remaining sum is the band-limited
reconstruction at the coarser raster: a 1×N render of a portrait hash is the exact
column profile rather than an aliased pattern.

At the natural render size the filter never excludes anything (the selection domain is
the natural raster); it only takes effect for sub-natural renders.

---

## 7. Quantization

### 7.1 DC Quantization

| Channel | Bits | Encode | Decode |
|---------|------|--------|--------|
| L | 7 | `round(127 × clamp(L_dc, 0, 1))` | `raw / 127.0` |
| a | 7 | `round(64 + 63 × clamp(a_dc/MAX_CHROMA_A, -1, 1))` | `(raw - 64) / 63.0 × MAX_CHROMA_A` |
| b | 7 | `round(64 + 63 × clamp(b_dc/MAX_CHROMA_B, -1, 1))` | `(raw - 64) / 63.0 × MAX_CHROMA_B` |
| Alpha | 5 | `round(31 × clamp(A_dc, 0, 1))` | `raw / 31.0` |

The nominal codes above are the starting point for the decode-aware DC search (§10.3),
which may shift each of L/a/b by ±1 code.

`MAX_CHROMA_A = 0.28` and `MAX_CHROMA_B = 0.32` cover the sRGB OKLAB hull
(max |a| = 0.2746 at the magenta corner, max |b| = 0.3115 at the blue corner). Chroma
beyond the hull is unreachable after the decoder's per-channel clip to sRGB, so the
range stops there — 1.4–1.6× finer DC steps than a range sized to wide-gamut sources.

> **Note:** The a/b DC encode formula `round(64 + 63×x)` produces indices in [1, 127],
> never 0. Conforming encoders MUST NOT produce raw=0 for a/b DC (the DC search clamps
> its candidates to [1, 127]). Decoders encountering raw=0 will reconstruct a slightly
> out-of-range chroma value; this is handled by the downstream per-channel gamut clip.

### 7.2 Scale Factor Quantization

Each channel's scale is the maximum |AC| over its **non-clamped** coefficients (§6.3).

| Channel | Bits | Encode | Decode |
|---------|------|--------|--------|
| L scale | 6 | `round(63 × clamp(L_scale/MAX_L_SCALE, 0, 1))` | `raw / 63.0 × MAX_L_SCALE` |
| a scale | 6 | `round(63 × clamp(a_scale/MAX_A_SCALE, 0, 1))` | `raw / 63.0 × MAX_A_SCALE` |
| b scale | 5 | `round(31 × clamp(b_scale/MAX_B_SCALE, 0, 1))` | `raw / 31.0 × MAX_B_SCALE` |
| Alpha scale | 4 | `round(15 × clamp(A_scale/MAX_A_ALPHA_SCALE, 0, 1))` | `raw / 15.0 × MAX_A_ALPHA_SCALE` |

`MAX_A_SCALE = MAX_B_SCALE = 0.125`: across the reference corpus the chroma AC scale
never exceeds 0.113. v0.5's 0.5 range wasted two bits of every chroma coefficient and
was the dominant cause of chroma banding and visible desaturation. `MAX_L_SCALE = 0.5`
is retained — luminance scales genuinely span the full range on synthetic content.

### 7.3 AC Coefficient Quantization: µ-law Companding (v0.6)

All AC coefficients use **µ-law companding** with a per-channel-group µ:

| Channel group | µ |
|---|---|
| L AC | `MU_L` = 5 |
| a/b AC | `MU_C` = 8 |
| Alpha AC | `MU_ALPHA` = 5 |

Chroma uses a higher µ because its tight scale range (§7.2) concentrates most
coefficients very near zero.

**Compress:** `compressed = sign(v) × log(1 + µ × |v|) / log(1 + µ)`

**Quantize (odd level count):**

```
max_idx = 2^bits − 2
index   = clamp(round((compressed + 1) / 2 × max_idx), 0, max_idx)
```

**Dequantize:**

```
index      = min(index, 2^bits − 2)        // top code is never written; clamp down
compressed = index / (2^bits − 2) × 2 − 1
```

**Expand:** `v = sign(compressed) × ((1 + µ)^|compressed| − 1) / µ`

v0.6 uses `2^bits − 1` levels (indices `0 ..= 2^bits − 2`) so the center index
(`2^(bits−1) − 1`) represents **exactly 0.0**. This removes v0.5's systematic zero bias
(+0.012·scale at 5 bits): solid colors, frequency-clamped slots (§6.3), and genuinely
zero coefficients decode exactly. The top code `2^bits − 1` is never produced by
encoders; decoders MUST clamp it down to `2^bits − 2` for robustness.

When a channel's scale is 0 (solid color), encoders write the center (zero) code for
every coefficient.

### 7.4 AC Bit Depths

| Channel | No-alpha | Alpha |
|---------|----------|-------|
| L AC | 5 bits (all 27) | 6 bits (first 7) + 5 bits (remaining 13) |
| a AC | 4 bits (all 9) | 4 bits (all 9) |
| b AC | 4 bits (all 9) | 4 bits (all 9) |
| Alpha AC | — | 4 bits (all 5) |

In alpha mode, the first 7 L AC coefficients (lowest frequencies, highest perceptual
impact) are promoted to 6 bits to partially compensate for the reduced K.

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
    w = 32; h = max(round(32 / ratio), 1)
else:
    w = max(round(32 × ratio), 1); h = 32
```

Over the byte range this yields a short side of at least 2 pixels (byte 0 → 2×32;
byte 255 → 32×2), which the selection domain (§6.2) relies on. Implementations MAY
render at other sizes; see §6.4 and §11.3.

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

When `hasAlpha = 1`: DC (5 bits), scale (4 bits), 5 AC coefficients (selection with
K = 5, 4 bits each, µ-law companded with `MU_ALPHA`). The luminance K shrinks from 27
to 20, with freed bits accommodating the alpha channel (29 bits total).

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

    // 5. Select coefficients (§6.2)
    aspect_byte = clamp(round((log2(W/H) + 4) / 8 * 255), 0, 255)
    L_K = 20 if hasAlpha else 27
    (L_sel, _) = selectCoefficients(aspect_byte, L_K)
    (C_sel, _) = selectCoefficients(aspect_byte, 9)
    if hasAlpha: (A_sel, _) = selectCoefficients(aspect_byte, 5)

    // 6. Precompute cosine tables over the source dims, covering every selected
    //    frequency. Rows for frequencies ≥ source dims exist but are never read
    //    (the frequency clamp in dctEncode skips them).
    max_cx = max over all selections of cx; max_cy = max over all selections of cy
    cos_x = precompute_cos_table(W, min(max_cx + 1, W))
    cos_y = precompute_cos_table(H, min(max_cy + 1, H))

    // 7. DCT encode each channel (frequency clamp built in, §6.3)
    (L_dc, L_ac, L_scale) = dctEncode(L_chan, W, H, L_sel, cos_x, cos_y)
    (a_dc, a_ac, a_scale) = dctEncode(a_chan, W, H, C_sel, cos_x, cos_y)
    (b_dc, b_ac, b_scale) = dctEncode(b_chan, W, H, C_sel, cos_x, cos_y)
    if hasAlpha:
        (A_dc, A_ac, A_scale) = dctEncode(alphas, W, H, A_sel, cos_x, cos_y)

    // 8. Quantize header (decode-aware DC selection, §10.3)
    (L_dc_q, a_dc_q, b_dc_q) = selectDcCodes(L_dc, a_dc, b_dc)
    L_scl_q = round(63 * clamp(L_scale / MAX_L_SCALE, 0, 1))
    a_scl_q = round(63 * clamp(a_scale / MAX_A_SCALE, 0, 1))
    b_scl_q = round(31 * clamp(b_scale / MAX_B_SCALE, 0, 1))

    // 9. Pack header (48 bits, little-endian); bit 47 stays 0 (v0.6)
    header = L_dc_q | (a_dc_q << 7) | (b_dc_q << 14)
           | (L_scl_q << 21) | (a_scl_q << 27) | (b_scl_q << 33)
           | (aspect_byte << 38)
           | ((1 if hasAlpha else 0) << 46)
    hash = new byte[32]
    for i in 0..5: hash[i] = (header >> (i*8)) & 0xFF

    // 10. Pack AC with µ-law companding (§7.3)
    function qAC(value, scale, bits, mu):
        if scale == 0: return muLawQuantize(0, bits, mu)
        return muLawQuantize(value / scale, bits, mu)

    bitpos = 48
    if hasAlpha:
        writeBits(hash, bitpos, 5, round(31*clamp(A_dc,0,1))); bitpos += 5
        writeBits(hash, bitpos, 4, round(15*clamp(A_scale/MAX_A_ALPHA_SCALE,0,1))); bitpos += 4
        for i in 0..6:  writeBits(hash, bitpos, 6, qAC(L_ac[i],L_scale,6,MU_L)); bitpos += 6
        for i in 7..19: writeBits(hash, bitpos, 5, qAC(L_ac[i],L_scale,5,MU_L)); bitpos += 5
    else:
        for i in 0..26: writeBits(hash, bitpos, 5, qAC(L_ac[i],L_scale,5,MU_L)); bitpos += 5

    for i in 0..8: writeBits(hash, bitpos, 4, qAC(a_ac[i],a_scale,4,MU_C)); bitpos += 4
    for i in 0..8: writeBits(hash, bitpos, 4, qAC(b_ac[i],b_scale,4,MU_C)); bitpos += 4

    if hasAlpha:
        for i in 0..4: writeBits(hash, bitpos, 4, qAC(A_ac[i],A_scale,4,MU_ALPHA)); bitpos += 4

    if not hasAlpha:
        assert bitpos == 255    // bit 255 is padding (§2.6), implicit zero
    else:
        assert bitpos == 256
    return hash
```

### 10.3 Decode-Aware DC Selection

Plain rounding of the DC triple, combined with quantization and the decoder's
per-channel clip of out-of-gamut chroma (§12.6), can land the decoded flat color away
from the true average. The encoder therefore simulates the decoder's DC path and
searches the ±1 neighborhood of the nominal codes:

```
function dcDecodeSim(L_q, a_q, b_q) -> (r, g, b):    // gamma-encoded sRGB floats
    L = L_q / 127.0
    a = (a_q - 64) / 63.0 * MAX_CHROMA_A
    b = (b_q - 64) / 63.0 * MAX_CHROMA_B
    rgb_lin = oklabToLinearRgb(clamp(L, 0, 1), a, b)
    return (srgbGamma(clamp(rgb_lin[0],0,1)), srgbGamma(clamp(rgb_lin[1],0,1)),
            srgbGamma(clamp(rgb_lin[2],0,1)))

function selectDcCodes(L_mean, a_mean, b_mean) -> (L_q, a_q, b_q):
    L0 = round(127 * clamp(L_mean, 0, 1))
    a0 = round(64 + 63 * clamp(a_mean / MAX_CHROMA_A, -1, 1))
    b0 = round(64 + 63 * clamp(b_mean / MAX_CHROMA_B, -1, 1))

    // Target = the best color the decoder could show for the true average
    // (out-of-gamut targets are clipped per-channel, same as the decoder)
    rgb_lin = oklabToLinearRgb(clamp(L_mean, 0, 1), a_mean, b_mean)
    target = (srgbGamma(clamp(rgb_lin[0],0,1)), srgbGamma(clamp(rgb_lin[1],0,1)),
              srgbGamma(clamp(rgb_lin[2],0,1)))

    best = (L0, a0, b0); best_err = +infinity
    for dL in [0, -1, +1]:                       // fixed order — deterministic
      for da in [0, -1, +1]:
        for db in [0, -1, +1]:
            L_q = clamp(L0 + dL, 0, 127)
            a_q = clamp(a0 + da, 1, 127)
            b_q = clamp(b0 + db, 1, 127)
            cand = dcDecodeSim(L_q, a_q, b_q)
            err  = (cand.r - target.r)² + (cand.g - target.g)² + (cand.b - target.b)²
            if err < best_err:                   // strict < keeps the nominal codes on ties
                best_err = err; best = (L_q, a_q, b_q)
    return best
```

27 candidates × one DC simulation each (~10 µs total) — negligible next to the DCT.
The fixed iteration order and strict-improvement comparison make the result
deterministic and bit-exact across implementations. For solid images (scale = 0, all
AC exactly zero per §7.3) the decoded color equals the simulation, so gamut-corner
solids round-trip nearly exactly.

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
    // version MUST be 0 for v0.6; 1 identifies a legacy v0.2–v0.5 hash (§2.5).
    // Reject where the API allows; otherwise output is unspecified.

    // 2. Decode DC and scale factors
    L_dc    = L_dc_q / 127.0
    a_dc    = (a_dc_q - 64) / 63.0 * MAX_CHROMA_A
    b_dc    = (b_dc_q - 64) / 63.0 * MAX_CHROMA_B
    L_scale = L_scl_q / 63.0 * MAX_L_SCALE
    a_scale = a_scl_q / 63.0 * MAX_A_SCALE
    b_scale = b_scl_q / 31.0 * MAX_B_SCALE

    // 3. Coefficient selection (mirrors the encoder exactly, §6.2)
    L_K = 20 if hasAlpha else 27
    (L_sel, _) = selectCoefficients(aspect, L_K)
    (C_sel, _) = selectCoefficients(aspect, 9)

    // 4. Decode output size (§8.2)
    ratio = 2^(aspect / 255.0 * 8 - 4)
    if ratio > 1: w = 32; h = max(round(32 / ratio), 1)
    else: w = max(round(32 * ratio), 1); h = 32

    // 5. Dequantize AC from bitstream (read exactly K values per channel)
    bitpos = 48
    if hasAlpha:
        A_dc    = readBits(hash, bitpos, 5) / 31.0; bitpos += 5
        A_scale = readBits(hash, bitpos, 4) / 15.0 * MAX_A_ALPHA_SCALE; bitpos += 4
        (A_sel, _) = selectCoefficients(aspect, 5)

        L_ac = []
        for i in 0..6:  L_ac.append(muLawDequantize(readBits(hash,bitpos,6),6,MU_L)*L_scale); bitpos += 6
        for i in 7..19: L_ac.append(muLawDequantize(readBits(hash,bitpos,5),5,MU_L)*L_scale); bitpos += 5
    else:
        L_ac = []
        for i in 0..26: L_ac.append(muLawDequantize(readBits(hash,bitpos,5),5,MU_L)*L_scale); bitpos += 5

    a_ac = []; for i in 0..8: a_ac.append(muLawDequantize(readBits(hash,bitpos,4),4,MU_C)*a_scale); bitpos += 4
    b_ac = []; for i in 0..8: b_ac.append(muLawDequantize(readBits(hash,bitpos,4),4,MU_C)*b_scale); bitpos += 4
    if hasAlpha:
        A_ac = []; for i in 0..4: A_ac.append(muLawDequantize(readBits(hash,bitpos,4),4,MU_ALPHA)*A_scale); bitpos += 4

    // 6. Frequency filter for the render raster (§6.4). At the natural size
    //    this removes nothing; for capped renders it removes frequencies the
    //    coarser raster cannot represent.
    (L_vals, L_scan) = filter (L_ac[j], L_sel[j]) where L_sel[j].cx < w and L_sel[j].cy < h
    (a_vals, C_scan) = filter likewise over C_sel; (b_vals, _) = likewise
    if hasAlpha: (A_vals, A_scan) = likewise over A_sel

    // 7. Build sRGB gamma LUT and render
    gamma_lut = buildGammaLut()
    rgba = new byte[w * h * 4]

    for y in 0..h-1:
        for x in 0..w-1:
            // Inverse DCT per channel over the filtered coefficients
            L = L_dc
            for j, (cx, cy) in L_scan:
                L += L_vals[j] * cos(π/w*cx*(x+0.5)) * cos(π/h*cy*(y+0.5))
                               * ((cx>0?2:1) * (cy>0?2:1))

            a = a_dc; b = b_dc
            for j, (cx, cy) in C_scan:
                fx = cos(π/w*cx*(x+0.5)) * cos(π/h*cy*(y+0.5)) * ((cx>0?2:1) * (cy>0?2:1))
                a += a_vals[j] * fx
                b += b_vals[j] * fx

            alpha = hasAlpha ? A_dc : 1.0
            if hasAlpha:
                for j, (cx, cy) in A_scan:
                    alpha += A_vals[j] * cos(π/w*cx*(x+0.5)) * cos(π/h*cy*(y+0.5))
                                       * ((cx>0?2:1) * (cy>0?2:1))

            // Clamp L from DCT ringing; out-of-gamut chroma is handled by the
            // per-channel clip of rgb_lin below (relative-colorimetric, §12.6)
            L = clamp(L, 0.0, 1.0)

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
    lms_cbrt = M2_inv × [L_dc, a_dc, b_dc]  // out-of-gamut chroma clipped per-channel below
    lms = [lms_cbrt[0]³, lms_cbrt[1]³, lms_cbrt[2]³]
    rgb_lin = M1_inv_sRGB × lms
    r = srgbGamma(clamp(rgb_lin[0], 0, 1))
    g = srgbGamma(clamp(rgb_lin[1], 0, 1))
    b = srgbGamma(clamp(rgb_lin[2], 0, 1))
    a = hasAlpha ? (decode alpha_dc from AC block) : 1.0
    return (round(255×r), round(255×g), round(255×b), round(255×a))
```

### 11.3 Capped Decode

Implementations SHOULD provide a capped decode that renders at
`(min(natural_w, max_w), min(natural_h, max_h))` — useful when the caller's display
target is smaller than the natural 32-px render. Rendering below the natural size MUST
apply the frequency filter of §6.4; the result is the band-limited reconstruction at
the coarser raster. Caps larger than the natural size MUST NOT upscale.

The capped path is pinned by `spec/test-vectors/integration-decode-capped.json`,
including 1×N renders of degenerate-aspect hashes (the v0.5 aliasing regression).

---

## 12. Constants & Matrices

All constants are authoritatively defined in `spec/constants.py`.

### 12.1 Scalar Constants

```
MAX_CHROMA_A       = 0.28    # Max absolute OKLAB 'a' DC (sRGB hull max |a| = 0.2746)
MAX_CHROMA_B       = 0.32    # Max absolute OKLAB 'b' DC (sRGB hull max |b| = 0.3115)
MAX_L_SCALE        = 0.5     # Max luminance AC amplitude
MAX_A_SCALE        = 0.125   # Max chroma-a AC amplitude (corpus max: 0.111)
MAX_B_SCALE        = 0.125   # Max chroma-b AC amplitude (corpus max: 0.113)
MAX_A_ALPHA_SCALE  = 0.5     # Max alpha AC amplitude
MU_L               = 5       # µ-law parameter, luminance AC
MU_C               = 8       # µ-law parameter, chroma AC
MU_ALPHA           = 5       # µ-law parameter, alpha AC
```

These values were locked by a coordinate-descent sweep against the reference comparison
corpus (52 images: natural photographs plus synthetic dimension/alpha/color/gamut
fixtures), optimizing mean CIEDE2000 with SSIMULACRA2/Butteraugli/DSSIM as guards.

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

**Gamut clip** (relative-colorimetric, per-channel):

Out-of-sRGB OKLAB values are mapped to the display gamut by **per-channel clipping in
linear sRGB** — i.e. after `oklabToLinearRgb`, each channel is clamped to `[0, 1]`
before the gamma encode. This is exactly the `clamp(rgb_lin[i], 0, 1)` already present
in the decode loop (§11) and the DC-search simulation (§10.3); there is no separate
clamp helper. The result is what a standard sRGB display shows for the same color
(maximum in-gamut saturation toward the gamut corner), so the decoded placeholder
matches how the source image actually renders.

> **Why relative-colorimetric clip:** an out-of-gamut color has no exact sRGB
> representation. Per-channel clipping keeps the color at the gamut boundary (maximum
> saturation), matching the standard display rendering. Earlier versions instead
> *desaturated* out-of-gamut colors toward gray (v0.2–v0.5: constant-L clamp; an interim
> v0.6 draft: a lightness-blended soft clamp), which made saturated wide-gamut solids —
> e.g. a Display P3 or ProPhoto red — decode noticeably washed-out relative to the real
> image. Clipping is also simpler and branch-free.

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

**Cosine precomputation:**

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

**DCT encode** (with the §6.3 frequency clamp):

If the maximum AC magnitude after the main loop is below 1e-10, implementations MUST zero
all AC values and set scale to 0. This prevents amplification of floating-point noise for
near-constant channels (e.g., solid colors): dividing by a near-zero scale amplifies
platform-specific ULP differences into divergent quantized codes across implementations.

```
dctEncode(channel, w, h, selection, cos_x, cos_y):
    // DC: cx=0, cy=0 — cos(0)=1 everywhere, so DC = mean(channel)
    dc = sum(channel) / (w * h)
    ac = []; scale = 0
    for (cx, cy) in selection:
        if cx >= w or cy >= h:        // frequency clamp (§6.3): unrepresentable
            ac.append(0.0)            //   → exact zero, excluded from scale
            continue
        f = 0
        for y in 0..h-1:
            for x in 0..w-1:
                f += channel[x + y*w] * cos_x[cx][x] * cos_y[cy][y]
        f /= w * h
        ac.append(f); scale = max(scale, abs(f))
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

## 13. Changes from v0.4/v0.5 to v0.6

v0.6 is bitstream-incompatible with v0.4/v0.5 (which shared a bitstream). Header bit 47
flips from 1 to 0, so the break is detectable in-band (§2.5) — unlike the v0.3 → v0.4
break. The redesign fixed four diagnosed quality failures, measured on the reference
comparison corpus (52 images, color-managed metrics):

| Mean ΔE00 (lower = better) | v0.6 | v0.5 | ThumbHash |
|---|---|---|---|
| All images | **4.62** | 8.38 | 7.56 |
| Natural photographs | **8.75** | 9.52 | 10.60 |
| Degenerate dimensions | **1.81** | 18.10 | 10.09 |
| Wide-gamut fixtures | **2.67** | 4.71 | 5.23 |

### Change 1 — Top-K coefficient selection (§6.2) replaces deriveGrid + triangle + scan order

**Problem.** v0.4 derived a grid shape from the aspect byte, masked it with an ℓ1
triangle, sorted by priority, then truncated to the bit budget — four mechanisms whose
composition could select frequencies that don't exist (a 4×14 grid for a 1-pixel-wide
source) while spending slots on sparse axis-aligned high frequencies (`cx` up to 8 at
3:2) that reconstruct as visible striping.

**Fix.** One mechanism: take the K lowest isotropic per-pixel spatial frequencies over
the natural-decode domain `[0, W) × [0, H)`. The domain bound makes unrepresentable
frequencies unselectable; the ℓ2 ball matches natural-image spectra; `deriveGrid`, the
triangle test, and the separate scan-order sort are deleted. The priority formula and
lex tiebreak are unchanged from v0.4 — only the candidate set differs.

### Change 2 — Encoder frequency clamp to source dimensions (§6.3)

**Problem.** Encoding a 1×N image computed `F(cx, cy)` for `cx ≥ 1` over a single
column: the basis is degenerate there and `F(2, cy) = −F(0, cy)` — a junk copy of the
DC that inflated the channel scale ~5×, crushed every real coefficient's precision, and
rendered as solid white at capped decode sizes (where `cos(π·2·0.5) = −1`).

**Fix.** Selected pairs with `cx ≥ src_w` or `cy ≥ src_h` are written as exact zeros and
excluded from the scale max. The dim-1x100 corpus fixture improves from ΔE00 54.5 to 0.78.

### Change 3 — Decoder frequency filter for sub-natural renders (§6.4, §11.3)

Capped decodes now skip coefficients the render raster cannot represent, yielding the
band-limited reconstruction instead of aliasing. Pinned by the new
`integration-decode-capped.json` vectors.

### Change 4 — Exact-zero µ-law with per-channel µ (§7.3)

**Problem.** v0.5's `2^bits` levels had no zero code: a zero coefficient decoded to
+0.012·scale (5-bit) / +0.025·scale (4-bit), a systematic bias across every empty slot.

**Fix.** Odd level count (`2^bits − 1`) with an exact-zero center code; the never-written
top code clamps down on read. Solid colors decode exactly uniform. µ splits per channel
group (`MU_L = 5`, `MU_C = 8`, `MU_ALPHA = 5`) — chroma's tight scale range concentrates
coefficients near zero, where a higher µ buys resolution.

### Change 5 — Quantization ranges sized to signal (§7.1, §7.2)

**Problem.** Chroma DC ranges (±0.45) were sized to wide-gamut source extremes the sRGB
decoder can never display, and chroma AC scale ranges (0.5) exceeded the measured corpus
maximum (0.113) by 4.4× — together wasting roughly two bits of every chroma field. The
result was visible chroma banding and desaturation.

**Fix.** `MAX_CHROMA_A/B` sized to the sRGB OKLAB hull (0.28/0.32); `MAX_A/B_SCALE`
to 0.125. This was the single largest quality win of the revision.

### Change 6 — Decode-aware DC code selection (§10.3)

**Problem.** Rounding the DC triple independently could land just outside the sRGB
gamut, where the decoder's clamp dragged it far away: solid blue `(0,0,255)` decoded
as `(0,58,214)` (ΔE00 7.75).

**Fix.** The encoder simulates the decoder's DC path for the 27 code triples in the ±1
neighborhood and keeps the one minimizing gamma-sRGB error against the clamp-mapped
target. Deterministic (fixed order, strict improvement, ties keep nominal). Solid blue
now decodes at ΔE00 0.36.

### Change 7 — Relative-colorimetric gamut clip (§12.6)

**Problem.** Both the v0.2–v0.5 constant-L clamp and an interim v0.6 lightness-blended
soft clamp *desaturated* out-of-sRGB colors (toward gray / toward the gamut interior),
so saturated wide-gamut solids — a Display P3 or ProPhoto red — decoded visibly
washed-out relative to how the source actually renders on a display.

**Fix.** Out-of-gamut OKLAB values are mapped by **per-channel clipping in linear sRGB**
(the `clamp(rgb_lin[i], 0, 1)` already in the decode loop) — relative-colorimetric, the
same mapping a display applies. Saturated colors land at the gamut boundary (maximum
in-gamut saturation) instead of being pulled inward, and the separate soft-clamp helper
is removed.

### Evaluated and rejected

A decode-side raised-cosine synthesis window (tapering high-frequency AC by normalized
priority `ρ = sqrt(priority / p_k)`) was implemented and swept. With the v0.6 chroma
ranges in place it cost more detail than the residual ringing it suppressed — v0.5's
visible banding turned out to be chroma quantization noise (Change 5), not luma Gibbs
ringing. The `p_k` value remains defined (§6.2) should a future revision revisit
frequency-normalized decoding.

---

## 14. Trade-offs & Limitations

| Trade-off | Details |
|-----------|---------|
| **Larger size** | Always 32 bytes vs 5–25 for variable-length formats. At 1B photos: 32 GB vs ~17 GB. Fixed size enables memory alignment and cache-friendly access. |
| **Encode cost** | Full-resolution encoding: ~400ms for 12MP in Rust (single-threaded). The v0.6 DC search adds ~10 µs (27 DC simulations) — negligible. |
| **Decode cost** | ~36µs native / ~182µs JS. OKLAB is 18× costlier per pixel than linear color, but both are <1ms. |
| **Solid images** | 26 bytes of zero AC coefficients wasted. Irrelevant for photographs. |
| **Extreme ratios** | Ratios beyond 16:1 clamp to 16:1. Rare in photography. |
| **Wide-gamut DC clipping** | DC chroma beyond the sRGB hull clips at encode (§5.1). Invisible at decode (the decoder clips to sRGB regardless); a future P3-decode profile would be a format break. |
| **Gamut clip** | Out-of-sRGB OKLAB values are clipped per-channel in linear sRGB (relative-colorimetric, §12.6) — the same mapping a display applies, so saturated wide-gamut solids render at full in-gamut saturation rather than desaturated. |
| **No progressive decode** | All 32 bytes must be received first. Never a practical bottleneck. |

---

## Appendix A: ThumbHash Comparison & Acknowledgment

ChromaHash is directly inspired by [ThumbHash](https://evanw.github.io/thumbhash/) by
Evan Wallace. Key inherited ideas: DCT-based placeholder encoding, alpha compositing
over average color, and average color extraction from the header.

| Feature | ThumbHash | ChromaHash v0.6 |
|---------|-----------|------------|
| **Size** | 5–25 bytes (variable) | 32 bytes (fixed) |
| **Color space** | LPQA (gamma sRGB) | OKLAB (perceptually uniform) |
| **L DC / Chroma DC** | 6 / 6 bits | 7 / 7 bits |
| **Coefficient selection** | ℓ1 triangle over adaptive grid | Top-K ℓ2 ball over the decode raster |
| **L AC budget** | up to 27 coeff, 4-bit linear | 27 coeff, 5-bit µ-law (exact zero) |
| **Chroma AC budget** | 5 coeff × 4-bit each | 9 coeff × 4-bit µ-law (µ=8) each |
| **DC fidelity** | rounded | decode-aware search (gamut-corner solids near-exact) |
| **Aspect ratio** | 3-bit (~7% error) | 8-bit log₂ (~1.1% error) |
| **Aspect range** | up to ~7:1 | up to 16:1 |
| **Source gamuts** | sRGB only | sRGB, P3, Adobe RGB, BT.2020, ProPhoto |
| **Gamut clamping** | Hard per-channel | Soft segment bisection (hue-preserving, L-blended) |
| **Input dimensions** | Any (library resizes) | Any (full-resolution DCT) |
| **Memory alignment** | No (variable length) | 32-byte aligned |

On the reference corpus (52 images, identical color-managed metrics), ChromaHash v0.6
leads ThumbHash on every metric — mean ΔE00 4.62 vs 7.56, SSIMULACRA2 56.6 vs 47.6,
Butteraugli 9.78 vs 14.90 — in exchange for the larger fixed size.

---

*This specification is licensed under the same terms as the ChromaHash project (MIT OR Apache-2.0).*
