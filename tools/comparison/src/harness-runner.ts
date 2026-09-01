import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import type { HarnessResult, ImageInput } from "./types.ts";
import { rgbaToDataUri } from "./image-loader.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const RUST_CLI = path.join(ROOT, "rust/target/release/examples/encode_stdin");
// The C harness links the chromahash-c cdylib, which must be on the loader path.
const C_LIB_DIR = path.join(ROOT, "bindings/c/target/debug");
const C_HARNESS = path.join(ROOT, "bindings/c/target/encode_stdin");

/**
 * Decode a hash with the Rust reference binary.
 *
 * Async rather than `execFileSync`: this runs inside the concurrently-scored
 * image loop, and the synchronous form blocks the event loop, stalling every
 * other image for the duration of the spawn. Written out rather than
 * `promisify`d because the hash goes in over stdin, which `execFile`'s options
 * cannot express.
 */
function decodeViaRust(
  hash: Uint8Array,
): Promise<{ w: number; h: number; rgba: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      RUST_CLI,
      ["decode"],
      {
        encoding: "buffer",
        timeout: 30_000,
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        const output = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
        const newline = output.indexOf(0x0a);
        if (newline < 0) {
          reject(
            new Error("decode produced no header line (expected `w h\\n`)"),
          );
          return;
        }
        const header = output.subarray(0, newline).toString("ascii");
        const parts = header.split(" ");
        const w = Number.parseInt(parts[0] ?? "", 10);
        const h = Number.parseInt(parts[1] ?? "", 10);
        if (!Number.isInteger(w) || !Number.isInteger(h)) {
          reject(new Error(`decode header is not \`w h\`: ${header}`));
          return;
        }
        resolve({ w, h, rgba: new Uint8Array(output.subarray(newline + 1)) });
      },
    );
    child.stdin?.end(Buffer.from(hash));
  });
}

interface HarnessConfig {
  language: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

function getHarnesses(): HarnessConfig[] {
  return [
    {
      language: "Rust",
      command: path.join(ROOT, "rust/target/release/examples/encode_stdin"),
      args: [],
      cwd: ROOT,
    },
    {
      language: "C",
      command: C_HARNESS,
      args: [],
      cwd: ROOT,
      // macOS reads DYLD_LIBRARY_PATH, Linux LD_LIBRARY_PATH; set both.
      env: { DYLD_LIBRARY_PATH: C_LIB_DIR, LD_LIBRARY_PATH: C_LIB_DIR },
    },
    {
      language: "TypeScript",
      command: "node",
      args: [path.join(ROOT, "typescript/dist/encode-stdin.js")],
      cwd: ROOT,
    },
    {
      language: "Kotlin",
      command: path.join(
        ROOT,
        "bindings/uniffi/jvm/build/install/chromahash-jvm/bin/chromahash-jvm",
      ),
      args: [],
      cwd: path.join(ROOT, "bindings/uniffi/jvm"),
    },
    {
      language: "Swift",
      command: path.join(ROOT, ".build/debug/ChromaHashCLI"),
      args: [],
      cwd: ROOT,
    },
    {
      language: "Go",
      command: path.join(ROOT, "go/encode-stdin"),
      args: [],
      cwd: path.join(ROOT, "go"),
    },
    {
      language: "Python",
      command: "uv",
      args: ["run", "python", "-m", "chromahash.encode_stdin"],
      cwd: path.join(ROOT, "python"),
    },
    {
      language: "C#",
      command: "dotnet",
      args: [
        "exec",
        path.join(
          ROOT,
          "csharp/src/Chromahash.Cli/bin/Debug/net9.0/Chromahash.Cli.dll",
        ),
      ],
      cwd: ROOT,
    },
  ];
}

interface BuildStep {
  label: string;
  /**
   * Harness language this step produces, when it maps to one. A step whose
   * build fails marks that language unavailable so it is skipped rather than
   * invoked once per image. Steps that build no harness (gamut-ref) omit it.
   */
  language?: string;
  command: string;
  args: string[];
  cwd: string;
}

/**
 * Build all harness binaries once before running comparisons.
 * This avoids per-invocation build overhead (especially for Gradle and dotnet).
 */
export function buildHarnesses(): Set<string> {
  const steps: BuildStep[] = [
    {
      label: "TypeScript",
      language: "TypeScript",
      command: "pnpm",
      args: ["--prefix", path.join(ROOT, "typescript"), "run", "build"],
      cwd: ROOT,
    },
    {
      label: "Rust",
      language: "Rust",
      command: "cargo",
      args: [
        "build",
        "--release",
        "--manifest-path",
        path.join(ROOT, "rust/Cargo.toml"),
        "--example",
        "encode_stdin",
      ],
      cwd: ROOT,
    },
    {
      label: "C (lib)",
      language: "C",
      command: "cargo",
      args: [
        "build",
        "--manifest-path",
        path.join(ROOT, "bindings/c/Cargo.toml"),
      ],
      cwd: ROOT,
    },
    {
      label: "C (harness)",
      language: "C",
      command: "cc",
      args: [
        path.join(ROOT, "bindings/c/examples/encode_stdin.c"),
        "-I",
        path.join(ROOT, "bindings/c/include"),
        "-L",
        C_LIB_DIR,
        "-lchromahash_c",
        "-o",
        C_HARNESS,
      ],
      cwd: ROOT,
    },
    {
      label: "Kotlin",
      language: "Kotlin",
      command: path.join(ROOT, "bindings/uniffi/jvm/gradlew"),
      args: ["-p", path.join(ROOT, "bindings/uniffi/jvm"), "installDist", "-q"],
      cwd: path.join(ROOT, "bindings/uniffi/jvm"),
    },
    {
      label: "Go",
      language: "Go",
      command: "go",
      args: [
        "build",
        "-o",
        path.join(ROOT, "go/encode-stdin"),
        "./cmd/encode-stdin",
      ],
      cwd: path.join(ROOT, "go"),
    },
    {
      label: "Swift",
      language: "Swift",
      command: "swift",
      args: ["build"],
      cwd: ROOT,
    },
    {
      label: "C#",
      language: "C#",
      command: "dotnet",
      args: ["build", path.join(ROOT, "csharp/src/Chromahash.Cli")],
      cwd: ROOT,
    },
    {
      // Wide-gamut → sRGB metric-reference converter (delegates to gamut-color).
      label: "gamut-ref",
      command: "cargo",
      args: [
        "build",
        "--manifest-path",
        path.join(ROOT, "tools/gamut-ref-stdin/Cargo.toml"),
      ],
      cwd: ROOT,
    },
  ];

  const unavailable = new Set<string>();
  for (const step of steps) {
    console.log(`  Building ${step.label} harness...`);
    try {
      execFileSync(step.command, step.args, {
        cwd: step.cwd,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  WARNING: ${step.label} build failed: ${msg}`);
      if (step.language) unavailable.add(step.language);
    }
  }

  if (unavailable.size > 0) {
    console.warn(
      `  Harnesses unavailable (build failed): ${[...unavailable].join(", ")}`,
    );
  }
  return unavailable;
}

function runHarness(
  config: HarnessConfig,
  w: number,
  h: number,
  gamut: string,
  rgba: Uint8Array,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const cmdArgs = [...config.args, "encode", String(w), String(h), gamut];

    const child = execFile(
      config.command,
      cmdArgs,
      {
        cwd: config.cwd,
        encoding: "buffer",
        maxBuffer: 1024 * 1024,
        timeout: 30_000,
        env: config.env ? { ...process.env, ...config.env } : process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const stderrStr =
            stderr instanceof Buffer ? stderr.toString() : String(stderr);
          reject(
            new Error(
              `${config.language} harness failed: ${error.message}\nstderr: ${stderrStr}`,
            ),
          );
          return;
        }
        if (stdout instanceof Buffer) {
          resolve(stdout);
        } else {
          resolve(Buffer.from(stdout));
        }
      },
    );

    // Pipe RGBA data to stdin
    child.stdin?.end(Buffer.from(rgba));
  });
}

/**
 * Run all language harnesses for a given image and compare hashes.
 * The Rust implementation is used as the reference.
 */
export async function runAllHarnesses(
  input: ImageInput,
  gamut = "srgb",
  unavailable: ReadonlySet<string> = new Set(),
): Promise<HarnessResult[]> {
  const harnesses = getHarnesses().filter((c) => !unavailable.has(c.language));
  const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

  /**
   * First line of a failure, for the `error` field.
   *
   * A .NET `DllNotFoundException` alone is several kilobytes of dlopen attempts,
   * and this string is recorded once per image in `report.json`. The first line
   * identifies the failure; the console still prints what the harness said.
   */
  const firstLine = (err: unknown): string => {
    const text = err instanceof Error ? err.message : String(err);
    const line = text.split("\n")[0]?.trim() ?? text;
    return line.length > 200 ? `${line.slice(0, 197)}...` : line;
  };

  /** One harness's encode outcome, before any comparison. */
  interface Encoded {
    language: string;
    hash: Uint8Array;
    error: string | null;
  }

  const encoded: Encoded[] = [];
  for (const config of harnesses) {
    try {
      const output = await runHarness(config, w, h, gamut, rgba);
      // v1 hashes are variable-length (tier-driven); just require non-empty.
      if (output.length === 0) {
        console.warn(`${config.language}: encode returned no bytes`);
        encoded.push({
          language: config.language,
          hash: new Uint8Array(),
          error: "encode returned no bytes",
        });
        continue;
      }
      encoded.push({
        language: config.language,
        hash: new Uint8Array(output),
        error: null,
      });
    } catch (error) {
      console.warn(
        `${config.language} harness error:`,
        error instanceof Error ? error.message : error,
      );
      encoded.push({
        language: config.language,
        hash: new Uint8Array(),
        error: firstLine(error),
      });
    }
  }

  const referenceHash = encoded.find(
    (e) => e.language === "Rust" && e.error === null,
  )?.hash;

  const sameAsReference = (hash: Uint8Array): boolean =>
    referenceHash !== undefined &&
    hash.length === referenceHash.length &&
    referenceHash.every((b, i) => b === hash[i]);

  // Every hash is decoded by the *same* Rust binary, so a hash that is
  // byte-identical to the reference decodes to a byte-identical preview by
  // construction. Decoding each language separately was 7 redundant subprocess
  // spawns per image for a gallery of identical thumbnails; decode the
  // reference once and reuse it, and decode on its own only what actually
  // disagrees — which is the case where seeing the difference is the point.
  interface Preview {
    dataUri: string;
    decodedWidth: number;
    decodedHeight: number;
  }
  const EMPTY_PREVIEW: Preview = {
    dataUri: "",
    decodedWidth: 0,
    decodedHeight: 0,
  };

  const previewFor = async (hash: Uint8Array): Promise<Preview> => {
    const decoded = await decodeViaRust(hash);
    return {
      dataUri: await rgbaToDataUri(decoded.rgba, decoded.w, decoded.h),
      decodedWidth: decoded.w,
      decodedHeight: decoded.h,
    };
  };

  let referencePreview: Preview | null = null;
  if (referenceHash !== undefined) {
    try {
      referencePreview = await previewFor(referenceHash);
    } catch (error) {
      console.warn(
        "Rust reference decode failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const results: HarnessResult[] = [];
  for (const e of encoded) {
    if (e.error !== null) {
      // An errored harness produced no hash, so it neither matches nor
      // mismatches. `matches` stays false for the type's sake; `error` is what
      // consumers must read to avoid claiming a disagreement nothing observed.
      results.push({
        language: e.language,
        hash: e.hash,
        matches: false,
        error: e.error,
        ...EMPTY_PREVIEW,
      });
      continue;
    }

    const matches = sameAsReference(e.hash);
    let preview = EMPTY_PREVIEW;
    let error: string | null = null;
    try {
      preview =
        matches && referencePreview !== null
          ? referencePreview
          : await previewFor(e.hash);
    } catch (err) {
      // The encode is what the cross-language check tests; a failed *decode* of
      // a hash we did obtain is a preview failure, not a parity verdict.
      error = firstLine(err);
      console.warn(`${e.language} preview decode failed:`, err);
    }

    results.push({
      language: e.language,
      hash: e.hash,
      matches,
      error,
      ...preview,
    });
  }

  if (referenceHash === undefined) {
    // Without a reference there is nothing to compare against. That is an
    // absent verdict, not a failed one — record it as such on every row.
    for (const result of results) {
      result.matches = false;
      result.error ??= "no Rust reference hash was produced for this image";
    }
  }

  return results;
}
