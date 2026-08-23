/**
 * Constants sweep runner: score CHROMAHASH_TUNE variants over the TUNE split
 * of the corpus and emit a decision table.
 *
 * Usage: node dist/sweep.js <config.json> [--split tune|holdout] [--max-images N]
 *
 * A config declares explicit variants (label + TUNE string + optional tier /
 * capToTier0 / version). The first variant is the incumbent: every other
 * variant's guard metrics (SSIMULACRA2 / Butteraugli / DSSIM) are checked
 * against it, mirroring the §12.1 sweep discipline — a candidate only "wins" if
 * it improves mean ΔE00 without regressing the perceptual guards.
 *
 * A variant may name a released tag (`"version": "v0.6"`) instead of running
 * the working tree. Putting one first makes the previous release the incumbent,
 * so a wire change is gated against what actually shipped rather than against
 * another build of the same tree.
 *
 * Sweeps read the TUNE split only (src/corpus.ts); `--split holdout` exists
 * solely to validate a finished winner against the pre-registered rule
 * (≥3% holdout mean ΔE00 improvement, no guard regressions) — never to tune.
 */

import fs from "node:fs/promises";
import { glob } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  RUST_CLI,
  decodeViaRust,
  encodeViaRust,
} from "./adapters/chromahash.ts";
import {
  type CorpusSet,
  type CorpusSplit,
  inCorpus,
  parseCorpusSet,
  splitFor,
} from "./corpus.ts";
import { gamutToSrgbReference } from "./gamut.ts";
import { generateFixtures } from "./generate-fixtures.ts";
import { ensureAlphaImages } from "./alpha-images.ts";
import { ensureGraphicImages } from "./graphic-images.ts";
import { ensureHoldoutImages } from "./holdout-images.ts";
import { loadImage } from "./image-loader.ts";
import {
  BACKDROP_SETS,
  type BackdropSetName,
  computeAllMetrics,
  flattenOverBackdrop,
  setScoringConfig,
} from "./metrics.ts";
import { ensureIqaAvailable } from "./metrics/iqa.ts";
import { ensureNaturalImages } from "./natural-images.ts";
import { quantile } from "./stats.ts";
import type { ImageInput } from "./types.ts";
import { prepareVersionBinaries } from "./version-builds.ts";

/** One TUNE variant to score. */
interface SweepVariant {
  /** Display label, e.g. "mu_l=6" or "pow:0.75". */
  label: string;
  /** CHROMAHASH_TUNE string; omit for the shipped defaults. */
  tune?: string;
  /** Quality tier (default 0). */
  tier?: number;
  /**
   * Decode capped to the image's tier-0 natural render size — the
   * embedded-tiers experiment: what would a tier-0-sized rendering of this
   * variant's hash look like?
   */
  capToTier0?: boolean;
  /**
   * Score this variant with a released tag's binary (e.g. `"v0.6"`) instead of
   * the working tree. Put it first in `variants` to make the previous release
   * the incumbent, so the guard machinery gates a wire change against what
   * actually shipped rather than against another build of the same tree.
   *
   * The tag is built through the same cached worktree + decode shim as
   * `just compare-versions`. That shim exposes only the pre-v1 API, so it
   * ignores CHROMAHASH_TUNE, has no quality tier, and always decodes uncapped —
   * `tune`, a non-zero `tier`, and `capToTier0` are rejected rather than
   * silently dropped.
   */
  version?: string;
}

interface SweepConfig {
  name: string;
  description?: string;
  /** First variant is the incumbent the guards compare against. */
  variants: SweepVariant[];
  /**
   * Body of content to measure against (see `corpus.ts`). Defaults to "all",
   * i.e. every fixture in the requested split.
   */
  corpus?: CorpusSet;
  /**
   * Legacy alias for `corpus: "photo"`. Kept so every config written before
   * the other corpora existed keeps its exact meaning; prefer `corpus`.
   */
  photoOnly?: boolean;
  /**
   * Backdrop set to composite translucent pixels over (see `metrics.ts`).
   * Defaults to `"white"`, which is the historical behaviour bit for bit.
   * An alpha experiment wants `"white-black-grey"`, or it is largely
   * measuring colour.
   */
  backdrops?: BackdropSetName;
  /** Also score the alpha plane directly, reported as `meanAlphaMae`. */
  alphaFidelity?: boolean;
  /**
   * Composite every input over the scoring backdrop and force alpha to opaque
   * before encoding, so the same pictures are measured in the format's *opaque*
   * mode.
   *
   * This is the control for an alpha-mode experiment. The alpha corpus is
   * cut-outs, insignia and line art — graphic-like content — and the graphics
   * corpus independently prefers more luma than photographs do. Without this,
   * "alpha mode wants a different layout" and "this content wants a different
   * layout" are the same measurement.
   */
  forceOpaque?: boolean;
}

/** Per-variant aggregate row of the decision table. */
interface SweepRow {
  label: string;
  tune: string | null;
  tier: number;
  /** Released tag this row was scored with, or null for the working tree. */
  version: string | null;
  images: number;
  bytes: number;
  meanCiede: number | null;
  medianCiede: number | null;
  meanSsimulacra2: number | null;
  meanButteraugli: number | null;
  meanDssim: number | null;
  /** Mean absolute alpha error on [0, 1], or null when alpha is not scored. */
  meanAlphaMae: number | null;
  /** ΔE00 change vs the incumbent, in percent (negative = better). */
  ciedeDeltaPct: number | null;
  /** All guard metrics within tolerance of the incumbent. */
  guardsOk: boolean | null;
  /** Per-image ΔE00 in corpus order — the input to paired statistics and to
   * per-image (oracle) analyses the aggregate row cannot express. */
  perImageCiede: (number | null)[];
  /** Corpus image names, in the same order as {@link perImageCiede}. */
  imageNames: string[];
}

/** Guard tolerances vs the incumbent (absolute for SSIM2, relative otherwise). */
const GUARD_SSIM2_DROP = 1.0;
const GUARD_REL_RISE = 0.02;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    split: { type: "string", default: "tune" },
    "max-images": { type: "string" },
  },
});

const configPathArg = positionals[0];
if (!configPathArg) {
  console.error(
    "Usage: node dist/sweep.js <config.json> [--split tune|holdout] [--max-images N]",
  );
  process.exit(1);
}
// Narrowed copy: the guard above doesn't flow into function bodies.
const configPath: string = configPathArg;
const split = (values.split ?? "tune") as CorpusSplit;
if (split !== "tune" && split !== "holdout") {
  console.error(`invalid --split: ${values.split}`);
  process.exit(1);
}
const maxImages = values["max-images"]
  ? Number.parseInt(values["max-images"], 10)
  : null;

/**
 * Resolve a config's corpus, honouring the legacy `photoOnly` alias. Declaring
 * both is an error rather than a precedence rule: a config that says two
 * different things about what it measures is a config whose result cannot be
 * interpreted.
 */
function corpusFor(config: SweepConfig): CorpusSet {
  if (config.corpus !== undefined && config.photoOnly !== undefined) {
    throw new Error(
      `config ${config.name} sets both "corpus" and the legacy "photoOnly"; keep one`,
    );
  }
  if (config.corpus !== undefined) return parseCorpusSet(config.corpus);
  return config.photoOnly ? "photo" : "all";
}

/** Mean of the non-null values, or null. */
function mean(values: (number | null)[]): number | null {
  const xs = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  return xs.length > 0 ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
}

/** Median of the non-null values, or null. */
function median(values: (number | null)[]): number | null {
  const xs = values
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  return xs.length > 0 ? quantile(xs, 0.5) : null;
}

async function loadCorpus(corpus: CorpusSet): Promise<ImageInput[]> {
  const toolRoot = path.resolve(import.meta.dirname, "..");
  const syntheticDir = path.join(toolRoot, "fixtures/synthetic");
  try {
    const files = await fs.readdir(syntheticDir);
    if (files.length === 0) await generateFixtures();
  } catch {
    await generateFixtures();
  }
  await ensureNaturalImages();
  if (split === "holdout") {
    await ensureHoldoutImages();
  }
  // Only fetch a corpus a run will actually score: the alpha and graphics sets
  // are ~40 MB the photographic sweeps would never look at.
  if (corpus === "alpha" || corpus === "all") await ensureAlphaImages();
  if (corpus === "graphic" || corpus === "all") await ensureGraphicImages();

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
    if (splitFor(name) !== split) continue;
    const input = await loadImage(filePath);
    // Mirror main.ts: gamut fixtures carry their gamut in the filename and are
    // scored against their color-managed sRGB appearance.
    const gamutMap: Record<string, string> = {
      "gamut-srgb": "srgb",
      "gamut-p3": "displayp3",
      "gamut-adobe-rgb": "adobergb",
      "gamut-bt2020": "bt2020",
      "gamut-prophoto": "prophoto",
    };
    input.gamut = gamutMap[name] ?? "srgb";
    input.metricReferenceRgba = gamutToSrgbReference(
      input.referenceRgba,
      input.gamut,
    );
    inputs.push(input);
  }
  return inputs;
}

/**
 * Validate the `version` field across a config and build every tag it names.
 * Returns version → binary path; empty when no variant uses one. Fails fast on
 * an unbuildable tag or an option the tag's decode shim cannot honour — a
 * silently ignored knob would corrupt the whole decision table.
 */
function resolveVersionBinaries(variants: SweepVariant[]): Map<string, string> {
  const wanted = [
    ...new Set(
      variants.map((v) => v.version).filter((v): v is string => Boolean(v)),
    ),
  ];
  const resolved = new Map<string, string>();
  if (wanted.length === 0) return resolved;

  for (const v of variants) {
    if (!v.version) continue;
    const rejected = [
      v.tune ? "tune" : null,
      v.tier ? "tier" : null,
      v.capToTier0 ? "capToTier0" : null,
    ].filter(Boolean);
    if (rejected.length > 0) {
      throw new Error(
        `variant "${v.label}" combines version=${v.version} with ${rejected.join("/")}: the released tag's decode shim exposes only the pre-v1 API and cannot honour those.`,
      );
    }
  }

  for (const bin of prepareVersionBinaries(wanted)) {
    resolved.set(bin.version, bin.binaryPath);
  }
  const missing = wanted.filter((v) => !resolved.has(v));
  if (missing.length > 0) {
    throw new Error(
      `failed to build version binaries: ${missing.join(", ")} (see the build output above)`,
    );
  }
  return resolved;
}

async function scoreVariant(
  variant: SweepVariant,
  inputs: ImageInput[],
  versionBinaries: Map<string, string>,
): Promise<SweepRow> {
  const tier = variant.tier ?? 0;
  // A tag variant runs its own binary; hashes are not portable across format
  // generations, so the same binary must both encode and decode.
  const cli = variant.version
    ? (versionBinaries.get(variant.version) as string)
    : RUST_CLI;
  const ciedes: (number | null)[] = [];
  const ssim2s: (number | null)[] = [];
  const butters: (number | null)[] = [];
  const dssims: (number | null)[] = [];
  const alphaMaes: (number | null)[] = [];
  let bytesSum = 0;

  for (const input of inputs) {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;
    const gamut = input.gamut ?? "srgb";
    const hash = encodeViaRust(cli, w, h, rgba, gamut, tier, variant.tune);
    bytesSum += hash.length;

    let capW = w;
    let capH = h;
    if (variant.capToTier0) {
      // The image's tier-0 natural render size, from an uncapped tier-0 decode
      // of the incumbent (dimensions depend only on the aspect byte).
      const t0 = encodeViaRust(cli, w, h, rgba, gamut, 0, variant.tune);
      const t0dec = decodeViaRust(
        cli,
        t0,
        "srgb",
        undefined,
        undefined,
        variant.tune,
      );
      capW = t0dec.w;
      capH = t0dec.h;
    }
    const decoded = decodeViaRust(cli, hash, "srgb", capW, capH, variant.tune);

    const reference = input.metricReferenceRgba ?? input.referenceRgba;
    const { metrics, alphaMae } = await computeAllMetrics(
      reference,
      input.referenceWidth,
      input.referenceHeight,
      decoded.rgba,
      decoded.w,
      decoded.h,
    );
    ciedes.push(metrics.ciede2000);
    ssim2s.push(metrics.ssimulacra2);
    butters.push(metrics.butteraugli);
    dssims.push(metrics.dssim);
    alphaMaes.push(alphaMae);
  }

  return {
    label: variant.label,
    tune: variant.tune ?? null,
    tier,
    version: variant.version ?? null,
    images: inputs.length,
    perImageCiede: ciedes,
    imageNames: inputs.map((i) =>
      path.basename(i.filePath).replace(/\.[^.]+$/, ""),
    ),
    bytes: bytesSum / (inputs.length || 1),
    meanCiede: mean(ciedes),
    medianCiede: median(ciedes),
    meanSsimulacra2: mean(ssim2s),
    meanButteraugli: mean(butters),
    meanDssim: mean(dssims),
    meanAlphaMae: mean(alphaMaes),
    ciedeDeltaPct: null,
    guardsOk: null,
  };
}

/** Fill ciedeDeltaPct/guardsOk on every row from the incumbent (row 0). */
function applyGuards(rows: SweepRow[]): void {
  const base = rows[0];
  if (!base) return;
  for (const row of rows.slice(1)) {
    if (row.meanCiede !== null && base.meanCiede !== null) {
      row.ciedeDeltaPct =
        ((row.meanCiede - base.meanCiede) / base.meanCiede) * 100;
    }
    const ssim2Ok =
      row.meanSsimulacra2 === null ||
      base.meanSsimulacra2 === null ||
      row.meanSsimulacra2 >= base.meanSsimulacra2 - GUARD_SSIM2_DROP;
    const butterOk =
      row.meanButteraugli === null ||
      base.meanButteraugli === null ||
      row.meanButteraugli <= base.meanButteraugli * (1 + GUARD_REL_RISE);
    const dssimOk =
      row.meanDssim === null ||
      base.meanDssim === null ||
      row.meanDssim <= base.meanDssim * (1 + GUARD_REL_RISE);
    row.guardsOk = ssim2Ok && butterOk && dssimOk;
  }
}

async function main(): Promise<void> {
  ensureIqaAvailable();
  const raw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(raw) as SweepConfig;
  setScoringConfig({
    upscalePolicy: "browser-gamma",
    blurredScoring: false,
    backdrops: BACKDROP_SETS[config.backdrops ?? "white"],
    alphaFidelity: config.alphaFidelity ?? false,
  });
  if (!config.variants?.length) {
    throw new Error(`config ${config.name} declares no variants`);
  }

  const corpus = corpusFor(config);
  let inputs = await loadCorpus(corpus);
  if (corpus !== "all") {
    inputs = inputs.filter((i) =>
      inCorpus(path.parse(i.filePath).name, corpus),
    );
  }
  if (maxImages !== null) {
    inputs = inputs.slice(0, maxImages);
  }
  if (config.forceOpaque) {
    // Flatten both the encoder input and the reference, so the images enter the
    // encoder with no alpha at all and are scored against their own opaque
    // appearance rather than against a translucent original.
    for (const input of inputs) {
      input.smallRgba = flattenOverBackdrop(input.smallRgba);
      input.referenceRgba = flattenOverBackdrop(input.referenceRgba);
      if (input.metricReferenceRgba) {
        input.metricReferenceRgba = flattenOverBackdrop(
          input.metricReferenceRgba,
        );
      }
    }
  }
  console.log(
    `Sweep ${config.name}: ${config.variants.length} variants × ${inputs.length} ${split}-split images`,
  );

  const versionBinaries = resolveVersionBinaries(config.variants);

  const rows: SweepRow[] = [];
  for (const variant of config.variants) {
    const started = performance.now();
    const row = await scoreVariant(variant, inputs, versionBinaries);
    rows.push(row);
    console.log(
      `  ${variant.label.padEnd(28)} ΔE00 ${row.meanCiede?.toFixed(3) ?? "N/A"} (${((performance.now() - started) / 1000).toFixed(0)}s)`,
    );
  }
  applyGuards(rows);

  const toolRoot = path.resolve(import.meta.dirname, "..");
  const outDir = path.join(toolRoot, "output/sweeps");
  await fs.mkdir(outDir, { recursive: true });
  const suffix = split === "holdout" ? "-holdout" : "";
  const outPath = path.join(outDir, `${config.name}${suffix}.json`);
  await fs.writeFile(
    outPath,
    `${JSON.stringify({ name: config.name, description: config.description ?? null, split, images: inputs.length, guardTolerances: { ssimulacra2Drop: GUARD_SSIM2_DROP, relativeRise: GUARD_REL_RISE }, corpus, backdrops: config.backdrops ?? "white", alphaFidelity: config.alphaFidelity ?? false, rows }, null, 2)}\n`,
  );

  console.log(`\nDecision table (${split} split) → ${outPath}`);
  // The alpha column only exists when alpha was scored, so an opaque sweep's
  // table stays exactly as wide as it was.
  const showAlpha = rows.some((r) => r.meanAlphaMae !== null);
  console.log(
    `  ${"Variant".padEnd(28)} ${"Bytes".padStart(6)} ${"ΔE00".padStart(8)} ${"Δ%".padStart(7)} ${"Med".padStart(8)} ${"SSIM2".padStart(8)} ${"Butter".padStart(8)} ${"DSSIM".padStart(8)}${showAlpha ? ` ${"αMAE".padStart(8)}` : ""} Guards`,
  );
  const cell = (v: number | null, d: number, w: number) =>
    (v !== null ? v.toFixed(d) : "N/A").padStart(w);
  for (const r of rows) {
    const guards = r.guardsOk === null ? "(base)" : r.guardsOk ? "ok" : "FAIL";
    const alpha = showAlpha ? ` ${cell(r.meanAlphaMae, 4, 8)}` : "";
    console.log(
      `  ${r.label.padEnd(28)} ${r.bytes.toFixed(0).padStart(6)} ${cell(r.meanCiede, 3, 8)} ${cell(r.ciedeDeltaPct, 2, 7)} ${cell(r.medianCiede, 3, 8)} ${cell(r.meanSsimulacra2, 1, 8)} ${cell(r.meanButteraugli, 2, 8)} ${cell(r.meanDssim, 4, 8)}${alpha} ${guards}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
