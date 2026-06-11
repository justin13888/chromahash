import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ChromaHash, init } from "./index.ts";
import type { Gamut } from "./index.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(currentDir, "../../spec/test-vectors");
const wasmPath = resolve(currentDir, "../wasm/chromahash_wasm_bg.wasm");

// The full path is WASM-backed; instantiate it once before any test runs.
await init(readFileSync(wasmPath));

function loadVectors<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(specDir, name), "utf-8")) as T;
}

// ---------------------------------------------------------------------------
// Integration: encode (hash + average color, byte-exact vs. the reference)
// ---------------------------------------------------------------------------

interface EncodeVector {
  name: string;
  input: { width: number; height: number; gamut: Gamut; rgba: number[] };
  expected: { hash: number[]; average_color: [number, number, number, number] };
}

describe("integration encode", () => {
  const vectors = loadVectors<EncodeVector[]>("integration-encode.json");

  for (const vec of vectors) {
    it(`encode ${vec.name}`, () => {
      const rgba = new Uint8Array(vec.input.rgba);
      const ch = ChromaHash.encode(
        vec.input.width,
        vec.input.height,
        rgba,
        vec.input.gamut,
      );
      assert.deepStrictEqual(
        ch.hash,
        new Uint8Array(vec.expected.hash),
        `hash mismatch for ${vec.name}`,
      );
    });

    it(`average color ${vec.name}`, () => {
      const rgba = new Uint8Array(vec.input.rgba);
      const ch = ChromaHash.encode(
        vec.input.width,
        vec.input.height,
        rgba,
        vec.input.gamut,
      );
      const avg = ch.averageColor();
      assert.equal(avg.r, vec.expected.average_color[0], "R mismatch");
      assert.equal(avg.g, vec.expected.average_color[1], "G mismatch");
      assert.equal(avg.b, vec.expected.average_color[2], "B mismatch");
      assert.equal(avg.a, vec.expected.average_color[3], "A mismatch");
    });
  }
});

// ---------------------------------------------------------------------------
// Integration: decode
// ---------------------------------------------------------------------------

interface DecodeVector {
  name: string;
  input: { hash: number[] };
  expected: { width: number; height: number; rgba: number[] };
}

describe("integration decode", () => {
  const vectors = loadVectors<DecodeVector[]>("integration-decode.json");

  for (const vec of vectors) {
    it(`decode ${vec.name}`, () => {
      const ch = ChromaHash.fromBytes(new Uint8Array(vec.input.hash));
      const decoded = ch.decode();

      assert.equal(decoded.w, vec.expected.width, "width mismatch");
      assert.equal(decoded.h, vec.expected.height, "height mismatch");
      assert.equal(
        decoded.rgba.length,
        vec.expected.rgba.length,
        "rgba length mismatch",
      );
      for (let i = 0; i < vec.expected.rgba.length; i++) {
        const actual = decoded.rgba[i] as number;
        const expected = vec.expected.rgba[i] as number;
        assert.ok(
          Math.abs(actual - expected) <= 1,
          `pixel byte ${i}: expected ${expected}, got ${actual}`,
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Integration: capped decode
// ---------------------------------------------------------------------------

interface DecodeCappedVector {
  name: string;
  input: { hash: number[]; max_width: number; max_height: number };
  expected: { width: number; height: number; rgba: number[] };
}

describe("integration decode capped", () => {
  const vectors = loadVectors<DecodeCappedVector[]>(
    "integration-decode-capped.json",
  );

  for (const vec of vectors) {
    it(`decode capped ${vec.name}`, () => {
      const ch = ChromaHash.fromBytes(new Uint8Array(vec.input.hash));
      const decoded = ch.decodeCapped(
        vec.input.max_width,
        vec.input.max_height,
      );

      assert.equal(decoded.w, vec.expected.width, "width mismatch");
      assert.equal(decoded.h, vec.expected.height, "height mismatch");
      assert.equal(
        decoded.rgba.length,
        vec.expected.rgba.length,
        "rgba length mismatch",
      );
      for (let i = 0; i < vec.expected.rgba.length; i++) {
        const actual = decoded.rgba[i] as number;
        const expected = vec.expected.rgba[i] as number;
        assert.ok(
          Math.abs(actual - expected) <= 1,
          `pixel byte ${i}: expected ${expected}, got ${actual}`,
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

describe("fromBytes", () => {
  it("rejects wrong length", () => {
    assert.throws(() => ChromaHash.fromBytes(new Uint8Array(16)));
    assert.throws(() => ChromaHash.fromBytes(new Uint8Array(64)));
  });

  it("roundtrips with encode", () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = 128;
      rgba[i + 1] = 64;
      rgba[i + 2] = 32;
      rgba[i + 3] = 255;
    }
    const ch1 = ChromaHash.encode(4, 4, rgba, "sRGB");
    const ch2 = ChromaHash.fromBytes(new Uint8Array(ch1.hash));
    assert.deepStrictEqual(ch1.hash, ch2.hash);
  });
});

describe("isVersionSupported", () => {
  it("reports v0.6 hashes as supported", () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(128);
    const ch = ChromaHash.encode(4, 4, rgba, "sRGB");
    assert.ok(ch.isVersionSupported());
  });

  it("reports a legacy (bit 47 set) hash as unsupported", () => {
    const rgba = new Uint8Array(4 * 4 * 4).fill(128);
    const bytes = new Uint8Array(ChromaHash.encode(4, 4, rgba, "sRGB").hash);
    bytes[5] = (bytes[5] ?? 0) | 0x80;
    assert.ok(!ChromaHash.fromBytes(bytes).isVersionSupported());
  });
});
