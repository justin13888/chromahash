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
  return bootstrapCIOf(values, mean, nResamples, alpha);
}

/** Arithmetic mean. The statistic {@link bootstrapCI} resamples. */
function mean(sample: number[]): number {
  let sum = 0;
  for (const v of sample) sum += v;
  return sum / sample.length;
}

/**
 * Bootstrap confidence interval for an arbitrary statistic of the sample.
 *
 * Timing wants a CI of the *median* — one descheduling event skews a mean, and
 * the median is what the perf report leads with — while the quality tables want
 * the mean, so the statistic is a parameter.
 *
 * The draw order is load-bearing and must not change: `verify:experiments`
 * re-derives every confidence interval quoted in spec/EXPERIMENTS.md from this
 * function, so altering how many times `rng()` is called per resample, or in
 * what order, would silently invalidate a 1892-line document. Hence all
 * `values.length` indices are drawn first and the statistic applied afterwards,
 * which reproduces the previous sequence exactly.
 */
export function bootstrapCIOf(
  values: number[],
  statistic: (sample: number[]) => number,
  nResamples = 1000,
  alpha = 0.05,
): [number, number] {
  if (values.length === 0) {
    throw new RangeError("bootstrapCIOf: empty input");
  }
  const rng = lcg(BOOTSTRAP_SEED);
  const stats: number[] = new Array(nResamples);
  const sample: number[] = new Array(values.length);
  for (let r = 0; r < nResamples; r++) {
    for (let i = 0; i < values.length; i++) {
      sample[i] = values[Math.floor(rng() * values.length)] ?? 0;
    }
    stats[r] = statistic(sample);
  }
  stats.sort((a, b) => a - b);
  return [quantile(stats, alpha / 2), quantile(stats, 1 - alpha / 2)];
}

/** Median of a sample, sorting a copy so the caller's array is untouched. */
export function median(sample: number[]): number {
  return quantile([...sample].sort((a, b) => a - b), 0.5);
}

/**
 * Gauss error function, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7) — enough
 * precision for reporting a p-value to four decimals.
 */
function erf(x: number): number {
  const sign = Math.sign(x);
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
    t;
  return sign * (1 - poly * Math.exp(-z * z));
}

/**
 * Two-sided sign-test p-value for `wins` vs `losses` (ties excluded, as the
 * sign test requires): the probability of a split at least this lopsided under
 * the null hypothesis that either direction is equally likely.
 *
 * Uses the normal approximation with a continuity correction. Paired A/B runs
 * here have tens of non-tied images, where the approximation is accurate to
 * well under the reported precision; it complements the paired bootstrap CI by
 * answering "is the direction consistent?" independently of effect size.
 * Returns 1 when nothing is comparable.
 */
export function signTestP(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const extreme = Math.max(wins, losses);
  const z = (Math.abs(extreme - n / 2) - 0.5) / (0.5 * Math.sqrt(n));
  const p = 2 * (1 - 0.5 * (1 + erf(z / Math.SQRT2)));
  return Math.min(1, Math.max(0, p));
}
