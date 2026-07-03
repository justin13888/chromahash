import fs from "node:fs/promises";
import path from "node:path";

const HOLDOUT_DIR = path.resolve(import.meta.dirname, "../fixtures/holdout");

/** Number of images in the Kodak True Color suite (kodim01 … kodim24). */
const KODAK_COUNT = 24;

/**
 * Ensure the holdout images are downloaded and cached locally. The set is the
 * Kodak True Color suite: 24 uncompressed 768x512 / 512x768 photographs, free
 * for unrestricted use and hosted at the same URL since 1999 — a stable,
 * well-known corpus no LQIP format's constants were tuned on. (CLIC datasets
 * were considered as an additional holdout source, but their hosting URLs are
 * unstable.) Labels are `kodak01` … `kodak24`; corpus.ts maps every `kodak*`
 * image to the "holdout" split, so sweeps never tune on them.
 *
 * Skips images that are already cached. Returns paths of available images.
 * Gracefully handles network failures (returns whatever is cached).
 */
export async function ensureHoldoutImages(): Promise<string[]> {
  await fs.mkdir(HOLDOUT_DIR, { recursive: true });

  const paths: string[] = [];
  let downloadCount = 0;

  for (let i = 1; i <= KODAK_COUNT; i++) {
    const num = String(i).padStart(2, "0");
    const fileName = `kodak${num}.png`;
    const filePath = path.join(HOLDOUT_DIR, fileName);

    // Use cached version if available
    try {
      await fs.access(filePath);
      paths.push(filePath);
      continue;
    } catch {
      // Not cached — download below
    }

    try {
      const url = `http://r0k.us/graphics/kodak/kodak/kodim${num}.png`;
      const response = await fetch(url, { redirect: "follow" });

      if (!response.ok) {
        console.warn(`  Skipping kodak${num}: HTTP ${response.status}`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(filePath, buffer);

      downloadCount++;
      paths.push(filePath);
    } catch (err) {
      console.warn(
        `  Skipping kodak${num}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  if (downloadCount > 0) {
    console.log(
      `Downloaded ${downloadCount} holdout image(s) to ${HOLDOUT_DIR}`,
    );
  }

  return paths;
}
