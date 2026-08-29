/**
 * Quality metrics via the `iqa-cli` binary (the iqa-rs crate).
 *
 * The comparison harness shells out to iqa-cli rather than reimplementing metrics,
 * so every format is scored by the same reference implementation. iqa-cli reads two
 * images from disk and prints a JSON object keyed by metric name; non-finite scores
 * (e.g. PSNR of identical images) come back as JSON `null`.
 *
 * Install with `mise run install:iqa` (or `cargo install iqa-cli`). Override the binary
 * path with the `IQA_CLI` environment variable.
 *
 * A missing or broken iqa-cli is a hard error: a report with all-null quality
 * metrics looks superficially complete but supports no conclusions, so the run
 * fails up front (`ensureIqaAvailable`) and again on any per-pair failure.
 * `--allow-missing-iqa` (see main.ts) opts into the old degrade-to-null behavior
 * for preview-only runs.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

/** Metrics from iqa-cli. Null = not computed (too small) or non-finite. */
export interface IqaMetrics {
  /** Mean CIEDE2000 (ΔE00) color difference. Lower is better. */
  ciede2000: number | null;
  /** Classic PSNR in dB. Higher is better. */
  psnrDb: number | null;
  /** DSSIM = (1 - SSIM) / 2. Lower is better. */
  dssim: number | null;
  /** Multi-scale SSIM. Higher is better. */
  msSsim: number | null;
  /** PSNR-HVS-M in dB. Higher is better. */
  psnrHvsM: number | null;
  /** SSIMULACRA2 perceptual score (≤100). Higher is better. */
  ssimulacra2: number | null;
  /** Butteraugli distance. Lower is better. */
  butteraugli: number | null;
}

/** All-null metrics — for CSS-only formats or when iqa-cli is unavailable. */
export const NULL_IQA_METRICS: IqaMetrics = {
  ciede2000: null,
  psnrDb: null,
  dssim: null,
  msSsim: null,
  psnrHvsM: null,
  ssimulacra2: null,
  butteraugli: null,
};

const IQA_CLI = process.env.IQA_CLI ?? "iqa-cli";

/**
 * Metric-infrastructure failure (iqa-cli missing/broken). Distinct from ordinary
 * per-adapter errors so the orchestrator can abort the run instead of logging
 * and continuing with a hollow all-N/A report.
 */
export class IqaError extends Error {}

/** When true, metric failures degrade to null instead of aborting the run. */
let allowMissingIqa = false;

/** Opt into degrade-to-null metrics (preview-only runs). */
export function setAllowMissingIqa(allow: boolean): void {
  allowMissingIqa = allow;
}

/**
 * Fail fast when iqa-cli is not runnable. Called once at startup so a run
 * never silently produces an all-N/A report.
 */
export function ensureIqaAvailable(): void {
  if (allowMissingIqa) return;
  try {
    execFileSync(IQA_CLI, ["--version"], { encoding: "utf8", timeout: 30_000 });
  } catch (err) {
    const reason =
      err instanceof Error
        ? (err.message.split("\n")[0] ?? err.message)
        : String(err);
    throw new IqaError(
      `iqa-cli is not available (${reason}). Quality metrics are required for a meaningful report — install with \`mise run install:iqa\` or set IQA_CLI, or pass --allow-missing-iqa for a preview-only run with N/A metrics.`,
    );
  }
}

/**
 * iqa-cli aborts the entire run if any requested metric errors, and several metrics
 * reject images below a minimum side length. Request only the metrics valid for these
 * dimensions; ciede2000/psnr (the primary + reference) work at any size.
 */
function metricsForDims(width: number, height: number): string[] {
  const minSide = Math.min(width, height);
  const metrics = ["ciede2000", "psnr"];
  if (minSide >= 8) metrics.push("ssimulacra2", "psnr-hvs-m", "butteraugli");
  if (minSide >= 11) metrics.push("dssim", "ms-ssim");
  return metrics;
}

let warned = false;
function warnUnavailable(reason: string): void {
  if (warned) return;
  warned = true;
  console.warn(
    `  iqa-cli unavailable (${reason}); quality metrics will be N/A. Install with \`mise run install:iqa\` or set IQA_CLI.`,
  );
}

type IqaJson = Record<string, number | null>;

/**
 * Content-addressed metric memo cache. iqa-cli at display resolution dominates
 * a run's wall clock (and sweeps re-score unchanged pairs constantly); results
 * are pure functions of the two pixel buffers, so cache them by content hash.
 * Lives under output/.metric-cache/ (gitignored with the rest of output/).
 */
const CACHE_DIR = path.resolve(
  import.meta.dirname,
  "../../output/.metric-cache",
);
let cacheDirReady = false;

function cacheKey(
  refRgba: Uint8Array,
  distRgba: Uint8Array,
  width: number,
  height: number,
): string {
  return createHash("sha256")
    .update(`${width}x${height}:`)
    .update(refRgba)
    .update(":")
    .update(distRgba)
    .digest("hex");
}

function cacheRead(key: string): IqaMetrics | null {
  try {
    const raw = readFileSync(path.join(CACHE_DIR, `${key}.json`), "utf8");
    return JSON.parse(raw) as IqaMetrics;
  } catch {
    return null;
  }
}

function cacheWrite(key: string, metrics: IqaMetrics): void {
  try {
    if (!cacheDirReady) {
      mkdirSync(CACHE_DIR, { recursive: true });
      cacheDirReady = true;
    }
    writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(metrics));
  } catch {
    // Cache writes are best-effort; a failed write only costs a recompute.
  }
}

function runIqa(refPath: string, distPath: string, metrics: string[]): IqaJson {
  const stdout = execFileSync(
    IQA_CLI,
    [
      "--reference",
      refPath,
      "--distorted",
      distPath,
      "--format",
      "json",
      "--metric",
      metrics.join(","),
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  return JSON.parse(stdout) as IqaJson;
}

async function writePng(
  rgba: Uint8Array,
  width: number,
  height: number,
  file: string,
): Promise<void> {
  await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } })
    .png()
    .toFile(file);
}

function numOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Compute iqa-cli quality metrics between two RGBA buffers of identical dimensions.
 * Throws on failure unless `setAllowMissingIqa(true)` opted into null degradation.
 */
export async function computeIqaMetrics(
  refRgba: Uint8Array,
  distRgba: Uint8Array,
  width: number,
  height: number,
): Promise<IqaMetrics> {
  const key = cacheKey(refRgba, distRgba, width, height);
  const cached = cacheRead(key);
  if (cached) return cached;

  const dir = mkdtempSync(path.join(tmpdir(), "chromahash-iqa-"));
  const refPath = path.join(dir, "ref.png");
  const distPath = path.join(dir, "dist.png");

  try {
    await writePng(refRgba, width, height, refPath);
    await writePng(distRgba, width, height, distPath);

    let json: IqaJson;
    try {
      json = runIqa(refPath, distPath, metricsForDims(width, height));
    } catch {
      // A metric we believed valid still errored — fall back to the always-safe
      // pair so the primary CIEDE2000 metric survives.
      try {
        json = runIqa(refPath, distPath, ["ciede2000", "psnr"]);
      } catch (err) {
        const reason =
          err instanceof Error
            ? (err.message.split("\n")[0] ?? err.message)
            : String(err);
        if (!allowMissingIqa) {
          throw new IqaError(
            `iqa-cli failed for a ${width}×${height} pair (${reason}). Pass --allow-missing-iqa to degrade metrics to N/A instead.`,
          );
        }
        warnUnavailable(reason);
        return { ...NULL_IQA_METRICS };
      }
    }

    const metrics: IqaMetrics = {
      ciede2000: numOrNull(json.ciede2000),
      psnrDb: numOrNull(json.psnr),
      dssim: numOrNull(json.dssim),
      msSsim: numOrNull(json["ms-ssim"]),
      psnrHvsM: numOrNull(json["psnr-hvs-m"]),
      ssimulacra2: numOrNull(json.ssimulacra2),
      butteraugli: numOrNull(json.butteraugli),
    };
    cacheWrite(key, metrics);
    return metrics;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
