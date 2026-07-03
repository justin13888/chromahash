/**
 * Software rasterizer for the CSS radial-gradient stack emitted by
 * `@unpic/placeholder`'s `blurhashToCssGradientString`, so the CSS-only format
 * can be scored with the same pixel metrics as every raster format.
 *
 * The library decodes a blurhash to a `cols`x`rows` pixel grid (4x3 by default)
 * and emits one background layer per cell:
 *
 *   radial-gradient(at X% Y%, #rrggbb, #00000000 50%)
 *
 * where X/Y are the cell's position rounded to integer percent —
 * `round(col / (cols - 1) * 100)` / `round(row / (rows - 1) * 100)`.
 * This replicates how a browser renders that stack, per the CSS specs:
 *
 * - Each layer is an *ellipse* radial gradient sized *farthest-corner* (the
 *   CSS defaults). For a center with farthest-side distances (fx, fy) the
 *   farthest-corner ellipse has radii (√2·fx, √2·fy) — the ellipse with the
 *   farthest-side aspect ratio that passes through the farthest corner.
 * - Color stops interpolate in *premultiplied* sRGB (CSS Color 4 rule for
 *   legacy sRGB interpolation with transparency). Interpolating #rrggbb → the
 *   transparent color premultiplied keeps the chromaticity constant while
 *   alpha ramps linearly 1 → 0 across gradient positions 0 → 0.5; beyond 0.5
 *   the layer is fully transparent.
 * - Background layers composite source-over with the FIRST layer in the list
 *   on top (CSS paints the last layer first), over the given backdrop.
 */

/** One gradient cell's color, in cell order (row-major, matching the CSS list). */
export interface GradientCellColor {
  r: number;
  g: number;
  b: number;
}

/** Farthest-corner ellipse radii factor relative to the farthest-side radii. */
const FARTHEST_CORNER_FACTOR = Math.SQRT2;

/** Gradient position of the transparent stop (`#00000000 50%`). */
const TRANSPARENT_STOP = 0.5;

/**
 * Rasterize the unpic radial-gradient stack to opaque RGBA at `outW`x`outH`,
 * composited over `backdrop` (pass the scoring backdrop so metrics see exactly
 * what would be scored for any other format).
 */
export function rasterizeUnpicGradients(
  pixels: GradientCellColor[],
  cols: number,
  rows: number,
  outW: number,
  outH: number,
  backdrop: [number, number, number],
): Uint8Array {
  if (cols < 2 || rows < 2) {
    // unpic positions cells at col/(cols-1) — a 1-wide/1-tall grid would be a
    // division by zero in the library itself, so it cannot occur here either.
    throw new Error(`gradient grid must be at least 2x2, got ${cols}x${rows}`);
  }
  if (pixels.length !== cols * rows) {
    throw new Error(
      `expected ${cols * rows} cell colors for a ${cols}x${rows} grid, got ${pixels.length}`,
    );
  }

  // Precompute each layer's center and ellipse radii in output pixels.
  const layers = pixels.map((color, j) => {
    const col = j % cols;
    const row = Math.floor(j / cols);
    // Replicate the library's integer-percent rounding of the position.
    const percentX = Math.round((col / (cols - 1)) * 100);
    const percentY = Math.round((row / (rows - 1)) * 100);
    const cx = (percentX / 100) * outW;
    const cy = (percentY / 100) * outH;
    const fx = Math.max(cx, outW - cx);
    const fy = Math.max(cy, outH - cy);
    return {
      color,
      cx,
      cy,
      rx: FARTHEST_CORNER_FACTOR * fx,
      ry: FARTHEST_CORNER_FACTOR * fy,
    };
  });

  const [br, bg, bb] = backdrop;
  const out = new Uint8Array(outW * outH * 4);
  for (let py = 0; py < outH; py++) {
    for (let px = 0; px < outW; px++) {
      // Sample at the pixel center.
      const x = px + 0.5;
      const y = py + 0.5;
      // Composite source-over from the bottom: backdrop, then layers in
      // reverse list order (the first CSS background layer is painted last,
      // i.e. ends up on top).
      let r = br;
      let g = bg;
      let b = bb;
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (!layer) continue;
        const dx = (x - layer.cx) / layer.rx;
        const dy = (y - layer.cy) / layer.ry;
        // Gradient position: t·(rx, ry) is the ellipse through this point.
        const t = Math.sqrt(dx * dx + dy * dy);
        if (t >= TRANSPARENT_STOP) continue;
        // Premultiplied-sRGB interpolation toward transparent: chromaticity
        // stays at the stop color, alpha ramps linearly to 0 at the stop.
        const a = 1 - t / TRANSPARENT_STOP;
        r = layer.color.r * a + r * (1 - a);
        g = layer.color.g * a + g * (1 - a);
        b = layer.color.b * a + b * (1 - a);
      }
      const o = (py * outW + px) * 4;
      out[o] = Math.round(r);
      out[o + 1] = Math.round(g);
      out[o + 2] = Math.round(b);
      out[o + 3] = 255;
    }
  }
  return out;
}
