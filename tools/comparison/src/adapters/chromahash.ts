import { execFileSync } from "node:child_process";
import path from "node:path";
import { rgbaToDataUri } from "../image-loader.ts";
import { computeAllMetrics } from "../metrics.ts";
import type { FormatAdapter, FormatResult, ImageInput } from "../types.ts";

const ROOT = path.resolve(import.meta.dirname, "../../../..");
// Release build: published timings must not measure debug-profile overhead.
// Exported for the sweep runner and codebook trainer, which drive the same
// binary with CHROMAHASH_TUNE overrides.
export const RUST_CLI = path.join(
  ROOT,
  "rust/target/release/examples/encode_stdin",
);

const GAMUT_MAP: Record<string, string> = {
  srgb: "srgb",
  displayp3: "displayp3",
  adobergb: "adobergb",
  bt2020: "bt2020",
  prophoto: "prophoto",
};

/** Env for a chromahash subprocess: quality tier + optional TUNE overrides. */
function rustEnv(tier: number, tune?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CHROMAHASH_TIER: String(tier),
  };
  // Never inherit a stray TUNE from the shell — a silent override would
  // corrupt every non-sweep result. (undefined-valued keys are dropped by
  // child_process.)
  env.CHROMAHASH_TUNE = tune;
  return env;
}

export function encodeViaRust(
  binary: string,
  w: number,
  h: number,
  rgba: Uint8Array,
  gamut: string,
  tier: number,
  tune?: string,
): Uint8Array {
  const output = execFileSync(binary, ["encode", String(w), String(h), gamut], {
    input: Buffer.from(rgba),
    encoding: "buffer",
    timeout: 30_000,
    // The quality tier is read from the environment (decode recovers it from the
    // hash, so only encode needs it).
    env: rustEnv(tier, tune),
  });
  return new Uint8Array(output);
}

/**
 * Dump the encoder's scale-normalized AC coefficients per channel group
 * (`dump-coeffs` subcommand). Used by the codebook trainer on the tune split.
 */
export function dumpCoefficientsViaRust(
  binary: string,
  w: number,
  h: number,
  rgba: Uint8Array,
  gamut: string,
  tier: number,
): { l: number[]; a: number[]; b: number[]; alpha: number[] } {
  const output = execFileSync(
    binary,
    ["dump-coeffs", String(w), String(h), gamut],
    {
      input: Buffer.from(rgba),
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
      env: rustEnv(tier),
    },
  );
  const dump: { l: number[]; a: number[]; b: number[]; alpha: number[] } = {
    l: [],
    a: [],
    b: [],
    alpha: [],
  };
  for (const line of output.split("\n")) {
    if (!line) continue;
    const space = line.indexOf(" ");
    const group = line.slice(0, space) as keyof typeof dump;
    const value = Number.parseFloat(line.slice(space + 1));
    if (dump[group] && Number.isFinite(value)) {
      dump[group].push(value);
    }
  }
  return dump;
}

/**
 * Display gamuts ChromaHash can decode *to*, paired with the named ICC profile
 * to tag the preview with so a color-managed viewer renders it correctly.
 * sharp ships sRGB and P3 profiles; other source gamuts (Adobe RGB, BT.2020,
 * ProPhoto) preview in sRGB — the decoder falls back to sRGB for them anyway.
 */
const PREVIEW_OUTPUT: Record<string, { out: string; icc?: string }> = {
  displayp3: { out: "displayp3", icc: "p3" },
};

export function decodeViaRust(
  binary: string,
  hash: Uint8Array,
  outGamut: string,
  maxW?: number,
  maxH?: number,
  tune?: string,
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
    env: { ...rustEnv(0, tune), CHROMAHASH_OUT: outGamut },
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
  /** Quality tier (0..=3); higher tiers carry more detail in more bytes. */
  private readonly tier: number;
  /** Time via in-process bench subcommands (true) or spawn loops (false). */

  /**
   * @param opts.name        Display name (default "ChromaHash").
   * @param opts.binaryPath  Version-specific `encode_stdin` binary (default: the
   *   working tree's release build). A version must encode and decode with the same
   *   binary — hashes are not portable across format versions (header bit 47).
   * @param opts.capToSource Cap decode to source dims (default true). The version
   *   report decodes uncapped (false) so every build is framed identically — the
   *   oldest tags lack capped-decode support, and metrics resample to source anyway.
   */
  constructor(opts?: {
    name?: string;
    binaryPath?: string;
    capToSource?: boolean;
    tier?: number;
  }) {
    this.name = opts?.name ?? "ChromaHash";
    this.binaryPath = opts?.binaryPath ?? RUST_CLI;
    this.capToSource = opts?.capToSource ?? true;
    this.tier = opts?.tier ?? 0;
  }

  async process(input: ImageInput): Promise<FormatResult> {
    const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;
    const gamut = GAMUT_MAP[input.gamut ?? "srgb"] ?? "srgb";
    const bin = this.binaryPath;

    // Encode once to get the result bytes, then time the operation.
    const encoded = encodeViaRust(bin, w, h, rgba, gamut, this.tier);

    const encodedSizeBytes = encoded.length;

    // Decode capped to the encoder-input dims (never upscaling past the source,
    // and never synthesising detail beyond it); `computeAllMetrics` upscales
    // every format's decode to the display-resolution reference for scoring.
    const capW = this.capToSource ? w : undefined;
    const capH = this.capToSource ? h : undefined;
    // Metrics are always scored in sRGB against the color-managed sRGB reference,
    // so the cross-format comparison stays apples-to-apples.
    const decoded = decodeViaRust(bin, encoded, "srgb", capW, capH);
    const capArgs =
      capW !== undefined && capH !== undefined
        ? [String(capW), String(capH)]
        : [];

    const { w: dw, h: dh, rgba: decodedRgba } = decoded;

    // The size ChromaHash *declares*, which is not necessarily the size decoded
    // above. `decode_capped_to_with` caps per axis (`nat_w.min(max_w)`), so once
    // the natural grid exceeds the encoder input the decode reports the cap --
    // i.e. this harness's own downscale of the source. On a 3:2 photo the t3 and
    // t4 columns come back as the input's 100x67 rather than the format's shape,
    // and an aspect error derived from that would read ~0 for precisely the
    // tiers whose layout precision is being questioned.
    //
    // A second, uncapped decode is the honest source. It is only needed when
    // capping could have bitten: if both decoded edges came in strictly under
    // the cap, neither `min` bound and the decode already is the natural size.
    // That short-circuit skips the extra spawn for the low tiers, which is most
    // of the lineup.
    //
    // Asking the binary rather than reimplementing `decodeOutputSize` in TS
    // keeps the Rust core the single source of truth, as `gamut.ts` and
    // `iqa.ts` already do -- and `decode` with no cap args is a subcommand every
    // released tag understands, so `--versions` mode keeps working.
    const cappedOut =
      capW !== undefined && capH !== undefined && (dw >= capW || dh >= capH);
    const natural = cappedOut ? decodeViaRust(bin, encoded, "srgb") : decoded;

    // Preview: decode to the source display gamut where ChromaHash supports it
    // (Display P3), and tag it with that ICC profile so a wide-gamut viewer shows
    // the true saturated color. Other gamuts preview in sRGB (decoder fallback).
    const preview = PREVIEW_OUTPUT[gamut];
    const previewDecode = preview
      ? decodeViaRust(bin, encoded, preview.out, capW, capH)
      : decoded;
    const dataUri = await rgbaToDataUri(
      previewDecode.rgba,
      previewDecode.w,
      previewDecode.h,
      preview?.icc,
    );

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
      dataUri,
      ...scores,
      intrinsicSize: { kind: "declared", width: natural.w, height: natural.h },
    };
  }
}
