import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TOOL_ROOT = path.resolve(import.meta.dirname, "..");
/** Detached worktrees + their build artifacts live here (gitignored, cached). */
const VERSIONS_DIR = path.join(TOOL_ROOT, ".versions");

/** A built encode_stdin binary for one chromahash version. */
export interface VersionBinary {
  /** Version label, e.g. "v0.2" or "current". */
  version: string;
  /** Absolute path to the version's `encode_stdin` binary. */
  binaryPath: string;
}

/**
 * A minimal `encode_stdin` dropped into each tag worktree before building, so every
 * version frames its output identically: `encode` writes the 32-byte hash; `decode`
 * writes a `"w h\n"` header then RGBA. It normalizes two stock differences across
 * v0.2–v0.6 — v0.2's example omits the dimension header, and only v0.3+ support a
 * capped decode — by always decoding uncapped with a header. It calls only the
 * stable `ChromaHash::encode`/`from_bytes`/`decode` API + `Gamut`, so it compiles
 * against every tag, and the encode path is byte-identical to the stock example.
 *
 * The shim is pinned to the pre-v1 API: a fixed `[u8; 32]` hash and an infallible
 * `from_bytes`. That holds through v0.6 and no further — v1 (0.7.x) made hashes
 * variable-length and `from_bytes` fallible, so `current` is always built from the
 * working tree's own example rather than this shim.
 */
const DECODE_SHIM = `use chromahash::{ChromaHash, Gamut};
use std::io::{self, Read, Write};

fn parse_gamut(s: &str) -> Gamut {
    match s {
        "srgb" => Gamut::Srgb,
        "displayp3" => Gamut::DisplayP3,
        "adobergb" => Gamut::AdobeRgb,
        "bt2020" => Gamut::Bt2020,
        "prophoto" => Gamut::ProPhotoRgb,
        other => {
            eprintln!("unknown gamut: {other}");
            std::process::exit(1);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("encode") => {
            let w: u32 = args[2].parse().expect("invalid width");
            let h: u32 = args[3].parse().expect("invalid height");
            let gamut = parse_gamut(&args[4]);
            let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4];
            io::stdin().read_exact(&mut rgba).expect("failed to read RGBA");
            let hash = ChromaHash::encode(w, h, &rgba, gamut);
            io::stdout().write_all(hash.as_bytes()).expect("failed to write hash");
        }
        Some("decode") => {
            let mut hash = [0u8; 32];
            io::stdin().read_exact(&mut hash).expect("failed to read hash");
            let (w, h, rgba) = ChromaHash::from_bytes(hash).decode();
            io::stdout()
                .write_all(format!("{w} {h}\\n").as_bytes())
                .expect("failed to write header");
            io::stdout().write_all(&rgba).expect("failed to write RGBA");
        }
        _ => {
            eprintln!("Usage: encode_stdin encode <width> <height> <gamut> | decode");
            std::process::exit(1);
        }
    }
}
`;

/** Write the shim into a tag worktree only when it differs (avoids needless rebuilds). */
function installShim(dir: string): void {
  const shimPath = path.join(dir, "rust/examples/encode_stdin.rs");
  const existing = fs.existsSync(shimPath)
    ? fs.readFileSync(shimPath, "utf8")
    : "";
  if (existing !== DECODE_SHIM) fs.writeFileSync(shimPath, DECODE_SHIM);
}

/** Map a version label to its release git tag (v0.2 -> v0.2.0). */
function tagForVersion(version: string): string {
  return `${version}.0`;
}

/** Build the `encode_stdin` example for a crate, in release mode. */
function buildExample(manifestPath: string): void {
  execFileSync(
    "cargo",
    [
      "build",
      "--release",
      "--manifest-path",
      manifestPath,
      "--example",
      "encode_stdin",
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 },
  );
}

/** Add a detached worktree checked out at `tag`, unless `dir` already exists. */
function ensureWorktree(tag: string, dir: string): void {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  execFileSync("git", ["worktree", "add", "--detach", dir, tag], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
}

/**
 * Build (and cache) a release `encode_stdin` binary for each requested version.
 *
 * Released tags (e.g. `v0.2`) are built in a detached git worktree under
 * `.versions/<version>/`, with a normalizing decode shim applied first (see
 * `DECODE_SHIM`); `current` is built from the working tree so it reflects any
 * uncommitted changes. Every binary is release-built so encode/decode timings are
 * comparable. Worktrees are reused across runs and cargo's incremental build keeps
 * re-runs cheap. A version that fails to build is logged and omitted from the
 * result rather than aborting the whole run.
 *
 * Each version must round-trip with its OWN binary: every format generation is
 * bitstream-incompatible with the last (v1 is an explicit clean break from the
 * v0.6 wire format), so a hash produced by one version cannot be decoded by
 * another.
 *
 * Returns the binaries in the order requested.
 */
export function prepareVersionBinaries(versions: string[]): VersionBinary[] {
  const out: VersionBinary[] = [];
  for (const version of versions) {
    try {
      if (version === "current") {
        console.log("  Building current encode_stdin (release)...");
        buildExample(path.join(ROOT, "rust/Cargo.toml"));
        const bin = path.join(
          ROOT,
          "rust/target/release/examples/encode_stdin",
        );
        if (!fs.existsSync(bin)) throw new Error(`binary not found: ${bin}`);
        out.push({ version, binaryPath: bin });
        continue;
      }

      const dir = path.join(VERSIONS_DIR, version);
      const bin = path.join(dir, "rust/target/release/examples/encode_stdin");
      const tag = tagForVersion(version);
      console.log(`  Building ${version} (${tag}) encode_stdin (release)...`);
      ensureWorktree(tag, dir);
      installShim(dir);
      // cargo no-ops when the worktree + shim are unchanged, so re-runs are cheap.
      buildExample(path.join(dir, "rust/Cargo.toml"));
      if (!fs.existsSync(bin)) throw new Error(`binary not found: ${bin}`);
      out.push({ version, binaryPath: bin });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  WARNING: ${version} build failed (skipping): ${msg}`);
    }
  }
  return out;
}
