import type { CorpusSplit } from "./corpus.ts";

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
  /** Downscaled raw RGBA pixel data (the encoder input). */
  smallRgba: Uint8Array;
  /**
   * Display-resolution reference width (original capped to REFERENCE_CAP px on
   * the long edge). Quality is judged at this scale — the resolution a
   * placeholder is actually shown at — not at the encoder-input scale.
   */
  referenceWidth: number;
  /** Display-resolution reference height. */
  referenceHeight: number;
  /** Display-resolution reference RGBA (original decoded at the capped size). */
  referenceRgba: Uint8Array;
  /** Original file as a Buffer. */
  fileBuffer: Buffer;
  /** Source gamut identifier (e.g. "srgb", "displayp3"). */
  gamut?: string;
  /**
   * Color-managed metric reference: referenceRgba converted from its tagged
   * gamut to sRGB appearance, at reference resolution. Metrics for every format
   * compare against this (not the raw gamut-encoded bytes). Equals
   * referenceRgba when gamut is sRGB.
   */
  metricReferenceRgba?: Uint8Array;
}

/**
 * Per-format quality metrics, computed by `iqa-cli` between the decoded preview
 * (upscaled to display resolution by the configured policy) and the
 * display-resolution reference. All fields are null for formats that produce no
 * raster output, or when running with --allow-missing-iqa.
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
  /**
   * "As-rendered" metrics: both sides Gaussian-blurred before scoring, modeling
   * the blur-up presentation LQIPs are typically displayed with. Null unless the
   * run enables --blurred-scoring.
   */
  metricsBlurred: MetricResult | null;
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
  | "Text/UI"
  | "Illustration"
  | "Natural"
  | "Portrait"
  | "Night"
  | "Realistic";

/** Per-format summary statistics, averaged across a set of images. */
export interface FormatStat {
  name: string;
  avgSize: number;
  avgEncode: number;
  avgDecode: number;
  /** Primary metric: mean CIEDE2000 ΔE00 (lower is better). */
  avgCiede: number | null;
  avgDssim: number | null;
  avgMsSsim: number | null;
  avgPsnrHvsM: number | null;
  avgSsimulacra2: number | null;
  avgButteraugli: number | null;
  avgPsnr: number | null;
  /** Mean blurred "as-rendered" ΔE00; null unless --blurred-scoring ran. */
  avgCiedeBlurred: number | null;
  /** Median ΔE00 across the set (robust to outlier images). */
  medianCiede: number | null;
  /** 90th-percentile ΔE00 — the tail behaviour a mean hides. */
  p90Ciede: number | null;
  /** 95% bootstrap confidence interval of the mean ΔE00 (see stats.ts). */
  ciCiede: [number, number] | null;
}

/**
 * A single format's encode/decode result as serialized into the JSON report.
 * Mirrors {@link FormatResult} but references the decoded preview by relative
 * file path instead of embedding it inline.
 */
export interface FormatJson {
  formatName: string;
  encodedSizeBytes: number;
  decodedWidth: number;
  decodedHeight: number;
  encodeTimeMs: number;
  decodeTimeMs: number;
  /** Relative path to the standalone preview image, or null for CSS-only formats. */
  preview: string | null;
  /** CSS gradient string for CSS-only formats (e.g. unpic), else null. */
  css: string | null;
  metrics: MetricResult;
  /** Blurred "as-rendered" metrics; null unless --blurred-scoring ran. */
  metricsBlurred: MetricResult | null;
}

/** A single language implementation's result as serialized into the JSON report. */
export interface ImplementationJson {
  language: string;
  /** Hex-encoded 32-byte hash, or "" if the harness errored. */
  hash: string;
  /** Whether this hash matches the reference (Rust) hash. */
  matches: boolean;
  /** Relative path to the standalone decoded preview, or null if the harness errored. */
  preview: string | null;
}

/** A single image's full comparison record as serialized into the JSON report. */
export interface ComparisonImageJson {
  name: string;
  category: ImageCategory;
  /** Corpus split (see corpus.ts) so downstream tools never re-derive it. */
  split: CorpusSplit;
  originalWidth: number;
  originalHeight: number;
  /** Relative path to the standalone original (display-sized) image. */
  original: string;
  /** Relative path to the standalone encoder-input (downscaled) image. */
  encoderInput: string;
  /** Encoder-input width (the resolution all formats encode from). */
  encoderInputWidth: number;
  /** Encoder-input height. */
  encoderInputHeight: number;
  formats: FormatJson[];
  implementations: ImplementationJson[];
}

/**
 * The full machine-readable comparison report. Written alongside the HTML and
 * referencing the same standalone images under `images/`.
 */
/** How the run scored quality — stamped into the JSON so results are interpretable. */
export interface ScoringMetaJson {
  /** Long-edge cap (px) of the display-resolution reference. */
  referenceCap: number;
  /** Upscale policy used to bring decodes to reference resolution. */
  upscalePolicy: string;
  /** Whether the blurred "as-rendered" metric set was computed. */
  blurredScoring: boolean;
  /** Gaussian sigma rule for blurred scoring (informational). */
  blurSigmaRule: string;
  /** Backdrop RGB both sides are composited over before scoring. */
  alphaBackdrop: [number, number, number];
}

/**
 * One point on a rate–distortion curve: a single variant (e.g. "ChromaHash t2",
 * "WebP@411B") aggregated as the MEAN over the images processed in the run.
 */
export interface RdPointJson {
  /** Variant name, unique within the run (doubles as the formatName). */
  variant: string;
  /** Mean encoded size in bytes across the processed images. */
  bytes: number;
  /** Mean ΔE00 (lower is better), or null when never computed. */
  ciede2000: number | null;
  /** Mean SSIMULACRA2 (higher is better), or null when never computed. */
  ssimulacra2: number | null;
  /** Mean Butteraugli distance (lower is better), or null when never computed. */
  butteraugli: number | null;
  /** How many images contributed (variants can be unrepresentable per-image). */
  imageCount: number;
}

/** A format family's rate–distortion curve (points sorted by mean bytes). */
export interface RdCurveJson {
  /** Family name the variants sweep (e.g. "ChromaHash", "BlurHash", "WebP"). */
  format: string;
  points: RdPointJson[];
}

/** Rate–distortion sweep results (present only in `--rd` runs). */
export interface RdJson {
  /** Canonical equal-byte anchors: the four ChromaHash tier sizes (no-alpha). */
  anchors: number[];
  curves: RdCurveJson[];
}

export interface ComparisonJson {
  /** Schema version, bumped on breaking changes to this structure. */
  schemaVersion: number;
  /** Pre-formatted generation timestamp (matches the HTML footer). */
  generatedAt: string;
  /** Scoring configuration for this run. */
  scoring: ScoringMetaJson;
  /** Full commit SHA the report was built from, or null when unknown. */
  commit: string | null;
  /** Base repository URL, or null. */
  repoUrl: string | null;
  /** LQIP format names, in report order. */
  formats: string[];
  /** Language implementation names, in report order. */
  languages: string[];
  /**
   * Summary statistics: photographic images (primary), all images, and the
   * tune/holdout corpus splits (see corpus.ts).
   */
  summary: {
    naturalAndRealistic: FormatStat[];
    all: FormatStat[];
    tune: FormatStat[];
    holdout: FormatStat[];
  };
  /** Cross-language pass/fail; pass is null when harnesses were skipped. */
  crossLanguage: { language: string; pass: boolean | null }[];
  images: ComparisonImageJson[];
  /** Rate–distortion sweep (only written by `--rd` runs). */
  rd?: RdJson;
}
