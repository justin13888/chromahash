/**
 * ChromaHash: modern, high-quality image placeholder representation.
 *
 * This is the full encode + decode path, backed by the WebAssembly build of the
 * Rust core (`chromahash-wasm`). Output is byte-identical to every other
 * ChromaHash implementation.
 *
 * Because WebAssembly instantiation is asynchronous, **`init()` must be awaited
 * once before any encode/decode**:
 *
 * ```ts
 * import { init, ChromaHash } from "@visualcommons/chromahash";
 * await init();                                   // browser: fetches the co-located .wasm
 * const hash = ChromaHash.encode(w, h, rgba, "sRGB");
 * ```
 *
 * In Node (or any environment without `fetch` of `file://`), pass the `.wasm`
 * bytes: `await init(readFileSync(".../chromahash_wasm_bg.wasm"))`.
 *
 * Render-only consumers that want to skip the WASM init entirely can import the
 * pure-TypeScript decode path from `@visualcommons/chromahash/decode`.
 */

import { assertHash, isVersionSupported, readTier } from "./header.ts";
import initWasm, {
  ChromaHash as WasmHash,
  Gamut as WasmGamut,
  type InitInput,
} from "../wasm/chromahash_wasm.js";

/** Source color space. */
export type Gamut =
  | "sRGB"
  | "Display P3"
  | "Adobe RGB"
  | "BT.2020"
  | "ProPhoto RGB";

const GAMUT_TO_WASM: Record<Gamut, WasmGamut> = {
  sRGB: WasmGamut.Srgb,
  "Display P3": WasmGamut.DisplayP3,
  "Adobe RGB": WasmGamut.AdobeRgb,
  "BT.2020": WasmGamut.Bt2020,
  "ProPhoto RGB": WasmGamut.ProPhotoRgb,
};

let ready = false;

/**
 * Load and instantiate the ChromaHash WebAssembly module. Idempotent — safe to
 * await multiple times. Must complete before the first encode/decode.
 *
 * @param input - Optional `.wasm` source (path, `Response`, or bytes). Omit in
 *   browsers to fetch the co-located module; pass bytes in Node.
 */
export async function init(
  input?: InitInput | Promise<InitInput>,
): Promise<void> {
  if (ready) return;
  // Omit the arg entirely in browsers (fetch the co-located .wasm); pass the
  // single-object form when given an explicit source (avoids the legacy
  // positional-arg deprecation warning).
  await (input === undefined
    ? initWasm()
    : initWasm({ module_or_path: input }));
  ready = true;
}

/** Whether {@link init} has completed. */
export function isInitialized(): boolean {
  return ready;
}

function ensureReady(): void {
  if (!ready) {
    throw new Error(
      "ChromaHash WASM is not initialized — call `await init()` before encoding or decoding.",
    );
  }
}

export class ChromaHash {
  readonly hash: Uint8Array;

  private constructor(hash: Uint8Array) {
    this.hash = hash;
  }

  /**
   * Encode an image into a ChromaHash.
   *
   * @param w - Image width (>= 1)
   * @param h - Image height (>= 1)
   * @param rgba - Pixel data in RGBA format (4 bytes per pixel)
   * @param gamut - Source color space
   */
  static encode(
    w: number,
    h: number,
    rgba: Uint8Array,
    gamut: Gamut,
  ): ChromaHash {
    ensureReady();
    const handle = WasmHash.encode(w, h, rgba, GAMUT_TO_WASM[gamut]);
    try {
      return new ChromaHash(handle.asBytes());
    } finally {
      handle.free();
    }
  }

  /**
   * Encode an image at an explicit quality tier (`0..=`{@link MAX_TIER},
   * ordered by quality).
   *
   * {@link DEFAULT_TIER} is the 32-byte tier {@link encode} produces and
   * {@link COMPACT_TIER} the 21-byte one. Pass those rather than a literal: the
   * codes are ordered by quality, so a bare `0` selects the compact tier.
   *
   * @param w - Image width (>= 1)
   * @param h - Image height (>= 1)
   * @param rgba - Pixel data in RGBA format (4 bytes per pixel)
   * @param gamut - Source color space
   * @param quality - Tier code (`0..=`{@link MAX_TIER})
   */
  static encodeWithQuality(
    w: number,
    h: number,
    rgba: Uint8Array,
    gamut: Gamut,
    quality: number,
  ): ChromaHash {
    ensureReady();
    const handle = WasmHash.encodeWithQuality(
      w,
      h,
      rgba,
      GAMUT_TO_WASM[gamut],
      quality,
    );
    try {
      return new ChromaHash(handle.asBytes());
    } finally {
      handle.free();
    }
  }

  /**
   * Decode a ChromaHash into an sRGB RGBA image.
   * Returns the decoded width, height, and RGBA pixel data.
   */
  decode(): { w: number; h: number; rgba: Uint8Array } {
    return this.decodeTo("sRGB");
  }

  /**
   * Decode a ChromaHash into an RGBA image in the given output gamut
   * (`sRGB`, `Display P3`, or `Adobe RGB` — others fall back to sRGB).
   * Wide-gamut colors render at full saturation on a matching display.
   */
  decodeTo(output: Gamut): { w: number; h: number; rgba: Uint8Array } {
    ensureReady();
    const handle = WasmHash.fromBytes(this.hash);
    try {
      const r = handle.decodeTo(GAMUT_TO_WASM[output]);
      try {
        return { w: r.width, h: r.height, rgba: r.rgba };
      } finally {
        r.free();
      }
    } finally {
      handle.free();
    }
  }

  /**
   * Decode a ChromaHash into an sRGB RGBA image, capped at the given max
   * dimensions. Useful when the natural decoded size would exceed the source.
   */
  decodeCapped(
    maxWidth: number,
    maxHeight: number,
  ): { w: number; h: number; rgba: Uint8Array } {
    return this.decodeCappedTo(maxWidth, maxHeight, "sRGB");
  }

  /** Capped decode (see {@link decodeCapped}) in the given output gamut. */
  decodeCappedTo(
    maxWidth: number,
    maxHeight: number,
    output: Gamut,
  ): { w: number; h: number; rgba: Uint8Array } {
    ensureReady();
    const handle = WasmHash.fromBytes(this.hash);
    try {
      const r = handle.decodeCappedTo(
        maxWidth,
        maxHeight,
        GAMUT_TO_WASM[output],
      );
      try {
        return { w: r.width, h: r.height, rgba: r.rgba };
      } finally {
        r.free();
      }
    } finally {
      handle.free();
    }
  }

  /**
   * Extract the average color without full decode.
   * Returns RGBA values as 0-255 integers.
   */
  averageColor(): { r: number; g: number; b: number; a: number } {
    ensureReady();
    const handle = WasmHash.fromBytes(this.hash);
    try {
      const c = handle.averageColor();
      return {
        r: c[0] ?? 0,
        g: c[1] ?? 0,
        b: c[2] ?? 0,
        a: c[3] ?? 0,
      };
    } finally {
      handle.free();
    }
  }

  /**
   * Whether this hash's wire-format generation is the one this library
   * implements. Byte 0 carries an explicit 3-bit `version` field, so this is a
   * real check and {@link fromBytes} rejects rather than producing garbage.
   */
  isVersionSupported(): boolean {
    return isVersionSupported(this.hash);
  }

  /** The tier code this hash was encoded at (`0..=`{@link MAX_TIER}). */
  get tier(): number {
    return readTier(this.hash);
  }

  /**
   * Create a ChromaHash from raw bytes.
   *
   * The hash is variable length and self-describing, so this validates the
   * descriptor and the exact byte length (spec §2.6) and throws on anything
   * malformed — a hash that constructs is guaranteed to decode.
   */
  static fromBytes(bytes: Uint8Array): ChromaHash {
    assertHash(bytes);
    return new ChromaHash(new Uint8Array(bytes));
  }
}

export {
  COMPACT_TIER,
  DEFAULT_TIER,
  MAX_TIER,
} from "./header.ts";
export { BatchEncoder } from "./batch.ts";
export type { ImageInput } from "./batch.ts";
