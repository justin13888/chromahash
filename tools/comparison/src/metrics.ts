import sharp from "sharp";
import type { FormatResult, MetricResult } from "./types.ts";
import { computeDssim } from "./metrics/ssim.ts";
import { computeOklabDeltaE } from "./metrics/oklab-delta-e.ts";

/**
 * Time a function over N iterations, returning average time in milliseconds.
 * Works for both sync and async functions.
 */
export async function timeMs(
  fn: () => void | Promise<void>,
  iterations: number,
): Promise<number> {
  // Warmup
  await fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const elapsed = performance.now() - start;
  return elapsed / iterations;
}

/**
 * Downscale RGBA pixel data to a target resolution using Lanczos-3 filtering.
 * Returns the input unchanged if dimensions already match.
 */
export async function prepareGroundTruth(
  inputRgba: Uint8Array,
  inputW: number,
  inputH: number,
  targetW: number,
  targetH: number,
): Promise<Uint8Array> {
  if (inputW === targetW && inputH === targetH) {
    return inputRgba;
  }
  const { data } = await sharp(Buffer.from(inputRgba), {
    raw: { width: inputW, height: inputH, channels: 4 },
  })
    .resize(targetW, targetH, { kernel: "lanczos3", fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

function psnrBetween(a: Uint8Array, b: Uint8Array, pixelCount: number): number {
  let mse = 0;
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    for (let c = 0; c < 3; c++) {
      const diff = (a[idx + c] ?? 0) - (b[idx + c] ?? 0);
      mse += diff * diff;
    }
  }
  mse /= pixelCount * 3;
  if (mse === 0) return Number.POSITIVE_INFINITY;
  return 10 * Math.log10((255 * 255) / mse);
}

/**
 * Compute all quality metrics for a decoded LQIP against the encoder input.
 *
 * Uses Lanczos-3 downscaling to create ground truth at the LQIP's native resolution,
 * isolating format quality from measurement artifacts.
 */
export async function computeAllMetrics(
  inputRgba: Uint8Array,
  inputW: number,
  inputH: number,
  decodedRgba: Uint8Array,
  decodedW: number,
  decodedH: number,
): Promise<MetricResult> {
  const ground = await prepareGroundTruth(
    inputRgba,
    inputW,
    inputH,
    decodedW,
    decodedH,
  );

  const psnrDb = psnrBetween(ground, decodedRgba, decodedW * decodedH);
  const dssim = computeDssim(ground, decodedRgba, decodedW, decodedH);
  const deResult = computeOklabDeltaE(ground, decodedRgba, decodedW, decodedH);

  return {
    psnrDb,
    dssim,
    deltaEMean: deResult.mean,
    deltaEWeighted: deResult.weighted,
    deltaE95: deResult.p95,
    compositeScore: null, // computed in computeCompositeScores() after all formats run
  };
}

/** MetricResult with all fields null — for CSS-only formats that produce no raster output. */
export const NULL_METRICS: MetricResult = {
  psnrDb: null,
  dssim: null,
  deltaEMean: null,
  deltaEWeighted: null,
  deltaE95: null,
  compositeScore: null,
};

/**
 * Compute per-image composite scores for a set of format results.
 *
 * Composite = 0.55·norm(DSSIM) + 0.45·norm(weighted ΔE), where norm() is min-max
 * across raster formats for this image (0 = best, 1 = worst).
 *
 * Mutates the compositeScore field in place on each MetricResult.
 */
export function computeCompositeScores(formatResults: FormatResult[]): void {
  const raster = formatResults.filter(
    (r) => r.metrics.dssim !== null && r.metrics.deltaEWeighted !== null,
  );
  if (raster.length === 0) return;

  const dssimVals = raster.map((r) => r.metrics.dssim as number);
  const deVals = raster.map((r) => r.metrics.deltaEWeighted as number);

  const dssimMin = Math.min(...dssimVals);
  const dssimMax = Math.max(...dssimVals);
  const deMin = Math.min(...deVals);
  const deMax = Math.max(...deVals);

  for (const r of raster) {
    const normDssim =
      dssimMax > dssimMin
        ? ((r.metrics.dssim as number) - dssimMin) / (dssimMax - dssimMin)
        : 0;
    const normDe =
      deMax > deMin
        ? ((r.metrics.deltaEWeighted as number) - deMin) / (deMax - deMin)
        : 0;
    r.metrics.compositeScore = 0.55 * normDssim + 0.45 * normDe;
  }
}

/**
 * Compute PSNR between original and decoded RGBA images.
 * @deprecated Prefer computeAllMetrics() which uses Lanczos ground truth.
 */
export function computePsnr(
  originalRgba: Uint8Array,
  originalW: number,
  originalH: number,
  decodedRgba: Uint8Array,
  decodedW: number,
  decodedH: number,
): number {
  if (originalW === decodedW && originalH === decodedH) {
    return psnrBetween(originalRgba, decodedRgba, originalW * originalH);
  }
  const resampledRgba = resampleNearest(
    decodedRgba,
    decodedW,
    decodedH,
    originalW,
    originalH,
  );
  return psnrBetween(originalRgba, resampledRgba, originalW * originalH);
}

function resampleNearest(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const dst = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const srcY = Math.min(Math.floor((y * srcH) / dstH), srcH - 1);
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(Math.floor((x * srcW) / dstW), srcW - 1);
      const srcIdx = (srcY * srcW + srcX) * 4;
      const dstIdx = (y * dstW + x) * 4;
      dst[dstIdx] = src[srcIdx] ?? 0;
      dst[dstIdx + 1] = src[srcIdx + 1] ?? 0;
      dst[dstIdx + 2] = src[srcIdx + 2] ?? 0;
      dst[dstIdx + 3] = src[srcIdx + 3] ?? 0;
    }
  }
  return dst;
}
