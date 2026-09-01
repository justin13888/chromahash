/**
 * Assert that scoring concurrently produces byte-identical output to scoring
 * serially.
 *
 * The harness fans images out across cores (see `pool.ts`). Nothing about the
 * metrics is order-dependent — `iqa-cli` results are content-addressed, and the
 * quantiles sort — but the *aggregates* are naive left-folds, so bit-identical
 * output depends on results being placed back by index rather than pushed on
 * completion. That is an easy invariant to break silently: a run reordered by
 * whichever image finished first would still look completely plausible, and
 * would differ from CI in the last few digits of every mean.
 *
 * So this runs the real orchestrator twice over the generated fixtures, once at
 * `--jobs 1` and once wide, and diffs the two reports. Deliberately built on
 * the synthetic corpus: it is generated locally, so this gate needs no network,
 * no pinned corpus and no corpus-host availability — it can run on every CI
 * push, which is the only way it catches anything.
 *
 * Run with `mise run selftest:determinism`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateFixtures } from "./generate-fixtures.ts";

const TOOL_ROOT = path.resolve(import.meta.dirname, "..");
const MAIN = path.join(TOOL_ROOT, "dist/main.js");
const SYNTHETIC = path.join(TOOL_ROOT, "fixtures/synthetic");

/**
 * Volatile fields that differ between any two runs and say nothing about
 * determinism: when the report was generated, and the paths of the standalone
 * image files, which each run writes into its own output directory.
 */
const VOLATILE = new Set(["generatedAt", "commit", "preview", "css"]);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE.has(key)) continue;
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function runReport(outDir: string, jobs: number): string {
  execFileSync(
    process.execPath,
    [
      MAIN,
      "--images",
      "fixtures/synthetic/*.png",
      "--skip-natural",
      "--skip-holdout",
      "--skip-harnesses",
      "--jobs",
      String(jobs),
      "--output",
      path.join(outDir, `report-j${jobs}.html`),
      "--json",
      path.join(outDir, `report-j${jobs}.json`),
    ],
    { cwd: TOOL_ROOT, stdio: ["ignore", "ignore", "inherit"] },
  );
  const raw = readFileSync(path.join(outDir, `report-j${jobs}.json`), "utf8");
  return JSON.stringify(canonical(JSON.parse(raw)), null, 1);
}

/** First differing line, with a little context, or null when identical. */
function firstDifference(a: string, b: string): string | null {
  if (a === b) return null;
  const as = a.split("\n");
  const bs = b.split("\n");
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    if (as[i] !== bs[i]) {
      return [
        `  first difference at line ${i + 1}:`,
        `    serial:   ${as[i] ?? "<missing>"}`,
        `    parallel: ${bs[i] ?? "<missing>"}`,
      ].join("\n");
    }
  }
  return "  reports differ in length only";
}

async function main(): Promise<void> {
  if (!existsSync(MAIN)) {
    console.error(
      `${MAIN} is missing — run \`pnpm --prefix tools/comparison run build\` first.`,
    );
    process.exit(1);
  }

  // The generated corpus is gitignored, so a clean checkout has none.
  if (!existsSync(SYNTHETIC)) {
    console.log("Generating synthetic fixtures...");
    await generateFixtures();
  }

  // Two workers is enough to interleave; more only lengthens the gate. A
  // machine that reports one core cannot demonstrate anything here.
  const wide = Math.max(2, Math.min(8, os.availableParallelism()));
  const outDir = mkdtempSync(path.join(os.tmpdir(), "chromahash-determinism-"));

  try {
    console.log("Scoring the synthetic corpus serially (--jobs 1)...");
    const serial = runReport(outDir, 1);
    console.log(`Scoring it again concurrently (--jobs ${wide})...`);
    const parallel = runReport(outDir, wide);

    const diff = firstDifference(serial, parallel);
    if (diff !== null) {
      console.error(
        [
          `FAIL  --jobs 1 and --jobs ${wide} produced different reports.`,
          diff,
          "",
          "  Concurrency must not change a published number. The usual cause is a",
          "  result appended on completion instead of placed by index, which",
          "  reorders the left-folds every mean is computed with.",
        ].join("\n"),
      );
      process.exit(1);
    }

    console.log(
      `\nPASS  --jobs 1 and --jobs ${wide} agree byte for byte (${serial.length} bytes of canonicalized report).`,
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

await main();
