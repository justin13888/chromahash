/**
 * Shared in-process bench loop for the TypeScript harnesses.
 *
 * Both the WebAssembly CLI (`encode-stdin.ts`) and the pure-TypeScript decode
 * CLI (`decode-stdin.ts`) drive this, so the two rows the perf driver compares
 * differ only in which decoder they call — not in how they are timed.
 */

/**
 * Absorbs a byte of every benchmarked result.
 *
 * Exported and written through rather than kept local: the pure-TypeScript
 * decoder is the one target in this harness that a JIT could plausibly prove
 * dead, since unlike every other language here it is not an opaque native
 * downcall.
 */
export const sink = { acc: 0 };

/**
 * Fail loudly if asked for a knob only the Rust harness has.
 *
 * `CHROMAHASH_TUNE` overrides format constants through `chromahash::Tunables`,
 * which no binding exposes; `CHROMAHASH_OUT` selects a decode output gamut
 * these CLIs do not implement. Ignoring either silently is the dangerous
 * failure: a sweep would label shipped-default numbers as an ablation and
 * nothing downstream could tell.
 */
export function rejectRustOnlyEnv(): void {
  for (const key of ["CHROMAHASH_TUNE", "CHROMAHASH_OUT"]) {
    if (process.env[key]) {
      process.stderr.write(
        `${key} is not supported by this harness (Rust-only); refusing to report numbers that would be silently mislabelled\n`,
      );
      process.exit(1);
    }
  }
}

export function benchEnvInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    process.stderr.write(`${key}: invalid value ${raw}\n`);
    process.exit(1);
  }
  return parsed;
}

/**
 * Warm up for `CHROMAHASH_BENCH_WARMUP_MS`, then run `CHROMAHASH_BENCH_REPS`
 * timed blocks of `iters` iterations, printing one mean-ns/op line per block to
 * stdout. Everything else goes to stderr.
 *
 * Warmup is time-based rather than count-based because this contract is shared
 * across seven harnesses whose per-op costs differ by two orders of magnitude,
 * and because TurboFan needs wall-clock time — not a fixed trip count — to
 * reach steady state.
 */
export function runBench(iters: number, op: () => number): void {
  const reps = Math.max(1, benchEnvInt("CHROMAHASH_BENCH_REPS", 1));
  const warmupNs =
    BigInt(benchEnvInt("CHROMAHASH_BENCH_WARMUP_MS", 0)) * 1_000_000n;
  const n = Math.max(1, iters);

  // At least one iteration, so the default also validates the input before the
  // first timed block.
  const warmStart = process.hrtime.bigint();
  for (;;) {
    sink.acc ^= op();
    if (process.hrtime.bigint() - warmStart >= warmupNs) break;
  }

  for (let r = 0; r < reps; r++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < n; i++) {
      sink.acc ^= op();
    }
    const nsPerOp = (process.hrtime.bigint() - start) / BigInt(n);
    process.stdout.write(`${nsPerOp}\n`);
  }
  process.stderr.write(
    `checksum=${(sink.acc >>> 0).toString(16)}\niters=${n}\n`,
  );
}
