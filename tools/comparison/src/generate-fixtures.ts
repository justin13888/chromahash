import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures/synthetic");

/** Generate a raw RGBA buffer and save as PNG via sharp. */
async function savePng(
  filePath: string,
  w: number,
  h: number,
  rgba: Uint8Array,
): Promise<void> {
  await sharp(Buffer.from(rgba), {
    raw: { width: w, height: h, channels: 4 },
  })
    .png()
    .toFile(filePath);
}

/** Create a solid color image. */
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

/** Create a 2D gradient image (R varies with x, B varies with y). */
function gradient2d(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = w > 1 ? x / (w - 1) : 0.5;
      const ty = h > 1 ? y / (h - 1) : 0.5;
      const idx = (y * w + x) * 4;
      rgba[idx] = Math.round(tx * 255);
      rgba[idx + 1] = Math.round((1 - tx) * ty * 255);
      rgba[idx + 2] = Math.round(ty * 255);
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

/** Create a horizontal gradient. */
function gradientHorizontal(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = w > 1 ? x / (w - 1) : 0.5;
      const idx = (y * w + x) * 4;
      rgba[idx] = Math.round(t * 255);
      rgba[idx + 1] = Math.round((1 - t) * 255);
      rgba[idx + 2] = 128;
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

/** Create a vertical gradient. */
function gradientVertical(w: number, h: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = h > 1 ? y / (h - 1) : 0.5;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      rgba[idx] = Math.round(t * 255);
      rgba[idx + 1] = Math.round(t * 128);
      rgba[idx + 2] = Math.round((1 - t) * 255);
      rgba[idx + 3] = 255;
    }
  }
  return rgba;
}

/** Deterministic pseudo-random using a simple LCG. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export async function generateFixtures(): Promise<void> {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
  console.log(`Generating synthetic fixtures in ${FIXTURES_DIR}...`);

  const fixtures: Array<{
    name: string;
    w: number;
    h: number;
    rgba: Uint8Array;
  }> = [];

  // === Axis 1: Dimensions / Aspect Ratios ===
  const dimSizes: Array<[string, number, number]> = [
    ["dim-1x1", 1, 1],
    ["dim-4x4", 4, 4],
    ["dim-16x16", 16, 16],
    ["dim-100x100", 100, 100],
    ["dim-8x4", 8, 4],
    ["dim-4x8", 4, 8],
    ["dim-100x1", 100, 1],
    ["dim-1x100", 1, 100],
    ["dim-9x6", 9, 6],
    ["dim-16x9", 16, 9],
  ];
  for (const [name, w, h] of dimSizes) {
    fixtures.push({ name, w, h, rgba: gradient2d(w, h) });
  }

  // === Axis 3: Alpha Channel ===
  // alpha-opaque
  fixtures.push({
    name: "alpha-opaque",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 128, 64, 200, 255),
  });

  // alpha-checkerboard
  {
    const w = 8;
    const h = 8;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 200;
        rgba[idx + 1] = 100;
        rgba[idx + 2] = 50;
        rgba[idx + 3] = (x + y) % 2 === 0 ? 255 : 0;
      }
    }
    fixtures.push({ name: "alpha-checkerboard", w, h, rgba });
  }

  // alpha-uniform-128
  fixtures.push({
    name: "alpha-uniform-128",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 128, 64, 200, 128),
  });

  // alpha-fully-transparent
  fixtures.push({
    name: "alpha-fully-transparent",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 0, 0, 0, 0),
  });

  // alpha-single-pixel (one transparent pixel among opaque)
  {
    const w = 8;
    const h = 8;
    const rgba = solidImage(w, h, 128, 64, 200, 255);
    rgba[3] = 0; // first pixel transparent
    fixtures.push({ name: "alpha-single-pixel", w, h, rgba });
  }

  // alpha-gradient
  {
    const w = 16;
    const h = 8;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        rgba[idx] = 128;
        rgba[idx + 1] = 64;
        rgba[idx + 2] = 200;
        rgba[idx + 3] = Math.round((x / (w - 1)) * 255);
      }
    }
    fixtures.push({ name: "alpha-gradient", w, h, rgba });
  }

  // === Axis 4: Color Distribution ===
  fixtures.push({
    name: "solid-white",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 255, 255, 255, 255),
  });
  fixtures.push({
    name: "solid-black",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 0, 0, 0, 255),
  });
  fixtures.push({
    name: "solid-gray",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 128, 128, 128, 255),
  });
  fixtures.push({
    name: "solid-red",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 255, 0, 0, 255),
  });
  fixtures.push({
    name: "solid-green",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 0, 255, 0, 255),
  });
  fixtures.push({
    name: "solid-blue",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 0, 0, 255, 255),
  });
  fixtures.push({
    name: "gradient-horizontal",
    w: 16,
    h: 16,
    rgba: gradientHorizontal(16, 16),
  });
  fixtures.push({
    name: "gradient-vertical",
    w: 16,
    h: 16,
    rgba: gradientVertical(16, 16),
  });
  fixtures.push({
    name: "gradient-2d",
    w: 16,
    h: 16,
    rgba: gradient2d(16, 16),
  });

  // checkerboard
  {
    const w = 16;
    const h = 16;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const val = (x + y) % 2 === 0 ? 255 : 0;
        rgba[idx] = val;
        rgba[idx + 1] = val;
        rgba[idx + 2] = val;
        rgba[idx + 3] = 255;
      }
    }
    fixtures.push({ name: "checkerboard", w, h, rgba });
  }

  // noise
  {
    const w = 16;
    const h = 16;
    const rng = lcg(42);
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = Math.round(rng() * 255);
      rgba[i * 4 + 1] = Math.round(rng() * 255);
      rgba[i * 4 + 2] = Math.round(rng() * 255);
      rgba[i * 4 + 3] = 255;
    }
    fixtures.push({ name: "noise", w, h, rgba });
  }

  // === Axis 5: Quantization Extremes ===
  fixtures.push({
    name: "saturated-warm",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 255, 80, 0, 255),
  });
  fixtures.push({
    name: "saturated-cool",
    w: 8,
    h: 8,
    rgba: solidImage(8, 8, 0, 200, 255, 255),
  });

  // near-black gradient
  {
    const w = 16;
    const h = 16;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = x / (w - 1);
        const idx = (y * w + x) * 4;
        rgba[idx] = Math.round(t * 15);
        rgba[idx + 1] = Math.round(t * 10);
        rgba[idx + 2] = Math.round(t * 20);
        rgba[idx + 3] = 255;
      }
    }
    fixtures.push({ name: "near-black-gradient", w, h, rgba });
  }

  // near-white gradient
  {
    const w = 16;
    const h = 16;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = x / (w - 1);
        const idx = (y * w + x) * 4;
        rgba[idx] = Math.round(240 + t * 15);
        rgba[idx + 1] = Math.round(240 + t * 15);
        rgba[idx + 2] = Math.round(240 + t * 15);
        rgba[idx + 3] = 255;
      }
    }
    fixtures.push({ name: "near-white-gradient", w, h, rgba });
  }

  // monochrome
  {
    const w = 16;
    const h = 16;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = x / (w - 1);
        const v = Math.round(t * 255);
        const idx = (y * w + x) * 4;
        rgba[idx] = v;
        rgba[idx + 1] = v;
        rgba[idx + 2] = v;
        rgba[idx + 3] = 255;
      }
    }
    fixtures.push({ name: "monochrome", w, h, rgba });
  }

  // === Axis 2: Gamut (same pixel data, different gamut interpretation) ===
  const gamutImage = solidImage(8, 8, 220, 50, 30, 255);
  for (const gamutName of ["srgb", "p3", "adobe-rgb", "bt2020", "prophoto"]) {
    fixtures.push({ name: `gamut-${gamutName}`, w: 8, h: 8, rgba: gamutImage });
  }

  // Save all fixtures
  for (const { name, w, h, rgba } of fixtures) {
    const filePath = path.join(FIXTURES_DIR, `${name}.png`);
    await savePng(filePath, w, h, rgba);
  }

  console.log(`Generated ${fixtures.length} synthetic fixtures.`);
}

// Run directly if invoked as main
const isMain =
  process.argv[1]?.endsWith("generate-fixtures.js") ||
  process.argv[1]?.endsWith("generate-fixtures.ts");
if (isMain) {
  generateFixtures().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
