/**
 * Wide-gamut → sRGB conversion for metric references and report previews.
 *
 * The gamut fixtures store pixel bytes that are *tagged* with a non-sRGB gamut.
 * Comparing decoded previews against those raw bytes as if they were sRGB
 * penalizes formats that color-manage correctly. This module converts a
 * gamut-tagged image to its true sRGB appearance (relative-colorimetric, with
 * per-channel clipping) so metrics measure the right target for every format —
 * and so the report's Original / encoder-input previews show that same true
 * appearance instead of the raw bytes, matching a correct gamut-aware decode.
 *
 * The color math itself — the per-gamut EOTFs, the OKLab M1 / M1⁻¹[sRGB]
 * matrices, and the sRGB inverse-EOTF — is **not** reimplemented here. It is
 * delegated to the same-author `gamut` ecosystem (`gamut-color`) via the
 * `tools/gamut-ref-stdin` Rust shim, so those matrices and transfer functions
 * are defined once (in gamut) instead of transcribed into this harness. The
 * shim is the encoder-exact interpretation chromahash applies to gamut-tagged
 * input; this is harness code (Tier-1, correctness-only), not format code.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// Repo root from the compiled location (dist/gamut.js → ../../.. = repo root).
const ROOT = path.resolve(import.meta.dirname, "../../..");
const GAMUT_REF_CRATE = path.join(ROOT, "tools/gamut-ref-stdin");
const GAMUT_REF_BIN = path.join(
  GAMUT_REF_CRATE,
  "target/debug/gamut-ref-stdin",
);

let ensuredBuilt = false;

/**
 * Build the shim if it is missing. The normal compare flow pre-builds it in the
 * harness build phase (so this is a no-op); this fallback covers paths that skip
 * that phase — `--skip-harnesses`, tests, or importing this module directly.
 *
 * Exported so a concurrent caller can force the build *before* fanning out.
 * `ensuredBuilt` is a check-then-act with a subprocess between the two halves,
 * so several workers arriving together would each see `false` and launch their
 * own `cargo build` of the same crate.
 */
export function ensureGamutReferenceBuilt(): void {
  ensureBuilt();
}

function ensureBuilt(): void {
  if (ensuredBuilt) {
    return;
  }
  if (!existsSync(GAMUT_REF_BIN)) {
    execFileSync(
      "cargo",
      ["build", "--manifest-path", path.join(GAMUT_REF_CRATE, "Cargo.toml")],
      { stdio: "inherit" },
    );
  }
  ensuredBuilt = true;
}

/**
 * Convert gamut-tagged RGBA bytes to their sRGB appearance (alpha passthrough).
 *
 * `gamut` is the harness's normalized key (`srgb`, `displayp3`, `adobergb`,
 * `bt2020`, `prophoto`). Returns the input unchanged for sRGB — it is already
 * the metric target, and short-circuiting avoids a needless subprocess (the
 * shim treats sRGB and any unknown key as identity too).
 */
export function gamutToSrgbReference(
  rgba: Uint8Array,
  gamut: string,
): Uint8Array {
  if (gamut === "srgb") {
    return rgba;
  }
  ensureBuilt();
  const out = execFileSync(GAMUT_REF_BIN, [gamut], {
    input: Buffer.from(rgba),
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
