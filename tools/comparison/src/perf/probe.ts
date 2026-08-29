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
  readonly medianNsPerOp: number;
  readonly minNsPerOp: number;
  readonly ci95NsPerOp: [number, number];
  /** Interquartile range as a fraction of the median — the noise flag's basis. */
  readonly iqrPct: number;
  readonly noisy: boolean;
  readonly peakRssKb: number | null;
}

export type CellOutcome =
  | { readonly kind: "ok"; readonly result: CellResult }
  | { readonly kind: "skipped"; readonly reason: string };

function runOnce(
  req: CellRequest,
  iters: number,
  reps: number,
  warmupMs: number,
): { lines: number[]; rssKb: number | null } {
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
  return { lines, rssKb: null };
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

  // Pilot: one iteration, no warmup, purely to learn the order of magnitude.
  const pilot = runOnce(req, 1, 1, 0);
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

  const iters = Math.min(
    MAX_ITERS,
    Math.max(MIN_ITERS, Math.ceil((BLOCK_MS * 1e6) / pilotNs)),
  );
  const { lines, rssKb } = runOnce(req, iters, req.reps, warmupMs);
  if (lines.length === 0) {
    return { kind: "skipped", reason: "no timed blocks returned" };
  }

  const sorted = [...lines].sort((a, b) => a - b);
  const med = median(lines);
  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
  const iqrPct = med > 0 ? iqr / med : 0;

  return {
    kind: "ok",
    result: {
      iters,
      reps: lines.length,
      samplesNsPerOp: lines,
      medianNsPerOp: med,
      minNsPerOp: sorted[0] ?? med,
      // A CI of the median, not the mean: a single descheduling event moves a
      // mean and leaves the median where it belongs.
      ci95NsPerOp: lines.length > 1 ? bootstrapCIOf(lines, median) : [med, med],
      iqrPct,
      // 5% is the line above which a cell cannot distinguish a regression from
      // the machine, so the report marks it rather than quietly averaging it in.
      noisy: iqrPct > 0.05,
      peakRssKb: rssKb,
    },
  };
}
