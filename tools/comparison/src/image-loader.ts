import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import type { ImageInput } from "./types.ts";

/**
 * Long-edge cap (px) for the display-resolution metric reference. Placeholders
 * are judged at the size they are displayed, so quality is scored against the
 * original at (up to) this resolution rather than against the tiny encoder
 * input. 512 keeps the perceptual metrics (butteraugli/ssimulacra2) tractable
 * across the corpus; natural sources are ~5000 px, synthetic fixtures smaller.
 */
export const REFERENCE_CAP = 512;

/**
 * Load an image file, downscale to fit within 100x100 for encoding, and decode
 * a display-resolution reference (REFERENCE_CAP long edge) for scoring.
 */
export async function loadImage(filePath: string): Promise<ImageInput> {
  const fileBuffer = await fs.readFile(filePath);
  const image = sharp(fileBuffer);
  const metadata = await image.metadata();

  const originalWidth = metadata.width ?? 0;
  const originalHeight = metadata.height ?? 0;

  if (originalWidth === 0 || originalHeight === 0) {
    throw new Error(`Could not read dimensions from ${filePath}`);
  }

  // Downscale to fit within 100x100 preserving aspect ratio
  const scale = Math.min(100 / originalWidth, 100 / originalHeight, 1);
  const smallWidth = Math.max(1, Math.round(originalWidth * scale));
  const smallHeight = Math.max(1, Math.round(originalHeight * scale));

  const { data, info } = await sharp(fileBuffer)
    .resize(smallWidth, smallHeight, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Display-resolution reference: the original capped to REFERENCE_CAP on the
  // long edge (Lanczos3, never enlarged). This is the scoring target.
  const refScale = Math.min(
    REFERENCE_CAP / originalWidth,
    REFERENCE_CAP / originalHeight,
    1,
  );
  const referenceWidth = Math.max(1, Math.round(originalWidth * refScale));
  const referenceHeight = Math.max(1, Math.round(originalHeight * refScale));
  const { data: refData, info: refInfo } = await sharp(fileBuffer)
    .resize(referenceWidth, referenceHeight, {
      kernel: "lanczos3",
      fit: "fill",
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    filePath: path.resolve(filePath),
    originalWidth,
    originalHeight,
    smallWidth: info.width,
    smallHeight: info.height,
    smallRgba: new Uint8Array(data),
    referenceWidth: refInfo.width,
    referenceHeight: refInfo.height,
    referenceRgba: new Uint8Array(refData),
    fileBuffer,
  };
}

/**
 * Convert raw RGBA pixel data to a PNG data URI via sharp.
 *
 * `icc` optionally embeds a named ICC profile (e.g. `"p3"`) *without* converting
 * the pixels — it tags bytes that are already encoded in that gamut so a
 * color-managed (wide-gamut) viewer renders them correctly. Used for ChromaHash
 * previews decoded to a wide-gamut display target.
 */
export async function rgbaToDataUri(
  rgba: Uint8Array,
  width: number,
  height: number,
  icc?: string,
): Promise<string> {
  let pipeline = sharp(Buffer.from(rgba), {
    raw: { width, height, channels: 4 },
  });
  if (icc) {
    pipeline = pipeline.withMetadata({ icc });
  }
  const png = await pipeline.png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Create a display-sized JPEG data URI from an image file buffer.
 * Resizes to fit within maxDim×maxDim to keep the report size reasonable.
 */
export async function fileBufferToDisplayDataUri(
  fileBuffer: Buffer,
  maxDim = 600,
): Promise<string> {
  const jpg = await sharp(fileBuffer)
    .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

/** Map an image mime type to a file extension. */
function mimeToExt(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    default:
      // Fall back to the subtype (e.g. "image/svg+xml" -> "svg+xml").
      return mime.includes("/") ? mime.slice(mime.indexOf("/") + 1) : "bin";
  }
}

/**
 * Decode a `data:<mime>;base64,<payload>` URI into its raw bytes and a matching
 * file extension. Throws if the string is not a base64 data URI.
 */
export function dataUriToBuffer(dataUri: string): {
  buffer: Buffer;
  ext: string;
} {
  const comma = dataUri.indexOf(",");
  if (!dataUri.startsWith("data:") || comma === -1) {
    throw new Error("Not a base64 data URI");
  }
  const header = dataUri.slice(5, comma); // between "data:" and ","
  if (!header.includes(";base64")) {
    throw new Error("Data URI is not base64-encoded");
  }
  const mime = header.slice(0, header.indexOf(";"));
  const buffer = Buffer.from(dataUri.slice(comma + 1), "base64");
  return { buffer, ext: mimeToExt(mime) };
}

/**
 * Write a base64 data URI to `<dir>/<baseName>.<ext>` as a standalone file.
 * The extension is derived from the URI's mime type. Returns the written
 * file name (relative to `dir`) and its byte size.
 */
export async function writeImageFile(
  dataUri: string,
  dir: string,
  baseName: string,
): Promise<{ fileName: string; byteSize: number }> {
  const { buffer, ext } = dataUriToBuffer(dataUri);
  const fileName = `${baseName}.${ext}`;
  await fs.writeFile(path.join(dir, fileName), buffer);
  return { fileName, byteSize: buffer.length };
}
