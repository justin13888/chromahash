import { execFileSync } from "node:child_process";
import path from "node:path";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";
import { rgbaToDataUri } from "../image-loader.ts";
import { computePsnr, timeMs } from "../metrics.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const RUST_CLI = path.join(ROOT, "rust/target/debug/examples/encode_stdin");

const GAMUT_MAP: Record<string, string> = {
  srgb: "srgb",
  displayp3: "displayp3",
  adobergb: "adobergb",
  bt2020: "bt2020",
  prophoto: "prophoto",
};

function encodeViaRust(
  w: number,
  h: number,
  rgba: Uint8Array,
  gamut: string,
): Uint8Array {
  const output = execFileSync(
    RUST_CLI,
    ["encode", String(w), String(h), gamut],
    { input: Buffer.from(rgba), encoding: "buffer", timeout: 30_000 },
  );
  return new Uint8Array(output);
}

function decodeViaRust(hash: Uint8Array): {
  w: number;
  h: number;
  rgba: Uint8Array;
} {
  const output = execFileSync(RUST_CLI, ["decode"], {
    input: Buffer.from(hash),
    encoding: "buffer",
    timeout: 30_000,
  });
  const newline = output.indexOf(0x0a);
  const header = output.subarray(0, newline).toString("ascii");
  const parts = header.split(" ");
  const w = parseInt(parts[0] ?? "0", 10);
  const h = parseInt(parts[1] ?? "0", 10);
  const rgba = new Uint8Array(output.subarray(newline + 1));
  return { w, h, rgba };
}

export class ChromaHashAdapter implements FormatAdapter {
  readonly name = "ChromaHash";

  async process(input: ImageInput, iterations: number): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;
    const gamut = GAMUT_MAP[input.gamut ?? "srgb"] ?? "srgb";

    // Encode once to get result, then time the operation
    const encoded = encodeViaRust(w, h, rgba, gamut);
    const encodeTimeMs = await timeMs(() => {
      encodeViaRust(w, h, rgba, gamut);
    }, iterations);

    const encodedSizeBytes = encoded.length;

    const decoded = decodeViaRust(encoded);
    const decodeTimeMs = await timeMs(() => {
      decodeViaRust(encoded);
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
