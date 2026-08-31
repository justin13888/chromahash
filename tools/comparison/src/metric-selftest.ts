/**
 * Self-checks for the metrics this harness computes itself (`metrics/local.ts`
 * and `aspect.ts`). Run with `mise run selftest:metrics`.
 *
 * This tool has no test framework — see `TESTING.md` — so the properties the
 * local metrics are *designed around* are asserted here instead, as a script
 * that exits non-zero. They are the falsifiable claims: if the "a blur scores
 * exactly zero" case ever fails, the window-radius derivation in
 * `metrics/local.ts` is wrong and every ringing number in the report is noise.
 */

import { computeRinging } from "./metrics/local.ts";

let failures = 0;

function check(name: string, ok: boolean, detail: string): void {
  if (ok) {
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} — ${detail}`);
  }
}

/** Opaque RGBA from a per-pixel colour function. */
function makeRgba(
  w: number,
  h: number,
  f: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      const p = (y * w + x) * 4;
      out[p] = Math.max(0, Math.min(255, Math.round(r)));
      out[p + 1] = Math.max(0, Math.min(255, Math.round(g)));
      out[p + 2] = Math.max(0, Math.min(255, Math.round(b)));
      out[p + 3] = 255;
    }
  }
  return out;
}

/**
 * Area-average downscale — the honest model of "a decode that is merely a
 * low-pass of the reference". Convex by construction, so by the metric's
 * central property it must score zero.
 */
function boxDownscale(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * sh) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * sw) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / dw));
      const acc = [0, 0, 0];
      let n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const p = (sy * sw + sx) * 4;
          acc[0] = (acc[0] ?? 0) + (src[p] ?? 0);
          acc[1] = (acc[1] ?? 0) + (src[p + 1] ?? 0);
          acc[2] = (acc[2] ?? 0) + (src[p + 2] ?? 0);
          n++;
        }
      }
      const p = (y * dw + x) * 4;
      out[p] = Math.round((acc[0] ?? 0) / n);
      out[p + 1] = Math.round((acc[1] ?? 0) / n);
      out[p + 2] = Math.round((acc[2] ?? 0) / n);
      out[p + 3] = 255;
    }
  }
  return out;
}

const REF_W = 256;
const REF_H = 256;
const DEC = 32;

// A reference with real edges: ringing has to have something to ring around.
// Mid-range values on purpose, so an excursion is visible instead of clipping
// at the byte boundary (the trap that hid sharp's own overshoot).
const reference = makeRgba(REF_W, REF_H, (x, y) => {
  const band = x < REF_W / 2 ? 70 : 190;
  const v = y < REF_H / 2 ? band : 255 - band;
  return [v, v, v];
});

console.log("\nringing — the properties the metric is built on\n");

// 1. Identity.
{
  const s = computeRinging(reference, reference, REF_W, REF_H, REF_W, REF_H);
  check(
    "identity scores 0",
    s !== null && s.ringing === 0,
    `ringing=${s?.ringing}`,
  );
}

// 2. THE null hypothesis: a pure low-pass decode must score exactly 0. If this
//    fails, the radius derivation is wrong and the metric measures blur.
const lowpass = boxDownscale(reference, REF_W, REF_H, DEC, DEC);
{
  const s = computeRinging(reference, lowpass, REF_W, REF_H, DEC, DEC);
  check(
    "a pure low-pass decode scores 0",
    s !== null && s.ringing === 0,
    `ringing=${s?.ringing.toFixed(4)} radius=${s?.ringWindowRadius}`,
  );
}

// 3. Bias correction: a uniform tint is "smooth but wrong", not an artifact.
{
  const tinted = new Uint8Array(lowpass);
  for (let i = 0; i < tinted.length; i += 4) {
    tinted[i] = Math.min(255, (tinted[i] ?? 0) + 8);
    tinted[i + 1] = Math.min(255, (tinted[i + 1] ?? 0) + 8);
    tinted[i + 2] = Math.min(255, (tinted[i + 2] ?? 0) + 8);
  }
  const s = computeRinging(reference, tinted, REF_W, REF_H, DEC, DEC);
  check(
    "a uniform +8 tint is absorbed as bias, not scored as ringing",
    s !== null && s.ringing < 0.5,
    `ringing=${s?.ringing.toFixed(4)}`,
  );
}

/** Add an oscillation straddling the vertical edge — synthetic Gibbs. */
function addRipple(
  base: Uint8Array,
  amp: [number, number, number],
): Uint8Array {
  const out = new Uint8Array(base);
  const mid = DEC / 2;
  for (let y = 0; y < DEC; y++) {
    for (let x = 0; x < DEC; x++) {
      const d = x - mid;
      if (Math.abs(d) > 5) continue;
      const w = Math.cos((d * Math.PI) / 2.5) * (1 - Math.abs(d) / 6);
      const p = (y * DEC + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[p + c] = Math.max(
          0,
          Math.min(255, Math.round((out[p + c] ?? 0) + (amp[c] ?? 0) * w)),
        );
      }
    }
  }
  return out;
}

// 4. A neutral ripple must register, and register as luma.
const neutral = computeRinging(
  reference,
  addRipple(lowpass, [30, 30, 30]),
  REF_W,
  REF_H,
  DEC,
  DEC,
);
check(
  "a neutral ripple at the edge registers",
  neutral !== null && neutral.ringing > 1,
  `ringing=${neutral?.ringing.toFixed(3)} area=${((neutral?.ringArea ?? 0) * 100).toFixed(1)}%`,
);
check(
  "a neutral ripple reads as luma, not chroma",
  neutral !== null && neutral.ringingLuma > neutral.ringingChroma * 4,
  `luma=${neutral?.ringingLuma.toFixed(3)} chroma=${neutral?.ringingChroma.toFixed(3)}`,
);

// 5a. On a flat reference the luma/chroma separation is exact: an opposing
//     R/B ripple must read as pure chroma.
{
  const flat = makeRgba(REF_W, REF_H, () => [128, 128, 128]);
  const flatDec = boxDownscale(flat, REF_W, REF_H, DEC, DEC);
  const s = computeRinging(
    flat,
    addRipple(flatDec, [30, 0, -30]),
    REF_W,
    REF_H,
    DEC,
    DEC,
  );
  check(
    "on a flat reference a chroma ripple reads as pure chroma",
    s !== null && s.ringingChroma > 1 && s.ringingLuma === 0,
    `luma=${s?.ringingLuma.toFixed(3)} chroma=${s?.ringingChroma.toFixed(3)}`,
  );
}

// 5b. Near an edge the separation is partial, and that is inherent rather than
//     a defect: the envelope test is one-sided, so where the local range is
//     wide and sits asymmetrically about a pixel's value, one channel's
//     excursion clears the envelope while the opposite channel's does not. The
//     residual reads as luma. Chroma must still dominate — that is the
//     discrimination `spec/RATIONALE.md` §255 needs (chroma quantization noise
//     vs luma ringing) — but expecting a clean split next to an edge would be
//     expecting the wrong thing.
{
  const s = computeRinging(
    reference,
    addRipple(lowpass, [30, 0, -30]),
    REF_W,
    REF_H,
    DEC,
    DEC,
  );
  check(
    "near an edge a chroma ripple still reads mostly as chroma",
    s !== null && s.ringingChroma > s.ringingLuma * 1.5,
    `luma=${s?.ringingLuma.toFixed(3)} chroma=${s?.ringingChroma.toFixed(3)}`,
  );
  // 6. The decomposition is orthogonal, so the aggregate must be Pythagorean.
  if (s !== null) {
    const lhs = s.ringing ** 2;
    const rhs = s.ringingLuma ** 2 + s.ringingChroma ** 2;
    check(
      "ringing^2 = ringingLuma^2 + ringingChroma^2",
      Math.abs(lhs - rhs) < 1e-6 * Math.max(1, lhs),
      `${lhs.toFixed(6)} vs ${rhs.toFixed(6)}`,
    );
  }
}

// 7. Severity ordering: a bigger overshoot must score higher.
{
  const small = computeRinging(
    reference,
    addRipple(lowpass, [10, 10, 10]),
    REF_W,
    REF_H,
    DEC,
    DEC,
  );
  check(
    "a larger overshoot scores higher than a smaller one",
    small !== null && neutral !== null && neutral.ringing > small.ringing,
    `amp10=${small?.ringing.toFixed(3)} amp30=${neutral?.ringing.toFixed(3)}`,
  );
}

// 7b. THE REGRESSION THIS SUITE ONCE MISSED.
//
// The checks above fix REF_W = 256 and DEC = 32, i.e. one upscale factor of 8.
// Two separate defects lived entirely outside that regime and shipped through a
// green run: a fixed 64-px cap on the window radius (which broke `r >= S`, so
// the score measured ordinary resolution loss once a decode fell below 16 px
// against a 512 px reference), and a bias correction applied to the decode but
// not to the envelope it was tested against (which broke the exact-zero
// property at every radius). On a logo -- large flat fields, one hard edge --
// a provably convex 4x3 decode scored 7.67, larger than the genuine ripple
// above.
//
// So sweep the decode sizes the real lineup produces, against the reference
// size it actually scores at, on the content shape that exposed it.
{
  const W = 512;
  const H = 341;
  // Logo-shaped: flat ground, one solid block, one hard edge. This is what
  // broke; a photograph did not.
  const logo = makeRgba(W, H, (x, y) => {
    const inMark = x > W * 0.2 && x < W * 0.55 && y > H * 0.25 && y < H * 0.7;
    return inMark ? [28, 78, 200] : [244, 244, 240];
  });
  // Fine periodic structure, the opposite failure shape.
  const text = makeRgba(W, H, (x, y) =>
    y % 7 < 3 && x % 5 < 3 ? [20, 20, 20] : [250, 250, 250],
  );
  const failures: string[] = [];
  for (const [label, ref] of [
    ["logo", logo],
    ["text", text],
  ] as const) {
    for (const long of [4, 6, 8, 12, 16, 24, 32, 64]) {
      const dw = Math.max(1, Math.round((W * long) / Math.max(W, H)));
      const dh = Math.max(1, Math.round((H * long) / Math.max(W, H)));
      // A box average is a convex combination of the samples it covers, so by
      // the metric's central property it cannot overshoot. Anything above zero
      // here is a false positive.
      const s = computeRinging(
        ref,
        boxDownscale(ref, W, H, dw, dh),
        W,
        H,
        dw,
        dh,
      );
      if (s === null || s.ringing > 0) {
        failures.push(
          `${label} ${dw}x${dh}=${s?.ringing.toFixed(3) ?? "null"}`,
        );
      }
    }
  }
  check(
    "a convex decode scores 0 at every decode size, not just the easy one",
    failures.length === 0,
    failures.length === 0
      ? "16 sizes x 2 content shapes, 4px to 64px against a 512px reference"
      : `false positives: ${failures.join(", ")}`,
  );
}

// 8. Degenerate rasters must not throw or produce NaN.
{
  const solid = makeRgba(8, 8, () => [120, 120, 120]);
  const one = makeRgba(1, 1, () => [120, 120, 120]);
  const s1 = computeRinging(solid, one, 8, 8, 1, 1);
  const s2 = computeRinging(one, one, 1, 1, 1, 1);
  check(
    "degenerate rasters score finite",
    s1 !== null &&
      Number.isFinite(s1.ringing) &&
      s2 !== null &&
      Number.isFinite(s2.ringing),
    `8x8<-1x1=${s1?.ringing.toFixed(3)} 1x1=${s2?.ringing.toFixed(3)}`,
  );
  check(
    "a solid reference with a matching solid decode scores 0",
    s1 !== null && s1.ringing === 0,
    `ringing=${s1?.ringing}`,
  );
}

console.log(
  failures === 0
    ? "\nAll metric self-checks passed.\n"
    : `\n${failures} metric self-check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
