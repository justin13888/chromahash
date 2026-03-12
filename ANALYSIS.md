# ThumbHash Deep Analysis & ChromaHash Format Proposal

> **Target audience:** Engineers building a professional photo management service (Google Photos-scale)
> for creative professionals using DSLRs, mirrorless cameras, and high-end smartphones.

---

# Part 1: ThumbHash — Technical Analysis

ThumbHash is a compact LQIP (Low Quality Image Placeholder) format that encodes a thumbnail
representation of an image into a variable-length byte sequence (5–25 bytes). This analysis
is cross-referenced against all four canonical implementations:

- **JavaScript** — `js/thumbhash.js` (289 lines)
- **Rust** — `rust/src/lib.rs` (333 lines)
- **Swift** — `swift/ThumbHash.swift` (650 lines)
- **Java** — `java/com/madebyevan/thumbhash/ThumbHash.java` (316 lines)

## 1. Binary Layout

A ThumbHash consists of a fixed header followed by variable-length AC coefficient data.

### 1.1 Header — `header24` (3 bytes, 24 bits)

| Bits  | Field      | Width | Range   | Encoding                          |
|-------|------------|-------|---------|-----------------------------------|
| 0–5   | `l_dc`     | 6     | 0–63    | `round(63 × L_dc)`               |
| 6–11  | `p_dc`     | 6     | 0–63    | `round(31.5 + 31.5 × P_dc)`      |
| 12–17 | `q_dc`     | 6     | 0–63    | `round(31.5 + 31.5 × Q_dc)`      |
| 18–22 | `l_scale`  | 5     | 0–31    | `round(31 × L_scale)`            |
| 23    | `hasAlpha` | 1     | 0 or 1  | 1 if image has any transparency   |

Stored little-endian: `hash[0] = header24 & 0xFF`, `hash[1] = (header24 >> 8) & 0xFF`,
`hash[2] = header24 >> 16`.

Reference: JS:82, Rust:100–104, Swift:184, Java:60–64.

### 1.2 Header — `header16` (2 bytes, 16 bits)

| Bits  | Field         | Width | Range | Encoding                           |
|-------|---------------|-------|-------|------------------------------------|
| 0–2   | `lx` or `ly`  | 3     | 1–7   | Shorter luminance dimension        |
| 3–8   | `p_scale`     | 6     | 0–63  | `round(63 × P_scale)`             |
| 9–14  | `q_scale`     | 6     | 0–63  | `round(63 × Q_scale)`             |
| 15    | `isLandscape` | 1     | 0/1   | 1 if width > height               |

When `isLandscape=1`, the stored 3-bit value is `ly` (and `lx = l_limit`).
When `isLandscape=0`, the stored 3-bit value is `lx` (and `ly = l_limit`).
Here `l_limit = 7` (opaque) or `5` (has alpha).

Reference: JS:83, Rust:105–108, Swift:187–191, Java:65–68.

### 1.3 Alpha Byte (1 byte, conditional)

Present only when `hasAlpha=1`. Occupies `hash[5]`.

| Bits | Field     | Width | Range | Encoding                 |
|------|-----------|-------|-------|--------------------------|
| 0–3  | `a_dc`    | 4     | 0–15  | `round(15 × A_dc)`      |
| 4–7  | `a_scale` | 4     | 0–15  | `round(15 × A_scale)`   |

Reference: JS:87, Rust:119, Swift:200–204, Java:78–79.

### 1.4 AC Coefficient Data (variable length)

AC coefficients are packed as 4-bit nibbles, two per byte (low nibble first, high nibble
second). They are written in channel order: L, P, Q, then A (if present).

Each nibble stores `round(15 × normalized_value)` where `normalized_value = 0.5 + 0.5/scale × raw_ac`.

The AC data starts at byte offset 5 (opaque) or 6 (alpha).

Reference: JS:90–92, Rust:123–144, Swift:207–231, Java:82–86.

### 1.5 Complete Layout Diagram

```
Opaque image:
┌──────────────────┬──────────────┬─────────────────────────────┐
│   header24 (3B)  │ header16 (2B)│  AC nibbles (variable)      │
│ l_dc|p_dc|q_dc|  │ lxy|p_s|q_s| │  L_ac... P_ac... Q_ac...    │
│ l_scale|hasAlpha  │ isLandscape  │  (4 bits each, packed)      │
└──────────────────┴──────────────┴─────────────────────────────┘
 byte 0          2   3          4   5 ...

Image with alpha:
┌──────────────────┬──────────────┬──────────┬────────────────────────────────────┐
│   header24 (3B)  │ header16 (2B)│ alpha(1B)│  AC nibbles (variable)             │
│                  │              │ a_dc|a_s │  L_ac... P_ac... Q_ac... A_ac...   │
└──────────────────┴──────────────┴──────────┴────────────────────────────────────┘
 byte 0          2   3          4   5          6 ...
```

---

## 2. Color Space: LPQA

ThumbHash uses a custom color space called LPQA, defined by three simple linear combinations
of gamma-encoded sRGB values:

```
L = (R + G + B) / 3          Luminance (average of RGB channels)
P = (R + G) / 2 - B          Yellow–Blue axis (positive = yellow)
Q = R - G                    Red–Green axis (positive = red)
```

The inverse transform (used during decode) is:

```
B = L - (2/3) × P
R = (3L - B + Q) / 2
G = R - Q
```

Reference: JS:44–46 (encode), JS:172–174 (decode), Rust:47–49, Swift:89–92, Java:46–49.

### Key Observations

1. **Operates in gamma-encoded sRGB space.** The RGB values are gamma-encoded (non-linear)
   throughout — no linearization is performed. This means "luminance" L is actually the
   average of gamma-encoded channel values, not a perceptually or physically meaningful
   luminance measure.

2. **Not perceptually uniform.** Equal steps in L do not correspond to equal perceived
   brightness changes. The P and Q axes do not align with human color perception axes.
   Skin tones, which occupy a narrow range in P/Q space, receive minimal quantization
   resolution.

3. **Computationally trivial.** The transform requires ~5 FLOPs per pixel — just additions,
   subtractions, and divisions by constants. No transcendental functions, no matrix
   multiplications.

4. **Alpha compositing.** Before LPQA conversion, transparent pixels are composited over
   the alpha-weighted average color. This ensures the LPQA channels represent opaque color
   values while the alpha channel is encoded separately.

   Reference: JS:40–47, Rust:42–50, Swift:84–96, Java:41–49.

---

## 3. DCT & Triangular Coefficient Selection

ThumbHash uses a Type-II Discrete Cosine Transform (DCT-II) on a 2D grid. The forward
transform for a channel with grid dimensions `nx × ny` is:

```
F(cx, cy) = (1 / (w × h)) × Σ_y Σ_x  channel[x + y×w] × cos(π/w × cx × (x + 0.5))
                                                         × cos(π/h × cy × (y + 0.5))
```

where `w` and `h` are the input image dimensions (≤ 100).

The inverse (decode) evaluates:

```
value = DC + Σ_j  AC[j] × cos(π/w × cx_j × (x + 0.5)) × cos(π/h × cy_j × (y + 0.5)) × 2
```

The factor of `2` on AC terms is the standard DCT-II inverse normalization.

Reference: JS:51–68 (forward), JS:151–169 (inverse), Rust:54–87, Java:270–295.

### 3.1 Triangular Selection Condition

Not all coefficients in the `nx × ny` grid are used. The condition that selects which
`(cx, cy)` pairs to include is:

```
cx × ny < nx × (ny − cy)
```

This defines a triangular region in frequency space, selecting coefficients below the
diagonal. The DC term `(0, 0)` is always extracted separately and stored in the header.

Reference: JS:54, Rust:61, Swift:111, Java:265.

### 3.2 Triangular Pattern Visualization

**3×3 grid (5 AC coefficients)** — used for P, Q channels:

```
cy\cx  0    1    2
  0   [DC]  ✓    ✓      ← cx×3 < 3×3=9: all pass
  1    ✓    ✓           ← cx×3 < 3×2=6: cx=0(0<6), cx=1(3<6)
  2    ✓                ← cx×3 < 3×1=3: cx=0(0<3)
```

AC count: 2 + 2 + 1 = **5**.  Formula: 3×4/2 − 1 = 5. ✓

**5×5 grid (14 AC coefficients)** — used for alpha channel:

```
cy\cx  0    1    2    3    4
  0   [DC]  ✓    ✓    ✓    ✓
  1    ✓    ✓    ✓    ✓
  2    ✓    ✓    ✓
  3    ✓    ✓
  4    ✓
```

AC count: 4 + 4 + 3 + 2 + 1 = **14**.  Formula: 5×6/2 − 1 = 14. ✓

**7×7 grid (27 AC coefficients)** — used for luminance (max opaque):

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

AC count: 6 + 6 + 5 + 4 + 3 + 2 + 1 = **27**.  Formula: 7×8/2 − 1 = 27. ✓

**General formula:** For an N×N grid, the number of AC coefficients is **N×(N+1)/2 − 1**.

### 3.3 Grid Size Selection

The luminance grid size adapts to the image's aspect ratio:

```
l_limit = hasAlpha ? 5 : 7
lx = max(1, round(l_limit × w / max(w, h)))
ly = max(1, round(l_limit × h / max(w, h)))
```

The longer side gets `l_limit` and the shorter side gets a proportionally smaller value.
Both are clamped to `max(3, ...)` during decode to ensure minimum spatial resolution.

Chroma (P, Q) is always 3×3. Alpha (when present) is always 5×5.

Reference: JS:30–32, Rust:33–35, Swift:62–74, Java:32–34.

---

## 4. Quantization

### 4.1 DC Quantization

| Channel   | Bits | Levels | Encode formula                    | Decode formula            |
|-----------|------|--------|-----------------------------------|---------------------------|
| L (lum)   | 6    | 64     | `round(63 × value)`              | `raw / 63`                |
| P (chroma)| 6    | 64     | `round(31.5 + 31.5 × value)`     | `raw / 31.5 − 1`         |
| Q (chroma)| 6    | 64     | `round(31.5 + 31.5 × value)`     | `raw / 31.5 − 1`         |
| A (alpha) | 4    | 16     | `round(15 × value)`              | `raw / 15`                |

L ranges [0, 1]. P and Q range [−1, 1] (centered encoding). A ranges [0, 1].

### 4.2 Scale Factor Quantization

| Channel   | Bits | Levels | Encode                   | Decode           |
|-----------|------|--------|--------------------------|------------------|
| L scale   | 5    | 32     | `round(31 × scale)`      | `raw / 31`       |
| P scale   | 6    | 64     | `round(63 × scale)`      | `raw / 63`       |
| Q scale   | 6    | 64     | `round(63 × scale)`      | `raw / 63`       |
| A scale   | 4    | 16     | `round(15 × scale)`      | `raw / 15`       |

### 4.3 AC Coefficient Quantization

All AC coefficients are quantized to **4 bits** (16 levels).

**Forward (encode):** AC values are normalized to [0, 1] using the channel's maximum absolute
AC value (`scale`):

```
normalized = 0.5 + 0.5 / scale × raw_ac
quantized  = round(15 × normalized)
```

Reference: JS:71–72, Rust:83–84, Swift:148–153, Java:293–294.

**Inverse (decode):** The stored nibble is dequantized:

```
ac_value = (nibble / 7.5 − 1) × scale
```

Note: `nibble / 7.5 − 1` maps the range [0, 15] to [−1, +1], which is the same as
`(nibble − 7.5) / 7.5`.

Reference: JS:128, Rust:200, Swift:289, Java:301.

### 4.4 Chroma Saturation Boost (1.25×)

During decode, the P and Q channel scale factors are multiplied by **1.25** before being
applied to AC coefficients. This is a deliberate compensation for the quantization loss
inherent in 4-bit encoding — boosting saturation slightly counteracts the color washout
that would otherwise result from rounding errors.

This boost is applied identically in all four implementations:

| Implementation | Location  | Code                                              |
|----------------|-----------|---------------------------------------------------|
| JavaScript     | Line 132  | `decodeChannel(3, 3, p_scale * 1.25)`             |
| JavaScript     | Line 133  | `decodeChannel(3, 3, q_scale * 1.25)`             |
| Rust           | Line 207  | `decode_channel(3, 3, p_scale * 1.25)?`           |
| Rust           | Line 208  | `decode_channel(3, 3, q_scale * 1.25)?`           |
| Swift          | Line 298  | `decodeChannel(3, 3, p_scale * 1.25)`             |
| Swift          | Line 299  | `decodeChannel(3, 3, q_scale * 1.25)`             |
| Java           | Line 121  | `p_channel.decode(hash, ..., p_scale * 1.25f)`    |
| Java           | Line 122  | `q_channel.decode(hash, ..., q_scale * 1.25f)`    |

This boost is **not** applied to L or A channels — only the chroma channels P and Q.
It is a decode-time heuristic, not part of the encoding.

---

## 5. Aspect Ratio Encoding

The aspect ratio is encoded implicitly through the luminance grid dimensions `lx` and `ly`.
The approximate aspect ratio is simply `lx / ly`.

```
ratio = lx / ly
```

Reference: JS:219–221, Rust:329–331, Swift:451–453, Java:222–224.

### 5.1 Possible Ratios — Opaque Images (l_limit = 7)

The longer dimension is always `l_limit = 7`. The shorter dimension is stored in 3 bits
and ranges from 1 to 7. This yields 13 distinct ratios:

| Orientation | Stored value | lx | ly | Ratio  | Decimal |
|-------------|-------------|----|----|--------|---------|
| Portrait    | lx = 1      | 1  | 7  | 1/7    | 0.143   |
| Portrait    | lx = 2      | 2  | 7  | 2/7    | 0.286   |
| Portrait    | lx = 3      | 3  | 7  | 3/7    | 0.429   |
| Portrait    | lx = 4      | 4  | 7  | 4/7    | 0.571   |
| Portrait    | lx = 5      | 5  | 7  | 5/7    | 0.714   |
| Portrait    | lx = 6      | 6  | 7  | 6/7    | 0.857   |
| Square      | lx = 7      | 7  | 7  | 1      | 1.000   |
| Landscape   | ly = 6      | 7  | 6  | 7/6    | 1.167   |
| Landscape   | ly = 5      | 7  | 5  | 7/5    | 1.400   |
| Landscape   | ly = 4      | 7  | 4  | 7/4    | 1.750   |
| Landscape   | ly = 3      | 7  | 3  | 7/3    | 2.333   |
| Landscape   | ly = 2      | 7  | 2  | 7/2    | 3.500   |
| Landscape   | ly = 1      | 7  | 1  | 7      | 7.000   |

### 5.2 Possible Ratios — Alpha Images (l_limit = 5)

9 distinct ratios (lx or ly from 1 to 5):

| lx | ly | Ratio | Decimal |
|----|----|-------|---------|
| 1  | 5  | 1/5   | 0.200   |
| 2  | 5  | 2/5   | 0.400   |
| 3  | 5  | 3/5   | 0.600   |
| 4  | 5  | 4/5   | 0.800   |
| 5  | 5  | 1     | 1.000   |
| 5  | 4  | 5/4   | 1.250   |
| 5  | 3  | 5/3   | 1.667   |
| 5  | 2  | 5/2   | 2.500   |
| 5  | 1  | 5     | 5.000   |

### 5.3 Errors for Common Professional Ratios

| Actual Ratio | Decimal | Nearest ThumbHash | Encoded | Error  |
|-------------|---------|-------------------|---------|--------|
| 3:2         | 1.500   | 7/5               | 1.400   | 6.67%  |
| 4:3         | 1.333   | 7/5               | 1.400   | 5.00%  |
| 5:4         | 1.250   | 7/6               | 1.167   | 6.67%  |
| 16:9        | 1.778   | 7/4               | 1.750   | 1.56%  |
| 1:1         | 1.000   | 7/7               | 1.000   | 0.00%  |
| 2:3         | 0.667   | 5/7               | 0.714   | 7.14%  |
| 3:4         | 0.750   | 5/7               | 0.714   | 4.76%  |

These errors translate directly into layout jank — a 7% aspect ratio error on a 400px-wide
placeholder causes a **28px height shift** when the real image loads.

---

## 6. Size Characteristics

ThumbHash size depends on the number of AC coefficients, which depends on the luminance
grid dimensions and the presence of an alpha channel.

### 6.1 Size Formula

```
header_bytes = hasAlpha ? 6 : 5
ac_count = L_ac + P_ac + Q_ac + (hasAlpha ? A_ac : 0)
ac_bytes = ceil(ac_count / 2)
total = header_bytes + ac_bytes
```

Where `L_ac = lx×(lx+1)/2 + ly×(ly+1)/2 − lx − ly` ... more precisely, it's the number
of `(cx, cy)` pairs satisfying `cx × ny < nx × (ny − cy)` excluding `(0, 0)` — which
equals `N×(N+1)/2 − 1` for an N×N grid.

### 6.2 Example Sizes

| Image Type          | lx×ly | L AC | P AC | Q AC | A AC | Nibbles | Total Bytes |
|---------------------|-------|------|------|------|------|---------|-------------|
| Opaque square       | 7×7   | 27   | 5    | 5    | —    | 37      | 5 + 19 = 24 |
| Opaque 3:2          | 7×5   | 20   | 5    | 5    | —    | 30      | 5 + 15 = 20 |
| Opaque 16:9         | 7×4   | 18   | 5    | 5    | —    | 28      | 5 + 14 = 19 |
| Opaque 2:1          | 7×4   | 18   | 5    | 5    | —    | 28      | 5 + 14 = 19 |
| Opaque 7:1 (extreme)| 7×1   | 6    | 5    | 5    | —    | 16      | 5 + 8  = 13 |
| Alpha square        | 5×5   | 14   | 5    | 5    | 14   | 38      | 6 + 19 = 25 |
| Alpha 3:2           | 5×3   | 9    | 5    | 5    | 14   | 33      | 6 + 17 = 23 |
| Minimum (opaque)    | 3×3   | 5    | 5    | 5    | —    | 15      | 5 + 8  = 13 |
| Minimum (alpha)     | 3×3   | 5    | 5    | 5    | 14   | 29      | 6 + 15 = 21 |

**Range: 5–25 bytes** (minimum 5 bytes for header-only degenerate case;
maximum 25 bytes for alpha square).

---

## 7. Strengths

1. **Extreme compactness.** 5–25 bytes fits in a single database column, URL query parameter,
   or HTTP header. At 1 billion photos, the entire index is 5–25 GB.

2. **Self-describing.** The hash contains everything needed to decode — aspect ratio, color
   information, alpha presence. No sidecar metadata required.

3. **Alpha support.** Transparent images are handled with graceful degradation — the alpha
   channel gets its own DCT grid (5×5, 14 AC coefficients) and the luminance grid is
   reduced from 7×7 to 5×5 to compensate.

4. **Fast decode.** The DCT evaluation over a 32×32 output grid with small coefficient
   counts is extremely fast — typically under 100µs in native code, under 500µs in
   JavaScript. No external dependencies required.

5. **Triangular selection efficiency.** The diagonal cutoff `cx × ny < nx × (ny − cy)`
   captures the most perceptually important low-frequency coefficients while discarding
   the high-frequency corners that contribute least to perceived quality. This is more
   efficient than a rectangular grid of the same coefficient count.

6. **Average color extraction without full decode.** The DC coefficients in the header
   can be directly converted to an average RGBA color with a simple formula — no DCT
   evaluation needed. Useful for dominant-color extraction, sorting, and color-based
   search.

   Reference: JS:190–207, Rust:298–316, Swift:415–444, Java:195–210.

---

## 8. Limitations for Professional Photography

### 8.1 Perceptually Non-Uniform Color Space

The LPQA color space is a simple linear combination of gamma-encoded RGB values. It is
**not perceptually uniform** — equal numerical steps do not correspond to equal perceived
differences.

**Impact on skin tones:** Skin colors cluster in a narrow region of P/Q space (slightly
positive P, slightly positive Q). With only 6-bit DC precision and 4-bit AC precision,
the effective quantization of skin tone variations is very coarse. Subtle warmth differences
between skin tones that are perceptually obvious are collapsed to the same quantized value.

**Impact on dark tones:** Human vision is more sensitive to brightness differences in dark
tones (Weber's law). LPQA's linear L axis allocates equal quantization resolution to all
brightness levels, over-quantizing shadows and wasting resolution on highlights.

### 8.2 Fixed 3×3 Chroma Grid

The P and Q channels are always encoded on a 3×3 grid (5 AC coefficients each). This
provides only the most basic color gradient information — enough for simple scenes, but
inadequate for images with complex color transitions.

**Example:** A sunset photograph transitioning from orange to purple to deep blue spans a
wide range in both P and Q space. With only 5 AC coefficients per chroma channel, these
gradients are reduced to at most 3 horizontal and 3 vertical frequency components — the
resulting placeholder loses the rich color progression entirely.

### 8.3 4-Bit Linear Quantization

All AC coefficients use 4-bit linear quantization (16 levels). With linear spacing,
the step size is uniform: `1/15 ≈ 0.067` across the entire range.

**Banding:** For smooth gradients (common in studio photography — backdrops, sky, fabric),
16 evenly-spaced levels produce visible banding in the placeholder. The perceptual impact
is worse in dark regions where human sensitivity is higher.

**No adaptation to signal distribution:** Natural image DCT coefficients follow a roughly
Laplacian distribution — most values cluster near zero with a long tail. Linear quantization
allocates equal resolution to all magnitudes, wasting bits on rarely-used large values while
under-resolving the dense cluster near zero.

### 8.4 Coarse Aspect Ratio Encoding

With only 13 distinct ratios (opaque) or 9 (alpha), common professional aspect ratios
suffer significant errors:

- **3:2** (most DSLRs): 6.67% error → 27px jank on a 400px placeholder
- **4:3** (Micro Four Thirds, phones): 5.00% error → 20px jank
- **5:4** (medium format, 8×10): 6.67% error → 27px jank

This causes a visually jarring shift when the real image loads and the placeholder's
aspect ratio is corrected. For a photo grid or masonry layout, cumulative aspect ratio
errors cause significant reflow.

### 8.5 Gamma-Domain Processing

All computation (averaging, DCT, quantization) operates on gamma-encoded sRGB values.
This is technically incorrect — averaging gamma-encoded values does not produce a
physically or perceptually correct average. The error is small for typical photographic
content but is systematic.

**Example:** Averaging pure white (1.0) and pure black (0.0) in gamma-encoded space yields
0.5 (≈ 188 on a byte scale), which corresponds to ~21% luminance in linear light.
The physically correct average (0.5 linear luminance) would be ~0.735 in gamma space
(≈ 188 → 187). The error is perceptible in high-contrast scenes and affects the overall
brightness of placeholders.

### 8.6 sRGB-Only Processing

ThumbHash operates exclusively in sRGB. There is no mechanism to encode or signal colors
from wider gamuts:

- **Display P3** (default on all iPhones since iPhone 7, all recent Android flagships)
- **Adobe RGB** (selectable on most professional cameras: Sony α, Canon EOS R, Nikon Z)
- **BT.2020 / BT.2100** (Canon HDR PQ HEIF, Sony HLG HEIF)
- **ProPhoto RGB** (Hasselblad via Phocus, Lightroom export)

When a P3 or Adobe RGB source image is ThumbHash-encoded, it must first be converted
to sRGB — clipping any out-of-sRGB-gamut colors before encoding even begins. The
placeholder cannot represent the full vibrancy of the original. For professional photo
management, where gamut-accurate preview is a quality differentiator, this is a meaningful
limitation.

---

# Part 2: ChromaHash — A Fixed-Size LQIP Format for Professional Photography

## Design Goals

ChromaHash is designed to supersede ThumbHash for professional photo management workloads
where perceptual quality, layout precision, and wide-gamut support matter more than
minimizing byte count.

| Goal | Rationale |
|------|-----------|
| Fixed 32 bytes (256 bits) | Memory-aligned, cache-friendly, predictable storage. No variable-length parsing. |
| OKLAB color space | Perceptually uniform — quantization levels are maximally efficient. |
| 8-bit log₂ aspect ratio | <0.55% error for all common ratios (vs 5–7% in ThumbHash). |
| Higher chroma resolution | 4×4 grid (9 AC coefficients) per chroma channel (vs 5 in ThumbHash). |
| 5-bit luminance AC | 32 levels with µ-law companding — finer near-zero resolution. |
| µ-law companding (µ=5) | Non-linear quantization matching natural coefficient distributions. |
| Multi-gamut encode | Source can be sRGB, Display P3, Adobe RGB, BT.2020, or ProPhoto RGB. |
| Single decode target | Always sRGB output — one set of matrices, zero ambiguity. |
| Self-contained | No sidecar metadata — everything needed is in the 32 bytes. |
| Alpha support | With graceful quality degradation, maintaining the fixed 32-byte size. |

---

## Binary Format

### Header (6 bytes = 48 bits, always present)

```
Bits   Field       Width  Description
──────────────────────────────────────────────────────────
0-6    L_dc        7      OKLAB L (lightness), 0–1 mapped to 0–127
7-13   a_dc        7      OKLAB a (green–red), centered at 64
14-20  b_dc        7      OKLAB b (blue–yellow), centered at 64
21-26  L_scale     6      Luminance AC max amplitude, 0–63
27-32  a_scale     6      Chroma-a AC max amplitude, 0–63
33-37  b_scale     5      Chroma-b AC max amplitude, 0–31
38-45  aspect      8      log₂ aspect ratio (see encoding below)
46     hasAlpha    1      Alpha channel present
47     reserved    1      Must be 0
                           ─────
                           48 bits = 6 bytes
```

**Design notes:**

- `L_dc` gets 7 bits (128 levels) — double ThumbHash's 64 — because luminance precision
  is the single most important factor for placeholder quality.
- `a_dc` also gets 7 bits. The green–red axis is critical for skin tone accuracy. Matching
  `L_dc` precision here was a deliberate choice over the asymmetric 6-bit allocation used
  in ThumbHash (where both chroma channels shared the same precision despite having
  different perceptual importance).
- `b_dc` gets 7 bits. The blue–yellow axis completes the trichromatic representation.
  Equal precision across all three DC components simplifies the codec and avoids
  introducing a systematic bias toward any axis.
- `a_scale` gets 6 bits (matching `L_scale`) because green–red AC variation matters most
  for skin tones — the dominant subject matter in professional photography.
- `b_scale` gets 5 bits because the blue–yellow axis carries less perceptually critical
  detail in most photographic content and saving 1 bit here frees it for other fields.
- `aspect` gets a full byte (256 levels) — a major upgrade from ThumbHash's 3-bit encoding.

### AC Block (26 bytes = 208 bits)

**No-alpha (hasAlpha=0):**

```
Field           Coefficients   Bits/coeff   Total bits
──────────────────────────────────────────────────────────
L AC            27 (7×7 tri)   5            135
a AC (chroma)   9 (4×4 tri)    4            36
b AC (chroma)   9 (4×4 tri)    4            36
Padding         —              —            1
                                            ─────
                                            208
```

**With-alpha (hasAlpha=1):**

```
Field           Coefficients   Bits/coeff   Total bits
──────────────────────────────────────────────────────────
alpha_dc        1              5            5
alpha_scale     1              4            4
L AC            20 (6×6 tri)   mixed*       107
a AC (chroma)   9 (4×4 tri)    4            36
b AC (chroma)   9 (4×4 tri)    4            36
A AC (alpha)    5 (3×3 tri)    4            20
                                            ─────
                                            208

* L AC mixed: first 7 coefficients at 6 bits (42 bits),
              remaining 13 at 5 bits (65 bits) = 107 total.
  Lowest-frequency L coefficients get extra precision.
```

**Verification:** Both modes produce exactly 48 + 208 = **256 bits = 32 bytes**. ✓

---

## Aspect Ratio Encoding (log₂-based)

```
Encode: byte = clamp(round((log₂(w / h) + 2) / 4 × 255), 0, 255)
Decode: ratio = 2^(byte / 255 × 4 − 2)
```

The encoding maps log₂(ratio) from the range [−2, +2] to [0, 255]. This covers aspect
ratios from 1:4 (0.25) to 4:1 (4.0). Ratios beyond this range clamp to the extremes.

### Error Analysis for Common Ratios

| Ratio | Actual  | log₂    | Byte | Decoded | Error  |
|-------|---------|---------|------|---------|--------|
| 1:1   | 1.000   | 0.000   | 128  | 1.005   | 0.54%  |
| 3:2   | 1.500   | 0.585   | 165  | 1.503   | 0.23%  |
| 4:3   | 1.333   | 0.415   | 154  | 1.334   | 0.04%  |
| 5:4   | 1.250   | 0.322   | 148  | 1.250   | 0.02%  |
| 16:9  | 1.778   | 0.830   | 180  | 1.770   | 0.46%  |
| 3:1   | 3.000   | 1.585   | 229  | 3.014   | 0.47%  |
| 4:1   | 4.000   | 2.000   | 255  | 4.000   | 0.00%  |

All portrait ratios are symmetric — the encoding is symmetric about log₂(ratio) = 0
(ratio = 1), so 2:3 has the same error as 3:2. The theoretical maximum error for any
ratio within the encodable range is ~0.54% (half the log₂ quantization step of 4/255).

**Compared to ThumbHash:** The worst-case error drops from **6.67%** (ThumbHash 3:2) to
**0.54%** (ChromaHash 1:1). For a 400px-wide placeholder, this means layout jank goes
from 27px to 2px.

---

## Color Space: OKLAB — Detailed Justification

### The Input Landscape: Source Image Color Spaces

A professional photo management service ingests images from a wide range of devices.
The non-raw (compressed) color spaces encountered in practice:

| Source | Format | Color Space |
|--------|--------|-------------|
| Sony α (α7, α9, ZV-E series) | JPEG | sRGB or Adobe RGB (user-selectable) |
| Sony α (HEIF mode) | HEIF | sRGB (HLG off) or BT.2100/BT.2020 (HLG on) |
| Canon EOS R (R3, R5, R6, R8) | JPEG | sRGB or Adobe RGB |
| Canon EOS R (HDR PQ HEIF) | HEIF | BT.2100 PQ / Rec. 2020 gamut |
| Nikon Z series | JPEG | sRGB or Adobe RGB |
| Hasselblad X2D, 907X | JPEG/TIFF | sRGB, Adobe RGB, or ProPhoto RGB (via Phocus) |
| Fujifilm X-T, GFX | JPEG | sRGB or Adobe RGB |
| Apple iPhone (7+) | HEIC | Display P3 (default) |
| Google Pixel (8+) | HEIC | Display P3 (P3-D65) |
| Samsung Galaxy S series | JPEG/HEIC | sRGB (JPEG) / Display P3 (HEIC, varies) |

**Summary of gamuts encountered:** sRGB (majority), Adobe RGB (pro cameras), Display P3
(phones), and BT.2020 (Canon/Sony HDR HEIF, emerging). All share the D65 white point.

### The Output Landscape: What Displays Show

- **Consumer monitors/phones (2025):** sRGB baseline; most flagship devices now cover
  ~95–100% DCI-P3.
- **Professional monitors:** Adobe RGB coverage standard; many also cover DCI-P3.
- **Web browsers:** CSS Color Level 4 supports `color(display-p3 ...)` and `oklab(...)`.

For LQIP purposes, the decode target is overwhelmingly **sRGB** (universal baseline) with
**Display P3** as a bonus on capable displays.

### Why OKLAB Over Alternatives

**Candidates evaluated:**

#### 1. LPQA (ThumbHash's approach)

L=(R+G+B)/3, P=(R+G)/2−B, Q=R−G.

- **Pros:** Trivial to compute (~5 FLOPs/pixel). No dependencies.
- **Cons:** Not perceptually uniform. Equal L steps ≠ equal perceived brightness steps.
  The P/Q axes don't align with human color perception axes. Dark tones are
  over-quantized; skin tones occupy a tiny slice of the P/Q range and receive minimal
  quantization resolution.

#### 2. CIELAB (CIE 1976 L\*a\*b\*)

- **Pros:** Well-established standard, widely implemented, perceptually ~uniform.
- **Cons:** Known hue linearity problems — blue hues shift toward purple during
  interpolation. Requires chromatic adaptation to D50 (images are D65), adding
  complexity. Chroma prediction is inaccurate at high saturation. Older standard with
  known deficiencies that OKLAB was specifically designed to fix.

#### 3. YCbCr (BT.601/BT.709)

- **Pros:** Native format of JPEG/HEIF — zero conversion cost from compressed images.
- **Cons:** Not perceptually uniform — designed for signal compression efficiency, not
  human perception. Equal Cb/Cr steps do NOT correspond to equal perceived color
  changes. Poor candidate for quantization-constrained formats.

#### 4. ICtCp (BT.2100)

- **Pros:** Excellent perceptual uniformity, designed for HDR/wide gamut.
- **Cons:** Designed for BT.2020/PQ transfer function — overkill for SDR placeholders.
  Requires PQ or HLG transfer functions. More complex than needed for this use case.

#### 5. OKLCH (cylindrical OKLAB)

- **Pros:** Same perceptual uniformity as OKLAB, intuitive hue/chroma/lightness axes.
- **Cons:** Cylindrical coordinates (hue angle, chroma) require trigonometry. DCT operates
  on Cartesian grids — encoding the hue angle as a DCT channel would create
  discontinuities at the 0°/360° boundary. OKLAB's Cartesian (L, a, b) is the natural
  fit for DCT.

#### 6. OKLAB ✓

- **Perceptually uniform:** Equal L steps = equal perceived lightness. Equal a/b steps =
  equal perceived chromaticity. Fixed quantization levels are maximally efficient.
- **Hue linearity:** Dramatically better than CIELAB. Interpolation between two colors in
  OKLAB does not produce hue shifts (CIELAB infamously shifts blues toward purple).
- **D65 white point:** Matches sRGB, Display P3, Rec. 2020, and Adobe RGB. No chromatic
  adaptation needed (unlike CIELAB which uses D50).
- **Simple transform:** Two 3×3 matrix multiplies + cube root (forward) or cube (inverse).
  No iterative methods, no complex transfer functions.
- **Gamut-agnostic:** OKLAB values are absolute (defined via CIE XYZ). The same OKLAB
  triplet correctly represents the same perceived color regardless of source or target
  gamut. Only the RGB→LMS conversion matrices change per gamut.
- **Industry adoption:** CSS Color Level 4 includes `oklab()` and `oklch()` natively.
  Safari shipped OKLAB support within 15 months of the original paper. Apple, Google,
  and W3C have endorsed it as the go-to perceptual space for the web platform.

---

## How OKLAB Handles Multiple Source Gamuts

OKLAB is defined via CIE XYZ, making it gamut-independent. The conversion path is:

```
Source RGB → Linear RGB → LMS (source-gamut-specific 3×3 matrix) → OKLAB (universal 3×3 matrix)
```

The resulting OKLAB values are **absolute** — the same color produces the same (L, a, b)
regardless of which gamut it was encoded from. This means:

- A ChromaHash encoded from a P3 source and decoded on an sRGB display will produce the
  closest sRGB approximation of the original colors (gamut mapping via clamp).
- No gamut flag is stored in the hash. No decode-time branching.

### Encode (mandatory)

1. Determine source gamut from ICC profile, EXIF, or container metadata.
2. Linearize source RGB using the source gamut's transfer function:
   - **sRGB / Display P3:** Piecewise sRGB EOTF (same curve for both):
     ```
     linear = x ≤ 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055)^2.4
     ```
   - **Adobe RGB:** `linear = x^2.2`
   - **BT.2020 PQ (ST 2084):** Inverse PQ EOTF
   - **ProPhoto RGB:** `linear = x^1.8`
3. Convert linear RGB → LMS: `lms = M1[source_gamut] × rgb_linear`
4. Apply cube root: `lms_cbrt = cbrt(lms)`
5. Convert to OKLAB: `oklab = M2 × lms_cbrt`
6. Proceed with DCT encoding in OKLAB space.

### Decode (mandatory)

1. Evaluate DCT to reconstruct OKLAB (L, a, b) per pixel.
2. Convert OKLAB → LMS_cbrt: `lms_cbrt = M2_inv × oklab`
3. Cube: `lms = lms_cbrt³`
4. Convert LMS → sRGB linear: `rgb_linear = M1_inv[sRGB] × lms`
5. Apply sRGB inverse EOTF (linear → gamma):
   ```
   gamma = linear ≤ 0.0031308 ? 12.92 × linear : 1.055 × linear^(1/2.4) − 0.055
   ```
6. Clamp to [0, 1] and output as 8-bit RGBA.

### Why Always sRGB Decode

- OKLAB captures the absolute color during encoding. No information is lost in the hash.
- At 32×32 resolution with DCT blurring, the average color (DC) of real photographs is
  almost never saturated enough to clip when converted to sRGB — even for P3/Adobe RGB
  sources. AC variations add subtle shifts that rarely push individual pixels out of gamut.
- One set of decode matrices = zero ambiguity, simpler implementation.
- On P3 displays, the browser/OS renders sRGB content correctly (it's a subset of P3).

### Key Properties

- Encoder needs M1 matrices for each source gamut (all precomputed constants).
- Decoder needs exactly **one** matrix set: M1_inv[sRGB]. Nothing else.
- No gamut flag, no conditional behavior, no decode-time branching.

### Conversion Matrices

**M2 — Universal OKLAB matrix (Ottosson's paper):**

```
         ┌                                      ┐
         │  0.2104542553   0.7936177850  -0.0040720468 │
  M2  =  │  1.9779984951  -2.4285922050   0.4505937099 │
         │  0.0259040371   0.7827717662  -0.8086757660 │
         └                                      ┘
```

**M2_inv — Inverse OKLAB matrix:**

```
           ┌                                    ┐
           │  1.0000000000   0.3963377774   0.2158037573 │
  M2_inv = │  1.0000000000  -0.1055613458  -0.0638541728 │
           │  1.0000000000  -0.0894841775  -1.2914855480 │
           └                                    ┘
```

**M1[sRGB] — sRGB linear → LMS:**

```
              ┌                                    ┐
              │  0.4122214708   0.5363325363   0.0514459929 │
  M1[sRGB] =  │  0.2119034982   0.6806995451   0.1073969566 │
              │  0.0883024619   0.2817188376   0.6299787005 │
              └                                    ┘
```

**M1_inv[sRGB] — LMS → sRGB linear (decoder only needs this):**

```
                  ┌                                      ┐
                  │  4.0767416621  -3.3077115913   0.2309699292 │
  M1_inv[sRGB] =  │ -1.2684380046   2.6097574011  -0.3413193965 │
                  │ -0.0041960863  -0.7034186147   1.7076147010 │
                  └                                      ┘
```

**M1[Display P3] — Display P3 linear → LMS:**

```
                ┌                                      ┐
                │  0.4866327308   0.2656631942   0.1981040750 │
  M1[P3]     =  │  0.2290036094   0.6917267252   0.0792696654 │
                │  0.0000000000   0.0451126053   0.1045546947 │
                └                                      ┘
```

Note: Exact M1[P3] values should be computed from the Display P3 → XYZ → LMS chain using
the P3-D65 primary chromaticities. The values above are derived from that chain.

**M1[Adobe RGB] — Adobe RGB linear → LMS:**

```
                    ┌                                      ┐
                    │  0.6097559021   0.3112597860   0.0194842119 │
  M1[AdobeRGB]  =  │  0.3110277475   0.5866175479   0.1023547046 │
                    │  0.0194687282   0.0608918760   0.7444393958 │
                    └                                      ┘
```

**M1[BT.2020] — BT.2020 linear → LMS:**

```
                  ┌                                      ┐
                  │  0.6369580483   0.1446169036   0.1688809752 │
  M1[BT.2020] =  │  0.2627002120   0.6779980715   0.0593017165 │
                  │  0.0000000000   0.0280726930   0.1219864485 │
                  └                                      ┘
```

**M1[ProPhoto RGB] — ProPhoto RGB linear → LMS:**

```
                    ┌                                        ┐
                    │  0.7977604896   0.1351917082   0.0313477022 │
  M1[ProPhotoRGB] = │  0.2880711282   0.7118432178   0.0000856540 │
                    │  0.0000000000   0.0000000000   0.8249999686 │
                    └                                        ┘
```

Note: ProPhoto RGB uses the D50 illuminant, not D65. Conversion to OKLAB (which is D65-based)
requires a Bradford chromatic adaptation from D50 to D65 before applying M1. The matrix
above incorporates this adaptation.

### Transfer Functions

**sRGB / Display P3 EOTF (gamma → linear):**
```
linear(x) = x ≤ 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055)^2.4
```

**sRGB / Display P3 inverse EOTF (linear → gamma):**
```
gamma(x) = x ≤ 0.0031308 ? 12.92 × x : 1.055 × x^(1/2.4) − 0.055
```

**Adobe RGB:** `linear(x) = x^2.2`, `gamma(x) = x^(1/2.2)`

**ProPhoto RGB:** `linear(x) = x^1.8`, `gamma(x) = x^(1/1.8)`

**BT.2020 PQ (ST 2084) inverse EOTF:**
```
Y = ((max(N^(1/78.84375) − 0.8359375, 0)) / (18.8515625 − 18.6875 × N^(1/78.84375)))^(1/0.1593017578)

where N = (x / 10000)  [PQ-encoded value normalized to peak luminance]
```

For ChromaHash encoding of HDR PQ content, the encoder should tone-map to SDR before
OKLAB conversion, since the placeholder is inherently an SDR representation.

### Computational Cost

| Operation | FLOPs/pixel | Notes |
|-----------|-------------|-------|
| LPQA (ThumbHash) | ~5 | 3 additions, 2 subtractions |
| OKLAB forward | ~90 | sRGB EOTF (~18) + 3×3 matrix (27) + cbrt (30) + 3×3 matrix (15) |
| OKLAB inverse | ~90 | 3×3 matrix (15) + cube (3) + 3×3 matrix (27) + sRGB gamma (~18) + misc |

For 32×32 decode (1024 pixels):
- Color conversion: ~92K FLOPs
- DCT evaluation: ~265K FLOPs (dominates)
- **Total: ~364K FLOPs ≈ 36µs native / 182µs JavaScript**

OKLAB is ~18× more expensive than LPQA per pixel, but the total decode is still well under
1ms even in JavaScript. The DCT evaluation dominates the total cost regardless of color
space choice. The perceptual quality gain far outweighs the cost.

**Optimization:** The sRGB gamma curve (most expensive single step at ~18 FLOPs/pixel) can
be replaced with a 256-entry LUT for decode, reducing per-pixel cost to ~54 FLOPs.

---

## Triangular Coefficient Selection

ChromaHash uses the same triangular condition as ThumbHash:

```
cx × ny < nx × (ny − cy)
```

This gives **N×(N+1)/2 − 1** AC coefficients for an N×N grid. Coefficients are scanned in
row-major order within the triangle (cy outer loop, cx inner loop, skipping (0,0)). This
matches ThumbHash's ordering — simpler than JPEG-style zigzag, and with no quality
difference since all coefficients are always present in the fixed-size format.

**Coefficient counts:**

| Grid | Total positions | DC | AC coefficients | Formula check |
|------|----------------|----|-----------------|---------------|
| 3×3  | 6              | 1  | 5               | 3×4/2 − 1 = 5  ✓ |
| 4×4  | 10             | 1  | 9               | 4×5/2 − 1 = 9  ✓ |
| 6×6  | 21             | 1  | 20              | 6×7/2 − 1 = 20 ✓ |
| 7×7  | 28             | 1  | 27              | 7×8/2 − 1 = 27 ✓ |

---

## Non-linear Quantization: µ-law Companding (µ=5)

Natural image DCT coefficients follow a roughly Laplacian distribution — most values
cluster near zero. Linear quantization (as used by ThumbHash) wastes resolution on
rarely-used large magnitudes. µ-law companding allocates finer steps near zero and
coarser steps near the extremes.

### Formulas

**Compress (before quantization):**
```
compressed = sign(v) × log(1 + µ × |v|) / log(1 + µ)
```

**Quantize:**
```
index = round((compressed + 1) / 2 × (2^bits − 1))
```

**Dequantize:**
```
compressed = index / (2^bits − 1) × 2 − 1
```

**Expand (after dequantization):**
```
v = sign(compressed) × ((1 + µ)^|compressed| − 1) / µ
```

### Step Size Comparison (µ=5)

| Bits | Levels | Linear step (near 0) | µ-law step (near 0) | Improvement |
|------|--------|---------------------|---------------------|-------------|
| 4    | 16     | 0.133               | 0.051               | 2.6×        |
| 5    | 32     | 0.065               | 0.024               | 2.7×        |

The 2.6–2.7× finer resolution near zero directly addresses the banding artifacts caused
by ThumbHash's linear quantization. It also eliminates the need for the 1.25× chroma
saturation boost hack — the µ-law encoding inherently preserves subtle color variations.

---

## Pseudocode

### Encode

```
function chromaHashEncode(w, h, rgba, sourceGamut):
    assert w ≤ 100 and h ≤ 100

    # 1. Determine source gamut transfer function and M1 matrix
    eotf = TRANSFER_FUNCTIONS[sourceGamut]     # gamma → linear
    M1   = M1_MATRICES[sourceGamut]            # linear RGB → LMS

    # 2. Convert all pixels to OKLAB
    oklab_pixels = new float[w × h × 3]
    alpha_pixels = new float[w × h]
    avg_L = 0; avg_a = 0; avg_b = 0; avg_alpha = 0

    for i in 0 .. w×h − 1:
        alpha = rgba[i×4 + 3] / 255
        r_lin = eotf(rgba[i×4 + 0] / 255)
        g_lin = eotf(rgba[i×4 + 1] / 255)
        b_lin = eotf(rgba[i×4 + 2] / 255)

        # Linear RGB → LMS → OKLAB
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
    if avg_alpha > 0:
        avg_L /= avg_alpha
        avg_a /= avg_alpha
        avg_b /= avg_alpha

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
        (L_dc, L_ac, L_scale) = dctEncode(L_chan, w, h, 6, 6)   # 6×6 → 20 AC
        (a_dc, a_ac, a_scale) = dctEncode(a_chan, w, h, 4, 4)   # 4×4 → 9 AC
        (b_dc, b_ac, b_scale) = dctEncode(b_chan, w, h, 4, 4)   # 4×4 → 9 AC
        (A_dc, A_ac, A_scale) = dctEncode(alpha_pixels, w, h, 3, 3)  # 3×3 → 5 AC
    else:
        (L_dc, L_ac, L_scale) = dctEncode(L_chan, w, h, 7, 7)   # 7×7 → 27 AC
        (a_dc, a_ac, a_scale) = dctEncode(a_chan, w, h, 4, 4)   # 4×4 → 9 AC
        (b_dc, b_ac, b_scale) = dctEncode(b_chan, w, h, 4, 4)   # 4×4 → 9 AC

    # 6. Quantize header values
    L_dc_q  = round(127 × clamp(L_dc, 0, 1))
    a_dc_q  = round(64 + 63 × clamp(a_dc / MAX_CHROMA_A, -1, 1))
    b_dc_q  = round(64 + 63 × clamp(b_dc / MAX_CHROMA_B, -1, 1))
    L_scl_q = round(63 × clamp(L_scale / MAX_L_SCALE, 0, 1))
    a_scl_q = round(63 × clamp(a_scale / MAX_A_SCALE, 0, 1))
    b_scl_q = round(31 × clamp(b_scale / MAX_B_SCALE, 0, 1))

    # 7. Compute aspect byte
    aspect = clamp(round((log2(w / h) + 2) / 4 × 255), 0, 255)

    # 8. Pack header (48 bits = 6 bytes)
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
    bitpos = 48

    if hasAlpha:
        # Pack alpha DC and scale into AC block
        A_dc_q = round(31 × clamp(A_dc, 0, 1))    # 5 bits
        A_scl_q = round(15 × clamp(A_scale / MAX_A_ALPHA_SCALE, 0, 1))  # 4 bits
        writeBits(hash, bitpos, 5, A_dc_q);  bitpos += 5
        writeBits(hash, bitpos, 4, A_scl_q); bitpos += 4

        # L AC: first 7 at 6 bits, remaining 13 at 5 bits
        for i in 0..6:
            q = muLawQuantize(L_ac[i] / L_scale, 5, 6)   # 6-bit µ-law
            writeBits(hash, bitpos, 6, q); bitpos += 6
        for i in 7..19:
            q = muLawQuantize(L_ac[i] / L_scale, 5, 5)   # 5-bit µ-law
            writeBits(hash, bitpos, 5, q); bitpos += 5
    else:
        # L AC: all 27 at 5 bits
        for i in 0..26:
            q = muLawQuantize(L_ac[i] / L_scale, 5, 5)   # 5-bit µ-law
            writeBits(hash, bitpos, 5, q); bitpos += 5

    # Chroma a AC: 9 coefficients at 4 bits
    for i in 0..8:
        q = muLawQuantize(a_ac[i] / a_scale, 5, 4)
        writeBits(hash, bitpos, 4, q); bitpos += 4

    # Chroma b AC: 9 coefficients at 4 bits
    for i in 0..8:
        q = muLawQuantize(b_ac[i] / b_scale, 5, 4)
        writeBits(hash, bitpos, 4, q); bitpos += 4

    if hasAlpha:
        # Alpha AC: 5 coefficients at 4 bits
        for i in 0..4:
            q = muLawQuantize(A_ac[i] / A_scale, 5, 4)
            writeBits(hash, bitpos, 4, q); bitpos += 4

    # Pad remaining bits with 0 (no-alpha: 1 bit padding)
    assert bitpos ≤ 256

    return hash
```

### Decode

```
function chromaHashDecode(hash):
    # 1. Unpack header (48 bits)
    header = 0
    for i in 0..5: header |= hash[i] << (i × 8)

    L_dc_q  = header & 0x7F                    # bits 0–6
    a_dc_q  = (header >> 7) & 0x7F             # bits 7–13
    b_dc_q  = (header >> 14) & 0x7F            # bits 14–20
    L_scl_q = (header >> 21) & 0x3F            # bits 21–26
    a_scl_q = (header >> 27) & 0x3F            # bits 27–32
    b_scl_q = (header >> 33) & 0x1F            # bits 33–37
    aspect  = (header >> 38) & 0xFF            # bits 38–45
    hasAlpha = (header >> 46) & 1              # bit 46

    # 2. Decode DC values and scale factors
    L_dc  = L_dc_q / 127.0
    a_dc  = (a_dc_q - 64) / 63.0 × MAX_CHROMA_A
    b_dc  = (b_dc_q - 64) / 63.0 × MAX_CHROMA_B
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
        A_dc = readBits(hash, bitpos, 5) / 31.0;   bitpos += 5
        A_scale = readBits(hash, bitpos, 4) / 15.0 × MAX_A_ALPHA_SCALE; bitpos += 4

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

    for y in 0 .. h−1:
        for x in 0 .. w−1:
            # 6a. Evaluate DCT for L, a, b channels
            L = L_dc; a = a_dc; b = b_dc; alpha = hasAlpha ? A_dc : 1.0

            j = 0
            for cy in 0 .. ly−1:
                cx_start = (cy > 0) ? 0 : 1
                fy = cos(π / h × cy × (y + 0.5)) × 2
                for cx in cx_start .. while cx×ly < lx×(ly−cy):
                    L += L_ac[j] × cos(π / w × cx × (x + 0.5)) × fy
                    j += 1

            j = 0
            for cy in 0 .. 3:
                cx_start = (cy > 0) ? 0 : 1
                fy = cos(π / h × cy × (y + 0.5)) × 2
                for cx in cx_start .. while cx×4 < 4×(4−cy):
                    fx = cos(π / w × cx × (x + 0.5))
                    a += a_ac[j] × fx × fy
                    b += b_ac[j] × fx × fy
                    j += 1

            if hasAlpha:
                j = 0
                for cy in 0 .. 2:
                    cx_start = (cy > 0) ? 0 : 1
                    fy = cos(π / h × cy × (y + 0.5)) × 2
                    for cx in cx_start .. while cx×3 < 3×(3−cy):
                        alpha += A_ac[j] × cos(π / w × cx × (x + 0.5)) × fy
                        j += 1

            # 6b. Convert OKLAB → sRGB
            lms_cbrt = M2_inv × [L, a, b]
            lms = [lms_cbrt[0]³, lms_cbrt[1]³, lms_cbrt[2]³]
            rgb_linear = M1_inv_sRGB × lms

            r = srgbGamma(clamp(rgb_linear[0], 0, 1))
            g = srgbGamma(clamp(rgb_linear[1], 0, 1))
            b = srgbGamma(clamp(rgb_linear[2], 0, 1))
            a_out = clamp(alpha, 0, 1)

            # 6c. Output as 8-bit RGBA
            idx = (y × w + x) × 4
            rgba[idx + 0] = round(255 × r)
            rgba[idx + 1] = round(255 × g)
            rgba[idx + 2] = round(255 × b)
            rgba[idx + 3] = round(255 × a_out)

    return (w, h, rgba)
```

### Helper Functions

```
function dctEncode(channel, w, h, nx, ny):
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

function muLawQuantize(value, mu, bits):
    # value is in [-1, 1] (normalized AC)
    compressed = sign(value) × log(1 + mu × abs(value)) / log(1 + mu)
    index = round((compressed + 1) / 2 × (2^bits − 1))
    return clamp(index, 0, 2^bits − 1)

function muLawDequantize(index, mu, bits):
    compressed = index / (2^bits − 1) × 2 − 1
    value = sign(compressed) × ((1 + mu)^abs(compressed) − 1) / mu
    return value

function srgbGamma(linear):
    if linear ≤ 0.0031308:
        return 12.92 × linear
    else:
        return 1.055 × linear^(1/2.4) − 0.055
```

---

## Comparison Table

| Feature | ThumbHash | ChromaHash |
|---------|-----------|------------|
| **Size** | 5–25 bytes (variable) | 32 bytes (fixed) |
| **Color space** | LPQA (linear sRGB mix) | OKLAB (perceptually uniform) |
| **L DC precision** | 6 bits (64 levels) | 7 bits (128 levels) |
| **Chroma DC precision** | 6 bits each | 7 bits each |
| **L AC grid** | 3×3 to 7×7 (adaptive) | 7×7 fixed (no alpha) / 6×6 (alpha) |
| **Chroma AC grid** | 3×3 (5 coefficients) | 4×4 (9 coefficients) |
| **L AC quantization** | 4 bits linear | 5 bits µ-law |
| **Chroma AC quantization** | 4 bits linear + 1.25× boost | 4 bits µ-law |
| **Aspect ratio** | ~13 discrete values, 5–7% error | 256 levels, <0.55% error |
| **Alpha support** | Yes (variable size) | Yes (fixed 32 bytes) |
| **Source gamut support** | sRGB only | Any gamut → OKLAB (absolute) |
| **Decode output** | ≤32×32 | ≤32×32 (configurable) |
| **Decode target** | sRGB (implicit) | sRGB (explicit, mandatory) |
| **Memory alignment** | No | 32-byte aligned |
| **Average color extraction** | Yes (header-only decode) | Yes (header-only decode) |

---

## Trade-offs & Limitations

ChromaHash is not a strict improvement over ThumbHash — it makes deliberate trade-offs.
These should be understood before adoption.

### 1. Larger Size

ChromaHash is always 32 bytes. ThumbHash's maximum is 25 bytes (alpha square) and typical
sizes are 13–20 bytes.

- **Worst case:** 32 vs 25 = 28% larger.
- **Typical case:** 32 vs ~17 = 88% larger.
- **At scale:** At 1 billion photos, ChromaHash uses 32 GB vs ThumbHash's ~17 GB. The
  difference (15 GB) is meaningful but not prohibitive at this scale.

### 2. Higher Computational Cost

OKLAB conversion costs ~90 FLOPs/pixel vs LPQA's ~5 FLOPs/pixel — an 18× per-pixel increase.

However, the total decode budget is dominated by DCT evaluation (~265K FLOPs for 32×32),
making the color space overhead a minority of total cost. Measured end-to-end:

| | ThumbHash | ChromaHash |
|---|-----------|------------|
| Native (estimated) | ~20µs | ~36µs |
| JavaScript (estimated) | ~100µs | ~182µs |

Both are well under 1ms — imperceptible to users.

### 3. Wasted Bits for Simple Images

A solid-color image needs only ~6 bytes of information (DC + aspect). ChromaHash always
uses 32 bytes, wasting 26 bytes on zero-valued AC coefficients. ThumbHash would use
~13 bytes, wasting only ~7 bytes.

For a photo management service, this is rarely relevant — photographs are almost never
solid colors.

### 4. Aspect Ratio Range Limitation

The log₂ encoding covers ratios from 1:4 to 4:1. Ratios beyond this range clamp to the
extremes. ThumbHash theoretically supports up to 7:1 (or 1:7).

In practice, ratios beyond 4:1 are rare in photography (panoramas are typically 3:1 or
less). The clamp at 4:1 is acceptable for the target use case.

### 5. Wide Gamut Saturation Clamping

When a Display P3 or Adobe RGB source image is ChromaHash-encoded, the OKLAB values are
absolute and correct. However, during decode, the conversion to sRGB may clamp pixels with
out-of-sRGB-gamut colors.

At 32×32 resolution with DCT blurring, this clamping is almost always imperceptible —
the average color (DC) of real photographs is nearly always within sRGB, and AC variations
are small. The placeholder is a blurry approximation regardless.

### 6. Encoder Complexity

The encoder must carry M1 matrices for each supported source gamut (sRGB, Display P3,
Adobe RGB, BT.2020, ProPhoto RGB). These are all precomputed constants — no runtime
computation — but the encoder binary is slightly larger than ThumbHash's.

The decoder is unaffected — it needs only M1_inv[sRGB] and M2_inv.

### 7. No Progressive Decoding

ThumbHash's variable-length format could theoretically support partial decoding (decode
only the header for average color, or decode fewer AC coefficients for a faster/coarser
placeholder). ChromaHash's fixed 32 bytes must be fully received before any decoding —
though at 32 bytes, this is never a practical bottleneck.

### 8. µ-law Companding Overhead

The µ-law encode/decode adds `pow()` calls per AC coefficient. For 27 luminance + 18
chroma = 45 coefficients (no-alpha case), this is 45 `pow()` calls during decode.

**Mitigation:** The `pow()` can be replaced with a small lookup table (32 entries for
5-bit, 16 entries for 4-bit) since the input domain is discrete. This reduces the
overhead to a table lookup per coefficient.
