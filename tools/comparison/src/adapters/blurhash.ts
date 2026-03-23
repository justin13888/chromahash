import { decode, encode } from "blurhash";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { rgbaToDataUri } from "../image-loader.ts";
import { computeAllMetrics, timeMs } from "../metrics.ts";

export class BlurHashAdapter implements FormatAdapter {
  readonly name = "BlurHash";

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

    // BlurHash encode expects Uint8ClampedArray of RGBA
    const pixels = new Uint8ClampedArray(rgba);

    const hashStr = encode(pixels, w, h, 4, 4);
    const encodeTimeMs = await timeMs(() => {
      encode(pixels, w, h, 4, 4);
    }, iterations);

    const encodedSizeBytes = new TextEncoder().encode(hashStr).length;

    // Decode to 32x32 (BlurHash decodes to any specified size)
    const decodeW = 32;
    const decodeH = 32;
    const decodedPixels = decode(hashStr, decodeW, decodeH);
    const decodeTimeMs = await timeMs(() => {
      decode(hashStr, decodeW, decodeH);
    }, iterations);

    const decodedRgba = new Uint8Array(decodedPixels);

    const dataUri = await rgbaToDataUri(decodedRgba, decodeW, decodeH);
    const metrics = await computeAllMetrics(
      rgba,
      w,
      h,
      decodedRgba,
      decodeW,
      decodeH,
    );

    return {
      formatName: this.name,
      encodedSizeBytes,
      decodedWidth: decodeW,
      decodedHeight: decodeH,
      encodeTimeMs,
      decodeTimeMs,
      dataUri,
      metrics,
    };
  }
}
