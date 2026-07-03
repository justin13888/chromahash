# ChromaHash Design Rationale

Why each v1 design decision is what it is, with the alternatives that were
considered and rejected. Normative text lives in [`README.md`](README.md); this
file records the *evidence*.

Sweep numbers come from the decision tables produced by `just sweep <config>`
(configs in `tools/comparison/sweeps/`, results in
`tools/comparison/output/sweeps/`) on the **tune split** of the expanded corpus
(65 images: 43 synthetic + 22 curated photos; the 28-image holdout —
Kodak24 + held-out curated photos — is reserved for validating winners, per the
pre-registered rule below). Rate–distortion numbers come from `just compare-rd`
(photographic corpus, display-resolution scoring). Numbers marked **[v0.6]**
were measured during the v0.6 redesign on the original 52-image corpus.

**Pre-registered retune rule.** A constants-level wire change lands only if it
improves holdout mean CIEDE2000 by ≥3% with no SSIMULACRA2 / Butteraugli /
DSSIM guard regression. The 2026-07 sweep battery **did not trigger it** — the
best candidate across every family reached −1.51% on the tune split — so the
v1 constants stand, now with the evidence recorded below.

Because µ-law companding comes from telephony, the audio-codec toolbox was
audited explicitly (§Quantization); because the format competes with modern
lossy image codecs, the AVIF/JPEG XL toolbox was audited explicitly
(§Image-codec techniques).

## Architecture

### 32 bytes at tier 0
A tier-0 hash is exactly 32 bytes — the v0.6 footprint — so the format is an
equal-budget upgrade path from prior LQIPs (BlurHash ~30–36 B, ThumbHash
~21–25 B) and a zero-overhead fixed-width database column in the common case.
**Rejected:** variable-length tier 0 (ThumbHash-style, 5–25 B): saves ~15 B per
image at the cost of length framing everywhere and a materially worse quality
floor.

### Quality tiers: count ×4^tier at constant precision
A 3-bit tier multiplies every AC coefficient *count* by 4^tier and doubles the
render edge (32→256 px); bytes ≈ 32/108/411/1623. One knob, deterministic
length, and the selection order is tier-invariant (priorities scale uniformly
×4 per tier), so low frequencies mean the same thing at every tier.

Review challenged this with rate–distortion practice (codecs add *precision*
with rate, not only bandwidth). **Measured** (`tier-precision-vs-count`, tier-1
budget, equal bytes): every precision-for-count trade loses — a 10×6b+14×5b L
split +0.11% ΔE00, fewer-L/wider-chroma +1.05%, mostly-6-bit L +0.50%, and all
three *fail the SSIMULACRA2 guard* (−135 → −141…−158). At these bitrates more
coefficients beat finer coefficients; the constant-depth design is the right
call for v1's tier range.

### Tiers 1–3 vs "just ship a tiny real image"
Measured by `just compare-rd` against size-targeted WebP/JPEG(mozjpeg)/AVIF
thumbnails and a raw-RGB565 control at the tier byte anchors (50 photographic
images, display-resolution scoring, mean ΔE00 lower-better). Structural
floors first: WebP cannot exist below ~48 B, mozjpeg ~320 B, AVIF ~466 B — so
at 32 B ChromaHash competes only with purpose-built LQIPs.

| Anchor | Winner | Runner-ups |
|---|---|---|
| 32 B | **ChromaHash t0 10.57** | RawRGB565 11.76 · ThumbHash 12.00 · BlurHash 4x4 13.46 |
| 108 B | **ChromaHash t1 8.58** | RawRGB565 9.10 · WebP 9.45 · lqip-modern r16 10.53 (82 B) |
| 411 B | **WebP 6.61** | ChromaHash t2 7.13 · RawRGB565 7.41 · lqip-modern r48 7.57 (248 B) · JPEG 8.83 |
| 1623 B | **AVIF 4.71** | WebP 5.17 · JPEG 5.30 · RawRGB565 5.75 · ChromaHash t3 6.40 |

Tiers 0 and 1 win their anchors outright — at 108 B even raw RGB565 pixels
beat WebP, whose container overhead dominates that budget. WebP overtakes
tier 2 by ~7% at 411 B, and the real codecs lead tier 3 by 20–36% at 1623 B.
The honest positioning: **tiers 2–3 are not rate–distortion-competitive with
real codecs**; their value is operational (no image decoder dependency, O(1)
validation, deterministic bytes, one code path for all tiers). Recorded as an
open positioning question below. (Also measured: the CSS-gradient
placeholder — unpic, 592 B — scores 19.24, worst of every raster-capable
entry; BlurHash saturates near ΔE00 ≈ 12 regardless of component count.)

### Independent (non-embedded) tiers
A tier-1 hash is not a byte-superset of a tier-0 hash: channels are stored
sequentially, so a byte prefix is not decodable. Capped decode (§11.3) already
covers "render a high-tier hash small" — **measured** (`capped-tier1-vs-tier0`,
photo tune split): a tier-1 hash rendered at the tier-0 natural size scores
ΔE00 7.61 vs 9.57 for a native tier-0 encode (−20%), essentially identical to
the tier-1 natural render (7.62). Note this is *not* a truncation preview —
capped decode keeps every in-band coefficient of the larger set — so it upper-
bounds what byte-embedded/progressive tiers could preserve. Embedding requires
interleaving AC across channels by priority: a structural wire change, v0.8
roadmap.

### No entropy coding
At tier 0, fixed-width fields buy O(1) validation (deterministic length *is*
the validity check), no decoder tables, and fixed DB width — for ≤256 bits the
~20–40% entropy savings on near-Laplacian AC is not worth losing those. At
tiers 2–3 (3–13 kbit) the trade genuinely reverses; entropy-coded AC is a v0.8
roadmap item, and the R-D gap to WebP/AVIF at those anchors is the budget it
would need to close.

### Self-describing, no checksum
Byte 0 (version/tier/flags) + the deterministic length formula = a parser
validates in O(1) and a validated hash always decodes. A checksum verifies
*integrity*, not *decodability* — transport already owns integrity
(TCP/TLS/storage ECC).

### Full-resolution encode, no pre-downsample
The DCT projection *is* the anti-aliased lowpass: computing only the K lowest
frequencies over all source pixels is a proper inner product — no resampling
kernel to standardize, no aliasing pathway. Cost is O(K·w·h), documented; apps
MAY pre-downscale for speed at the price of bit-exactness vs full-res encodes.

## Signal path

### OKLAB
Perceptually uniform (quantization steps ≈ evenly perceived), hue-linear, cheap
(3×3 matrices + cube root), and *absolute* — no gamut flag on the wire.
**Rejected:** OKLCH (hue-angle wraparound at 0°/360° breaks DCT encoding);
YCbCr (not perceptually uniform — wastes code levels); ICtCp (needs PQ
transfer; overkill at placeholder fidelity); **XYB (JPEG XL)** — the serious
peer, also a cbrt-LMS space, but its axes are tuned for JXL's adaptive-
quantization machinery, it is not hue-orthogonal by design, and it has no
CSS/ecosystem presence; no evidence it wins at 32 B.

### Averaging and DCT in OKLAB (not linear light)
The DC is the perceptual average — arguably the right *target* for a
placeholder — rather than the physical (linear-light) average a downscaler
would produce. Untested empirically (would need a Rust-side averaging knob);
recorded as future work. The perceptual-average argument stands on its own for
a format whose output is judged by eyes, not by radiometry.

### Global separable cosine transform
No blocks → no blocking artifacts → nothing for a lapped transform to fix
(**MDCT explicitly N/A** — its purpose is block-boundary cancellation).
**Rejected:** wavelets (no scale hierarchy to exploit at K=26; reopen at
tier 3 only if tiers 2–3 survive their positioning question); KLT/learned
bases and Gaussian-splat placeholders (training dependency, no zero-dependency
deterministic decode story); block DCT (blocking artifacts at exactly the
scale placeholders are blurred at).

### Top-K ℓ2-ball selection, fixed per (aspect, tier)
Priority `(cx·H)² + (cy·W)²` = squared isotropic per-pixel frequency ×(WH)²:
integer-exact, aspect-adaptive (the long axis gets more coefficients), and
structurally alias-free (candidates are exactly the representable
frequencies). Zero signaling cost — at K=26, per-image adaptive selection
would spend more bits on positions than it buys (it only pays with entropy
coding → v0.8).

Review challenged isotropy via the human CSF's oblique effect (diagonal
frequencies are less visible; JPEG's tables penalize diagonals ~2×).
**Measured** (`aniso-selection` + `aniso-extended`): weighting the ball by
`1 + aniso·sin²2θ` improves monotonically to an optimum at aniso=1.2 —
**−1.51% ΔE00 with every guard also improving** (SSIMULACRA2 −76.2→−72.0,
Butteraugli 17.78→17.64) — then degrades and fails guards past 1.6. A real,
validated effect, but under the 3% retune threshold, and the weighted ordering
compares f64 keys, which would need an integer reformulation before entering
the spec. The strongest single candidate for a future constants revision.

### Encoder frequency clamp + decoder frequency filter
Selected pairs outside the source's representable band are emitted as exact
zeros and excluded from scale (encoder); render-time filtering skips pairs
outside the raster (decoder). Fixes the v0.5 1×N-strip catastrophe
**[v0.6: dim_1x100 ΔE00 54.5 → 0.78]** and makes capped decodes band-limited.

### Synthesis window: evaluated and rejected
A raised-cosine synthesis window (ρ = sqrt(priority/p_k)) was implemented and
swept for v0.6. With corrected chroma scale ranges it cost more detail than
the ringing it suppressed — v0.5's visible striping was chroma quantization
noise, not luma ringing. `p_k` stays pinned by test vectors for future
frequency-normalized extensions.

## Quantization (the audio-codec audit)

### µ-law companding, µ_L=5 / µ_C=8 / µ_ALPHA=5 — validated against the family
Logarithmic companding matches the Laplacian-like distribution of natural-image
DCT coefficients; chroma uses higher µ because its tight scale range (0.125)
concentrates coefficients near zero where higher µ buys resolution.

Review demanded the full audio family at identical bit budgets, not just µ
re-tuning. **Measured** (`companding-family`, 14 variants):

| Alternative | ΔE00 vs shipped |
|---|---|
| µ_L ∈ {4,6,7}, µ_C ∈ {6,10,12} | −0.12% … +0.47% (plateau) |
| **A-law** (a=87.6, L+C) | **+0.98% worse** |
| **Power-law** \|x\|^γ, γ∈{0.6, 0.75, 0.9} (the AAC/MP3 shape) | +0.20% / +0.39% / **+2.12% worse** |
| **Lloyd-Max codebooks** trained on the tune corpus (top level pinned at 1.0) | −0.05% / −0.11% / **−0.17%** (L / C / both) |

The trained-optimal quantizer buying only −0.17% is the strongest evidence
available that µ-law is already at the distribution's plateau: in pure MSE the
tables beat µ-law by just +0.33 dB (L) / +0.85 dB (C) (`just train-tables`).
A structural detail matters here: scale = max|AC| puts a point mass at exactly
±1 in the normalized data (≥1/K of samples), and µ-law's endpoint level sits
exactly there — a trained codebook must pin its top level at 1.0 to match.

### Odd-level exact-zero quantizer
2^bits−1 levels with the center index decoding to exactly 0.0 removed v0.5's
systematic zero bias **[v0.6: +0.012·scale at 5 b / +0.025·scale at 4 b]**.
The top code is never written; decoders clamp it down.

### Deadzone: evaluated and rejected
The video-codec staple (widened zero bin). **Measured** (`deadzone`): every
variant is neutral-to-worse (+0.00% … +0.97%). The exact-zero center code
already captures the entire benefit a deadzone offers this signal.

### One scale factor per channel (max |AC|)
Review raised MP3/AAC scalefactor bands — one large low-frequency coefficient
shouldn't crush the resolution of every small high-frequency one. **Measured**
(`scalefactor-bands` at tier 0, `scalefactor-bands-t1` at tier 1): the best
band split reaches −0.20% at tier 0 and −0.52% at tier 1 (split=0.25,
gain_l=0.6, guards ok). Direction confirmed — the effect grows with
coefficient count, exactly as the audio analogy predicts — but far below the
retune threshold. Revisit alongside entropy coding at v0.8, where per-band
scales become cheap to signal.

### Quantization ranges sized to signal — re-validated
`MAX_A/B_SCALE = 0.125`: the v0.6 corpus maximum chroma AC scale was 0.113 —
v0.5's 0.5 range wasted two bits of every chroma coefficient (the single
largest v0.6 quality win). **Re-measured on the expanded corpus**
(`quant-ranges`): widening b to 0.15 costs +0.46%, narrowing both to 0.1 costs
+0.86%, and moving `MAX_L_SCALE` to 0.35/0.65 is ±0.2% — the shipped
0.5 / 0.125 / 0.125 sits at a flat optimum. The a_scale=6b / b_scale=5b field-
width asymmetry is wire-fixed and could not be swept; the range-asymmetry
proxy (a vs b at 0.15) shows b is the more sensitive axis (+0.46% vs −0.01%),
consistent with keeping b's range tight — the 1-bit swap itself remains an
open (wire-changing) question.

### Bit allocation: L=5 b ×26 / C=4 b ×9+9 (LAYOUT_B)
Locked by the v0.6 coordinate-descent sweep over layouts A–D
(chroma-rebalanced, tiered-precision, finer-chroma variants) optimizing mean
ΔE00 with SSIMULACRA2/Butteraugli/DSSIM guards; layout B won on natural
images. The v1 tier-1 layout sweep above independently re-confirms the split
against three equal-byte alternatives.

### DC: 7/7/7 bits + decode-aware ±1 search
The encoder simulates the decoder's DC path (dequantize → clamp → gamma) over
the 27-candidate ±1 neighborhood and keeps the code triple whose *decoded*
color is closest to the clip-mapped target. Zero wire cost, ~10 µs.
**[v0.6: solid blue ΔE00 7.75 → 0.36]**

### Rejected audio techniques (with reasons)
- **Vector quantization (CELP/TwinVQ):** **measured** — a 256-codeword 2D VQ
  on chroma pairs beats scalar 4+4-bit µ-law by 3.52 dB MSE at equal
  bits/pair (`just train-tables`). Rejected anyway: the perceptual companding
  sweep shows scalar quantization is not the quality bottleneck at 32 B (the
  MSE-optimal *scalar* table bought only −0.17% ΔE00), and VQ costs trained
  codebook tables in every decoder, encode-side search, and a much larger
  cross-language bit-exactness surface. Reopen only if a future format
  revision is chasing single-digit-percent gains and has spent the cheaper
  levers first.
- **ADPCM / predictive coding:** the DCT already decorrelates;
  inter-coefficient prediction gains ≈ 0. (The image-domain prediction that
  *does* pay is chroma-from-luma — see roadmap.)
- **MDCT / lapped transforms:** exist to cancel block boundaries; there are no
  blocks.
- **Dither / noise shaping:** determinism is a hard requirement, the blurred
  end-use masks banding, and v0.5's "banding" was mis-sized chroma scales, not
  missing dither.

## Aspect, alpha, gamut

### 8-bit log₂ aspect, range 1:16–16:1
Max ratio error ~1.09% (vs ThumbHash's 3-bit ~7%). ±4 log₂ covers photographic
practice; beyond-range panoramas clamp gracefully to 16:1. Symmetric about 1:1
(byte 128); portrait/landscape mirror symmetry is validator-enforced.

### Tier scaling by bit-shift of the rounded base
`(w<<tier, h<<tier)` — never re-derive `round(32·2^tier/ratio)`; the two
disagree (round(64/3)=21 vs round(32/3)<<1=22) and encoder/decoder grids MUST
match or reconstruction desynchronizes.

### Alpha: composite-over-average + separate channel
Transparent pixels composite over the alpha-weighted average OKLAB (keeps the
color channels clean of transparency edges — inherited from ThumbHash), and
alpha is its own DCT channel (DC 5 b + scale 4 b + 5·4^tier AC). Funded by
L 26→20 so tier 0 stays 32 bytes. `hasAlpha` = any pixel α<255: exact and
predictable; a threshold would be equally arbitrary and produce
input-dependent surprises.

### Multi-gamut encode / display-gamut decode, canonical tone map
OKLAB coordinates are absolute → no gamut flag. Out-of-hull colors clip
relative-colorimetrically per channel in the *output* gamut — desaturating
alternatives (constant-L clamp, lightness-blended soft clamp) rendered
wide-gamut solids visibly washed out **[v0.6, Change 7]**. BT.2020 PQ input
tone-maps through the canonical Reinhard operator (§5.3) — pinned normative
because an implementation-defined tone map would break byte-identical
encoding.

## Image-codec techniques (the AVIF/JXL audit)

| Technique | Verdict for v1 |
|---|---|
| Chroma-from-luma (AVIF CfL, JXL) | **Roadmap v0.8.** At LQIP scale chroma often tracks luma; predicting a/b AC as α·L_AC + residual could cut chroma bits. Structural wire change. |
| Adaptive/spatial quantization (JXL quant maps) | **Rejected:** needs per-region signaling; nothing to signal at 32 B. |
| Frequency-weighted quant matrices (JPEG/JXL) | **= the scalefactor-band experiment** (one mechanism, two framings): −0.20% (t0) / −0.52% (t1) — direction real, below threshold. |
| DC prediction | **N/A:** one global DC. |
| Directional intra prediction | **N/A:** no blocks. |
| Entropy coding (ANS/CABAC) | **Rejected tier 0 / roadmap tiers 2–3** (see Architecture). |
| Progressive / embedded refinement | **Roadmap v0.8**; the capped-decode experiment bounds the value (t1@t0-size −20% ΔE00 vs native t0). |
| XYB color space | **Rejected** in favor of OKLAB (see Signal path). |
| Wavelets (JPEG2000) | **Rejected at tier 0;** reopen at tier 3 only if tiers 2–3 survive their positioning question. |
| Gaussian-splat / learned bases | **Rejected:** training dependency, no zero-dep decode. |

## Evaluation methodology decisions
- **CIEDE2000 primary, SSIMULACRA2/Butteraugli/DSSIM as guards:** color
  accuracy dominates perceived placeholder quality (structure is destroyed by
  design); ΔE00 is structure-blind, so every sweep decision requires guard
  non-regression. The tier-precision sweep shows the guards doing real work —
  variants that look near-neutral on ΔE00 fail hard on SSIMULACRA2.
- **Display-resolution reference (512 px cap), browser-gamma upscale primary:**
  placeholders are judged at display size as a browser renders them
  (gamma-space smooth filtering); linear-light Lanczos is co-supported as the
  signal-fidelity view. Both sides composite over a defined backdrop before
  scoring; a blurred "as-rendered" metric set models blur-up presentation.
- **Tune/holdout split:** the v0.6 constants were tuned on the evaluation
  corpus. The split immediately quantified the damage: mean ΔE00 6.48
  (CI 4.6–8.4) on the tune split vs **11.36 (CI 10.3–12.5) on the
  never-tuned holdout**. All v1 experiments tune on `tune` and validate on
  `holdout` under the pre-registered ≥3%-with-guards rule.

## Future work / open questions
Explicitly unresolved, so nothing evaluated-in-thought silently disappears:
1. **Chroma-from-luma** — the largest expected v0.8 win; needs a
   residual-coding design and a wire change.
2. **Anisotropic (oblique-effect) selection** — validated at −1.51% ΔE00 with
   improved guards (aniso≈1.2), but below the retune threshold and requires an
   integer reformulation of the weighted ordering before it can enter the
   spec. The strongest known candidate for a future constants revision.
3. **Tier 2–3 positioning** — size-matched WebP overtakes tier 2 at 411 B
   (6.61 vs 7.13) and AVIF/WebP/JPEG beat tier 3 at 1623 B (4.71–5.30 vs
   6.40) on the full photographic corpus. Either close the gap (entropy
   coding, CfL) or reposition tiers 2–3 as an operational convenience (no
   decoder dependency, deterministic bytes) rather than an R-D claim.
4. **Entropy-coded AC at tiers 2–3** — sized by that same R-D gap.
5. **Embedded/progressive tiers** — interleave AC by priority so a tier-t hash
   is a prefix of tier-t+1; capped decode bounds the value at −20% ΔE00 for
   t1-at-t0-size.
6. **Scalefactor bands / quant matrices** — real but small (−0.52% at t1);
   becomes worth its signaling cost only alongside entropy coding.
7. **a/b scale field-width swap (6b/5b)** — wire-fixed, unsweepable today; the
   range-asymmetry proxy suggests the current allocation is right.
8. **Linear-light vs OKLAB DC averaging** — needs a Rust-side averaging knob;
   perceptual-average argument currently carries the decision.
9. **Wavelet/alternative bases at tier 3** — only if tiers 2–3 survive.
10. **Per-image adaptive selection with signaling** — only alongside entropy
    coding.
11. **Perceptual validation** — every conclusion here is metric-based; a small
    human study of blurred placeholders would anchor the metric choices.
