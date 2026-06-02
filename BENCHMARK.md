# Chromahash Benchmark

Output generated with `just benchmark` on AMD Ryzen 7800X3D.

## Benchmark Summary — 100×100 RGB gradient, bulk count = 1000

| Implementation | encode single | decode single | encode bulk (total) | encode bulk (per-op) | decode bulk (total) | decode bulk (per-op) |
| --- | --- | --- | --- | --- | --- | --- |
| Rust | 2.59 ms | 1.09 ms | 109.32 ms | 109.32 µs | 336.30 ms | 336.30 µs |
| Go | 4.11 ms | 1.39 ms | 300.81 ms | 300.81 µs | 189.43 ms | 189.43 µs |
| TypeScript | 47.35 ms | 24.32 ms | 18160.04 ms | 18160.04 µs | 285.22 ms | 285.22 µs |
| Python | 134.88 ms | 42.82 ms | 98733.33 ms | 98733.33 µs | 7731.78 ms | 7731.78 µs |
| Kotlin | 61.62 ms | 49.20 ms | 514.90 ms | 514.90 µs | 256.95 ms | 256.95 µs |
| Swift | 7.11 ms | 4.49 ms | 586.94 ms | 586.94 µs | 195.46 ms | 195.46 µs |
| C# | 43.54 ms | 28.78 ms | 733.03 ms | 733.03 µs | 355.83 ms | 355.83 µs |
| ThumbHash (Rust) _(ThumbHash baseline)_ | 2.02 ms | 0.86 ms | 78.44 ms | 78.44 µs | 82.59 ms | 82.59 µs |
| ThumbHash (JS) _(ThumbHash baseline)_ | 29.11 ms | 23.97 ms | 474.52 ms | 474.52 µs | 162.53 ms | 162.53 µs |

> **single** times include process startup (JVM/.NET/Node cold start dominates) — a startup/latency proxy, not per-op compute. **bulk per-op** (= median / count) is the real compute number.
>
> Two ThumbHash baselines: **(Rust)** is the fastest native port (official `thumbhash` crate, parallel bulk encode) — compare it against native chromahash. **(JS)** is the JS reference on Node (serial) — compare it against chromahash's TypeScript. For bulk encode, the parallel tier is chromahash Rust/Go/Kotlin/Swift/C# + ThumbHash (Rust); the serial tier is chromahash TypeScript/Python + ThumbHash (JS).
