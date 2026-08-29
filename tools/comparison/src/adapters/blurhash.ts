import { decode, encode } from "blurhash";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { rgbaToDataUri } from "../image-loader.ts";
import { computeAllMetrics, timeMs } from "../metrics.ts";

export class BlurHashAdapter implements FormatAdapter {
  readonly name: string;
  /** DCT components along X (1..=9); 4x4 is the library's recommended default. */
  private readonly componentsX: number;
  /** DCT components along Y (1..=9). */
  private readonly componentsY: number;

  constructor(opts?: {
    name?: string;
    componentsX?: number;
    componentsY?: number;
  }) {
    this.name = opts?.name ?? "BlurHash";
    this.componentsX = opts?.componentsX ?? 4;
    this.componentsY = opts?.componentsY ?? 4;
  }

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;
    const cx = this.componentsX;
    const cy = this.componentsY;

    // BlurHash encode expects Uint8ClampedArray of RGBA
    const pixels = new Uint8ClampedArray(rgba);

    const hashStr = encode(pixels, w, h, cx, cy);
    const encodeTimeMs = await timeMs(() => {
      encode(pixels, w, h, cx, cy);
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
    const reference = input.metricReferenceRgba ?? input.referenceRgba;
    const scores = await computeAllMetrics(
      reference,
      input.referenceWidth,
      input.referenceHeight,
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
      ...scores,
    };
  }
}
