/**
 * Analysis-only TS mirror of the shipped odd-level µ-law quantizer (spec
 * §7.3), used to compute distortion baselines for quantizer training. NOT a
 * decoder: bit-exactness doesn't matter here (plain Math.log/Math.pow), only
 * the level geometry, which is exact.
 */

/** Round half away from zero (spec §2.2). */
function roundHalfAwayFromZero(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Quantize-dequantize round-trip of a normalized value through µ-law. */
export function mu_law_reference(
  value: number,
  bits: number,
  mu: number,
): number {
  const v = Math.min(1, Math.max(-1, value));
  const compressed =
    Math.sign(v) * (Math.log(1 + mu * Math.abs(v)) / Math.log(1 + mu));

  const maxIdx = (1 << bits) - 2;
  const index = Math.min(
    maxIdx,
    Math.max(0, roundHalfAwayFromZero(((compressed + 1) / 2) * maxIdx)),
  );

  const deqCompressed = (index / maxIdx) * 2 - 1;
  return (
    Math.sign(deqCompressed) * (((1 + mu) ** Math.abs(deqCompressed) - 1) / mu)
  );
}
