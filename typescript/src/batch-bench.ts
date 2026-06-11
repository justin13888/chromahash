/**
 * Throughput benchmark: serial per-image encode vs. BatchEncoder.
 *
 * Zero dependencies — uses only node:perf_hooks. Run with:
 *
 *   pnpm run bench
 *
 * The TypeScript BatchEncoder is serial (JavaScript is single-threaded), so the
 * batch and serial figures are expected to match (~1.0x). This harness reports
 * that honestly and mirrors the other languages' benchmarks.
 */

import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { BatchEncoder, ChromaHash, init } from "./index.ts";
import type { Gamut, ImageInput } from "./index.ts";

// Node has no `fetch` of `file://`, so feed the WASM module its bytes directly.
const wasmPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../wasm/chromahash_wasm_bg.wasm",
);
await init(readFileSync(wasmPath));

const N = 500;
const GAMUTS: Gamut[] = [
  "sRGB",
  "Display P3",
  "Adobe RGB",
  "BT.2020",
  "ProPhoto RGB",
];

function makeImage(seed: number): ImageInput {
  const w = 24 + (seed % 40);
  const h = 24 + ((seed * 7) % 40);
  const rgba = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    rgba[p * 4] = (p * 3 + seed) % 256;
    rgba[p * 4 + 1] = (p * 5 + seed * 2) % 256;
    rgba[p * 4 + 2] = (p * 7 + seed * 3) % 256;
    rgba[p * 4 + 3] = seed % 3 === 0 ? 200 : 255;
  }
  return { w, h, rgba, gamut: GAMUTS[seed % GAMUTS.length] as Gamut };
}

function encodeSerial(items: ImageInput[]): ChromaHash[] {
  return items.map((it) => ChromaHash.encode(it.w, it.h, it.rgba, it.gamut));
}

function imagesPerSec(n: number, secs: number): number {
  return secs > 0 ? n / secs : Number.POSITIVE_INFINITY;
}

function fmt(label: string, secs: number, speedup: number): string {
  const ips = imagesPerSec(N, secs).toFixed(0).padStart(10);
  return `${label}: ${secs.toFixed(4).padStart(8)}s  ${ips} img/s  (${speedup.toFixed(2)}x)`;
}

const items = Array.from({ length: N }, (_, i) => makeImage(i));
console.log(
  `chromahash batch benchmark — ${N} images, ${availableParallelism()} cores available (serial)\n`,
);

const t0 = performance.now();
const serial = encodeSerial(items);
const serialSecs = (performance.now() - t0) / 1000;
console.log(fmt("serial            ", serialSecs, 1.0));

const enc = new BatchEncoder();
const t1 = performance.now();
const batch = enc.encodeBatch(items);
const batchSecs = (performance.now() - t1) / 1000;
console.log(fmt("batch (serial)    ", batchSecs, serialSecs / batchSecs));

// Sanity: batch output equals serial.
for (let i = 0; i < N; i++) {
  if (batch[i]?.hash.join(",") !== serial[i]?.hash.join(",")) {
    throw new Error(`batch output diverges at index ${i}`);
  }
}
