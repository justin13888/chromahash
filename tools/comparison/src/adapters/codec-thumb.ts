import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { rgbaToDataUri } from "../image-loader.ts";
import { ALPHA_BACKDROP, timeMs } from "../metrics.ts";
import {
  BudgetUnrepresentableError,
  findCodecVariantForBudget,
  QUALITY_MIN,
} from "../rd/byte-target.ts";

/** Codecs the equal-byte baseline can target. */
export type ThumbCodec = "webp" | "avif" | "jpeg" | "jxl";

const CODEC_LABEL: Record<ThumbCodec, string> = {
  webp: "WebP",
  avif: "AVIF",
  jpeg: "JPEG",
  jxl: "JXL",
};

/** Subprocess timeout for the cjxl/djxl CLI tools. */
const JXL_TIMEOUT_MS = 60_000;

/**
 * Whether the system `cjxl`/`djxl` CLIs are on PATH. sharp has no JXL support,
 * so the JXL baseline shells out; callers skip constructing the adapter when
 * this returns false.
 */
export function isJxlAvailable(): boolean {
  for (const tool of ["cjxl", "djxl"]) {
    try {
      execFileSync(tool, ["--version"], {
        encoding: "utf8",
        timeout: JXL_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return false;
    }
  }
  return true;
}

/** Run cjxl on a PNG buffer, returning the encoded JXL bytes. */
function cjxlEncode(png: Buffer, quality: number): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "chromahash-jxl-"));
  try {
    const inPath = path.join(dir, "in.png");
    const outPath = path.join(dir, "out.jxl");
    writeFileSync(inPath, png);
    execFileSync("cjxl", [inPath, outPath, "-q", String(quality), "--quiet"], {
      timeout: JXL_TIMEOUT_MS,
      stdio: ["ignore", "ignore", "pipe"],
    });
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Run djxl on JXL bytes, returning the decoded PNG bytes. */
function djxlDecode(jxl: Buffer): Buffer {
  const dir = mkdtempSync(path.join(tmpdir(), "chromahash-jxl-"));
  try {
    const inPath = path.join(dir, "in.jxl");
    const outPath = path.join(dir, "out.png");
    writeFileSync(inPath, jxl);
    execFileSync("djxl", [inPath, outPath, "--quiet"], {
      timeout: JXL_TIMEOUT_MS,
      stdio: ["ignore", "ignore", "pipe"],
    });
    return readFileSync(outPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Equal-byte codec baseline: "what if the placeholder were just a tiny WebP /
 * JPEG / AVIF / JXL file?" For a byte target, the ≤100px encoder input is
 * downscaled (Lanczos-3) across a dimension ladder and the encoder quality is
 * binary-searched per dimension for the largest encoding that fits; the best
 * fitting variant by ΔE00 becomes this format's result (see rd/byte-target.ts).
 * The reported size is the actual file bytes — container overhead included,
 * which is exactly the point of the comparison.
 */
export class CodecThumbAdapter implements FormatAdapter {
  readonly name: string;
  private readonly codec: ThumbCodec;
  private readonly targetBytes: number;
  private readonly floorFallback: boolean;

  /**
   * @param floorFallback When the budget is unrepresentable, encode at the
   *   codec's smallest possible output instead of failing. At LQIP budgets this
   *   is the *interesting* answer rather than an error: no real codec reaches
   *   32 bytes (AVIF's floor is ~465 B), and a column of N/A says that far less
   *   clearly than a row showing what the smallest possible AVIF actually
   *   scores. The row's mean-size column then reports the real byte count, so
   *   the comparison stays honest about not being equal-budget.
   */
  constructor(codec: ThumbCodec, targetBytes: number, floorFallback = false) {
    this.codec = codec;
    this.targetBytes = targetBytes;
    this.floorFallback = floorFallback;
    // `(min)` is only truthful when the budget is genuinely unreachable for
    // this codec, which the caller decides — see `main.ts`. Enabling the
    // fallback at a budget the codec *can* hit would label an equal-budget
    // result as a floor.
    this.name = floorFallback
      ? `${CODEC_LABEL[codec]} (min)`
      : `${CODEC_LABEL[codec]}@${targetBytes}B`;
  }

  /** Downscale the encoder input to `longEdge` and encode it at `quality`. */
  private async encodeAt(
    input: ImageInput,
    longEdge: number,
    quality: number,
  ): Promise<Buffer> {
    let pipeline = sharp(Buffer.from(input.smallRgba), {
      raw: { width: input.smallWidth, height: input.smallHeight, channels: 4 },
    }).resize(longEdge, longEdge, { fit: "inside", kernel: "lanczos3" });
    switch (this.codec) {
      case "webp":
        return pipeline.webp({ quality }).toBuffer();
      case "avif":
        return pipeline.avif({ quality }).toBuffer();
      case "jpeg":
        // JPEG has no alpha; flatten over the scoring backdrop rather than
        // sharp's default black so alpha semantics match the metrics.
        pipeline = pipeline.flatten({
          background: {
            r: ALPHA_BACKDROP[0],
            g: ALPHA_BACKDROP[1],
            b: ALPHA_BACKDROP[2],
          },
        });
        return pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
      case "jxl": {
        const png = await pipeline.png().toBuffer();
        return cjxlEncode(png, quality);
      }
    }
  }

  /** Decode encoded bytes back to RGBA. */
  private async decode(
    data: Buffer,
  ): Promise<{ rgba: Uint8Array; width: number; height: number }> {
    const bytes = this.codec === "jxl" ? djxlDecode(data) : data;
    const { data: raw, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      rgba: new Uint8Array(raw),
      width: info.width,
      height: info.height,
    };
  }

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const reference = input.metricReferenceRgba ?? input.referenceRgba;
    const maxLongEdge = Math.max(input.smallWidth, input.smallHeight);
    const encodeAt = (longEdge: number, quality: number) =>
      this.encodeAt(input, longEdge, quality);

    let chosen = await findCodecVariantForBudget(encodeAt, this.targetBytes, {
      decode: (data) => this.decode(data),
      referenceRgba: reference,
      referenceWidth: input.referenceWidth,
      referenceHeight: input.referenceHeight,
      maxLongEdge,
    });
    if (chosen === null && this.floorFallback) {
      // Re-target the search at the codec's actual floor: the smallest rung of
      // the dimension ladder at minimum quality. Passing an unbounded budget
      // instead would make `maxQualityWithinBudget` short-circuit to
      // QUALITY_MAX and return the *largest* output at that size — the opposite
      // of a floor, and 2.5x too big in practice.
      const floorLongEdge = Math.min(4, maxLongEdge);
      const floorBytes = (await encodeAt(floorLongEdge, QUALITY_MIN)).length;
      chosen = await findCodecVariantForBudget(encodeAt, floorBytes, {
        maxLongEdge,
        referenceRgba: reference,
        referenceWidth: input.referenceWidth,
        referenceHeight: input.referenceHeight,
        decode: (buf) => this.decode(buf),
        dimLadder: [floorLongEdge],
      });
    }
    if (chosen === null) {
      // Report the codec's byte floor so the failure message is diagnostic.
      const floor = (await encodeAt(Math.min(4, maxLongEdge), QUALITY_MIN))
        .length;
      throw new BudgetUnrepresentableError(this.name, this.targetBytes, floor);
    }

    const encodeTimeMs = await timeMs(async () => {
      await encodeAt(chosen.longEdge, chosen.quality);
    }, iterations);
    const decodeTimeMs = await timeMs(async () => {
      await this.decode(chosen.data);
    }, iterations);

    const dataUri = await rgbaToDataUri(
      chosen.decodedRgba,
      chosen.decodedWidth,
      chosen.decodedHeight,
    );

    return {
      formatName: this.name,
      encodedSizeBytes: chosen.data.length,
      decodedWidth: chosen.decodedWidth,
      decodedHeight: chosen.decodedHeight,
      encodeTimeMs,
      decodeTimeMs,
      dataUri,
      ...chosen.scores,
    };
  }
}
