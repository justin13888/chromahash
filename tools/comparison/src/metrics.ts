import sharp from "sharp";
import type { MetricResult } from "./types.ts";
import { computeIqaMetrics, NULL_IQA_METRICS } from "./metrics/iqa.ts";

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
 * Resample RGBA pixel data to a target resolution using Lanczos-3 filtering.
 * Returns the input unchanged if dimensions already match.
 */
export async function resampleTo(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
): Promise<Uint8Array> {
  if (srcW === targetW && srcH === targetH) {
    return rgba;
  }
  const { data } = await sharp(Buffer.from(rgba), {
    raw: { width: srcW, height: srcH, channels: 4 },
  })
    .resize(targetW, targetH, { kernel: "lanczos3", fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

/**
 * Compute all quality metrics for a decoded LQIP against the encoder input.
 *
 * The issue requires every format to be scored at identical dimensions: the decoded
 * preview is resampled to the encoder-input (source) resolution and compared against
 * that input, so ChromaHash/ThumbHash/BlurHash/lqip-modern are all measured at the
 * same W×H per image. Metrics themselves are computed by iqa-cli (CIEDE2000 primary).
 */
export async function computeAllMetrics(
  inputRgba: Uint8Array,
  inputW: number,
  inputH: number,
  decodedRgba: Uint8Array,
  decodedW: number,
  decodedH: number,
): Promise<MetricResult> {
  // Canonical comparison resolution = encoder-input (source) dims.
  const decodedAtSource = await resampleTo(
    decodedRgba,
    decodedW,
    decodedH,
    inputW,
    inputH,
  );
  return computeIqaMetrics(inputRgba, decodedAtSource, inputW, inputH);
}

/** MetricResult with all fields null — for CSS-only formats that produce no raster output. */
export const NULL_METRICS: MetricResult = NULL_IQA_METRICS;
