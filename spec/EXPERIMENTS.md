# ChromaHash Design Experiments

A log of designs that were *built and measured*, and of the ones that have not
been tried yet. [`RATIONALE.md`](RATIONALE.md) records why the shipped v1
constants are what they are; this file is the workbench behind it, including the
results that argue against them.

Everything here is measured with `tools/comparison` on the photographic corpus:
CIEDE2000 (ΔE00, lower better) primary, SSIMULACRA2 (higher better) /
Butteraugli (lower better) / DSSIM (lower better) as guards, browser-gamma
upscale to a 512 px display-resolution reference. **Tune split = 22 photos,
holdout split = 28 (Kodak24 + 4 held-out curated).** Candidates are chosen on
tune and validated on holdout, per the pre-registered rule in `RATIONALE.md`.

> **Status: nothing here has changed the shipped format.** The encoder knobs
> this round introduces (`scale_fit`, `ac_nearest`) default to the shipped
> behaviour, and `spec/test-vectors/` passes unchanged.

## 0. What made these measurements possible

The v1 length formula is derived from the AC layout, so resizing the layout
resizes the hash — the format has always been able to express any byte budget,
but nothing could decode one. Four tooling changes opened that surface:

| Change | Why |
|---|---|
| `ChromaHash::from_bytes_tuned` (used by `encode_stdin`) | `from_bytes` validated length against the **shipped** layout, so any length-changing sweep encoded fine and then failed to decode. Every sweep before this one had to hold the byte count fixed — which is why no byte-budget question had ever been asked. |
| `sweep.js` records per-image ΔE00 | Enables paired statistics and per-image (oracle) analyses. |
| `tools/comparison/src/rd-budget.ts` | Cross-format R-D at arbitrary byte budgets on the **same corpus split** as `just sweep`, so a ladder row and a ThumbHash row are directly comparable. |
| `src/cfl-probe.ts`, `src/coeff-stats.ts` | Size two roadmap items (chroma-from-luma, entropy coding) from corpus statistics instead of by assertion. |

## 1. The rate–distortion curve of v0.7

Shipped constants, AC layout resized to each budget at the shipped 26:9 luma:
chroma count ratio and 5 b luma / 4 b chroma precision
(`sweeps/budget-ladder.json`). Points ≤ 80 B are tier 0, ≥ 108 B tier 1.

| Bytes | 10 | 12 | 14 | 16 | 18 | 21 | 24 | 28 | **32** | 40 | 48 | 64 | 80 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ΔE00 tune | 15.08 | 13.23 | 11.99 | 11.62 | 11.30 | 10.93 | 10.32 | 10.02 | **9.57** | 9.12 | 8.78 | 8.37 | 7.97 |
| ΔE00 holdout | 14.38 | 13.54 | 12.98 | 12.78 | 12.57 | 12.30 | 11.94 | 11.57 | **11.36** | 10.97 | 10.57 | 10.12 | 9.73 |

| Bytes | **108** | 129 | 161 | 189 | 246 | 310 | **411** | 512 | 767 | 1017 | **1623** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ΔE00 tune | **7.62** | 7.42 | 7.15 | 6.98 | 6.76 | 6.55 | **6.35** | 6.22 | 5.99 | 5.88 | **5.73** |
| ΔE00 holdout | **9.34** | 9.07 | 8.77 | 8.57 | 8.25 | 8.02 | **7.74** | 7.55 | 7.25 | 7.08 | **6.89** |

Marginal value collapses far faster than 1/bytes (tune split):

| Interval | 16→32 B | 32→64 B | 64→129 B | 129→246 B | 246→512 B | 512→1017 B |
|---|---|---|---|---|---|---|
| ΔE00 gained per byte | 0.128 | 0.037 | 0.0146 | 0.0056 | 0.0020 | 0.00068 |

Each doubling of the budget buys roughly a third of what the previous one did.
The four shipped tier anchors are four points on this one smooth curve; there is
nothing special about 32/108/411/1623 B beyond ×4 arithmetic.

## 2. Cross-format at equal bytes, same corpus, same scoring

`rd-budget`, **tune split**. Bold marks the leader in a column within a byte
neighbourhood.

| Bytes | Format | ΔE00 | SSIM2 | Butter |
|---|---|---|---|---|
| 11.8 | RawRGB565 | 13.43 | −308 | 45.1 |
| 12.0 | BlurHash 2×2 | 16.96 | −350 | 49.8 |
| 12.0 | **ChromaHash** | **13.23** | −308 | **42.3** |
| 16.0 | **ChromaHash** | **11.62** | **−267** | **35.1** |
| **21.0** | **ThumbHash** | 11.17 | **−242** | **31.4** |
| **21.0** | ChromaHash, shipped shape | **10.93** | −259 | 34.1 |
| **21.0** | ChromaHash, retuned (§4.3) | **10.15** | **−238** | **30.8** |
| 22.0 | BlurHash 3×3 | 14.46 | −307 | 41.8 |
| 24.0 | ChromaHash | 10.32 | −243 | 31.0 |
| 25.1 | RawRGB565 | 11.19 | −266 | 36.6 |
| 32.0 | **ChromaHash** | **9.57** | **−226** | **28.2** |
| 36.0 | BlurHash 4×4 | 13.35 | −284 | 39.0 |
| 46.8 | RawRGB565 | 9.81 | −239 | 31.5 |
| 48.0 | WebP | 14.20 | −353 | 34.2 |
| 48.0 | **ChromaHash** | **8.78** | **−200** | **26.2** |
| 63.5 | WebP | 10.70 | −207 | 28.8 |
| 64.0 | **ChromaHash** | **8.37** | **−178** | **24.4** |
| 79.9 | WebP | 9.62 | −170 | 24.7 |
| 80.0 | **ChromaHash** | **7.97** | −160 | 23.4 |
| 83.9 | lqip-modern r16 | 9.68 | **−142** | **23.1** |
| 107.2 | WebP | 8.48 | **−132** | 22.3 |
| 108.0 | **ChromaHash** | **7.61** | −134 | **22.0** |
| 126.3 | lqip-modern r24 | 8.80 | **−103** | **21.0** |
| 188.7 | WebP | 7.14 | **−81** | **17.7** |
| 193.0 | **ChromaHash** | **6.96** | −98 | 20.0 |
| 240.2 | lqip-modern r48 | 6.84 | **−60** | **15.2** |
| 357.4 | RawRGB565 | 6.60 | −107 | 20.9 |
| 405.2 | **WebP** | **5.77** | **−50** | **13.3** |
| 414.0 | ChromaHash | 6.35 | −71 | 17.7 |
| 1502.5 | **WebP** | **4.45** | **−31** | **10.9** |
| 1565.2 | **RawRGB565** | **5.09** | −56 | 15.9 |
| 1584.5 | **AVIF** | **4.00** | **−30** | **10.8** |
| 1623.0 | ChromaHash | 5.73 | −63 | 14.4 |

Holdout confirms the shape (ThumbHash 21.1 B: ΔE00 12.66 / SSIM2 −304 /
Butteraugli 31.2; ChromaHash 32 B: 11.36 / −283 / 28.5; WebP 405.6 B: 7.27 /
−62 / 13.7 vs ChromaHash 414 B: 7.74 / −76 / 17.5).

Three things this says that `RATIONALE.md` does not:

1. **ChromaHash wins colour and loses structure, everywhere.** From ~84 B up,
   lqip-modern and WebP beat it on SSIMULACRA2 *and* Butteraugli while losing on
   ΔE00. ΔE00 is the format's primary metric and the guards are only ever
   checked *within* a sweep, never across formats — so this asymmetry has never
   been scored. Every cross-format claim in `RATIONALE.md` is ΔE00-only.
2. **ThumbHash is not beaten at its own size by the shipped constants.** At
   21 B the shipped-shape layout wins ΔE00 by 2.1% but loses SSIMULACRA2 by 18
   points and Butteraugli by 8.6%. Only the retuned low-budget allocation
   (§4.3) beats ThumbHash on all three.
3. **Tier 3 loses to raw pixels.** At ~1.6 kB, RGB565 pixels with no coding at
   all score 5.09 against tier 3's 5.73. The coding machinery stops paying for
   itself somewhere between 411 B and 1623 B.

## 3. The optimal budget

| Region | What is true there |
|---|---|
| < 12 B | Below the format's own floor: 54 bits (6.75 B) of descriptor + aspect + DC + scales before a single AC coefficient. |
| 12–20 B | ChromaHash beats BlurHash and raw pixels; ThumbHash not yet reachable. |
| **20–32 B** | **ThumbHash's budget.** With the retuned allocation ChromaHash beats it on ΔE00, SSIMULACRA2 and Butteraugli simultaneously. No real codec exists here (WebP's floor is ~48 B, mozjpeg ~320 B, AVIF ~466 B). |
| **32–110 B** | **The format's strongest region.** It leads every LQIP and every size-matched codec on ΔE00 by 10–35%, and still leads or ties the guards up to ~84 B. |
| 110–200 B | Still leads ΔE00; already behind WebP and lqip-modern on SSIMULACRA2 and Butteraugli. |
| 200–400 B | WebP takes the ΔE00 lead (5.77 vs 6.35 at ~410 B). |
| > 400 B | Real codecs lead by 20–40%; by 1.6 kB even uncoded RGB565 wins. |

**Conclusion.** The defensible operating range is **~20–110 B** — tier 0 and
tier 1. Tier 2 is marginal, tier 3 is indefensible as a rate–distortion claim
(keep it, if at all, on the operational argument `RATIONALE.md` already makes).
The single most valuable missing budget is **21–24 B**: it is ThumbHash's size,
it is inside the codec-free zone, and the format cannot express it at all
because tier 0 is fixed at 32 B. Tier codes `4..=7` are reserved and rejected
today — a compact tier is the cheapest place to put it.

The prefix is what makes small budgets expensive: 54 bits is 21% of a 32 B hash
and **32% of a 21 B hash**.

## 4. Designs attempted this round

### 4.1 Doubling the render raster buys nothing — the tier's second knob is inert

A tier does two things: ×4 the coefficient count and ×2 the render edge. Hold
byte count *and* coefficient count fixed, vary only the raster
(`sweeps/render-raster.json`, tune):

| Coefficients (bytes) | small raster | native tier raster | Δ |
|---|---|---|---|
| 104 L / 36 C (108 B) | 7.612 @32 px | 7.615 @64 px | −0.05% |
| 416 L / 144 C (411 B) | 6.337 @32 px | 6.353 @128 px | −0.25% |
| 1664 L / 576 C (1623 B) | 5.727 @64 px | 5.751 @256 px | −0.42% |

Within noise, and if anything the *smaller* raster scores better. All of the
measured quality in the tier ladder comes from coefficient count; the
render-edge doubling is a convenience for the consumer, not a fidelity
mechanism. The real constraint it satisfies is that the decoder drops selected
frequencies outside the raster, so the raster must clear the top selected
frequency index (≈ √(4K/π)) — that is a correctness bound, not a quality one.

### 4.2 Count vs precision: the shipped answer is right at 108 B and wrong at 32 B

`RATIONALE.md` concludes "at these bitrates more coefficients beat finer
coefficients" from an experiment that only tested *finer* coefficients, only at
tier 1. Testing both directions at both budgets (`sweeps/allocation-grid.json`,
29 allocations of the same 202-bit AC budget, tune split — because tier *m*
scales counts by 4^m at constant width, one base allocation lands at both 32 B
and 108 B):

| Allocation | 32 B ΔE00 | 108 B ΔE00 |
|---|---|---|
| L26@5 C9@4 — **shipped** | 9.565 | **7.615** |
| L28@4 C15@3 | **9.314** (−2.6%) | 7.959 (+4.5%) |
| L38@4 C8@3 | 9.353 (−2.2%) | 7.995 (+5.0%) |
| L28@4 C11@4 | 9.379 (−1.9%) | 7.802 (+2.5%) |
| L44@3 C11@3 | 9.804 (+2.5%) | 8.991 (+18%) |
| L23@6 C8@4 | 9.889 (+3.4%) | — |

The optimum moves with the budget. Sweeping six precision families across five
budgets (`sweeps/precision-by-budget.json`, tune) gives the trend cleanly:

| Budget | 16 B | 21 B | 24 B | 32 B | 48 B | 80 B | 108 B |
|---|---|---|---|---|---|---|---|
| best luma bits | **3** | **4** | **4** | **4** | 4 (5 ties) | **5** | **5** |
| best ΔE00 | 10.93 | 10.40 | 10.03 | 9.31 | 8.75 | 8.02 | 7.62 |
| shipped-shape ΔE00 | 11.82 | 10.60 | 10.34 | 9.57 | 8.78 | 8.02 | 7.62 |
| gain | −7.5% | −1.9% | −3.0% | −2.6% | −0.3% | 0% | 0% |

Chroma wants exactly one bit less than luma at every budget measured.

**This contradicts the format's central tier axiom.** "Count ×4^tier at constant
precision" is right above ~64 B and wrong below it: at 32 B the shipped layout
spends a bit per luma coefficient that would buy more as a whole extra
coefficient. The axiom was never wrong where it was tested — it was only ever
tested at tier 1.

### 4.3 The low-budget allocation, retuned

Best found at 21 B against ThumbHash's own 21 B
(`sweeps/thumbhash-headtohead.json`; "+stack" = §4.4 encoder levers + aniso=1.2):

**Tune split**

| Layout | Bytes | ΔE00 | SSIM2 | Butter | DSSIM |
|---|---|---|---|---|---|
| ThumbHash | 21.0 | 11.165 | −241.7 | 31.39 | 0.2140 |
| shipped shape L13@5 C6@4 | 21 | 10.933 | −259.4 | 34.08 | 0.2148 |
| L26@3 C6@3 | 21 | 10.405 | −237.2 | 30.14 | 0.2164 |
| L19@4 C6@3 | 21 | 10.398 | −242.8 | 31.54 | 0.2140 |
| **L19@4 C6@3 + stack** | 21 | **10.145** | **−238.3** | **30.78** | **0.2135** |
| L22@4 C8@3 + stack | 24 | 9.789 | −230.8 | 29.77 | 0.2125 |

**Holdout split**

| Layout | Bytes | ΔE00 | SSIM2 | Butter | DSSIM |
|---|---|---|---|---|---|
| ThumbHash | 21.1 | 12.656 | −303.6 | 31.22 | 0.2565 |
| shipped shape L13@5 C6@4 | 21 | 12.298 | −322.0 | 32.09 | 0.2556 |
| **L22@3 C8@3 + stack** | 21 | **11.796** | **−296.5** | **30.49** | **0.2551** |
| L19@4 C6@3 + stack | 21 | 11.849 | −299.4 | 29.79 | 0.2546 |
| L22@4 C8@3 + stack | 24 | 11.595 | −291.8 | 29.29 | 0.2543 |

A 21-byte ChromaHash that beats ThumbHash on **all four** metrics exists and
validates on holdout (−6.8% ΔE00, +7 SSIMULACRA2, −2.3% Butteraugli, −0.5%
DSSIM). The format has no way to encode it.

### 4.4 Encoder-only levers (zero wire cost, decoder untouched)

Two defects in the shipped encoder, both free to fix:

* **`scale_fit`** — the encoder normalizes AC coefficients by the *unquantized*
  `max|AC|`, while the decoder dequantizes with the rounded scale code. Mode 1
  normalizes by the dequantized scale (one line, no extra compute); mode 2
  searches every scale code for minimum reconstruction SSE (~2^bits quantization
  passes per channel).
* **`ac_nearest`** — the quantizer rounds in the companded domain, which is not
  the code whose *reconstruction* is nearest. A ±2 neighbourhood search fixes it.

`sweeps/encoder-compute.json`, tune split, against the same layout without them:

| Layout | shipped | ac_nearest | scale_fit=1 | scale_fit=2 | fit2 + nearest |
|---|---|---|---|---|---|
| 21 B | 10.933 | — | — | — | 10.902 (−0.28%) |
| 32 B | 9.565 | 9.560 (−0.05%) | 9.520 (−0.46%) | 9.525 (−0.42%) | 9.523 (−0.44%) |
| 108 B | 7.615 | — | — | — | 7.536 (−1.04%) |
| 411 B | 6.353 | — | — | — | 6.219 (−2.11%) |

`ac_nearest` alone is worth 0.05% — µ-law's compressed-domain rounding is
already near reconstruction-optimal, an independent confirmation of the
companding choice. **The scale mismatch is the real defect**, the free mode-1
fix captures nearly all of it at 32 B, and the gain grows with tier because more
coefficients share one scale.

### 4.5 Stacking, and the holdout verdict

`sweeps/holdout-candidates.json`, **holdout split**, incumbent = shipped 32 B.
"stack" = `aniso=1.2 scale_fit=2 ac_nearest=1`.

| Variant | Bytes | ΔE00 | Δ% | SSIM2 | Butter | DSSIM | Guards |
|---|---|---|---|---|---|---|---|
| shipped | 32 | 11.364 | — | −283.1 | 28.45 | 0.2535 | (base) |
| L38@4 C8@3 | 32 | 11.225 | −1.22% | −258.6 | 26.60 | 0.2536 | ok |
| L28@4 C15@3 | 32 | 11.125 | −2.10% | −279.1 | 27.87 | 0.2533 | ok |
| shipped + stack | 32 | 11.247 | −1.03% | −275.0 | 28.11 | 0.2536 | ok |
| L38@4 C8@3 + stack | 32 | 11.131 | −2.05% | −252.5 | 26.36 | 0.2535 | ok |
| **L28@4 C15@3 + stack** | 32 | **11.008** | **−3.13%** | −272.7 | 27.71 | 0.2530 | **ok** |
| tier 1 shipped | 108 | 9.338 | −17.83% | −160.9 | 22.38 | 0.2493 | ok |
| tier 1 + stack | 108 | 9.173 | −19.28% | −155.2 | 22.19 | 0.2486 | ok |

**−3.13% holdout ΔE00 with every guard improving clears the pre-registered ≥3%
retune threshold** — the first candidate in the project's history to do so. Two
caveats before it can enter the spec: `aniso` still needs the integer
reformulation `RATIONALE.md` flags, and a changed encoder changes every test
vector even though the decoder is untouched.

Applying the findings across the whole ladder
(`sweeps/budget-ladder-tuned.json`: per-budget luma precision from §4.2, chroma
one bit under luma, plus the stack):

| Bytes | 12 | 16 | 21 | 24 | 28 | 32 | 48 | 64 | 108 | 246 | 411 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tune, shipped | 13.23 | 11.62 | 10.93 | 10.32 | 10.02 | 9.57 | 8.78 | 8.37 | 7.62 | 6.76 | 6.35 |
| tune, tuned | 11.84 | 10.93 | 10.15 | 9.79 | 9.52 | 9.28 | 8.66 | 8.24 | 7.47 | 6.56 | 6.18 |
| tune Δ | −10.5% | −5.9% | −7.2% | −5.1% | −5.0% | −3.0% | −1.3% | −1.5% | −2.0% | −2.9% | −2.6% |
| holdout, shipped | 13.54 | 12.78 | 12.30 | 11.94 | 11.57 | 11.36 | 10.57 | 10.12 | 9.34 | 8.25 | 7.74 |
| holdout, tuned | 12.96 | 12.37 | 11.85 | 11.60 | 11.31 | 11.07 | 10.40 | 10.02 | 9.17 | 8.10 | 7.57 |
| holdout Δ | −4.3% | −3.1% | −3.7% | −2.9% | −2.2% | −2.6% | −1.7% | −1.0% | −1.8% | −1.8% | −2.2% |

The gain is largest exactly where the shipped constants were never checked. The
compact way to say it: **the retuned encoder reaches today's tier-0 quality in
28 bytes instead of 32** (tune 9.52 vs 9.57; holdout 11.31 vs 11.36) — a 12.5%
byte saving at equal quality, with no wire-format change beyond the layout
table.

### 4.6 Companding retune at the new allocation — no effect

µ_L=5 / µ_C=8 were locked against a 5 b / 4 b layout. Re-swept against the 4 b /
3 b winner (`sweeps/retune-32b.json`, tune): µ_L ∈ {3,4,6,8} spans 9.346–9.404
against 9.353 at µ_L=5; µ_C ∈ {5,6,12,16} spans 9.361–9.403. The plateau
`RATIONALE.md` reports survives the change of bit depth — µ-law is not the
binding constraint at any of these depths.

### 4.7 Per-image adaptive layout — sized, and small

The decoder reads the DC and scale fields before any AC, so encoder and decoder
could both derive a layout from them with **zero signaling**. Upper bound, from
per-image ΔE00 across the 29-allocation grid (tune):

| | 32 B | 108 B |
|---|---|---|
| shipped fixed layout | 9.565 | 7.615 |
| best single fixed layout | 9.314 | 7.615 |
| per-image **oracle** layout | 9.124 | 7.532 |
| oracle gain beyond the best fixed layout | −2.0% | −1.1% |

A perfect oracle over 29 layouts buys 2%; a header-derivable rule would capture
a fraction of that. Not worth a wire change.

### 4.8 Chroma-from-luma — the roadmap's "largest expected win" is small

`cfl-probe`, tune split, 26 coefficients per channel with L and chroma sharing
one selection order so index *i* is the same (cx, cy) in all three channels:

* mean |ρ(a, L)| = 0.428, mean |ρ(b, L)| = 0.523
* after a **per-image least-squares** predictor — itself an oracle, since α
  would have to be signaled — residual energy is **75.6%** (a) and **61.7%** (b)

The sign of the correlation flips between images (−0.81 on `chroma-yellow-wall`,
+0.75 on `natural-building`), so a fixed gain is useless. A 24–38% energy
reduction is ≈0.2–0.35 bit/coefficient; at tier 0 that is ~4–6 bits across 18
chroma coefficients, against ~10 bits to signal two gains. **CfL does not pay at
tier 0.** Reopen at tier 2–3, where per-image gains amortize over hundreds of
coefficients.

### 4.9 Entropy headroom, measured

`coeff-stats`, tune split, shipped tier-0 layout, µ-law codes:

| | luma (5 b field) | chroma (4 b field) |
|---|---|---|
| zeroth-order entropy | 4.413 b | 3.864 b |
| entropy conditioned on selection index | 3.342 b | 3.445 b |

Whole tier-0 AC payload: 202 b fixed → **184.3 b** zeroth-order (−8.8%) →
**148.9 b** with a per-index context model (−26.3%). So `RATIONALE.md`'s
"~20–40% entropy savings" is only reachable *with* context modelling; a plain
order-0 coder buys 2.2 B. With context the headroom is 6.6 B at tier 0 — about
10 extra 5-bit luma coefficients — at the cost of decoder tables, a decode loop,
and the O(1) length check that currently *is* the validity check.

### 4.10 Selection-order headroom, measured

Luma AC energy captured by K=26 of the 200 lowest-frequency candidates (tune):

| Selection | energy captured |
|---|---|
| ℓ2-ball prefix (shipped) | 82.56% |
| best corpus-fixed 26 (trainable, zero signaling) | 84.77% — 8 of 26 slots differ |
| best per-image 26 (oracle) | 91.68% |

The trainable reorder is worth ~2.2 energy points, consistent with the −1.51%
ΔE00 the anisotropic weight already achieves — `aniso` is capturing most of what
a fully trained fixed order could. Per-image selection is worth 9 points but
needs signaling, which only pays alongside entropy coding.

## 5. Untried

Ordered by expected value per unit of disruption. "Encoder" changes only how
bytes are chosen; "constants" changes the layout table; "wire" changes what a
decoder must understand.

### Encoder-only (no format change — but every test vector moves)

| # | Idea | Why it might pay | Cost |
|---|---|---|---|
| U1 | **Pixel-domain RDO.** Score candidate codes by decoded-*pixel* error instead of coefficient SSE. | The reconstruction passes through OKLAB → linear → per-channel gamut clip → gamma. Coefficient SSE is not that error, and clipping makes it **non-separable** — which is the one place the orthogonality argument for independent rounding genuinely fails. §4.4's coefficient-domain search already found 0.5–2%. | O(K·pixels) per pass |
| U2 | **Joint DC+AC search.** `select_dc_codes` optimizes the flat-colour target assuming the AC set is zero. With AC present a different DC can cancel clipping. | Same non-linearity, zero bits, and the existing DC search is proof the effect is real (v0.6: solid blue ΔE00 7.75 → 0.36). | 27× a cheap decode |
| U3 | **Clipping pre-compensation.** Amplitude that pushes a pixel out of the output gamut is discarded at decode; scaling those coefficients down before quantization trades unusable amplitude for resolution everywhere else. | Targets exactly the high-chroma images where ΔE00 is worst. | cheap |
| U4 | **Closed-loop residual re-projection.** Decode, take the residual against the source in OKLAB, re-project onto the *same* selected basis, requantize; 2–3 iterations. | Recovers signal the quantizer's own error re-introduces into the retained basis. | 2–3× encode |
| U5 | **Metric-targeted RDO** — optimize ΔE00 (or SSIMULACRA2) directly rather than SSE. | The format is judged on ΔE00; SSE is a proxy. | high, and invites metric overfitting |

### Constants-level (layout table only)

| # | Idea | Sizing |
|---|---|---|
| U6 | **Budget-dependent precision** — 3 b luma below 20 B, 4 b to ~56 B, 5 b above; chroma one bit under luma. | Measured (§4.2): −7.5% at 16 B, −2.6% at 32 B, 0 at ≥80 B. Breaks the constant-precision tier axiom. |
| U7 | **Corpus-trained selection order**, generalizing `aniso`. | Measured headroom (§4.10): +2.2 energy points; `aniso=1.2` already captures most of it. |
| U8 | **Shrink the prefix.** 54 b is 21% of tier 0 and 32% of a 21 B hash. Aspect 8 b → 5 b (≈2.5% ratio error, still 3× better than ThumbHash); scales 6/6/5 b → 5/4/4 b with log-spaced codes; 1 reserved bit; 1 unused tier bit. | ~10 bits ≈ 2–3 extra luma coefficients at a small budget. **Untested** — the highest-value unmeasured item on this list. |
| U9 | **Derive the b scale from the a scale** instead of storing both. | 5 bits. Untested; `RATIONALE.md`'s range-asymmetry proxy suggests they are far from independent. |

### Wire-level

| # | Idea | Sizing |
|---|---|---|
| U10 | **A compact tier below 32 B** (tier codes 4–7 are reserved today). | Measured (§4.3): a 21 B layout beats ThumbHash on all four metrics, on holdout. The highest-value structural gap. |
| U11 | **Entropy-coded AC with a per-index context model.** | Measured (§4.9): −26.3% of the AC payload, 6.6 B at tier 0. Costs the O(1) length check. |
| U12 | **Decoder-side detail synthesis** — deterministic, hash-seeded high-frequency texture added at render time. | Untested, and the only idea here that attacks the format's actual weakness: it loses SSIMULACRA2/DSSIM to WebP and lqip-modern at every budget above ~84 B while winning ΔE00. Costs zero bytes. Risk: it fabricates detail, which some callers will consider a bug rather than a feature. |
| U13 | **Per-image signaled selection.** | Measured (§4.10): +9 energy points, but only pays alongside U11. |
| U14 | **Chroma-from-luma.** | Measured (§4.8): does not pay at tier 0. Reopen at tier 2–3 only. |
| U15 | **Embedded/progressive tiers.** | Bounded at −20% ΔE00 by the capped-decode experiment in `RATIONALE.md`. |

### Evaluation, not format

| # | Idea |
|---|---|
| U16 | **Score cross-format runs against the guards.** Every cross-format claim in `RATIONALE.md` is ΔE00-only; §2 shows the guards tell a materially different story from ~84 B up. |
| U17 | **Content-pin the corpus.** Neither `natural-images.ts` nor `holdout-images.ts` verifies a hash, and both continue on fetch failure — a partial download silently shifts every mean. |
| U18 | **A quality gate in CI.** `ci-comparison.yml` runs the cross-format compare only; a regression on the format's own R-D curve would not be caught. |
| U19 | **Perceptual validation.** Every number in this file and in `RATIONALE.md` is metric-based. |

## 6. Reproducing

```sh
just sweep budget-ladder                        # §1  R-D ladder, shipped constants
just sweep budget-ladder --split holdout        # §1
just sweep budget-ladder-tuned                  # §4.5 same ladder, findings applied
just sweep render-raster                        # §4.1
just sweep allocation-grid                      # §4.2, §4.7
just sweep precision-by-budget                  # §4.2
just sweep thumbhash-headtohead                 # §4.3
just sweep encoder-compute                      # §4.4
just sweep holdout-candidates --split holdout   # §4.5
just sweep retune-32b                           # §4.6

# Cross-format R-D at arbitrary budgets (§2)
node tools/comparison/dist/rd-budget.js --split tune \
  --budgets 12,16,18,21,24,28,32,40,48,64,80,108,192,411,1623

node tools/comparison/dist/cfl-probe.js   --split tune   # §4.8
node tools/comparison/dist/coeff-stats.js --split tune   # §4.9, §4.10
```
