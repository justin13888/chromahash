import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import type { HarnessResult, ImageInput } from "./types.ts";
import { rgbaToDataUri } from "./image-loader.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const RUST_CLI = path.join(ROOT, "rust/target/release/examples/encode_stdin");
// The C harness links the chromahash-c cdylib, which must be on the loader path.
const C_LIB_DIR = path.join(ROOT, "bindings/c/target/debug");
const C_HARNESS = path.join(ROOT, "bindings/c/target/encode_stdin");

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
  const w = Number.parseInt(parts[0] ?? "0", 10);
  const h = Number.parseInt(parts[1] ?? "0", 10);
  const rgba = new Uint8Array(output.subarray(newline + 1));
  return { w, h, rgba };
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

  const results: HarnessResult[] = [];
  let referenceHash: Uint8Array | undefined;

  for (const config of harnesses) {
    try {
      const output = await runHarness(config, w, h, gamut, rgba);

      // v1 hashes are variable-length (tier-driven); just require non-empty.
      if (output.length === 0) {
        console.warn(`${config.language}: encode returned no bytes`);
        results.push({
          language: config.language,
          hash: new Uint8Array(),
          matches: false,
          dataUri: "",
          decodedWidth: 0,
          decodedHeight: 0,
        });
        continue;
      }

      const hash = new Uint8Array(output);

      if (config.language === "Rust") {
        referenceHash = hash;
      }

      // Decode using Rust reference implementation (v0.2)
      const decoded = decodeViaRust(hash);
      const dataUri = await rgbaToDataUri(decoded.rgba, decoded.w, decoded.h);

      results.push({
        language: config.language,
        hash,
        matches: true, // Will be updated after all complete
        dataUri,
        decodedWidth: decoded.w,
        decodedHeight: decoded.h,
      });
    } catch (error) {
      console.warn(
        `${config.language} harness error:`,
        error instanceof Error ? error.message : error,
      );
      results.push({
        language: config.language,
        hash: new Uint8Array(),
        matches: false,
        dataUri: "",
        decodedWidth: 0,
        decodedHeight: 0,
      });
    }
  }

  // Compare all hashes against reference (Rust) — byte-identical at any length.
  if (referenceHash) {
    const ref = referenceHash;
    for (const result of results) {
      result.matches =
        result.hash.length === ref.length &&
        ref.every((b, i) => b === result.hash[i]);
    }
  } else {
    // No reference hash available — mark all as non-matching
    for (const result of results) {
      result.matches = false;
    }
  }

  return results;
}
