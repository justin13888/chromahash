/**
 * Generate `fixtures/natural/LICENSES.md` from the pin table that fetches those
 * images, and check it has not drifted.
 *
 * Attribution and pins used to live in two places. They drifted: the graphics
 * corpus recorded one image's licence under `graphic-hbar-chart-shipments`
 * while the fetcher had always called it `graphic-scientific-plot`, so the
 * attribution was filed under a name no file on disk has ever had. Nothing
 * noticed, because nothing compared them.
 *
 * Here the pin table is the single source: every entry carries its own source
 * page, author and licence, and this renders them. A missing attribution is a
 * type error rather than a documentation lapse.
 *
 *   mise run corpus:licenses          # rewrite the file
 *   mise run corpus:licenses --check  # fail if it is stale (CI)
 */

import fs from "node:fs/promises";
import path from "node:path";
import { CURATED_IMAGES } from "./natural-images.ts";

const OUT = path.resolve(
  import.meta.dirname,
  "../fixtures/natural/LICENSES.md",
);

const HEADER = `# Curated photographic corpus — sources and licences

Every image is from Wikimedia Commons under a free licence. Attribution below is
per image, as the licences require.

These files are **not committed** — they are fetched on demand and content-pinned
by SHA-256 (\`src/natural-images.ts\`, \`src/corpus-pin.ts\`). A pin mismatch is
fatal: the corpus a number was measured on is part of what the number means.

**This file is generated.** Edit the table in \`src/natural-images.ts\` and run
\`mise run corpus:licenses\`; \`--check\` fails when the two disagree.

| Axis | Meaning |
| --- | --- |
| Measured on the 512 px scoring reference: mean L\\*, mean chroma C\\*, and the
  fraction of pixels in the top two L\\* deciles (high-key) — the quantities
  \`spec/EXPERIMENTS.md\` §9.1 audits the corpus against. |

`;

function render(): string {
  const rows = [...CURATED_IMAGES].sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  const parts = [HEADER];
  parts.push(
    `${rows.length} images — ${rows.filter((r) => r.split === "tune").length} tune, ${rows.filter((r) => r.split === "holdout").length} holdout.\n`,
  );

  for (const r of rows) {
    parts.push(
      [
        `### \`${r.label}\``,
        "",
        `- Source: <${r.source}>`,
        `- File: <${r.urls[0]}>`,
        `- Author: ${r.author}`,
        `- License: ${r.licence}`,
        `- Dimensions: ${r.width}x${r.height}`,
        `- Split: ${r.split}`,
        `- Axis: ${r.axis}`,
        `- Notes: ${r.notes}`,
        "",
      ].join("\n"),
    );
  }
  return parts.join("\n");
}

async function main(): Promise<void> {
  const wanted = render();
  const check = process.argv.includes("--check");

  if (!check) {
    await fs.writeFile(OUT, wanted);
    console.log(`Wrote ${CURATED_IMAGES.length} entries to ${OUT}`);
    return;
  }

  let actual: string;
  try {
    actual = await fs.readFile(OUT, "utf8");
  } catch {
    console.error(`${OUT} is missing. Run \`mise run corpus:licenses\`.`);
    process.exit(1);
  }
  if (actual !== wanted) {
    console.error(
      `${OUT} does not match src/natural-images.ts. Run \`mise run corpus:licenses\`.`,
    );
    process.exit(1);
  }
  console.log(`${OUT} is up to date (${CURATED_IMAGES.length} entries).`);
}

await main();
