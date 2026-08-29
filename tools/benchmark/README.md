# chromahash benchmark

A language-agnostic performance benchmark comparing chromahash's **encode** and
**decode** against **ThumbHash baselines**, in two regimes — a **single** call
and a **bulk 1000** (batched) run — across all 7 chromahash language
implementations (Rust, TypeScript, Go, Python, Kotlin, Swift, C#).

Two ThumbHash baselines keep the comparison honest about the runtime:

- **ThumbHash (Rust)** — Evan Wallace's official [`thumbhash`](https://crates.io/crates/thumbhash)
  crate, the fastest native port. Its bulk encode is parallelized across cores to
  match chromahash's `BatchEncoder`. This is the apples-to-apples opponent for
  native chromahash — same language, so a gap is the *algorithm*, not the runtime.
- **ThumbHash (JS)** — the JS reference (npm [`thumbhash`](https://www.npmjs.com/package/thumbhash))
  on Node, serial. The runtime peer of chromahash's TypeScript build.

Without the native baseline, chromahash's only opponent was JS-on-Node, so its
apparent lead over "ThumbHash" was mostly Node startup + the JS interpreter — a
runtime artifact, not an algorithmic win.

Timing is driven by [hyperfine](https://github.com/sharkdp/hyperfine) so every
implementation is measured the same way: each harness is a CLI that reads from
stdin and writes to stdout, and hyperfine times the whole process.

The input is a fixed **100×100 sRGB RGB gradient**. The size is dictated by
ThumbHash, which caps the longest dimension at ~100px.

## Reading the numbers

The benchmark reports four cells per implementation — `{encode, decode} ×
{single, bulk}` — but they measure different things:

- **single** — hyperfine spawns a fresh process per run, so this time is
  **process startup + one op**. The JVM/.NET/Node cold start dwarfs the
  microsecond-scale encode/decode, so single-mode is a **startup/latency proxy**,
  not per-op compute. Expect Rust/Go/Swift/ThumbHash (Rust) to look fast and
  Kotlin/C#/TypeScript/Python/ThumbHash (JS) to look slow — that's startup, not the
  algorithm.
- **bulk (1000)** — runs 1000 ops in one process via the `BatchEncoder` (for
  encode) or a decode loop, amortizing startup. The **per-op** figure
  (`median / count`) is the real compute number. For encode there are two tiers:
  the **parallel** batch encoders (chromahash Rust/Go/Kotlin/Swift/C# and ThumbHash
  (Rust), all spreading the 1000 images across cores) and the **serial** ones
  (chromahash TypeScript/Python, single-threaded / GIL-bound, and ThumbHash (JS),
  which loops on one core). Compare like with like — native chromahash vs.
  ThumbHash (Rust), TypeScript chromahash vs. ThumbHash (JS).

There is no batch **decode** API in any implementation, so bulk-decode is a serial
loop of the single decode in every harness (including both ThumbHash baselines) —
a fair, amortized per-op decode number.

ThumbHash is a baseline only; it is not a chromahash implementation. Unlike
chromahash (byte-identical across languages by spec), ThumbHash is not
byte-identical across runtimes — its DCT-coefficient quantization diverges with
float rounding — so each baseline decodes a hash it encoded itself.

## Running

```sh
mise run benchmark              # builds all harnesses (mise toolchains) + runs
```

Fast local iteration (skip the build, fewer/smaller runs):

```sh
cd tools/benchmark
uv run benchmark.py --skip-build --bulk-count 50 --warmup 1 --min-runs 3
```

Flags: `--bulk-count N` (default 1000), `--warmup N` (default 3),
`--min-runs N` (default 10), `--timeout N` (per-comparison hyperfine timeout in
seconds, default 3600), `--skip-build`, `--output-dir DIR`.

The serial-tier harnesses (Python/TypeScript) dominate bulk mode and scale with
the machine — the Python `encode_bulk` cell alone can take >20 min at the default
`--bulk-count 1000 --min-runs 10` on a slow host. Raise `--timeout` (or lower
`--bulk-count`/`--min-runs`) if a comparison is skipped for exceeding it.

Requires `hyperfine` on `PATH`.

## Output (`output/`, gitignored)

- `json/{encode,decode}_{single,bulk}.json` — raw hyperfine results
- `benchmark-single.png` — single-mode bars (startup-dominated)
- `benchmark-bulk.png` — bulk per-op bars (real compute)
- `benchmark-summary.md` — the markdown table (also printed to stdout)

## Not in scope / CI

This benchmark is **run locally**, not in CI: it needs hyperfine plus every
language toolchain, and the numbers are machine-dependent. The native ThumbHash
baseline (`tools/thumbhash-rs/`) is a standalone crate built with the Rust
toolchain — it fetches the `thumbhash` crate from crates.io on first build, so a
network connection is required for the initial `build-benchmark`. It benchmarks
the current format only — version-over-version comparison is intentionally
deferred (prior versions predate the batch API).
