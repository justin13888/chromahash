/**
 * Layout fidelity: how far a format's declared shape is from the shape it was
 * handed, and what that costs a page that reserves layout from it.
 *
 * ## Why this exists
 *
 * `spec/EXPERIMENTS.md` §7.5 records the gap plainly: "`upscaleRgba` resizes
 * every decode to the reference dimensions with `fit: "fill"`, so **the
 * evaluation cannot see aspect error at all** — it stretches the wrong-shaped
 * decode back into the right frame." Every quality metric in this harness is
 * computed after that stretch, so the format's "precise layout" claim (§8.1)
 * was the one claim the harness that measures everything else could not see.
 * §7.14's U19 names it as the most valuable unmeasured item.
 *
 * ## What it compares against
 *
 * The **original image**, because that is the shape that eventually loads and
 * therefore the shape the layout shift is measured against. A page reserves
 * space from the placeholder and then has to live with the real photograph.
 *
 * That choice does fold in a small contribution this harness makes itself.
 * Every adapter encodes from `ImageInput.smallRgba` at `smallWidth ×
 * smallHeight` (≤100px long edge), and that downscale rounds to integers:
 * `natural-autumn` is 5000×3333 but reaches the encoder as 100×67, already
 * 0.51% off. No format is responsible for that, and a production pipeline
 * hands its encoder the original's dimensions, so the stage is an artifact of
 * how this harness is wired.
 *
 * Rather than quietly score against the encoder input — which would measure the
 * formats fairly but stop being the layout-shift number anyone actually cares
 * about — {@link encoderInputFloor} reports that contribution as its own row, so
 * a reader can see how much of every figure below is the harness rather than
 * the format.
 *
 * ## What it does not distinguish
 *
 * For ChromaHash this measures the **render grid**, which is coarser than the
 * transmitted aspect field, and the difference is not small. See
 * `describeChromaHashRasterCaveat` below, which is rendered into the report.
 */

import type { AspectFidelity, IntrinsicSize } from "./types.ts";

/**
 * Container width the reflow figure is quoted for. 1000 px is a plain
 * full-width content column, so the number reads as "this many pixels of the
 * page jump when the real image arrives".
 */
export const REFLOW_CONTAINER_PX = 1000;

/**
 * Score one format's declared size against the shape it was handed.
 *
 * Returns null when the format declares no size, or when either shape is
 * degenerate — never a zero, which would read as a perfect score.
 */
export function aspectFidelity(
  intrinsic: IntrinsicSize,
  targetWidth: number,
  targetHeight: number,
): AspectFidelity | null {
  if (intrinsic.kind === "absent") return null;
  const { width, height } = intrinsic;
  if (!(width > 0) || !(height > 0)) return null;
  if (!(targetWidth > 0) || !(targetHeight > 0)) return null;

  const arDeclared = width / height;
  const arTarget = targetWidth / targetHeight;
  const log2Error = Math.abs(Math.log2(arDeclared / arTarget));
  const errorPct = (2 ** log2Error - 1) * 100;
  // Height a consumer reserves from the declared shape, minus the height the
  // real image needs, both at the same container width.
  const reflowPx = REFLOW_CONTAINER_PX * (1 / arTarget - 1 / arDeclared);

  return { log2Error, errorPct, reflowPx };
}

/**
 * This harness's own contribution to every aspect error below: how far the
 * ≤100px encoder input's shape already is from the original's, before any
 * format sees it. Rendered as a reference row so the formats' figures can be
 * read net of it.
 */
export function encoderInputFloor(
  inputWidth: number,
  inputHeight: number,
  originalWidth: number,
  originalHeight: number,
): AspectFidelity | null {
  return aspectFidelity(
    { kind: "declared", width: inputWidth, height: inputHeight },
    originalWidth,
    originalHeight,
  );
}

/**
 * Aggregate `log2Error` and convert once at the end.
 *
 * Averaging percentages would double-count the ratio form's asymmetry that
 * `log2Error` exists to remove — the mean of two errors that are equal and
 * opposite in octaves is not zero in percent.
 */
export function meanErrorPct(log2Errors: number[]): number | null {
  if (log2Errors.length === 0) return null;
  const mean = log2Errors.reduce((a, b) => a + b, 0) / log2Errors.length;
  return (2 ** mean - 1) * 100;
}

/** Convert one aggregated octave figure to the report's percent convention. */
export function log2ToPct(log2Error: number): number {
  return (2 ** log2Error - 1) * 100;
}

/**
 * The disclosure the report must carry beside any ChromaHash aspect number.
 *
 * Kept here, beside the computation, so the caveat cannot drift away from the
 * thing it describes.
 */
export const CHROMAHASH_RASTER_CAVEAT =
  "For ChromaHash this measures the render grid, not the aspect byte. The byte " +
  "quantizes log₂(ratio) to within ±1.09% (spec §8.1), but the base grid rounds " +
  "to integers at a 32px long edge — 32 × round(32 / ratio) — and that rounding, " +
  "not the field, dominates: a 3:2 source decodes to 32×21 = 1.5238, which is " +
  "1.59% off. §8.2 defines the higher tiers as a bit shift of the already-rounded " +
  "base size, so every tier reports the same aspect error. A consumer that " +
  "reserves layout from the decoded ratio gets the 1.09% figure; one that reserves " +
  "it from the decoded raster — which is what an <img> receives — gets this one.";
