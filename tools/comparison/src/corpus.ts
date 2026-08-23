import { ALPHA_IMAGES } from "./alpha-images.ts";
import { GRAPHIC_IMAGES } from "./graphic-images.ts";
import { CURATED_IMAGES } from "./natural-images.ts";

/**
 * Which corpus split an image belongs to. Constants sweeps MUST tune on the
 * "tune" split only and validate on "holdout" — tuning on the full corpus is
 * train/test contamination (the format's constants were once swept on the same
 * images the report evaluates; this split exists so that never happens again).
 */
export type CorpusSplit = "tune" | "holdout";

/** Declared split of every curated image, keyed by label. */
const DECLARED_SPLITS = new Map<string, CorpusSplit>([
  ...CURATED_IMAGES.map((s): [string, CorpusSplit] => [s.label, s.split]),
  ...ALPHA_IMAGES.map((s): [string, CorpusSplit] => [s.label, s.split]),
  ...GRAPHIC_IMAGES.map((s): [string, CorpusSplit] => [s.label, s.split]),
]);

/**
 * Resolve the corpus split for an image by its report name (the filename
 * without extension). Explicit rules:
 *
 * - `kodak*` (the Kodak True Color suite) is holdout by definition.
 * - Every curated image — photo, alpha or graphic — carries its declared split.
 * - Everything else — all synthetic fixtures and realistic images — is tune.
 */
export function splitFor(imageName: string): CorpusSplit {
  if (imageName.startsWith("kodak")) return "holdout";
  return DECLARED_SPLITS.get(imageName) ?? "tune";
}

/**
 * Which body of content a sweep is measured against.
 *
 * The format's constants have only ever been chosen against photographs, and
 * for most questions that is the right corpus — but not for all of them. The
 * alpha-mode layout cannot be measured on a corpus with no transparency in it,
 * and a layout tuned on photographs has never been checked against the
 * screenshots, charts and logos a real placeholder pipeline also ingests.
 *
 * Membership is keyed off the filename prefix, so adding fixtures under a new
 * prefix cannot silently move the mean of an existing sweep — which is the
 * failure mode the content pins exist to prevent (`EXPERIMENTS.md` §7.14).
 */
export type CorpusSet = "photo" | "alpha" | "graphic" | "all";

/**
 * Filename prefixes belonging to each corpus. `alpha` deliberately excludes the
 * generated `alpha-*` synthetic fixtures: those are 8x8 correctness cases for
 * the alpha *path*, not content anything should be tuned against.
 */
const CORPUS_PREFIXES: Record<Exclude<CorpusSet, "all">, readonly string[]> = {
  photo: ["natural-", "portrait-", "night-", "chroma-", "kodak"],
  alpha: ["cutout-"],
  graphic: ["graphic-"],
};

/** Does an image (by report name, i.e. filename without extension) belong to `set`? */
export function inCorpus(imageName: string, set: CorpusSet): boolean {
  if (set === "all") return true;
  return CORPUS_PREFIXES[set].some((p) => imageName.startsWith(p));
}

/** Parse a corpus name, throwing on anything unrecognized rather than defaulting. */
export function parseCorpusSet(value: string): CorpusSet {
  if (
    value === "photo" ||
    value === "alpha" ||
    value === "graphic" ||
    value === "all"
  ) {
    return value;
  }
  throw new Error(
    `unknown corpus "${value}" (expected photo, alpha, graphic or all)`,
  );
}
