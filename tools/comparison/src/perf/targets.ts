/**
 * The measurement targets: every distinct chromahash implementation, plus the
 * scalar-Rust build used to price the `simd` feature.
 *
 * Distinct is doing work here. The C binding and the Android AAR are excluded
 * as trivial surfaces over the same core, but `TypeScript (pure)` earns a row
 * of its own — `typescript/src/decode.ts` is a hand-maintained algorithm port,
 * not a binding, and its entire justification is skipping WebAssembly
 * instantiation.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/** What a target can be asked to measure. */
export type Op = "encode" | "decode" | "batch";

export interface Target {
  /** Report label. Stable — the committed baseline JSON is keyed on it. */
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Which ops this target implements. */
  readonly ops: readonly Op[];
  /** Managed runtimes need wall-clock time, not trip counts, to reach steady state. */
  readonly managed: boolean;
  /** Honours CHROMAHASH_BATCH_THREADS (i.e. has a real worker pool). */
  readonly threadable: boolean;
  /** Accepts CHROMAHASH_TUNE. Rust only — no binding exposes Tunables. */
  readonly tunable: boolean;
}

export const SCALAR_TARGET_DIR = path.join(ROOT, "rust/target/scalar");

export function allTargets(): Target[] {
  return [
    {
      name: "Rust",
      command: path.join(ROOT, "rust/target/release/examples/encode_stdin"),
      args: [],
      cwd: ROOT,
      ops: ["encode", "decode", "batch"],
      managed: false,
      threadable: true,
      tunable: true,
    },
    {
      // Same source, built --no-default-features, so the only difference is the
      // hand-written SIMD backend for the per-pixel OKLAB transform.
      name: "Rust (scalar)",
      command: path.join(SCALAR_TARGET_DIR, "release/examples/encode_stdin"),
      args: [],
      cwd: ROOT,
      ops: ["encode", "decode", "batch"],
      managed: false,
      threadable: true,
      tunable: true,
    },
    {
      name: "Go",
      command: path.join(ROOT, "go/encode-stdin"),
      args: [],
      cwd: path.join(ROOT, "go"),
      ops: ["encode", "decode", "batch"],
      managed: false,
      threadable: true,
      tunable: false,
    },
    {
      name: "TypeScript (wasm)",
      command: "node",
      args: [path.join(ROOT, "typescript/dist/encode-stdin.js")],
      cwd: ROOT,
      ops: ["encode", "decode", "batch"],
      managed: true,
      threadable: false,
      tunable: false,
    },
    {
      // Decode only: encoding lives in WebAssembly.
      name: "TypeScript (pure)",
      command: "node",
      args: [path.join(ROOT, "typescript/dist/decode-stdin.js")],
      cwd: ROOT,
      ops: ["decode"],
      managed: true,
      threadable: false,
      tunable: false,
    },
    {
      name: "Python",
      command: "uv",
      args: ["run", "python", "-m", "chromahash.encode_stdin"],
      cwd: path.join(ROOT, "python"),
      ops: ["encode", "decode", "batch"],
      managed: true,
      threadable: false,
      tunable: false,
    },
    {
      name: "Kotlin",
      command: path.join(
        ROOT,
        "bindings/uniffi/jvm/build/install/chromahash-jvm/bin/chromahash-jvm",
      ),
      args: [],
      cwd: path.join(ROOT, "bindings/uniffi/jvm"),
      ops: ["encode", "decode", "batch"],
      managed: true,
      threadable: true,
      tunable: false,
    },
    {
      name: "Swift",
      command: path.join(ROOT, ".build/release/ChromaHashCLI"),
      args: [],
      cwd: ROOT,
      ops: ["encode", "decode", "batch"],
      managed: false,
      threadable: true,
      tunable: false,
    },
    {
      name: "C#",
      command: "dotnet",
      args: [
        "exec",
        path.join(
          ROOT,
          "csharp/src/Chromahash.Cli/bin/Release/net9.0/Chromahash.Cli.dll",
        ),
      ],
      cwd: ROOT,
      ops: ["encode", "decode", "batch"],
      managed: true,
      threadable: true,
      tunable: false,
    },
  ];
}

export { ROOT };
