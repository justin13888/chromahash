/**
 * Internal helpers for ChromaHash — not part of the public API.
 * Exported for unit testing only.
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

export const MU = 5.0;

export const MAX_CHROMA_A = 0.5;
export const MAX_CHROMA_B = 0.5;
export const MAX_L_SCALE = 0.5;
export const MAX_A_SCALE = 0.5;
export const MAX_B_SCALE = 0.5;
export const MAX_A_ALPHA_SCALE = 0.5;

/** M2: LMS (cube-root) -> OKLAB [L, a, b] (Ottosson). */
export const M2: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

/** M2_INV: OKLAB [L, a, b] -> LMS (cube-root). */
export const M2_INV: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.0894841775, -1.291485548],
];

/** M1[sRGB]: Linear sRGB -> LMS. */
export const M1_SRGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

/** M1[Display P3]: Linear Display P3 -> LMS. */
export const M1_DISPLAY_P3: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.4813798544, 0.4621183697, 0.0565017758],
  [0.2288319449, 0.6532168128, 0.1179512422],
  [0.0839457557, 0.2241652689, 0.6918889754],
];

/** M1[Adobe RGB]: Linear Adobe RGB -> LMS. */
export const M1_ADOBE_RGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.5764322615, 0.3699132211, 0.0536545174],
  [0.2963164739, 0.5916761266, 0.1120073994],
  [0.1234782548, 0.2194986958, 0.6570230494],
];

/** M1[BT.2020]: Linear BT.2020 -> LMS. */
export const M1_BT2020: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.6167557872, 0.3601983994, 0.0230458134],
  [0.265133064, 0.6358393641, 0.0990275718],
  [0.1001026342, 0.2039065194, 0.6959908464],
];

/** M1[ProPhoto RGB]: Linear ProPhoto RGB -> LMS (includes Bradford D50->D65). */
export const M1_PROPHOTO_RGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [0.7154484635, 0.352791548, -0.0682400115],
  [0.2744116551, 0.6677976408, 0.057790704],
  [0.1097844385, 0.1861982875, 0.704017274],
];

/** M1_INV[sRGB]: LMS -> Linear sRGB (decoder matrix). */
export const M1_INV_SRGB: readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
] = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

export type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

export function m1Matrix(gamut: Gamut): Mat3 {
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
export function u8(arr: Uint8Array, i: number): number {
  return arr[i] as number;
}

/** Safe indexed read from a Float64Array (caller must ensure bounds). */
export function f64(arr: Float64Array, i: number): number {
  return arr[i] as number;
}

/** Safe indexed read from a number array (caller must ensure bounds). */
export function at(arr: number[], i: number): number {
  return arr[i] as number;
}

/** Safe indexed read from a tuple array (caller must ensure bounds). */
export function atPair(
  arr: Array<[number, number]>,
  i: number,
): [number, number] {
  return arr[i] as [number, number];
}

// ---------------------------------------------------------------------------
// Math utilities
// ---------------------------------------------------------------------------

/**
 * Round half away from zero (NOT JS's default Math.round which rounds -0.5 to 0).
 * Per spec: round(x) = floor(x + 0.5) for x >= 0, ceil(x - 0.5) for x < 0.
 */
export function roundHalfAwayFromZero(x: number): number {
  if (x >= 0) {
    return Math.floor(x + 0.5);
  }
  return Math.ceil(x - 0.5);
}

/** Signed cube root: cbrt(x) = sign(x) * |x|^(1/3). */
export function cbrtSigned(x: number): number {
  if (x === 0) return 0;
  return Math.cbrt(x);
}

/** Clamp to [0, 1]. */
export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Clamp to [-1, 1]. */
export function clampNeg1_1(x: number): number {
  return Math.min(1, Math.max(-1, x));
}

/** 3x3 matrix * 3-vector. */
export function matvec3(
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
export function srgbEotf(x: number): number {
  if (x <= 0.04045) {
    return x / 12.92;
  }
  return ((x + 0.055) / 1.055) ** 2.4;
}

/** sRGB gamma (linear -> gamma). */
export function srgbGamma(x: number): number {
  if (x <= 0.0031308) {
    return 12.92 * x;
  }
  return 1.055 * x ** (1.0 / 2.4) - 0.055;
}

/** Adobe RGB EOTF (gamma -> linear): x^2.2. */
export function adobeRgbEotf(x: number): number {
  return x ** 2.2;
}

/** ProPhoto RGB EOTF (gamma -> linear): x^1.8. */
export function proPhotoRgbEotf(x: number): number {
  return x ** 1.8;
}

/** BT.2020 PQ (ST 2084) inverse EOTF -> linear, then Reinhard tone-map to SDR. */
export function bt2020PqEotf(x: number): number {
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

export function eotfForGamut(gamut: Gamut): (x: number) => number {
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
export function linearRgbToOklab(
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
export function oklabToLinearSrgb(
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
export function gammaRgbToOklab(
  r: number,
  g: number,
  b: number,
  gamut: Gamut,
): [number, number, number] {
  const eotf = eotfForGamut(gamut);
  return linearRgbToOklab([eotf(r), eotf(g), eotf(b)], gamut);
}

/** Convert OKLAB to gamma-encoded sRGB [0,1] with clamping. */
export function oklabToSrgb(
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
export function muCompress(value: number): number {
  const v = clampNeg1_1(value);
  return (Math.sign(v) * Math.log(1.0 + MU * Math.abs(v))) / Math.log(1.0 + MU);
}

/** mu-law expand: compressed in [-1, 1] -> value in [-1, 1]. */
export function muExpand(compressed: number): number {
  return (
    (Math.sign(compressed) * ((1.0 + MU) ** Math.abs(compressed) - 1.0)) / MU
  );
}

/** Quantize a value in [-1, 1] using mu-law to an integer index. */
export function muLawQuantize(value: number, bits: number): number {
  const compressed = muCompress(value);
  const maxVal = (1 << bits) - 1;
  const index = roundHalfAwayFromZero(((compressed + 1.0) / 2.0) * maxVal);
  return Math.min(maxVal, Math.max(0, index));
}

/** Dequantize an integer index back to a value in [-1, 1] using mu-law. */
export function muLawDequantize(index: number, bits: number): number {
  const maxVal = (1 << bits) - 1;
  const compressed = (index / maxVal) * 2.0 - 1.0;
  return muExpand(compressed);
}

// ---------------------------------------------------------------------------
// Bit packing
// ---------------------------------------------------------------------------

/** Write `count` bits of `value` starting at `bitpos` in little-endian byte order. */
export function writeBits(
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
export function readBits(
  hash: Uint8Array,
  bitpos: number,
  count: number,
): number {
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
export function encodeAspect(w: number, h: number): number {
  const ratio = w / h;
  const raw = ((Math.log2(ratio) + 2.0) / 4.0) * 255.0;
  const byte = roundHalfAwayFromZero(raw);
  return Math.min(255, Math.max(0, byte));
}

/** Decode aspect ratio from byte. */
export function decodeAspect(byte: number): number {
  return 2 ** ((byte / 255.0) * 4.0 - 2.0);
}

/** Decode output size from aspect byte. Longer side = 32px. */
export function decodeOutputSize(byte: number): [number, number] {
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
export function triangularScanOrder(
  nx: number,
  ny: number,
): Array<[number, number]> {
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
export function dctEncode(
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
export function dctDecodePixel(
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
