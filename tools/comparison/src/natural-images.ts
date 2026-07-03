import fs from "node:fs/promises";
import path from "node:path";
import type { CorpusSplit } from "./corpus.ts";

const NATURAL_DIR = path.resolve(import.meta.dirname, "../fixtures/natural");

export interface NaturalImageSpec {
  /** Stable Picsum photo ID. */
  id: number;
  /**
   * Label used as the filename stem (`<label>.jpg`). Its prefix drives
   * categorization: `natural-`/`chroma-` → Natural, `portrait-` → Portrait,
   * `night-` → Night (see report.ts `categorizeImage`).
   */
  label: string;
  /** Native width on Picsum (must satisfy width*height >= 12MP). */
  width: number;
  /** Native height on Picsum (must satisfy width*height >= 12MP). */
  height: number;
  /**
   * Corpus split: constants sweeps tune on "tune" images only and validate on
   * "holdout" (see corpus.ts). Never move an image from holdout to tune.
   */
  split: CorpusSplit;
}

/**
 * Curated set of diverse natural photographs from Picsum Photos (Unsplash).
 * Every image MUST have a native resolution of at least 12 megapixels.
 */
export const CURATED_IMAGES: NaturalImageSpec[] = [
  { id: 326, label: "natural-food", width: 4928, height: 3264, split: "tune" },
  { id: 350, label: "natural-coast", width: 5000, height: 3338, split: "tune" },
  {
    id: 392,
    label: "natural-bridge",
    width: 5000,
    height: 3333,
    split: "tune",
  },
  {
    id: 433,
    label: "natural-ocean-sunset",
    width: 4752,
    height: 3168,
    split: "tune",
  },
  { id: 434, label: "natural-river", width: 4928, height: 3264, split: "tune" },
  { id: 491, label: "natural-tools", width: 5000, height: 4061, split: "tune" },
  {
    id: 870,
    label: "natural-sunset",
    width: 2900,
    height: 4334,
    split: "tune",
  },
  {
    id: 964,
    label: "natural-mountains",
    width: 5000,
    height: 3490,
    split: "tune",
  },
  {
    id: 976,
    label: "natural-tulips",
    width: 5000,
    height: 2901,
    split: "tune",
  },
  { id: 1011, label: "natural-lake", width: 5000, height: 3333, split: "tune" },
  { id: 1025, label: "natural-pug", width: 4951, height: 3301, split: "tune" },
  {
    id: 1037,
    label: "natural-forest",
    width: 5000,
    height: 3333,
    split: "tune",
  },
  {
    id: 1043,
    label: "natural-autumn",
    width: 5000,
    height: 3333,
    split: "tune",
  },
  { id: 1067, label: "natural-city", width: 5000, height: 3333, split: "tune" },
  {
    id: 1074,
    label: "natural-building",
    width: 5000,
    height: 3333,
    split: "tune",
  },
  // Portrait / skin tone: people with visible faces or skin, across skin tones
  // and lighting conditions (a category the original corpus lacked entirely).
  {
    id: 64,
    label: "portrait-sunglasses",
    width: 4326,
    height: 2884,
    split: "tune",
  },
  {
    id: 823,
    label: "portrait-camera",
    width: 5000,
    height: 3333,
    split: "tune",
  },
  {
    id: 838,
    label: "portrait-mother-child",
    width: 5000,
    height: 3333,
    split: "holdout",
  },
  {
    id: 996,
    label: "portrait-backlit",
    width: 4272,
    height: 2848,
    split: "tune",
  },
  {
    id: 1027,
    label: "portrait-face",
    width: 2848,
    height: 4272,
    split: "holdout",
  },
  // Night / low light: dark scenes where shadow detail and point lights stress
  // the quantizer's dark end.
  {
    id: 903,
    label: "night-milky-way",
    width: 5000,
    height: 3333,
    split: "tune",
  },
  {
    id: 797,
    label: "night-city-rain",
    width: 5000,
    height: 3333,
    split: "tune",
  },
  {
    id: 901,
    label: "night-aurora",
    width: 4016,
    height: 4016,
    split: "holdout",
  },
  // High chroma: strongly saturated scenes that stress the chroma range
  // (categorized as Natural — they are ordinary photographs).
  {
    id: 1080,
    label: "chroma-strawberries",
    width: 5000,
    height: 3335,
    split: "tune",
  },
  {
    id: 855,
    label: "chroma-yellow-wall",
    width: 5000,
    height: 3333,
    split: "tune",
  },
  {
    id: 517,
    label: "chroma-orange-tree",
    width: 5000,
    height: 3333,
    split: "holdout",
  },
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
    const fileName = `${label}.jpg`;
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
