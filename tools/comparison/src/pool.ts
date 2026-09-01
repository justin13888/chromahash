/**
 * Bounded-concurrency helpers.
 *
 * Every loop in this harness — images, adapters, sweep variants, harness
 * languages — is embarrassingly parallel, and every one of them ran serially.
 * The work is dominated by `iqa-cli` subprocesses and sharp encodes, so the
 * throttle that matters is the one around the subprocess (see
 * {@link metricSemaphore} in `metrics/iqa.ts`); the fan-out above it only needs
 * to be wide enough to keep that throttle fed.
 *
 * **Results are placed by index, never pushed on completion.** Every mean in
 * the report is a naive left-fold (`report.ts`), so the summation order has to
 * follow input order for the output to stay bit-identical to a serial run. That
 * property is what `mise run selftest:determinism` asserts.
 */

import os from "node:os";

/**
 * Default fan-out width. `os.availableParallelism()` respects cgroup limits and
 * `--cpu-shares`, which `os.cpus().length` does not — it matters on CI runners.
 */
export function defaultJobs(): number {
  const fromEnv = process.env.CHROMAHASH_JOBS;
  if (fromEnv !== undefined) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
    throw new Error(
      `CHROMAHASH_JOBS=${fromEnv} is not a positive integer job count.`,
    );
  }
  return Math.max(1, os.availableParallelism());
}

/**
 * Map `items` through `fn` with at most `limit` in flight, preserving order.
 *
 * `limit <= 1` runs strictly serially — the reference execution the determinism
 * gate compares against, and the mode a caller should use when it is timing
 * something (a contended core makes a wall-clock number meaningless).
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  if (items.length === 0) return out;

  if (limit <= 1) {
    for (let i = 0; i < items.length; i++) {
      out[i] = await fn(items[i] as T, i);
    }
    return out;
  }

  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      // `next++` is atomic here only because this is a single-threaded event
      // loop and there is no await between read and increment.
      for (let i = next++; i < items.length; i = next++) {
        out[i] = await fn(items[i] as T, i);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/**
 * A counting semaphore.
 *
 * Used to cap concurrent `iqa-cli` processes independently of how wide the
 * fan-out above it is, so a caller can parallelize images *and* the adapters
 * within an image without oversubscribing the machine.
 */
export class Semaphore {
  private available: number;
  private readonly waiting: Array<() => void> = [];

  constructor(permits: number) {
    if (!Number.isInteger(permits) || permits < 1) {
      throw new Error(`Semaphore needs at least 1 permit, got ${permits}.`);
    }
    this.available = permits;
  }

  /** Run `fn` holding one permit, releasing it even if `fn` throws. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      // Hand the permit straight to the next waiter rather than returning it to
      // the pool, so a waiter cannot be overtaken by a fresh acquire().
      next();
      return;
    }
    this.available++;
  }
}
