# chromahash benchmark

A language-agnostic performance benchmark comparing chromahash's **encode** and
**decode** against the **ThumbHash** baseline, in two regimes — a **single** call
and a **bulk 1000** (batched) run — across all 7 chromahash language
implementations (Rust, TypeScript, Go, Python, Kotlin, Swift, C#) plus ThumbHash
(the JS reference implementation).

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
  not per-op compute. Expect Rust/Go/Swift to look fast and Kotlin/C#/TypeScript/
  Python/ThumbHash to look slow — that's startup, not the algorithm.
- **bulk (1000)** — runs 1000 ops in one process via the `BatchEncoder` (for
  encode) or a decode loop, amortizing startup. The **per-op** figure
  (`median / count`) is the real compute number. This is where the parallel batch
  encoders (Rust/Go/Kotlin/Swift/C#) pull ahead of the serial ones (TypeScript and
  Python, which are single-threaded / GIL-bound, and ThumbHash, which has no batch
  API and loops).

There is no batch **decode** API in any implementation, so bulk-decode is a serial
loop of the single decode — still useful as an amortized per-op decode number.

ThumbHash is a JS reference baseline only; it is not a chromahash implementation.

## Running

```sh
just benchmark              # builds all harnesses (mise toolchains) + runs
```

Fast local iteration (skip the build, fewer/smaller runs):

```sh
cd tools/benchmark
uv run benchmark.py --skip-build --bulk-count 50 --warmup 1 --min-runs 3
```

Flags: `--bulk-count N` (default 1000), `--warmup N` (default 3),
`--min-runs N` (default 10), `--skip-build`, `--output-dir DIR`.

Requires `hyperfine` on `PATH`.

## Output (`output/`, gitignored)

- `json/{encode,decode}_{single,bulk}.json` — raw hyperfine results
- `benchmark-single.png` — single-mode bars (startup-dominated)
- `benchmark-bulk.png` — bulk per-op bars (real compute)
- `benchmark-summary.md` — the markdown table (also printed to stdout)

## Not in scope / CI

This benchmark is **run locally**, not in CI: it needs hyperfine plus all 8
toolchains, and the numbers are machine-dependent. It benchmarks the current
(v0.4) format only — version-over-version comparison is intentionally deferred
(prior versions predate the batch API).
