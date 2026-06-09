/** Represents a loaded and downscaled image ready for encoding. */
export interface ImageInput {
  /** Original file path. */
  filePath: string;
  /** Original image width. */
  originalWidth: number;
  /** Original image height. */
  originalHeight: number;
  /** Downscaled width (<=100px). */
  smallWidth: number;
  /** Downscaled height (<=100px). */
  smallHeight: number;
  /** Downscaled raw RGBA pixel data. */
  smallRgba: Uint8Array;
  /** Original file as a Buffer. */
  fileBuffer: Buffer;
  /** Source gamut identifier (e.g. "srgb", "displayp3"). */
  gamut?: string;
}

/**
 * Per-format quality metrics, computed by `iqa-cli` between the decoded preview
 * and the encoder input, both resampled to identical (source) dimensions.
 * All fields are null for CSS-only formats (e.g. unpic) or when iqa-cli is unavailable.
 */
export interface MetricResult {
  /**
   * Primary metric: mean CIEDE2000 (ΔE00) color difference over sRGB→CIELAB (D65).
   * Lower is better; ΔE00 JND ≈ 1.
   */
  ciede2000: number | null;
  /** DSSIM = (1 - SSIM) / 2. Lower is better; 0 = identical. */
  dssim: number | null;
  /** Multi-scale SSIM. Higher is better; 1 = identical. */
  msSsim: number | null;
  /** PSNR-HVS-M (DCT-domain PSNR with CSF + contrast masking), in dB. Higher is better. */
  psnrHvsM: number | null;
  /** SSIMULACRA2 perceptual score. Higher is better (100 = identical). */
  ssimulacra2: number | null;
  /** Butteraugli distance. Lower is better; 0 = identical. */
  butteraugli: number | null;
  /** Classic PSNR in dB. Higher is better; reference only (weak LQIP correlation). */
  psnrDb: number | null;
}

/** Result of encoding/decoding with a particular format. */
export interface FormatResult {
  /** Name of the LQIP format. */
  formatName: string;
  /** Size of the encoded representation in bytes. */
  encodedSizeBytes: number;
  /** Width of the decoded preview image. */
  decodedWidth: number;
  /** Height of the decoded preview image. */
  decodedHeight: number;
  /** Average encode time in milliseconds. */
  encodeTimeMs: number;
  /** Average decode time in milliseconds. */
  decodeTimeMs: number;
  /** Base64 PNG data URI for HTML embedding. */
  dataUri: string;
  /** Quality metrics (all null for CSS-only formats like unpic). */
  metrics: MetricResult;
}

/** An adapter that processes an image through a specific LQIP format. */
export interface FormatAdapter {
  /** Display name of the format. */
  readonly name: string;
  /** Process an image and return the format result. */
  process(input: ImageInput, iterations: number): Promise<FormatResult>;
}

/** Result from a per-language CLI harness. */
export interface HarnessResult {
  /** Language name (e.g. "Rust", "TypeScript"). */
  language: string;
  /** The 32-byte hash produced by this implementation. */
  hash: Uint8Array;
  /** Whether this hash matches the reference (Rust) hash. */
  matches: boolean;
  /** Decoded preview as a base64 PNG data URI. */
  dataUri: string;
}

/** Category for grouping images in the report. */
export type ImageCategory =
  | "Dimensions"
  | "Alpha"
  | "Color Distribution"
  | "Quantization"
  | "Gamut"
  | "Natural"
  | "Realistic";
