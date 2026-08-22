/**
 * Cross-format rate–distortion at arbitrary byte budgets (R&D tool).
 *
 * `just compare-rd` scores the competing formats at the four *shipped* tier
 * anchors (32/108/411/1623 B). This script asks the prior question: what is the
 * right anchor at all? It scores ChromaHash across a continuous byte ladder —
 * resizing the AC layout through `CHROMAHASH_TUNE`, which the format supports
 * natively because its length is derived from the layout — against every other
 * LQIP and codec baseline at the *same* budgets, on the *same* corpus split as
 * `just sweep`, so a ladder row and a competitor row are directly comparable.
 *
 * Usage:
 *   node dist/rd-budget.js [--split tune|holdout|all] [--budgets 16,21,24,32,...]
 *                          [--max-images N] [--out <name>] [--formats a,b,c]
 */

import fs from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { BlurHashAdapter } from "./adapters/blurhash.ts";
import {
  RUST_CLI,
  decodeViaRust,
  encodeViaRust,
} from "./adapters/chromahash.ts";
import { CodecThumbAdapter, isJxlAvailable } from "./adapters/codec-thumb.ts";
import { LqipModernAdapter } from "./adapters/lqip-modern.ts";
import { RawPixelsAdapter } from "./adapters/raw-pixels.ts";
import { ThumbHashAdapter } from "./adapters/thumbhash.ts";
import { type CorpusSplit, splitFor } from "./corpus.ts";
import { gamutToSrgbReference } from "./gamut.ts";
import { generateFixtures } from "./generate-fixtures.ts";
import { ensureHoldoutImages } from "./holdout-images.ts";
import { loadImage } from "./image-loader.ts";
import { computeAllMetrics, setScoringConfig } from "./metrics.ts";
import { ensureIqaAvailable } from "./metrics/iqa.ts";
import { ensureNaturalImages } from "./natural-images.ts";
import type { FormatAdapter, ImageInput } from "./types.ts";

/** Fixed bit prefix before the AC payload (descriptor+aspect+DC+scales). */
const PREFIX_BITS = 54;
/** Shipped tier-0 L:C coefficient-count ratio (26 luma : 9 per chroma channel). */
const SHIPPED_LC_RATIO = 26 / 9;
/** Bits per luma / per chroma AC coefficient in the shipped layout. */
const L_BITS = 5;
const C_BITS = 4;

/** Encoded length in bytes for a tier-0 (nL, nC) AC layout. */
function bytesFor(nL: number, nC: number): number {
  return Math.ceil((PREFIX_BITS + nL * L_BITS + 2 * nC * C_BITS) / 8);
}

/**
 * The (nL, nC) layout that fills a byte budget exactly while staying closest to
 * the shipped L:C ratio. Returns null when the budget is below the 7-byte
 * prefix floor.
 */
function allocate(targetBytes: number): { nL: number; nC: number } | null {
  let best: { key: [number, number]; v: { nL: number; nC: number } } | null =
    null;
  for (let nC = 0; nC < 4000; nC++) {
    const base = Math.round(SHIPPED_LC_RATIO * nC);
    for (let nL = Math.max(0, base - 6); nL <= base + 6; nL++) {
      if (bytesFor(nL, nC) !== targetBytes) continue;
      const used = nL * L_BITS + 2 * nC * C_BITS;
      const dev = Math.abs((nC > 0 ? nL / nC : 1e9) - SHIPPED_LC_RATIO);
      const key: [number, number] = [-used, dev];
      if (
        best === null ||
        key[0] < best.key[0] ||
        (key[0] === best.key[0] && key[1] < best.key[1])
      ) {
        best = { key, v: { nL, nC } };
      }
    }
  }
  return best?.v ?? null;
}

/**
 * Quality tier to decode a coefficient count at. The decoder drops any selected
 * (cx, cy) pair outside the render raster, so the raster edge (32 << tier) has
 * to clear the top selected frequency index (~sqrt(4·nL/π)) with margin.
 */
function tierFor(nL: number): number {
  for (let t = 0; t <= 3; t++) {
    const raster = 32 << t;
    if (raster >= 2.2 * Math.sqrt((4 * Math.max(nL, 1)) / Math.PI)) return t;
  }
  return 3;
}

/** One scored row of the output table. */
interface Row {
  family: string;
  variant: string;
  targetBytes: number | null;
  images: number;
  bytes: number;
  ciede2000: number | null;
  ssimulacra2: number | null;
  butteraugli: number | null;
  dssim: number | null;
}

const { values } = parseArgs({
  options: {
    split: { type: "string", default: "tune" },
    budgets: { type: "string" },
    formats: { type: "string" },
    "max-images": { type: "string" },
    out: { type: "string" },
  },
});

const splitArg = values.split ?? "tune";
if (splitArg !== "tune" && splitArg !== "holdout" && splitArg !== "all") {
  console.error(`invalid --split: ${splitArg}`);
  process.exit(1);
}
const DEFAULT_BUDGETS = [16, 21, 24, 32, 48, 64, 108, 192, 411, 1623];
const budgets = (values.budgets ?? DEFAULT_BUDGETS.join(","))
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10))
  .filter((n) => Number.isFinite(n) && n > 0)
  .sort((a, b) => a - b);
const maxImages = values["max-images"]
  ? Number.parseInt(values["max-images"], 10)
  : null;
const formatFilter = values.formats
  ? new Set(values.formats.split(",").map((s) => s.trim().toLowerCase()))
  : null;

const PHOTO_PREFIXES = ["natural-", "portrait-", "night-", "chroma-", "kodak"];

async function loadCorpus(): Promise<ImageInput[]> {
  const toolRoot = path.resolve(import.meta.dirname, "..");
  const syntheticDir = path.join(toolRoot, "fixtures/synthetic");
  try {
    const files = await fs.readdir(syntheticDir);
    if (files.length === 0) await generateFixtures();
  } catch {
    await generateFixtures();
  }
  await ensureNaturalImages();
  if (splitArg !== "tune") await ensureHoldoutImages();

  const paths: string[] = [];
  for await (const entry of glob(
    path.join(toolRoot, "fixtures/**/*.{png,jpg}"),
  )) {
    if (entry.endsWith(".png") || entry.endsWith(".jpg")) paths.push(entry);
  }
  paths.sort();

  const inputs: ImageInput[] = [];
  for (const filePath of paths) {
    const name = path.basename(filePath).replace(/\.[^.]+$/, "");
    if (!PHOTO_PREFIXES.some((p) => name.startsWith(p))) continue;
    if (splitArg !== "all" && splitFor(name) !== (splitArg as CorpusSplit))
      continue;
    const input = await loadImage(filePath);
    input.gamut = "srgb";
    input.metricReferenceRgba = gamutToSrgbReference(
      input.referenceRgba,
      "srgb",
    );
    inputs.push(input);
  }
  return inputs;
}

/** Mean of the finite values, or null. */
function mean(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length > 0 ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

/** Score one ChromaHash layout (encode + capped decode + metrics) per image. */
async function scoreChromaHash(
  label: string,
  targetBytes: number,
  tune: string,
  tier: number,
  inputs: ImageInput[],
): Promise<Row> {
  const ciede: (number | null)[] = [];
  const ssim2: (number | null)[] = [];
  const butter: (number | null)[] = [];
  const dssim: (number | null)[] = [];
  let bytesSum = 0;
  for (const input of inputs) {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;
    const hash = encodeViaRust(RUST_CLI, w, h, rgba, "srgb", tier, tune);
    bytesSum += hash.length;
    const dec = decodeViaRust(RUST_CLI, hash, "srgb", w, h, tune);
    const { metrics } = await computeAllMetrics(
      input.metricReferenceRgba ?? input.referenceRgba,
      input.referenceWidth,
      input.referenceHeight,
      dec.rgba,
      dec.w,
      dec.h,
    );
    ciede.push(metrics.ciede2000);
    ssim2.push(metrics.ssimulacra2);
    butter.push(metrics.butteraugli);
    dssim.push(metrics.dssim);
  }
  return {
    family: "ChromaHash",
    variant: label,
    targetBytes,
    images: inputs.length,
    bytes: bytesSum / (inputs.length || 1),
    ciede2000: mean(ciede),
    ssimulacra2: mean(ssim2),
    butteraugli: mean(butter),
    dssim: mean(dssim),
  };
}

/** Score any FormatAdapter over the corpus; unrepresentable budgets return null. */
async function scoreAdapter(
  family: string,
  adapter: FormatAdapter,
  targetBytes: number | null,
  inputs: ImageInput[],
): Promise<Row | null> {
  const ciede: (number | null)[] = [];
  const ssim2: (number | null)[] = [];
  const butter: (number | null)[] = [];
  const dssim: (number | null)[] = [];
  let bytesSum = 0;
  let scored = 0;
  for (const input of inputs) {
    try {
      const r = await adapter.process(input, 1);
      bytesSum += r.encodedSizeBytes;
      ciede.push(r.metrics.ciede2000);
      ssim2.push(r.metrics.ssimulacra2);
      butter.push(r.metrics.butteraugli);
      dssim.push(r.metrics.dssim);
      scored++;
    } catch {
      // Budget unrepresentable for this codec on this image — skip it.
    }
  }
  if (scored === 0) return null;
  return {
    family,
    variant: adapter.name,
    targetBytes,
    images: scored,
    bytes: bytesSum / scored,
    ciede2000: mean(ciede),
    ssimulacra2: mean(ssim2),
    butteraugli: mean(butter),
    dssim: mean(dssim),
  };
}

async function main(): Promise<void> {
  ensureIqaAvailable();
  setScoringConfig({ upscalePolicy: "browser-gamma", blurredScoring: false });

  let inputs = await loadCorpus();
  if (maxImages !== null) inputs = inputs.slice(0, maxImages);
  console.log(
    `rd-budget: ${inputs.length} ${splitArg}-split photos × budgets [${budgets.join(", ")}]`,
  );

  const want = (f: string) => formatFilter === null || formatFilter.has(f);
  const rows: Row[] = [];
  const push = async (r: Promise<Row | null>) => {
    const row = await r;
    if (!row) return;
    rows.push(row);
    console.log(
      `  ${row.variant.padEnd(26)} ${row.bytes.toFixed(1).padStart(7)} B  ΔE00 ${row.ciede2000?.toFixed(3) ?? "N/A"}`,
    );
  };

  // ChromaHash: one layout per budget, resized to fill it.
  if (want("chromahash")) {
    for (const b of budgets) {
      const a = allocate(b);
      if (!a) {
        console.log(
          `  ChromaHash@${b}B  — below the 7 B prefix floor, skipped`,
        );
        continue;
      }
      const tier = tierFor(a.nL);
      const s = 4 ** tier;
      // Express the target counts as base counts at the chosen tier.
      const l1 = Math.round(a.nL / s);
      const c = Math.round(a.nC / s);
      const tune = `l1=${l1}:5 c=${c}:4`;
      await push(
        scoreChromaHash(`ChromaHash@${b}B`, b, tune, tier, inputs).then(
          (r) => r,
        ),
      );
    }
  }

  // ThumbHash is a single fixed-rate point (no quality knob).
  if (want("thumbhash")) {
    await push(scoreAdapter("ThumbHash", new ThumbHashAdapter(), null, inputs));
  }
  // BlurHash's knob is component count; sizes land where they land.
  if (want("blurhash")) {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      await push(
        scoreAdapter(
          "BlurHash",
          new BlurHashAdapter({
            name: `BlurHash ${n}x${n}`,
            componentsX: n,
            componentsY: n,
          }),
          null,
          inputs,
        ),
      );
    }
  }
  if (want("lqip-modern")) {
    for (const r of [8, 12, 16, 24, 32, 48]) {
      await push(
        scoreAdapter(
          "lqip-modern",
          new LqipModernAdapter({
            name: `lqip-modern r${r}`,
            resize: r,
            outputFormat: "webp",
          }),
          null,
          inputs,
        ),
      );
    }
  }
  if (want("rawrgb565")) {
    for (const b of budgets) {
      await push(scoreAdapter("RawRGB565", new RawPixelsAdapter(b), b, inputs));
    }
  }
  const codecs = ["webp", "jpeg", "avif", ...(isJxlAvailable() ? ["jxl"] : [])];
  for (const codec of codecs) {
    if (!want(codec)) continue;
    for (const b of budgets) {
      await push(
        scoreAdapter(
          codec.toUpperCase(),
          new CodecThumbAdapter(codec as "webp" | "jpeg" | "avif" | "jxl", b),
          b,
          inputs,
        ),
      );
    }
  }

  const toolRoot = path.resolve(import.meta.dirname, "..");
  const outDir = path.join(toolRoot, "output/sweeps");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `${values.out ?? "rd-budget"}-${splitArg}.json`,
  );
  await fs.writeFile(
    outPath,
    `${JSON.stringify({ split: splitArg, images: inputs.length, budgets, rows }, null, 2)}\n`,
  );

  console.log(`\nR-D by byte budget (${splitArg} split) → ${outPath}`);
  console.log(
    `  ${"Variant".padEnd(26)} ${"Bytes".padStart(7)} ${"ΔE00".padStart(8)} ${"SSIM2".padStart(8)} ${"Butter".padStart(8)} ${"DSSIM".padStart(8)}`,
  );
  const cell = (v: number | null, d: number, w: number) =>
    (v !== null ? v.toFixed(d) : "N/A").padStart(w);
  for (const r of [...rows].sort(
    (a, b) => a.bytes - b.bytes || a.family.localeCompare(b.family),
  )) {
    console.log(
      `  ${r.variant.padEnd(26)} ${r.bytes.toFixed(1).padStart(7)} ${cell(r.ciede2000, 3, 8)} ${cell(r.ssimulacra2, 1, 8)} ${cell(r.butteraugli, 2, 8)} ${cell(r.dssim, 4, 8)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
