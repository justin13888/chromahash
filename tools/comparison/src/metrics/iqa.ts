/**
 * Quality metrics via the `iqa-cli` binary (the iqa-rs crate).
 *
 * The comparison harness shells out to iqa-cli rather than reimplementing metrics,
 * so every format is scored by the same reference implementation. iqa-cli reads two
 * images from disk and prints a JSON object keyed by metric name; non-finite scores
 * (e.g. PSNR of identical images) come back as JSON `null`.
 *
 * Install with `just install-iqa` (or `cargo install iqa-cli`). Override the binary
 * path with the `IQA_CLI` environment variable. When the binary is missing or fails,
 * metrics degrade to `null` so the report still builds (thumbnails + timings).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
    `  iqa-cli unavailable (${reason}); quality metrics will be N/A. Install with \`just install-iqa\` or set IQA_CLI.`,
  );
}

type IqaJson = Record<string, number | null>;

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
 * Returns all-null on any failure (e.g. iqa-cli not installed).
 */
export async function computeIqaMetrics(
  refRgba: Uint8Array,
  distRgba: Uint8Array,
  width: number,
  height: number,
): Promise<IqaMetrics> {
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
        warnUnavailable(reason);
        return { ...NULL_IQA_METRICS };
      }
    }

    return {
      ciede2000: numOrNull(json.ciede2000),
      psnrDb: numOrNull(json.psnr),
      dssim: numOrNull(json.dssim),
      msSsim: numOrNull(json["ms-ssim"]),
      psnrHvsM: numOrNull(json["psnr-hvs-m"]),
      ssimulacra2: numOrNull(json.ssimulacra2),
      butteraugli: numOrNull(json.butteraugli),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
