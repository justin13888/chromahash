import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { glob } from "node:fs/promises";
import { ChromaHashAdapter } from "./adapters/chromahash.ts";
import { ThumbHashAdapter } from "./adapters/thumbhash.ts";
import { BlurHashAdapter } from "./adapters/blurhash.ts";
import { LqipModernAdapter } from "./adapters/lqip-modern.ts";
import { UnpicAdapter } from "./adapters/unpic.ts";
import {
  prepareVersionBinaries,
  type VersionBinary,
} from "./version-builds.ts";
import {
  loadImage,
  rgbaToDataUri,
  fileBufferToDisplayDataUri,
  writeImageFile,
} from "./image-loader.ts";
import { buildHarnesses, runAllHarnesses } from "./harness-runner.ts";
import {
  generateReport,
  categorizeImage,
  computeFormatStats,
  FORMAT_NAMES,
  LANGUAGES,
} from "./report.ts";
import type { ReportMeta } from "./report.ts";
import { generateFixtures } from "./generate-fixtures.ts";
import { ensureNaturalImages } from "./natural-images.ts";
import { gamutToSrgbReference } from "./gamut.ts";
import type {
  ComparisonImageJson,
  ComparisonJson,
  FormatAdapter,
  FormatJson,
  FormatResult,
  HarnessResult,
  ImageCategory,
  ImplementationJson,
} from "./types.ts";

const { values } = parseArgs({
  options: {
    images: { type: "string", default: "fixtures/**/*.{png,jpg}" },
    // No parseArgs default: the code-level default below picks the report name so
    // version mode can fall back to versions-report.html instead of clobbering it.
    output: { type: "string" },
    json: { type: "string" },
    iterations: { type: "string", default: "10" },
    "skip-harnesses": { type: "boolean", default: false },
    "generate-fixtures": { type: "boolean", default: true },
    "skip-natural": { type: "boolean", default: false },
    formats: { type: "string" },
    versions: { type: "string" },
    commit: { type: "string" },
  },
});

const imagesGlob = values.images ?? "fixtures/**/*.{png,jpg}";
const outputPath =
  values.output ??
  (values.versions ? "output/versions-report.html" : "output/report.html");
const iterations = Number.parseInt(values.iterations ?? "10", 10);
// Version-comparison mode compares chromahash builds only, so the cross-language
// harness verification is irrelevant there and is always skipped.
const skipHarnesses =
  (values["skip-harnesses"] ?? false) || Boolean(values.versions);
const shouldGenerateFixtures = values["generate-fixtures"] ?? true;
const skipNatural = values["skip-natural"] ?? false;
/** Optional comma-separated format filter (case-insensitive), e.g. --formats ChromaHash,ThumbHash. */
const formatFilter = values.formats
  ? values.formats.split(",").map((f) => f.trim().toLowerCase())
  : null;
/** Optional chromahash version list, e.g. --versions v0.2,v0.3,v0.4,v0.5,current. */
const versionList = values.versions
  ? values.versions
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  : null;

/** Derive the JSON output path from the HTML output path by swapping the extension. */
function deriveJsonPath(htmlPath: string): string {
  const ext = path.extname(htmlPath);
  return `${htmlPath.slice(0, htmlPath.length - ext.length)}.json`;
}

const jsonPath = values.json ?? deriveJsonPath(outputPath);

/** Make a filesystem- and URL-safe slug for image file names. */
function slugify(value: string): string {
  return value.replace(/#/g, "sharp").replace(/[^A-Za-z0-9._-]+/g, "-");
}

/** Hex-encode a hash (empty input -> empty string). */
function toHex(bytes: Uint8Array): string {
  return bytes.length > 0 ? Buffer.from(bytes).toString("hex") : "";
}

/**
 * Resolve the source commit the report is built from: an explicit --commit flag,
 * the CI-provided GITHUB_SHA, then a local `git rev-parse HEAD`, else null.
 */
function resolveCommit(toolRoot: string): string | null {
  if (values.commit) return values.commit;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: toolRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

/** Base repo URL from CI env (used to link the footer commit), else null. */
function resolveRepoUrl(): string | null {
  const server = process.env.GITHUB_SERVER_URL;
  const repo = process.env.GITHUB_REPOSITORY;
  return server && repo ? `${server}/${repo}` : null;
}

/**
 * Label for the working-tree ("current") build in the version report: the short
 * commit plus a dirty marker, e.g. `current (a1b2c3d, dirty)`. This is the primary
 * variant — it's what the report exists to evaluate against the released tags.
 */
function currentVariantLabel(toolRoot: string): string {
  const git = (args: string[]): string => {
    try {
      return execFileSync("git", args, {
        cwd: toolRoot,
        encoding: "utf8",
      }).trim();
    } catch {
      return "";
    }
  };
  const short = git(["rev-parse", "--short", "HEAD"]) || "unknown";
  const dirty = git(["status", "--porcelain"]).length > 0;
  return `current (${short}${dirty ? ", dirty" : ""})`;
}

/** Order version builds for display: current (primary) first, then tags descending. */
function orderVersions(bins: VersionBinary[]): VersionBinary[] {
  const current = bins.filter((b) => b.version === "current");
  const tags = bins
    .filter((b) => b.version !== "current")
    .sort((a, b) =>
      b.version.localeCompare(a.version, undefined, { numeric: true }),
    );
  return [...current, ...tags];
}

async function main(): Promise<void> {
  const toolRoot = path.resolve(import.meta.dirname, "..");

  // Generate synthetic fixtures if needed
  if (shouldGenerateFixtures) {
    const syntheticDir = path.join(toolRoot, "fixtures/synthetic");
    try {
      const files = await fs.readdir(syntheticDir);
      if (files.length === 0) {
        await generateFixtures();
      }
    } catch {
      await generateFixtures();
    }
  }

  // Fetch natural images from Picsum (on-demand with local cache)
  if (!skipNatural) {
    console.log("Ensuring natural images are cached...");
    const naturalPaths = await ensureNaturalImages();
    if (naturalPaths.length > 0) {
      console.log(`${naturalPaths.length} natural image(s) available.`);
    } else {
      console.warn("No natural images available (network may be offline).");
    }
  }

  // Find all image files
  const resolvedGlob = path.resolve(toolRoot, imagesGlob);
  const imagePaths: string[] = [];
  for await (const entry of glob(resolvedGlob)) {
    if (entry.endsWith(".png") || entry.endsWith(".jpg")) {
      imagePaths.push(entry);
    }
  }
  imagePaths.sort();

  if (imagePaths.length === 0) {
    console.error(`No images found matching: ${resolvedGlob}`);
    process.exit(1);
  }

  console.log(`Found ${imagePaths.length} images.`);

  // Build all harness binaries once
  if (!skipHarnesses) {
    console.log("Building harnesses...");
    buildHarnesses();
    console.log("Harnesses built.");
  }

  // Initialize adapters. In version-comparison mode every "format" column is a
  // chromahash build (one per version, each round-tripping with its own binary);
  // otherwise it's the cross-format LQIP line-up.
  let adapters: FormatAdapter[];
  let activeFormatNames: string[];
  if (versionList) {
    console.log("Preparing chromahash version binaries...");
    const bins = orderVersions(prepareVersionBinaries(versionList));
    adapters = bins.map(
      (b) =>
        new ChromaHashAdapter({
          name:
            b.version === "current" ? currentVariantLabel(toolRoot) : b.version,
          binaryPath: b.binaryPath,
          // Decode uncapped so every version is framed identically (the oldest
          // tags lack capped decode); metrics resample to source regardless.
          capToSource: false,
        }),
    );
    if (adapters.length === 0) {
      console.error("No version binaries were built; nothing to compare.");
      process.exit(1);
    }
    activeFormatNames = adapters.map((a) => a.name);
    console.log(`Version comparison: ${activeFormatNames.join(", ")}`);
  } else {
    adapters = [
      new ChromaHashAdapter(),
      new ThumbHashAdapter(),
      new BlurHashAdapter(),
      new LqipModernAdapter(),
      new UnpicAdapter(),
    ];
    if (formatFilter) {
      adapters = adapters.filter((a) =>
        formatFilter.includes(a.name.toLowerCase()),
      );
      if (adapters.length === 0) {
        console.error(`--formats matched no adapters: ${values.formats}`);
        process.exit(1);
      }
      console.log(
        `Format filter active: ${adapters.map((a) => a.name).join(", ")}`,
      );
    }
    activeFormatNames = FORMAT_NAMES.filter((n) =>
      adapters.some((a) => a.name === n),
    );
  }

  const entries: Array<{
    name: string;
    category: ImageCategory;
    originalWidth: number;
    originalHeight: number;
    smallWidth: number;
    smallHeight: number;
    originalDataUri: string;
    loResDataUri: string;
    formatResults: FormatResult[];
    harnessResults: HarnessResult[];
  }> = [];

  for (const imagePath of imagePaths) {
    const fileName = path.basename(imagePath);
    const name = fileName.replace(/\.[^.]+$/, "");
    const category = categorizeImage(fileName);

    console.log(`Processing: ${name} (${category})`);

    const input = await loadImage(imagePath);

    // Determine gamut from filename (used by both adapters and harnesses)
    const gamutMap: Record<string, string> = {
      "gamut-srgb": "srgb",
      "gamut-p3": "displayp3",
      "gamut-adobe-rgb": "adobergb",
      "gamut-bt2020": "bt2020",
      "gamut-prophoto": "prophoto",
    };
    const gamut = gamutMap[name] ?? "srgb";
    input.gamut = gamut;
    // Color-managed metric reference: all formats are scored against the
    // image's true sRGB appearance, not the raw gamut-encoded bytes.
    input.metricReferenceRgba = gamutToSrgbReference(input.smallRgba, gamut);

    // Gamut fixtures store raw bytes tagged with a wide gamut and carry no ICC
    // profile, so rendering them as plain sRGB misrepresents the source. For
    // those, show the color-managed sRGB appearance (the same reference metrics
    // and a correct decode target) so the Original matches what a gamut-aware
    // decode reproduces — issue #39. sRGB images keep the full-res file path.
    const colorManaged = gamut !== "srgb";
    const displayRgba = input.metricReferenceRgba ?? input.smallRgba;
    const originalDataUri = colorManaged
      ? await rgbaToDataUri(displayRgba, input.smallWidth, input.smallHeight)
      : await fileBufferToDisplayDataUri(input.fileBuffer);
    const loResDataUri = await rgbaToDataUri(
      colorManaged ? displayRgba : input.smallRgba,
      input.smallWidth,
      input.smallHeight,
    );

    // Run format adapters
    const formatResults: FormatResult[] = [];
    for (const adapter of adapters) {
      try {
        const result = await adapter.process(input, iterations);
        formatResults.push(result);
      } catch (err) {
        console.warn(
          `  ${adapter.name} failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Run cross-language harnesses (if not skipped)
    let harnessResults: HarnessResult[] = [];
    if (!skipHarnesses) {
      try {
        harnessResults = await runAllHarnesses(input, gamut);
      } catch (err) {
        console.warn(
          `  Harness runner failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    entries.push({
      name,
      category,
      originalWidth: input.originalWidth,
      originalHeight: input.originalHeight,
      smallWidth: input.smallWidth,
      smallHeight: input.smallHeight,
      originalDataUri,
      loResDataUri,
      formatResults,
      harnessResults,
    });
  }

  const absOutput = path.resolve(toolRoot, outputPath);
  const absJson = path.resolve(toolRoot, jsonPath);
  const meta: ReportMeta = {
    commit: resolveCommit(toolRoot),
    repoUrl: resolveRepoUrl(),
    generatedAt: `${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  };

  // Materialize every image as a standalone file under <output dir>/images/, and
  // rewrite each entry's inline data URIs to relative paths so the HTML and JSON
  // both reference the same assets. The directory is recreated each run so no
  // stale images linger.
  const imagesSubdir = "images";
  const imagesDir = path.join(path.dirname(absOutput), imagesSubdir);
  await fs.rm(imagesDir, { recursive: true, force: true });
  await fs.mkdir(imagesDir, { recursive: true });

  const jsonImages: ComparisonImageJson[] = [];
  for (const entry of entries) {
    const base = slugify(entry.name);

    const [originalFile, inputFile] = await Promise.all([
      writeImageFile(entry.originalDataUri, imagesDir, `${base}__original`),
      writeImageFile(entry.loResDataUri, imagesDir, `${base}__input`),
    ]);
    entry.originalDataUri = `${imagesSubdir}/${originalFile.fileName}`;
    entry.loResDataUri = `${imagesSubdir}/${inputFile.fileName}`;

    const formats: FormatJson[] = await Promise.all(
      entry.formatResults.map(async (r): Promise<FormatJson> => {
        let preview: string | null = null;
        let css: string | null = null;
        if (r.dataUri.startsWith("css:")) {
          // CSS-only formats (e.g. unpic) keep their sentinel; no file is written.
          css = r.dataUri.slice(4);
        } else if (r.dataUri) {
          const file = await writeImageFile(
            r.dataUri,
            imagesDir,
            `${base}__fmt-${slugify(r.formatName)}`,
          );
          preview = `${imagesSubdir}/${file.fileName}`;
          r.dataUri = preview;
        }
        return {
          formatName: r.formatName,
          encodedSizeBytes: r.encodedSizeBytes,
          decodedWidth: r.decodedWidth,
          decodedHeight: r.decodedHeight,
          encodeTimeMs: r.encodeTimeMs,
          decodeTimeMs: r.decodeTimeMs,
          preview,
          css,
          metrics: r.metrics,
        };
      }),
    );

    const implementations: ImplementationJson[] = await Promise.all(
      entry.harnessResults.map(async (r): Promise<ImplementationJson> => {
        let preview: string | null = null;
        if (r.dataUri) {
          const file = await writeImageFile(
            r.dataUri,
            imagesDir,
            `${base}__lang-${slugify(r.language)}`,
          );
          preview = `${imagesSubdir}/${file.fileName}`;
          r.dataUri = preview;
        }
        return {
          language: r.language,
          hash: toHex(r.hash),
          matches: r.matches,
          preview,
        };
      }),
    );

    jsonImages.push({
      name: entry.name,
      category: entry.category,
      originalWidth: entry.originalWidth,
      originalHeight: entry.originalHeight,
      original: entry.originalDataUri,
      encoderInput: entry.loResDataUri,
      encoderInputWidth: entry.smallWidth,
      encoderInputHeight: entry.smallHeight,
      formats,
      implementations,
    });
  }

  // Summary stats are reused by both the JSON output and the console summary.
  const naturalStats = computeFormatStats(entries, activeFormatNames, (e) =>
    (["Natural", "Realistic"] as ImageCategory[]).includes(e.category),
  );
  const allStats = computeFormatStats(entries, activeFormatNames);

  const harnessesSkipped = entries.every((e) => e.harnessResults.length === 0);
  const crossLanguage = LANGUAGES.map((language) => {
    if (harnessesSkipped) return { language, pass: null as boolean | null };
    const pass = entries.every(
      (e) =>
        e.harnessResults.find((r) => r.language === language)?.matches ?? false,
    );
    return { language, pass };
  });

  const json: ComparisonJson = {
    schemaVersion: 1,
    generatedAt: meta.generatedAt,
    commit: meta.commit,
    repoUrl: meta.repoUrl,
    formats: activeFormatNames,
    languages: LANGUAGES,
    summary: { naturalAndRealistic: naturalStats, all: allStats },
    crossLanguage,
    images: jsonImages,
  };
  await fs.mkdir(path.dirname(absJson), { recursive: true });
  await fs.writeFile(absJson, `${JSON.stringify(json, null, 2)}\n`);

  // Render the HTML report (now referencing the standalone images by path).
  const html = generateReport(
    entries,
    meta,
    versionList
      ? { formatNames: activeFormatNames, showImplementations: false }
      : undefined,
  );
  await fs.writeFile(absOutput, html);

  const link = (p: string) => `\x1b]8;;file://${p}\x1b\\${p}\x1b]8;;\x1b\\`;
  console.log(`\nReport written to: ${link(absOutput)}`);
  console.log(`JSON written to:   ${link(absJson)}`);
  console.log(`Images written to: ${link(imagesDir)}/`);

  // Print expanded metric summary
  const cell = (v: number | null, digits: number, width: number): string =>
    (v !== null ? v.toFixed(digits) : "N/A").padStart(width);

  const printSummary = (
    label: string,
    stats: ReturnType<typeof computeFormatStats>,
  ) => {
    console.log(`\n=== Format Summary (${label}) ===`);
    console.log(
      `  ${"Format".padEnd(14)} ${"Size(B)".padStart(8)} ${"ΔE00".padStart(8)} ${"DSSIM".padStart(8)} ${"MS-SSIM".padStart(8)} ${"SSIM2".padStart(8)} ${"Butter".padStart(8)} ${"PSNR(dB)".padStart(9)}`,
    );
    for (const s of stats) {
      console.log(
        `  ${s.name.padEnd(14)} ${s.avgSize.toFixed(0).padStart(8)} ${cell(s.avgCiede, 2, 8)} ${cell(s.avgDssim, 4, 8)} ${cell(s.avgMsSsim, 4, 8)} ${cell(s.avgSsimulacra2, 1, 8)} ${cell(s.avgButteraugli, 2, 8)} ${cell(s.avgPsnr, 1, 9)}`,
      );
    }
  };

  printSummary("Natural Images Only", naturalStats);
  printSummary("All Images", allStats);

  if (!skipHarnesses) {
    console.log("\n=== Cross-Language Verification ===");
    const allLangs = new Set(
      entries.flatMap((e) => e.harnessResults.map((r) => r.language)),
    );
    for (const lang of allLangs) {
      const results = entries.flatMap((e) =>
        e.harnessResults.filter((r) => r.language === lang),
      );
      const allMatch = results.every((r) => r.matches);
      console.log(`  ${lang}: ${allMatch ? "PASS" : "FAIL"}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
