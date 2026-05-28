/**
 * Serial batch encoder (API parity with the parallel-language implementations).
 */

import { ChromaHash } from "./index.ts";
import type { Gamut } from "./internals.ts";

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
}

/**
 * Stateful batch encoder.
 *
 * Shares the API shape of the parallel-language implementations, but executes
 * serially: JavaScript is single-threaded, so the value here is API parity and
 * a single call site for bulk jobs. Output is identical to calling
 * {@link ChromaHash.encode} on each image individually.
 */
export class BatchEncoder {
  /**
   * Encode every item, returning hashes in the same order as `items`.
   *
   * All items are validated up front (throwing, identifying the offending
   * index) before any encoding, matching {@link ChromaHash.encode}.
   */
  encodeBatch(items: ImageInput[]): ChromaHash[] {
    for (const [i, it] of items.entries()) {
      if (it.w < 1) throw new Error(`item ${i}: width must be >= 1`);
      if (it.h < 1) throw new Error(`item ${i}: height must be >= 1`);
      if (it.rgba.length !== it.w * it.h * 4) {
        throw new Error(`item ${i}: rgba length mismatch`);
      }
    }
    return items.map((it) => ChromaHash.encode(it.w, it.h, it.rgba, it.gamut));
  }

  /** Release resources. A no-op for the serial implementation (no worker pool). */
  close(): void {
    // No pool to tear down; present for parity with the parallel languages.
  }
}
