# ChromaHash Format Specification

**Release:** 0.7.0
**Wire-format generation:** v1 (`version` field = 0)
**Status:** Draft
**Date:** 2026-06-27

> ChromaHash is a compact, self-describing Low Quality Image Placeholder (LQIP)
> format designed for professional photo management at scale. It encodes a
> perceptually accurate thumbnail of an image using the OKLAB color space,
> DCT-based frequency decomposition, and µ-law companded quantization. The default
> code is **32 bytes**; an optional **quality multiplier** (a 3-bit tier in the
> header) trades size for detail, roughly quadrupling the byte length per tier
> while doubling the rendered resolution on each axis.
>
> The release version (`0.7.0`, semver) and the **wire-format generation** (`v1`,
> the 3-bit `version` field, value `0`) are independent axes: the release follows
> semver, while the on-wire `version` field increments only on an incompatible
> format break (`1`→v2, `2`→v3, …). This generation is a clean break with **no
> backward compatibility** with the older v0.6 bitstream.

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
13. [Changes to v1 (0.7.0)](#13-changes-to-v1-070)
14. [Trade-offs & Limitations](#14-trade-offs--limitations)
15. [Future Directions: JPEG XL VarDCT Evaluation](#15-future-directions-jpeg-xl-vardct-evaluation)
16. [Appendix A: ThumbHash Comparison](#appendix-a-thumbhash-comparison--acknowledgment)

---

## 1. Design Goals

ChromaHash targets professional photo management workloads where perceptual quality,
layout precision, and wide-gamut support matter more than minimizing byte count.

| Goal | Rationale |
|------|-----------|
| 32 bytes at tier 0 | Memory-aligned, cache-friendly, predictable storage. Zero-overhead database column or cache key; equal-budget comparison with prior LQIP formats. |
| Quality multiplier (3-bit tier) | Opt into more detail when wanted: long edge `32·2^tier`, byte length ≈ `4^tier`× the base. The common case stays 32 bytes. |
| Self-describing + fail-fast | Byte 0 carries version, tier, and flags; the byte length follows deterministically, so a parser validates a hash in O(1) and a validated hash always decodes. No checksum needed. |
| OKLAB color space | Perceptually uniform — quantization levels are maximally efficient. |
| 8-bit log₂ aspect ratio | ~1.09% max error for all photographic ratios. Covers 1:16 to 16:1. |
| Top-K coefficient selection | The K lowest spatial frequencies for the image's aspect ratio — a single deterministic rule, no grid machinery, no aliasing. |
| Quantization ranges sized to signal | Chroma DC spans the sRGB OKLAB hull; AC scale ranges match measured coefficient distributions. Every code level does work. |
| 5-bit luminance AC | 31 levels for the most perceptually important channel. |
| µ-law companding with exact zero | Non-linear quantization matching natural image DCT coefficient distributions; zero coefficients decode exactly. |
| Decode-aware DC selection | The encoder picks the DC codes whose *decoded* color is closest to the true average — gamut-corner solids round-trip nearly exactly. |
| Multi-gamut encode | Accepts sRGB, Display P3, Adobe RGB, BT.2020, or ProPhoto RGB sources. |
| Display-gamut decode | sRGB by default; decoders MAY render to Display P3 or Adobe RGB (§11). OKLAB is absolute, so no gamut flag is stored. |
| Alpha support | Transparent images supported within the same tier byte budget (32 bytes at tier 0). |

### Design Priorities (ordered)

1. **Perceptual accuracy** — placeholder should look as close to the original as possible.
2. **Layout precision** — decoded aspect ratio must closely match the original.
3. **Wide-gamut correctness** — colors from P3/Adobe RGB/BT.2020 sources preserved accurately.
4. **Decode simplicity and speed** — trivially implementable, fast (<1ms in JavaScript).
5. **Predictable size** — the byte length is deterministic from byte 0 (§3.5); no length framing to parse.

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

### 2.5 Descriptor Byte (Byte 0): Version, Tier, Flags

Byte 0 fully describes the hash. It is read directly (not as part of the little-endian
field group):

| Bits | Field | Width | Meaning |
|------|-------|-------|---------|
| 0–2 | `version` | 3 | Wire-format generation. `0` = **v1** (this spec). |
| 3–5 | `tier` | 3 | Quality multiplier, `0..=3` valid; `4..=7` reserved. |
| 6 | `hasAlpha` | 1 | Alpha channel present. |
| 7 | reserved | 1 | MUST be 0. |

`FORMAT_VERSION = 0` is the first generation of this self-describing scheme. Future
incompatible breaks increment the field (`1`→v2, `2`→v3, …); a decoder MUST reject a
`version` it does not implement.

This is a **clean break**: there is no backward compatibility with the older v0.6
bitstream (whose byte 0 was the `L_dc` value, not a version field). The two are not
co-detectable from bytes alone, so an application storing a mix of generations must track
which is which out of band. A v1 decoder validates the descriptor + length (§2.6, §3.5)
and rejects anything that is not a well-formed v1 hash.

### 2.6 Self-Describing Length, Validation, and Padding

A v1 hash is **variable length**, fully determined by `(tier, hasAlpha)` via the length
formula in §3.5. Decodability is established by **structure, not a checksum**:
`from_bytes` (the validating constructor) checks the `version`, the `tier` range, the
reserved bit, and that the byte length exactly equals the formula — and **fails early** on
any mismatch. A byte string that passes these checks is guaranteed to decode.

There is deliberately **no CRC or checksum**. A checksum verifies *integrity*, not
*decodability*: a bit-flip that happens to land on a still-valid hash would decode to a
wrong-but-readable image, which is acceptable for a placeholder, while a flip that breaks
structure is already caught by the length/version/tier checks. The reserved flag bit is
left free for a future opt-in extension.

Trailing bits in the final byte beyond the AC payload are padding; encoders MUST set them
to 0 and decoders MUST ignore them.

### 2.7 Authoritative Constants

All constants, matrices, and scalar parameters are defined in `spec/constants.py`. That
file is the single source of truth. Run `spec/validate.py` to verify.

---

## 3. Binary Format

A ChromaHash is a variable-length byte string: a fixed prefix, a per-tier AC payload, and
trailing zero padding to the next byte boundary. At tier 0 it is exactly **32 bytes** (the
v0.6 footprint, for equal-budget comparison); each higher tier roughly quadruples the
length. All field offsets, widths, and counts are named constants in `spec/constants.py`.

### 3.1 Header

**Byte 0 — descriptor** (read directly; see §2.5): `version` (bits 0–2), `tier`
(bits 3–5), `hasAlpha` (bit 6), reserved (bit 7).

**Byte 1 — `aspect`**: the 8-bit log₂ aspect ratio (see §8).

**Bits 16–53 — DC + scale prefix**, packed little-endian via `writeBits` in this order:

| Bit offset | Field | Width | Range | Description |
|------------|-------|-------|-------|-------------|
| 16–22 | `L_dc`    | 7 | 0–127 | OKLAB L (lightness) |
| 23–29 | `a_dc`    | 7 | 1–127 | OKLAB a (green–red), centered |
| 30–36 | `b_dc`    | 7 | 1–127 | OKLAB b (blue–yellow), centered |
| 37–42 | `L_scale` | 6 | 0–63  | Luminance AC max amplitude |
| 43–48 | `a_scale` | 6 | 0–63  | Chroma-a AC max amplitude |
| 49–53 | `b_scale` | 5 | 0–31  | Chroma-b AC max amplitude |

The fixed prefix is **54 bits** (bytes 0–1 plus the 38-bit DC/scale group). In alpha mode
an additional `alpha_dc` (5 bits) + `alpha_scale` (4 bits) = 9 bits immediately follow the
prefix, before the AC payload.

### 3.2 AC Payload

AC coefficients follow the prefix (and the alpha DC/scale in alpha mode), in **selection
order** (§6.2): the j-th value in each channel's field is the j-th selected `(cx, cy)`
pair. Per-channel coefficient *counts* are the tier-0 base scaled by `4^tier`; bits per
coefficient are constant.

**Tier-0 base (no-alpha):**

```
Field           Coefficients   Bits/coeff   Total bits
────────────────────────────────────────────────────────
L AC            26             5            130
a AC (chroma)   9              4             36
b AC (chroma)   9              4             36
                                            ─────
                                            202
```

54 (prefix) + 202 = **256 bits = 32 bytes** at tier 0. ✓

**Tier-0 base (alpha):**

```
Field           Coefficients   Bits/coeff   Total bits
────────────────────────────────────────────────────────
alpha_dc        1              5              5
alpha_scale     1              4              4
L AC            20             5            100
a AC (chroma)   9              4             36
b AC (chroma)   9              4             36
A AC (alpha)    5              4             20
                                            ─────
                                            201
```

54 (prefix) + 201 = 255 bits → **32 bytes** (1 padding bit) at tier 0. ✓

At tier `m`, every coefficient count above (L, both chroma channels, and alpha AC) is
multiplied by `4^m`; see §3.5.

### 3.3 Layout Diagram

```
Tier 0, no-alpha (32 bytes):
┌────────┬────────┬────────────────────────────────┬───────────────────────────────────────┐
│ byte 0 │ byte 1 │   DC + scale prefix (38 bits)  │            AC payload + pad            │
│ descr  │ aspect │ L_dc|a_dc|b_dc|L_scl|a_scl|b_scl│ L_ac×26(5b) | a_ac×9(4b) | b_ac×9(4b) │
└────────┴────────┴────────────────────────────────┴───────────────────────────────────────┘

Tier 0, alpha (32 bytes):
┌────────┬────────┬────────────────────────────────┬─────────────────────────────────────────────────┐
│ descr  │ aspect │ L_dc|a_dc|b_dc|L_scl|a_scl|b_scl│ A_dc(5b)|A_scl(4b)|L_ac×20(5b)|a_ac×9|b_ac×9|A_ac×5│
└────────┴────────┴────────────────────────────────┴─────────────────────────────────────────────────┘

Higher tiers use identical framing; every AC coefficient count is multiplied by 4^tier.
```

### 3.5 Quality Multiplier (Tier) & Length Formula

The 3-bit `tier` (byte 0, bits 3–5) is the quality multiplier. It scales two things in
lock-step so the encoder and decoder always agree:

- **Render grid** — the natural decode size is `decodeOutputSize(aspect, tier)` =
  `decodeOutputSize(aspect, 0)` with each axis shifted left by `tier` (long edge
  `32·2^tier`: 32 / 64 / 128 / 256 px). This MUST be a bit-shift of the rounded tier-0
  size, not a re-rounding of `32·2^tier / ratio` (the two diverge — see §8.2).
- **Coefficient budget** — each per-channel count is `base × 4^tier`. The candidate
  frequency pool grows as `4^tier` with the grid, so every `K(tier)` remains satisfiable.

Valid tiers are `0..=3` (`MAX_TIER = 3`); `4..=7` are reserved and MUST be rejected.

**Length formula** — the total byte length is determined entirely by `(tier, hasAlpha)`:

```
ac_bits   = K_L(tier)·5 + 2·K_c(tier)·4 + K_alpha(tier)·4    # alpha term 0 when opaque
body_bits = 54 + (9 if hasAlpha else 0) + ac_bits
length    = ceil(body_bits / 8)    bytes
```

where `K_L`, `K_c`, `K_alpha` are the tier-0 base counts (§3.2) times `4^tier`. Approximate
no-alpha lengths: tier 0 = 32 B, tier 1 ≈ 108 B, tier 2 ≈ 411 B, tier 3 ≈ 1623 B. A decoder
recomputes `length` from the descriptor and MUST reject a hash whose byte length differs
(§2.6).

### 3.4 String Representation

ChromaHash is a binary format. This specification does not define a canonical UTF-8 string
encoding; the reference implementation does not provide one. Applications are responsible
for choosing an encoding appropriate to their context (e.g. base64url per RFC 4648 §5 for
web and API use, hex for debugging). Because the byte length is self-describing (§3.5), any
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
(L, a, b) regardless of source gamut. No gamut flag is stored. The decoder renders the
absolute OKLAB to a caller-chosen **output gamut** (§11), so the same hash can be shown
correctly on an sRGB, Display P3, or Adobe RGB display.

> **Note:** DC chroma quantization ranges are sized to the OKLAB hull of the
> display-output gamuts — the union of sRGB, Display P3 and Adobe RGB (§7.1) — so colors
> within any of those gamuts are stored faithfully and render at full saturation on a
> matching display. Source colors more saturated than that union (e.g. some BT.2020 /
> ProPhoto inputs) clip at encode; no real display can show them anyway. The decode-aware
> DC selection (§10.3) keeps the stored DC within ±1 code of the true average. AC
> coefficients are differences around the DC and are unaffected.

### 5.2 Decoding Pipeline

```
OKLAB → LMS_cbrt (M2_inv) → LMS (cube) → linear RGB (M1_inv[output gamut]) → clamp → gamma → 8-bit RGBA
```

The default decode target is sRGB. Decoders MAY render to Display P3 or Adobe RGB on
request (§11); requests for BT.2020 or ProPhoto output fall back to sRGB, and
`averageColor` (§11.2) is always sRGB.

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
function selectCoefficients(aspect_byte, tier, K):
    (W, H) = decodeOutputSize(aspect_byte, tier)   // §8.2; long side 32·2^tier, short side ≥ 2·2^tier
    entries = []
    for cy in 0 .. H−1:
        for cx in 0 .. W−1:
            if cx == 0 and cy == 0: continue       // DC is stored separately
            priority = (cx × H)² + (cy × W)²       // integer
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
candidate count is at least `64·4^tier − 1` for every aspect byte (short side ≥ 2·2^tier),
so every `K(tier)` the format uses is always fully satisfied.

**Tier scaling.** Doubling the grid scales `(W, H)` and hence every priority by `4^tier`
uniformly, so the priority *ordering* is tier-independent: a higher tier reuses the same
low-frequency ordering on a larger grid, which admits more (and higher) frequencies and
lets `K` grow as `4^tier` (§3.5).

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

**K per channel (tier-0 base; every count scales ×`4^tier`, §3.5):**

| Channel | Mode | K | Bits |
|---|---|---|---|
| L luminance | no-alpha | 26 | 5 each |
| L luminance | alpha | 20 | 5 each |
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

`MAX_CHROMA_A = 0.35` and `MAX_CHROMA_B = 0.33` cover the OKLAB hull of the union of the
display-output gamuts — sRGB ∪ Display P3 ∪ Adobe RGB (max |a| ≈ 0.347, max |b| ≈ 0.321).
This stores colors within any output gamut faithfully so they render at full saturation
on a matching display (§11). The range stops there — wider sources (BT.2020/ProPhoto)
clip, since no supported display can show beyond this hull.

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

### 7.3 AC Coefficient Quantization: µ-law Companding

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

The quantizer uses `2^bits − 1` levels (indices `0 ..= 2^bits − 2`) so the center index
(`2^(bits−1) − 1`) represents **exactly 0.0**. This removes the earlier systematic zero bias
(+0.012·scale at 5 bits): solid colors, frequency-clamped slots (§6.3), and genuinely
zero coefficients decode exactly. The top code `2^bits − 1` is never produced by
encoders; decoders MUST clamp it down to `2^bits − 2` for robustness.

When a channel's scale is 0 (solid color), encoders write the center (zero) code for
every coefficient.

### 7.4 AC Bit Depths

Bit depths are constant per channel; the tier multiplies the coefficient *count* (§3.5),
not the precision. Counts shown are tier 0; at tier `m` each is multiplied by `4^m`.

| Channel | No-alpha (tier 0) | Alpha (tier 0) |
|---------|-------------------|----------------|
| L AC | 5 bits (all 26) | 5 bits (all 20) |
| a AC | 4 bits (all 9) | 4 bits (all 9) |
| b AC | 4 bits (all 9) | 4 bits (all 9) |
| Alpha AC | — | 4 bits (all 5) |

The `AcLayout` supports a two-tier L precision split (a low-frequency band at higher bit
depth) as a tuning knob, but the shipped tier-0 base uses a single 5-bit L tier.

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

The tier-0 base size has its longer side at `BASE_LONG_EDGE = 32` pixels by convention:

```
baseOutputSize(byte):
    if ratio > 1:
        w = 32; h = max(round(32 / ratio), 1)
    else:
        w = max(round(32 × ratio), 1); h = 32

decodeOutputSize(byte, tier):
    (w, h) = baseOutputSize(byte)
    return (w << tier, h << tier)        // long edge 32·2^tier
```

Over the byte range the base short side is at least 2 pixels (byte 0 → 2×32;
byte 255 → 32×2), which the selection domain (§6.2) relies on; at tier `m` it is
`2·2^m`. The tier scaling is a **bit shift of the rounded base size** — it MUST NOT be
re-derived as `round(32·2^tier / ratio)`, which disagrees for non-power-of-two ratios
(e.g. ratio 3, tier 1: `round(64/3) = 21` vs `round(32/3) << 1 = 22`) and would
desynchronize the encoder and decoder grids. Implementations MAY render at other sizes;
see §6.4 and §11.3.

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

When `hasAlpha = 1`: DC (5 bits), scale (4 bits), and `5·4^tier` AC coefficients (4 bits
each, µ-law companded with `MU_ALPHA`). At tier 0 the luminance K shrinks from 26 to 20,
with the freed bits accommodating the alpha channel (29 bits of alpha overhead), keeping
the tier-0 hash at 32 bytes.

---

## 10. Encoding Algorithm

### 10.1 Input Requirements

- Image dimensions: any size (full-resolution encoding — no downscale required)
- Pixel format: RGBA, 8 bits per channel
- Source gamut: one of {sRGB, Display P3, Adobe RGB, BT.2020, ProPhoto RGB}

### 10.2 Pseudocode

```
function encode(W, H, rgba, gamut, tier) -> byte[]:   // tier in 0..=MAX_TIER (3)
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

    // 5. Select coefficients (§6.2), counts scaled by the quality tier (§3.5)
    aspect_byte = clamp(round((log2(W/H) + 4) / 8 * 255), 0, 255)
    s   = 1 << (2 * tier)                            // 4^tier
    L_K = (20 if hasAlpha else 26) * s
    C_K = 9 * s
    A_K = 5 * s
    (L_sel, _) = selectCoefficients(aspect_byte, tier, L_K)
    (C_sel, _) = selectCoefficients(aspect_byte, tier, C_K)
    if hasAlpha: (A_sel, _) = selectCoefficients(aspect_byte, tier, A_K)

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

    // 9. Pack descriptor + prefix. Byte 0 = version|tier|hasAlpha|reserved;
    //    byte 1 = aspect; bits 16..54 = DC + scales (little-endian writeBits).
    length = bodyLenBytes(hasAlpha, tier)           // §3.5
    hash = new byte[length]
    hash[0] = FORMAT_VERSION | (tier << 3) | ((1 if hasAlpha else 0) << 6)
    hash[1] = aspect_byte
    bitpos = 16
    writeBits(hash, bitpos, 7, L_dc_q);  bitpos += 7
    writeBits(hash, bitpos, 7, a_dc_q);  bitpos += 7
    writeBits(hash, bitpos, 7, b_dc_q);  bitpos += 7
    writeBits(hash, bitpos, 6, L_scl_q); bitpos += 6
    writeBits(hash, bitpos, 6, a_scl_q); bitpos += 6
    writeBits(hash, bitpos, 5, b_scl_q); bitpos += 5
    assert bitpos == 54

    // 10. Pack AC with µ-law companding (§7.3). Counts are tier-scaled (step 5).
    function qAC(value, scale, bits, mu):
        if scale == 0: return muLawQuantize(0, bits, mu)
        return muLawQuantize(value / scale, bits, mu)

    if hasAlpha:
        writeBits(hash, bitpos, 5, round(31*clamp(A_dc,0,1))); bitpos += 5
        writeBits(hash, bitpos, 4, round(15*clamp(A_scale/MAX_A_ALPHA_SCALE,0,1))); bitpos += 4
    for i in 0 .. L_K-1: writeBits(hash, bitpos, 5, qAC(L_ac[i],L_scale,5,MU_L)); bitpos += 5
    for i in 0 .. C_K-1: writeBits(hash, bitpos, 4, qAC(a_ac[i],a_scale,4,MU_C)); bitpos += 4
    for i in 0 .. C_K-1: writeBits(hash, bitpos, 4, qAC(b_ac[i],b_scale,4,MU_C)); bitpos += 4
    if hasAlpha:
        for i in 0 .. A_K-1: writeBits(hash, bitpos, 4, qAC(A_ac[i],A_scale,4,MU_ALPHA)); bitpos += 4

    // Trailing bits to the byte boundary are padding (§2.6), implicit zero.
    assert ceil(bitpos / 8) == length
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

The decoder renders the stored absolute OKLAB into a caller-chosen **output gamut**:
`sRGB`, `Display P3`, or `Adobe RGB`. For each output gamut it uses that gamut's inverse
matrix `M1_inv[gamut]` (LMS → linear gamut RGB, §12.5) and gamma curve (`srgbGamma` for
sRGB and Display P3, which share the sRGB transfer; `x^(1/2.2)` for Adobe RGB), then
clips each channel to `[0, 1]` (relative-colorimetric, §12.6). Colors within the target
gamut render at full saturation; colors outside it clip to its boundary. Output gamut
defaults to sRGB. `BT.2020` (HDR PQ, no clean SDR display inverse) and `ProPhoto` (not a
display gamut) are not output targets and fall back to sRGB. `averageColor` (§11.2)
always returns sRGB.

### 11.1 Pseudocode

```
function decode(hash, output_gamut = sRGB) -> (w, h, rgba):
    // output_gamut ∈ {sRGB, Display P3, Adobe RGB}; others fall back to sRGB.
    // M1_inv[output_gamut] and gamma_lut (built from the gamut's transfer) are
    // selected once here and used in the per-pixel loop below (§11 intro, §12.5).
    // 1. Read descriptor (byte 0) + aspect (byte 1), then the DC/scale prefix.
    version  = hash[0] & 0x07
    tier     = (hash[0] >> 3) & 0x07
    hasAlpha = (hash[0] >> 6) & 1
    aspect   = hash[1]
    // A validating parser rejects version != FORMAT_VERSION, tier > MAX_TIER, a
    // set reserved bit, or len(hash) != bodyLenBytes(hasAlpha, tier) (§2.6, §3.5).

    bitpos = 16
    L_dc_q  = readBits(hash, bitpos, 7); bitpos += 7
    a_dc_q  = readBits(hash, bitpos, 7); bitpos += 7
    b_dc_q  = readBits(hash, bitpos, 7); bitpos += 7
    L_scl_q = readBits(hash, bitpos, 6); bitpos += 6
    a_scl_q = readBits(hash, bitpos, 6); bitpos += 6
    b_scl_q = readBits(hash, bitpos, 5); bitpos += 5    // bitpos == 54

    // 2. Decode DC and scale factors
    L_dc    = L_dc_q / 127.0
    a_dc    = (a_dc_q - 64) / 63.0 * MAX_CHROMA_A
    b_dc    = (b_dc_q - 64) / 63.0 * MAX_CHROMA_B
    L_scale = L_scl_q / 63.0 * MAX_L_SCALE
    a_scale = a_scl_q / 63.0 * MAX_A_SCALE
    b_scale = b_scl_q / 31.0 * MAX_B_SCALE

    // 3. Coefficient selection (mirrors the encoder exactly, §6.2), tier-scaled
    s   = 1 << (2 * tier)                               // 4^tier
    L_K = (20 if hasAlpha else 26) * s
    C_K = 9 * s
    A_K = 5 * s
    (L_sel, _) = selectCoefficients(aspect, tier, L_K)
    (C_sel, _) = selectCoefficients(aspect, tier, C_K)

    // 4. Decode output size (§8.2): tier-0 size shifted left by tier
    (w, h) = decodeOutputSize(aspect, tier)

    // 5. Dequantize AC from bitstream (read exactly K values per channel)
    if hasAlpha:
        A_dc    = readBits(hash, bitpos, 5) / 31.0; bitpos += 5
        A_scale = readBits(hash, bitpos, 4) / 15.0 * MAX_A_ALPHA_SCALE; bitpos += 4
        (A_sel, _) = selectCoefficients(aspect, tier, A_K)
    L_ac = []
    for i in 0 .. L_K-1: L_ac.append(muLawDequantize(readBits(hash,bitpos,5),5,MU_L)*L_scale); bitpos += 5
    a_ac = []; for i in 0 .. C_K-1: a_ac.append(muLawDequantize(readBits(hash,bitpos,4),4,MU_C)*a_scale); bitpos += 4
    b_ac = []; for i in 0 .. C_K-1: b_ac.append(muLawDequantize(readBits(hash,bitpos,4),4,MU_C)*b_scale); bitpos += 4
    if hasAlpha:
        A_ac = []; for i in 0 .. A_K-1: A_ac.append(muLawDequantize(readBits(hash,bitpos,4),4,MU_ALPHA)*A_scale); bitpos += 4

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

            // OKLAB → linear output-gamut RGB (M1_inv[output_gamut]) → gamma LUT
            rgb_lin = oklabToLinearRgb(L, a, b, output_gamut)
            idx = (y*w + x) * 4
            rgba[idx+0] = linearToGamma8(clamp(rgb_lin[0], 0, 1), gamma_lut)
            rgba[idx+1] = linearToGamma8(clamp(rgb_lin[1], 0, 1), gamma_lut)
            rgba[idx+2] = linearToGamma8(clamp(rgb_lin[2], 0, 1), gamma_lut)
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
MAX_CHROMA_A       = 0.35    # Max absolute OKLAB 'a' DC (sRGB∪P3∪Adobe hull max |a| ≈ 0.347)
MAX_CHROMA_B       = 0.33    # Max absolute OKLAB 'b' DC (sRGB∪P3∪Adobe hull max |b| ≈ 0.321)
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

### 12.5 M1_inv[output gamut] — Decoder Matrices (LMS → linear gamut RGB)

The decoder selects one of these by the output gamut (§11). Each is the exact inverse of
the corresponding `M1` in §12.4. sRGB / Display P3 / Adobe RGB are the display-output
gamuts; BT.2020 / ProPhoto fall back to `M1_inv[sRGB]`.

**M1_inv[sRGB]:**
```
  4.0767416621  -3.3077115913   0.2309699292
 -1.2684380046   2.6097574011  -0.3413193965
 -0.0041960863  -0.7034186147   1.7076147010
```

**M1_inv[Display P3]:**
```
  3.1277689869  -2.2571357957   0.1293668089
 -1.0910090475   2.4133317585  -0.3223227108
 -0.0260108130  -0.5080413260   1.5340521389
```

**M1_inv[Adobe RGB]:**
```
  2.5540368478  -1.6219762024   0.0679393544
 -1.2684380042   2.6097574007  -0.3413193963
 -0.0562347471  -0.5670418342   1.6232765812
```

Output gamma: sRGB and Display P3 use `srgbGamma` (§12.6); Adobe RGB uses `x^(1/2.2)`.

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

## 13. Changes to v1 (0.7.0)

Release 0.7.0 introduces wire-format generation **v1**, a clean break with **no backward
compatibility** with the v0.6 bitstream. The framing changes are:

- **Self-describing descriptor byte (§2.5, §3.1).** Byte 0 now carries a 3-bit `version`
  (replacing the single v0.6 version bit, which was exhausted), a 3-bit quality `tier`, the
  `hasAlpha` flag, and a reserved bit. Byte 1 is the aspect. The DC/scale prefix moves to
  bits 16–53.
- **Quality multiplier / variable length (§3.5).** A 3-bit tier scales the render grid
  (`32·2^tier`) and the coefficient budget (`×4^tier`), making the format variable length
  (≈32 / 108 / 411 / 1623 bytes for tiers 0–3). Tier 0 stays exactly 32 bytes.
- **Structural validation, no checksum (§2.6).** Decodability is established by validating
  version, tier, reserved bit, and the deterministic length — failing fast — rather than by
  a CRC.
- **Tier-0 layout.** The no-alpha L count is 26 (was 27) so the larger header keeps tier 0
  at exactly 32 bytes; alpha mode uses a single 5-bit L tier (20 coefficients).

The DCT, OKLAB color pipeline, top-K isotropic selection, µ-law quantizer, decode-aware DC
search, and gamut handling are **inherited unchanged from the v0.6 algorithm** (now
parameterized by tier). The subsections below document that algorithm lineage; the quality
figures were measured on the reference corpus (52 images, color-managed metrics) for the
v0.6 algorithm that v1 carries forward:

| Mean ΔE00 (lower = better) | algorithm | v0.5 | ThumbHash |
|---|---|---|---|
| All images | **4.62** | 8.38 | 7.56 |
| Natural photographs | **8.75** | 9.52 | 10.60 |
| Degenerate dimensions | **1.81** | 18.10 | 10.09 |
| Wide-gamut fixtures | **2.67** | 4.71 | 5.23 |

### Algorithm lineage (inherited from the v0.6 redesign)

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

**Fix.** `MAX_CHROMA_A/B` sized to the display-output gamut union — sRGB ∪ Display P3 ∪
Adobe RGB (0.35/0.33), still far tighter than v0.5's ±0.45 — so wide-gamut colors are
stored faithfully for multi-gamut output (§11) without wasting precision on chroma no
display can show; `MAX_A/B_SCALE` to 0.125. This was the single largest quality win of
the revision.

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
| **No progressive decode** | The whole hash must be received before decoding. Never a practical bottleneck at these sizes; embedded/progressive tiers are a future direction (§15). |

---

## 15. Future Directions: JPEG XL VarDCT Evaluation

The v1 quality multiplier (§3.5) buys "more detail" the simplest correct way — more DCT
coefficients on a larger grid at fixed per-coefficient precision. JPEG XL's VarDCT (lossy)
path is the natural reference for going further. Each of its coding tools is evaluated below
**for the ultra-low-bitrate LQIP regime** (sub-2 KB, smooth blurred placeholder); a
technique that pays for itself in a full-image codec often does not when the entire payload
is a few hundred bytes and the target is intentionally low-pass.

| JPEG XL VarDCT tool | What it does | Verdict for chromahash |
|---|---|---|
| XYB opsin color | Perceptual LMS-based color space | **Already covered** — OKLAB is the modern peer; no change. |
| Variable DCT block sizes (2×2…32×32, incl. rectangular) | Per-block adaptive transform size | **N/A** — a single global DCT is correct at this bitrate; the *tier* is our "variable" axis. Per-block side-info is unaffordable here. |
| Adaptive (spatial) quantization | Per-region quant field from a perceptual heuristic | **Defer** — a per-region quant map is too much side-info for a sub-2 KB payload; possibly justified only at tier 3. |
| **Chroma-from-luma (CfL)** | Predict X/B chroma from Y luma with per-group multipliers | **Strong v0.8 candidate** — chroma AC is a large share of the budget; a per-image Y→a/b correlation coefficient is a few bits of side-info that could free budget for luma detail. Evaluate the rate–distortion gain on the corpus. |
| Gaborish | Small post-decode smoothing convolution | **Analog already present** — the decode-side synthesis window (`window_weights`, a Hann taper, disabled by default). Worth re-evaluating enabling it at high tiers to suppress ringing. |
| Edge-preserving filter (EPF) | Adaptive deringing loop filter | **Reject** — a blurred placeholder has few edges to preserve. |
| DC image + DC predictors | Separate DC plane with spatial predictors | **N/A** — chromahash has a single average-color DC per channel, already chosen by the decode-aware DC search (§10.3). |
| **Quantization weighting matrices (HVS/CSF)** | Frequency-dependent quant step | **Evaluate / adopt** — a frequency-shaped bit allocation generalizes the existing two-tier `AcLayout` L split; cheap and on-trend with HVS sensitivity. |
| **Entropy coding (rANS + context modeling + clustering, HybridUint tokens)** | Adaptive entropy coding of quantized coefficients | **Highest-impact v0.8+** — fixed-width µ-law leaves the most on the table; many high-frequency coefficients quantize to zero and would cost almost nothing under an entropy coder, raising the quality ceiling per byte. Heaviest to make bit-exact across all language bindings (incl. the hand-written TS decoder) and it trades away the fixed-per-tier length, so it is deferred deliberately. |
| Coefficient ordering / scan + nonzero context | Frequency-ordered scan, run/EOB modeling | **Already frequency-ordered** — the top-K isotropic selection is exactly this; pairs naturally with entropy coding when added. |
| Patches / splines / dots | Reference repeated elements / smooth gradients / point sources | **Reject** — no repeated elements or point sources in a placeholder; the DCT already models smooth gradients compactly. |
| Noise synthesis | Add a per-image perceptual noise model at decode | **Low-priority option** — a few bits of noise amplitude could add cheap perceptual texture; minor. |
| **Progressive / responsive passes** | DC-first, then refinement passes (embedded scalability) | **Compelling v0.8 direction** — make higher tiers *embedded* (the tier-0 bytes are a prefix of tier-1, etc.) so one stored hash serves both an instant preview and an on-demand detailed render. Constrains the layout but is very LQIP-appropriate. |
| Upsampling (2×/4×/8×) | Store small, upsample at decode with a fixed kernel | **Already covered** — the DCT renders at any target size and `decodeCapped` band-limits (§6.4, §11.3). |

**Summary of the roadmap.** The most promising directions, in rough priority order, are
(1) **entropy coding** of the quantized coefficients (largest quality-per-byte gain),
(2) **chroma-from-luma** (cheap side-info, large chroma budget), (3) **frequency-weighted
quantization** (generalizes the existing tier split), and (4) **embedded/progressive
tiers** (one hash, preview→detail). All four are deliberately out of scope for v1, which
establishes the self-describing, tiered container they would build on.

---

## Appendix A: ThumbHash Comparison & Acknowledgment

ChromaHash is directly inspired by [ThumbHash](https://evanw.github.io/thumbhash/) by
Evan Wallace. Key inherited ideas: DCT-based placeholder encoding, alpha compositing
over average color, and average color extraction from the header.

| Feature | ThumbHash | ChromaHash v1 (tier 0) |
|---------|-----------|------------|
| **Size** | 5–25 bytes (variable, length must be probed) | 32 bytes at tier 0; opt-in tiers to ~108/411/1623 bytes (self-describing length) |
| **Color space** | LPQA (gamma sRGB) | OKLAB (perceptually uniform) |
| **L DC / Chroma DC** | 6 / 6 bits | 7 / 7 bits |
| **Coefficient selection** | ℓ1 triangle over adaptive grid | Top-K ℓ2 ball over the decode raster |
| **L AC budget** | up to 27 coeff, 4-bit linear | 26 coeff, 5-bit µ-law (exact zero) |
| **Chroma AC budget** | 5 coeff × 4-bit each | 9 coeff × 4-bit µ-law (µ=8) each |
| **DC fidelity** | rounded | decode-aware search (gamut-corner solids near-exact) |
| **Aspect ratio** | 3-bit (~7% error) | 8-bit log₂ (~1.1% error) |
| **Aspect range** | up to ~7:1 | up to 16:1 |
| **Source gamuts** | sRGB only | sRGB, P3, Adobe RGB, BT.2020, ProPhoto |
| **Gamut clamping** | Hard per-channel | Relative-colorimetric per-channel clip in the output gamut (§12.6) |
| **Input dimensions** | Any (library resizes) | Any (full-resolution DCT) |
| **Quality scaling** | None | 3-bit tier: ×4^tier coefficients, 2^tier render resolution |

On the reference corpus (52 images, identical color-managed metrics), ChromaHash v0.6 —
whose tier-0 layout differs from v1 only in the smaller pre-tier header and a 27th L
coefficient — led ThumbHash on every metric: mean ΔE00 4.62 vs 7.56, SSIMULACRA2 56.6
vs 47.6, Butteraugli 9.78 vs 14.90, in exchange for the larger size.

---

*This specification is licensed under the same terms as the ChromaHash project (MIT OR Apache-2.0).*
