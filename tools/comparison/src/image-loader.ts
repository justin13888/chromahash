import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import type { ImageInput } from "./types.ts";

/**
 * Load an image file and downscale to fit within 100x100 for encoding.
 * Returns both original metadata and downscaled pixel data.
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

  return {
    filePath: path.resolve(filePath),
    originalWidth,
    originalHeight,
    smallWidth: info.width,
    smallHeight: info.height,
    smallRgba: new Uint8Array(data),
    fileBuffer,
  };
}

/**
 * Convert raw RGBA pixel data to a PNG data URI via sharp.
 */
export async function rgbaToDataUri(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<string> {
  const png = await sharp(Buffer.from(rgba), {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}
