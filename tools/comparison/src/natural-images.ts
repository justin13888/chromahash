import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const NATURAL_DIR = path.resolve(import.meta.dirname, "../fixtures/natural");

interface NaturalImageSpec {
  /** Stable Picsum photo ID. */
  id: number;
  /** Short descriptive label used in the filename. */
  label: string;
}

/** Curated set of diverse natural photographs from Picsum Photos (Unsplash). */
const CURATED_IMAGES: NaturalImageSpec[] = [
  { id: 10, label: "forest" },
  { id: 29, label: "mountains" },
  { id: 100, label: "coast" },
  { id: 180, label: "tomatoes" },
  { id: 237, label: "dog" },
  { id: 312, label: "waterfall" },
  { id: 429, label: "bread" },
  { id: 433, label: "ocean-sunset" },
  { id: 582, label: "flowers" },
  { id: 651, label: "bicycle" },
  { id: 870, label: "sunset" },
  { id: 1011, label: "lake" },
  { id: 1025, label: "pug" },
  { id: 1043, label: "autumn" },
  { id: 1074, label: "building" },
];

/** Download resolution — the comparison pipeline downscales to <=100x100 anyway. */
const DOWNLOAD_WIDTH = 400;
const DOWNLOAD_HEIGHT = 300;

/**
 * Ensure natural images are downloaded and cached locally as PNG.
 * Skips images that are already cached. Returns paths of available images.
 * Gracefully handles network failures (returns whatever is cached).
 */
export async function ensureNaturalImages(): Promise<string[]> {
  await fs.mkdir(NATURAL_DIR, { recursive: true });

  const paths: string[] = [];
  let downloadCount = 0;

  for (const { id, label } of CURATED_IMAGES) {
    const fileName = `natural-${label}.png`;
    const filePath = path.join(NATURAL_DIR, fileName);

    // Use cached version if available
    try {
      await fs.access(filePath);
      paths.push(filePath);
      continue;
    } catch {
      // Not cached — download below
    }

    try {
      const url = `https://picsum.photos/id/${id}/${DOWNLOAD_WIDTH}/${DOWNLOAD_HEIGHT}`;
      const response = await fetch(url, { redirect: "follow" });

      if (!response.ok) {
        console.warn(
          `  Skipping picsum/${id} (${label}): HTTP ${response.status}`,
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Convert JPEG to PNG for consistency with the comparison pipeline
      await sharp(buffer).png().toFile(filePath);

      downloadCount++;
      paths.push(filePath);
    } catch (err) {
      console.warn(
        `  Skipping picsum/${id} (${label}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  if (downloadCount > 0) {
    console.log(
      `Downloaded ${downloadCount} natural image(s) to ${NATURAL_DIR}`,
    );
  }

  return paths;
}
