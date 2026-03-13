import sharp from "sharp";

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
 * Compute PSNR (Peak Signal-to-Noise Ratio) between original and decoded RGBA images.
 *
 * If the images have different dimensions, the decoded image is resized to match
 * the original before computing PSNR.
 *
 * Returns PSNR in dB. Higher is better. Returns Infinity for identical images.
 */
export function computePsnr(
  originalRgba: Uint8Array,
  originalW: number,
  originalH: number,
  decodedRgba: Uint8Array,
  decodedW: number,
  decodedH: number,
): number {
  // If dimensions match, compare directly
  if (originalW === decodedW && originalH === decodedH) {
    return psnrFromPixels(originalRgba, decodedRgba);
  }

  // Otherwise, we do a simple nearest-neighbor resample of decoded to original size
  const resampledRgba = resampleNearest(
    decodedRgba,
    decodedW,
    decodedH,
    originalW,
    originalH,
  );
  return psnrFromPixels(originalRgba, resampledRgba);
}

function psnrFromPixels(a: Uint8Array, b: Uint8Array): number {
  const pixelCount = a.length / 4;
  let mse = 0;

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    // Compare RGB channels only (ignore alpha for PSNR)
    for (let c = 0; c < 3; c++) {
      const diff = (a[idx + c] ?? 0) - (b[idx + c] ?? 0);
      mse += diff * diff;
    }
  }

  mse /= pixelCount * 3;

  if (mse === 0) return Number.POSITIVE_INFINITY;
  return 10 * Math.log10((255 * 255) / mse);
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
