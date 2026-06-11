import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  averageColor,
  decode,
  decodeCapped,
  isVersionSupported,
} from "./decode.ts";
import { ChromaHash, init } from "./index.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(currentDir, "../../spec/test-vectors");
const wasmPath = resolve(currentDir, "../wasm/chromahash_wasm_bg.wasm");

// The sync guard compares this pure-TS path against the WASM build.
await init(readFileSync(wasmPath));

function loadVectors<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(specDir, name), "utf-8")) as T;
}

// ---------------------------------------------------------------------------
// Spec vectors — the pure-TS decoder must reproduce the reference output
// ---------------------------------------------------------------------------

interface DecodeVector {
  name: string;
  input: { hash: number[] };
  expected: { width: number; height: number; rgba: number[] };
}

describe("pure-TS decode (spec vectors)", () => {
  const vectors = loadVectors<DecodeVector[]>("integration-decode.json");

  for (const vec of vectors) {
    it(`decode ${vec.name}`, () => {
      const out = decode(new Uint8Array(vec.input.hash));
      assert.equal(out.w, vec.expected.width, "width mismatch");
      assert.equal(out.h, vec.expected.height, "height mismatch");
      assert.equal(
        out.rgba.length,
        vec.expected.rgba.length,
        "length mismatch",
      );
      for (let i = 0; i < vec.expected.rgba.length; i++) {
        const actual = out.rgba[i] as number;
        const expected = vec.expected.rgba[i] as number;
        assert.ok(
          Math.abs(actual - expected) <= 1,
          `pixel byte ${i}: expected ${expected}, got ${actual}`,
        );
      }
    });
  }
});

interface DecodeCappedVector {
  name: string;
  input: { hash: number[]; max_width: number; max_height: number };
  expected: { width: number; height: number; rgba: number[] };
}

describe("pure-TS decodeCapped (spec vectors)", () => {
  const vectors = loadVectors<DecodeCappedVector[]>(
    "integration-decode-capped.json",
  );

  for (const vec of vectors) {
    it(`decode capped ${vec.name}`, () => {
      const out = decodeCapped(
        new Uint8Array(vec.input.hash),
        vec.input.max_width,
        vec.input.max_height,
      );
      assert.equal(out.w, vec.expected.width, "width mismatch");
      assert.equal(out.h, vec.expected.height, "height mismatch");
      assert.equal(
        out.rgba.length,
        vec.expected.rgba.length,
        "length mismatch",
      );
      for (let i = 0; i < vec.expected.rgba.length; i++) {
        const actual = out.rgba[i] as number;
        const expected = vec.expected.rgba[i] as number;
        assert.ok(
          Math.abs(actual - expected) <= 1,
          `pixel byte ${i}: expected ${expected}, got ${actual}`,
        );
      }
    });
  }
});

interface EncodeVector {
  name: string;
  input: { hash?: number[] };
  expected: { hash: number[]; average_color: [number, number, number, number] };
}

describe("pure-TS averageColor (spec vectors)", () => {
  const vectors = loadVectors<EncodeVector[]>("integration-encode.json");

  for (const vec of vectors.slice(0, 64)) {
    it(`average color ${vec.name}`, () => {
      const avg = averageColor(new Uint8Array(vec.expected.hash));
      assert.equal(avg.r, vec.expected.average_color[0], "R mismatch");
      assert.equal(avg.g, vec.expected.average_color[1], "G mismatch");
      assert.equal(avg.b, vec.expected.average_color[2], "B mismatch");
      assert.equal(avg.a, vec.expected.average_color[3], "A mismatch");
    });
  }
});

// ---------------------------------------------------------------------------
// Sync guard — the pure-TS path must be BIT-IDENTICAL to the WASM (Rust) build.
// This is what keeps the hand-maintained decoder honest when the spec changes.
// ---------------------------------------------------------------------------

function assertExactDecode(hash: Uint8Array, label: string): void {
  const pure = decode(hash);
  const wasm = ChromaHash.fromBytes(hash).decode();
  assert.equal(pure.w, wasm.w, `${label}: width`);
  assert.equal(pure.h, wasm.h, `${label}: height`);
  assert.equal(pure.rgba.length, wasm.rgba.length, `${label}: length`);
  for (let i = 0; i < wasm.rgba.length; i++) {
    assert.equal(
      pure.rgba[i],
      wasm.rgba[i],
      `${label}: pixel byte ${i} (pure=${pure.rgba[i]}, wasm=${wasm.rgba[i]})`,
    );
  }
}

describe("pure-TS decode matches WASM exactly (sync guard)", () => {
  it("agrees on every spec decode vector", () => {
    const vectors = loadVectors<DecodeVector[]>("integration-decode.json");
    for (const vec of vectors) {
      assertExactDecode(new Uint8Array(vec.input.hash), vec.name);
    }
  });

  it("agrees on every encoded spec hash", () => {
    const vectors = loadVectors<EncodeVector[]>("integration-encode.json");
    for (const vec of vectors) {
      assertExactDecode(new Uint8Array(vec.expected.hash), vec.name);
    }
  });

  it("agrees on a deterministic fuzz corpus of random hashes", () => {
    // Seeded LCG so a failure is reproducible. Each hash clears the version bit
    // (bit 47) so it is a well-formed v0.6 stream both paths agree to decode.
    let state = 0x12345678 >>> 0;
    const next = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    for (let n = 0; n < 256; n++) {
      const hash = new Uint8Array(32);
      for (let i = 0; i < 32; i++) hash[i] = next() & 0xff;
      hash[5] = (hash[5] ?? 0) & 0x7f; // clear version bit (v0.6)
      assertExactDecode(hash, `fuzz#${n}`);
    }
  });
});

describe("pure-TS isVersionSupported", () => {
  it("reports v0.6 / legacy bit correctly", () => {
    const v06 = new Uint8Array(32);
    assert.ok(isVersionSupported(v06));
    const legacy = new Uint8Array(32);
    legacy[5] = 0x80;
    assert.ok(!isVersionSupported(legacy));
  });
});
