import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ChromaHash,
  _decodeAspect as decodeAspect,
  _decodeOutputSize as decodeOutputSize,
  _encodeAspect as encodeAspect,
  _gammaRgbToOklab as gammaRgbToOklab,
  _linearRgbToOklab as linearRgbToOklab,
  _muCompress as muCompress,
  _muExpand as muExpand,
  _muLawDequantize as muLawDequantize,
  _muLawQuantize as muLawQuantize,
  _roundHalfAwayFromZero as roundHalfAwayFromZero,
  _triangularScanOrder as triangularScanOrder,
} from "./index.ts";
import type { Gamut } from "./index.ts";

const currentDir = dirname(fileURLToPath(import.meta.url));
const specDir = resolve(currentDir, "../../spec/test-vectors");

function loadVectors<T>(name: string): T {
  return JSON.parse(readFileSync(resolve(specDir, name), "utf-8")) as T;
}

// ---------------------------------------------------------------------------
// Unit tests: rounding
// ---------------------------------------------------------------------------

describe("roundHalfAwayFromZero", () => {
  it("rounds positive halves up", () => {
    assert.equal(roundHalfAwayFromZero(0.5), 1);
    assert.equal(roundHalfAwayFromZero(1.5), 2);
    assert.equal(roundHalfAwayFromZero(2.5), 3);
  });

  it("rounds negative halves away from zero", () => {
    assert.equal(roundHalfAwayFromZero(-0.5), -1);
    assert.equal(roundHalfAwayFromZero(-1.5), -2);
    assert.equal(roundHalfAwayFromZero(-2.5), -3);
  });

  it("handles standard cases", () => {
    assert.equal(roundHalfAwayFromZero(0), 0);
    assert.equal(roundHalfAwayFromZero(0.3), 0);
    assert.equal(roundHalfAwayFromZero(0.7), 1);
    // -0.3 rounds to -0 via ceil, which is === 0 in JS
    assert.ok(roundHalfAwayFromZero(-0.3) === 0);
    assert.equal(roundHalfAwayFromZero(-0.7), -1);
  });
});

// ---------------------------------------------------------------------------
// Unit tests: color conversion
// ---------------------------------------------------------------------------

interface ColorVector {
  name: string;
  input: {
    linear_rgb?: [number, number, number];
    gamma_rgb?: [number, number, number];
    gamut: Gamut;
  };
  expected: {
    oklab: [number, number, number];
    roundtrip_srgb?: [number, number, number];
  };
}

describe("color conversion", () => {
  const vectors = loadVectors<ColorVector[]>("unit-color.json");

  for (const vec of vectors) {
    it(vec.name, () => {
      let oklab: [number, number, number];
      if (vec.input.linear_rgb) {
        oklab = linearRgbToOklab(vec.input.linear_rgb, vec.input.gamut);
      } else if (vec.input.gamma_rgb) {
        oklab = gammaRgbToOklab(
          vec.input.gamma_rgb[0],
          vec.input.gamma_rgb[1],
          vec.input.gamma_rgb[2],
          vec.input.gamut,
        );
      } else {
        throw new Error("No input RGB");
      }

      assert.ok(
        Math.abs(oklab[0] - vec.expected.oklab[0]) < 1e-10,
        `${vec.name} oklab[0]: expected ${vec.expected.oklab[0]}, got ${oklab[0]}`,
      );
      assert.ok(
        Math.abs(oklab[1] - vec.expected.oklab[1]) < 1e-10,
        `${vec.name} oklab[1]: expected ${vec.expected.oklab[1]}, got ${oklab[1]}`,
      );
      assert.ok(
        Math.abs(oklab[2] - vec.expected.oklab[2]) < 1e-10,
        `${vec.name} oklab[2]: expected ${vec.expected.oklab[2]}, got ${oklab[2]}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Unit tests: mu-law
// ---------------------------------------------------------------------------

interface MulawVector {
  name: string;
  input: { value: number; bits: number };
  expected: {
    compressed: number;
    expanded: number;
    quantized: number;
    dequantized: number;
  };
}

describe("mu-law", () => {
  const vectors = loadVectors<MulawVector[]>("unit-mulaw.json");

  for (const vec of vectors) {
    it(`compress ${vec.name}`, () => {
      const compressed = muCompress(vec.input.value);
      assert.ok(
        Math.abs(compressed - vec.expected.compressed) < 1e-12,
        `compress: expected ${vec.expected.compressed}, got ${compressed}`,
      );
    });

    it(`expand ${vec.name}`, () => {
      const expanded = muExpand(vec.expected.compressed);
      assert.ok(
        Math.abs(expanded - vec.expected.expanded) < 1e-12,
        `expand: expected ${vec.expected.expanded}, got ${expanded}`,
      );
    });

    it(`quantize ${vec.name}`, () => {
      const q = muLawQuantize(vec.input.value, vec.input.bits);
      assert.equal(
        q,
        vec.expected.quantized,
        `quantize: expected ${vec.expected.quantized}, got ${q}`,
      );
    });

    it(`dequantize ${vec.name}`, () => {
      const dq = muLawDequantize(vec.expected.quantized, vec.input.bits);
      assert.ok(
        Math.abs(dq - vec.expected.dequantized) < 1e-12,
        `dequantize: expected ${vec.expected.dequantized}, got ${dq}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Unit tests: DCT scan order
// ---------------------------------------------------------------------------

interface DctVector {
  name: string;
  input: { nx: number; ny: number };
  expected: { ac_count: number; scan_order: [number, number][] };
}

describe("DCT scan order", () => {
  const vectors = loadVectors<DctVector[]>("unit-dct.json");

  for (const vec of vectors) {
    it(vec.name, () => {
      const order = triangularScanOrder(vec.input.nx, vec.input.ny);
      assert.equal(
        order.length,
        vec.expected.ac_count,
        `ac_count: expected ${vec.expected.ac_count}, got ${order.length}`,
      );
      assert.deepStrictEqual(order, vec.expected.scan_order);
    });
  }
});

// ---------------------------------------------------------------------------
// Unit tests: aspect ratio
// ---------------------------------------------------------------------------

interface AspectVector {
  name: string;
  input: { width: number; height: number };
  expected: {
    byte: number;
    decoded_ratio: number;
    output_width: number;
    output_height: number;
  };
}

describe("aspect ratio", () => {
  const vectors = loadVectors<AspectVector[]>("unit-aspect.json");

  for (const vec of vectors) {
    it(`encode ${vec.name}`, () => {
      const byte = encodeAspect(vec.input.width, vec.input.height);
      assert.equal(
        byte,
        vec.expected.byte,
        `byte: expected ${vec.expected.byte}, got ${byte}`,
      );
    });

    it(`decode ${vec.name}`, () => {
      const ratio = decodeAspect(vec.expected.byte);
      assert.ok(
        Math.abs(ratio - vec.expected.decoded_ratio) < 1e-10,
        `ratio: expected ${vec.expected.decoded_ratio}, got ${ratio}`,
      );
    });

    it(`output size ${vec.name}`, () => {
      const [w, h] = decodeOutputSize(vec.expected.byte);
      assert.equal(
        w,
        vec.expected.output_width,
        `width: expected ${vec.expected.output_width}, got ${w}`,
      );
      assert.equal(
        h,
        vec.expected.output_height,
        `height: expected ${vec.expected.output_height}, got ${h}`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Integration tests: encode
// ---------------------------------------------------------------------------

interface EncodeVector {
  name: string;
  input: {
    width: number;
    height: number;
    gamut: Gamut;
    rgba: number[];
  };
  expected: {
    hash: number[];
    average_color: [number, number, number, number];
  };
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
      const expected = new Uint8Array(vec.expected.hash);
      assert.deepStrictEqual(
        ch.hash,
        expected,
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
// Integration tests: decode
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
      const hashBytes = new Uint8Array(vec.input.hash);
      const ch = ChromaHash.fromBytes(hashBytes);
      const decoded = ch.decode();

      assert.equal(
        decoded.w,
        vec.expected.width,
        `width: expected ${vec.expected.width}, got ${decoded.w}`,
      );
      assert.equal(
        decoded.h,
        vec.expected.height,
        `height: expected ${vec.expected.height}, got ${decoded.h}`,
      );

      const expectedRgba = vec.expected.rgba;
      assert.equal(
        decoded.rgba.length,
        expectedRgba.length,
        "rgba length mismatch",
      );

      for (let i = 0; i < expectedRgba.length; i++) {
        const actual = decoded.rgba[i] as number;
        const expected = expectedRgba[i] as number;
        const diff = Math.abs(actual - expected);
        assert.ok(
          diff <= 1,
          `pixel byte ${i}: expected ${expected}, got ${actual} (diff=${diff})`,
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// fromBytes validation
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
