import sharp from "sharp";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { rgbaToDataUri } from "../image-loader.ts";
import { computeAllMetrics, flattenOverBackdrop, timeMs } from "../metrics.ts";
import { BudgetUnrepresentableError } from "../rd/byte-target.ts";

/** RGB565 packs each pixel into two bytes (5 red, 6 green, 5 blue bits). */
const BYTES_PER_PIXEL = 2;

/**
 * Codec-free control for the R-D comparison: raw RGB565-packed pixels. If a
 * format cannot beat "just store a tiny grid of raw pixels" at equal bytes,
 * its coding machinery is not paying for itself.
 *
 * Grid rule: the aspect-preserving grid with the most pixels that fits the
 * budget — the largest row count m (capped at the source height) such that
 * n = clamp(round(m·aspect), 1, sourceWidth) columns keep 2·n·m <= targetBytes.
 * No header or dimension bytes are counted: the control gets the most generous
 * possible framing, spending every budgeted byte on pixel data.
 */
export class RawPixelsAdapter implements FormatAdapter {
  readonly name: string;
  private readonly targetBytes: number;

  constructor(targetBytes: number) {
    this.targetBytes = targetBytes;
    this.name = `RawRGB565@${targetBytes}B`;
  }

  /** Choose the grid per the documented rule, or null when nothing fits. */
  private chooseGrid(
    sourceW: number,
    sourceH: number,
  ): { n: number; m: number } | null {
    const aspect = sourceW / sourceH;
    let best: { n: number; m: number } | null = null;
    for (let m = 1; m <= sourceH; m++) {
      const n = Math.min(Math.max(1, Math.round(m * aspect)), sourceW);
      if (BYTES_PER_PIXEL * n * m > this.targetBytes) break;
      if (best === null || n * m > best.n * best.m) {
        best = { n, m };
      }
    }
    return best;
  }

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

    const grid = this.chooseGrid(w, h);
    if (grid === null) {
      throw new BudgetUnrepresentableError(
        this.name,
        this.targetBytes,
        BYTES_PER_PIXEL,
      );
    }
    const { n, m } = grid;

    // RGB565 carries no alpha: flatten over the scoring backdrop first so the
    // control sees the same composited pixels the metrics score.
    const flattened = flattenOverBackdrop(rgba);
    const downscale = async (): Promise<Uint8Array> => {
      const { data } = await sharp(Buffer.from(flattened), {
        raw: { width: w, height: h, channels: 4 },
      })
        .resize(n, m, { fit: "fill", kernel: "lanczos3" })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return new Uint8Array(data);
    };

    const gridRgba = await downscale();
    const packed = packRgb565(gridRgba);
    const encodeTimeMs = await timeMs(async () => {
      packRgb565(await downscale());
    }, iterations);

    const decodedRgba = unpackRgb565(packed);
    const decodeTimeMs = await timeMs(() => {
      unpackRgb565(packed);
    }, iterations);

    const dataUri = await rgbaToDataUri(decodedRgba, n, m);
    const reference = input.metricReferenceRgba ?? input.referenceRgba;
    const scores = await computeAllMetrics(
      reference,
      input.referenceWidth,
      input.referenceHeight,
      decodedRgba,
      n,
      m,
    );

    return {
      formatName: this.name,
      encodedSizeBytes: packed.length,
      decodedWidth: n,
      decodedHeight: m,
      // The control's grid is chosen from the byte budget and is what a
      // consumer would be shipped, so it is a genuine declaration.
      intrinsicSize: { kind: "declared", width: n, height: m },
      encodeTimeMs,
      decodeTimeMs,
      dataUri,
      ...scores,
    };
  }
}

/** Pack RGBA (alpha ignored — pre-flattened) into big-endian RGB565 words. */
function packRgb565(rgba: Uint8Array): Uint8Array {
  const pixelCount = rgba.length / 4;
  const out = new Uint8Array(pixelCount * BYTES_PER_PIXEL);
  for (let p = 0; p < pixelCount; p++) {
    const r5 = (rgba[p * 4] ?? 0) >> 3;
    const g6 = (rgba[p * 4 + 1] ?? 0) >> 2;
    const b5 = (rgba[p * 4 + 2] ?? 0) >> 3;
    const word = (r5 << 11) | (g6 << 5) | b5;
    out[p * 2] = word >> 8;
    out[p * 2 + 1] = word & 0xff;
  }
  return out;
}

/** Unpack big-endian RGB565 words to opaque RGBA, bit-replicating to 8 bits. */
function unpackRgb565(packed: Uint8Array): Uint8Array {
  const pixelCount = packed.length / BYTES_PER_PIXEL;
  const out = new Uint8Array(pixelCount * 4);
  for (let p = 0; p < pixelCount; p++) {
    const word = ((packed[p * 2] ?? 0) << 8) | (packed[p * 2 + 1] ?? 0);
    const r5 = (word >> 11) & 0x1f;
    const g6 = (word >> 5) & 0x3f;
    const b5 = word & 0x1f;
    out[p * 4] = (r5 << 3) | (r5 >> 2);
    out[p * 4 + 1] = (g6 << 2) | (g6 >> 4);
    out[p * 4 + 2] = (b5 << 3) | (b5 >> 2);
    out[p * 4 + 3] = 255;
  }
  return out;
}
