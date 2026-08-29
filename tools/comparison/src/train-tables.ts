/**
 * Quantizer-training companion to the sweep runner.
 *
 * Usage: node dist/train-tables.js [--max-images N]
 *
 * Pools the encoder's scale-normalized AC coefficients (dump-coeffs) across
 * the TUNE split and:
 *
 * 1. Trains Lloyd-Max codebooks per channel group — the optimal scalar
 *    quantizer for the *actual* coefficient distribution, against which the
 *    parametric families (µ-law / A-law / power-law) are judged. Emitted as
 *    ready-to-paste CHROMAHASH_TUNE fragments for the companding-family sweep.
 * 2. Runs the vector-quantization probe: trains a 256-codeword 2D VQ on chroma
 *    coefficient pairs and compares its distortion against scalar 4+4-bit
 *    µ-law at the same 8 bits/pair. This bounds what joint coding could buy —
 *    the evaluate-or-reject evidence for the VQ rejection in spec/RATIONALE.md.
 *
 * Deterministic throughout (quantile-based initialization, fixed iteration
 * counts) so reruns reproduce the same tables.
 */

import fs from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { RUST_CLI, dumpCoefficientsViaRust } from "./adapters/chromahash.ts";
import { splitFor } from "./corpus.ts";
import { generateFixtures } from "./generate-fixtures.ts";
import { loadImage } from "./image-loader.ts";
import { mu_law_reference } from "./mulaw-reference.ts";
import { ensureNaturalImages } from "./natural-images.ts";
import { quantile } from "./stats.ts";

const { values } = parseArgs({
  options: { "max-images": { type: "string" } },
});
const maxImages = values["max-images"]
  ? Number.parseInt(values["max-images"], 10)
  : null;

/**
 * Lloyd-Max positive-half codebook with the center pinned at 0: alternate
 * nearest-level assignment and centroid updates on |v|, quantile-initialized.
 */
function trainLloydMax(
  magnitudes: number[],
  positiveLevels: number,
  initMu: number,
): number[] {
  const sorted = [...magnitudes].sort((a, b) => a - b);
  if (sorted.length === 0) {
    throw new Error("no samples to train on");
  }
  // The top level is PINNED at 1.0: scale = max|AC| guarantees every channel a
  // coefficient at exactly ±1, so the data has a structural point mass there
  // (≥1/K of all samples). Unpinned k-means merges that mass into the tail
  // shoulder and loses to µ-law — whose endpoint level sits at exactly 1.0 —
  // on the very samples that set the channel's scale.
  const trained = positiveLevels - 1;
  // Warm-start from the incumbent µ-law's level positions: Lloyd iterations
  // monotonically decrease MSE from their init, so the trained codebook can
  // only match-or-beat µ-law. (Quantile init strands most levels in the dense
  // near-zero region — a local optimum measurably worse than µ-law.)
  let levels: number[] = [];
  for (let j = 1; j <= trained; j++) {
    const compressed = j / positiveLevels;
    levels.push(((1 + initMu) ** compressed - 1) / initMu);
  }

  for (let iter = 0; iter < 50; iter++) {
    const sums = new Array<number>(trained).fill(0);
    const counts = new Array<number>(trained).fill(0);
    for (const m of sorted) {
      // Nearest of {0, levels..., 1.0}; -1 = pinned zero, `trained` = pinned top.
      let best = -1;
      let bestDist = m;
      for (let j = 0; j < trained; j++) {
        const dist = Math.abs(m - (levels[j] ?? 0));
        if (dist <= bestDist) {
          bestDist = dist;
          best = j;
        }
      }
      if (Math.abs(m - 1.0) <= bestDist) {
        best = trained;
      }
      if (best >= 0 && best < trained) {
        sums[best] = (sums[best] ?? 0) + m;
        counts[best] = (counts[best] ?? 0) + 1;
      }
    }
    const next = levels.map((l, j) => {
      const c = counts[j] ?? 0;
      return c > 0 ? (sums[j] ?? 0) / c : l;
    });
    const moved = next.reduce(
      (acc, l, j) => acc + Math.abs(l - (levels[j] ?? 0)),
      0,
    );
    levels = next;
    if (moved < 1e-9) break;
  }
  // Strictly ascending, clamped to (0, 1), with the pinned top level.
  return [
    ...levels
      .map((l) => Math.min(0.999999, Math.max(1e-6, l)))
      .sort((a, b) => a - b),
    1.0,
  ];
}

/** MSE of quantizing values through a symmetric codebook {±levels, 0}. */
function codebookMse(valuesIn: number[], levels: number[]): number {
  let se = 0;
  for (const v of valuesIn) {
    const m = Math.abs(v);
    let best = 0;
    let bestDist = m;
    for (const l of levels) {
      const dist = Math.abs(m - l);
      if (dist < bestDist) {
        bestDist = dist;
        best = l;
      }
    }
    const rec = v < 0 ? -best : best;
    se += (v - rec) * (v - rec);
  }
  return se / (valuesIn.length || 1);
}

/** MSE of the shipped odd-level µ-law quantizer at the given bit width. */
function muLawMse(valuesIn: number[], bits: number, mu: number): number {
  let se = 0;
  for (const v of valuesIn) {
    const rec = mu_law_reference(v, bits, mu);
    se += (v - rec) * (v - rec);
  }
  return se / (valuesIn.length || 1);
}

/** Deterministic 2D k-means (fixed grid init, 25 iterations). */
function trainVq2d(
  pairs: [number, number][],
  codewords: number,
): [number, number][] {
  // Init on a quantile grid (√codewords per axis).
  const side = Math.round(Math.sqrt(codewords));
  const xs = pairs.map((p) => p[0]).sort((a, b) => a - b);
  const ys = pairs.map((p) => p[1]).sort((a, b) => a - b);
  let book: [number, number][] = [];
  for (let i = 0; i < side; i++) {
    for (let j = 0; j < side; j++) {
      book.push([
        quantile(xs, (i + 0.5) / side),
        quantile(ys, (j + 0.5) / side),
      ]);
    }
  }

  for (let iter = 0; iter < 25; iter++) {
    const sums = book.map(() => [0, 0] as [number, number]);
    const counts = book.map(() => 0);
    for (const [x, y] of pairs) {
      let best = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let c = 0; c < book.length; c++) {
        const b = book[c];
        if (!b) continue;
        const dx = x - b[0];
        const dy = y - b[1];
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
      const s = sums[best];
      if (s) {
        s[0] += x;
        s[1] += y;
        counts[best] = (counts[best] ?? 0) + 1;
      }
    }
    book = book.map((b, c) => {
      const n = counts[c] ?? 0;
      const s = sums[c];
      return n > 0 && s ? [s[0] / n, s[1] / n] : b;
    });
  }
  return book;
}

/** MSE of pairs quantized through a 2D codebook. */
function vqMse(pairs: [number, number][], book: [number, number][]): number {
  let se = 0;
  for (const [x, y] of pairs) {
    let bestDist = Number.POSITIVE_INFINITY;
    for (const b of book) {
      const dx = x - b[0];
      const dy = y - b[1];
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) bestDist = dist;
    }
    se += bestDist;
  }
  return se / (pairs.length || 1);
}

async function main(): Promise<void> {
  const toolRoot = path.resolve(import.meta.dirname, "..");
  try {
    const files = await fs.readdir(path.join(toolRoot, "fixtures/synthetic"));
    if (files.length === 0) await generateFixtures();
  } catch {
    await generateFixtures();
  }
  await ensureNaturalImages();

  const paths: string[] = [];
  for await (const entry of glob(
    path.join(toolRoot, "fixtures/**/*.{png,jpg}"),
  )) {
    if (entry.endsWith(".png") || entry.endsWith(".jpg")) paths.push(entry);
  }
  paths.sort();

  const l: number[] = [];
  const c: number[] = [];
  let count = 0;
  for (const filePath of paths) {
    const name = path.basename(filePath).replace(/\.[^.]+$/, "");
    if (splitFor(name) !== "tune") continue;
    if (maxImages !== null && count >= maxImages) break;
    const input = await loadImage(filePath);
    const dump = dumpCoefficientsViaRust(
      RUST_CLI,
      input.smallWidth,
      input.smallHeight,
      input.smallRgba,
      "srgb",
      0,
    );
    l.push(...dump.l);
    c.push(...dump.a, ...dump.b);
    count++;
  }
  console.log(
    `Pooled coefficients from ${count} tune images: L ${l.length}, chroma ${c.length}`,
  );

  // 1. Lloyd-Max codebooks: L at 5 bits (15 positive levels), chroma at 4 (7).
  const lMags = l.map(Math.abs);
  const cMags = c.map(Math.abs);
  const tableL = trainLloydMax(lMags, 15, 5.0);
  const tableC = trainLloydMax(cMags, 7, 8.0);

  const fmt = (levels: number[]) => levels.map((v) => v.toFixed(6)).join(",");
  const tuneL = `compand_l=table table_l=${fmt(tableL)}`;
  const tuneC = `compand_c=table table_c=${fmt(tableC)}`;

  // Distortion vs the shipped µ-law, same bit budgets.
  const lloydDbL =
    10 * Math.log10(muLawMse(l, 5, 5.0) / codebookMse(l, tableL));
  const lloydDbC =
    10 * Math.log10(muLawMse(c, 4, 8.0) / codebookMse(c, tableC));

  // 2. VQ probe: consecutive chroma pairs at 8 bits/pair (256 codewords) vs
  // scalar 4+4-bit µ-law on the same data.
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < c.length; i += 2) {
    pairs.push([c[i] ?? 0, c[i + 1] ?? 0]);
  }
  const book = trainVq2d(pairs, 256);
  // Per-pair distortion on both sides: scalar = 2× per-component MSE; the 2D
  // VQ MSE already sums both dimensions.
  const scalarPairMse = muLawMse(c, 4, 8.0) * 2;
  const vqPairMse = vqMse(pairs, book);
  const vqGainDb = 10 * Math.log10(scalarPairMse / (vqPairMse || 1e-12));

  const distStats = (xs: number[]) => {
    const sorted = [...xs].map(Math.abs).sort((a, b) => a - b);
    return {
      p50: quantile(sorted, 0.5),
      p90: quantile(sorted, 0.9),
      p99: quantile(sorted, 0.99),
    };
  };

  const out = {
    trainedOn: { images: count, lSamples: l.length, chromaSamples: c.length },
    lloydMax: {
      l: { levels: tableL, tune: tuneL, gainVsMuLawDb: lloydDbL },
      c: { levels: tableC, tune: tuneC, gainVsMuLawDb: lloydDbC },
    },
    vqProbe: {
      codewords: 256,
      bitsPerPair: 8,
      scalarPairMse,
      vqPairMse,
      gainDb: vqGainDb,
    },
    distribution: { l: distStats(l), chroma: distStats(c) },
  };

  const outDir = path.join(toolRoot, "output/sweeps");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "tables.json");
  await fs.writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Tables written to ${outPath}`);
  console.log(`  Lloyd-Max L (5b): ${lloydDbL.toFixed(2)} dB vs µ-law µ=5`);
  console.log(`  Lloyd-Max C (4b): ${lloydDbC.toFixed(2)} dB vs µ-law µ=8`);
  console.log(
    `  VQ probe (8b/chroma pair): ${vqGainDb.toFixed(2)} dB vs scalar µ-law`,
  );
  console.log(`  TUNE fragments:\n    ${tuneL}\n    ${tuneC}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
