/**
 * Upscale policies for bringing a decoded placeholder to display resolution.
 *
 * Which resampler models "what the viewer sees" is a real methodological
 * choice, so the harness supports both and stamps the active policy into the
 * report:
 *
 * - `browser-gamma` (primary): resample in gamma-encoded sRGB with a smooth
 *   kernel (Mitchell). Browsers upscale `<img>` elements in gamma space with
 *   bilinear/smooth filtering, so this is closest to the placeholder's real
 *   on-screen appearance. Mitchell over bilinear avoids sharp's bilinear
 *   blockiness at large factors while staying overshoot-free.
 * - `linear-lanczos`: decode sRGB to linear light, separable Lanczos-3, then
 *   re-encode. This is the signal-processing-correct resample; it measures
 *   reconstruction fidelity independent of browser rendering quirks. Pure TS
 *   because sharp exposes no linear-light resize on raw buffers; inputs are
 *   placeholder-sized so the cost is negligible.
 */

import sharp from "sharp";

export type UpscalePolicy = "browser-gamma" | "linear-lanczos";

/** sRGB EOTF (gamma → linear), on [0, 1]. */
function srgbToLinear(x: number): number {
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** sRGB inverse EOTF (linear → gamma), on [0, 1]. */
function linearToSrgb(x: number): number {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** Lanczos-3 kernel. */
function lanczos3(x: number): number {
  const ax = Math.abs(x);
  if (ax < 1e-8) return 1;
  if (ax >= 3) return 0;
  const pix = Math.PI * x;
  return (3 * Math.sin(pix) * Math.sin(pix / 3)) / (pix * pix);
}

/** Precomputed filter taps for one output row/column axis. */
interface AxisTaps {
  /** For each output index: first source index and normalized weights. */
  start: Int32Array;
  weights: Float64Array;
  tapCount: number;
}

/**
 * Build separable Lanczos-3 taps mapping `src` samples to `dst` samples.
 * Uses the standard pixel-center convention: srcPos = (i + 0.5)·(src/dst) − 0.5.
 * When downscaling, the kernel is widened by the scale factor (anti-aliasing).
 */
function buildTaps(src: number, dst: number): AxisTaps {
  const ratio = src / dst;
  const scale = Math.max(1, ratio); // kernel support widening for downscale
  const support = 3 * scale;
  const tapCount = Math.ceil(support * 2) + 1;
  const start = new Int32Array(dst);
  const weights = new Float64Array(dst * tapCount);

  for (let i = 0; i < dst; i++) {
    const center = (i + 0.5) * ratio - 0.5;
    const first = Math.floor(center - support);
    start[i] = first;
    let sum = 0;
    for (let t = 0; t < tapCount; t++) {
      const srcIdx = first + t;
      const w = lanczos3((srcIdx - center) / scale);
      weights[i * tapCount + t] = w;
      sum += w;
    }
    if (sum !== 0) {
      for (let t = 0; t < tapCount; t++) {
        weights[i * tapCount + t] = (weights[i * tapCount + t] ?? 0) / sum;
      }
    }
  }
  return { start, weights, tapCount };
}

/** Clamp a source index to [0, n-1] (edge extension). */
function clampIdx(i: number, n: number): number {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Separable Lanczos-3 resample of an interleaved float image (any channel
 * count), operating in whatever space the floats are in.
 */
function resampleFloat(
  src: Float64Array,
  sw: number,
  sh: number,
  tw: number,
  th: number,
  channels: number,
): Float64Array {
  // Horizontal pass: (sw × sh) → (tw × sh)
  const xTaps = buildTaps(sw, tw);
  const mid = new Float64Array(tw * sh * channels);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < tw; x++) {
      const first = xTaps.start[x] ?? 0;
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let t = 0; t < xTaps.tapCount; t++) {
          const sx = clampIdx(first + t, sw);
          acc +=
            (xTaps.weights[x * xTaps.tapCount + t] ?? 0) *
            (src[(y * sw + sx) * channels + c] ?? 0);
        }
        mid[(y * tw + x) * channels + c] = acc;
      }
    }
  }
  // Vertical pass: (tw × sh) → (tw × th)
  const yTaps = buildTaps(sh, th);
  const out = new Float64Array(tw * th * channels);
  for (let y = 0; y < th; y++) {
    const first = yTaps.start[y] ?? 0;
    for (let x = 0; x < tw; x++) {
      for (let c = 0; c < channels; c++) {
        let acc = 0;
        for (let t = 0; t < yTaps.tapCount; t++) {
          const sy = clampIdx(first + t, sh);
          acc +=
            (yTaps.weights[y * yTaps.tapCount + t] ?? 0) *
            (mid[(sy * tw + x) * channels + c] ?? 0);
        }
        out[(y * tw + x) * channels + c] = acc;
      }
    }
  }
  return out;
}

/** Linear-light Lanczos-3 resample of opaque RGBA bytes (alpha forced to 255). */
function upscaleLinearLanczos(
  rgba: Uint8Array,
  sw: number,
  sh: number,
  tw: number,
  th: number,
): Uint8Array {
  // 256-entry EOTF LUT; the inverse runs on floats.
  const eotf = new Float64Array(256);
  for (let i = 0; i < 256; i++) eotf[i] = srgbToLinear(i / 255);

  const pixels = sw * sh;
  const linear = new Float64Array(pixels * 3);
  for (let p = 0; p < pixels; p++) {
    linear[p * 3] = eotf[rgba[p * 4] ?? 0] ?? 0;
    linear[p * 3 + 1] = eotf[rgba[p * 4 + 1] ?? 0] ?? 0;
    linear[p * 3 + 2] = eotf[rgba[p * 4 + 2] ?? 0] ?? 0;
  }

  const resized = resampleFloat(linear, sw, sh, tw, th, 3);

  const out = new Uint8Array(tw * th * 4);
  for (let p = 0; p < tw * th; p++) {
    for (let c = 0; c < 3; c++) {
      const lin = Math.min(1, Math.max(0, resized[p * 3 + c] ?? 0));
      out[p * 4 + c] = Math.round(255 * linearToSrgb(lin));
    }
    out[p * 4 + 3] = 255;
  }
  return out;
}

/**
 * Upscale (or generally resample) opaque RGBA to target dimensions under the
 * given policy. Inputs are expected to be flattened (opaque) already — alpha
 * handling is a scoring-policy concern that happens before resampling.
 */
export async function upscaleRgba(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number,
  policy: UpscalePolicy,
): Promise<Uint8Array> {
  if (srcW === targetW && srcH === targetH) {
    return rgba;
  }
  if (policy === "linear-lanczos") {
    return upscaleLinearLanczos(rgba, srcW, srcH, targetW, targetH);
  }
  // browser-gamma: gamma-space Mitchell via sharp, stretched to the target
  // aspect (fit: "fill") the way a browser stretches an <img> with explicit
  // dimensions.
  const { data } = await sharp(Buffer.from(rgba), {
    raw: { width: srcW, height: srcH, channels: 4 },
  })
    .resize(targetW, targetH, { kernel: "mitchell", fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}
