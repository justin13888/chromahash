import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  BatchEncoder,
  ChromaHash,
  COMPACT_TIER,
  DEFAULT_TIER,
  init,
  MAX_TIER,
} from "./index.ts";
import type { Gamut, ImageInput } from "./index.ts";

const wasmPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../wasm/chromahash_wasm_bg.wasm",
);
await init(readFileSync(wasmPath));

function solidImage(
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a: number,
): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = a;
  }
  return rgba;
}

function horizontalGradient(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x / Math.max(w - 1, 1);
      const idx = (y * w + x) * 4;
      rgba[idx] = Math.trunc(t * 255);
      rgba[idx + 1] = Math.trunc((1.0 - t) * 255);
      rgba[idx + 2] = 128;
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

/**
 * A spread of dimensions, gamuts, and alpha, mirroring the bulk-migration use
 * case. It also spans every tier, so a batch path that ignored `quality` would
 * fail.
 */
function mixedItems(): ImageInput[] {
  return [
    {
      w: 4,
      h: 4,
      rgba: solidImage(4, 4, 200, 100, 50, 255),
      gamut: "sRGB",
      quality: COMPACT_TIER,
    },
    {
      w: 8,
      h: 4,
      rgba: horizontalGradient(8, 4),
      gamut: "Display P3",
      quality: DEFAULT_TIER,
    },
    {
      w: 4,
      h: 8,
      rgba: solidImage(4, 8, 30, 200, 120, 128),
      gamut: "Adobe RGB",
      quality: 2,
    },
    {
      w: 16,
      h: 16,
      rgba: horizontalGradient(16, 16),
      gamut: "BT.2020",
      quality: 3,
    },
    {
      w: 1,
      h: 1,
      rgba: solidImage(1, 1, 255, 0, 0, 255),
      gamut: "ProPhoto RGB",
      quality: MAX_TIER,
    },
  ];
}

function encodeSerial(items: ImageInput[]): ChromaHash[] {
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

describe("BatchEncoder", () => {
  it("matches per-image encode", () => {
    const items = mixedItems();
    const batch = new BatchEncoder().encodeBatch(items);
    const serial = encodeSerial(items);
    assert.equal(batch.length, serial.length);
    for (let i = 0; i < items.length; i++) {
      assert.deepEqual(batch[i]?.hash, serial[i]?.hash);
    }
  });

  it("preserves input order", () => {
    const items: ImageInput[] = [];
    for (let i = 0; i < 64; i++) {
      items.push({
        w: 8,
        h: 8,
        rgba: solidImage(8, 8, i, 255 - i, (i * 3) % 256, 255),
        gamut: "sRGB" as Gamut,
      });
    }
    const batch = new BatchEncoder().encodeBatch(items);
    const serial = encodeSerial(items);
    for (let i = 0; i < items.length; i++) {
      assert.deepEqual(batch[i]?.hash, serial[i]?.hash);
    }
  });

  it("returns empty for an empty batch", () => {
    assert.deepEqual(new BatchEncoder().encodeBatch([]), []);
  });

  it("is reusable across batches", () => {
    const enc = new BatchEncoder();
    const items = mixedItems();
    const first = enc.encodeBatch(items);
    const second = enc.encodeBatch(items);
    for (let i = 0; i < items.length; i++) {
      assert.deepEqual(first[i]?.hash, second[i]?.hash);
    }
    enc.close();
  });

  it("throws identifying the invalid item", () => {
    const items: ImageInput[] = [
      { w: 2, h: 2, rgba: solidImage(2, 2, 0, 0, 0, 255), gamut: "sRGB" },
      { w: 2, h: 2, rgba: new Uint8Array(3), gamut: "sRGB" },
    ];
    assert.throws(() => new BatchEncoder().encodeBatch(items), /item 1/);
  });

  // Pins the tier down to the byte count. Comparing batch against serial alone
  // would pass if both silently used one tier.
  it("honors each item's quality tier", () => {
    const rgba = solidImage(8, 8, 200, 100, 50, 255);
    const items: ImageInput[] = [];
    for (let tier = COMPACT_TIER; tier <= MAX_TIER; tier++) {
      items.push({ w: 8, h: 8, rgba, gamut: "sRGB", quality: tier });
    }
    const batch = new BatchEncoder().encodeBatch(items);
    assert.deepEqual(
      batch.map((h) => h.hash.length),
      [21, 32, 108, 411, 1623],
    );
  });

  // The codes are ordered by quality, so an omitted tier defaulting to 0 would
  // silently produce the 21-byte compact hash.
  it("defaults an omitted tier to the default tier", () => {
    const rgba = solidImage(8, 8, 200, 100, 50, 255);
    const [batched] = new BatchEncoder().encodeBatch([
      { w: 8, h: 8, rgba, gamut: "sRGB" },
    ]);
    assert.deepEqual(batched?.hash, ChromaHash.encode(8, 8, rgba, "sRGB").hash);
  });

  it("throws identifying an item with a reserved tier code", () => {
    const rgba = solidImage(2, 2, 0, 0, 0, 255);
    const items: ImageInput[] = [
      { w: 2, h: 2, rgba, gamut: "sRGB" },
      { w: 2, h: 2, rgba, gamut: "sRGB", quality: MAX_TIER + 1 },
    ];
    assert.throws(() => new BatchEncoder().encodeBatch(items), /item 1/);
  });
});
