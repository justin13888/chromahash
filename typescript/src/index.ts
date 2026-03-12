/**
 * ChromaHash: modern, high-quality image placeholder representation.
 *
 * A direct port of the Rust reference implementation to TypeScript.
 * Produces identical output for the same input across all implementations.
 */

export type { Gamut } from "./internals.ts";
import type { Gamut } from "./internals.ts";
import {
  at,
  atPair,
  clamp01,
  clampNeg1_1,
  dctDecodePixel,
  dctEncode,
  decodeOutputSize,
  encodeAspect,
  f64,
  gammaRgbToOklab,
  MAX_A_ALPHA_SCALE,
  MAX_A_SCALE,
  MAX_B_SCALE,
  MAX_CHROMA_A,
  MAX_CHROMA_B,
  MAX_L_SCALE,
  muLawDequantize,
  muLawQuantize,
  oklabToSrgb,
  readBits,
  roundHalfAwayFromZero,
  triangularScanOrder,
  u8,
  writeBits,
} from "./internals.ts";

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function encodeImpl(
  w: number,
  h: number,
  rgba: Uint8Array,
  gamut: Gamut,
): Uint8Array {
  if (w < 1 || w > 100) throw new Error("width must be 1-100");
  if (h < 1 || h > 100) throw new Error("height must be 1-100");
  if (rgba.length !== w * h * 4) throw new Error("rgba length mismatch");

  const pixelCount = w * h;

  // 1-2. Convert all pixels to OKLAB, accumulate alpha-weighted average
  const oklabL = new Float64Array(pixelCount);
  const oklabA = new Float64Array(pixelCount);
  const oklabB = new Float64Array(pixelCount);
  const alphaPixels = new Float64Array(pixelCount);
  let avgL = 0;
  let avgA = 0;
  let avgB = 0;
  let avgAlpha = 0;

  for (let i = 0; i < pixelCount; i++) {
    const r = u8(rgba, i * 4) / 255.0;
    const g = u8(rgba, i * 4 + 1) / 255.0;
    const b = u8(rgba, i * 4 + 2) / 255.0;
    const a = u8(rgba, i * 4 + 3) / 255.0;

    const lab = gammaRgbToOklab(r, g, b, gamut);

    avgL += a * lab[0];
    avgA += a * lab[1];
    avgB += a * lab[2];
    avgAlpha += a;

    oklabL[i] = lab[0];
    oklabA[i] = lab[1];
    oklabB[i] = lab[2];
    alphaPixels[i] = a;
  }

  // 3. Compute alpha-weighted average color
  if (avgAlpha > 0) {
    avgL /= avgAlpha;
    avgA /= avgAlpha;
    avgB /= avgAlpha;
  }

  // 4. Composite transparent pixels over average
  const hasAlpha = avgAlpha < pixelCount;
  const lChan = new Float64Array(pixelCount);
  const aChan = new Float64Array(pixelCount);
  const bChan = new Float64Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    const alpha = f64(alphaPixels, i);
    lChan[i] = avgL * (1.0 - alpha) + alpha * f64(oklabL, i);
    aChan[i] = avgA * (1.0 - alpha) + alpha * f64(oklabA, i);
    bChan[i] = avgB * (1.0 - alpha) + alpha * f64(oklabB, i);
  }

  // 5. DCT encode each channel
  const [lDc, lAc, lScale] = hasAlpha
    ? dctEncode(lChan, w, h, 6, 6)
    : dctEncode(lChan, w, h, 7, 7);
  const [aDc, aAc, aScale] = dctEncode(aChan, w, h, 4, 4);
  const [bDc, bAc, bScale] = dctEncode(bChan, w, h, 4, 4);
  const [alphaDc, alphaAc, alphaScale] = hasAlpha
    ? dctEncode(alphaPixels, w, h, 3, 3)
    : [0, [] as number[], 0];

  // 6. Quantize header values
  const lDcQ = roundHalfAwayFromZero(127.0 * clamp01(lDc));
  const aDcQ = roundHalfAwayFromZero(
    64.0 + 63.0 * clampNeg1_1(aDc / MAX_CHROMA_A),
  );
  const bDcQ = roundHalfAwayFromZero(
    64.0 + 63.0 * clampNeg1_1(bDc / MAX_CHROMA_B),
  );
  const lSclQ = roundHalfAwayFromZero(63.0 * clamp01(lScale / MAX_L_SCALE));
  const aSclQ = roundHalfAwayFromZero(63.0 * clamp01(aScale / MAX_A_SCALE));
  const bSclQ = roundHalfAwayFromZero(31.0 * clamp01(bScale / MAX_B_SCALE));

  // 7. Compute aspect byte
  const aspect = encodeAspect(w, h);

  // 8. Pack header (48 bits = 6 bytes)
  const hash = new Uint8Array(32);

  writeBits(hash, 0, 7, lDcQ);
  writeBits(hash, 7, 7, aDcQ);
  writeBits(hash, 14, 7, bDcQ);
  writeBits(hash, 21, 6, lSclQ);
  writeBits(hash, 27, 6, aSclQ);
  writeBits(hash, 33, 5, bSclQ);
  writeBits(hash, 38, 8, aspect);
  writeBits(hash, 46, 1, hasAlpha ? 1 : 0);
  // bit 47 reserved = 0

  // 9. Pack AC coefficients with mu-law companding
  let bitpos = 48;

  const quantizeAc = (value: number, scl: number, bits: number): number => {
    if (scl === 0) {
      return muLawQuantize(0, bits);
    }
    return muLawQuantize(value / scl, bits);
  };

  if (hasAlpha) {
    const alphaDcQ = roundHalfAwayFromZero(31.0 * clamp01(alphaDc));
    const alphaSclQ = roundHalfAwayFromZero(
      15.0 * clamp01(alphaScale / MAX_A_ALPHA_SCALE),
    );
    writeBits(hash, bitpos, 5, alphaDcQ);
    bitpos += 5;
    writeBits(hash, bitpos, 4, alphaSclQ);
    bitpos += 4;

    // L AC: first 7 at 6 bits, remaining 13 at 5 bits
    for (let i = 0; i < 7; i++) {
      const q = quantizeAc(at(lAc, i), lScale, 6);
      writeBits(hash, bitpos, 6, q);
      bitpos += 6;
    }
    for (let i = 7; i < 20; i++) {
      const q = quantizeAc(at(lAc, i), lScale, 5);
      writeBits(hash, bitpos, 5, q);
      bitpos += 5;
    }
  } else {
    // L AC: all 27 at 5 bits
    for (let i = 0; i < 27; i++) {
      const q = quantizeAc(at(lAc, i), lScale, 5);
      writeBits(hash, bitpos, 5, q);
      bitpos += 5;
    }
  }

  // a AC: 9 at 4 bits
  for (let i = 0; i < aAc.length; i++) {
    const q = quantizeAc(at(aAc, i), aScale, 4);
    writeBits(hash, bitpos, 4, q);
    bitpos += 4;
  }

  // b AC: 9 at 4 bits
  for (let i = 0; i < bAc.length; i++) {
    const q = quantizeAc(at(bAc, i), bScale, 4);
    writeBits(hash, bitpos, 4, q);
    bitpos += 4;
  }

  if (hasAlpha) {
    // Alpha AC: 5 at 4 bits
    for (let i = 0; i < alphaAc.length; i++) {
      const q = quantizeAc(at(alphaAc, i), alphaScale, 4);
      writeBits(hash, bitpos, 4, q);
      bitpos += 4;
    }
  }

  return hash;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

function decodeImpl(hash: Uint8Array): {
  w: number;
  h: number;
  rgba: Uint8Array;
} {
  // 1. Unpack header (48 bits)
  const lDcQ = readBits(hash, 0, 7);
  const aDcQ = readBits(hash, 7, 7);
  const bDcQ = readBits(hash, 14, 7);
  const lSclQ = readBits(hash, 21, 6);
  const aSclQ = readBits(hash, 27, 6);
  const bSclQ = readBits(hash, 33, 5);
  const aspect = readBits(hash, 38, 8);
  const hasAlpha = readBits(hash, 46, 1) === 1;

  // 2. Decode DC values and scale factors
  const lDc = lDcQ / 127.0;
  const aDc = ((aDcQ - 64.0) / 63.0) * MAX_CHROMA_A;
  const bDc = ((bDcQ - 64.0) / 63.0) * MAX_CHROMA_B;
  const lScale = (lSclQ / 63.0) * MAX_L_SCALE;
  const aScale = (aSclQ / 63.0) * MAX_A_SCALE;
  const bScale = (bSclQ / 31.0) * MAX_B_SCALE;

  // 3-4. Decode aspect ratio and compute output size
  const [w, h] = decodeOutputSize(aspect);

  // 5. Dequantize AC coefficients
  let bitpos = 48;

  let alphaDcVal: number;
  let alphaScaleVal: number;
  if (hasAlpha) {
    alphaDcVal = readBits(hash, bitpos, 5) / 31.0;
    bitpos += 5;
    alphaScaleVal = (readBits(hash, bitpos, 4) / 15.0) * MAX_A_ALPHA_SCALE;
    bitpos += 4;
  } else {
    alphaDcVal = 1.0;
    alphaScaleVal = 0.0;
  }

  let lAc: number[];
  let lx: number;
  let ly: number;
  if (hasAlpha) {
    lAc = [];
    for (let i = 0; i < 7; i++) {
      const q = readBits(hash, bitpos, 6);
      bitpos += 6;
      lAc.push(muLawDequantize(q, 6) * lScale);
    }
    for (let i = 7; i < 20; i++) {
      const q = readBits(hash, bitpos, 5);
      bitpos += 5;
      lAc.push(muLawDequantize(q, 5) * lScale);
    }
    lx = 6;
    ly = 6;
  } else {
    lAc = [];
    for (let i = 0; i < 27; i++) {
      const q = readBits(hash, bitpos, 5);
      bitpos += 5;
      lAc.push(muLawDequantize(q, 5) * lScale);
    }
    lx = 7;
    ly = 7;
  }

  const aAc: number[] = [];
  for (let i = 0; i < 9; i++) {
    const q = readBits(hash, bitpos, 4);
    bitpos += 4;
    aAc.push(muLawDequantize(q, 4) * aScale);
  }

  const bAc: number[] = [];
  for (let i = 0; i < 9; i++) {
    const q = readBits(hash, bitpos, 4);
    bitpos += 4;
    bAc.push(muLawDequantize(q, 4) * bScale);
  }

  let alphaAc: number[] = [];
  if (hasAlpha) {
    alphaAc = [];
    for (let i = 0; i < 5; i++) {
      const q = readBits(hash, bitpos, 4);
      bitpos += 4;
      alphaAc.push(muLawDequantize(q, 4) * alphaScaleVal);
    }
  }

  // Precompute scan orders
  const lScan = triangularScanOrder(lx, ly);
  const chromaScan = triangularScanOrder(4, 4);
  const alphaScan = hasAlpha ? triangularScanOrder(3, 3) : [];

  // 6. Render output image
  const rgbaOut = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = dctDecodePixel(lDc, lAc, lScan, x, y, w, h);
      const a = dctDecodePixel(aDc, aAc, chromaScan, x, y, w, h);
      const b = dctDecodePixel(bDc, bAc, chromaScan, x, y, w, h);
      const alpha = hasAlpha
        ? dctDecodePixel(alphaDcVal, alphaAc, alphaScan, x, y, w, h)
        : 1.0;

      const srgb = oklabToSrgb([l, a, b]);
      const idx = (y * w + x) * 4;
      rgbaOut[idx] = roundHalfAwayFromZero(255.0 * clamp01(srgb[0]));
      rgbaOut[idx + 1] = roundHalfAwayFromZero(255.0 * clamp01(srgb[1]));
      rgbaOut[idx + 2] = roundHalfAwayFromZero(255.0 * clamp01(srgb[2]));
      rgbaOut[idx + 3] = roundHalfAwayFromZero(255.0 * clamp01(alpha));
    }
  }

  return { w, h, rgba: rgbaOut };
}

/** Extract the average color from a ChromaHash without full decode. */
function averageColorImpl(hash: Uint8Array): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  const lDcQ = readBits(hash, 0, 7);
  const aDcQ = readBits(hash, 7, 7);
  const bDcQ = readBits(hash, 14, 7);
  const hasAlpha = readBits(hash, 46, 1) === 1;

  const lDc = lDcQ / 127.0;
  const aDc = ((aDcQ - 64.0) / 63.0) * MAX_CHROMA_A;
  const bDc = ((bDcQ - 64.0) / 63.0) * MAX_CHROMA_B;

  const srgb = oklabToSrgb([lDc, aDc, bDc]);

  const alpha = hasAlpha ? readBits(hash, 48, 5) / 31.0 : 1.0;

  return {
    r: roundHalfAwayFromZero(255.0 * clamp01(srgb[0])),
    g: roundHalfAwayFromZero(255.0 * clamp01(srgb[1])),
    b: roundHalfAwayFromZero(255.0 * clamp01(srgb[2])),
    a: roundHalfAwayFromZero(255.0 * clamp01(alpha)),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class ChromaHash {
  readonly hash: Uint8Array;

  private constructor(hash: Uint8Array) {
    this.hash = hash;
  }

  /**
   * Encode an image into a ChromaHash.
   *
   * @param w - Image width (1-100)
   * @param h - Image height (1-100)
   * @param rgba - Pixel data in RGBA format (4 bytes per pixel)
   * @param gamut - Source color space
   */
  static encode(
    w: number,
    h: number,
    rgba: Uint8Array,
    gamut: Gamut,
  ): ChromaHash {
    return new ChromaHash(encodeImpl(w, h, rgba, gamut));
  }

  /**
   * Decode a ChromaHash into an RGBA image.
   * Returns the decoded width, height, and RGBA pixel data.
   */
  decode(): { w: number; h: number; rgba: Uint8Array } {
    return decodeImpl(this.hash);
  }

  /**
   * Extract the average color without full decode.
   * Returns RGBA values as 0-255 integers.
   */
  averageColor(): { r: number; g: number; b: number; a: number } {
    return averageColorImpl(this.hash);
  }

  /**
   * Create a ChromaHash from raw 32-byte data.
   */
  static fromBytes(bytes: Uint8Array): ChromaHash {
    if (bytes.length !== 32) {
      throw new Error("ChromaHash must be exactly 32 bytes");
    }
    return new ChromaHash(new Uint8Array(bytes));
  }
}
