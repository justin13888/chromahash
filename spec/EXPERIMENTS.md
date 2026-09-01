# ChromaHash Design Experiments

A log of designs that were *built and measured*, and of the ones that have not
been tried yet. [`RATIONALE.md`](RATIONALE.md) records why the shipped v1
constants are what they are; this file is the workbench behind it, including the
results that argue against them.

Everything here is measured with `tools/comparison` on the photographic corpus:
CIEDE2000 (ΔE00, lower better) primary, SSIMULACRA2 (higher better) /
Butteraugli (lower better) / DSSIM (lower better) as guards, browser-gamma
upscale to a 512 px display-resolution reference. **Tune split = 31 photos,
holdout split = 32 (Kodak24 + 8 held-out curated).** Candidates are chosen on
tune and validated on holdout, per the pre-registered rule in `RATIONALE.md`.

> **Two corpora, and §12 is on the second one.** The photographic corpus was
> re-sourced from Wikimedia Commons in `85f6af3`, which moved every photographic
> mean — the R-D gate's tier-1 ΔE00 went 8.8459 → 11.1369 (+25.9%) over its
> eight images. **§1–§11 have not been re-baselined and still describe the
> retired Picsum set**; §6 must be re-run in full before those numbers mean
> anything again. §12 is measured on the current corpus and compares itself to
> nothing above. Never read a §12 figure against a §1–§11 one: as §7.14 puts it,
> a run that mixes the two sets reproduces nothing.

> **Corpus revision (2026-08).** Every number below was re-measured on a
> corpus extended from 26 to 39 curated photographs, after an audit found the
> old set had no interior illuminant, no achromatic photograph, no high-key
> product framing and exactly one dark skin tone (in holdout). §9 records the
> audit, the additions and what moved. Round-1 and round-2 conclusions survive;
> two effect sizes do not, and are corrected in place.

> **Tier numbering.** Every section below was written before the tier codes
> were reordered by quality, and uses the *old* numbering, where code 0 was the
> 32-byte default. The shipped codes are `0` = compact (21 B), `1` = default
> (32 B), `2` = 108 B, `3` = 411 B, `4` = 1623 B. So a table that says "tier 0"
> means the 32-byte default (code 1 today), "tier 1" means 108 B (code 2), and
> so on; the *byte* anchors quoted alongside them are unchanged and unambiguous.
> §11.14 is the one table restated in the shipped codes, because it is the
> current cross-format record rather than the log of a finished round.
>
> The **compact tier** is the one row that mapping does not cover, because it was
> not on the old ladder at all. §8.1 and §11 propose it at code `4`, taken from the
> then-reserved `4..=7` range; `f6417d3` rejected that placement and shipped it at
> code **0** (`RATIONALE.md`, "Tier codes ordered by quality"). Read every "tier
> code 4" below as the proposal, never as what ships.

> **Status: §8 has shipped.** The recipe this file converged on is now
> `Tunables::DEFAULT` — the tier-0 layout `L 28 @ 4 / C 15 @ 3`, the selection
> weights `aniso = 1.2` / `sel_hv = 0.15`, and the encoder-only `scale_fit = 2`
> / `ac_nearest = 1`. See §10 for what adopting it took, including the integer
> reformulation of the selection order that §8.1 listed as its blocker. Rows
> labelled **shipped** in the tables below mean the *pre-adoption* v0.6-derived
> constants, which is what they were measured against; §8.3 is the delta the
> format actually moved by.
>
> Everything else these experiments introduce — `refine_*`, the header field
> widths, `cfl_*`, `synth_*`, `interleave`, `trunc_bytes` — still defaults to
> the shipped behaviour and remains sweep-only.
>
> §1–§6 are the byte-budget study (round 1). §7 builds and measures every item
> §5 listed as untried. §8 is the recipe that survived, and its parameters. §9
> is the corpus audit that every number was re-measured against. §10 records
> the adoption.

## 0. What made these measurements possible

The v1 length formula is derived from the AC layout, so resizing the layout
resizes the hash — the format has always been able to express any byte budget,
but nothing could decode one. Four tooling changes opened that surface:

| Change | Why |
|---|---|
| `ChromaHash::from_bytes_tuned` (used by `encode_stdin`) | `from_bytes` validated length against the **shipped** layout, so any length-changing sweep encoded fine and then failed to decode. Every sweep before this one had to hold the byte count fixed — which is why no byte-budget question had ever been asked. |
| `sweep.js` records per-image ΔE00 | Enables paired statistics and per-image (oracle) analyses. |
| `tools/comparison/src/rd-budget.ts` | Cross-format R-D at arbitrary byte budgets on the **same corpus split** as `mise run sweep`, so a ladder row and a ThumbHash row are directly comparable. |
| `src/cfl-probe.ts`, `src/coeff-stats.ts` | Size two roadmap items (chroma-from-luma, entropy coding) from corpus statistics instead of by assertion. |

## 1. The rate–distortion curve of v0.7

The constants that ship today (post-§10 adoption), AC layout resized to each
budget at the shipped 26:9 luma:chroma count ratio and 5 b luma / 4 b chroma
precision (`sweeps/budget-ladder.json`, both splits). Points ≤ 80 B render at
the default tier's raster, ≥ 108 B at the next one up — that is the tier's
*raster*, not its byte budget, which the layout override sets directly.

Both splits were re-measured together for v0.7. §4.5 and §7.12 quote an
**earlier** ladder, taken against the pre-adoption v0.6-derived constants, and
keep those numbers: they are what the round-1 and round-2 candidates were
measured against.

| Bytes | 10 | 12 | 14 | 16 | 18 | 21 | 24 | 28 | **32** | 40 | 48 | 64 | 80 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ΔE00 tune | 15.18 | 13.21 | 12.62 | 12.07 | 11.83 | 11.42 | 10.93 | 10.61 | **10.28** | 9.97 | 9.67 | 9.18 | 8.83 |
| ΔE00 holdout | 14.73 | 13.64 | 13.27 | 12.83 | 12.63 | 12.37 | 12.00 | 11.74 | **11.38** | 10.99 | 10.60 | 10.11 | 9.74 |

| Bytes | **108** | 129 | 161 | 189 | 246 | 310 | **411** | 512 | 767 | 1017 | **1623** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ΔE00 tune | **8.39** | 8.19 | 7.91 | 7.76 | 7.41 | 7.15 | **6.87** | 6.71 | 6.44 | 6.23 | **6.06** |
| ΔE00 holdout | **9.28** | 9.00 | 8.67 | 8.48 | 8.16 | 7.90 | **7.60** | 7.39 | 7.06 | 6.88 | **6.64** |

Marginal value collapses far faster than 1/bytes (tune split):

| Interval | 16→32 B | 32→64 B | 64→129 B | 129→246 B | 246→512 B | 512→1017 B |
|---|---|---|---|---|---|---|
| ΔE00 gained per byte | 0.112 | 0.034 | 0.0153 | 0.0066 | 0.0026 | 0.00095 |

Each doubling of the budget buys 30–45% of what the previous one did. The five
shipped tier anchors are five points on this one smooth curve; there is nothing
special about 21/32/108/411/1623 B beyond ×4 arithmetic above the default.

## 2. Cross-format at equal bytes, same corpus, same scoring

> **Superseded by §11.14.** Every ChromaHash row below was measured with a
> layout synthesized to fill the budget at 5 b/4 b — the pre-v0.7 shape — so it
> understates the shipped format. §11.14 re-measures this table with the shipped
> tiers at the shipped anchors. The competitor rows and the shape of the
> conclusions are unchanged.

`rd-budget`, **tune split**. Bold marks the leader in a column within a byte
neighbourhood.

| Bytes | Format | ΔE00 | SSIM2 | Butter |
|---|---|---|---|---|
| 11.9 | RawRGB565 | 14.00 | −346 | 43.9 |
| 12.0 | BlurHash 2×2 | 16.97 | −379 | 49.6 |
| 12.0 | **ChromaHash** | **13.79** | **−345** | **41.8** |
| 16.0 | **ChromaHash** | **12.35** | **−311** | **35.2** |
| 20.9 | **ThumbHash** | 12.04 | **−283** | **32.1** |
| 21.0 | ChromaHash, shipped shape | **11.70** | −301 | 34.4 |
| 21.0 | ChromaHash, retuned (§4.3) | **11.02** | **−280** | **31.5** |
| 22.0 | BlurHash 3×3 | 14.87 | −344 | 41.8 |
| 22.1 | RawRGB565 | 12.31 | −318 | 37.3 |
| 24.0 | **ChromaHash** | **11.14** | **−285** | **31.7** |
| 25.4 | RawRGB565 | 11.88 | −307 | 36.1 |
| 32.0 | **ChromaHash** | **10.43** | **−268** | **29.2** |
| 36.0 | BlurHash 4×4 | 13.96 | −325 | 39.2 |
| 46.9 | RawRGB565 | 10.66 | −282 | 32.0 |
| 48.0 | WebP | 12.71 | −364 | 34.2 |
| 48.0 | **ChromaHash** | **9.73** | **−243** | **27.2** |
| 63.6 | WebP | 11.31 | −250 | 29.3 |
| 64.0 | **ChromaHash** | **9.32** | **−219** | **25.4** |
| 79.9 | WebP | 10.31 | −202 | 25.5 |
| 80.0 | **ChromaHash** | **8.98** | −202 | 24.5 |
| 84.0 | lqip-modern r16 | 10.27 | **−168** | **24.1** |
| 107.0 | WebP | 9.28 | −155 | **23.2** |
| 108.0 | **ChromaHash** | **8.56** | −169 | 23.3 |
| 129.4 | lqip-modern r24 | 9.35 | **−117** | **21.7** |
| 188.6 | **WebP** | **7.87** | **−88** | **18.5** |
| 193.0 | ChromaHash | 7.87 | −115 | 21.1 |
| 252.6 | lqip-modern r48 | 7.32 | **−62** | **15.8** |
| 361.9 | RawRGB565 | 7.53 | −129 | 21.9 |
| 404.3 | **WebP** | **6.37** | **−50** | **14.0** |
| 414.0 | ChromaHash | 7.09 | −77 | 18.5 |
| 1500.7 | WebP | 5.05 | −34 | 11.6 |
| 1563.2 | **RawRGB565** | **5.80** | −59 | 16.6 |
| 1584.1 | **AVIF** | **4.54** | **−33** | **11.4** |
| 1623.0 | ChromaHash | 6.26 | −64 | 14.9 |

Holdout confirms the shape (ThumbHash 21.1 B: ΔE00 12.85 / SSIM2 −326 /
Butteraugli 31.8; ChromaHash 32 B: 11.55 / −305 / 29.3; WebP 405.7 B: 7.29 /
−62 / 14.0 vs ChromaHash 414 B: 7.79 / −77 / 18.0).

Three things this says that `RATIONALE.md` does not:

1. **ChromaHash wins colour and loses structure, everywhere.** From ~80 B up,
   lqip-modern and WebP beat it on SSIMULACRA2 *and* Butteraugli while losing on
   ΔE00. ΔE00 is the format's primary metric and the guards are only ever
   checked *within* a sweep, never across formats — so this asymmetry has never
   been scored. Every cross-format claim in `RATIONALE.md` is ΔE00-only.
2. **ThumbHash is not beaten at its own size by the shipped constants.** At
   21 B the shipped-shape layout wins ΔE00 by 2.8% but loses SSIMULACRA2 by 19
   points and Butteraugli by 7.2%. Only the retuned low-budget allocation
   (§4.3) beats ThumbHash on all four.
3. **Tier 3 loses to raw pixels.** At ~1.6 kB, RGB565 pixels with no coding at
   all score 5.80 against tier 3's 6.26. The coding machinery stops paying for
   itself somewhere between 411 B and 1623 B.

## 3. The optimal budget

> Built on §2 and superseded with it by **§11.14** — the crossovers below are
> the round-1 record. The shape survives; the ChromaHash side of every crossover
> moved with §10's adoption.

| Region | What is true there |
|---|---|
| < 12 B | Below the format's own floor: 54 bits (6.75 B) of descriptor + aspect + DC + scales before a single AC coefficient. |
| 12–20 B | ChromaHash beats BlurHash and raw pixels; ThumbHash not yet reachable. |
| **20–32 B** | **ThumbHash's budget.** With the retuned allocation ChromaHash beats it on ΔE00, SSIMULACRA2 and Butteraugli simultaneously. No real codec exists here. WebP's floor is ~48 B, which the current lineup
reproduces (`CODEC_FLOOR_BYTES` in `rd/lineup.ts` declares the same 48 B, and
470 B for AVIF); the mozjpeg and AVIF floors quoted in earlier rounds are not
reproducible from the sweeps now on disk, which carry no AVIF row below 1.5 kB
and no mozjpeg at all. |
| **32–110 B** | **The format's strongest region.** It leads every LQIP and every size-matched codec on ΔE00 by 8–25%, and still leads or ties the guards up to ~64 B. |
| 110–190 B | Still leads ΔE00; already behind WebP and lqip-modern on SSIMULACRA2 and Butteraugli. |
| ~190 B | WebP draws level on ΔE00 (7.87 vs 7.87) while winning all three guards. |
| 190–400 B | WebP takes the ΔE00 lead outright (6.37 vs 7.09 at ~410 B). |
| > 400 B | Real codecs lead by 20–40%; by 1.6 kB even uncoded RGB565 wins. |

**Conclusion.** The defensible operating range is **~20–110 B** — tier 0 and
tier 1. Tier 2 is marginal, tier 3 is indefensible as a rate–distortion claim
(keep it, if at all, on the operational argument `RATIONALE.md` already makes).
The single most valuable missing budget is **21–24 B**: it is ThumbHash's size,
it is inside the codec-free zone, and the format cannot express it at all
because the default tier is fixed at 32 B. Tier codes `4..=7` were reserved and
rejected at the time — a compact tier is the cheapest place to put it. (It
shipped at code 0 instead; the codes were ordered by quality before release —
`RATIONALE.md`, "Tier codes ordered by quality".)

The prefix is what makes small budgets expensive: 54 bits is 21% of a 32 B hash
and **32% of a 21 B hash**.

## 4. Designs attempted this round

### 4.1 Doubling the render raster buys nothing — the tier's second knob is inert

A tier does two things: ×4 the coefficient count and ×2 the render edge. Hold
byte count *and* coefficient count fixed, vary only the raster
(`sweeps/render-raster.json`, tune):

| Coefficients (bytes) | small raster | native tier raster | Δ |
|---|---|---|---|
| 104 L / 36 C (108 B) | 8.568 @32 px | 8.571 @64 px | −0.04% |
| 416 L / 144 C (411 B) | 7.089 @32 px | 7.093 @128 px | −0.05% |
| 1664 L / 576 C (1623 B) | 6.237 @64 px | 6.258 @256 px | −0.34% |

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
| L26@5 C9@4 — **shipped** | 10.434 | **8.571** |
| L28@4 C15@3 | **10.224** (−2.0%) | 8.853 (+3.3%) |
| L38@4 C8@3 | 10.238 (−1.9%) | 8.831 (+3.0%) |
| L28@4 C11@4 | 10.269 (−1.6%) | 8.729 (+1.8%) |
| L44@3 C11@3 | 10.616 (+1.7%) | 9.692 (+13%) |
| L29@5 C9@3 | 10.349 (−0.8%) | 8.668 (+1.1%) |

The optimum moves with the budget. Sweeping six precision families across five
budgets (`sweeps/precision-by-budget.json`, tune) gives the trend cleanly:

| Budget | 16 B | 21 B | 24 B | 32 B | 48 B | 80 B | 108 B |
|---|---|---|---|---|---|---|---|
| best luma bits | **3** | 3 (4 ties) | **4** | **4** | **4** | **5** | **5** |
| best ΔE00 | 11.76 | 11.19 | 10.82 | 10.22 | 9.69 | 8.98 | 8.57 |
| shipped-shape ΔE00 | 12.35 | 11.70 | 11.14 | 10.43 | 9.73 | 8.98 | 8.57 |
| gain | −4.7% | −4.3% | −2.8% | −2.0% | −0.5% | 0% | 0% |

Chroma wants exactly one bit less than luma at every budget measured, except
where luma is already at the 3-bit floor and chroma cannot follow it down.

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
| ThumbHash | 20.9 | 12.038 | −282.5 | 32.10 | 0.2210 |
| shipped shape L13@5 C6@4 | 21 | 11.698 | −301.1 | 34.40 | 0.2221 |
| L26@3 C6@3 | 21 | 11.195 | −279.3 | 30.94 | 0.2231 |
| L19@4 C6@3 | 21 | 11.197 | −284.8 | 32.14 | 0.2210 |
| **L19@4 C6@3 + stack** | 21 | **11.023** | **−279.7** | **31.52** | **0.2207** |
| L22@4 C8@3 + stack | 24 | 10.681 | −273.7 | 30.42 | 0.2197 |

**Holdout split**

| Layout | Bytes | ΔE00 | SSIM2 | Butter | DSSIM |
|---|---|---|---|---|---|
| ThumbHash | 21.1 | 12.851 | −326.3 | 31.75 | 0.2589 |
| shipped shape L13@5 C6@4 | 21 | 12.611 | −349.2 | 33.04 | 0.2587 |
| **L26@3 C6@3 + stack** | 21 | **11.986** | **−303.8** | **30.07** | **0.2575** |
| L22@3 C8@3 + stack | 21 | 12.006 | −319.0 | 31.22 | 0.2577 |
| L19@4 C6@3 + stack | 21 | 12.107 | −323.5 | 30.53 | 0.2573 |
| L22@4 C8@3 + stack | 24 | 11.789 | −313.2 | 30.00 | 0.2567 |

A 21-byte ChromaHash that beats ThumbHash on **all four** metrics exists and
validates on holdout (−6.7% ΔE00, +23 SSIMULACRA2, −5.3% Butteraugli, −0.5%
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
| 21 B | 11.698 | — | — | — | 11.666 (−0.27%) |
| 32 B | 10.434 | 10.429 (−0.05%) | 10.381 (−0.51%) | 10.392 (−0.40%) | 10.390 (−0.43%) |
| 108 B | 8.571 | — | — | — | 8.491 (−0.93%) |
| 411 B | 7.093 | — | — | — | 6.967 (−1.78%) |

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
| shipped | 32 | 11.554 | — | −304.5 | 29.27 | 0.2559 | (base) |
| L38@4 C8@3 | 32 | 11.342 | −1.84% | −274.3 | 27.31 | 0.2555 | ok |
| L28@4 C15@3 | 32 | 11.321 | −2.02% | −299.4 | 28.66 | 0.2556 | ok |
| shipped + stack | 32 | 11.403 | −1.31% | −292.5 | 28.72 | 0.2555 | ok |
| L38@4 C8@3 + stack | 32 | 11.273 | −2.44% | −268.2 | 27.04 | 0.2556 | ok |
| **L28@4 C15@3 + stack** | 32 | **11.189** | **−3.16%** | −290.6 | 28.46 | 0.2551 | **ok** |
| tier 1 shipped | 108 | 9.435 | −18.34% | −169.1 | 22.86 | 0.2512 | ok |
| tier 1 + stack | 108 | 9.266 | −19.80% | −162.7 | 22.63 | 0.2504 | ok |

**−3.16% holdout ΔE00 with every guard improving clears the pre-registered ≥3%
retune threshold** — the first candidate in the project's history to do so. Two
caveats before it can enter the spec: `aniso` still needs the integer
reformulation `RATIONALE.md` flags, and a changed encoder changes every test
vector even though the decoder is untouched.

Applying the findings across the whole ladder
(`sweeps/budget-ladder-tuned.json`: per-budget luma precision from §4.2, chroma
one bit under luma, plus the stack):

| Bytes | 12 | 16 | 21 | 24 | 28 | 32 | 48 | 64 | 108 | 246 | 411 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| tune, pre-adoption shipped | 13.79 | 12.35 | 11.70 | 11.14 | 10.80 | 10.43 | 9.73 | 9.32 | 8.57 | 7.67 | 7.09 |
| tune, tuned | 12.63 | 11.75 | 11.02 | 10.68 | 10.40 | 10.20 | 9.59 | 9.22 | 8.41 | 7.48 | 6.92 |
| tune Δ | −8.4% | −4.8% | −5.8% | −4.1% | −3.7% | −2.3% | −1.5% | −1.1% | −1.9% | −2.5% | −2.4% |
| holdout, pre-adoption shipped | 13.84 | 13.07 | 12.61 | 12.14 | 11.79 | 11.55 | 10.72 | 10.24 | 9.44 | 8.31 | 7.79 |
| holdout, tuned | 13.28 | 12.64 | 12.11 | 11.79 | 11.47 | 11.24 | 10.52 | 10.14 | 9.26 | 8.15 | 7.63 |
| holdout Δ | −4.0% | −3.3% | −4.0% | −2.9% | −2.7% | −2.7% | −1.9% | −1.0% | −1.9% | −1.9% | −2.1% |

The gain is largest exactly where the shipped constants were never checked. The
compact way to say it: **the retuned encoder reaches today's tier-0 quality in
28 bytes instead of 32** (tune 10.40 vs 10.43; holdout 11.47 vs 11.55) — a 12.5%
byte saving at equal quality, with no wire-format change beyond the layout
table.

### 4.6 Companding retune at the new allocation — no effect

µ_L=5 / µ_C=8 were locked against a 5 b / 4 b layout. Re-swept against the 4 b /
3 b winner (`sweeps/retune-32b.json`, tune): µ_L ∈ {3,4,6,8} spans 10.229–10.286
against 10.238 at µ_L=5; µ_C ∈ {5,6,12,16} spans 10.246–10.275. The plateau
`RATIONALE.md` reports survives the change of bit depth — µ-law is not the
binding constraint at any of these depths.

### 4.7 Per-image adaptive layout — sized, and small

The decoder reads the DC and scale fields before any AC, so encoder and decoder
could both derive a layout from them with **zero signaling**. Upper bound, from
per-image ΔE00 across the 29-allocation grid (tune):

| | 32 B | 108 B |
|---|---|---|
| shipped fixed layout | 10.434 | 8.571 |
| best single fixed layout | 10.224 | 8.571 |
| per-image **oracle** layout | 10.010 | 8.401 |
| oracle gain beyond the best fixed layout | −2.1% | −2.0% |

A perfect oracle over 29 layouts buys 2%; a header-derivable rule would capture
a fraction of that. Not worth a wire change.

### 4.8 Chroma-from-luma — the roadmap's "largest expected win" is small

`cfl-probe`, tune split, 26 coefficients per channel with L and chroma sharing
one selection order so index *i* is the same (cx, cy) in all three channels:

* mean |ρ(a, L)| = 0.457, mean |ρ(b, L)| = 0.504
* after a **per-image least-squares** predictor — itself an oracle, since α
  would have to be signaled — residual energy is **71.5%** (a) and **63.2%** (b)
  (the one grayscale photograph in the split has an identically-zero `a` AC set,
  for which both statistics are 0/0; the probe now excludes such a channel
  instead of scoring it as ρ = 0, residual = 100%)

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
| zeroth-order entropy | 4.469 b | 3.865 b |
| entropy conditioned on selection index | 3.590 b | 3.529 b |

Whole tier-0 AC payload: 202 b fixed → **185.8 b** zeroth-order (−8.0%) →
**156.9 b** with a per-index context model (−22.3%).

> **Corrected in §7.13.** Both figures are *in-sample* entropies of the corpus
> that produced them, and the 156.9 b context number does **not** survive
> out-of-sample scoring — 26+18 per-index histograms estimated from 31 images
> over a 31-symbol alphabet are mostly noise. Measured leave-one-image-out with
> a real adaptive coder, the achievable saving is **8.7%, not 22.3%**.

### 4.10 Selection-order headroom, measured

Luma AC energy captured by K=26 of the 200 lowest-frequency candidates (tune):

| Selection | energy captured |
|---|---|
| ℓ2-ball prefix (shipped) | 81.73% |
| best corpus-fixed 26 (trainable, zero signaling) | 83.27% — 6 of 26 slots differ |
| best per-image 26 (oracle) | 91.16% |

The trainable reorder is worth ~1.5 energy points, consistent with the −0.64%
ΔE00 the anisotropic weight achieves on this corpus — `aniso` is capturing most
of what a fully trained fixed order could. Per-image selection is worth 9 points
but needs signaling, which only pays alongside entropy coding.

Both headroom figures shrank when the corpus stopped being predominantly
outdoor landscape (§9): a trained *fixed* order is worth less exactly when the
corpus's dominant orientation structure is less uniform.

## 5. Untried (as of round 1)

Every item below was subsequently built and measured — see §7 for the results
and §8 for what survived. Kept as written so the predictions can be scored
against the outcomes.

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
| U6 | **Budget-dependent precision** — 3 b luma below 20 B, 4 b to ~56 B, 5 b above; chroma one bit under luma. | Measured (§4.2): −4.7% at 16 B, −2.0% at 32 B, 0 at ≥80 B. Breaks the constant-precision tier axiom. |
| U7 | **Corpus-trained selection order**, generalizing `aniso`. | Measured headroom (§4.10): +1.5 energy points; `aniso=1.2` already captures most of it. |
| U8 | **Shrink the prefix.** 54 b is 21% of tier 0 and 32% of a 21 B hash. Aspect 8 b → 5 b (≈2.5% ratio error, still 3× better than ThumbHash); scales 6/6/5 b → 5/4/4 b with log-spaced codes; 1 reserved bit; 1 unused tier bit. | ~10 bits ≈ 2–3 extra luma coefficients at a small budget. **Untested** — the highest-value unmeasured item on this list. |
| U9 | **Derive the b scale from the a scale** instead of storing both. | 5 bits. Untested; `RATIONALE.md`'s range-asymmetry proxy suggests they are far from independent. |

### Wire-level

| # | Idea | Sizing |
|---|---|---|
| U10 | **A compact tier below 32 B** (tier codes 4–7 were reserved at the time). | Measured (§4.3): a 21 B layout beats ThumbHash on all four metrics, on holdout (−6.7% ΔE00). The highest-value structural gap. |
| U11 | **Entropy-coded AC with a per-index context model.** | Measured (§4.9): −22.3% of the AC payload in sample, 8.7% out of sample (§7.13). Costs the O(1) length check. |
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
# Round 1 — the byte-budget study (§1–§4)
mise run sweep budget-ladder                        # R-D ladder, shipped constants
mise run sweep budget-ladder --split holdout
mise run sweep budget-ladder-tuned                  # round-1 recipe
mise run sweep render-raster                        # §4.1
mise run sweep allocation-grid                      # §4.2, §4.7
mise run sweep precision-by-budget                  # §4.2
mise run sweep thumbhash-headtohead                 # §4.3
mise run sweep encoder-compute                      # §4.4
mise run sweep holdout-candidates --split holdout   # §4.5
mise run sweep retune-32b                           # §4.6

# Round 2 — the roadmap, materialized (§7)
mise run sweep refine-ablation                      # §7.1  pixel-domain RDO
mise run sweep refine-objective                     # §7.2  metric-targeted RDO
mise run sweep refine-grid                          # §7.2  render-grid control
mise run sweep selection-hv                         # §7.4  trained selection order
mise run sweep prefix-shrink                        # §7.5  header field widths
mise run sweep detail-synthesis                     # §7.8  decoder-side synthesis
mise run sweep cfl                                  # §7.10 chroma-from-luma
mise run sweep cfl-range                            # §7.10 the CfL audit
mise run sweep embedded-tiers                       # §7.11 progressive prefixes
mise run sweep combined-optimizer                   # §7.12 stacking, tune
mise run sweep final-candidates --split holdout     # §7.12 the holdout verdict
mise run sweep budget-ladder-optimized              # §7.12 optimized ladder
mise run sweep budget-ladder-optimized --split holdout

# Cross-format R-D at arbitrary budgets, with guard-aware winners (§2, §7.14)
node tools/comparison/dist/rd-budget.js --split tune \
  --budgets 12,16,18,21,24,28,32,40,48,64,80,108,192,411,1623

node tools/comparison/dist/cfl-probe.js      --split tune   # §4.8
node tools/comparison/dist/coeff-stats.js    --split tune   # §4.9, §4.10
node tools/comparison/dist/entropy-budget.js --split tune   # §7.13
mise run rd:gate                                                # §7.14 CI gate

# Round 3 — v0.7 stabilization (§11)
mise run sweep alpha-layout                         # §11.1
mise run sweep alpha-layout-control                 # §11.2
mise run sweep alpha-fields                         # §11.3
mise run sweep alpha-ac-count                       # §11.3
mise run sweep alpha-ceiling                        # §11.3
mise run sweep alpha-encoder                        # §11.3
mise run sweep alpha-balance                        # §11.3  C3-vs-C5 chroma count
mise run sweep graphics-layout                      # §11.4
mise run sweep graphics-encoder                     # §11.4
mise run sweep selection-weights                    # §11.5
mise run sweep companding-family                    # §11.6
mise run sweep deadzone                             # §11.7
mise run sweep quant-ranges                         # §11.8
mise run sweep scalefactor-bands                    # §11.9
mise run sweep compact-tier                         # §11.10
mise run sweep compact-tier-graphics                # §11.10
mise run sweep compact-tier-alpha                   # §11.12 compact tier, alpha corpus
mise run sweep alpha-tier1                          # §11.11
mise run sweep v07-holdout-photo --split holdout    # §11.12
mise run sweep v07-holdout-alpha --split holdout    # §11.12
mise run sweep adopted-defaults                     # §10.3
mise run sweep adopted-defaults --split holdout     # §10.3

# Round 4 — the instruments, and the window (§12)
mise run sweep synthesis-window                     # §12.2
mise run sweep synthesis-window-upper               # §12.3
mise run selftest:metrics                           # §12.1, §12.5

# §12.1's orientation table and §12.4's come from a report run, not a sweep, so
# verify:experiments does not bind them. Read them out of output/report.json's
# per-format `local` block.
node tools/comparison/dist/main.js --skip-harnesses --images 'fixtures/natural/chroma-black-and-white.jpg'

# Check the tables in this file against the results above
mise run verify:experiments
mise run verify:experiments --list-unbound
```
Five configs in `tools/comparison/sweeps/` are **not** written up above, and are
listed here so their absence is not mistaken for a result being withheld:
`low-budget-allocation` and `v06-vs-v1` were run (their output is in
`output/sweeps/`) and were superseded before this file's round-3 numbers were
taken; `capped-tier1-vs-tier0`, `scalefactor-bands-t1` and
`tier-precision-vs-count` were written but never run. None of them informed an
adopted constant. `mise run verify:experiments` checks the tables that *are* here
against the outputs that produced them.

`aniso-selection` and `aniso-extended`, named in §11.5, were deleted when
`selection-weights` replaced them; their outputs survive only in the gitignored
`output/sweeps/`.

Every command above reads the corpus of `tools/comparison/src/natural-images.ts`
and `holdout-images.ts`, content-pinned by SHA-256. The numbers in this file are
from the 39-image curated corpus of §9; a run against a different corpus is a
different experiment, not a reproduction.


## 7. Round 2: every roadmap item, built and measured

Each `U`-number from §5 was implemented behind a tunable, round-tripped, and
swept. Tune split unless stated; the winners are re-validated on holdout in §7.12.
`spec/test-vectors/` passes unchanged throughout: every knob defaults to the
shipped behaviour.

### 7.1 U1/U2/U3 — pixel-domain RDO: the search works, the objective was wrong

Implemented as a coordinate descent over the quantized codes (`refine_passes`),
scored on the decoded pixels rather than the coefficients, with the DC codes
(`refine_dc`, U2) and the AC scale codes (`refine_scale`, U3 clipping
pre-compensation) as optional extra coordinates.

**Verification first.** On sources whose tier-0 render grid *is* the source grid
(so the encoder's model of the decoder can be checked directly against a real
decode), two passes reduce the gamma-sRGB squared error it optimizes by
**15–31%**, and adding the DC and scale coordinates takes it to **17–31%**:

| source | shipped | +2 passes | +dc+scale |
|---|---|---|---|
| 32×21 | 14.03 | 10.19 (−27.4%) | 9.61 (−31.5%) |
| 32×32 | 38.43 | 32.60 (−15.2%) | 31.73 (−17.4%) |
| 24×32 | 17.51 | 14.21 (−18.8%) | 12.88 (−26.5%) |

**And yet ΔE00 gets worse** (`sweeps/refine-ablation.json`, tune, 32 B):

| Variant | ΔE00 | Δ% |
|---|---|---|
| shipped | 10.434 | — |
| `refine_obj=1` (OKLAB, no clipping model — the control) | 10.395 | −0.38% |
| `refine_obj=0` (gamma sRGB), 2 passes | 10.451 | **+0.16%** |
| `refine_obj=0`, 2 passes + dc + scale | 10.521 | **+0.83%** |
| `refine_obj=2` (clipped OKLAB), 2 passes | 10.373 | −0.59% |

A 15–31% reduction in decoded-pixel squared error buys a **+0.8% increase** in
ΔE00. Not a bug — the model of the decoder is exact, as the table above proves.
The premise of U1 was wrong: at these bitrates, squared pixel error and
perceived colour error are actively anti-correlated. (`refine_obj=1` finding
−0.38% on a supposedly separable objective is the scale mismatch of §4.4 turning
up again through a different door.)

### 7.2 U5 — metric-targeted RDO is the version that pays

Since the objective is what matters, `refine_obj=3` weights the clipped-OKLAB L
term by `refine_wl` and the chroma terms by `refine_wc`
(`sweeps/refine-objective.json`, tune, 32 B):

| chroma weight | 0.5 | 1 | 2 | **3** | 4 | 6 | 10 |
|---|---|---|---|---|---|---|---|
| ΔE00 Δ% | +0.33% | −0.51% | −0.66% | **−0.80%** | −0.76% | −0.59% | −0.36% |

A clean optimum at `wc ≈ 3–4`. Adding the DC and scale coordinates takes it to
**−1.11%** (−1.24% at `wc = 4`), four passes to −1.21%, and on the retuned
4-bit layout of §4.2 to **−3.18%** (against −2.01% for that layout alone) — so
the refinement contributes about **−1.2 pp** on top of a good layout, and
−1.4 pp at tier 1.

Also measured: `refine_grid=1` moves the objective onto the decoder's natural
render grid (scored against the ideal full-basis downsample of the source)
instead of the encoder input. **It makes no difference at all** — 10.37 vs 10.38
at `obj=2`. The grid was a red herring; only the error metric mattered.

**Cost.** Refinement is ~54× the shipped encode (0.86 ms → 46 ms at tier 0,
3.2 ms → 275 ms at tier 1, on this machine). Decode is untouched.

### 7.3 U4 — closed-loop residual re-projection: refuted on paper, not built

The selected cosine basis is orthogonal over the encoder-input grid, so the
projection of the residual onto that basis is **exactly** `raw − dequantized`.
Adding it back and requantizing is therefore not error feedback but a fixed
bias, and can only lose. The only part of the residual that is *not* recoverable
this way is what the clipping non-linearity introduces — and that is precisely
what §7.1/§7.2's descent already searches, with a stronger objective. The knob
(`reproject_passes`) exists and is wired to nothing; U4 is subsumed.

### 7.4 U7 — corpus-trained selection order, as a 2-parameter family

`sel_hv` adds a horizontal/vertical asymmetry to the selection key:
`priority · (1 + aniso·sin²2θ) · (1 + hv·cos2θ)`. Positive `hv` pushes horizontal
frequencies (vertical edges) down the order (`sweeps/selection-hv.json`, tune,
32 B):

| | hv = −0.30 | −0.15 | 0 | **+0.15** | +0.30 |
|---|---|---|---|---|---|
| aniso = 0 | +2.22% | +1.54% | — | −0.67% | −0.81% |
| aniso = 1.2 | +0.92% | +0.36% | −0.64% | **−1.03%** | −1.13% |

Nearly additive with the oblique-effect weight, and the sign is interpretable:
photographic corpora carry more energy in vertical frequencies (horizons,
ground/sky), so demoting horizontal ones is right.

**The effect halved when the corpus stopped being predominantly outdoor
landscape** (§9): on the old 22-image split the same cell measured −2.09%, and
`aniso` alone −1.17%. Interiors, facades and flat man-made surfaces do not share
the horizon-driven H/V asymmetry, and a *fixed* trained order can encode only
one asymmetry. On top of the retuned L28@4 C15@3 layout the weights now add
nothing at all on tune (−1.99% with them, −2.01% without) — the layout has
already taken what they were taking. They still pay on holdout (§7.12), which is
where the decision is made, but the honest size of this lever is the +1.5 energy
points `coeff-stats` now measures (§4.10), not +2.2.

**Cost:** the weighted order is a float sort over every candidate, and it is
**+32% decode time** (302 → 399 µs) — the integer reformulation `RATIONALE.md`
already flags is now a performance requirement, not just a purity one.

### 7.5 U8/U9 — shrink the prefix: the "highest-value unmeasured item" is refuted

Every header field width is now tunable. Pure cost first (same AC layout, tune,
32 B):

| Narrowing | bits saved | ΔE00 Δ% | guards |
|---|---|---|---|
| aspect 8 → 5 b | 3 | **−0.45%** | ok |
| aspect 8 → 4 b | 4 | **−0.50%** | ok |
| scales 6/6/5 → 5/4/4, linear grid | 4 | +2.73% | ok |
| scales 6/6/5 → 5/4/4, **µ-law grid** (`scale_mu=8`) | 4 | +0.34% | ok |
| `b_scale_from_a` (drop the b field) | 5 | +3.79% | **FAIL** |
| DC 7/7/7 → 6/6/6 | 3 | +1.27% | ok |
| all of the above | 15 | +5.06% | ok |

Then spend the recovered bits on AC at the same 32 bytes — **nothing beats
leaving the prefix alone**. Best 5-bit-luma row: −0.03%, and it fails the
guards. Best 4-bit-luma row: −2.05% against −2.01% for the same layout with the
full prefix, i.e. **+0.04 pp** for three bits of aspect precision.

Two real findings inside a negative result:

* **µ-law scale codes work.** Narrowing the scale fields costs +2.73% on a
  linear grid and +0.34% on a companded one. Corpus scales cluster far below
  the range maximum, exactly as expected. If a future revision needs scale bits,
  this is how to take them.
* **U9 is dead.** `b_scale_from_a` costs +3.79% and fails the guards. The two
  chroma scales are not redundant.

**The aspect "gain" is a measurement artifact.** `upscaleRgba` resizes every
decode to the reference dimensions with `fit: "fill"`, so **the evaluation
could not see aspect error at all** — it stretches the wrong-shaped decode back
into the right frame. The real cost is analytic: a `b`-bit aspect field has a
max ratio error of `2^(4/2^b) − 1`, i.e. 1.09% at 8 b, 4.4% at 6 b and **9.1% at
5 b — worse than ThumbHash's 3-bit ~7%**, which is the comparison the format's
"precise layout" claim rests on. At 5 bits, 3:2 and 4:3 images decode to the
same 32×22 grid. Keep 8 bits.

> **The blindness is fixed; the conclusion is not affected.** The comparison
> harness now measures layout fidelity directly (`tools/comparison/src/aspect.ts`),
> outside the metric path, so the number no longer has to be argued analytically —
> see U19 in §7.14. The sweep rows above were measured under the blind harness and
> still stand: they measure ΔE00, which the stretch does not affect, and the reason
> to keep 8 bits was never in the sweep.

### 7.6 U10 — the compact tier below 32 B

Materialized as a measured layout rather than a new tier code (tier codes 4–7
were still reserved at this point). With the round-2 recipe at ThumbHash's own 21 B, **holdout**:

| | ΔE00 | SSIM2 | Butteraugli | DSSIM |
|---|---|---|---|---|
| ThumbHash (21.1 B) | 12.851 | −326.3 | 31.75 | 0.2589 |
| ChromaHash 21 B, shipped-shape layout | 12.611 | −349.2 | 33.04 | 0.2587 |
| **ChromaHash 21 B, L19@4 C6@3 + stack** | **12.047** | **−323.2** | **30.52** | **0.2576** |
| ChromaHash 21 B, + refinement | **11.970** | −321.9 | 30.57 | 0.2582 |

−6.3% ΔE00 against ThumbHash while also winning SSIMULACRA2, Butteraugli and
DSSIM, validated out of sample (and the 3-bit variant of §4.3 does better still,
−6.7%). This remains the single largest structural gap.

### 7.7 U11 — entropy-coded AC

See §7.13 (measured with a real adaptive coder, not just static entropy).

### 7.8 U12 — decoder-side detail synthesis: refuted, decisively

Implemented in the decoder: frequencies past the coded band are filled with
pseudo-random signs (xorshift64\*, seeded by FNV-1a over the hash bytes, so it is
deterministic and cross-platform) whose amplitude continues the coded band's own
spectral decay (`sqrt(p_K/p_j)` times the RMS of the coded set's top quarter).
Zero bytes. `sweeps/detail-synthesis.json`, tune:

| variant | ΔE00 Δ% | SSIM2 | Butteraugli | DSSIM |
|---|---|---|---|---|
| shipped | — | −268.0 | 29.19 | 0.2188 |
| 26 extra coefficients, gain 0.25 | +1.14% | −275.7 | 29.69 | 0.2199 |
| 78, gain 0.5 | +6.57% | −318.7 | 32.11 | 0.2276 |
| 234, gain 0.5 | +9.74% | −371.0 | 33.50 | 0.2361 |
| tier 1, 312, gain 0.5 | +5.0 pp | −224.2 | 24.95 | 0.2262 |

The hypothesis was that SSIMULACRA2 and DSSIM — the axes where the format loses
to WebP — would reward plausible detail. **They do the opposite**: every
structural metric gets monotonically worse with synthesis strength. Synthesized
detail is uncorrelated with real detail, and these metrics are not fooled by
texture that is merely present. Decode also costs +70%. Dead end, and worth
recording because the idea is intuitively appealing.

### 7.9 U13 — per-image signalled selection

Using the 12 `(aniso, hv)` presets of §7.4 as the signalled alphabet, per-image
(tune):

| | ΔE00 |
|---|---|
| shipped ℓ2-ball order | 10.434 |
| best single fixed preset (aniso 1.2, hv +0.30) | 10.317 (−1.13%) |
| per-image **oracle** preset | 10.152 (−2.70% vs shipped, **−1.59% vs best fixed**) |

Signalling 4 bits costs ~0.37% ΔE00 at 32 B, so an oracle selector nets ~−1.2%
— and a real selector would capture only part of the oracle. Worth less than the
fixed preset it would sit on top of. Not recommended.

### 7.10 U14 — chroma-from-luma: built, audited, refuted at every tier

Implemented as a wire feature: a signalled per-channel least-squares gain
(`cfl_bits`, `cfl_range`), with each chroma AC coefficient coded as a residual
against `alpha ×` the luma coefficient the *decoder* reconstructs at the same
selection index. `sweeps/cfl.json`, tune:

| | bytes | ΔE00 | vs its own control |
|---|---|---|---|
| shipped | 32 | 10.434 | — |
| CfL free (gains not paid for) | 34 | 10.454 | **+0.19%** |
| CfL paid, L24@5 C9@4 | 32 | 10.597 | +0.16% vs the same layout without CfL |
| CfL paid on the 4-bit layout | 32 | 10.335 | +0.38% vs its control |
| tier 1 free | 109 | 8.591 | +0.23% |
| tier 2 free | 412 | 7.099 | +0.08% |
| tier 3 free | 1624 | 6.241 | −0.27% |

A *free* least-squares predictor being worse than none is not physically
expected, so this was audited rather than reported:

1. **Gain precision excluded.** Sweeping `cfl_range` over 0.05–1.0 and
   `cfl_bits` to 10 (α step 5·10⁻⁴, effectively exact) leaves it in the
   +0.07…+0.21% band (`sweeps/cfl-range.json`). Quantized gains are not the
   problem.
2. **The predictor does work.** Residual *energy* after the least-squares gain
   is 71.5% (a) / 63.2% (b) of the original (§4.8) — an amplitude ratio of
   ≈0.85 / 0.79, so the scale field really does shrink.
3. **Coefficient error really does improve.** Simulating the µ-law path,
   RMS coefficient error falls from 0.0376 → 0.0356 (a) and 0.0375 → 0.0306 (b),
   *including* the α·(luma quantization error) the predictor imports. (Points 2
   and 3 were measured before the §9 corpus revision; the ΔE00 verdict above is
   from the revised corpus and does not rest on them.)

So CfL reduces both the scale and the coefficient error, and still costs ΔE00.
This is the same anti-correlation as §7.1, now on a third independent lever:
**MSE-optimal chroma is not ΔE00-optimal at these bitrates.** Combined with the
2 · `cfl_bits` it must pay for, CfL is a loss at tiers 0–2 and within noise at
tier 3 (−0.27% there). The §4.8 correlation probe called this correctly.

### 7.11 U15 — embedded/progressive tiers

Implemented: `interleave` writes the AC codes of all three channels merged by
frequency priority (identical bytes-out length, a pure permutation, verified
byte-neutral at full length), and `trunc_bytes` decodes only a prefix, treating
every code past it as the exact-zero centre code. `sweeps/embedded-tiers.json`,
tune:

| Decoded from a 108 B tier-1 hash | ΔE00 | vs native tier 0 (10.434) | SSIM2 |
|---|---|---|---|
| first 32 B, interleaved | 10.747 | **+3.00%** | −285.7 |
| first 32 B, channel-sequential | 11.575 | +10.93% | −251.4 |
| first 48 B, interleaved | 9.939 | −4.74% | −264.4 |
| first 64 B, interleaved | 9.467 | −9.27% | −248.8 |
| full 108 B (either order) | 8.571 | −17.86% | −169.8 |

Interleaving is worth **7.2%** over a sequential prefix at the 32-byte cut, and
progressive costs **~3%** against a native tier-0 encode at the same 32 bytes.
Note the trade the two orders make: a sequential prefix delivers all of the luma
and none of the chroma, so it scores *better* on SSIMULACRA2 (−251.4 vs −285.7)
and much worse on ΔE00. Progressive is affordable; it is an operational feature
(one hash serves every size), not a quality one.

### 7.12 The optimized recipe, validated on holdout

`sweeps/final-candidates.json`, **holdout split**, incumbent = shipped 32 B.
**STACK** = `l1=28:4 c=15:3 aniso=1.2 sel_hv=0.15 scale_fit=2 ac_nearest=1`;
**REFINE** = `refine_passes=2 refine_grid=1 refine_obj=3 refine_wc=3 refine_dc=1 refine_scale=1`.

| Variant | Bytes | ΔE00 | Δ% | SSIM2 | Butter | DSSIM | Guards |
|---|---|---|---|---|---|---|---|
| shipped | 32 | 11.554 | — | −304.5 | 29.27 | 0.2559 | (base) |
| shipped layout + stack | 32 | 11.383 | −1.48% | −290.5 | 28.62 | 0.2553 | ok |
| L36C9 stack | 32 | 11.232 | −2.79% | −269.2 | 27.30 | 0.2554 | ok |
| L32C12 stack | 32 | 11.216 | −2.93% | −277.6 | 27.80 | 0.2553 | ok |
| L30C13 stack | 32 | 11.219 | −2.90% | −284.0 | 28.26 | 0.2552 | ok |
| L28C15 stack, hv = 0 | 32 | 11.189 | −3.16% | −290.6 | 28.46 | 0.2551 | ok |
| **L28C15 stack** | 32 | **11.150** | **−3.50%** | −285.8 | 28.49 | 0.2550 | **ok** |
| **L28C15 stack + REFINE** | 32 | **11.079** | **−4.12%** | −284.5 | 28.45 | 0.2558 | **ok** |
| tier 1 base | 108 | 9.435 | −18.34% | −169.1 | 22.86 | 0.2512 | ok |
| tier 1 stack | 108 | 9.281 | −19.68% | −159.4 | 22.51 | 0.2505 | ok |
| tier 1 stack + REFINE | 108 | 9.238 | −20.04% | −158.6 | 22.47 | 0.2508 | ok |
| tier 2 stack | 411 | 7.604 | −34.19% | −76.3 | 17.76 | 0.2441 | ok |

Both winners clear the pre-registered ≥3% holdout threshold with **every guard
improving** — on the revised corpus as on the old one (−3.50% here against
−3.51% before; see §9). `sel_hv = 0.15` generalizes: it beats `hv = 0` out of
sample (−3.50% vs −3.16%) while `hv = 0.3` — which is *better* on tune (−3.20%
vs −2.41%) — drops to −2.83% on holdout. 0.15 is the right value, and the
selection weights now earn their keep only out of sample (§7.4).

The whole ladder under the constants-only recipe
(`sweeps/budget-ladder-optimized.json`):

| Bytes | 12 | 16 | 21 | 24 | 28 | 32 | 40 | 48 | 64 | 80 | 108 | 161 | 246 | 411 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| tune, pre-adoption shipped | 13.79 | 12.35 | 11.70 | 11.14 | 10.80 | 10.43 | 10.03 | 9.73 | 9.32 | 8.98 | 8.57 | 8.07 | 7.67 | 7.09 |
| tune, optimized | 12.43 | 11.70 | 10.96 | 10.66 | 10.38 | 10.19 | 9.84 | 9.53 | 9.19 | 8.83 | 8.39 | 7.90 | 7.40 | 6.92 |
| holdout, pre-adoption shipped | 13.84 | 13.07 | 12.61 | 12.14 | 11.79 | 11.55 | 11.14 | 10.72 | 10.24 | 9.85 | 9.44 | 8.85 | 8.31 | 7.79 |
| holdout, optimized | 13.15 | 12.58 | 12.05 | 11.74 | 11.42 | 11.23 | 10.78 | 10.46 | 10.11 | 9.74 | 9.28 | 8.67 | 8.16 | 7.63 |

(The 32 B row of this ladder uses the ratio-derived `L33@4 C11@3`; the *measured*
optimum `L28@4 C15@3` is better still — 11.150 on holdout, in the table above.)

**The compact way to say it: the optimized 32-byte encode equals the shipped
format at 40 bytes** (holdout 11.150 vs 11.138) — a **20% byte saving at equal
quality**, rising to ~24% with the refinement pass.


### 7.13 U11 — entropy-coded AC, with a real coder instead of an entropy

`entropy-budget.ts` re-asks §4.9's question with two changes: the code stream is
actually coded (sequentially, per image, against a Laplace-smoothed adaptive
model) rather than assigned its pooled entropy, and the model is scored
**leave-one-image-out** so the table's own fitting cost is paid.

| Model | AC bits (of 202 fixed) | vs fixed | honest? |
|---|---|---|---|
| static pooled entropy (§4.9) | 185.6 | −8.1% | no — in-sample lower bound |
| static per-index entropy (§4.9) | 156.9 | −22.3% | **no — badly optimistic** |
| order-0 adaptive, no decoder tables | 196.6 | −2.7% | yes |
| order-0 pretrained table, LOO | 187.9 | −7.0% | yes |
| per-index context table, LOO | 188.1 | −6.9% | yes |
| **per-index context backing off to order-0, LOO** | **184.4** | **−8.7%** | yes |

Two corrections fall out:

* **A table-free adaptive coder is worse than the static entropy by 5.9%**
  (196.6 vs 185.6 b). A 44-symbol payload never lets a model that starts uniform
  pay for itself.
* **Per-index context, scored out of sample, is worse than plain order-0**
  (188.1 vs 187.9 b) — the opposite of what §4.9's in-sample number implied. It
  helps only when backed off to the order-0 table, and then by 3.5 b.

So the real tier-0 headroom is **17.6 bits ≈ 3 extra 5-bit luma coefficients**,
not the ~10 that the in-sample context figure implies. Spending it (searching
layouts that fit under each coder) gives **−4.3% ΔE00** at 32 B and **−4.0%** at 108 B — real, and of
the same order as the constants changes of §8, but paid for with decoder tables,
a decode loop, and the O(1) length check that currently *is* the validity check.

A useful counter-finding from the same search: maximizing *coefficient count* is
the wrong objective. The count-maximal layout that fits 32 B under the fixed
fields is L35@3 C23@2 — 81 coefficients — and it scores **11.829, 13% worse than
shipped**; letting a coder buy 182 of them is worse still (11.673). There is a
precision floor below which more coefficients stop helping, and 3-bit luma with
2-bit chroma is below it.

### 7.14 U16/U17/U18 — the evaluation items

**U16 — guard-aware cross-format scoring.** `rd-budget.ts` now emits a
winner-per-metric summary (and a `--summarize` mode that recomputes it from an
existing JSON). It makes the §2 asymmetry explicit: on the tune split
ChromaHash's shipped constants win ΔE00 *and lose at least one guard* at
**21 B** (to ThumbHash), **80 B** and **108 B** (to lqip-modern) and **192 B**
(to lqip-modern and WebP, which also draws level on ΔE00); they sweep all four
metrics at 12, 16, 18, 24, 28, 32, 40, 48 and 64 B. §8.6 shows the optimized
recipe reclaiming 21 B, and 108 B against size-matched WebP.

**U17 — content-pinned corpus.** `corpus-pin.ts` verifies a SHA-256 for every
fixture, cached or freshly fetched; `natural-images.ts` (39 digests) and
`holdout-images.ts` (24 Kodak digests) now **throw** on mismatch or fetch
failure instead of warning and continuing with a partial corpus. Independently
verified: the digests match the current fixtures, appending one byte to
`natural-food.jpg` aborts with the expected/actual digests, and the check passes
again once restored.

> **A corpus change is a re-baseline, not an edit.** `sweep.ts` globs
> `fixtures/**` and defaults unknown names to the tune split, so adding an
> image silently moves every mean in this file. That is what makes the pin
> load-bearing: the digests say *which* corpus a number belongs to. The 13
> photographs of §9 were added deliberately and **every table above was
> re-measured in the same change**; a run that mixes the two sets reproduces
> nothing (ThumbHash on "tune": 11.17 before, 12.04 after). Treat any future
> addition the same way — re-run §6 in full, or do not add it.

**U18 — a CI quality gate.** `mise run rd:gate` encodes 8 pinned photos at tier 0 and
compares mean ΔE00 against `tools/comparison/baselines/rd-gate.json` with a
**two-sided** ±1% tolerance (an unexplained improvement also fails — a stale
baseline gates nothing), and asserts every hash is exactly 32 bytes. Wired into
`ci-comparison.yml`. The set gained a dark-skin portrait and a grayscale
photograph in the §9 revision, so the gate now covers the two inputs most likely
to expose a chroma-path regression; baseline mean 8.9043 (6 images) → **9.0933**
(8 images) → **8.8459** after §10 adopted the recipe. The middle step was
verified at 0.00% drift, which is what confirmed that every knob this round adds
defaults to byte-identical output; the last step is the −2.72% the gated set
moved by when those defaults changed.

**U19 — perceptual validation.** Two of the three gaps are now closed; the third
is still the most valuable thing left.

*Aspect blindness — closed.* §7.5 showed the harness could not see aspect-ratio
error at all, because every decode is stretched back into the reference frame
before scoring. `tools/comparison/src/aspect.ts` now measures it outside that
path, reporting `|log₂(AR_declared / AR_original)|` in §8.1's own percent
convention plus the reflow in CSS px for a 1000 px column. Two things had to be
got right for the number to mean anything. It cannot come from the decode's
reported dimensions: `decode_capped_to_with` caps per axis and the harness passes
the encoder input as that cap, so on a 3:2 photograph t3 and t4 report the cap's
100×67 rather than their own 128×84 and 256×168 — an error derived from that
would read ≈0 for exactly the tiers in question. And it measures the *render
grid*, which is coarser than the aspect byte: the byte is good to ±1.09%, but the
base grid rounds to integers at a 32 px long edge, so a 3:2 source lands on
32×21 = 1.5238. Measured on photographs, every tier reports an identical ~1.6%
against ThumbHash's ~7.8% — tier-invariance being a self-check, since §8.2 defines
the higher tiers as a bit shift of the already-rounded base.

*Artifact blindness — closed.* ΔE00, SSIMULACRA2, Butteraugli and DSSIM are all
aggregate fidelity scores; none separates *smooth but wrong* from *sharp with
artifacts*, which is the distinction that decides whether a downstream blur-up
rescues a placeholder. `tools/comparison/src/metrics/local.ts` measures ringing as
RMS excursion beyond the reference's local range, so a decode that is merely a
low-pass of the reference scores exactly zero. It gives §14's open question about
the decode-side synthesis window a number to move: on photographs, ringing climbs
monotonically with tier while every fidelity metric improves.

*Human-judgement validation — still open, and still the most valuable item.*
§8.5 shows three separate MSE-reducing changes moving ΔE00 the wrong way. The
metrics remain load-bearing and unaudited against human ratings; nothing above
changes that, and adding two more computed metrics arguably raises the stakes.

## 8. The optimized algorithm and its default parameters

What survived, in the form a spec revision would take. Everything below is
validated on the never-tuned holdout split with all four metrics improving.

### 8.1 Constants-level (every implementation must adopt these together)

**1. The AC layout becomes a per-tier table, not one base layout scaled by 4^tier.**
The measured count-vs-precision optimum moves with the budget (§4.2), so tier 0
wants coarser, more numerous coefficients than tiers 1–3. The byte anchors are
unchanged.

| Tier | bytes | shipped layout | **optimized layout** |
|---|---|---|---|
| compact (proposed, tier code 4) | **21** | — | **L 19 @ 4 b, a/b 6 @ 3 b** * |
| 0 | 32 | L 26 @ 5 b, a/b 9 @ 4 b | **L 28 @ 4 b, a/b 15 @ 3 b** |
| 1 | 108 | L 104 @ 5 b, a/b 36 @ 4 b | unchanged |
| 2 | 411 | L 416 @ 5 b, a/b 144 @ 4 b | unchanged |
| 3 | 1623 | L 1664 @ 5 b, a/b 576 @ 4 b | unchanged |

`54 + 28·4 + 2·15·3 = 256 bits` — tier 0 is still exactly 32 bytes.
`54 + 19·4 + 2·6·3 = 166 bits` → 21 bytes for the compact tier.

\* The compact layout is chosen on tune, where `L 19 @ 4 b` wins (11.023 vs
11.046). On holdout the 3-bit sibling `L 26 @ 3 b, a/b 6 @ 3 b` is better
(11.986 vs 12.107) — both beat ThumbHash on all four metrics, and the choice
between them should be re-made against the alpha-mode layout before a compact
tier is written down.
**Not yet measured:** the alpha-mode layout. The arithmetic points at
`L 22 @ 4 b, a/b 14 @ 3 b` at tier 0 (255 bits), but the photographic corpus has
no alpha, so this needs its own sweep before it is written down.

**2. Selection weights** `aniso = 1.2`, `sel_hv = 0.15` — key
`priority · (1 + 1.2·sin²2θ) · (1 + 0.15·cos2θ)`. Worth −1.03% on its own on
tune, and −0.34 pp of the holdout verdict (§7.12: −3.16% without them, −3.50%
with). This is the weakest of the three constants-level changes and the one the
corpus revision cut hardest (§7.4) — it is carried by the holdout result, not by
tune. **Blocker:** it is a float sort and costs **+32% decode time**; it needs
the integer reformulation `RATIONALE.md` already flags before it can be
normative. If the integer reformulation proves awkward, dropping `sel_hv` and
keeping the layout still clears the ≥3% rule (−3.16%).

**3. Everything else stays.** Aspect 8 b (§7.5 — narrowing it only looks free
because the evaluation is blind to aspect error), DC 7/7/7, scales 6/6/5 on the
linear grid, µ_L = 5 / µ_C = 8 (§4.6), no deadzone, no scalefactor bands, no
synthesis window.

### 8.2 Encoder-only (no decoder change; test vectors move, the format does not)

| Knob | Value | Why |
|---|---|---|
| `scale_fit` | **2** | The shipped encoder normalizes AC by the unquantized max\|AC\| while the decoder uses the rounded scale code. Mode 1 fixes the mismatch for free; mode 2 searches the code. −0.43% at 32 B, −1.8% at 411 B. |
| `ac_nearest` | **1** | Pick the code nearest in reconstruction rather than in the companded domain. Worth 0.05% — keep it because it is free and principled, not because it is large. |

**Optional high-effort mode** (~54× encode time, decode untouched):
`refine_passes=2 refine_grid=1 refine_obj=3 refine_wc=3 refine_dc=1 refine_scale=1`.
Worth a further −0.6 pp on holdout at tier 0 and −0.4 pp at tier 1. Offer it as
an encoder quality setting, not a default: 0.86 ms → 46 ms per image at tier 0.
If only one number is wanted, `refine_wc = 3` is the whole discovery — the
search was never the hard part, the objective was.

### 8.3 What that buys

Holdout, photographic corpus:

| | ΔE00 | SSIMULACRA2 | Butteraugli | DSSIM |
|---|---|---|---|---|
| shipped, 32 B | 11.554 | −304.5 | 29.27 | 0.2559 |
| optimized constants + encoder, 32 B | **11.150 (−3.50%)** | **−285.8** | **28.49** | **0.2550** |
| + optional refinement, 32 B | **11.079 (−4.12%)** | −284.5 | 28.45 | 0.2558 |
| shipped, tier 1 108 B | 9.435 | −169.1 | 22.86 | 0.2512 |
| optimized, tier 1 108 B | **9.281 (−1.63 pp)** | **−159.4** | **22.51** | **0.2505** |

**Equal-quality byte saving: the optimized 32-byte encode matches the shipped
format at 40 bytes** (holdout 11.150 vs 11.138) — 20%, or ~24% with refinement.

At the proposed 21-byte compact tier the format beats ThumbHash on **all four
metrics** on holdout (§7.6), which the shipped constants do not.

### 8.4 Rejected, with the number that rejected it

| Idea | Verdict |
|---|---|
| Pixel-SSE refinement (U1) | +0.8% ΔE00 despite −15…31% pixel SSE. Objective was wrong. |
| Closed-loop re-projection (U4) | Provably a fixed bias on an orthogonal basis; subsumed by U5. |
| Prefix narrowing (U8) | Best case +0.04 pp; the aspect "gain" is a metric artifact. |
| `b_scale_from_a` (U9) | +3.79%, fails guards. |
| Decoder detail synthesis (U12) | Every structural metric monotonically worse; +70% decode. |
| Per-image signalled selection (U13) | Oracle −1.59% vs best fixed, minus ~0.37% signalling. |
| Chroma-from-luma (U14) | +0.19% even with free, effectively-exact gains, at tiers 0–2. |

### 8.5 The meta-finding

Three independent levers — pixel-domain RDO (§7.1), chroma-from-luma (§7.10),
and the objective sweep (§7.2) — all reduced squared error and all failed to
improve ΔE00, in one case while measurably improving both the quantizer step and
the coefficient RMS. **At LQIP bitrates the MSE-domain is exhausted.** Everything
that paid this round paid by changing *where the bits go* (layout, selection
order) or by changing *what error means* (the perceptual objective), never by
minimizing squared error harder.

The corollary is uncomfortable and should be stated: every one of those
conclusions rests on ΔE00 with three guard metrics, and §7.5 showed the harness
is structurally blind to at least one real defect (aspect error). A human study
would be worth more than the next round of sweeps.

### 8.6 What the optimized recipe does to the cross-format positioning

> **Superseded by §11.14** for the same reason as §2, and because the alpha
> allocation and the compact tier both landed after it.

Holdout split, competitors from `rd-budget --split holdout`, ChromaHash rows
from `budget-ladder-optimized`/`final-candidates` (same corpus, same split, same
scoring config, same metric cache — the two runners share all of it).

| Bytes | Format | ΔE00 | SSIM2 | Butter | DSSIM |
|---|---|---|---|---|---|
| 21.1 | ThumbHash | 12.851 | −326.3 | 31.75 | 0.2589 |
| 21 | ChromaHash **shipped** | 12.611 | −349.2 | 33.04 | 0.2587 |
| 21 | ChromaHash **optimized** | **12.047** | **−323.2** | **30.52** | **0.2576** |
| 25.8 | RawRGB565 | 12.570 | −351.6 | 34.19 | 0.2585 |
| 32 | ChromaHash **shipped** | 11.554 | −304.5 | 29.27 | 0.2559 |
| 32 | ChromaHash **optimized** | **11.150** | **−285.8** | **28.49** | **0.2550** |
| 47.5 | RawRGB565 | 11.388 | −317.6 | 31.19 | 0.2555 |
| 47.8 | WebP | 15.570 | −406.0 | 37.87 | 0.2852 |
| 48 | ChromaHash **optimized** | **10.464** | **−231.2** | **25.32** | **0.2538** |
| 82.3 | lqip-modern r16 | 11.230 | **−183.3** | **23.86** | 0.2525 |
| 80 | ChromaHash **optimized** | **9.744** | −192.4 | 23.98 | **0.2515** |
| 107.3 | WebP | 10.255 | −167.5 | 22.91 | 0.2498 |
| 108 | ChromaHash shipped | 9.435 | −169.1 | 22.86 | 0.2512 |
| 108 | ChromaHash **optimized** | **9.281** | **−159.4** | **22.51** | **0.2505** |
| 128.6 | lqip-modern r24 | 10.223 | **−124.4** | **21.22** | **0.2487** |
| 405.7 | **WebP** | **7.289** | **−62.2** | **14.01** | **0.2285** |
| 411 | ChromaHash optimized | 7.604 | −76.3 | 17.76 | 0.2441 |

Two things move:

* **At 108 B ChromaHash now wins SSIMULACRA2 against size-matched WebP**
  (−159.4 vs −167.5), where the shipped constants lost it (−169.1). That
  reclaims the one guard the format was losing to a real codec at its own best
  budget. It does *not* generalize to lqip-modern: at 82 B lqip r16 still takes
  SSIMULACRA2 and Butteraugli (−183.3 / 23.86 against −192.4 / 23.98), and takes
  them by more from ~128 B. The reclaim holds on the tune split too, by a
  similar hair: WebP@107 B scores −155.1 against the optimized recipe's −153.1
  (`rd-budget --split tune`, `budget-ladder-optimized`).
* **The 21-byte compact tier beats ThumbHash on all four metrics**, which is the
  positioning claim the format could not previously make anywhere.

Unchanged: tiers 2–3 remain a rate–distortion loss. What did move with the
corpus is the upper ΔE00 crossover: WebP now draws level at ~190 B rather than
somewhere past 200 B, so the optimized recipe widens the format's strong region
from ~32–110 B to roughly **~20–110 B plus the 21 B tier**, and the region where
it leads *everything* ends sooner than round 1 claimed.


## 9. The corpus audit and revision (2026-08)

Round 1 and round 2 were measured on 26 curated Picsum photographs (22 tune /
4 holdout) plus the 24-image Kodak holdout suite. Everything above has been
re-measured on **39 curated photographs (31 tune / 8 holdout)** plus Kodak. This
section is the audit that motivated the change, what was added, and what moved.

### 9.1 What the old corpus could not see

The set was diverse *by subject* — coasts, forests, cities, food, animals — and
narrow along every axis the format is actually sensitive to.

| Axis | State of the 22-image tune split | Why it matters here |
|---|---|---|
| **Skin tone** | 3 portraits, all light-skinned. The one dark-skinned subject (`portrait-mother-child`) was in **holdout**, so no image the constants were tuned on contained dark skin. | The primary metric is a colour-difference metric and the chroma DC/AC ranges are what decide skin reproduction. A tuning set with one narrow skin locus cannot show a chroma allocation that is wrong for the others. |
| **Illuminant** | Daylight or dusk outdoors, plus two daylight flat-lays. No tungsten, no mixed interior, no artificially-lit interior at all. | Interior white points sit far off the daylight locus; the DC chroma ranges and the µ-law chroma curve are sized from corpus statistics. |
| **Key** | No high-key, white-background framing. | Product/e-commerce imagery — a first-class LQIP use case — is mostly high-key, where the DC dominates and clipping behaves differently. |
| **Chroma floor** | **No achromatic photograph.** Lowest mean chroma 0.014; nothing near zero. | 44% of the tier-0 AC payload is chroma. The case where the right answer is "spend none of it" was never scored, and the encoder's degenerate path (max\|AC\| = 0) was never exercised by a sweep. |
| **Spatial frequency** | Mostly smooth landscape gradients; little dense periodic man-made structure. | Selection order and count-vs-precision are decided by where the energy sits. |
| **Orientation** | 19 of 22 at 3:2 landscape, 1 portrait, 0 square. | Aspect and the render grid are format features; §7.5 already showed the harness is blind to aspect *error*, which makes orientation coverage the only lever left. |

### 9.2 What was added

Thirteen Picsum photographs (≥ 12 MP, SHA-256 content-pinned like the rest,
`tools/comparison/src/natural-images.ts`). Nine went to tune, four to holdout;
**no image moved out of holdout**, so the pre-registered validation rule is
intact.

| Label | Picsum id | Split | Axis it fills |
|---|---|---|---|
| `portrait-suit` | 856 | tune | Dark skin, high-key background, daylight |
| `portrait-guitarist` | 836 | tune | Dark skin, cluttered interior, mixed light |
| `portrait-dim-indoor` | 832 | tune | East-Asian skin, dim tungsten interior, low key |
| `natural-cafe` | 513 | tune | Interior, artificial + window light, people |
| `natural-typewriter` | 486 | tune | High-key product framing, near-neutral, **portrait orientation** |
| `natural-facade` | 945 | tune | **Grayscale**, dense periodic structure |
| `natural-snow-forest` | 730 | tune | Near-neutral, low contrast, high key |
| `night-bridge-lights` | 799 | tune | Night with saturated artificial (magenta/purple) lighting |
| `chroma-stripes` | 951 | tune | Flat saturated man-made paint, two-colour |
| `portrait-child-book` | 1010 | holdout | Dark skin, interior |
| `natural-shop` | 1059 | holdout | Interior retail clutter |
| `natural-piano` | 1082 | holdout | **Grayscale**, periodic structure |
| `natural-succulents` | 940 | holdout | Fine texture, **portrait orientation** |

The additions widen the difficulty spread in both directions rather than simply
making the corpus harder: at the shipped tier 0 they span ΔE00 2.11
(`chroma-yellow-wall`, the easiest image in the corpus) to 25.86
(`chroma-stripes`, the hardest by a wide margin), against a corpus mean of
10.18. Because one image now sits ~2.5× the mean, the **median** column of every
sweep is worth reading alongside the mean; the decisions in §8 hold on both.

Two measurement consequences of the grayscale images, both fixed rather than
papered over:

* `cfl-probe` scored an identically-zero chroma channel as "ρ = 0, residual
  100%", i.e. as evidence *against* chroma-from-luma, when the statistic is 0/0.
  It now excludes such a channel and says so (§4.8).
* `rd-gate` gained two images (`portrait-suit`, `natural-facade`) so the CI
  regression gate covers a dark skin tone and the degenerate chroma path.
  Baseline mean ΔE00 **8.9043 → 9.0933** over 8 images (and → 8.8459 once §10
  adopted the recipe); re-verified passing at
  0.00% drift with the working tree, which is also the check that the corpus
  change did not perturb the encoder.

### 9.3 What moved

| Measurement | Old corpus | Revised corpus | Verdict |
|---|---|---|---|
| Shipped tier 0, tune / holdout ΔE00 | 9.565 / 11.364 | 10.434 / 11.554 | Corpus is harder; **no cross-version number comparison is meaningful** |
| Best fixed 32 B layout | L28@4 C15@3 | L28@4 C15@3 | unchanged |
| §8 recipe on holdout | −3.51% | **−3.50%** | unchanged — still clears the pre-registered ≥3% |
| … with refinement | −4.14% | −4.12% | unchanged |
| 21 B vs ThumbHash (holdout) | −6.4% ΔE00, all four metrics | −6.3% ΔE00, all four metrics | unchanged |
| `aniso 1.2 + sel_hv 0.15` on tune | −2.09% | **−1.03%** | **halved** |
| Trainable selection-order headroom | +2.2 energy points | **+1.5** | **shrank** |
| Entropy coding, LOO | −9.1% | −8.7% | unchanged |
| Per-image oracle layout at 108 B | −1.1% | **−2.0%** | grew |
| WebP takes the ΔE00 lead at | 200–400 B | **~190 B** | crossover moved down |
| Precision optimum by budget | 3 b ≤ 20 B, 4 b to ~56 B, 5 b above | same, gains smaller at 16 B (−7.5% → −4.7%) | unchanged |

**Nothing was refuted and nothing was resurrected**: every accepted item in §8
still clears its bar, and every rejected item in §8.4 is still rejected, with
the same sign and comparable magnitude. The two results that changed materially
are both about the *trained selection order* (§7.4, §4.10), and they changed in
the direction the audit predicts: a corpus that is no longer predominantly
outdoor landscape has less of a single dominant orientation structure for a
fixed order to exploit. The lever survives — it is what carries the holdout
verdict from −3.16% to −3.50% — but it is half the size round 2 reported, and
on tune it now adds nothing on top of the retuned layout.

The one claim that genuinely weakened is the upper end of the operating range:
WebP draws level on ΔE00 at ~190 B rather than past 200 B, and at 108 B the
SSIMULACRA2 win over size-matched WebP is holdout-only (§8.6). The defensible
range in §3 is unchanged at its lower end and slightly tighter at the top.

### 9.4 Gaps that remain

The corpus is still a set of professional photographs from one source, and the
following are *not* covered by this revision:

* **Source bias.** Every curated image is Picsum/Unsplash — a professional
  aesthetic. No smartphone snapshots: no sensor noise, motion blur, harsh
  on-camera flash or heavy JPEG history, which is what a real LQIP pipeline
  ingests.
* **Non-photographic content** — screenshots, text-heavy graphics, logos,
  charts. The synthetic fixtures (`illust-*`, `textui-*`) exist but are excluded
  from every `photoOnly` sweep, so no constant has ever been chosen against
  them.
* **Alpha.** The photographic corpus has no transparency, so the alpha-mode
  layout in §8.1 is still unmeasured — flagged there, unchanged here.
* **Perceptual validation (U19).** Still the most valuable missing thing: this
  revision improved *what* is measured, not *whether the metric is right*.

## 10. Adoption: making §8 the default (2026-08)

§8 is now `Tunables::DEFAULT`, `spec/constants.py`, and the normative spec. This
section records what that took, because two of the four changes needed work that
the sweeps did not.

### 10.1 What shipped, and what did not

| §8 item | Shipped? | Where |
|---|---|---|
| Tier-0 layout `L 28 @ 4, a/b 15 @ 3` | **yes** | `LAYOUT_T0`; spec §3.2, §7.4 |
| Selection weights `aniso = 1.2`, `sel_hv = 0.15` | **yes** | spec §6.2 |
| `scale_fit = 2` (scale code by reconstruction SSE) | **yes** | spec §7.2 |
| `ac_nearest = 1` (nearest-reconstruction AC code) | **yes** | spec §7.3 |
| Optional refinement (`refine_*`) | no | §8.2 asks for an encoder quality setting, not a default: −0.6 pp for 54× encode time |
| 21-byte compact tier | no | §8.1's own footnote — tune and holdout disagree on its layout, and the choice should be made against the alpha-mode layout that does not exist yet |
| Alpha-mode tier-0 rebalance | no | never measured; the photographic corpus has no alpha (§9.4) |

Tiers 1–3 keep the 5-bit luma / 4-bit chroma split, so the layout is now a
**two-row table** (§3.2) rather than one base scaled by `4^tier`. That is the
literal reading of §8.1's first line, and `budget-ladder-optimized`/
`final-candidates` measured tier 1 exactly that way — weights and encoder knobs
on, layout untouched.

### 10.2 The blocker, resolved

§8.1 rejected the selection weights as normative on two grounds: the order was a
float comparison, and it cost **+32% decode time**. Both are gone.

**Integer reformulation.** The weight is
`(1 + aniso·sin²2θ)(1 + hv·cos2θ)`. With `s = (cx·H)²`, `t = (cy·W)²`,
`p = s + t` and `d = s − t`, the identities `cos2θ = d/p` and
`sin²2θ = 1 − (d/p)²` collapse *both* factors into polynomials in the single
ratio `d/p` — which is what makes an exact integer form possible at all. The
naive route (cross-multiplying the two rationals) needs 173 bits and is useless
to a JavaScript implementation; evaluating `d/p` once in Q12 and carrying the
weight in Q16 keeps every intermediate under **2^51** at every tier, so a
language with exact 53-bit integers computes it without a bignum. Spec §6.2.

Q12 is not a compromise: over all 256 aspect bytes at tier 0 the integer order
is **identical to the float order, coefficient for coefficient**, at every K the
format uses, and at tiers 1–2 it selects identical *sets* (it permutes within
them, which changes nothing a decoder can observe because encoder and decoder
share the order). `dct.rs::integer_selection_key_matches_the_real_valued_weight`
pins the first claim in CI; `spec/validate.py` and the 610 `unit-selection.json`
vectors — now emitted twice per `(W, H, K)`, once with the weights zeroed and
once with them on — pin the arithmetic across implementations.

**The +32% was never the weights.** It was the prototype recomputing a float key
inside the sort comparator, `O(n log n)` times. Computing the integer key once
per candidate, and sorting the candidate grid **once per (aspect, tier)** instead
of once per channel — every channel's selection is a prefix of the same list —
makes the shipped weighted decode ~8% *faster* than the unweighted v0.6 path it
replaces:

| decode, 32×32 natural render | ns/decode (3 runs) |
|---|---|
| v0.6: unweighted, one sort per channel | 391.6k / 395.8k / 399.8k |
| v1: weighted, one sort per (aspect, tier) | 356.8k / 318.0k / 348.4k |

> **What this table is, and is not.** It is an A/B of two decode implementations
> at one fixture, run to show that the +32% is gone — not a decode-latency figure.
> Mind the units: the `k` suffix is thousands of **nanoseconds**, so these cells
> are fractions of a millisecond, not the microsecond figures a decode-cost table
> reports.
>
> The candidate sort is **inside the timed region on both rows**, because it is
> inside the shipped decode: `SelectionOrder::new` is constructed on every
> `decode()` call (`rust/src/decode.rs`), and there is no selection cache in the
> crate. "Once per (aspect, tier)" means once per *decode* rather than once per
> *channel* — every channel's selection is a prefix of the same list — not
> memoization across calls. So the v1 row is the shipped path, and the ~8% is a
> like-for-like saving.
>
> It is also **unbound and ungated**: beyond a repeat count of three it names no
> host, no per-run iteration count and no warm-up, and §6 lists no command that
> reproduces it. `verify:experiments` does not check it — the table carries no
> binding, so the checking loop never reaches it; the note beside it
> (`"10.2#0": "decode timings, not a corpus measurement"`) is an audit trail
> printed by `--list-unbound`, not an exemption the gate enforces. Do not quote
> it as the cost of a decode. [`PERFORMANCE.md`](PERFORMANCE.md) §2
> is where decode cost lives, and its `decode/Rust/t1/natural` cell is what should
> replace this table once a re-measurement lands.

### 10.3 Verification

`adopted-defaults` runs the new `Tunables::DEFAULT` with **no overrides at all**
against a hand-reconstructed pre-adoption arm, and must reproduce the
`final-candidates` rows exactly — if it does, the default change is the measured
change and nothing else moved:

| | ΔE00 | Δ% | SSIM2 | Butter | DSSIM |
|---|---|---|---|---|---|
| holdout, tier 0, pre-adoption | 11.554 | — | −304.5 | 29.27 | 0.2559 |
| holdout, tier 0, **DEFAULT** | **11.150** | **−3.50** | **−285.8** | **28.49** | **0.2550** |
| holdout, tier 1, pre-adoption | 9.435 | — | −169.1 | 22.86 | 0.2512 |
| holdout, tier 1, **DEFAULT** | **9.281** | **−1.63** | **−159.4** | **22.51** | **0.2505** |
| tune, tier 0, pre-adoption | 10.434 | — | −268.0 | 29.19 | 0.2188 |
| tune, tier 0, **DEFAULT** | **10.183** | **−2.41** | **−263.1** | 29.19 | **0.2174** |

Every cell matches §8.3. The R-D gate baseline moves with it, 9.0933 → **8.8459**
(−2.72% over the 8 gated photos), and `spec/test-vectors/` was regenerated: the
hashes in `integration-*.json` and `unit-validate.json` change, which is the
point — the format's output moved.

### 10.4 What adoption exposed

* **The tier-0 and tier-1 rows now disagree on bit width**, so `4^tier` scaling
  no longer describes the whole ladder. Everything that assumed one base — the
  length formula, the decode pseudocode, `spec/validate.py`'s "AC payload scales
  ×4^tier" check — is now scoped to tiers 1–3.
* **`sel_hv` breaks portrait/landscape symmetry**, deliberately: `cos2θ` flips
  sign under the transpose, so a landscape image and its portrait mirror no
  longer select mirrored frequency sets. `validate.py` now *asserts* the
  asymmetry, so it cannot be quietly "fixed" back out.
* **`scale_fit` and `ac_nearest` are encoder-only but not optional.** The repo
  requires byte-identical output across implementations, so the search order and
  tie-breaking rule (`[0, −1, +1, −2, +2]`, strictly-better wins) had to become
  normative text, not encoder freedom. Spec §7.2, §7.3.
* **The pure-TypeScript decoder is not synced.** `typescript/src/decode.ts` has
  had no commit since before v1 landed — it still carries the v0.6 framing and
  layout — so it was already non-conforming before this change and is not made
  conforming by it. Every other binding is FFI over the Rust core and follows
  automatically. That port is its own piece of work.

## 11. Stabilizing v0.7 (2026-08)

§10 adopted the recipe §8 converged on. This section is the work of deciding
whether v0.7 can be called stable: every constant the format ships was either
re-derived on the current corpus and current bit depths, or measured for the
first time.

Three things made that possible and are worth stating before the results,
because each of them changed what a measurement means:

| Change | Why the numbers below could not be taken without it |
|---|---|
| **Two new corpora** (§11.0) | The alpha-mode layout cannot be measured on a corpus with no transparency, and no constant had ever been chosen against non-photographic content. |
| **Alpha scored as alpha** (§11.0) | Both sides were composited over opaque white before any metric ran, so alpha error was folded into colour error against one background. |
| **`forceOpaque` control** | The alpha corpus is cut-outs and line art — graphic-like content — and the graphics corpus independently prefers more luma. Without a control, "alpha mode wants a different layout" and "this content wants a different layout" are the same measurement. |

Every decision below is taken on the **tune** split. Holdout is consulted once,
at the end (§11.12), for the assembled candidate — repeatedly consulting it
would make it a second tune set.

### 11.0 What the measurements needed first

**The corpora.** 24 `cutout-*` images with real transparency (non-opaque
fraction 0.118–0.912, soft-edge fraction 0.000–0.293, so hard binary masks and
anti-aliased edges are both represented) and 24 `graphic-*` images (screenshots,
charts, maps, schematics, comics, dense text). Both content-pinned by SHA-256,
16 tune / 8 holdout, split by position in the sorted label list so the split
never depends on a result. The generated `alpha-*`, `illust-*` and `textui-*`
synthetic fixtures stay out of both: they are 8×8 correctness cases for a code
path, not content to tune against. The new prefixes sit outside
`CORPUS_PREFIXES`, so every photographic sweep still sees 31 tune / 32 holdout
images and no number in §1–§10 moves.

**Alpha scoring.** `ALPHA_BACKDROP` composited both sides over opaque white
before any metric ran. On a 32×32 near-white test image whose left half is fully
transparent, against a decode with alpha completely wrong (fully opaque):

| scoring | ΔE00 |
|---|---|
| white backdrop only | 6.06 |
| white + black + mid-grey | **17.49** |

The single white backdrop hides roughly two thirds of the error, so a layout
sweep scored that way is largely ranking colour. Alpha experiments below score
over three backdrops and additionally report a direct alpha-plane mean absolute
error (αMAE), which reads 0.5000 on the test above — arithmetically what a
half-wrong alpha channel should give.

### 11.1 The alpha-mode tier-0 layout — the shipped split is wrong

The opaque row was rebalanced to `L 28 @ 4 / C 15 @ 3` in §8; alpha mode still
carried v0.6's `L 20 @ 5 / C 9 @ 4` purely because nothing could measure it.
`sweeps/alpha-layout.json`, 34 layouts all at exactly 32 bytes, tune split. Every arm
pins the alpha AC allocation explicitly: a config that overrides only part of a layout
inherits the rest from the shipped default, so once §11.3 moved that default these arms
would have silently stopped being 32 bytes. It is the same class of drift the corpus pins
exist to prevent, in the knob space rather than the corpus, and it is worth stating
because a sweep that quietly changes budget mid-campaign reports a comparison nobody made.

| layout | ΔE00 | Δ% | paired 95% CI | win/n |
|---|---|---|---|---|
| **shipped** L20@5 C9@4 | 15.689 | — | — | — |
| L22@4 C14@3 (the arithmetic in §8.1) | 15.541 | −0.94% | [+0.053, +0.251] | 15/16 |
| L29@4 C9@3 | 15.497 | −1.22% | [+0.058, +0.353] | 12/16 |
| L36@3 C10@3 | 15.432 | −1.64% | [+0.093, +0.452] | 13/16 |
| **L43@3 C11@2** | **15.401** | **−1.84%** | [+0.107, +0.518] | 13/16 |

The shipped layout is significantly worse than a dozen alternatives, and the
direction is consistent: alpha mode wants **more luma coefficients at lower
precision, and much less chroma** than the opaque row does.

### 11.2 That direction belongs to alpha mode, not to the corpus

The alpha corpus is cut-outs and insignia. §11.4 finds that non-photographic
content independently prefers more luma, so the §11.1 result could be nothing
but a statement about cut-outs. `sweeps/alpha-layout-control.json` re-runs the
grid on the **same images**, flattened to opaque and encoded in the format's
opaque mode:

| layout | opaque mode (control) | alpha mode (§11.1) |
|---|---|---|
| v0.6 shape L26@5 C9@4 | 15.180 (base) | — |
| **the photographic winner** L28@4 C15@3 | **14.673 (−3.34%)** | — |
| L35@3 C16@3 | 14.583 (−3.93%) | — |
| L46@4 C2@3 (chroma-starved) | 15.085 (−0.63%) | — |
| L39@4 C2@3 (chroma-starved) | — | 15.500 (−1.20%) |

In opaque mode on this content the photographic layout is near-best and
chroma-starved layouts are *mediocre*. In alpha mode the same chroma-starved
layouts *win*. The shift is a property of alpha mode: transparent regions are
composited away, so chroma spent on them buys nothing.

### 11.4 Non-photographic content — the photographic constants hold

No constant in this format had ever been chosen against a screenshot, a chart
or a page of text. `sweeps/graphics-layout.json` re-runs the same 32-byte
allocation grid that chose the tier-0 layout (§4.2) on the graphics corpus,
with the adopted default as incumbent; `sweeps/graphics-encoder.json` does the
same for the encoder stack. Both run with `forceOpaque`, because two of the 16
tune images carry real transparency and would otherwise encode in alpha mode,
where none of an opaque-layout arm's overrides apply — contributing an identical
constant to every arm and diluting every delta, which biases a layout test
toward exactly the "no difference" verdict it is trying to test for.

**Layout.** The photo-derived `L 28 @ 4 / C 15 @ 3` is not the graphics
optimum, but it is close to it and the gap does not justify a second constant:

| layout | ΔE00 | Δ% | paired 95% CI |
|---|---|---|---|
| **DEFAULT** L28@4 C15@3 | 10.450 | — | — |
| pre-adoption L26@5 C9@4 | 10.569 | +1.14% | [−0.300, +0.022] |
| L30@4 C13@3 | 10.394 | −0.54% | [+0.008, +0.102] |
| L40@4 C7@3 | 10.344 | −1.01% | includes zero |

Exactly one arm reaches significance, by 0.54%. Graphics wants slightly more
luma and less chroma — the same direction as alpha mode, for the same reason
that structure matters more than colour in synthetic content — but at a
magnitude that does not warrant splitting the constant.

**The encoder stack generalizes.** This is the stronger result: every part of
the §8 adoption was chosen on photographs, and it holds on content it never saw.

| variant | ΔE00 | Δ% | paired 95% CI |
|---|---|---|---|
| **DEFAULT** (full stack) | 10.450 | — | — |
| no selection weights | 10.513 | +0.60% | [−0.229, +0.076] |
| no encoder search (`scale_fit=0 ac_nearest=0`) | 10.577 | +1.22% | **[−0.228, −0.039]** |
| pre-adoption (everything off) | 10.766 | **+3.02%** | **[−0.597, −0.114]** |
| `sel_hv = 0.30` | 10.410 | −0.39% | includes zero |

Turning the adoption off costs 3.02% on graphics, significantly. Note the last
row: graphics independently prefers `sel_hv = 0.30` over the shipped `0.15`,
which is the same direction §11.5 finds on photographs.

### 11.5 The selection weights, re-derived — and `sel_hv` is not optimal

`aniso-selection` and `aniso-extended` could not answer this any more. Both
labelled their incumbent "default (isotropic)", which stopped being true the
moment `aniso = 1.2` / `sel_hv = 0.15` were adopted: every delta in them was
measured against the *new* default while claiming the old one. Re-run today they
report `aniso=1.2` as 0.00% different from "isotropic", which is the tell.
`sweeps/selection-weights.json` replaces them with the full 2-D grid, the
adopted pair as incumbent and an explicit isotropic arm.

| variant | ΔE00 | Δ% | paired 95% CI | win/n |
|---|---|---|---|---|
| **DEFAULT** aniso 1.2 / hv 0.15 | 10.183 | — | — | — |
| isotropic (aniso 0, hv 0) | 10.161 | −0.21% | [−0.061, +0.117] | 15/31 |
| **aniso 1.2 / hv 0.30** | **10.100** | **−0.81%** | **[+0.006, +0.164]** | 18/31 |
| aniso 2.0 / hv 0.30 | 10.126 | −0.56% | includes zero | 16/31 |
| aniso 1.2 / hv −0.15 | 10.281 | +0.97% | **[−0.199, −0.008]** | 11/31 |
| aniso 1.2 / hv −0.30 | 10.383 | +1.97% | **[−0.315, −0.085]** | 7/31 |
| aniso 3.2 / hv 0.0 | 10.321 | +1.36% | **[−0.234, −0.047]** | 9/31 |

Three findings, and two of them are uncomfortable:

1. **`sel_hv = 0.30` is significantly better than the shipped `0.15`** —
   the largest positive-direction arm whose CI excludes zero. (`aniso 0.9 /
   hv 0.15` also clears zero, at −0.07% with 4/31 wins — real but too small to
   act on.) §11.4 finds the same *direction* on the graphics corpus, though not
   significantly there. The adopted value is not the tune optimum.
2. **Isotropic is statistically indistinguishable from the adopted weights.**
   On the current corpus the selection weights buy nothing measurable on tune;
   their justification rests entirely on the holdout delta §7.12 recorded
   (−3.16% without them, −3.50% with). §8.1 already called them "the weakest of
   the three constants-level changes"; this is weaker still.
3. **The sign is real.** Negative `hv` is significantly worse, and large `aniso`
   without `hv` is significantly worse. The weights are not noise — the
   *magnitude* the format shipped is simply not where the optimum is.

### 11.6 µ-law companding, re-derived — stands

`sweeps/companding-family.json`, now pinned to `corpus: "photo"` and re-run at
the 4 b/3 b tier-0 depths rather than the 5 b/4 b depths it was locked against.

| family | ΔE00 | Δ% |
|---|---|---|
| **µ-law µ_L=5 / µ_C=8 (shipped)** | 10.183 | — |
| µ_L=7 | 10.168 | −0.14% |
| µ_C=12 | 10.204 | +0.21% |
| A-law 87.6 (G.711) | 10.476 | +2.88% |
| power-law 0.75 (AAC/MP3) | 10.267 | +0.83% |
| power-law 0.9 | 10.366 | +1.80% |
| Lloyd-Max L+C (trained on this corpus) | 10.335 | +1.49% |

Every alternative family is worse, including codebooks trained on the corpus
being scored. The µ plateau §4.6 reported survives both the corpus revision and
the bit-depth change: every µ_L ∈ {4…7} lands within ±0.14% of the shipped µ_L = 5.

### 11.7 Deadzone, re-derived — and it was measuring nothing

`sweeps/deadzone.json`. The first re-run reported every arm byte-identical to
the base. That was not a
result: adopting `ac_nearest = 1` had silently killed the knob. The deadzone
forces a small coefficient to the exact-zero centre code, and the ±2
reconstruction search then runs on that code — for a small value the
nearest-reconstruction code is always inside ±2, so the search undid every
deadzone decision it was handed. The encoder produced identical bytes at
`deadzone_l` = 0, 0.05 and 0.2.

A fired deadzone now short-circuits the search, and the knob measures again:

| variant | ΔE00 | Δ% |
|---|---|---|
| **no deadzone (shipped)** | 10.183 | — |
| `deadzone_l = 0.02` | 10.183 | 0.00% |
| `deadzone_l = 0.05` | 10.220 | +0.36% |
| both = 0.03 | 10.184 | +0.02% |

Rejected — now on evidence rather than on an artifact.

Three arms still read exactly 0.00%, and for a real reason rather than the old
one: the quantizer's zero bin is already wider than those deadzones, so nothing
falls inside them. The bin scales with the code width, so the threshold differs
per channel — luma is 4-bit at tier 0 and chroma 3-bit, and chroma's bin is
correspondingly wider. Sweeping past it confirms the knob is live on both
channels: `deadzone_c` first moves the output at 0.15, and moves it further at
0.4. The rejection stands on the arms that do fire.

A knob that cannot move the output is worse than a rejected one, because the
next sweep to touch it draws a conclusion from a constant.

### 11.8 Quantization ranges, re-derived — stand

`sweeps/quant-ranges.json`: `max_l_scale` ∈ {0.35, 0.5, 0.65}, `max_a/b_scale`
∈ {0.1, 0.125, 0.15}. Every arm lands within **±0.13%** of the shipped values
and every guard holds. The ranges are sized to the signal, as `RATIONALE.md`
claims; the claim now rests on the current corpus.

### 11.9 Scalefactor bands, re-derived — still below threshold

`sweeps/scalefactor-bands.json`: the best arm (`band_gain_l = 0.7`, high-band
luma scaled down) is worth **−0.30%**, consistent with the −0.52% at tier 1
`RATIONALE.md` records. Real, small, and it costs a signalled band split it
cannot pay for. Not adopted; unchanged from the previous verdict.

### 11.10 The compact tier — a plateau, tie-broken across corpora

§8.1 proposed a 21-byte tier and left its layout open, noting that tune and
holdout disagreed (`L 19 @ 4` vs `L 26 @ 3`). `sweeps/compact-tier.json`
measures 15 layouts, all at exactly 21 bytes, at tier 0 with raw layout
overrides — the same way §7.6 measured it, so the layout is decided before a
tier code is spent on it.

| layout | ΔE00 | Δ% vs shipped shape | paired CI vs the leader |
|---|---|---|---|
| shipped shape L13@5 C6@4 | 11.419 | — | **[−0.710, −0.262]** |
| **L18@4 C7@3** | **10.947** | −4.13% | (leader) |
| L19@4 C6@3 | 10.963 | −3.99% | [−0.088, +0.040] |
| L16@4 C8@3 | 10.982 | −3.83% | [−0.203, +0.110] |
| L24@3 C7@3 | 10.989 | −3.76% | [−0.150, +0.074] |
| L20@4 C5@3 | 10.990 | −3.76% | [−0.160, +0.046] |
| L35@3 C2@2 (count-maximal) | 11.367 | −0.45% | **[−0.648, −0.186]** |
| L19@5 C2@4 (precision-maximal) | 11.355 | −0.56% | **[−0.607, −0.230]** |

The extremes are decisively rejected and the shipped shape is decisively beaten
— by 4.13% — but **the leading seven layouts are a plateau**: every paired CI
against the leader includes zero. The photographic split cannot choose here, and
squeezing its guard metrics for a winner would be mining noise.

So the tie is broken on new information rather than on a second look at the same
data: which candidate holds up on the graphics corpus, which a compact tier will
also be asked to carry (`sweeps/compact-tier-graphics.json`).

| layout | photo rank | graphics ΔE00 | graphics rank | rank sum |
|---|---|---|---|---|
| **L19@4 C6@3** | 2 | 10.855 (−2.78%) | 3 | **5** |
| L20@4 C5@3 | 5 | 10.783 (−3.43%) | 1 | 6 |
| L18@4 C7@3 | 1 | 10.917 (−2.22%) | 7 | 8 |
| L24@3 C7@3 | 4 | 10.885 (−2.52%) | 5 | 9 |
| L26@3 C6@3 | 8 | 10.813 (−3.16%) | 2 | 10 |
| L16@4 C8@3 | 3 | 11.060 (−0.94%) | 8 | 11 |

`L 19 @ 4 b, a/b 6 @ 3 b` is the most robust across both bodies of content —
and it is the layout §8.1 chose on tune, arrived at independently.

> **Superseded.** The paragraph below records the code-4 placement as it was
> built. It did not ship that way: `f6417d3` reordered the tier codes by quality before
> release, so the compact tier is code **0**, `MAX_TIER` is 4, and
> `render_level(tier) = tier.saturating_sub(1)` needs no special case. The
> reasoning below — that shifting by the raw tier code is the hazard, and that
> `MAX_TIER` must keep meaning "highest *quality* tier" — is what carried over
> and is why the renumbering was safe. `RATIONALE.md` ("Tier codes ordered by
> quality") records why code 4 was rejected.

**Implementation.** The compact tier is code 4, taken from the formerly-reserved
`4..=7` range, so a v1 decoder written before it existed rejects it rather than
mis-decoding it. It renders at tier 0's resolution and scales coefficient counts
by 1.

That last sentence is the whole hazard. Code 4 is numerically *above* tier 3 and
*below* tier 0 in quality, and two places shifted by the raw tier code —
`decode_output_size` (`w << tier`) and `tier_count_scale` (`1 << 2·tier`) —
which would have made "compact" a 512 px render at 256× the coefficients. Both
now shift by a `render_level(tier)` that maps code 4 to level 0. `MAX_TIER`
keeps meaning "highest *quality* tier" and validation moves to `is_valid_tier`.

The distinction was already load-bearing: two tests built their invalid-tier
fixture as `MAX_TIER + 1`, which is now the compact tier. One of them is in the
shared cross-language vectors, where it had been asserting `InvalidTier` and
began failing with `LengthMismatch` — a parity vector quietly testing the wrong
thing. `unit-validate.json` now pins `valid_compact` and `valid_compact_alpha`
too, so an implementation that rejects code 4 outright is caught by the gate.

### 11.3 The alpha channel is starved — the largest result of this round

The alpha field widths were never tunable, so this had never been asked.
`sweeps/alpha-fields.json` asks it, trading each field against luma so every arm
stays at exactly 32 bytes:

| variant | ΔE00 | Δ% | αMAE | guards |
|---|---|---|---|---|
| **shipped** alpha DC 5 b, scale 4 b, AC 5 @ 4 b | 15.689 | — | 0.2625 | — |
| alpha DC 4 b (−1) | 15.708 | +0.12% | 0.2623 | ok |
| alpha scale 3 b (−1) | 15.677 | −0.08% | 0.2613 | ok |
| **A 8 @ 4** (+3 coefficients, −3 luma) | 14.884 | **−5.13%** | 0.2316 | ok |
| **A 12 @ 4** (+7 coefficients, −6 luma) | 14.465 | **−7.80%** | 0.2139 | ok |
| A 3 @ 4 (−2 coefficients) | 17.005 | +8.39% | 0.3030 | FAIL |
| A 0 (no alpha AC at all) | 19.428 | **+23.84%** | 0.3812 | FAIL |

The field *widths* are asymmetric. Taking a bit *off* is noise — ±0.12% on the
DC and scale — but adding one costs an alpha coefficient and is not: `dc 6b`
scores +4.28% and `scale 5b` +4.06%, both failing guards. Narrowing is free;
widening is not, on the DC and scale
codes. The **count** is not. Five AC coefficients cannot describe a silhouette,
and a silhouette is what a cut-out placeholder mostly is. Removing them costs
24%; adding seven buys 7.8%, more than the entire §8 adoption bought at tier 0.

`sweeps/alpha-ac-count.json` and `sweeps/alpha-ceiling.json` follow the ladder
to the point where the budget runs out. It is monotone for a long way:

| allocation | ΔE00 | Δ% | SSIM2 | Butter | αMAE |
|---|---|---|---|---|---|
| shipped A5@4 L20@5 C9@4 | 15.689 | — | −393.8 | 57.38 | 0.2625 |
| A12@4 L18@4 C9@4 | 14.348 | −8.54% | −374.2 | 50.95 | 0.2139 |
| A20@4 L20@5 C1@4 | 13.526 | −13.79% | −356.2 | 46.63 | 0.1777 |
| **A28@3 L22@4 C3@3** | **13.005** | **−17.10%** | **−339.9** | 44.48 | 0.1632 |
| A40@3 L13@4 C3@3 | 12.906 | −17.74% | −344.8 | 43.38 | 0.1515 |
| A48@3 L7@4 C3@3 | 12.885 | −17.87% | −349.1 | 43.34 | 0.1423 |
| A32@2 L24@4 C5@3 | 13.880 | −11.53% | −366.1 | 61.43 | **FAIL** |

Three things fall out.

1. **Alpha needs at least 3 bits per coefficient.** Every 2-bit arm fails the
   Butteraugli guard (58.7–64.6 against 42.9–45.3), whatever the count.
2. **The coefficients are better bought from chroma than from luma.**
   `A20@4 L20@5 C1@4` beats `A20@4 L10@4 C9@4` (13.526 vs 13.619) while keeping
   the full luma budget: transparent regions are composited away, so chroma
   spent on them buys nothing. Holding the alpha count fixed, shrinking chroma is
   near-free: across every C3-vs-C5 pair the mean difference is under 0.05 ΔE00
   and the largest single-image difference is 0.59 (`cutout-navy-crest`), against
   a 15.7 ΔE00 baseline. It is not strictly monotone — at `A12@4` and `A16@4`
   the C5 arm edges the C3 one by 0.008 and 0.029 — and no pair isolates chroma,
   since every C3→C5 swap also moves luma to keep the budget. The honest reading
   is that chroma is nearly inert here, not that less of it is always better.
3. **The mean hides a trade, and the trade decides the constant.**

| allocation | all | mostly opaque (<35% transparent) | mostly transparent |
|---|---|---|---|
| A28@3 L22@4 C3@3 | −17.10% | **−7.42%** | −22.60% |
| A32@3 L19@4 C3@3 | −17.19% | −6.79% | −23.09% |
| A40@3 L13@4 C3@3 | −17.74% | −5.68% | −24.58% |
| A48@3 L7@4 C3@3 | −17.87% | −3.86% | −25.82% |

Pushing the alpha count higher buys transparent images at the expense of opaque
ones, and the mean is driven by this corpus being three-quarters transparent —
a property of the corpus, not of the world. **`A 28 @ 3 b, L 22 @ 4 b,
a/b 3 @ 3 b`** is adopted: it takes −17.10% overall while giving the at-risk
opaque-ish subgroup the largest gain of any **guard-passing** arm (three 2-bit
arms score higher there — −7.5% to −8.5% — but all three fail Butteraugli),
posts the best SSIM2 of the whole sweep, and carries *more* luma than the layout it replaces (22 vs 20).
Choosing the ΔE00-optimal corner instead would trade 0.8 pp of mean for 3.6 pp
of the subgroup most exposed to a different corpus mix.

Not a corpus artifact, checked two ways. **Every one of the 16 images improves**,
including those only 15–22% transparent. And §11.2's control shows the direction
belongs to alpha mode rather than to cut-out content.

**The alpha channel also ran a generation behind the others.** L, a and b go
through `quantize_ac_channel`, where `scale_fit` and `ac_nearest` live; alpha
used a bare per-coefficient quantize against a nominal scale code, the v0.6
path. Routing it through the same code (`alpha_ac_fit`) is worth −0.21% on the
shipped layout and −0.22% on a better one, guards clean
(`sweeps/alpha-encoder.json`).

The knob has to be read against a fixed layout. The row
`alpha_ac_fit @ L22@4 C14@3` is −1.16% against the *shipped* incumbent, but
−0.94 pp of that is the layout and only −0.22 pp is the knob: quoting the
combined figure would overstate it fivefold. Small, free and principled — the
same argument that adopted `ac_nearest` at 0.05% — which is exactly why
§11.12's holdout result gets to overrule it.

### 11.11 Does the alpha finding hold above tier 0?

It has to be asked rather than assumed. Tiers 1–3 share one base row scaled by
`4^(tier−1)` (§3.2), so adopting §11.3 at tier 0 and leaving that row alone
would give **tier 1 fewer alpha coefficients than tier 0** — a higher quality
tier that is worse at the thing that matters most for a cut-out. The tier-1
base budget is the same 192 bits as tier 0's alpha budget, so
`sweeps/alpha-tier1.json` is the same allocations evaluated at 4× resolution.

One arm in that file is **off-budget** and is excluded from the comparison
below: `A20@4 L20@5 C1@4` at 106 B, against the 103–104 B the rest occupy. It
posts the best raw ΔE00 in the file (10.768) and the best SSIMULACRA2 and
Butteraugli, which is what 2–3 extra bytes buys; it is not an equal-budget
result and is not treated as one. (It does *not* take DSSIM — `A16@4 L14@4 C9@4`
does, 0.22150 against 0.22193.) This is the drift `expectBytes` now catches.

| allocation | tier-1 ΔE00 | Δ% | SSIM2 | Butter | αMAE |
|---|---|---|---|---|---|
| shipped A5@4 L20@5 C9@4 | 12.332 | — | −278.0 | 41.89 | 0.1775 |
| A24@3 L22@4 C5@3 | 10.852 | −12.00% | −234.5 | 33.85 | 0.1216 |
| **A28@3 L22@4 C3@3** (the tier-0 choice) | **10.859** | **−11.95%** | −233.5 | 33.93 | 0.1185 |
| A32@3 L19@4 C3@3 | 10.872 | −11.84% | −240.7 | 34.71 | 0.1164 |
| A20@3 L28@4 C3@3 | 10.899 | −11.63% | −224.5 | 34.01 | 0.1240 |
| A16@4 L14@4 C9@4 | 10.987 | −10.91% | −266.4 | 34.07 | 0.1213 |
| A40@3 L13@4 C3@3 | 11.153 | −9.56% | −270.3 | 36.57 | 0.1147 |

Among the equal-budget arms the tier-0 choice is essentially tied for best at
tier 1 — 0.06% behind `A24@3 L22@4 C5@3` — so **one row still serves tiers
1–3** and the `4^(tier−1)` structure is intact. Alpha AC counts are now 16 / 28 / 112 / 448 / 1792 across
compact / 0 / 1 / 2 / 3 — monotone, which `validate.py` asserts.

### 11.12 The holdout, consulted once

Every decision above was taken on tune, with holdout untouched until they were
all frozen. It rejected half of them.
`sweeps/v07-holdout-photo.json` and `sweeps/v07-holdout-alpha.json`, both run
with `--split holdout`.

**Photographic holdout (32 images):**

| candidate | tune | holdout | verdict |
|---|---|---|---|
| `sel_hv` 0.15 → 0.30 | −0.81%, CI excluded zero | **+0.69%** | **rejected** |
| isotropic weights | −0.21% | +0.60%, guards fail | rejected |
| pre-adoption v0.6-derived | +2.47% | +3.63% | (confirms §8 out of sample) |
| compact 21 B `L19@4 C6@3` | −3.99% | −2.6% vs the shipped shape | adopted |

Holdout ranks the compact plateau differently from tune — `L26@3 C6@3` leads it
at 11.971 against the adopted layout's 12.047 — which is the same tune/holdout
disagreement §8.1 originally flagged for this tier. The pick was frozen before
the holdout was opened and is not revisited on it; the spread across the four
candidates is 0.9%, and all four beat the shipped shape by 2.3–3.2%.

`sel_hv = 0.30` was significant on tune, and pointed the same way on the
graphics corpus (§11.4 — −0.39% there, though its CI includes zero), and it
still failed out of sample. The shipped `0.15` stands. This is the split doing
exactly the job it exists for: a result that was significant on one corpus and
directionally agreed with on a second did not survive a third split.

**Alpha holdout (8 images):**

| candidate | tune | holdout | verdict |
|---|---|---|---|
| **A28@3 L22@4 C3@3** | −17.10% | **−16.19%**, every guard improving | **adopted** |
| `alpha_ac_fit` | −0.21% | +0.09% | **rejected** |
| A28@3 + `alpha_ac_fit` | — | −14.48% (worse than without) | rejected |
| compact alpha A16@3 L12@4 C1@3 | −13.00% | −6.96%, guards ok | adopted |

The alpha allocation validates emphatically: SSIMULACRA2 −307.2 → −242.7,
Butteraugli 57.56 → 44.36, DSSIM 0.2319 → 0.2179, αMAE 0.2696 → 0.1675.

`alpha_ac_fit` does not, and is left at `false`. It is principled and free, and
it measured −0.21% on tune — but out of sample it is +0.09% alone and makes the
adopted allocation *worse* in combination. The knob stays for a future
measurement; the default does not move on a result that will not replicate.

**The compact tier's positioning claim, on holdout:**

| | bytes | ΔE00 ↓ | SSIM2 ↑ | Butter ↓ | DSSIM ↓ |
|---|---|---|---|---|---|
| ThumbHash | 21.1 | 12.851 | −326.3 | 31.75 | 0.2589 |
| **ChromaHash compact** | **21** | **12.047** | **−323.2** | **30.52** | **0.2576** |

Beaten on all four metrics, out of sample, at ThumbHash's own size — the claim
§8.6 wanted and the shipped constants could not previously make anywhere.

### 11.13 What v0.7 stabilization changed, and what it did not

| Change | Evidence |
|---|---|
| Alpha row → `L 22 @ 4, a/b 3 @ 3, A 28 @ 3` at tier 0 and the tier-1..3 base (the compact tier takes its own, below) | −16.19% holdout, all guards (§11.3, §11.11, §11.12) |
| Compact tier, code 4, 21 B, `L 19 @ 4 / a/b 6 @ 3` (alpha `L 12 @ 4 / a/b 1 @ 3 / A 16 @ 3`) | Beats ThumbHash on all four on holdout (§11.10, §11.12) |
| Deadzone made reachable again | It was byte-identical at every value (§11.7) |

Deliberately unchanged, each with the number that left it alone:

| Kept | Why |
|---|---|
| `sel_hv = 0.15` | 0.30 was better on two tune corpora and **worse on holdout** (§11.12) |
| `aniso_oblique = 1.2` | Isotropic is statistically indistinguishable on tune and worse on holdout (§11.5, §11.12) |
| µ-law µ_L = 5 / µ_C = 8 | Every alternative family is worse, including corpus-trained codebooks (§11.6) |
| No deadzone | +0.36% once the knob could move the output (§11.7) |
| Quantization ranges | Every arm within ±0.13% (§11.8) |
| No scalefactor bands | −0.30%, below threshold and unable to pay its signalling (§11.9) |
| Tier-0 opaque layout | Holds on non-photographic content; no candidate significantly better (§11.4) |
| `alpha_ac_fit = false` | −0.21% on tune, +0.09% on holdout (§11.12) |

What is still not measured, and is now the honest list for v0.8:

* **Perceptual validation (U19).** Unchanged and still the most valuable missing
  thing. Every number in this file is metric-based, and §11.12 is a fresh
  reminder that a metric that agrees with itself across two corpora can still
  fail on a third split.
* **Tiers 2–3 alpha**, inherited from the tier-1 measurement rather than
  measured directly.
* **Smartphone-source photographs** — sensor noise, motion blur, heavy JPEG
  history. Both photographic corpora are professional captures.
* **Entropy-coded AC** (−4.3%), which remains refused on the fail-fast O(1)
  length check rather than on its quality (§7.13).

### 11.14 Cross-format positioning, re-measured against the shipped constants

The tables in §2 and §8.6 were taken before v0.7 and are kept as the record of
those rounds. These are the current figures, and they are the first ones in this
file taken with `rd-budget` running the **shipped tiers** at the shipped byte
anchors rather than a layout synthesized to fill the budget.

That distinction mattered. `allocate()` builds a 5 b/4 b layout — the pre-v0.7
shape — so every previous ChromaHash row in a cross-format table was the old
constants under the current name. At 21 B on holdout the synthesized row loses
SSIMULACRA2 (−342.2) and Butteraugli (32.60) to ThumbHash; the shipped compact
tier wins both. Off-anchor budgets are still synthesized and are now labelled
`(resized)`.

**Holdout split (32 photographs).** Bold marks the leader in a byte
neighbourhood.

| Bytes | Format | ΔE00 ↓ | SSIM2 ↑ | Butter ↓ | DSSIM ↓ |
|---|---|---|---|---|---|
| 21.1 | ThumbHash | 12.851 | −326.3 | 31.75 | 0.2589 |
| **21** | **ChromaHash compact** | **12.047** | **−323.2** | **30.52** | **0.2576** |
| **32** | **ChromaHash tier 1** (default) | **11.150** | **−285.8** | **28.49** | **0.2550** |
| 47.8 | WebP | 15.570 | −406.0 | 37.87 | 0.2852 |
| 62.3 | lqip-modern r8 | 13.275 | −315.4 | 31.08 | 0.2582 |
| 63.5 | WebP | 12.198 | −259.5 | 27.47 | 0.2556 |
| 79.5 | WebP | 11.085 | −203.5 | 24.72 | 0.2534 |
| 82.2 | lqip-modern r16 | 11.230 | **−183.3** | **23.86** | 0.2525 |
| 107.2 | WebP | 10.255 | −167.5 | 22.91 | **0.2498** |
| **108** | **ChromaHash tier 2** | **9.281** | **−159.4** | **22.51** | 0.2505 |
| 128.6 | lqip-modern r24 | 10.223 | −124.4 | 21.22 | 0.2487 |
| 188.3 | WebP | 8.763 | **−93.7** | **18.33** | **0.2410** |
| 193 | ChromaHash *(resized)* | **8.435** | −110.6 | 20.33 | 0.2476 |
| 262.3 | lqip-modern r48 | 8.132 | −66.7 | 15.64 | 0.2351 |
| 405.7 | **WebP** | **7.289** | **−62.2** | **14.01** | **0.2285** |
| 411 | ChromaHash tier 3 | 7.604 | −76.3 | 17.76 | 0.2441 |

Four things this settles.

1. **The compact tier beats ThumbHash on all four metrics at its own size**,
   out of sample. That is the positioning claim §8.6 wanted and no shipped
   constant set had previously been able to make.
2. **No general codec reaches these budgets.** WebP's smallest usable output on
   this corpus is ~48 B and it scores 15.570 there — worse than ChromaHash at
   **12 bytes**. Between 12 and 48 bytes the comparison set is other LQIPs and
   raw pixels, and ChromaHash leads all of them.
3. **Code 2 (108 B) is the format's strongest point.** It beats size-matched
   WebP on ΔE00 by 9.5% *and* takes SSIMULACRA2 and Butteraugli, losing only
   DSSIM by 0.0007. It also beats lqip-modern at 129 B while being 20 B smaller.
4. **WebP takes the structural guards from ~190 B up, but not ΔE00 until
   later.** At ~190 B WebP leads SSIMULACRA2, Butteraugli and DSSIM while
   ChromaHash still leads ΔE00 (8.435 vs 8.763); the ΔE00 crossover is between
   193 and 411 B, where WebP leads all four. The same ordering holds on tune
   (7.737 vs 7.868 at ~190 B). §14.1 of the spec states this rather than
   arguing around it.

The structural weakness §2 identified is narrowed but not gone: lqip-modern
still takes SSIMULACRA2 and Butteraugli at ~82 B, where ChromaHash wins ΔE00 by
13%. The format still buys colour accuracy with structural accuracy; it now does
so over a wider range and loses the trade later.


## 12. Round 4: the instruments, and the window (2026-09)

This round adds no constant. It adds two things the file needed before it could
add another: a metric that can see the artifact the format is actually accused
of, and a decode path that can tell the format's own reconstruction apart from
the browser's interpolation of it. Then it uses both on the one lever §5 listed
that has never been refuted with a number.

> **These numbers are on the Wikimedia corpus** (`85f6af3`), which §1–§11 are
> not. Every table above still describes the retired Picsum set; the CHANGELOG
> says so and §6 has not been re-run. Nothing here is compared to a number from
> those sections. Each table below is a self-contained sweep with its own
> incumbent, which is what makes it readable anyway — guards, Δ% and the paired
> CI are all measured *within* the run.

### 12.1 Ringing could not see the artifact, and no sweep could see ringing

Two gaps, and they compound.

`metrics/local.ts` measures overshoot: error escaping the reference's local
`[min, max]`. That is what makes a blur score exactly zero, and it is also a
hard ceiling on what it can detect. A ripple oscillating *inside* the envelope
scores zero. So does a broad wave over a textured region, and so does a
directional stripe. Away from hard edges, those are precisely what a
truncated-cosine reconstruction produces — and they are what a reader means when
a placeholder "looks textured" rather than merely blurry.

And no sweep computed it regardless. `sweep.ts` builds its scoring config
without the flag, so **every constant in this document was chosen on ΔE00 plus
three aggregate fidelity guards** — none of which separates *smooth but wrong*
from *sharp with artifacts*. That is the same instrument set that rejected the
synthesis window for v0.6.

**Spurious detail** (`metrics/spurious.ts`) is the second artifact metric. Both
sides go onto one grid and through the same separable DCT-II — the format's own
basis, so a coefficient of the transform is a coefficient of the kind ChromaHash
transmits — and the score is the RMS of `max(0, |D| − |I|)` in 8-bit levels,
where `I` is the reference area-averaged onto the decode's raster: the ideal
low-pass, the best any placeholder at that raster could do.

It holds the same discipline: **a decode that is that ideal low-pass scores
exactly zero**, and `selftest:metrics` asserts it over 8 decode sizes × 3
content shapes. Missing detail is free — that is what ΔE00, SSIMULACRA2 and
DSSIM charge for — and it is magnitude-only, so it is an artifact measure and
never a fidelity score.

The orientation split comes free, and is worth having because the selection
order is deliberately anisotropic (`aniso_oblique = 1.2`, `sel_hv = 0.15`) and
whether that asymmetry is *visible* had never been measured.

Two independent checks that it recognises formats by their construction, none
of it fitted. **This table and §12.4's come from a report run, not a sweep, so
`verify:experiments` does not bind them** — it checks sweep output, and nothing
here aggregates orientation into a sweep row. They are reproduced with
`node tools/comparison/dist/main.js --skip-harnesses --images '<one photo>'` and
read out of `output/report.json`'s per-format `local` block; treat them as
illustrative rather than as gated figures, unlike §12.2 and §12.3.

| Format | Vertical | Horizontal | Diagonal | What it is |
|---|---|---|---|---|
| unpic | 0.09 | **16.45** | 0.96 | a CSS gradient — horizontal bands |
| BlurHash | 6.15 | 6.01 | **0.08** | separable rectangular basis, no diagonal term |
| lqip-modern | 5.71 | 4.83 | 4.88 | a plain downscale; ringing scores exactly 0.00 |
| ChromaHash t1 | 2.29 | 3.62 | 2.09 | ℓ2 ball, weighted against diagonals |

ChromaHash shows no gross directional artifact. The oblique weight is doing
something — diagonal is the lowest of its three — but nothing like BlurHash's
structural blindness to it.

### 12.2 The synthesis window, at the default tier

`sweeps/synthesis-window.json`, 31 tune photographs, `expectBytes: 32`. The
taper is decoder-side and the encoder is byte-identical with it on, so every
arm is the same 32 bytes; adopting one would move every test vector and change
no hash.

| variant | ΔE00 | Δ% | SSIM2 | Ring | Spur | paired 95% CI | guards |
|---|---|---|---|---|---|---|---|
| shipped (no window) | 11.473 | — | −341.7 | 1.02 | 3.53 | — | (base) |
| w_min 0.85 exp 1 | 11.510 | +0.33% | −343.8 | 0.78 | 2.44 | [−0.077, −0.003] | FAIL |
| w_min 0.7 exp 1 | 11.646 | +1.51% | −347.7 | 0.67 | 1.80 | [−0.273, −0.092] | FAIL |
| w_min 0.7 exp 2 | 11.775 | +2.64% | −349.5 | 0.73 | 1.53 | [−0.435, −0.187] | FAIL |
| w_min 0.5 exp 1 | 11.980 | +4.42% | −356.1 | 0.78 | 1.28 | [−0.722, −0.329] | FAIL |
| w_min 0.5 exp 2 | 12.308 | +7.28% | −360.6 | 1.00 | 0.95 | [−1.120, −0.590] | FAIL |
| luma only 0.7 exp 1 | 11.649 | +1.53% | −347.1 | 0.67 | 1.90 | [−0.267, −0.102] | FAIL |
| chroma only 0.7 exp 1 | 11.476 | +0.03% | −342.2 | 1.03 | 3.58 | [−0.029, +0.029] | ok |

Four things this settles.

1. **The window does what it is for, and by a lot.** Invented detail falls
   monotonically with taper strength, 3.53 → 0.95, a **73% reduction** at the
   strongest setting. Nothing else on the roadmap moves an artifact number like
   that.
2. **It is paid for in ΔE00 and SSIMULACRA2, monotonically.** Every windowed arm
   fails guards, and the paired CI excludes zero from `w_min 0.85` onward. The
   pre-registered rule wants ≥3% ΔE00 *improvement* with all guards improving;
   this is the opposite sign. **The v0.6 rejection stands — and now it stands on
   evidence rather than on an instrument that could not see the other half.**
3. **The effect is entirely luma.** `luma only` reproduces the both-channel arm
   almost exactly (spurious 1.90 vs 1.80, ΔE00 +1.53% vs +1.51%), while
   `chroma only` is inert on every column — spurious 3.58 against a 3.53 base,
   a paired CI straddling zero, the only arm that passes guards precisely
   because it does nothing. `RATIONALE.md` attributes v0.5's visible striping to
   "chroma quantization noise, not luma ringing". Whatever was true at the v0.5
   constants, at v0.7's the invented structure is **luma**, and a chroma taper
   cannot touch it.
4. **Ringing is not monotonic in the taper, and spurious is.** Ringing bottoms
   out at `w_min 0.7 exp 1` (1.02 → 0.67) and climbs back to 1.00 at the
   strongest arm, while spurious keeps falling. They are measuring different
   things, which is the case for having both.

### 12.3 The same knob at code 2, where the positioning claim lives

`sweeps/synthesis-window-upper.json`, `expectBytes: 108`. Split from the table
above rather than added to it: Δ%, guards and the paired CI are computed against
the first row, so mixing tiers would compare a 108-byte arm to a 32-byte
incumbent and make the tightest instrument here meaningless.

| variant | ΔE00 | Δ% | SSIM2 | DSSIM | Ring | Spur | paired 95% CI | guards |
|---|---|---|---|---|---|---|---|---|
| t2 shipped (no window) | 9.667 | — | −212.9 | 0.2559 | 1.32 | 3.65 | — | (base) |
| t2 w_min 0.85 exp 1 | 9.674 | +0.06% | −216.1 | 0.2548 | 1.03 | 2.64 | [−0.027, +0.012] | FAIL |
| t2 w_min 0.7 exp 1 | 9.756 | +0.92% | −221.8 | 0.2544 | 0.87 | 2.01 | [−0.136, −0.048] | FAIL |
| t2 w_min 0.5 exp 2 | 10.255 | +6.08% | −242.2 | 0.2561 | 1.00 | 1.27 | [−0.732, −0.459] | FAIL |
| t2 luma only 0.7 exp 1 | 9.750 | +0.85% | −221.0 | 0.2543 | 0.88 | 2.04 | [−0.126, −0.047] | FAIL |
| t2 chroma only 0.7 exp 1 | 9.674 | +0.06% | −213.7 | 0.2561 | 1.30 | 3.71 | [−0.033, +0.022] | ok |

The pattern holds, and the light arm gets interesting.

At `w_min 0.85`, ΔE00 is **statistically free** — the paired CI is
[−0.027, +0.012] and includes zero, on 31 images, from the instrument §11 built
precisely to resolve differences this small. For that nothing, the arm buys a
**28% cut in invented detail**, a **22% cut in ringing**, and a *better* DSSIM
(0.2548 vs 0.2559).

It fails guards on one metric: SSIMULACRA2, −3.2 points against a −1.0
tolerance. That is the whole verdict, and it deserves to be stated as a tension
rather than filed as a refutation:

* SSIMULACRA2 is the metric ChromaHash **already loses** to WebP and lqip-modern
  from ~84 B up (§2, §11.14). It is the axis the format is weakest on.
* It is also a **fidelity** score fitted to human ratings of *coded images*,
  where invented high-frequency structure and real high-frequency detail are
  hard to tell apart from a distance. A taper removes both.
* And per §7.14's U19, **not one of these metrics has ever been validated
  against human judgement at placeholder fidelity.** §8.5 already recorded three
  MSE-reducing changes moving ΔE00 the wrong way.

So the honest statement is: the window trades a metric the format is losing
anyway for two artifact metrics it wins on, at no measurable ΔE00 cost, and
**the existing rules say no**. Whether the rules are right about this is the
U19 question, which this round does not answer and cannot.

### 12.4 What the previews were showing, and the render at display size

The artifacts a reader sees in the comparison report were the prompt for this
round, so it is worth stating what that report actually renders. Every preview
is a decode at its **own** raster — 32×21 at the default tier — placed in a
150 px box with `image-rendering: pixelated`, i.e. magnified about seven times.
The button labelled "Toggle Blur" applied no blur; it switched
`image-rendering` to `auto`, the browser's interpolation of those same samples.

Neither view is the format drawing a picture at display size, and until this
round nothing could produce one: `render_at_size` has always been able to
evaluate the basis at any grid, but it is private, and every public entry point
either uses the natural raster or takes a per-axis `min` against it. No binding,
in any of the nine languages, can ask for it. The scoring path could not either
— it decodes capped to the ≤100 px encoder input and hands the result to
libvips, whose enlarger overshoots a step edge by ~7% of its own.

`research-render` (off by default, no binding exposes it) closes that, and the
report gains a row: the same 32 bytes, rendered directly at the 512 px
reference, so the shared upscale is a no-op for it alone.

First measurement, one photograph (`chroma-black-and-white`):

| | ΔE00 | DSSIM | SSIM2 | Butteraugli | Spurious |
|---|---|---|---|---|---|
| t1, decode at 32 px + upscale | 9.50 | 0.1844 | −180.1 | 32.88 | 4.77 |
| t1, native render at 512 px | 9.49 | 0.1843 | −179.9 | 32.82 | 4.64 |

**The two are the same picture on every metric that can compare them.** Not
close — identical to three significant figures on all four fidelity scores, and
within noise on invented detail. Rendering the format's own continuous
reconstruction at display size, instead of sampling it at 32 px and letting a
resampler interpolate, changes nothing a metric here can detect.

**Ringing is deliberately absent from that table, and the reason is worth
recording.** The first draft of this section reported ringing 0.85 against 2.32
and concluded that the native render "overshoots 2.7× more" because a truncated
cosine basis can overshoot where bilinear interpolation cannot. That conclusion
was wrong, and the metric — not the format — produced it.

`metrics/local.ts` derives its envelope radius from the *upscale factor*:
`scale = max(refW/decW, refH/decH)`, `radius = ceil(2·scale)`. A 32×21 decode
against a 512×341 reference gets **radius 33**; a native render at 512×341 gets
**radius 2**. Those are different instruments. A radius-2 envelope is a 5×5
local min/max of a photograph, tight enough that almost any reconstruction
escapes it.

Measured directly, with the *same picture* presented at both decode sizes —
exactly 16×, so nearest-neighbour sampling makes the two decode planes
pixel-identical and only the radius differs:

| presentation | radius | ringing |
|---|---|---|
| 32×20 decode against a 512×320 reference | 32 | **0.000** |
| the identical picture as a 512×320 decode | 2 | **10.482** |

The same picture, zero or ten depending only on how it is handed to the metric.
The 0.85-vs-2.32 gap is comfortably inside that, so it carries no information
about the format. The causal story in the withdrawn draft was independently
wrong too: `computeRinging` never sees `upscale.ts` at all — it sample-and-holds
through `nearestPlane` precisely so a resampler's halo is not charged to a
format — so both rows' decode planes are step functions and neither can
overshoot by interpolation.

This is a limit of the ringing metric, not a defect in it: `r >= S` is what makes
a low-pass score exactly zero, and that derivation *requires* the radius to track
the decode's footprint. The consequence is simply that **ringing is comparable
only between decodes at the same raster** — which `local.ts` already says, and
which is why it reports `ringWindowRadius` alongside the score. Spurious detail
is much less grid-sensitive (a controlled probe gives 12.48 at grid 32 against
14.19 at grid 256 for one picture), so it is the artifact column this table can
carry.

What survives is narrower than the withdrawn claim and more useful: on one
photograph, rendering at display size buys **nothing measurable**, at ~256× the
per-pixel decode cost. That is an argument against promoting `render_at_size` to
public API in nine languages, not for it — and it is the row to widen to the
corpus before either decision. It also settles the presentation question: the
blockiness in a report preview is the magnification, not the format, and the
format's own render does not look different enough for any metric to tell.

### 12.5 What this round did not do

* **No constant moved.** Every arm above is a measurement.
* **`aspect.ts` gained the self-checks** that `metric-selftest.ts`'s docstring
  and the `selftest:metrics` task description had both claimed since it was
  written, and neither had. One of them pins the 1.59% a 3:2 source lands on —
  which is the number an `<img>` receives, against the aspect *byte*'s 1.09%.
* **U19 is still open, and this round raises its stakes.** §7.14 said adding two
  computed metrics arguably does that; §12.3 is what it looks like when it
  happens — a decision that now turns on whether SSIMULACRA2 is right about
  placeholders, which nothing here can say.
