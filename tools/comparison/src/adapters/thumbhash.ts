import { rgbaToThumbHash, thumbHashToRGBA } from "thumbhash";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { rgbaToDataUri } from "../image-loader.ts";
import { computePsnr, timeMs } from "../metrics.ts";

export class ThumbHashAdapter implements FormatAdapter {
  readonly name = "ThumbHash";

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

    const hash = rgbaToThumbHash(w, h, rgba);
    const encodeTimeMs = await timeMs(() => {
      rgbaToThumbHash(w, h, rgba);
    }, iterations);

    const encodedSizeBytes = hash.length;

    const result = thumbHashToRGBA(hash);
    const decoded = { w: result.w, h: result.h, rgba: result.rgba };
    const decodeTimeMs = await timeMs(() => {
      thumbHashToRGBA(hash);
    }, iterations);

    const { w: dw, h: dh, rgba: decodedRgba } = decoded;
    const dataUri = await rgbaToDataUri(decodedRgba, dw, dh);
    const psnrDb = computePsnr(rgba, w, h, decodedRgba, dw, dh);

    return {
      formatName: this.name,
      encodedSizeBytes,
      decodedWidth: dw,
      decodedHeight: dh,
      encodeTimeMs,
      decodeTimeMs,
      dataUri,
      psnrDb,
    };
  }
}
