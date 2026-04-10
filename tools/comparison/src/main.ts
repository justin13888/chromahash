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
  loadImage,
  rgbaToDataUri,
  fileBufferToDisplayDataUri,
} from "./image-loader.ts";
import { buildHarnesses, runAllHarnesses } from "./harness-runner.ts";
import {
  generateReport,
  categorizeImage,
  computeFormatStats,
} from "./report.ts";
import { generateFixtures } from "./generate-fixtures.ts";
import { ensureNaturalImages } from "./natural-images.ts";
import { computeCompositeScores } from "./metrics.ts";
import type {
  FormatAdapter,
  FormatResult,
  HarnessResult,
  ImageCategory,
} from "./types.ts";

const { values } = parseArgs({
  options: {
    images: { type: "string", default: "fixtures/**/*.{png,jpg}" },
    output: { type: "string", default: "output/report.html" },
    iterations: { type: "string", default: "10" },
    "skip-harnesses": { type: "boolean", default: false },
    "generate-fixtures": { type: "boolean", default: true },
    "skip-natural": { type: "boolean", default: false },
  },
});

const imagesGlob = values.images ?? "fixtures/**/*.{png,jpg}";
const outputPath = values.output ?? "output/report.html";
const iterations = Number.parseInt(values.iterations ?? "10", 10);
const skipHarnesses = values["skip-harnesses"] ?? false;
const shouldGenerateFixtures = values["generate-fixtures"] ?? true;
const skipNatural = values["skip-natural"] ?? false;

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

  // Initialize adapters
  const adapters: FormatAdapter[] = [
    new ChromaHashAdapter(),
    new ThumbHashAdapter(),
    new BlurHashAdapter(),
    new LqipModernAdapter(),
    new UnpicAdapter(),
  ];

  const entries: Array<{
    name: string;
    category: ImageCategory;
    originalWidth: number;
    originalHeight: number;
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

    const originalDataUri = await fileBufferToDisplayDataUri(input.fileBuffer);
    const loResDataUri = await rgbaToDataUri(
      input.smallRgba,
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

    // Compute composite scores now that all formats for this image have run
    computeCompositeScores(formatResults);

    entries.push({
      name,
      category,
      originalWidth: input.originalWidth,
      originalHeight: input.originalHeight,
      originalDataUri,
      loResDataUri,
      formatResults,
      harnessResults,
    });
  }

  // Generate HTML report
  const html = generateReport(entries);
  const absOutput = path.resolve(toolRoot, outputPath);
  await fs.mkdir(path.dirname(absOutput), { recursive: true });
  await fs.writeFile(absOutput, html);

  const fileUrl = `file://${absOutput}`;
  console.log(
    `\nReport written to: \x1b]8;;${fileUrl}\x1b\\${absOutput}\x1b]8;;\x1b\\`,
  );

  // Print expanded metric summary
  const formatNames = [
    ...new Set(
      entries.flatMap((e) => e.formatResults.map((r) => r.formatName)),
    ),
  ];

  const printSummary = (
    label: string,
    stats: ReturnType<typeof computeFormatStats>,
  ) => {
    console.log(`\n=== Format Summary (${label}) ===`);
    console.log(
      `  ${"Format".padEnd(14)} ${"Size(B)".padStart(8)} ${"DSSIM".padStart(8)} ${"dE(wtd)".padStart(9)} ${"Composite".padStart(10)} ${"PSNR(dB)".padStart(9)}`,
    );
    for (const s of stats) {
      console.log(
        `  ${s.name.padEnd(14)} ${s.avgSize.toFixed(0).padStart(8)} ${(s.avgDssim !== null ? s.avgDssim.toFixed(4) : "N/A").padStart(8)} ${(s.avgDe !== null ? s.avgDe.toFixed(4) : "N/A").padStart(9)} ${(s.avgComp !== null ? s.avgComp.toFixed(3) : "N/A").padStart(10)} ${(s.avgPsnr !== null ? s.avgPsnr.toFixed(1) : "N/A").padStart(9)}`,
      );
    }
  };

  const naturalStats = computeFormatStats(entries, formatNames, (e) =>
    (["Natural", "Realistic"] as ImageCategory[]).includes(e.category),
  );
  const allStats = computeFormatStats(entries, formatNames);

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
