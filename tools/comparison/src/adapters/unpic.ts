import { blurhashToCssGradientString } from "@unpic/placeholder";
import { encode } from "blurhash";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { timeMs } from "../metrics.ts";

export class UnpicAdapter implements FormatAdapter {
  readonly name = "unpic";

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

    // unpic uses BlurHash internally, then converts to CSS gradient
    const pixels = new Uint8ClampedArray(rgba);

    let css = "";
    const encodeTimeMs = await timeMs(() => {
      const bh = encode(pixels, w, h, 4, 4);
      css = blurhashToCssGradientString(bh);
    }, iterations);

    // The "encoded" size is the CSS string length
    const encodedSizeBytes = new TextEncoder().encode(css).length;

    // unpic produces CSS, not a raster image — no decode step
    // Store CSS as the data URI (special handling in report)
    const dataUri = `css:${css}`;

    return {
      formatName: this.name,
      encodedSizeBytes,
      decodedWidth: 0,
      decodedHeight: 0,
      encodeTimeMs,
      decodeTimeMs: 0,
      dataUri,
      psnrDb: null,
    };
  }
}
