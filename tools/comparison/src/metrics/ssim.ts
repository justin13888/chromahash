/**
 * SSIM/DSSIM implementation for LQIP quality assessment.
 *
 * Uses Gaussian-windowed (up to 11x11) structural similarity over the luminance channel.
 * Constants: C1=(0.01*255)², C2=(0.03*255)² (Wang et al., 2004).
 */

const C1 = (0.01 * 255) ** 2; // 6.5025
const C2 = (0.03 * 255) ** 2; // 58.5225
const SIGMA = 1.5;

function buildGaussianKernel(kSize: number): Float64Array {
  const half = Math.floor(kSize / 2);
  const kernel = new Float64Array(kSize * kSize);
  let sum = 0;
  for (let ky = 0; ky < kSize; ky++) {
    for (let kx = 0; kx < kSize; kx++) {
      const dx = kx - half;
      const dy = ky - half;
      const v = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
      kernel[ky * kSize + kx] = v;
      sum += v;
    }
  }
  for (let i = 0; i < kernel.length; i++) {
    kernel[i] = (kernel[i] ?? 0) / sum;
  }
  return kernel;
}

function rgbaToLuma(rgba: Uint8Array, pixelCount: number): Float64Array {
  const luma = new Float64Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    luma[i] =
      0.299 * (rgba[idx] ?? 0) +
      0.587 * (rgba[idx + 1] ?? 0) +
      0.114 * (rgba[idx + 2] ?? 0);
  }
  return luma;
}

/**
 * Compute DSSIM = (1 - SSIM) / 2 between two RGBA images at identical resolution.
 *
 * Lower is better; 0 = identical, ~0.5 = completely dissimilar.
 * Images must have the same dimensions; comparison is over luminance only.
 */
export function computeDssim(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
): number {
  const pixelCount = width * height;
  const lumaA = rgbaToLuma(a, pixelCount);
  const lumaB = rgbaToLuma(b, pixelCount);

  // Window size: up to 11x11, must be odd, must fit in the image
  let kSize = Math.min(11, width, height);
  if (kSize % 2 === 0) kSize -= 1;
  if (kSize < 1) return 0;

  const kernel = buildGaussianKernel(kSize);
  const half = Math.floor(kSize / 2);

  let ssimSum = 0;
  let windowCount = 0;

  for (let py = half; py < height - half; py++) {
    for (let px = half; px < width - half; px++) {
      let muA = 0;
      let muB = 0;

      for (let ky = 0; ky < kSize; ky++) {
        for (let kx = 0; kx < kSize; kx++) {
          const wt = kernel[ky * kSize + kx] ?? 0;
          const idx = (py + ky - half) * width + (px + kx - half);
          muA += wt * (lumaA[idx] ?? 0);
          muB += wt * (lumaB[idx] ?? 0);
        }
      }

      let varA = 0;
      let varB = 0;
      let covAB = 0;

      for (let ky = 0; ky < kSize; ky++) {
        for (let kx = 0; kx < kSize; kx++) {
          const wt = kernel[ky * kSize + kx] ?? 0;
          const idx = (py + ky - half) * width + (px + kx - half);
          const dA = (lumaA[idx] ?? 0) - muA;
          const dB = (lumaB[idx] ?? 0) - muB;
          varA += wt * dA * dA;
          varB += wt * dB * dB;
          covAB += wt * dA * dB;
        }
      }

      const num = (2 * muA * muB + C1) * (2 * covAB + C2);
      const den = (muA * muA + muB * muB + C1) * (varA + varB + C2);
      ssimSum += num / den;
      windowCount++;
    }
  }

  if (windowCount === 0) return 0;
  const ssim = ssimSum / windowCount;
  return (1 - ssim) / 2;
}
