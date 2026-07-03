import { CURATED_IMAGES } from "./natural-images.ts";

/**
 * Which corpus split an image belongs to. Constants sweeps MUST tune on the
 * "tune" split only and validate on "holdout" — tuning on the full corpus is
 * train/test contamination (the format's constants were once swept on the same
 * images the report evaluates; this split exists so that never happens again).
 */
export type CorpusSplit = "tune" | "holdout";

/** Declared split of every curated natural image, keyed by label. */
const NATURAL_SPLITS = new Map<string, CorpusSplit>(
  CURATED_IMAGES.map((spec) => [spec.label, spec.split]),
);

/**
 * Resolve the corpus split for an image by its report name (the filename
 * without extension). Explicit rules:
 *
 * - `kodak*` (the Kodak True Color suite) is holdout by definition.
 * - Curated Picsum photos carry their declared split (natural-images.ts).
 * - Everything else — all synthetic fixtures and realistic images — is tune.
 */
export function splitFor(imageName: string): CorpusSplit {
  if (imageName.startsWith("kodak")) return "holdout";
  return NATURAL_SPLITS.get(imageName) ?? "tune";
}
