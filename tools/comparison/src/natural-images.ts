import fs from "node:fs/promises";
import path from "node:path";

const NATURAL_DIR = path.resolve(import.meta.dirname, "../fixtures/natural");

interface NaturalImageSpec {
  /** Stable Picsum photo ID. */
  id: number;
  /** Short descriptive label used in the filename. */
  label: string;
  /** Native width on Picsum (must satisfy width*height >= 12MP). */
  width: number;
  /** Native height on Picsum (must satisfy width*height >= 12MP). */
  height: number;
}

/**
 * Curated set of diverse natural photographs from Picsum Photos (Unsplash).
 * Every image MUST have a native resolution of at least 12 megapixels.
 */
const CURATED_IMAGES: NaturalImageSpec[] = [
  { id: 326, label: "food", width: 4928, height: 3264 },
  { id: 350, label: "coast", width: 5000, height: 3338 },
  { id: 392, label: "bridge", width: 5000, height: 3333 },
  { id: 433, label: "ocean-sunset", width: 4752, height: 3168 },
  { id: 434, label: "river", width: 4928, height: 3264 },
  { id: 491, label: "tools", width: 5000, height: 4061 },
  { id: 870, label: "sunset", width: 2900, height: 4334 },
  { id: 964, label: "mountains", width: 5000, height: 3490 },
  { id: 976, label: "tulips", width: 5000, height: 2901 },
  { id: 1011, label: "lake", width: 5000, height: 3333 },
  { id: 1025, label: "pug", width: 4951, height: 3301 },
  { id: 1037, label: "forest", width: 5000, height: 3333 },
  { id: 1043, label: "autumn", width: 5000, height: 3333 },
  { id: 1067, label: "city", width: 5000, height: 3333 },
  { id: 1074, label: "building", width: 5000, height: 3333 },
];

/**
 * Ensure natural images are downloaded and cached locally as JPEG at native resolution.
 * Skips images that are already cached. Returns paths of available images.
 * Gracefully handles network failures (returns whatever is cached).
 */
export async function ensureNaturalImages(): Promise<string[]> {
  await fs.mkdir(NATURAL_DIR, { recursive: true });

  const paths: string[] = [];
  let downloadCount = 0;

  for (const { id, label, width, height } of CURATED_IMAGES) {
    const fileName = `natural-${label}.jpg`;
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
      const url = `https://picsum.photos/id/${id}/${width}/${height}`;
      const response = await fetch(url, { redirect: "follow" });

      if (!response.ok) {
        console.warn(
          `  Skipping picsum/${id} (${label}): HTTP ${response.status}`,
        );
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Save as JPEG at native resolution to keep file sizes manageable
      await fs.writeFile(filePath, buffer);

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
