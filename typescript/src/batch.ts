/**
 * Serial batch encoder (API parity with the parallel-language implementations).
 */

import { DEFAULT_TIER, MAX_TIER } from "./header.ts";
import { ChromaHash } from "./index.ts";
import type { Gamut } from "./index.ts";

/** One image to encode in a batch. */
export interface ImageInput {
  /** Image width (>= 1). */
  w: number;
  /** Image height (>= 1). */
  h: number;
  /** Pixel data in RGBA format (4 bytes per pixel, length === w * h * 4). */
  rgba: Uint8Array;
  /** Source color space. */
  gamut: Gamut;
  /**
   * Quality tier (`0..=`{@link MAX_TIER}, ordered by quality). Defaults to
   * {@link DEFAULT_TIER} — the codes start at 0 for the *compact* tier, so an
   * explicit `0` is the 21-byte hash, not the 32-byte one.
   */
  quality?: number;
}

/**
 * Stateful batch encoder.
 *
 * Shares the API shape of the parallel-language implementations, but executes
 * serially: WebAssembly cannot use the core's worker pool without
 * `SharedArrayBuffer` + COOP/COEP, so the value here is API parity and a single
 * call site for bulk jobs. Output is identical to calling
 * {@link ChromaHash.encodeWithQuality} on each image individually at its tier.
 *
 * Like {@link ChromaHash.encode}, this requires the WASM module to be ready —
 * `await init()` once before encoding.
 */
export class BatchEncoder {
  /**
   * Encode every item, returning hashes in the same order as `items`.
   *
   * All items are validated up front (throwing, identifying the offending
   * index) before any encoding, matching
   * {@link ChromaHash.encodeWithQuality}.
   */
  encodeBatch(items: ImageInput[]): ChromaHash[] {
    for (const [i, it] of items.entries()) {
      if (it.w < 1) throw new Error(`item ${i}: width must be >= 1`);
      if (it.h < 1) throw new Error(`item ${i}: height must be >= 1`);
      if (it.rgba.length !== it.w * it.h * 4) {
        throw new Error(`item ${i}: rgba length mismatch`);
      }
      const quality = it.quality ?? DEFAULT_TIER;
      if (!Number.isInteger(quality) || quality < 0 || quality > MAX_TIER) {
        throw new Error(`item ${i}: quality tier must be 0..=${MAX_TIER}`);
      }
    }
    return items.map((it) =>
      ChromaHash.encodeWithQuality(
        it.w,
        it.h,
        it.rgba,
        it.gamut,
        it.quality ?? DEFAULT_TIER,
      ),
    );
  }

  /** Release resources. A no-op for the serial implementation (no worker pool). */
  close(): void {
    // No pool to tear down; present for parity with the parallel languages.
  }
}
