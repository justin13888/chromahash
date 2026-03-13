import lqip from "lqip-modern";
import sharp from "sharp";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { computePsnr, timeMs } from "../metrics.ts";

export class LqipModernAdapter implements FormatAdapter {
  readonly name = "lqip-modern";

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

    // lqip-modern takes a Buffer of an image file (not raw RGBA).
    // Convert the downscaled RGBA to a PNG buffer first.
    const pngBuffer = await sharp(Buffer.from(rgba), {
      raw: { width: w, height: h, channels: 4 },
    })
      .png()
      .toBuffer();

    const result = await lqip(pngBuffer);
    const encodeTimeMs = await timeMs(async () => {
      await lqip(pngBuffer);
    }, iterations);

    const metadata = result.metadata;
    const encodedSizeBytes = metadata.dataURIBase64.length;
    const dataUri = metadata.dataURIBase64;

    // Decode the lqip output back to RGBA for PSNR computation
    const lqipImage = sharp(result.content);
    const { data: decodedRaw, info } = await lqipImage
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const decodedRgba = new Uint8Array(decodedRaw);
    const dw = info.width;
    const dh = info.height;

    // Decode timing: negligible since it's just displaying a tiny image
    const decodeTimeMs = 0;

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
