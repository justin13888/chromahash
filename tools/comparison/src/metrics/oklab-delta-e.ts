/**
 * OKLAB Delta E (perceptual color difference) for LQIP quality assessment.
 *
 * Converts sRGB pixels to OKLAB and computes Euclidean distance per pixel.
 * OKLAB JND ≈ 0.02; values are directly interpretable in just-noticeable-difference units.
 *
 * Saliency weighting uses local luminance variance in a 3×3 neighborhood —
 * high-variance (structurally important) pixels get more weight.
 */

export interface DeltaEResult {
  /** Unweighted mean dE across all pixels. */
  mean: number;
  /** Luminance-variance saliency-weighted mean dE. */
  weighted: number;
  /** 95th-percentile dE. */
  p95: number;
  /** Maximum dE across all pixels. */
  max: number;
}

function srgbToLinear(u8: number): number {
  const c = u8 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Convert sRGB uint8 values to OKLAB [L, a, b].
 * M1: linear RGB -> LMS; M2: LMS^(1/3) -> OKLAB.
 */
function srgbToOklab(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  // M1: linear RGB -> LMS
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  // Cube root (handles negatives for out-of-gamut colors)
  const lc = Math.cbrt(l);
  const mc = Math.cbrt(m);
  const sc = Math.cbrt(s);

  // M2: LMS^(1/3) -> OKLAB
  const L = 0.2104542553 * lc + 0.793617785 * mc - 0.0040720468 * sc;
  const a = 1.9779984951 * lc - 2.428592205 * mc + 0.4505937099 * sc;
  const bk = 0.0259040371 * lc + 0.7827717662 * mc - 0.808675766 * sc;

  return [L, a, bk];
}

/**
 * Compute OKLAB Delta E statistics between ground truth and decoded RGBA images.
 * Both images must have the same dimensions.
 */
export function computeOklabDeltaE(
  ground: Uint8Array,
  decoded: Uint8Array,
  width: number,
  height: number,
): DeltaEResult {
  const pixelCount = width * height;
  const dE = new Float64Array(pixelCount);
  const groundL = new Float64Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const [gL, gA, gB] = srgbToOklab(
      ground[idx] ?? 0,
      ground[idx + 1] ?? 0,
      ground[idx + 2] ?? 0,
    );
    const [dL, dA, dBk] = srgbToOklab(
      decoded[idx] ?? 0,
      decoded[idx + 1] ?? 0,
      decoded[idx + 2] ?? 0,
    );
    dE[i] = Math.sqrt((gL - dL) ** 2 + (gA - dA) ** 2 + (gB - dBk) ** 2);
    groundL[i] = gL;
  }

  // Saliency weights: local luminance variance in 3×3 neighborhood
  const weights = new Float64Array(pixelCount);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sumL = 0;
      let sumL2 = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const lv = groundL[ny * width + nx] ?? 0;
            sumL += lv;
            sumL2 += lv * lv;
            n++;
          }
        }
      }
      const meanL = sumL / n;
      weights[y * width + x] = sumL2 / n - meanL * meanL;
    }
  }

  // Normalize weights to sum = 1
  let totalWeight = 0;
  for (let i = 0; i < pixelCount; i++) totalWeight += weights[i] ?? 0;
  if (totalWeight > 0) {
    for (let i = 0; i < pixelCount; i++) {
      weights[i] = (weights[i] ?? 0) / totalWeight;
    }
  } else {
    // No variance (solid color) — uniform weights
    const uniform = 1 / pixelCount;
    for (let i = 0; i < pixelCount; i++) weights[i] = uniform;
  }

  // Compute stats
  let meanSum = 0;
  let weightedSum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const v = dE[i] ?? 0;
    meanSum += v;
    weightedSum += v * (weights[i] ?? 0);
  }
  const mean = meanSum / pixelCount;
  const weighted = weightedSum;

  // Percentiles require sorted values
  const sorted = Array.from(dE).sort((x, y) => x - y);
  const p95 = sorted[Math.floor(pixelCount * 0.95)] ?? 0;
  const max = sorted[pixelCount - 1] ?? 0;

  return { mean, weighted, p95, max };
}
