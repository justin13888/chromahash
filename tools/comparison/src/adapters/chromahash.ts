import { execFileSync } from "node:child_process";
import path from "node:path";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { rgbaToDataUri } from "../image-loader.ts";
import { computeAllMetrics, timeMs } from "../metrics.ts";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
const RUST_CLI = path.join(ROOT, "rust/target/debug/examples/encode_stdin");

const GAMUT_MAP: Record<string, string> = {
  srgb: "srgb",
  displayp3: "displayp3",
  adobergb: "adobergb",
  bt2020: "bt2020",
  prophoto: "prophoto",
};

function encodeViaRust(
  binary: string,
  w: number,
  h: number,
  rgba: Uint8Array,
  gamut: string,
): Uint8Array {
  const output = execFileSync(binary, ["encode", String(w), String(h), gamut], {
    input: Buffer.from(rgba),
    encoding: "buffer",
    timeout: 30_000,
  });
  return new Uint8Array(output);
}

function decodeViaRust(
  binary: string,
  hash: Uint8Array,
  maxW?: number,
  maxH?: number,
): {
  w: number;
  h: number;
  rgba: Uint8Array;
} {
  const extraArgs =
    maxW !== undefined && maxH !== undefined
      ? [String(maxW), String(maxH)]
      : [];
  const output = execFileSync(binary, ["decode", ...extraArgs], {
    input: Buffer.from(hash),
    encoding: "buffer",
    timeout: 30_000,
  });
  const newline = output.indexOf(0x0a);
  const header = output.subarray(0, newline).toString("ascii");
  const parts = header.split(" ");
  const w = Number.parseInt(parts[0] ?? "0", 10);
  const h = Number.parseInt(parts[1] ?? "0", 10);
  const rgba = new Uint8Array(output.subarray(newline + 1));
  return { w, h, rgba };
}

export class ChromaHashAdapter implements FormatAdapter {
  readonly name: string;
  /** The `encode_stdin` binary used to both encode and decode. */
  private readonly binaryPath: string;
  /** Cap the decode to source dims (true), or decode uncapped (false). */
  private readonly capToSource: boolean;

  /**
   * @param opts.name        Display name (default "ChromaHash").
   * @param opts.binaryPath  Version-specific `encode_stdin` binary (default: the
   *   working tree's debug build). A version must encode and decode with the same
   *   binary — hashes are not portable across format versions (header bit 47).
   * @param opts.capToSource Cap decode to source dims (default true). The version
   *   report decodes uncapped (false) so every build is framed identically — the
   *   oldest tags lack capped-decode support, and metrics resample to source anyway.
   */
  constructor(opts?: {
    name?: string;
    binaryPath?: string;
    capToSource?: boolean;
  }) {
    this.name = opts?.name ?? "ChromaHash";
    this.binaryPath = opts?.binaryPath ?? RUST_CLI;
    this.capToSource = opts?.capToSource ?? true;
  }

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;
    const gamut = GAMUT_MAP[input.gamut ?? "srgb"] ?? "srgb";
    const bin = this.binaryPath;

    // Encode once to get result, then time the operation
    const encoded = encodeViaRust(bin, w, h, rgba, gamut);
    const encodeTimeMs = await timeMs(() => {
      encodeViaRust(bin, w, h, rgba, gamut);
    }, iterations);

    const encodedSizeBytes = encoded.length;

    // Decode (capped to source dims so metrics are computed at source resolution,
    // which avoids penalising ChromaHash for synthesising detail beyond the source).
    // `computeAllMetrics` resamples the decode to source either way.
    const capW = this.capToSource ? w : undefined;
    const capH = this.capToSource ? h : undefined;
    const decoded = decodeViaRust(bin, encoded, capW, capH);
    const decodeTimeMs = await timeMs(() => {
      decodeViaRust(bin, encoded, capW, capH);
    }, iterations);

    const { w: dw, h: dh, rgba: decodedRgba } = decoded;
    const dataUri = await rgbaToDataUri(decodedRgba, dw, dh);
    const reference = input.metricReferenceRgba ?? rgba;
    const metrics = await computeAllMetrics(
      reference,
      w,
      h,
      decodedRgba,
      dw,
      dh,
    );

    return {
      formatName: this.name,
      encodedSizeBytes,
      decodedWidth: dw,
      decodedHeight: dh,
      encodeTimeMs,
      decodeTimeMs,
      dataUri,
      metrics,
    };
  }
}
