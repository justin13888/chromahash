import sharp from "sharp";
import type { MetricResult } from "./types.ts";
import { computeIqaMetrics, NULL_IQA_METRICS } from "./metrics/iqa.ts";
import { upscaleRgba, type UpscalePolicy } from "./upscale.ts";

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
 * Backdrop both sides are composited over before scoring. RGBA PNGs handed to
 * iqa-cli have undefined alpha semantics, so alpha is resolved here: white, the
 * dominant page background placeholders sit on.
 */
export const ALPHA_BACKDROP: [number, number, number] = [255, 255, 255];

/**
 * Blur sigma rule for the "as-rendered" metric set: LQIPs are shown with a
 * blur-up of roughly this strength relative to their display size. Floored at
 * 1.0 — libvips truncates the Gaussian kernel by amplitude, so sigma below
 * ~0.6 is a byte-identical no-op that would silently duplicate the sharp set.
 */
export const BLUR_SIGMA_RULE = "max(1, longEdge / 32)";

/** Scoring configuration, set once by the orchestrator before processing. */
export interface ScoringConfig {
  upscalePolicy: UpscalePolicy;
  blurredScoring: boolean;
}

let scoringConfig: ScoringConfig = {
  upscalePolicy: "browser-gamma",
  blurredScoring: false,
};

export function setScoringConfig(config: ScoringConfig): void {
  scoringConfig = config;
}

export function getScoringConfig(): ScoringConfig {
  return scoringConfig;
}

/** Composite RGBA over the scoring backdrop (source-over), yielding opaque RGBA. */
export function flattenOverBackdrop(rgba: Uint8Array): Uint8Array {
  // Fast path: fully opaque input stays untouched.
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      opaque = false;
      break;
    }
  }
  if (opaque) return rgba;

  const [br, bg, bb] = ALPHA_BACKDROP;
  const out = new Uint8Array(rgba.length);
  for (let p = 0; p < rgba.length; p += 4) {
    const a = (rgba[p + 3] ?? 0) / 255;
    out[p] = Math.round((rgba[p] ?? 0) * a + br * (1 - a));
    out[p + 1] = Math.round((rgba[p + 1] ?? 0) * a + bg * (1 - a));
    out[p + 2] = Math.round((rgba[p + 2] ?? 0) * a + bb * (1 - a));
    out[p + 3] = 255;
  }
  return out;
}

/** Gaussian-blur opaque RGBA in place-equivalent fashion via sharp. */
async function blurRgba(
  rgba: Uint8Array,
  width: number,
  height: number,
  sigma: number,
): Promise<Uint8Array> {
  const { data } = await sharp(Buffer.from(rgba), {
    raw: { width, height, channels: 4 },
  })
    .blur(Math.max(0.3, sigma))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

/** Primary + optional blurred "as-rendered" metric sets for one decode. */
export interface MetricScores {
  metrics: MetricResult;
  metricsBlurred: MetricResult | null;
}

/**
 * Score a decoded LQIP against the display-resolution reference.
 *
 * Both sides are composited over the scoring backdrop, then the decode is
 * upscaled to reference dimensions under the configured policy (placeholders
 * are judged at the size they are displayed, stretched to the display aspect
 * the way a browser stretches an `<img>`). With blurred scoring enabled, a
 * second metric set is computed after Gaussian-blurring both sides
 * (sigma = longEdge/32), modeling the blur-up presentation.
 */
export async function computeAllMetrics(
  referenceRgba: Uint8Array,
  referenceW: number,
  referenceH: number,
  decodedRgba: Uint8Array,
  decodedW: number,
  decodedH: number,
): Promise<MetricScores> {
  const reference = flattenOverBackdrop(referenceRgba);
  const decodedFlat = flattenOverBackdrop(decodedRgba);

  const decodedAtRef = await upscaleRgba(
    decodedFlat,
    decodedW,
    decodedH,
    referenceW,
    referenceH,
    scoringConfig.upscalePolicy,
  );

  const metrics = await computeIqaMetrics(
    reference,
    decodedAtRef,
    referenceW,
    referenceH,
  );

  let metricsBlurred: MetricResult | null = null;
  if (scoringConfig.blurredScoring) {
    const sigma = Math.max(1, Math.max(referenceW, referenceH) / 32);
    const [refBlur, decBlur] = await Promise.all([
      blurRgba(reference, referenceW, referenceH, sigma),
      blurRgba(decodedAtRef, referenceW, referenceH, sigma),
    ]);
    metricsBlurred = await computeIqaMetrics(
      refBlur,
      decBlur,
      referenceW,
      referenceH,
    );
  }

  return { metrics, metricsBlurred };
}

/** MetricResult with all fields null — for CSS-only formats that produce no raster output. */
export const NULL_METRICS: MetricResult = NULL_IQA_METRICS;
