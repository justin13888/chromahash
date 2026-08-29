# ChromaHash Performance

The compute workbench, sibling to [`EXPERIMENTS.md`](EXPERIMENTS.md) (quality)
and [`RATIONALE.md`](RATIONALE.md) (why the constants are what they are).

ChromaHash's value proposition is a three-way trade: **bytes × reconstruction
quality × time**. Until this document, the repo measured each axis well and
never together — `tools/comparison` owned quality and bytes, `tools/benchmark`
owned wall-clock, seven per-language harnesses owned batch throughput, and
nothing joined them. The cost of every encoder-only lever was unknown, the
dominant cost driver was never varied, and the shipped `simd` feature had never
been measured at all.

Numbers here are produced by `mise run benchmark` (driver:
`tools/comparison/src/perf/`) and `mise run benchmark:stages`. Each harness times
its own loop in-process, so no reported figure includes process startup.

> **Machine.** AMD Ryzen 7 7800X3D (8 cores / 16 threads, AVX2, 96 MB V-cache),
> Linux, `rustc` release profile. Timings are machine-dependent; ratios travel
> better than absolutes. Swift is **not measured**: its UniFFI artifact is an
> xcframework that only `xcodebuild` can assemble, so it cannot run off macOS.

---

## 1. The headline: where encode time goes

`mise run benchmark:stages`, gradient source, ns per encode. The instrumented
build asserts it still produces the shipped bytes before reporting anything.

| stage | 100×100 t1 | 512×512 t1 | 512×512 t4 |
|---|---:|---:|---:|
| `eotf_lut` | 0.6% | 0.0% | 0.0% |
| `linearize` | 0.6% | 5.6% | 0.2% |
| `oklab_forward` | 2.6% | 7.0% | 0.2% |
| `alpha_average` | 0.2% | 0.4% | 0.0% |
| `composite` | 0.4% | 4.3% | 0.1% |
| `selection` | 0.6% | 0.0% | 0.1% |
| `cos_tables` | 0.3% | 0.1% | 0.0% |
| **`dct_forward`** | **57.1%** | **78.7%** | **96.6%** |
| `quantize_and_pack` | 37.5% | 4.0% | 2.8% |
| total | 2.83 ms | 48.4 ms | **1858 ms** |

**The forward DCT is the encoder.** Everything else is rounding error at any
size or tier that matters. A tier-4 encode of a 512×512 source spends 1.8
seconds of its 1.86 in one function.

This also relocates the small-image intuition: at 100×100 the quantizer searches
are 37.5% of the work, which is why the encoder-only levers in §4 are worth
their measurement there and nowhere else.

## 2. Cost per tier

100×100 sRGB gradient — the fixture the old benchmark used exclusively.

| tier | bytes | encode | decode |
|---|---:|---:|---:|
| 0 (compact) | 21 | 1.49 ms | 0.29 ms |
| 1 (default) | 32 | 2.57 ms | 0.33 ms |
| 2 | 108 | 7.42 ms | 1.21 ms |
| 3 | 411 | 30.2 ms | 15.9 ms |
| 4 | 1623 | 121.5 ms | **250.6 ms** |

Decode grows ~16× per tier level, exactly as `4^level` coefficients over a
`4^level` raster predicts. **A tier-4 decode is a quarter of a second of
single-threaded CPU for a placeholder.**

### Capped decode is the mitigation, and it is undocumented as such

Rust decode, natural against capped to 32×32:

| tier | natural | capped 32×32 | saving |
|---|---:|---:|---:|
| 0 | 343 µs | 285 µs | — (already 32 px) |
| 1 | 322 µs | 321 µs | — (already 32 px) |
| 2 | 2047 µs | 541 µs | 3.8× |
| 3 | 16.2 ms | 1.66 ms | 9.7× |
| 4 | 242 ms | 5.17 ms | **47×** |

Linear in rendered pixels, so capping harder pays more still: a tier-4 hash at
16×16 costs 2.7 ms, a 90× reduction on natural size.

The residual matters though: a tier-4 hash capped to 16×16 still costs 2.7 ms
against a tier-1 natural decode's 0.33 ms, because `K` does not shrink with the
cap. **Tier choice, not cap choice, is the dominant decode lever.**

## 3. Encode scales linearly in source pixels

There is no downsample: `dct_encode_selected` runs over the full source, so
encode is `O(K·W·H)`. Tier 1, gradient:

| source | encode | per megapixel |
|---|---:|---:|
| 64×64 | 1.66 ms | 406 ms/MP |
| 128×128 | 3.87 ms | 236 ms/MP |
| 256×256 | 12.8 ms | 195 ms/MP |
| 512×512 | 49.4 ms | 188 ms/MP |
| 1024×1024 | 192 ms | 183 ms/MP |

**Extrapolating to a 12 MP photo: ~2.2 seconds, single-threaded, at the default
tier.** The old benchmark never varied this axis — it measured 100×100 and
nothing else — which is why the cost of the format's most common real input was
invisible.

## 4. The encoder-only levers, priced

Zero wire cost, decoder untouched, bytes unchanged. 100×100, tier 1. Quality
deltas are from [`EXPERIMENTS.md`](EXPERIMENTS.md) §4.4; the time column is new.

| lever | encode | vs shipped | ΔE00 @32 B |
|---|---:|---:|---|
| shipped (`scale_fit=2 ac_nearest=1 dc_search=1`) | 2.64 ms | — | 10.390 |
| `scale_fit=1` | 1.69 ms | −36% | **10.381** |
| `ac_nearest=0` | 1.78 ms | −33% | 10.392 |
| `dc_search=0` | 2.63 ms | −0.5% | — |
| all three off | 1.62 ms | −39% | 10.434 |
| `refine_passes=1` | 20.7 ms | **7.8×** | — |
| `refine_passes=2` | 38.7 ms | **14.7×** | — |

Two things fall out, and both change decisions:

- **`ac_nearest` costs ~48% of encode time for −0.05% ΔE00.**
  `EXPERIMENTS.md` §10 adopts it "because it is **free** and principled". It is
  free in *bits*. Nothing in the repo could price it in *time*, so the claim
  went unchallenged for a release.
- **`scale_fit=2` is slower *and* worse than mode 1 at the default tier.**
  EXPERIMENTS' own table has mode 1 at 10.381 and mode 2 at 10.392. Mode 2 is
  adopted for its −1.78% at 411 B, which is defensible — but it costs +56% over
  mode 1 and loses at the tier most callers use. A per-tier policy is now an
  informed option rather than a guess.

`dc_search` is genuinely free, confirming its design note.

**But this table is a 100×100 result, and does not generalise.** Repeat it at
512×512 and every arm collapses into the noise:

| lever | 100×100 | 512×512 |
|---|---:|---:|
| shipped | 2.51 ms | 47.3 ms |
| `scale_fit=0` | 1.56 ms (−38%) | 46.6 ms (−1.5%) |
| `scale_fit=1` | 1.57 ms (−37%) | 46.4 ms (−1.9%) |
| `ac_nearest=0` | 1.76 ms (−30%) | 47.0 ms (−0.6%) |
| all three off | 1.55 ms (−38%) | 47.3 ms (−0.0%) |
| `refine_passes=1` | 20.7 ms (8.3×) | 510 ms (10.8×) |

This is §1 restated: `quantize_and_pack` is 37.5% of a 100×100 encode and 4.0%
of a 512×512 one, so the searches it contains can only ever be worth what the
stage is worth. **The encoder-only levers are a thumbnail-sized concern.** For
anything at photo resolution they are free, and `ac_nearest`'s ΔE00 — however
small — comes at no measurable cost. Any decision to drop them should be scoped
to small inputs, which is the opposite of what the 100×100 column alone implies.

`refine_passes` measures 7.8–14.7× here against EXPERIMENTS' "~54× encode time".
Both may be right — that figure was measured with the full REFINE stack
(`refine_grid`, `refine_obj=3`, `refine_dc`, `refine_scale`), not the bare pass
count — but the discrepancy is unresolved and flagged rather than smoothed over.

## 5. The `simd` feature buys 2–5%

Default build vs `--no-default-features`, both byte-identical:

| source | tier | SIMD | scalar | gain |
|---|---|---:|---:|---:|
| 100×100 | 1 | 2.49 ms | 2.58 ms | 1.03× |
| 256×256 | 1 | 12.75 ms | 12.72 ms | 1.00× |
| 512×512 | 1 | 46.9 ms | 48.0 ms | 1.02× |
| 512×512 | 0 | 30.5 ms | 32.2 ms | 1.05× |

`src/simd/` is four hand-written backends (AVX2, SSE2, NEON, wasm simd128), a
dedicated `simd-diff-tests` feature that fails rather than skips, and a
QEMU/wasmtime emulation matrix in CI. It covers exactly one of the pipeline's
nine stages — `oklab_forward`, which §1 shows is 0.2–7% of encode — so its
ceiling was never more than that.

This is not an argument for deleting it: it is byte-exact, costs no dependency,
and matters more on decode-light workloads. It *is* an argument that the next
optimisation should go where §1 says the time is.

## 6. Separable forward DCT: 3.5×, measured

Since §1 puts the DCT at 79–97% of encode, it is the only lever whose size
justifies a prototype. `dct_encode_selected` evaluates a full 2-D sum per
coefficient (`K·W·H`); most selected pairs share an `x` frequency, so the sum
factors into one row pass per distinct `cx` plus a length-`H` column reduction
per coefficient. Saving ≈ `K / Cx`, and `K` grows by `4^level` while `Cx` grows
by `2^level`.

Behind `Tunables::dct_separable` (off by default, exposed by no binding):

| source | tier 1 direct | separable | speedup |
|---|---:|---:|---:|
| 100×100 | 2.45 ms | 1.31 ms | **1.86×** |
| 256×256 | 12.5 ms | 3.85 ms | **3.24×** |
| 512×512 | 47.3 ms | 13.4 ms | **3.53×** |

**On byte-identity, precisely.** Reassociating floating-point addition is not
guaranteed to preserve quantized codes. Over 40 encodings spanning all five
tiers and three content classes, none changed. That is evidence, not proof — and
it does not make adoption free: §10 and §12.6 pin the direct summation as
normative, so another implementation could diverge where this one happened not
to. Adopting it is a format change: version bump, regenerated vectors, every
language landing together.

## 7. Cross-language, with startup removed

In-process, spawn excluded, 100×100 tier 1. The old harness's "single" column
measured process startup; these are the operations.

| implementation | encode t0 | encode t1 | encode t2 | decode t1 | decode t2 |
|---|---:|---:|---:|---:|---:|
| Rust | 1414 µs | 2508 µs | 7225 µs | 322 µs | 2047 µs |
| Rust (scalar) | 1455 µs | 2516 µs | 7284 µs | — | — |
| Go | 1442 µs | 2590 µs | 7726 µs | 319 µs | 1222 µs |
| C# | 1476 µs | 2614 µs | 7759 µs | 324 µs | 1213 µs |
| Kotlin | 1767 µs | *5988 µs* | 7841 µs | *1453 µs* | 1314 µs |
| Python | 6679 µs | 7861 µs | 13333 µs | 363 µs | 2154 µs |
| TypeScript (wasm) | **1054 µs** | **1658 µs** | **4922 µs** | 401 µs | 1769 µs |
| TypeScript (pure) | — | — | — | 1537 µs | 17774 µs |
| Swift | not measured | | | | |

> *Italicised cells are not trustworthy.* Even with a 2-second warmup, the JVM
> and .NET rows are not monotonic in tier — Kotlin's tier-1 encode exceeds its
> tier-2, and C#'s tier-0 decode (680 µs) exceeds its tier-1 (324 µs), which is
> impossible for the work involved. That is JIT state, not the binding. Managed
> runtimes need a JMH- or BenchmarkDotNet-grade harness to be pinned down; this
> one is honest about not being that.

**FFI cost is the buffer copy, not the transition.** Go's +13% on encode against
+3% on decode is explained by direction: encode passes 40 KB of RGBA in for 32
bytes out; decode passes 32 bytes in for ~4 KB out. In the batch path, where one
call carries 200 images, Go and Rust are indistinguishable (208.0 vs 208.8
µs/img). Python's 3.5× is the same effect through a heavier marshalling layer.

For scale, the numbers this replaces: the old harness reported Kotlin encode at
426 ms and C# at 27.8 ms, against 2.77 ms and 2.49 ms here. Those were JVM and
.NET cold start, published as though they were the algorithm.

### The unexplained result: WebAssembly beats native

TypeScript-on-wasm encodes **faster than native Rust**, and the gap widens with
size: 1.21× at 64², 1.45× at 100², 2.36× at 256², **2.72× at 512²**. Output is
byte-identical and the wasm artifact is current, so it is the same work.

Ruled out: stale build (bytes match), `-C target-cpu=native` (no improvement,
2.57 ms vs 2.47 ms), fixed overhead such as allocator churn (the gap *grows*
with size, so it is compute), and a release-profile override (there is none).
Localised: native *wins* decode (315 vs 403 µs), so it is specific to
`dct_encode_selected`, not the crate as a whole.

Not ruled out, and the recommended next step: the native x86-64 codegen of that
one inner loop. Given §1, a 2.7× recovery there is worth more than every other
item in this document combined.

## 8. Batch throughput is not per-op cost

`bench-batch`, 200 images, 100×100 tier 1, reported per batch and divided:

| implementation | 1 thread | auto (16) | scaling |
|---|---:|---:|---:|
| Rust | 2470 µs/img | 216 µs/img | **11.5×** |
| Rust (scalar) | 2517 µs/img | 221 µs/img | 11.4× |
| Go | 2490 µs/img | 213 µs/img | **11.7×** |
| C# | 2500 µs/img | 213 µs/img | **11.7×** |
| Kotlin | 2671 µs/img | 1116 µs/img | **2.4×** |
| TypeScript (wasm) | 1715 µs/img | — (serial) | — |
| Python | 7906 µs/img | — (serial, GIL) | — |

The serial figures match single-image encode, as they should.

**Kotlin's batch encoder does not scale.** 2.4× on sixteen threads, where Rust,
Go and C# all reach ~11.6× against the same native worker pool. Every one of
those four is a thin binding over the same `BatchEncoder`, so the algorithm is
not the variable — this is worth a look at the JVM binding's dispatch.

The old benchmark's "bulk per-op" column was wall-clock ÷ count on a parallel
encoder, printed in the same table as GIL-bound Python — comparing threading
models, not algorithms. This document keeps **serial CPU-time per op**
(algorithmic cost) and **batch throughput** (machine-scaled) apart, always.

## 9. Pure-TypeScript decode: the trade, finally priced

`typescript/src/decode.ts` is an 818-line hand-maintained algorithm port whose
sole justification is skipping the `.wasm` fetch and instantiate. It had never
been benchmarked.

| | steady-state decode | cold wall (one decode) |
|---|---:|---:|
| WebAssembly | 403 µs | 64 ms |
| pure TypeScript | 2189 µs | 42 ms |

Skipping instantiation is worth **22 ms**; the pure path then costs **+1786 µs**
per decode. **Break-even ≈ 12 placeholders.** Below that it wins a page's first
paint; above it, WebAssembly wins outright. In a browser the module arrives over
the network rather than from a local file, so 22 ms is a floor and the real
break-even is higher — the module earns its keep, but the margin is narrower
than "skip the wasm" suggests.

---

## 10. Where to spend effort next

Ordered by measured size, not by appeal:

1. **The native forward-DCT inner loop** (§7). WebAssembly runs the same
   byte-identical work 2.7× faster at 512². Since the DCT is 79–97% of encode,
   closing that gap is the largest available win and needs no format change.
2. **Adopt the separable transform** (§6) — 3.5×, but costs a format version.
   Worth deciding deliberately rather than by default.
3. **Reconsider `ac_nearest` and per-tier `scale_fit`** (§4). Roughly a third of
   encode time for effects at or below the noise floor at the default tier.
4. **SIMD in decode** — there is none. `decode.rs` runs a scalar per-pixel OKLAB
   inverse plus three gamma lookups inside the `O(w·h·K)` render loop, and at
   tier 4 decode is the more expensive half.
5. **A batch decode API** — none exists in any implementation, so every bulk
   decode is a serial loop.
6. **Kotlin batch dispatch** (§8) — 2.4× against ~11.6× for the three sibling
   bindings over the same native pool.
7. **Document the tier-4 cost.** 250 ms to decode and 1.8 s to encode a 512×512
   source are defensible for an archival tier and indefensible as a surprise.

## 11. Corrections to published claims

`spec/README.md` §14 and `README.md` both carried performance figures that no
harness verified and no gate protected. Measured here:

| claim (§14) | measured | factor |
|---|---|---|
| decode "~36 µs native" | **340 µs** (tier 1, stable over 10/100/1000 iterations) | **9.4×** |
| encode "~400 ms for 12 MP" | **~2.2 s** (192 ms at 1.05 MP) | **5.5×** |
| "the v0.6 DC search adds ~10 µs — negligible" | ~13 µs, −0.5% | accurate |

That the DC-search line is still exactly right while the other two are not dates
the table to the **v0.6** era: v0.7 raised the default coefficient counts and
adopted the encoder searches §4 prices at +63%. They were never re-measured
because nothing measured them. Both are corrected in this change, and
`mise run verify:benchmark` now checks this document against the committed run
so the next drift is caught rather than published.
