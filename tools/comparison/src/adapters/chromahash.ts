import { ChromaHash } from "@chromahash/typescript";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { rgbaToDataUri } from "../image-loader.ts";
import { computePsnr, timeMs } from "../metrics.ts";

export class ChromaHashAdapter implements FormatAdapter {
  readonly name = "ChromaHash";

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

    // Encode once to get result, then time the operation
    const encoded = ChromaHash.encode(w, h, rgba, "sRGB");
    const encodeTimeMs = await timeMs(() => {
      ChromaHash.encode(w, h, rgba, "sRGB");
    }, iterations);

    const encodedSizeBytes = encoded.hash.length;

    const decoded = encoded.decode();
    const decodeTimeMs = await timeMs(() => {
      encoded.decode();
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
