import lqip from "lqip-modern";
import sharp from "sharp";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { computeAllMetrics } from "../metrics.ts";

export class LqipModernAdapter implements FormatAdapter {
  readonly name: string;
  /** Max output dimension passed to lqip-modern (library default 16). */
  private readonly resize: number;
  /** Output codec passed to lqip-modern (library default webp, quality 20). */
  private readonly outputFormat: "webp" | "jpeg";

  constructor(opts?: {
    name?: string;
    resize?: number;
    outputFormat?: "webp" | "jpeg";
  }) {
    this.name = opts?.name ?? "lqip-modern";
    this.resize = opts?.resize ?? 16;
    this.outputFormat = opts?.outputFormat ?? "webp";
  }

  async process(input: ImageInput): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

    // lqip-modern takes a Buffer of an image file (not raw RGBA).
    // Convert the downscaled RGBA to a PNG buffer first.
    const pngBuffer = await sharp(Buffer.from(rgba), {
      raw: { width: w, height: h, channels: 4 },
    })
      .png()
      .toBuffer();

    const lqipOpts = { resize: this.resize, outputFormat: this.outputFormat };
    const result = await lqip(pngBuffer, lqipOpts);

    const encodedSizeBytes = result.content.length;
    // Built here rather than taken from result.metadata.dataURIBase64: the
    // library hard-codes the webp mime type even for jpeg output (byte-identical
    // for webp, correct for jpeg).
    const mime = this.outputFormat === "jpeg" ? "image/jpeg" : "image/webp";
    const dataUri = `data:${mime};base64,${result.content.toString("base64")}`;

    // Decode the lqip output back to RGBA for metric computation
    const lqipImage = sharp(result.content);
    const { data: decodedRaw, info } = await lqipImage
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const decodedRgba = new Uint8Array(decodedRaw);
    const dw = info.width;
    const dh = info.height;

    // Decode timing: the real WebP → RGBA decode, measured like every other
    // format (previously hard-coded to 0, which misrepresented the format as
    // having a free decode).

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
      // The WebP payload carries its own dimensions in the bitstream header;
      // `info` is that header, not a size this harness requested.
      intrinsicSize: { kind: "declared", width: dw, height: dh },
      dataUri,
      ...scores,
    };
  }
}
