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

/** Per-format quality metrics. All fields are null for CSS-only formats (e.g. unpic). */
export interface MetricResult {
  /** PSNR in dB vs Lanczos-downscaled ground truth. Higher is better. */
  psnrDb: number | null;
  /** DSSIM = (1 - SSIM) / 2. Lower is better; 0 = identical. */
  dssim: number | null;
  /** Unweighted mean OKLAB ΔE. Lower is better; JND ≈ 0.02. */
  deltaEMean: number | null;
  /** Luminance-variance saliency-weighted mean OKLAB ΔE. Lower is better. */
  deltaEWeighted: number | null;
  /** 95th-percentile OKLAB ΔE. */
  deltaE95: number | null;
  /**
   * Composite quality score: 0.55·norm(DSSIM) + 0.45·norm(weighted ΔE).
   * Normalized per-image across raster formats (0 = best, 1 = worst).
   * Null until computeCompositeScores() is called.
   */
  compositeScore: number | null;
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
