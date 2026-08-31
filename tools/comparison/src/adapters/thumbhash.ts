import { rgbaToThumbHash, thumbHashToRGBA } from "thumbhash";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { rgbaToDataUri } from "../image-loader.ts";
import { computeAllMetrics, timeMs } from "../metrics.ts";

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
    const reference = input.metricReferenceRgba ?? input.referenceRgba;
    const scores = await computeAllMetrics(
      reference,
      input.referenceWidth,
      input.referenceHeight,
      decodedRgba,
      dw,
      dh,
    );

    return {
      formatName: this.name,
      encodedSizeBytes,
      decodedWidth: dw,
      decodedHeight: dh,
      // ThumbHash stores a 3-bit aspect field and derives its own render size
      // from it; nothing caps this decode, so the returned dimensions are the
      // format's own declaration.
      intrinsicSize: { kind: "declared", width: dw, height: dh },
      encodeTimeMs,
      decodeTimeMs,
      dataUri,
      ...scores,
    };
  }
}
