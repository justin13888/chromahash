/**
 * Paired per-image deltas between two format columns scored on the SAME images.
 *
 * `computeFormatStats` (report.ts) summarizes each column independently, so its
 * bootstrap CIs are *unpaired* — they carry the corpus's image-to-image spread,
 * which for ΔE00 runs from ~1 to ~30 and dwarfs the difference between two
 * builds of the same format. On the v0.6-vs-v1 holdout A/B the unpaired CIs are
 * [10.25, 12.39] and [10.30, 12.45]: indistinguishable. The paired CI of the
 * per-image difference is [+0.028, +0.077] — the same data, ~40× tighter,
 * and it excludes zero.
 *
 * Version comparison is exactly the paired case (identical images, identical
 * scoring, one variable), so it gets this treatment. Cross-format runs do not:
 * different formats at different byte costs are not a controlled A/B.
 */

import { bootstrapCI, signTestP } from "./stats.ts";
import type { FormatResult, MetricResult } from "./types.ts";

/** Entries this module needs; structurally satisfied by the report's ImageEntry. */
export interface PairedEntry {
  formatResults: FormatResult[];
}

/** A metric that can be compared pairwise, with the direction that means better. */
interface PairedMetricSpec {
  key: keyof MetricResult;
  label: string;
  /** "lower" = smaller is better (ΔE00), "higher" = larger is better (SSIM2). */
  direction: "lower" | "higher";
}

/**
 * The primary metric plus the three sweep guards (see sweeps/ and §12.1): a
 * candidate that improves ΔE00 while regressing SSIMULACRA2 / Butteraugli /
 * DSSIM has not improved. Same metric set the sweep runner gates on, so a
 * version A/B and a constants sweep are read the same way.
 */
const PAIRED_METRICS: PairedMetricSpec[] = [
  { key: "ciede2000", label: "ΔE00", direction: "lower" },
  { key: "ssimulacra2", label: "SSIM2", direction: "higher" },
  { key: "butteraugli", label: "Butter", direction: "lower" },
  { key: "dssim", label: "DSSIM", direction: "lower" },
];

/** One metric's paired comparison of a candidate column against the baseline. */
export interface PairedMetricDelta {
  metric: string;
  /** Baseline mean over the paired images. */
  baselineMean: number;
  /** Candidate mean over the same images. */
  candidateMean: number;
  /**
   * Mean per-image delta, sign-normalized so **negative means the candidate is
   * better** regardless of the metric's natural direction.
   */
  meanDelta: number;
  /** `meanDelta` as a percentage of |baselineMean|; negative = candidate better. */
  deltaPct: number | null;
  /** 95% bootstrap CI of `meanDelta`. Excluding zero = a real, consistent shift. */
  ci: [number, number];
  /** Images where the candidate scored better / identically / worse. */
  wins: number;
  ties: number;
  losses: number;
  /** Two-sided sign-test p-value over the non-tied images. */
  signP: number;
  /** How many images had a comparable (non-null) value on both sides. */
  pairs: number;
}

/** Every metric's paired comparison for one candidate column. */
export interface PairedComparison {
  baseline: string;
  candidate: string;
  metrics: PairedMetricDelta[];
}

function metricValue(
  result: FormatResult,
  key: keyof MetricResult,
): number | null {
  const v = result.metrics[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Compare every `candidates` column against `baseline` over `entries`. The pair
 * for one image is the two columns of that image's own entry, so pairing is
 * exact by construction. Images where either side is missing the column, or
 * either value is null, are dropped from that metric's pairing. Metrics with no
 * usable pairs are omitted; a candidate with no usable metrics is omitted
 * entirely.
 */
export function computePairedComparisons(
  entries: PairedEntry[],
  baseline: string,
  candidates: string[],
): PairedComparison[] {
  const out: PairedComparison[] = [];
  for (const candidate of candidates) {
    if (candidate === baseline) continue;
    const metrics: PairedMetricDelta[] = [];

    for (const spec of PAIRED_METRICS) {
      // Sign flip so a negative delta always reads as "candidate is better".
      const sign = spec.direction === "lower" ? 1 : -1;
      const deltas: number[] = [];
      let baseSum = 0;
      let candSum = 0;

      for (const entry of entries) {
        const b = entry.formatResults.find((r) => r.formatName === baseline);
        const c = entry.formatResults.find((r) => r.formatName === candidate);
        if (!b || !c) continue;
        const bv = metricValue(b, spec.key);
        const cv = metricValue(c, spec.key);
        if (bv === null || cv === null) continue;
        baseSum += bv;
        candSum += cv;
        deltas.push(sign * (cv - bv));
      }

      if (deltas.length === 0) continue;
      // Exact float equality is the right tie test: both sides run the same
      // metric binary on the same reference, so an unchanged image produces a
      // bit-identical score. Only a genuine encode difference moves it.
      const wins = deltas.filter((d) => d < 0).length;
      const losses = deltas.filter((d) => d > 0).length;
      const meanDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
      const baselineMean = baseSum / deltas.length;

      metrics.push({
        metric: spec.label,
        baselineMean,
        candidateMean: candSum / deltas.length,
        meanDelta,
        deltaPct:
          baselineMean !== 0
            ? (meanDelta / Math.abs(baselineMean)) * 100
            : null,
        ci: bootstrapCI(deltas),
        wins,
        ties: deltas.length - wins - losses,
        losses,
        signP: signTestP(wins, losses),
        pairs: deltas.length,
      });
    }

    if (metrics.length > 0) out.push({ baseline, candidate, metrics });
  }
  return out;
}

/**
 * Pick the paired baseline from a version lineup: the newest released tag, so
 * the working tree ("current") is measured against its immediate predecessor.
 * Returns null when the lineup has no tag to compare against.
 */
export function pickVersionBaseline(formatNames: string[]): string | null {
  const tags = formatNames.filter((n) => /^v\d/.test(n));
  if (tags.length === 0) return null;
  return tags.sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  )[0] as string;
}

/** Console-render one paired comparison block. */
export function formatPairedTable(
  label: string,
  comparisons: PairedComparison[],
): string {
  const lines: string[] = [];
  for (const cmp of comparisons) {
    lines.push(
      `\n=== Paired vs ${cmp.baseline} (${label}) — ${cmp.candidate} ===`,
    );
    lines.push(
      `  ${"Metric".padEnd(8)} ${"baseline".padStart(10)} ${"candidate".padStart(10)} ${"Δ".padStart(9)} ${"Δ%".padStart(7)} ${"95% CI of Δ".padStart(22)} ${"win/tie/loss".padStart(13)} ${"sign p".padStart(7)}`,
    );
    for (const m of cmp.metrics) {
      const ci = `[${m.ci[0].toFixed(4)}, ${m.ci[1].toFixed(4)}]`;
      lines.push(
        `  ${m.metric.padEnd(8)} ${m.baselineMean.toFixed(4).padStart(10)} ${m.candidateMean.toFixed(4).padStart(10)} ${m.meanDelta.toFixed(4).padStart(9)} ${(m.deltaPct !== null ? m.deltaPct.toFixed(2) : "N/A").padStart(7)} ${ci.padStart(22)} ${`${m.wins}/${m.ties}/${m.losses}`.padStart(13)} ${m.signP.toFixed(4).padStart(7)}`,
      );
    }
  }
  if (lines.length > 0) {
    lines.push(
      "  (negative Δ = candidate better; CI excluding 0 = real shift)",
    );
  }
  return lines.join("\n");
}
