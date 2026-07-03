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

/** An opaque RGB color. */
type Rgb = [number, number, number];

/** Fill an axis-aligned rectangle (clipped to the image bounds) with a color. */
function fillRect(
  rgba: Uint8Array,
  imgW: number,
  imgH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  [r, g, b]: Rgb,
): void {
  const x1 = Math.min(x + w, imgW);
  const y1 = Math.min(y + h, imgH);
  for (let py = Math.max(y, 0); py < y1; py++) {
    for (let px = Math.max(x, 0); px < x1; px++) {
      const idx = (py * imgW + px) * 4;
      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }
}

/** Fill a hard-edged circle (clipped to the image bounds) with a color. */
function fillCircle(
  rgba: Uint8Array,
  imgW: number,
  imgH: number,
  cx: number,
  cy: number,
  radius: number,
  color: Rgb,
): void {
  const r2 = radius * radius;
  for (
    let py = Math.max(Math.floor(cy - radius), 0);
    py <= Math.min(Math.ceil(cy + radius), imgH - 1);
    py++
  ) {
    for (
      let px = Math.max(Math.floor(cx - radius), 0);
      px <= Math.min(Math.ceil(cx + radius), imgW - 1);
      px++
    ) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= r2) {
        fillRect(rgba, imgW, imgH, px, py, 1, 1, color);
      }
    }
  }
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

  // === Axis 6: Text / UI (screenshot-like content; hard edges, no photography) ===
  // Drawn with raw pixel rects — no font rendering, so output is deterministic
  // across platforms. Sized well above the encoder input so the
  // display-resolution reference differs from what the encoder sees.

  // textui-window: window-chrome mock — title bar with traffic-light buttons,
  // a sidebar, and content placeholder bars.
  {
    const w = 320;
    const h = 240;
    const rgba = new Uint8Array(w * h * 4);
    fillRect(rgba, w, h, 0, 0, w, h, [236, 236, 240]); // window background
    fillRect(rgba, w, h, 0, 0, w, 28, [58, 58, 70]); // title bar
    fillCircle(rgba, w, h, 16, 14, 6, [255, 95, 86]); // close
    fillCircle(rgba, w, h, 36, 14, 6, [255, 189, 46]); // minimize
    fillCircle(rgba, w, h, 56, 14, 6, [39, 201, 63]); // zoom
    fillRect(rgba, w, h, 0, 28, 88, h - 28, [210, 212, 220]); // sidebar
    // Sidebar nav items: the first is "selected" (accent), the rest neutral.
    for (let i = 0; i < 5; i++) {
      const color: Rgb = i === 0 ? [74, 74, 255] : [160, 162, 176];
      fillRect(rgba, w, h, 10, 42 + i * 26, 68, 12, color);
    }
    // Content placeholder bars of varying (deterministic) widths.
    const rng = lcg(7);
    for (let i = 0; i < 9; i++) {
      const barW = 90 + Math.floor(rng() * 120);
      fillRect(rgba, w, h, 104, 44 + i * 20, barW, 10, [120, 122, 136]);
    }
    fixtures.push({ name: "textui-window", w, h, rgba });
  }

  // textui-terminal: terminal-like grid of light glyph-ish dashes on a dark
  // background — the high-contrast, character-cell structure of a console.
  {
    const w = 320;
    const h = 220;
    const rgba = new Uint8Array(w * h * 4);
    fillRect(rgba, w, h, 0, 0, w, h, [16, 16, 24]);
    const rng = lcg(1337);
    for (let row = 0; row < 12; row++) {
      const y = 10 + row * 16;
      // Prompt-colored first cell on every other row, then a run of "words".
      let x = 8;
      if (row % 2 === 0) {
        fillRect(rgba, w, h, x, y, 14, 8, [80, 250, 123]);
        x += 22;
      }
      while (x < w - 40) {
        const wordW = 10 + Math.floor(rng() * 34);
        const shade = 150 + Math.floor(rng() * 90);
        fillRect(rgba, w, h, x, y, wordW, 8, [shade, shade, shade]);
        x += wordW + 8;
      }
    }
    // Block cursor on the last line.
    fillRect(rgba, w, h, 8, 10 + 12 * 16, 10, 12, [220, 220, 230]);
    fixtures.push({ name: "textui-terminal", w, h, rgba });
  }

  // textui-form: form/button layout — labels, input fields with borders, and
  // a filled primary button next to an outlined secondary one.
  {
    const w = 280;
    const h = 320;
    const rgba = new Uint8Array(w * h * 4);
    fillRect(rgba, w, h, 0, 0, w, h, [250, 250, 252]);
    const border: Rgb = [148, 150, 162];
    const field: Rgb = [255, 255, 255];
    for (let i = 0; i < 3; i++) {
      const y = 28 + i * 68;
      fillRect(rgba, w, h, 24, y, 80, 10, [96, 98, 110]); // label
      fillRect(rgba, w, h, 24, y + 18, 232, 32, border); // input border
      fillRect(rgba, w, h, 26, y + 20, 228, 28, field); // input interior
    }
    fillRect(rgba, w, h, 24, 244, 108, 36, [74, 74, 255]); // primary button
    fillRect(rgba, w, h, 52, 258, 52, 8, [235, 235, 255]); // its label bar
    fillRect(rgba, w, h, 148, 244, 108, 36, border); // secondary border
    fillRect(rgba, w, h, 150, 246, 104, 32, [250, 250, 252]); // its interior
    fillRect(rgba, w, h, 176, 258, 52, 8, [96, 98, 110]); // its label bar
    fixtures.push({ name: "textui-form", w, h, rgba });
  }

  // === Axis 7: Illustration (flat fills, hard edges, limited palettes) ===

  // illust-landscape: simple flat-color landscape — sky, sun, two hill layers,
  // and a foreground strip. Five colors, no gradients.
  {
    const w = 360;
    const h = 240;
    const rgba = new Uint8Array(w * h * 4);
    fillRect(rgba, w, h, 0, 0, w, h, [140, 200, 240]); // sky
    fillCircle(rgba, w, h, 280, 60, 34, [255, 205, 60]); // sun
    // Back hill: a wide flat dome overlapping the horizon.
    fillCircle(rgba, w, h, 90, 250, 130, [110, 170, 90]);
    // Front hill: darker, offset right.
    fillCircle(rgba, w, h, 300, 280, 150, [70, 130, 60]);
    fillRect(rgba, w, h, 0, 200, w, 40, [92, 70, 50]); // foreground
    fixtures.push({ name: "illust-landscape", w, h, rgba });
  }

  // illust-icon: icon-like glyph — a white play triangle on a flat circular
  // badge, the archetypal two-color app icon.
  {
    const w = 256;
    const h = 256;
    const rgba = new Uint8Array(w * h * 4);
    fillRect(rgba, w, h, 0, 0, w, h, [245, 245, 248]);
    fillCircle(rgba, w, h, 128, 128, 104, [74, 74, 255]);
    // Play triangle: scanline fill, apex pointing right.
    for (let py = 88; py < 168; py++) {
      const dist = Math.abs(py - 128); // 0 at the center row, 40 at the edges
      const rowW = Math.round(72 * (1 - dist / 40));
      fillRect(rgba, w, h, 104, py, rowW, 1, [255, 255, 255]);
    }
    fixtures.push({ name: "illust-icon", w, h, rgba });
  }

  // illust-comic: comic-panel-ish composition — black gutters dividing three
  // flat-color panels, a speech bubble, and a halftone dot grid.
  {
    const w = 320;
    const h = 240;
    const rgba = new Uint8Array(w * h * 4);
    fillRect(rgba, w, h, 0, 0, w, h, [20, 20, 20]); // gutters/borders
    // Panel 1 (top left): orange scene with a character silhouette.
    fillRect(rgba, w, h, 6, 6, 150, 110, [240, 150, 50]);
    fillRect(rgba, w, h, 56, 56, 40, 60, [40, 40, 60]); // body
    fillCircle(rgba, w, h, 76, 44, 16, [40, 40, 60]); // head
    // Panel 2 (top right): blue scene with a white speech bubble.
    fillRect(rgba, w, h, 164, 6, 150, 110, [70, 120, 200]);
    fillCircle(rgba, w, h, 238, 48, 30, [255, 255, 255]);
    fillRect(rgba, w, h, 214, 48, 48, 22, [255, 255, 255]);
    fillRect(rgba, w, h, 226, 74, 10, 16, [255, 255, 255]); // bubble tail
    // Panel 3 (bottom): yellow scene with a halftone dot grid.
    fillRect(rgba, w, h, 6, 124, 308, 110, [250, 215, 80]);
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 21; gx++) {
        fillCircle(rgba, w, h, 16 + gx * 14, 134 + gy * 14, 3, [200, 60, 40]);
      }
    }
    fixtures.push({ name: "illust-comic", w, h, rgba });
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
  import.meta.filename !== undefined &&
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === import.meta.filename;
if (isMain) {
  generateFixtures().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
