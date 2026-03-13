import { execFile, execFileSync } from "node:child_process";
import path from "node:path";
import { ChromaHash } from "@chromahash/typescript";
import type { HarnessResult, ImageInput } from "./types.ts";
import { rgbaToDataUri } from "./image-loader.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

interface HarnessConfig {
  language: string;
  command: string;
  args: string[];
  cwd: string;
}

function getHarnesses(): HarnessConfig[] {
  return [
    {
      language: "Rust",
      command: path.join(ROOT, "rust/target/debug/examples/encode_stdin"),
      args: [],
      cwd: ROOT,
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
        "kotlin/build/install/chromahash/bin/chromahash",
      ),
      args: [],
      cwd: path.join(ROOT, "kotlin"),
    },
    {
      language: "Swift",
      command: path.join(ROOT, "swift/.build/debug/ChromaHashCLI"),
      args: [],
      cwd: path.join(ROOT, "swift"),
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
  command: string;
  args: string[];
  cwd: string;
}

/**
 * Build all harness binaries once before running comparisons.
 * This avoids per-invocation build overhead (especially for Gradle and dotnet).
 */
export function buildHarnesses(): void {
  const steps: BuildStep[] = [
    {
      label: "TypeScript",
      command: "pnpm",
      args: ["--prefix", path.join(ROOT, "typescript"), "run", "build"],
      cwd: ROOT,
    },
    {
      label: "Rust",
      command: "cargo",
      args: [
        "build",
        "--manifest-path",
        path.join(ROOT, "rust/Cargo.toml"),
        "--example",
        "encode_stdin",
      ],
      cwd: ROOT,
    },
    {
      label: "Kotlin",
      command: path.join(ROOT, "kotlin/gradlew"),
      args: ["-p", path.join(ROOT, "kotlin"), "installDist", "-q"],
      cwd: path.join(ROOT, "kotlin"),
    },
    {
      label: "Go",
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
      command: "swift",
      args: ["build"],
      cwd: path.join(ROOT, "swift"),
    },
    {
      label: "C#",
      command: "dotnet",
      args: ["build", path.join(ROOT, "csharp/src/Chromahash.Cli")],
      cwd: ROOT,
    },
  ];

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
    }
  }
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
 * Run all 7 language harnesses for a given image and compare hashes.
 * The Rust implementation is used as the reference.
 */
export async function runAllHarnesses(
  input: ImageInput,
  gamut = "srgb",
): Promise<HarnessResult[]> {
  const harnesses = getHarnesses();
  const { smallWidth: w, smallHeight: h, smallRgba: rgba } = input;

  const results: HarnessResult[] = [];
  let referenceHash: Uint8Array | undefined;

  for (const config of harnesses) {
    try {
      const output = await runHarness(config, w, h, gamut, rgba);

      if (output.length !== 32) {
        console.warn(
          `${config.language}: expected 32 bytes, got ${output.length}`,
        );
        results.push({
          language: config.language,
          hash: new Uint8Array(32),
          matches: false,
          dataUri: "",
        });
        continue;
      }

      const hash = new Uint8Array(output);

      if (config.language === "Rust") {
        referenceHash = hash;
      }

      // Decode using TypeScript implementation (deterministic across impls)
      const ch = ChromaHash.fromBytes(hash);
      const decoded = ch.decode();
      const dataUri = await rgbaToDataUri(decoded.rgba, decoded.w, decoded.h);

      results.push({
        language: config.language,
        hash,
        matches: true, // Will be updated after all complete
        dataUri,
      });
    } catch (error) {
      console.warn(
        `${config.language} harness error:`,
        error instanceof Error ? error.message : error,
      );
      results.push({
        language: config.language,
        hash: new Uint8Array(32),
        matches: false,
        dataUri: "",
      });
    }
  }

  // Compare all hashes against reference (Rust)
  if (referenceHash) {
    for (const result of results) {
      result.matches =
        result.hash.length === 32 &&
        referenceHash.every((b, i) => b === result.hash[i]);
    }
  } else {
    // No reference hash available — mark all as non-matching
    for (const result of results) {
      result.matches = false;
    }
  }

  return results;
}
