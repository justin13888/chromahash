/**
 * Statistics helpers for the report summaries: quantiles and a deterministic
 * bootstrap confidence interval for the mean. Mean-only summaries hide the
 * tail behaviour that matters for placeholders (a format can win on average
 * while failing badly on dark or saturated images), so the report co-reports
 * the median, p90, and a CI of the mean for the primary metric.
 */

/** Fixed seed for the bootstrap PRNG — every run resamples identically. */
const BOOTSTRAP_SEED = 42;

/** Deterministic pseudo-random using a simple LCG (same recipe as generate-fixtures). */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Linear-interpolation quantile of an ascending-sorted array, p in [0, 1].
 * Fails fast on an empty array or out-of-range p — callers guard emptiness.
 */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    throw new RangeError("quantile: empty input");
  }
  if (!(p >= 0 && p <= 1)) {
    throw new RangeError(`quantile: p must be in [0, 1], got ${p}`);
  }
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? 0;
  return loVal + (hiVal - loVal) * (pos - lo);
}

/**
 * Bootstrap confidence interval for the mean: resample with replacement
 * nResamples times and take the [alpha/2, 1 - alpha/2] quantiles of the
 * resampled means. Deterministic (seeded LCG, no Math.random) so reports are
 * reproducible. Fails fast on empty input — callers guard emptiness.
 */
export function bootstrapCI(
  values: number[],
  nResamples = 1000,
  alpha = 0.05,
): [number, number] {
  if (values.length === 0) {
    throw new RangeError("bootstrapCI: empty input");
  }
  const rng = lcg(BOOTSTRAP_SEED);
  const means: number[] = new Array(nResamples);
  for (let r = 0; r < nResamples; r++) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[Math.floor(rng() * values.length)] ?? 0;
    }
    means[r] = sum / values.length;
  }
  means.sort((a, b) => a - b);
  return [quantile(means, alpha / 2), quantile(means, 1 - alpha / 2)];
}
