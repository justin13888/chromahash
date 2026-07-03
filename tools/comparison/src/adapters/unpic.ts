import { blurhashToCssGradientString } from "@unpic/placeholder";
import { decode, encode } from "blurhash";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { ALPHA_BACKDROP, computeAllMetrics, timeMs } from "../metrics.ts";
import {
  type GradientCellColor,
  rasterizeUnpicGradients,
} from "../rasterize-gradients.ts";

/** Gradient grid `blurhashToCssGradientString` decodes to (its defaults). */
const GRADIENT_COLS = 4;
const GRADIENT_ROWS = 3;

/**
 * Long edge (px) the CSS gradient stack is rasterized at for scoring. The
 * gradients are resolution-independent and extremely smooth, so 64px captures
 * them faithfully; `computeAllMetrics` upscales to the display-resolution
 * reference like every other format's decode.
 */
const RASTER_LONG_EDGE = 64;

export class UnpicAdapter implements FormatAdapter {
  readonly name = "unpic";

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

    // unpic uses BlurHash internally, then converts to CSS gradient
    const pixels = new Uint8ClampedArray(rgba);

    const hashStr = encode(pixels, w, h, 4, 4);
    const css = blurhashToCssGradientString(hashStr);
    const encodeTimeMs = await timeMs(() => {
      const bh = encode(pixels, w, h, 4, 4);
      blurhashToCssGradientString(bh);
    }, iterations);

    // The "encoded" size is the CSS string length
    const encodedSizeBytes = new TextEncoder().encode(css).length;

    // Score the CSS for real: decode the same blurhash to the gradient cell
    // grid exactly as @unpic/placeholder does internally, then rasterize the
    // radial-gradient stack the way a browser renders it (over the scoring
    // backdrop). The browser's CSS rendering is the format's true "decode".
    const cellPixels = decode(hashStr, GRADIENT_COLS, GRADIENT_ROWS);
    const cells: GradientCellColor[] = [];
    for (let i = 0; i < cellPixels.length; i += 4) {
      cells.push({
        r: cellPixels[i] ?? 0,
        g: cellPixels[i + 1] ?? 0,
        b: cellPixels[i + 2] ?? 0,
      });
    }
    const scale = RASTER_LONG_EDGE / Math.max(w, h);
    const rasterW = Math.max(1, Math.round(w * scale));
    const rasterH = Math.max(1, Math.round(h * scale));
    const rasterRgba = rasterizeUnpicGradients(
      cells,
      GRADIENT_COLS,
      GRADIENT_ROWS,
      rasterW,
      rasterH,
      ALPHA_BACKDROP,
    );

    const reference = input.metricReferenceRgba ?? input.referenceRgba;
    const scores = await computeAllMetrics(
      reference,
      input.referenceWidth,
      input.referenceHeight,
      rasterRgba,
      rasterW,
      rasterH,
    );

    // Store CSS as the data URI (special handling in report) — the HTML still
    // previews the real CSS; the raster exists only for scoring. Decode time
    // stays 0: in production the browser renders the CSS directly.
    const dataUri = `css:${css}`;

    return {
      formatName: this.name,
      encodedSizeBytes,
      decodedWidth: rasterW,
      decodedHeight: rasterH,
      encodeTimeMs,
      decodeTimeMs: 0,
      dataUri,
      ...scores,
    };
  }
}
