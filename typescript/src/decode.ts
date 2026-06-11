/**
 * Pure-TypeScript ChromaHash **decode** path (v0.6).
 *
 * This is the one hand-maintained algorithm port in the TypeScript package: a
 * render-only module that reconstructs a placeholder from a 32-byte hash with
 * **no WebAssembly init**, so latency-sensitive consumers (server-side render,
 * the critical browser paint path) skip the `.wasm` fetch + instantiate.
 *
 * It is a faithful port of the Rust reference `decode` path (`rust/src/decode.rs`
 * and its dependencies). Encoding lives only in WebAssembly — see `./index`.
 *
 * Determinism: every transcendental matches the spec's portable implementations
 * (`portable_cos`/`portable_pow`/`portable_ln`) so output is bit-identical to
 * the Rust core and the WASM build. The `decode.test.ts` sync guard asserts that
 * equality against `chromahash-wasm` over the spec vectors and a fuzz corpus —
 * if a spec change lands in the core, that guard fails until this module follows.
 */

// ---------------------------------------------------------------------------
// v0.6 format constants (the locked `Tunables::DEFAULT`, layout B)
// ---------------------------------------------------------------------------

type Tier = readonly [count: number, bits: number];

const L_TIERS: readonly Tier[] = [
  [27, 5],
  [0, 5],
];
const C_COUNT = 9;
const C_BITS = 4;
const LA_TIERS: readonly Tier[] = [
  [7, 6],
  [13, 5],
];
const CA_COUNT = 9;
const CA_BITS = 4;
const ALPHA_AC_COUNT = 5;
const ALPHA_AC_BITS = 4;

const MAX_CHROMA_A = 0.28;
const MAX_CHROMA_B = 0.32;
const MAX_L_SCALE = 0.5;
const MAX_A_SCALE = 0.125;
const MAX_B_SCALE = 0.125;
const MAX_ALPHA_SCALE = 0.5;
const MU_L = 5.0;
const MU_C = 8.0;
const MU_ALPHA = 5.0;
const W_MIN_L = 1.0;
const W_EXP_L = 1;
const W_MIN_C = 1.0;
const W_EXP_C = 1;
const GAMUT_L_BLEND = 0.5;

type Mat3 = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];
type Vec3 = readonly [number, number, number];

/** M2_INV: OKLAB [L, a, b] → LMS (cube-root). */
const M2_INV: Mat3 = [
  [1.0, 0.3963377774, 0.2158037573],
  [1.0, -0.1055613458, -0.0638541728],
  [1.0, -0.0894841775, -1.291485548],
];

/** M1_INV[sRGB]: LMS → linear sRGB (decoder matrix). */
const M1_INV_SRGB: Mat3 = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

// ---------------------------------------------------------------------------
// Portable math (bit-exact across languages; see rust/src/math_utils.rs)
// ---------------------------------------------------------------------------

// Math.PI / Math.LN2 are the exact IEEE-754 doubles the spec's portable math
// uses, so referencing them keeps this port bit-identical to the Rust core.
const PI = Math.PI;
const LN2 = Math.LN2;

/** Round half away from zero (NOT banker's rounding). Per spec §2.2. */
function roundHalfAwayFromZero(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Sign matching Rust's `f64::signum` for the values seen here (+0 → +1). */
function signum(x: number): number {
  return x < 0 ? -1 : 1;
}

/** Portable natural logarithm. Range-reduces to [1, 2) then a fast series. */
function portableLn(x: number): number {
  if (x <= 0) return Number.NEGATIVE_INFINITY;
  if (x === 1) return 0;

  let m = x;
  let e = 0;
  while (m >= 2.0) {
    m /= 2.0;
    e += 1;
  }
  while (m < 1.0) {
    m *= 2.0;
    e -= 1;
  }

  const u = (m - 1.0) / (m + 1.0);
  const u2 = u * u;
  let term = u;
  let sum = u;
  let k = 1;
  while (k <= 20) {
    term *= u2;
    sum += term / (2 * k + 1);
    k += 1;
  }

  return 2.0 * sum + e * LN2;
}

/** Portable exponential. exp(x) = 2^k · exp(r), r ∈ [-ln2/2, ln2/2]. */
function portableExp(x: number): number {
  if (x === 0) return 1.0;

  const k = Math.floor(x / LN2 + 0.5);
  const r = x - k * LN2;

  let term = 1.0;
  let sum = 1.0;
  let i = 1;
  while (i <= 25) {
    term *= r / i;
    sum += term;
    i += 1;
  }

  let result = sum;
  if (k >= 0) {
    for (let j = 0; j < k; j++) result *= 2.0;
  } else {
    for (let j = 0; j < -k; j++) result /= 2.0;
  }
  return result;
}

/** Portable power: base^exponent via exp(exponent · ln(base)). */
function portablePow(base: number, exponent: number): number {
  if (base === 0) return 0.0;
  if (exponent === 0) return 1.0;
  if (base === 1) return 1.0;
  return portableExp(exponent * portableLn(base));
}

/** Portable cosine (degree-16 Taylor with range reduction). */
function portableCos(x: number): number {
  const TWO_PI = 6.283185307179586;
  const HALF_PI = 1.5707963267948966;

  let v = x < 0 ? -x : x;
  if (v >= TWO_PI) v -= Math.floor(v / TWO_PI) * TWO_PI;
  if (v > PI) v = TWO_PI - v;
  const negate = v > HALF_PI;
  if (negate) v = PI - v;

  const x2 = v * v;
  const r =
    1.0 +
    x2 *
      (-1.0 / 2.0 +
        x2 *
          (1.0 / 24.0 +
            x2 *
              (-1.0 / 720.0 +
                x2 *
                  (1.0 / 40320.0 +
                    x2 *
                      (-1.0 / 3628800.0 +
                        x2 *
                          (1.0 / 479001600.0 +
                            x2 *
                              (-1.0 / 87178291200.0 +
                                x2 * (1.0 / 20922789888000.0))))))));

  return negate ? -r : r;
}

function matvec3(m: Mat3, v: Vec3): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

// ---------------------------------------------------------------------------
// Bitstream
// ---------------------------------------------------------------------------

/** Read `count` bits starting at `bitpos` (little-endian). Per spec §12.6. */
function readBits(hash: Uint8Array, bitpos: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i++) {
    const byteIdx = (bitpos + i) >> 3;
    const bitIdx = (bitpos + i) & 7;
    if (((hash[byteIdx] ?? 0) & (1 << bitIdx)) !== 0) value |= 1 << i;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Transfer + gamma LUT
// ---------------------------------------------------------------------------

/** sRGB gamma (linear → gamma). Per spec §12.6. */
function srgbGamma(x: number): number {
  if (x <= 0.0031308) return 12.92 * x;
  return 1.055 * portablePow(x, 1.0 / 2.4) - 0.055;
}

/** 4096-entry sRGB gamma LUT: lut[i] = sRGB8(i/4095). Per spec §12.6. */
function buildGammaLut(): Uint8Array {
  const lut = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) {
    const srgb = srgbGamma(i / 4095.0);
    lut[i] = roundHalfAwayFromZero(clamp01(srgb) * 255.0);
  }
  return lut;
}

const GAMMA_LUT = buildGammaLut();

/** Map linear [0,1] to sRGB u8 via the LUT. Per spec §12.6. */
function linearToSrgb8(x: number): number {
  let idx = roundHalfAwayFromZero(x * 4095.0);
  if (idx < 0) idx = 0;
  else if (idx > 4095) idx = 4095;
  return GAMMA_LUT[idx] ?? 0;
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

function oklabToLinearSrgb(lab: Vec3): [number, number, number] {
  const c = matvec3(M2_INV, lab);
  const lms: Vec3 = [
    c[0] * c[0] * c[0],
    c[1] * c[1] * c[1],
    c[2] * c[2] * c[2],
  ];
  return matvec3(M1_INV_SRGB, lms);
}

function inGamut(rgb: Vec3): boolean {
  return (
    rgb[0] >= 0.0 &&
    rgb[0] <= 1.0 &&
    rgb[1] >= 0.0 &&
    rgb[1] <= 1.0 &&
    rgb[2] >= 0.0 &&
    rgb[2] <= 1.0
  );
}

/** Soft gamut clamp v2 via segment bisection. Per spec §12.6 (v0.6). */
function softGamutClamp(
  l: number,
  a: number,
  b: number,
  lBlend: number,
): [number, number, number] {
  if (inGamut(oklabToLinearSrgb([l, a, b]))) return [l, a, b];

  const anchorL = l + lBlend * (0.5 - l);

  let lo = 0.0;
  let hi = 1.0;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2.0;
    const lTest = l + (anchorL - l) * mid;
    const aTest = a * (1.0 - mid);
    const bTest = b * (1.0 - mid);
    if (inGamut(oklabToLinearSrgb([lTest, aTest, bTest]))) hi = mid;
    else lo = mid;
  }

  return [l + (anchorL - l) * hi, a * (1.0 - hi), b * (1.0 - hi)];
}

// ---------------------------------------------------------------------------
// µ-law dequantization
// ---------------------------------------------------------------------------

function muExpand(compressed: number, mu: number): number {
  return (
    (signum(compressed) * (portablePow(1.0 + mu, Math.abs(compressed)) - 1.0)) /
    mu
  );
}

/** Dequantize a µ-law index back to [-1, 1]. Per spec §7.3 (v0.6). */
function muLawDequantize(index: number, bits: number, mu: number): number {
  const maxIdx = (1 << bits) - 2;
  const idx = Math.min(index, maxIdx);
  const compressed = (idx / maxIdx) * 2.0 - 1.0;
  return muExpand(compressed, mu);
}

// ---------------------------------------------------------------------------
// Aspect
// ---------------------------------------------------------------------------

/** Decode aspect ratio from byte. Per spec §8.1 (v0.3). */
function decodeAspect(byte: number): number {
  return portablePow(2.0, (byte / 255.0) * 8.0 - 4.0);
}

/** Decode output size from aspect byte. Longer side = 32px. Per spec §8.2. */
function decodeOutputSize(byte: number): [number, number] {
  const ratio = decodeAspect(byte);
  if (ratio > 1.0) {
    const h = Math.max(roundHalfAwayFromZero(32.0 / ratio), 1.0);
    return [32, h];
  }
  const w = Math.max(roundHalfAwayFromZero(32.0 * ratio), 1.0);
  return [w, 32];
}

// ---------------------------------------------------------------------------
// Coefficient selection + DCT synthesis
// ---------------------------------------------------------------------------

interface Selection {
  coeffs: Array<[number, number]>;
  priorities: number[];
  pK: number;
}

/**
 * Select the K lowest-spatial-frequency AC coefficients for an aspect byte.
 * Per spec §6.1 (v0.6). Priority (cx·H)² + (cy·W)²; ties break by (cx, cy).
 */
function selectCoefficients(aspectByte: number, k: number): Selection {
  const [w, h] = decodeOutputSize(aspectByte);
  const entries: Array<[number, number, number]> = [];
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      if (cx === 0 && cy === 0) continue;
      const px = cx * h;
      const py = cy * w;
      entries.push([px * px + py * py, cx, cy]);
    }
  }
  entries.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  entries.length = Math.min(entries.length, k);

  const last = entries[entries.length - 1];
  return {
    coeffs: entries.map(([, cx, cy]) => [cx, cy]),
    priorities: entries.map(([p]) => p),
    pK: last ? last[0] : 1,
  };
}

/** Decode-side synthesis window weights for a selection. Per spec §11 (v0.6). */
function windowWeights(sel: Selection, wMin: number, wExp: number): number[] {
  if (wMin >= 1.0) return sel.priorities.map(() => 1.0);
  return sel.priorities.map((p) => {
    const rho = Math.sqrt(p / sel.pK);
    const hann = (1.0 + portableCos(PI * rho)) / 2.0;
    let powed = 1.0;
    for (let i = 0; i < wExp; i++) powed *= hann;
    return wMin + (1.0 - wMin) * powed;
  });
}

/** Cosine table: table[freq][pos] = cos(π/dim · freq · (pos+0.5)). Per spec §12.6. */
function precomputeCosTable(dim: number, maxFreq: number): number[][] {
  const table: number[][] = [];
  for (let freq = 0; freq < maxFreq; freq++) {
    const row: number[] = [];
    for (let pos = 0; pos < dim; pos++) {
      row.push(portableCos((PI / dim) * freq * (pos + 0.5)));
    }
    table.push(row);
  }
  return table;
}

/** Inverse DCT at a single pixel using precomputed cosine tables. Per spec §12.6. */
function dctDecodePixelSeparable(
  dc: number,
  ac: number[],
  scan: Array<[number, number]>,
  x: number,
  y: number,
  cosX: number[][],
  cosY: number[][],
): number {
  let value = dc;
  for (let j = 0; j < scan.length; j++) {
    const pair = scan[j];
    if (pair === undefined) continue;
    const [cx, cy] = pair;
    const cxFactor = cx > 0 ? 2.0 : 1.0;
    const cyFactor = cy > 0 ? 2.0 : 1.0;
    const fx = (cosX[cx] ?? [])[x] ?? 0;
    const fy = (cosY[cy] ?? [])[y] ?? 0;
    value += (ac[j] ?? 0) * fx * fy * cxFactor * cyFactor;
  }
  return value;
}

/**
 * Filter a channel's AC values to frequencies representable at (w, h):
 * windowed values + their (cx, cy) pairs with cx < w and cy < h. Per spec §11.
 */
function prepareChannel(
  ac: number[],
  coeffs: Array<[number, number]>,
  weights: number[],
  w: number,
  h: number,
): { vals: number[]; scan: Array<[number, number]> } {
  const vals: number[] = [];
  const scan: Array<[number, number]> = [];
  for (let j = 0; j < coeffs.length; j++) {
    const pair = coeffs[j];
    if (pair === undefined) continue;
    const [cx, cy] = pair;
    if (cx >= w || cy >= h) continue;
    vals.push((ac[j] ?? 0) * (weights[j] ?? 0));
    scan.push([cx, cy]);
  }
  return { vals, scan };
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** Render a ChromaHash at the given pixel dimensions. Per spec §11 (v0.6). */
function renderAtSize(hash: Uint8Array, w: number, h: number): Uint8Array {
  // 1. Header (48 bits)
  const lDcQ = readBits(hash, 0, 7);
  const aDcQ = readBits(hash, 7, 7);
  const bDcQ = readBits(hash, 14, 7);
  const lSclQ = readBits(hash, 21, 6);
  const aSclQ = readBits(hash, 27, 6);
  const bSclQ = readBits(hash, 33, 5);
  const aspect = readBits(hash, 38, 8);
  const hasAlpha = readBits(hash, 46, 1) === 1;

  // 2. DC values + scale factors
  const lDc = lDcQ / 127.0;
  const aDc = ((aDcQ - 64.0) / 63.0) * MAX_CHROMA_A;
  const bDc = ((bDcQ - 64.0) / 63.0) * MAX_CHROMA_B;
  const lScale = (lSclQ / 63.0) * MAX_L_SCALE;
  const aScale = (aSclQ / 63.0) * MAX_A_SCALE;
  const bScale = (bSclQ / 31.0) * MAX_B_SCALE;

  // 3. Coefficient selection (mirrors the encoder exactly)
  const lTiers = hasAlpha ? LA_TIERS : L_TIERS;
  const lCount = (lTiers[0]?.[0] ?? 0) + (lTiers[1]?.[0] ?? 0);
  const cCount = hasAlpha ? CA_COUNT : C_COUNT;
  const cBits = hasAlpha ? CA_BITS : C_BITS;
  const lSel = selectCoefficients(aspect, lCount);
  const cSel = selectCoefficients(aspect, cCount);

  // 4. AC payload
  let bitpos = 48;

  let alphaDcVal = 1.0;
  let alphaScaleVal = 0.0;
  if (hasAlpha) {
    alphaDcVal = readBits(hash, bitpos, 5) / 31.0;
    bitpos += 5;
    alphaScaleVal = (readBits(hash, bitpos, 4) / 15.0) * MAX_ALPHA_SCALE;
    bitpos += 4;
  }

  const lAc: number[] = [];
  for (const tier of lTiers) {
    const [count, bits] = tier;
    for (let i = 0; i < count; i++) {
      const q = readBits(hash, bitpos, bits);
      bitpos += bits;
      lAc.push(muLawDequantize(q, bits, MU_L) * lScale);
    }
  }

  const aAc: number[] = [];
  for (let i = 0; i < cCount; i++) {
    const q = readBits(hash, bitpos, cBits);
    bitpos += cBits;
    aAc.push(muLawDequantize(q, cBits, MU_C) * aScale);
  }
  const bAc: number[] = [];
  for (let i = 0; i < cCount; i++) {
    const q = readBits(hash, bitpos, cBits);
    bitpos += cBits;
    bAc.push(muLawDequantize(q, cBits, MU_C) * bScale);
  }

  let alphaSel: Selection | null = null;
  const alphaAc: number[] = [];
  if (hasAlpha) {
    alphaSel = selectCoefficients(aspect, ALPHA_AC_COUNT);
    for (let i = 0; i < ALPHA_AC_COUNT; i++) {
      const q = readBits(hash, bitpos, ALPHA_AC_BITS);
      bitpos += ALPHA_AC_BITS;
      alphaAc.push(muLawDequantize(q, ALPHA_AC_BITS, MU_ALPHA) * alphaScaleVal);
    }
  }

  // 5. Synthesis window + frequency filter for the render raster
  const lWeights = windowWeights(lSel, W_MIN_L, W_EXP_L);
  const cWeights = windowWeights(cSel, W_MIN_C, W_EXP_C);

  const lCh = prepareChannel(lAc, lSel.coeffs, lWeights, w, h);
  const aCh = prepareChannel(aAc, cSel.coeffs, cWeights, w, h);
  const bCh = prepareChannel(bAc, cSel.coeffs, cWeights, w, h);
  // Alpha is structural, not chromatic — share the luma window shape.
  const alphaCh =
    alphaSel !== null
      ? prepareChannel(
          alphaAc,
          alphaSel.coeffs,
          windowWeights(alphaSel, W_MIN_L, W_EXP_L),
          w,
          h,
        )
      : { vals: [], scan: [] as Array<[number, number]> };

  // 6. Cosine tables sized to the surviving frequencies
  let maxCx = 0;
  let maxCy = 0;
  for (const [cx, cy] of [...lCh.scan, ...aCh.scan, ...alphaCh.scan]) {
    if (cx > maxCx) maxCx = cx;
    if (cy > maxCy) maxCy = cy;
  }
  const cosX = precomputeCosTable(w, maxCx + 1);
  const cosY = precomputeCosTable(h, maxCy + 1);

  // 7. Render
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = dctDecodePixelSeparable(
        lDc,
        lCh.vals,
        lCh.scan,
        x,
        y,
        cosX,
        cosY,
      );
      const a = dctDecodePixelSeparable(
        aDc,
        aCh.vals,
        aCh.scan,
        x,
        y,
        cosX,
        cosY,
      );
      const b = dctDecodePixelSeparable(
        bDc,
        bCh.vals,
        bCh.scan,
        x,
        y,
        cosX,
        cosY,
      );
      const alpha = hasAlpha
        ? dctDecodePixelSeparable(
            alphaDcVal,
            alphaCh.vals,
            alphaCh.scan,
            x,
            y,
            cosX,
            cosY,
          )
        : 1.0;

      const lClamped = clamp01(l);
      const [lOut, aOut, bOut] = softGamutClamp(lClamped, a, b, GAMUT_L_BLEND);
      const rgbLin = oklabToLinearSrgb([lOut, aOut, bOut]);
      const idx = (y * w + x) * 4;
      rgba[idx] = linearToSrgb8(clamp01(rgbLin[0]));
      rgba[idx + 1] = linearToSrgb8(clamp01(rgbLin[1]));
      rgba[idx + 2] = linearToSrgb8(clamp01(rgbLin[2]));
      rgba[idx + 3] = roundHalfAwayFromZero(255.0 * clamp01(alpha));
    }
  }
  return rgba;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** A decoded RGBA image (≤ 32×32 px). `rgba` is row-major, 4 bytes/pixel. */
export interface DecodedImage {
  w: number;
  h: number;
  rgba: Uint8Array;
}

/** An RGBA color as 0–255 integers. */
export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function assertHash(hash: Uint8Array): void {
  if (hash.length !== 32) {
    throw new Error("ChromaHash must be exactly 32 bytes");
  }
}

function readAspect(hash: Uint8Array): number {
  return readBits(hash, 38, 8);
}

/** Decode a ChromaHash into an RGBA image. Per spec §11 (v0.6). */
export function decode(hash: Uint8Array): DecodedImage {
  assertHash(hash);
  const [w, h] = decodeOutputSize(readAspect(hash));
  return { w, h, rgba: renderAtSize(hash, w, h) };
}

/**
 * Decode a ChromaHash into an RGBA image, capped at the given max dimensions.
 * Useful when the natural decoded size would exceed the source dimensions.
 */
export function decodeCapped(
  hash: Uint8Array,
  maxWidth: number,
  maxHeight: number,
): DecodedImage {
  assertHash(hash);
  const [natW, natH] = decodeOutputSize(readAspect(hash));
  const w = Math.min(natW, maxWidth);
  const h = Math.min(natH, maxHeight);
  return { w, h, rgba: renderAtSize(hash, w, h) };
}

/** Extract the average color without a full decode. Per spec §11.2. */
export function averageColor(hash: Uint8Array): RgbaColor {
  assertHash(hash);
  const lDcQ = readBits(hash, 0, 7);
  const aDcQ = readBits(hash, 7, 7);
  const bDcQ = readBits(hash, 14, 7);
  const hasAlpha = readBits(hash, 46, 1) === 1;

  const lDc = lDcQ / 127.0;
  const aDc = ((aDcQ - 64.0) / 63.0) * MAX_CHROMA_A;
  const bDc = ((bDcQ - 64.0) / 63.0) * MAX_CHROMA_B;

  const lClamped = clamp01(lDc);
  const [lOut, aOut, bOut] = softGamutClamp(lClamped, aDc, bDc, GAMUT_L_BLEND);
  const rgbLin = oklabToLinearSrgb([lOut, aOut, bOut]);
  const alpha = hasAlpha ? readBits(hash, 48, 5) / 31.0 : 1.0;

  return {
    r: linearToSrgb8(clamp01(rgbLin[0])),
    g: linearToSrgb8(clamp01(rgbLin[1])),
    b: linearToSrgb8(clamp01(rgbLin[2])),
    a: roundHalfAwayFromZero(255.0 * clamp01(alpha)),
  };
}

/**
 * Whether this hash uses the v0.6 bitstream this module implements. Decoding an
 * unsupported (legacy v0.2–v0.5) hash produces garbage, not an error.
 */
export function isVersionSupported(hash: Uint8Array): boolean {
  assertHash(hash);
  return ((hash[5] ?? 0) >> 7) % 2 === 0;
}
