/**
 * Content-pinning for the downloaded corpus.
 *
 * Both fixture sets are fetched from the network and cached under `fixtures/`.
 * Before this module they were fetched best-effort: a 404, a truncated body or
 * a silently re-encoded upstream asset just dropped an image from the run, and
 * every corpus mean shifted without a word in the log. Means over "whatever
 * downloaded" are not comparable across runs or machines, which makes every
 * number in `spec/EXPERIMENTS.md` unreproducible.
 *
 * So each fixture carries a SHA-256 of its exact bytes, verified on every load
 * — cached or freshly fetched. Any deviation is fatal.
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";

/** Lowercase hex SHA-256 of a buffer. */
export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** One content-pinned corpus fixture. */
export interface PinnedFixture {
  /** Absolute path of the cached file. */
  filePath: string;
  /** Source URL to fetch from when the file is not cached. */
  url: string;
  /** Expected lowercase-hex SHA-256 of the file's exact bytes. */
  sha256: string;
  /** Human label used in error messages. */
  label: string;
}

/**
 * Thrown when the corpus on disk is not the corpus the constants were measured
 * on. Never caught inside this module: a shifted corpus invalidates the run.
 */
export class CorpusPinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusPinError";
  }
}

/**
 * Load one pinned fixture: reuse the cache when its digest matches, otherwise
 * fetch and verify before writing. Throws on a fetch failure or a digest
 * mismatch — never returns a file whose bytes are not the pinned ones.
 *
 * @returns true when the file had to be downloaded.
 */
export async function ensurePinnedFixture(
  fixture: PinnedFixture,
): Promise<boolean> {
  const { filePath, url, label } = fixture;
  const want = fixture.sha256.toLowerCase();

  let cached: Buffer | null = null;
  try {
    cached = await fs.readFile(filePath);
  } catch {
    cached = null;
  }

  if (cached !== null) {
    const got = sha256(cached);
    if (got === want) return false;
    throw new CorpusPinError(
      [
        `corpus fixture ${label} does not match its pin.`,
        `  file:     ${filePath}`,
        `  expected: ${want}`,
        `  actual:   ${got}`,
        "  The cached bytes are not the ones the corpus statistics were measured on.",
        "  Delete the file to re-fetch, or — if upstream genuinely changed — update the",
        "  pinned digest in src/natural-images.ts / src/holdout-images.ts deliberately",
        "  and re-measure every affected sweep.",
      ].join("\n"),
    );
  }

  let body: Buffer;
  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    body = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    throw new CorpusPinError(
      [
        `corpus fixture ${label} could not be fetched from ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "  Refusing to continue with a partial corpus — every reported mean would shift.",
      ].join("\n"),
    );
  }

  const got = sha256(body);
  if (got !== want) {
    throw new CorpusPinError(
      [
        `corpus fixture ${label} downloaded from ${url} does not match its pin.`,
        `  expected: ${want}`,
        `  actual:   ${got}`,
        "  Upstream served different bytes. Update the pin deliberately and re-measure;",
        "  do not silently score against a different image.",
      ].join("\n"),
    );
  }

  await fs.writeFile(filePath, body);
  return true;
}
