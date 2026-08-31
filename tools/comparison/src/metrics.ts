import sharp from "sharp";
import type { LocalMetrics, MetricResult } from "./types.ts";
import { computeIqaMetrics, NULL_IQA_METRICS } from "./metrics/iqa.ts";
import { computeRinging, NULL_RINGING } from "./metrics/local.ts";
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

/** An opaque RGB backdrop that translucent pixels are composited over. */
export type Backdrop = readonly [number, number, number];

/**
 * Backdrop both sides are composited over before scoring. RGBA PNGs handed to
 * iqa-cli have undefined alpha semantics, so alpha is resolved here: white, the
 * dominant page background placeholders sit on.
 */
export const ALPHA_BACKDROP: Backdrop = [255, 255, 255];

/**
 * Backdrop sets for {@link ScoringConfig.backdrops}.
 *
 * Scoring over white alone is the right default — it is where placeholders
 * actually sit — but it cannot measure the alpha channel. A decode whose alpha
 * is wrong wherever the colour happens to be near-white scores as though it
 * were right, so an alpha-layout experiment scored on one backdrop is largely
 * measuring colour. Compositing over white, black and mid-grey and averaging
 * makes an alpha error visible on at least one of them regardless of the
 * underlying colour.
 */
export const BACKDROP_SETS = {
  white: [[255, 255, 255]],
  "white-black-grey": [
    [255, 255, 255],
    [0, 0, 0],
    [128, 128, 128],
  ],
} as const satisfies Record<string, readonly Backdrop[]>;

/** Name of a backdrop set. */
export type BackdropSetName = keyof typeof BACKDROP_SETS;

/**
 * Blur sigma rule for the "as-rendered" metric set: LQIPs are shown with a
 * blur-up of roughly this strength relative to their display size. Floored at
 * 1.0 — libvips truncates the Gaussian kernel by amplitude, so sigma below
 * ~0.6 is a byte-identical no-op that would silently duplicate the sharp set.
 */
export const BLUR_SIGMA_RULE = "max(1, longEdge / 32)";

/**
 * The blurred "as-rendered" pass exists to answer one question — how much of a
 * format's error survives the blur-up a consumer applies — and ΔE00 answers it.
 * Requesting the full set would double the run's iqa-cli cost for six columns
 * nothing reads, and SSIMULACRA2 and Butteraugli are the expensive ones.
 */
const BLURRED_METRICS = ["ciede2000"] as const;

/** Scoring configuration, set once by the orchestrator before processing. */
export interface ScoringConfig {
  upscalePolicy: UpscalePolicy;
  blurredScoring: boolean;
  /**
   * Backdrops to composite over and average across. A single backdrop is the
   * historical path and is bit-identical to it; see {@link BACKDROP_SETS}.
   */
  backdrops?: readonly Backdrop[];
  /**
   * Also score the alpha plane directly (see {@link LocalMetrics.alphaMae}).
   * Off by default: it is meaningless for the opaque corpora and would only
   * add a null column.
   */
  alphaFidelity?: boolean;
  /**
   * Score ringing (see `metrics/local.ts`). Defaults to on; `--no-ringing`
   * turns it off for preview-only runs. Optional so the sweep and gate call
   * sites keep compiling untouched under `exactOptionalPropertyTypes`.
   */
  ringing?: boolean;
}

let scoringConfig: ScoringConfig = {
  upscalePolicy: "browser-gamma",
  blurredScoring: false,
  backdrops: [ALPHA_BACKDROP],
  alphaFidelity: false,
};

export function setScoringConfig(config: ScoringConfig): void {
  scoringConfig = config;
}

export function getScoringConfig(): ScoringConfig {
  return scoringConfig;
}

/** Composite RGBA over a backdrop (source-over), yielding opaque RGBA. */
export function flattenOverBackdrop(
  rgba: Uint8Array,
  backdrop: Backdrop = ALPHA_BACKDROP,
): Uint8Array {
  // Fast path: fully opaque input stays untouched.
  let opaque = true;
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) {
      opaque = false;
      break;
    }
  }
  if (opaque) return rgba;

  const [br, bg, bb] = backdrop;
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
  /**
   * Everything this harness measured itself rather than reading from iqa-cli.
   * Separate from {@link MetricResult} so the report's provenance claim — that
   * those seven numbers are iqa-cli's — stays true. See {@link LocalMetrics}.
   */
  local: LocalMetrics;
}

/** Mean of the finite values, or null if there are none. */
function meanOrNull(xs: (number | null)[]): number | null {
  const ys = xs.filter((v): v is number => v !== null && Number.isFinite(v));
  return ys.length > 0 ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
}

/** Average a set of metric results field by field, dropping nulls per field. */
function averageMetrics(sets: MetricResult[]): MetricResult {
  const keys = Object.keys(
    sets[0] ?? NULL_IQA_METRICS,
  ) as (keyof MetricResult)[];
  const out = {} as MetricResult;
  for (const k of keys) out[k] = meanOrNull(sets.map((m) => m[k]));
  return out;
}

/**
 * Mean absolute error between the reference alpha plane and the decode's,
 * both at reference resolution.
 *
 * The alpha plane is upscaled as an opaque greyscale image (R=G=B=alpha) under
 * the same policy as the colour, rather than by resampling RGBA directly:
 * resamplers disagree on whether to premultiply, and that disagreement would
 * land squarely in the number this is meant to measure.
 */
async function alphaPlaneMae(
  referenceRgba: Uint8Array,
  referenceW: number,
  referenceH: number,
  decodedRgba: Uint8Array,
  decodedW: number,
  decodedH: number,
): Promise<number> {
  const asGrey = (rgba: Uint8Array): Uint8Array => {
    const out = new Uint8Array(rgba.length);
    for (let p = 0; p < rgba.length; p += 4) {
      const a = rgba[p + 3] ?? 255;
      out[p] = a;
      out[p + 1] = a;
      out[p + 2] = a;
      out[p + 3] = 255;
    }
    return out;
  };

  const decAlphaAtRef = await upscaleRgba(
    asGrey(decodedRgba),
    decodedW,
    decodedH,
    referenceW,
    referenceH,
    scoringConfig.upscalePolicy,
  );

  let sum = 0;
  let n = 0;
  for (let p = 0; p < referenceRgba.length; p += 4) {
    const refA = referenceRgba[p + 3] ?? 255;
    const decA = decAlphaAtRef[p] ?? 255;
    sum += Math.abs(refA - decA);
    n++;
  }
  return n > 0 ? sum / n / 255 : 0;
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
  const backdrops = scoringConfig.backdrops ?? [ALPHA_BACKDROP];
  const perBackdrop: MetricResult[] = [];
  const perBackdropBlurred: MetricResult[] = [];

  let ringing = NULL_RINGING;
  for (const backdrop of backdrops) {
    const reference = flattenOverBackdrop(referenceRgba, backdrop);
    const decodedFlat = flattenOverBackdrop(decodedRgba, backdrop);

    // Primary backdrop only. Averaging an artifact measure across white/black/
    // grey composites is not meaningful, and it would triple the cost. Never on
    // the blurred set either: blurring both sides destroys the artifact by
    // construction, which is the whole point of the blur-up presentation.
    if ((scoringConfig.ringing ?? true) && ringing === NULL_RINGING) {
      ringing =
        computeRinging(
          reference,
          decodedFlat,
          referenceW,
          referenceH,
          decodedW,
          decodedH,
        ) ?? NULL_RINGING;
    }

    // Composite first, then upscale: the backdrop is part of what is resampled,
    // so hoisting the upscale out of this loop would change the result.
    const decodedAtRef = await upscaleRgba(
      decodedFlat,
      decodedW,
      decodedH,
      referenceW,
      referenceH,
      scoringConfig.upscalePolicy,
    );

    perBackdrop.push(
      await computeIqaMetrics(reference, decodedAtRef, referenceW, referenceH),
    );

    if (scoringConfig.blurredScoring) {
      const sigma = Math.max(1, Math.max(referenceW, referenceH) / 32);
      const [refBlur, decBlur] = await Promise.all([
        blurRgba(reference, referenceW, referenceH, sigma),
        blurRgba(decodedAtRef, referenceW, referenceH, sigma),
      ]);
      perBackdropBlurred.push(
        await computeIqaMetrics(
          refBlur,
          decBlur,
          referenceW,
          referenceH,
          BLURRED_METRICS,
        ),
      );
    }
  }

  // One backdrop is the historical path: return its result untouched rather
  // than round-tripping it through the averaging code.
  const metrics =
    perBackdrop.length === 1
      ? (perBackdrop[0] as MetricResult)
      : averageMetrics(perBackdrop);
  const metricsBlurred =
    perBackdropBlurred.length === 0
      ? null
      : perBackdropBlurred.length === 1
        ? (perBackdropBlurred[0] as MetricResult)
        : averageMetrics(perBackdropBlurred);

  const alphaMae = scoringConfig.alphaFidelity
    ? await alphaPlaneMae(
        referenceRgba,
        referenceW,
        referenceH,
        decodedRgba,
        decodedW,
        decodedH,
      )
    : null;

  return { metrics, metricsBlurred, local: { alphaMae, ...ringing } };
}

/** MetricResult with all fields null — for CSS-only formats that produce no raster output. */
export const NULL_METRICS: MetricResult = NULL_IQA_METRICS;
