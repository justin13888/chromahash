/**
 * Spawning and timing one measurement cell.
 *
 * The driver never times anything itself: each harness runs a timed loop
 * in-process and prints one mean-ns/op line per block, so a spawn's cost —
 * which for the JVM and .NET dwarfs the operation being measured — never enters
 * a reported number. What happens here is calibration, collection and
 * statistics.
 */

import { spawnSync } from "node:child_process";
import { bootstrapCIOf, median, quantile } from "../stats.ts";
import type { Target } from "./targets.ts";

/** Target wall-time of one timed block. Long enough to swamp clock granularity. */
const BLOCK_MS = 200;
const MIN_ITERS = 1;
const MAX_ITERS = 200_000;

/**
 * Re-calibrate when the measured block came out this much shorter than
 * BLOCK_MS. The pilot is one sample; if it over-estimated the per-op cost, the
 * block is too short and the median is exposed to a single GC pause or
 * descheduling event. Sizing from the measured median instead of the pilot is
 * strictly better information, so it is worth one extra invocation.
 */
const RECALIBRATE_BELOW = 0.5;

/** Warmup handed to a harness, in milliseconds. */
export const WARMUP_MS = { native: 500, managed: 2000 } as const;

export interface CellRequest {
  readonly target: Target;
  readonly argv: readonly string[];
  readonly stdin: Buffer;
  readonly env: Readonly<Record<string, string>>;
  readonly reps: number;
  /** Abort if the pilot projects a block longer than this. */
  readonly maxCellMs: number;
}

export interface CellResult {
  readonly iters: number;
  readonly reps: number;
  readonly samplesNsPerOp: number[];
  /**
   * The reported cost: the minimum over the timed blocks.
   *
   * Every source of error in a wall-clock benchmark is one-sided. Contention,
   * interrupts, page faults, migration between performance and efficiency
   * cores, and thermal throttling can only ever make a block slower than the
   * work actually costs; nothing makes it faster. So the minimum is the sample
   * least contaminated by the machine, and averaging or taking a median mixes
   * the measurement with whatever else the host was doing.
   *
   * Measured on an Apple M3 Pro, ten fresh processes timing the same cell: the
   * minimum settles to within 0.1% while the median of the same blocks spans
   * 34%. Across two independent full sweeps, the cells disagreeing by more than
   * 10% fall from 35 to 22 when read as minima.
   */
  readonly nsPerOp: number;
  readonly medianNsPerOp: number;
  readonly minNsPerOp: number;
  readonly ci95NsPerOp: [number, number];
  /** Interquartile range as a fraction of the median — the noise flag's basis. */
  readonly iqrPct: number;
  readonly noisy: boolean;
}

export type CellOutcome =
  | { readonly kind: "ok"; readonly result: CellResult }
  | { readonly kind: "skipped"; readonly reason: string };

function runOnce(
  req: CellRequest,
  iters: number,
  reps: number,
  warmupMs: number,
): { lines: number[] } {
  const argv = req.argv.map((a) => (a === "@ITERS@" ? String(iters) : a));
  const proc = spawnSync(req.target.command, [...req.target.args, ...argv], {
    cwd: req.target.cwd,
    input: req.stdin,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60_000,
    env: {
      ...process.env,
      ...req.target.env,
      ...req.env,
      CHROMAHASH_BENCH_REPS: String(reps),
      CHROMAHASH_BENCH_WARMUP_MS: String(warmupMs),
    },
  });
  if (proc.status !== 0) {
    const stderr = proc.stderr?.toString("utf8").slice(0, 400) ?? "";
    throw new Error(`${req.target.name} exited ${proc.status}: ${stderr}`);
  }
  const lines = proc.stdout
    .toString("utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => Number.parseInt(l, 10));
  if (lines.some((n) => !Number.isFinite(n))) {
    throw new Error(`${req.target.name}: non-numeric bench output`);
  }
  return { lines };
}

/**
 * Calibrate an iteration count, then take the measured run.
 *
 * Calibration is what makes a bounded sweep possible at all: a tier-4 decode
 * costs a quarter of a second and a tier-0 encode a millisecond and a half, so
 * no fixed iteration count serves both. One pilot invocation sizes the block,
 * and the measured run follows.
 */
export function probeCell(req: CellRequest): CellOutcome {
  const warmupMs = req.target.managed ? WARMUP_MS.managed : WARMUP_MS.native;

  // Pilot: one iteration, purely to learn the order of magnitude.
  //
  // It carries the same warmup as the measured run. A cold pilot times a
  // managed runtime's JIT rather than its steady state, over-estimates the
  // per-op cost, and therefore under-sizes the block it is used to calibrate:
  // the committed 2026-08-29 baseline sized `encode/Kotlin/t2` at 2 iterations
  // (a 15.7 ms block against the 200 ms target) and `encode/C#/t1` at 20. Those
  // are the cells that came back non-monotonic in tier.
  const pilot = runOnce(req, 1, 1, warmupMs);
  const pilotNs = pilot.lines[0] ?? 0;
  if (pilotNs <= 0) {
    return { kind: "skipped", reason: "pilot returned a non-positive time" };
  }
  if (pilotNs / 1e6 > req.maxCellMs) {
    return {
      kind: "skipped",
      reason: `one operation costs ${(pilotNs / 1e6).toFixed(0)} ms, over the ${req.maxCellMs} ms cell budget`,
    };
  }

  const sizeFor = (nsPerOp: number) =>
    Math.min(
      MAX_ITERS,
      Math.max(MIN_ITERS, Math.ceil((BLOCK_MS * 1e6) / nsPerOp)),
    );

  let iters = sizeFor(pilotNs);
  let { lines } = runOnce(req, iters, req.reps, warmupMs);
  if (lines.length === 0) {
    return { kind: "skipped", reason: "no timed blocks returned" };
  }

  // If the pilot over-estimated, the block ran short. Re-size from the measured
  // median — one sample of many, and warm by construction — and measure again.
  const firstMedian = median(lines);
  if (
    firstMedian > 0 &&
    iters > MIN_ITERS &&
    (iters * firstMedian) / 1e6 < BLOCK_MS * RECALIBRATE_BELOW
  ) {
    const resized = sizeFor(firstMedian);
    if (resized > iters) {
      iters = resized;
      const again = runOnce(req, iters, req.reps, warmupMs);
      if (again.lines.length > 0) lines = again.lines;
    }
  }

  const sorted = [...lines].sort((a, b) => a - b);
  const med = median(lines);
  const min = sorted[0] ?? med;
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const iqrPct = med > 0 ? iqr / med : 0;

  return {
    kind: "ok",
    result: {
      iters,
      reps: lines.length,
      samplesNsPerOp: lines,
      nsPerOp: min,
      medianNsPerOp: med,
      minNsPerOp: min,
      // A CI of the median, not the mean: a single descheduling event moves a
      // mean and leaves the median where it belongs.
      ci95NsPerOp: lines.length > 1 ? bootstrapCIOf(lines, median) : [med, med],
      iqrPct,
      // The spread between the reported minimum and the median of the same
      // blocks: how much of this cell was the machine rather than the work.
      // 5% is the line above which a cell cannot distinguish a regression from
      // its host, so the report marks it rather than quietly folding it in.
      noisy: iqrPct > 0.05 || (min > 0 && (med - min) / min > 0.05),
    },
  };
}
