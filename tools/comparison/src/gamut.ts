/**
 * Wide-gamut → sRGB conversion for metric references.
 *
 * The gamut fixtures store pixel bytes that are *tagged* with a non-sRGB gamut.
 * Comparing decoded previews against those raw bytes as if they were sRGB
 * penalizes formats that color-manage correctly. This module converts a
 * gamut-tagged image to its true sRGB appearance (relative-colorimetric, with
 * per-channel clipping) so metrics measure the right target for every format.
 *
 * Matrices and EOTFs mirror spec/constants.py and rust/src/transfer.rs — the
 * exact interpretation the chromahash encoder applies to gamut-tagged input.
 * This is harness code, not format code, so plain Math.pow is fine here.
 */

type Mat3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

/** Linear gamut RGB → LMS (cone response). From spec/constants.py M1[gamut]. */
const M1: Record<string, Mat3> = {
  srgb: [
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
  ],
  displayp3: [
    [0.4813798544, 0.4621183697, 0.0565017758],
    [0.2288319449, 0.6532168128, 0.1179512422],
    [0.0839457557, 0.2241652689, 0.6918889754],
  ],
  adobergb: [
    [0.5764322615, 0.3699132211, 0.0536545174],
    [0.2963164739, 0.5916761266, 0.1120073994],
    [0.1234782548, 0.2194986958, 0.6570230494],
  ],
  bt2020: [
    [0.6167557872, 0.3601983994, 0.0230458134],
    [0.265133064, 0.6358393641, 0.0990275718],
    [0.1001026342, 0.2039065194, 0.6959908464],
  ],
  prophoto: [
    [0.7154484635, 0.352791548, -0.0682400115],
    [0.2744116551, 0.6677976408, 0.057790704],
    [0.1097844385, 0.1861982875, 0.704017274],
  ],
};

/** LMS → linear sRGB. From spec/constants.py M1_INV_SRGB. */
const M1_INV_SRGB: Mat3 = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

/** sRGB EOTF (gamma → linear), per spec §5.3. */
function srgbEotf(x: number): number {
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

/** sRGB gamma (linear → gamma), per spec §12.6. */
function srgbGamma(x: number): number {
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

/** BT.2020 PQ (ST 2084) inverse EOTF + Reinhard tone-map, per rust/src/transfer.rs. */
function bt2020PqEotf(x: number): number {
  const M1_PQ = 0.1593017578125;
  const M2_PQ = 78.84375;
  const C1 = 0.8359375;
  const C2 = 18.8515625;
  const C3 = 18.6875;
  const n = x ** (1 / M2_PQ);
  const num = Math.max(n - C1, 0);
  const den = C2 - C3 * n;
  const yLinear = (num / den) ** (1 / M1_PQ);
  const l = (yLinear * 10000) / 203;
  return l / (1 + l);
}

/** Per-gamut EOTF (encoded byte value in [0,1] → linear light). */
const EOTF: Record<string, (x: number) => number> = {
  srgb: srgbEotf,
  displayp3: srgbEotf,
  adobergb: (x) => x ** 2.2,
  bt2020: bt2020PqEotf,
  prophoto: (x) => x ** 1.8,
};

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Convert gamut-tagged RGBA bytes to their sRGB appearance (alpha passthrough).
 * Returns the input unchanged for sRGB (identity round trip not worth the float churn).
 */
export function gamutToSrgbReference(
  rgba: Uint8Array,
  gamut: string,
): Uint8Array {
  const m1 = M1[gamut];
  const eotf = EOTF[gamut];
  if (gamut === "srgb" || m1 === undefined || eotf === undefined) {
    return rgba;
  }

  // 256-entry EOTF lookup (mirrors the encoder's LUT approach).
  const lut = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = eotf(i / 255);
  }

  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = lut[rgba[i] ?? 0] ?? 0;
    const g = lut[rgba[i + 1] ?? 0] ?? 0;
    const b = lut[rgba[i + 2] ?? 0] ?? 0;

    const l = m1[0][0] * r + m1[0][1] * g + m1[0][2] * b;
    const m = m1[1][0] * r + m1[1][1] * g + m1[1][2] * b;
    const s = m1[2][0] * r + m1[2][1] * g + m1[2][2] * b;

    const lr =
      M1_INV_SRGB[0][0] * l + M1_INV_SRGB[0][1] * m + M1_INV_SRGB[0][2] * s;
    const lg =
      M1_INV_SRGB[1][0] * l + M1_INV_SRGB[1][1] * m + M1_INV_SRGB[1][2] * s;
    const lb =
      M1_INV_SRGB[2][0] * l + M1_INV_SRGB[2][1] * m + M1_INV_SRGB[2][2] * s;

    out[i] = Math.round(255 * srgbGamma(clamp01(lr)));
    out[i + 1] = Math.round(255 * srgbGamma(clamp01(lg)));
    out[i + 2] = Math.round(255 * srgbGamma(clamp01(lb)));
    out[i + 3] = rgba[i + 3] ?? 255;
  }
  return out;
}
