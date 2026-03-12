/**
 * ChromaHash: modern, high-quality image placeholder representation.
 *
 * A direct port of the Rust reference implementation to TypeScript.
 * Produces identical output for the same input across all implementations.
 */

// ---------------------------------------------------------------------------
// Gamut
// ---------------------------------------------------------------------------

/** Source color space identifiers. */
export type Gamut =
  | "sRGB"
  | "Display P3"
  | "Adobe RGB"
  | "BT.2020"
  | "ProPhoto RGB";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MU = 5.0;

const MAX_CHROMA_A = 0.5;
const MAX_CHROMA_B = 0.5;
const MAX_L_SCALE = 0.5;
const MAX_A_SCALE = 0.5;
const MAX_B_SCALE = 0.5;
const MAX_A_ALPHA_SCALE = 0.5;

/** M2: LMS (cube-root) -> OKLAB [L, a, b] (Ottosson). */
const M2: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

/** M2_INV: OKLAB [L, a, b] -> LMS (cube-root). */
const M2_INV: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.0894841775, -1.291485548],
];

/** M1[sRGB]: Linear sRGB -> LMS. */
const M1_SRGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

/** M1[Display P3]: Linear Display P3 -> LMS. */
const M1_DISPLAY_P3: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.4813798544, 0.4621183697, 0.0565017758],
  [0.2288319449, 0.6532168128, 0.1179512422],
  [0.0839457557, 0.2241652689, 0.6918889754],
];

/** M1[Adobe RGB]: Linear Adobe RGB -> LMS. */
const M1_ADOBE_RGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.5764322615, 0.3699132211, 0.0536545174],
  [0.2963164739, 0.5916761266, 0.1120073994],
  [0.1234782548, 0.2194986958, 0.6570230494],
];

/** M1[BT.2020]: Linear BT.2020 -> LMS. */
const M1_BT2020: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.6167557872, 0.3601983994, 0.0230458134],
  [0.265133064, 0.6358393641, 0.0990275718],
  [0.1001026342, 0.2039065194, 0.6959908464],
];

/** M1[ProPhoto RGB]: Linear ProPhoto RGB -> LMS (includes Bradford D50->D65). */
const M1_PROPHOTO_RGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.7154484635, 0.352791548, -0.0682400115],
  [0.2744116551, 0.6677976408, 0.057790704],
  [0.1097844385, 0.1861982875, 0.704017274],
];

/** M1_INV[sRGB]: LMS -> Linear sRGB (decoder matrix). */
const M1_INV_SRGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

function m1Matrix(gamut: Gamut): Mat3 {
  switch (gamut) {
    case "sRGB":
      return M1_SRGB;
    case "Display P3":
      return M1_DISPLAY_P3;
    case "Adobe RGB":
      return M1_ADOBE_RGB;
    case "BT.2020":
      return M1_BT2020;
    case "ProPhoto RGB":
      return M1_PROPHOTO_RGB;
  }
}

// ---------------------------------------------------------------------------
// Helpers for typed-array indexed access under noUncheckedIndexedAccess
// ---------------------------------------------------------------------------

/** Safe indexed read from a Uint8Array (caller must ensure bounds). */
function u8(arr: Uint8Array, i: number): number {
  // biome-lint: the cast is needed because noUncheckedIndexedAccess
  // returns number | undefined, but we guarantee bounds externally.
  return arr[i] as number;
}

/** Safe indexed read from a Float64Array (caller must ensure bounds). */
function f64(arr: Float64Array, i: number): number {
  return arr[i] as number;
}

/** Safe indexed read from a number array (caller must ensure bounds). */
function at(arr: number[], i: number): number {
  return arr[i] as number;
}

/** Safe indexed read from a tuple array (caller must ensure bounds). */
function atPair(arr: Array<[number, number]>, i: number): [number, number] {
  return arr[i] as [number, number];
}

// ---------------------------------------------------------------------------
// Math utilities
// ---------------------------------------------------------------------------

/**
 * Round half away from zero (NOT JS's default Math.round which rounds -0.5 to 0).
 * Per spec: round(x) = floor(x + 0.5) for x >= 0, ceil(x - 0.5) for x < 0.
 */
function roundHalfAwayFromZero(x: number): number {
  if (x >= 0) {
    return Math.floor(x + 0.5);
  }
  return Math.ceil(x - 0.5);
}

/** Signed cube root: cbrt(x) = sign(x) * |x|^(1/3). */
function cbrtSigned(x: number): number {
  if (x === 0) return 0;
  // Use Math.cbrt for precision parity with Rust's .cbrt().
  // Math.pow(x, 1/3) differs by 1 ULP because 1/3 is not exact in IEEE 754.
  // Math.cbrt handles negative values correctly in JS.
  return Math.cbrt(x);
}

/** Clamp to [0, 1]. */
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Clamp to [-1, 1]. */
function clampNeg1_1(x: number): number {
  return Math.min(1, Math.max(-1, x));
}

/** 3x3 matrix * 3-vector. */
function matvec3(
  m: Mat3,
  v: readonly [number, number, number],
): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// ---------------------------------------------------------------------------
// Transfer functions
// ---------------------------------------------------------------------------

/** sRGB EOTF (gamma -> linear). */
function srgbEotf(x: number): number {
  if (x <= 0.04045) {
    return x / 12.92;
  }
  return ((x + 0.055) / 1.055) ** 2.4;
}

/** sRGB gamma (linear -> gamma). */
function srgbGamma(x: number): number {
  if (x <= 0.0031308) {
    return 12.92 * x;
  }
  return 1.055 * x ** (1.0 / 2.4) - 0.055;
}

/** Adobe RGB EOTF (gamma -> linear): x^2.2. */
function adobeRgbEotf(x: number): number {
  return x ** 2.2;
}

/** ProPhoto RGB EOTF (gamma -> linear): x^1.8. */
function proPhotoRgbEotf(x: number): number {
  return x ** 1.8;
}

/** BT.2020 PQ (ST 2084) inverse EOTF -> linear, then Reinhard tone-map to SDR. */
function bt2020PqEotf(x: number): number {
  const M1_PQ = 0.1593017578125;
  const M2_PQ = 78.84375;
  const C1 = 0.8359375;
  const C2 = 18.8515625;
  const C3 = 18.6875;

  const n = x ** (1.0 / M2_PQ);
  const num = Math.max(n - C1, 0);
  const den = C2 - C3 * n;
  const yLinear = (num / den) ** (1.0 / M1_PQ);

  const yNits = yLinear * 10000.0;
  const l = yNits / 203.0;
  return l / (1.0 + l);
}

function eotfForGamut(gamut: Gamut): (x: number) => number {
  switch (gamut) {
    case "sRGB":
    case "Display P3":
      return srgbEotf;
    case "Adobe RGB":
      return adobeRgbEotf;
    case "ProPhoto RGB":
      return proPhotoRgbEotf;
    case "BT.2020":
      return bt2020PqEotf;
  }
}

// ---------------------------------------------------------------------------
// Color conversion
// ---------------------------------------------------------------------------

/** Convert linear RGB to OKLAB using the specified source gamut's M1 matrix. */
function linearRgbToOklab(
  rgb: readonly [number, number, number],
  gamut: Gamut,
): [number, number, number] {
  const m1 = m1Matrix(gamut);
  const lms = matvec3(m1, rgb);
  const lmsCbrt: [number, number, number] = [
    cbrtSigned(lms[0]),
    cbrtSigned(lms[1]),
    cbrtSigned(lms[2]),
  ];
  return matvec3(M2, lmsCbrt);
}

/** Convert OKLAB to linear sRGB. */
function oklabToLinearSrgb(
  lab: readonly [number, number, number],
): [number, number, number] {
  const lmsCbrt = matvec3(M2_INV, lab);
  const lms: [number, number, number] = [
    lmsCbrt[0] * lmsCbrt[0] * lmsCbrt[0],
    lmsCbrt[1] * lmsCbrt[1] * lmsCbrt[1],
    lmsCbrt[2] * lmsCbrt[2] * lmsCbrt[2],
  ];
  return matvec3(M1_INV_SRGB, lms);
}

/** Convert gamma-encoded source RGB to OKLAB. */
function gammaRgbToOklab(
  r: number,
  g: number,
  b: number,
  gamut: Gamut,
): [number, number, number] {
  const eotf = eotfForGamut(gamut);
  return linearRgbToOklab([eotf(r), eotf(g), eotf(b)], gamut);
}

/** Convert OKLAB to gamma-encoded sRGB [0,1] with clamping. */
function oklabToSrgb(
  lab: readonly [number, number, number],
): [number, number, number] {
  const rgbLinear = oklabToLinearSrgb(lab);
  return [
    srgbGamma(clamp01(rgbLinear[0])),
    srgbGamma(clamp01(rgbLinear[1])),
    srgbGamma(clamp01(rgbLinear[2])),
  ];
}

// ---------------------------------------------------------------------------
// mu-law companding
// ---------------------------------------------------------------------------

/** mu-law compress: value in [-1, 1] -> compressed in [-1, 1]. */
function muCompress(value: number): number {
  const v = clampNeg1_1(value);
  return (Math.sign(v) * Math.log(1.0 + MU * Math.abs(v))) / Math.log(1.0 + MU);
}

/** mu-law expand: compressed in [-1, 1] -> value in [-1, 1]. */
function muExpand(compressed: number): number {
  return (
    (Math.sign(compressed) * ((1.0 + MU) ** Math.abs(compressed) - 1.0)) / MU
  );
}

/** Quantize a value in [-1, 1] using mu-law to an integer index. */
function muLawQuantize(value: number, bits: number): number {
  const compressed = muCompress(value);
  const maxVal = (1 << bits) - 1;
  const index = roundHalfAwayFromZero(((compressed + 1.0) / 2.0) * maxVal);
  return Math.min(maxVal, Math.max(0, index));
}

/** Dequantize an integer index back to a value in [-1, 1] using mu-law. */
function muLawDequantize(index: number, bits: number): number {
  const maxVal = (1 << bits) - 1;
  const compressed = (index / maxVal) * 2.0 - 1.0;
  return muExpand(compressed);
}

// ---------------------------------------------------------------------------
// Bit packing
// ---------------------------------------------------------------------------

/** Write `count` bits of `value` starting at `bitpos` in little-endian byte order. */
function writeBits(
  hash: Uint8Array,
  bitpos: number,
  count: number,
  value: number,
): void {
  for (let i = 0; i < count; i++) {
    const byteIdx = (bitpos + i) >> 3;
    const bitIdx = (bitpos + i) & 7;
    if (((value >> i) & 1) !== 0) {
      hash[byteIdx] = (u8(hash, byteIdx) | (1 << bitIdx)) & 0xff;
    }
  }
}

/** Read `count` bits starting at `bitpos` in little-endian byte order. */
function readBits(hash: Uint8Array, bitpos: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const byteIdx = (bitpos + i) >> 3;
    const bitIdx = (bitpos + i) & 7;
    if ((u8(hash, byteIdx) & (1 << bitIdx)) !== 0) {
      value |= 1 << i;
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Aspect ratio
// ---------------------------------------------------------------------------

/** Encode aspect ratio as a single byte. */
function encodeAspect(w: number, h: number): number {
  const ratio = w / h;
  const raw = ((Math.log2(ratio) + 2.0) / 4.0) * 255.0;
  const byte = roundHalfAwayFromZero(raw);
  return Math.min(255, Math.max(0, byte));
}

/** Decode aspect ratio from byte. */
function decodeAspect(byte: number): number {
  return 2 ** ((byte / 255.0) * 4.0 - 2.0);
}

/** Decode output size from aspect byte. Longer side = 32px. */
function decodeOutputSize(byte: number): [number, number] {
  const ratio = decodeAspect(byte);
  if (ratio > 1.0) {
    const h = Math.max(1, roundHalfAwayFromZero(32.0 / ratio));
    return [32, h];
  }
  const w = Math.max(1, roundHalfAwayFromZero(32.0 * ratio));
  return [w, 32];
}

// ---------------------------------------------------------------------------
// DCT
// ---------------------------------------------------------------------------

/** Compute the triangular scan order for an nx*ny grid, excluding DC. */
function triangularScanOrder(nx: number, ny: number): Array<[number, number]> {
  const order: Array<[number, number]> = [];
  for (let cy = 0; cy < ny; cy++) {
    const cxStart = cy === 0 ? 1 : 0;
    let cx = cxStart;
    while (cx * ny < nx * (ny - cy)) {
      order.push([cx, cy]);
      cx += 1;
    }
  }
  return order;
}

/**
 * Forward DCT encode for a channel.
 * Returns [dc, acCoefficients, scale].
 */
function dctEncode(
  channel: Float64Array,
  w: number,
  h: number,
  nx: number,
  ny: number,
): [number, number[], number] {
  const wh = w * h;
  let dc = 0;
  const ac: number[] = [];
  let scale = 0;

  for (let cy = 0; cy < ny; cy++) {
    let cx = 0;
    while (cx * ny < nx * (ny - cy)) {
      let f = 0;
      for (let y = 0; y < h; y++) {
        const fy = Math.cos((Math.PI / h) * cy * (y + 0.5));
        for (let x = 0; x < w; x++) {
          f +=
            f64(channel, x + y * w) *
            Math.cos((Math.PI / w) * cx * (x + 0.5)) *
            fy;
        }
      }
      f /= wh;
      if (cx > 0 || cy > 0) {
        ac.push(f);
        scale = Math.max(scale, Math.abs(f));
      } else {
        dc = f;
      }
      cx += 1;
    }
  }

  // Floor near-zero scale to exactly zero for cross-platform consistency
  if (scale < 1e-10) {
    ac.fill(0);
    scale = 0;
  }

  return [dc, ac, scale];
}

/** Inverse DCT at a single pixel (x, y) for a channel. */
function dctDecodePixel(
  dc: number,
  ac: number[],
  scanOrder: Array<[number, number]>,
  x: number,
  y: number,
  w: number,
  h: number,
): number {
  let value = dc;
  for (let j = 0; j < scanOrder.length; j++) {
    const [cx, cy] = atPair(scanOrder, j);
    const cxFactor = cx > 0 ? 2.0 : 1.0;
    const cyFactor = cy > 0 ? 2.0 : 1.0;
    const fx = Math.cos((Math.PI / w) * cx * (x + 0.5));
    const fy = Math.cos((Math.PI / h) * cy * (y + 0.5));
    value += at(ac, j) * fx * fy * cxFactor * cyFactor;
  }
  return value;
}

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

// Export internal functions for unit testing
export {
  roundHalfAwayFromZero as _roundHalfAwayFromZero,
  cbrtSigned as _cbrtSigned,
  linearRgbToOklab as _linearRgbToOklab,
  oklabToLinearSrgb as _oklabToLinearSrgb,
  gammaRgbToOklab as _gammaRgbToOklab,
  oklabToSrgb as _oklabToSrgb,
  muCompress as _muCompress,
  muExpand as _muExpand,
  muLawQuantize as _muLawQuantize,
  muLawDequantize as _muLawDequantize,
  encodeAspect as _encodeAspect,
  decodeAspect as _decodeAspect,
  decodeOutputSize as _decodeOutputSize,
  triangularScanOrder as _triangularScanOrder,
};
