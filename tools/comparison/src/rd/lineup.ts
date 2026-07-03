import { BlurHashAdapter } from "../adapters/blurhash.ts";
import { ChromaHashAdapter } from "../adapters/chromahash.ts";
import {
  CodecThumbAdapter,
  isJxlAvailable,
  type ThumbCodec,
} from "../adapters/codec-thumb.ts";
import { LqipModernAdapter } from "../adapters/lqip-modern.ts";
import { RawPixelsAdapter } from "../adapters/raw-pixels.ts";
import { ThumbHashAdapter } from "../adapters/thumbhash.ts";
import { UnpicAdapter } from "../adapters/unpic.ts";
import type { FormatAdapter } from "../types.ts";

/**
 * Canonical equal-byte anchors for the R-D comparison: the four ChromaHash
 * quality-tier sizes (tiers 0..=3, no-alpha) in bytes. Codec baselines target
 * these budgets so every family is judged at the same byte cost.
 */
export const RD_ANCHORS: readonly number[] = [32, 108, 411, 1623];

/**
 * Grace factor for the equal-budget anchor table: a family's variant counts as
 * "within budget" at an anchor when its mean bytes <= anchor × this. Sweeps hit
 * budgets approximately (BlurHash component sizes are quantized, codec searches
 * land just under target), so a hard cutoff would punish rounding, not quality.
 */
export const RD_ANCHOR_GRACE = 1.1;

/** One swept variant: the adapter plus the curve family it belongs to. */
export interface RdVariant {
  /** Format family the variant's point aggregates into (one curve each). */
  family: string;
  adapter: FormatAdapter;
}

/** ChromaHash quality tiers swept (the whole point of the comparison). */
const CHROMAHASH_TIERS: readonly number[] = [0, 1, 2, 3];

/** BlurHash component sweeps (NxN); 4x4 is the standard-report default. */
const BLURHASH_COMPONENTS: readonly number[] = [1, 2, 3, 4, 6, 8];

/** lqip-modern max-dimension sweeps (WebP output); 16 is the library default. */
const LQIP_MODERN_RESIZES: readonly number[] = [12, 16, 24, 32, 48];

/** Codec baselines targeted at every anchor (JXL only when cjxl/djxl exist). */
const BASELINE_CODECS: readonly ThumbCodec[] = ["webp", "jpeg", "avif", "jxl"];

/**
 * Build the full R-D variant lineup. Families, in curve/legend order: the LQIP
 * formats swept across their quality knobs, then the equal-byte codec baselines
 * and the raw-pixel control at each anchor.
 */
export function buildRdLineup(): RdVariant[] {
  const variants: RdVariant[] = [];

  for (const tier of CHROMAHASH_TIERS) {
    variants.push({
      family: "ChromaHash",
      adapter: new ChromaHashAdapter({
        name: `ChromaHash t${tier}`,
        tier,
        capToSource: true,
      }),
    });
  }
  variants.push({ family: "ThumbHash", adapter: new ThumbHashAdapter() });
  for (const c of BLURHASH_COMPONENTS) {
    variants.push({
      family: "BlurHash",
      adapter: new BlurHashAdapter({
        name: `BlurHash ${c}x${c}`,
        componentsX: c,
        componentsY: c,
      }),
    });
  }
  for (const resize of LQIP_MODERN_RESIZES) {
    variants.push({
      family: "lqip-modern",
      adapter: new LqipModernAdapter({
        name: `lqip-modern r${resize}`,
        resize,
        outputFormat: "webp",
      }),
    });
  }
  variants.push({ family: "unpic", adapter: new UnpicAdapter() });

  const jxl = isJxlAvailable();
  if (!jxl) {
    console.warn(
      "JXL baseline skipped: cjxl/djxl not found on PATH (install libjxl tools to include it).",
    );
  }
  for (const codec of BASELINE_CODECS) {
    if (codec === "jxl" && !jxl) continue;
    for (const anchor of RD_ANCHORS) {
      variants.push({
        family: codecFamily(codec),
        adapter: new CodecThumbAdapter(codec, anchor),
      });
    }
  }
  for (const anchor of RD_ANCHORS) {
    variants.push({
      family: "RawRGB565",
      adapter: new RawPixelsAdapter(anchor),
    });
  }

  return variants;
}

/** Curve family name for a codec baseline (matches the adapter name prefix). */
function codecFamily(codec: ThumbCodec): string {
  switch (codec) {
    case "webp":
      return "WebP";
    case "avif":
      return "AVIF";
    case "jpeg":
      return "JPEG";
    case "jxl":
      return "JXL";
  }
}
