# Chromahash Benchmark

Output generated with `just benchmark` on Apple M3 Pro.

> **These numbers are the default tier (code 1, 32 bytes) only.** `just benchmark`
> now sweeps every tier and emits a table per tier, but the run below predates
> that and has not been re-measured — regenerate with `just benchmark` on the
> reference machine and paste `tools/benchmark/output/benchmark-summary.md` over
> the section below.

## Benchmark Summary — 100×100 RGB gradient, bulk count = 1000

| Implementation | encode single | decode single | encode bulk (total) | encode bulk (per-op) | decode bulk (total) | decode bulk (per-op) |
| --- | --- | --- | --- | --- | --- | --- |
| Rust | 2.62 ms | 2.17 ms | 72.59 ms | 72.59 µs | 240.70 ms | 240.70 µs |
| Go | 5.77 ms | 4.74 ms | 74.99 ms | 74.99 µs | 241.30 ms | 241.30 µs |
| TypeScript | 46.14 ms | 44.90 ms | 614.49 ms | 614.49 µs | 307.11 ms | 307.11 µs |
| Python | 49.84 ms | 45.22 ms | 4791.10 ms | 4791.10 µs | 299.84 ms | 299.84 µs |
| Kotlin | 426.49 ms | 457.25 ms | 634.88 ms | 634.88 µs | 786.23 ms | 786.23 µs |
| Swift | 3.80 ms | 3.96 ms | 105.86 ms | 105.86 µs | 240.99 ms | 240.99 µs |
| C# | 27.81 ms | 27.15 ms | 133.63 ms | 133.63 µs | 261.47 ms | 261.47 µs |
| ThumbHash (Rust) _(ThumbHash baseline)_ | 2.73 ms | 1.89 ms | 55.64 ms | 55.64 µs | 37.00 ms | 37.00 µs |
| ThumbHash (JS) _(ThumbHash baseline)_ | 40.21 ms | 33.89 ms | 533.04 ms | 533.04 µs | 222.35 ms | 222.35 µs |

> **single** times include process startup (JVM/.NET/Node cold start dominates) — a startup/latency proxy, not per-op compute. **bulk per-op** (= median / count) is the real compute number.
>
> Two ThumbHash baselines: **(Rust)** is the fastest native port (official `thumbhash` crate, parallel bulk encode) — compare it against native chromahash. **(JS)** is the JS reference on Node (serial) — compare it against chromahash's TypeScript. For bulk encode, the parallel tier is chromahash Rust/Go/Kotlin/Swift/C# + ThumbHash (Rust); the serial tier is chromahash TypeScript/Python + ThumbHash (JS).
