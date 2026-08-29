/**
 * Fixtures and the lever matrix.
 *
 * Every knob that moves bytes, quality or time gets an axis here. The bounded
 * default holds one axis free at a time against a fixed centre (tier 1,
 * 100x100, gradient); the exhaustive mode takes the cross product.
 */

/** Content classes, chosen for what they do to the AC spectrum. */
export type Content = "gradient" | "noise" | "solid";

export interface Fixture {
  readonly w: number;
  readonly h: number;
  readonly content: Content;
  readonly rgba: Buffer;
}

/**
 * Deterministic fixtures, generated rather than loaded so a perf run needs no
 * corpus on disk and cannot drift with it.
 *
 * - `gradient` is the historical fixture, and its spectrum is nearly empty
 *   above DC — the easy case for coefficient selection.
 * - `noise` fills the selected band, so the quantizer's neighbourhood searches
 *   actually run rather than short-circuiting on zeros.
 * - `solid` has exactly zero AC energy and trips the `scale < 1e-10` floor,
 *   which is the cheapest path through the encoder.
 */
export function makeFixture(w: number, h: number, content: Content): Fixture {
  const rgba = Buffer.alloc(w * h * 4);
  // A small LCG, so `noise` is reproducible without a dependency.
  let s = 0x9e3779b9;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s >>> 24;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (content === "solid") {
        rgba[i] = 180;
        rgba[i + 1] = 90;
        rgba[i + 2] = 60;
      } else if (content === "noise") {
        rgba[i] = next();
        rgba[i + 1] = next();
        rgba[i + 2] = next();
      } else {
        rgba[i] = w > 1 ? Math.floor((x * 255) / (w - 1)) : 0;
        rgba[i + 1] = h > 1 ? Math.floor((y * 255) / (h - 1)) : 0;
        rgba[i + 2] = 128;
      }
      rgba[i + 3] = 255;
    }
  }
  return { w, h, content, rgba };
}

export const ALL_TIERS = [0, 1, 2, 3, 4] as const;
/** Encoded length per tier code, no alpha (spec 3.5). */
export const TIER_BYTES: Readonly<Record<number, number>> = {
  0: 21,
  1: 32,
  2: 108,
  3: 411,
  4: 1623,
};

/** Source sizes for the encode-scaling axis. Encode is O(K*W*H) on the full source. */
export const BOUNDED_SIZES = [64, 100, 256, 512] as const;
export const FULL_SIZES = [64, 100, 256, 512, 1024] as const;

/** Cross-language tiers. Tier 4 decode costs ~250 ms, so bounded stops at 2. */
export const BOUNDED_CROSS_TIERS = [0, 1, 2] as const;

/**
 * Encoder-only levers: zero wire cost, decoder untouched, bytes unchanged.
 * Rust-only, because no binding exposes `Tunables`.
 */
export const TUNE_ARMS: ReadonlyArray<{ label: string; tune: string | null }> =
  [
    { label: "shipped", tune: null },
    { label: "scale_fit=0", tune: "scale_fit=0" },
    { label: "scale_fit=1", tune: "scale_fit=1" },
    { label: "ac_nearest=0", tune: "ac_nearest=0" },
    { label: "dc_search=0", tune: "dc_search=0" },
    {
      label: "no encoder search",
      tune: "scale_fit=0 ac_nearest=0 dc_search=0",
    },
    { label: "refine_passes=1", tune: "refine_passes=1" },
  ];

/** Batch thread counts for the scaling sweep. */
export const BOUNDED_THREADS = [1, 0] as const;
export const FULL_THREADS = [1, 2, 4, 8, 0] as const;
