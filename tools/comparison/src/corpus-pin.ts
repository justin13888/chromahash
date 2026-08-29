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
/**
 * User-Agent sent with every fixture fetch.
 *
 * Wikimedia — where the alpha and graphics corpora live — returns 429 to
 * clients that do not identify themselves, and its policy requires a
 * descriptive agent with a contact URL. Node's `fetch` sends none by default,
 * which is how a corpus fetch fails on a machine that has never seen it fail.
 */
const USER_AGENT =
  "chromahash-comparison/0.7 (https://github.com/visualcommons/chromahash) node-fetch";

/** Retry schedule, in milliseconds, for a throttled or transiently failing host. */
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 20_000];

/**
 * Cap on a server-supplied `Retry-After`. Wikimedia may legally answer a 429
 * with `Retry-After: 3600`, and fixtures are fetched serially — honouring that
 * literally would stall a 24-image corpus for a day. Past this the run should
 * fail and be retried later rather than appear to hang.
 */
const MAX_RETRY_AFTER_MS = 60_000;

/** Status codes worth retrying: explicit throttling and transient server errors. */
function isRetryable(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/**
 * Fetch a fixture, backing off on throttling.
 *
 * Corpora are fetched as a burst of a few dozen files from one host, which is
 * exactly the shape that trips a rate limiter. Honouring `Retry-After` and
 * backing off is the difference between a reproducible corpus and one that
 * depends on how busy the host was.
 */
async function fetchWithRetry(url: string): Promise<Buffer> {
  let lastError = "";
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": USER_AGENT },
      });
    } catch (err) {
      // A dropped connection is exactly what a retry is for. With this outside
      // the loop an HTTP 503 got five attempts and an ECONNRESET got none,
      // which inverts the purpose of the retry.
      lastError = err instanceof Error ? err.message : String(err);
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      console.warn(
        `  ${lastError} fetching ${url} — retrying in ${delay / 1000}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }

    if (response.ok) {
      try {
        return Buffer.from(await response.arrayBuffer());
      } catch (err) {
        // The body can fail mid-stream; that is transient too.
        lastError = err instanceof Error ? err.message : String(err);
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
    }

    lastError = `HTTP ${response.status} ${response.statusText}`;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined || !isRetryable(response.status)) break;

    // A server-supplied Retry-After wins over the schedule when it is longer,
    // but only up to MAX_RETRY_AFTER_MS.
    const after = Number.parseInt(
      response.headers.get("retry-after") ?? "",
      10,
    );
    const waitMs = Number.isFinite(after)
      ? Math.min(Math.max(delay, after * 1000), MAX_RETRY_AFTER_MS)
      : delay;
    console.warn(
      `  ${lastError} fetching ${url} — retrying in ${Math.round(waitMs / 1000)}s`,
    );
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  throw new Error(lastError);
}

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
        "  pinned digest in the corresponding src/*-images.ts deliberately",
        "  and re-measure every affected sweep.",
      ].join("\n"),
    );
  }

  let body: Buffer;
  try {
    body = await fetchWithRetry(url);
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
