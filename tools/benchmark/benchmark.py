#!/usr/bin/env python3
"""Performance benchmark for chromahash vs. ThumbHash baselines.

Runs hyperfine to compare **encode** and **decode** in two regimes — a **single**
call and a **bulk 1000** (batched) run — across all 7 chromahash language
implementations (Rust, TypeScript, Go, Python, Kotlin, Swift, C#) plus two
ThumbHash baselines:
  * **ThumbHash (Rust)** — Evan Wallace's official `thumbhash` crate, the fastest
    native port. This is the apples-to-apples opponent for native chromahash:
    same language, and its bulk encode is parallelized across cores to match
    chromahash's `BatchEncoder`. Without it the only baseline was JS-on-Node, so
    chromahash's lead reflected the runtime, not the algorithm.
  * **ThumbHash (JS)** — the JS reference (npm `thumbhash`), kept for the
    JS/TS-runtime comparison (vs. chromahash's TypeScript build).

The input is a fixed 100x100 sRGB RGB gradient. The size is dictated by ThumbHash,
which caps the longest dimension at ~100px.

IMPORTANT — interpreting the numbers:
  * single-mode times are dominated by **process startup** (JVM/.NET/Node cold
    start swamps the microsecond-scale op). They are a startup/latency proxy, not
    per-op compute. The native ThumbHash (Rust) has near-zero startup, so its
    single-mode number is finally comparable to native chromahash.
  * bulk-mode runs 1000 ops in one process, amortizing startup. The bulk
    **per-op** time (median / count) is the real compute number. The parallel
    batch encoders (chromahash Rust/Go/Kotlin/Swift/C# and ThumbHash Rust) share
    one tier; the serial ones (chromahash TypeScript/Python and ThumbHash JS,
    which loop on one core) share another. Compare like with like.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUT_DIR_DEFAULT = Path(__file__).resolve().parent / "output"

GRADIENT_W = 100
GRADIENT_H = 100
GAMUT = "srgb"
DEFAULT_BULK_COUNT = 1000
# Per-comparison hyperfine timeout (seconds). One comparison times every harness,
# so the serial-tier (Python/TypeScript) bulk runs dominate and scale with the
# machine — at the default bulk-count/min-runs the Python encode_bulk cell alone
# can take >20 min on a slow host. Generous by design; override with --timeout.
DEFAULT_TIMEOUT = 3600

# chromahash in 7 languages + two ThumbHash baselines (native Rust + JS reference).
# "thumbhash": True marks a baseline whose command shape differs — it takes no
# gamut argument and decodes its own (variable-length) hash. Each ThumbHash
# baseline decodes a hash it produced itself: unlike chromahash, ThumbHash is not
# byte-identical across runtimes (DCT-coefficient quantization diverges with
# float rounding), so the Rust and JS hashes differ by a byte or two.
HARNESSES: dict[str, dict] = {
    "Rust": {"cmd": str(ROOT / "rust/target/release/examples/encode_stdin")},
    "Go": {"cmd": str(ROOT / "go/encode-stdin")},
    "TypeScript": {"cmd": f"node {ROOT / 'typescript/dist/encode-stdin.js'}"},
    "Python": {
        "cmd": "uv run python -m chromahash.encode_stdin",
        "cwd": str(ROOT / "python"),
    },
    "Kotlin": {
        "cmd": str(ROOT / "bindings/uniffi/jvm/build/install/chromahash-jvm/bin/chromahash-jvm")
    },
    "Swift": {"cmd": str(ROOT / "swift/.build/release/ChromaHashCLI")},
    "C#": {
        "cmd": "dotnet exec "
        + str(ROOT / "csharp/src/Chromahash.Cli/bin/Release/net9.0/Chromahash.Cli.dll"),
    },
    # Fastest native ThumbHash — official crate, parallel bulk encode. The
    # apples-to-apples opponent for native chromahash.
    "ThumbHash (Rust)": {
        "cmd": str(ROOT / "tools/thumbhash-rs/target/release/thumbhash-stdin"),
        "thumbhash": True,
    },
    # JS reference impl on Node — the runtime peer of chromahash's TypeScript.
    "ThumbHash (JS)": {
        "cmd": f"node {ROOT / 'tools/comparison/dist/thumbhash-stdin.js'}",
        "thumbhash": True,
    },
}

# Tier codes, ordered by quality (spec §2.5); mirrors rust/src/constants.rs.
COMPACT_TIER = 0
DEFAULT_TIER = 1
MAX_TIER = 4
# Every shipped tier, smallest first — the order reports present them in.
ALL_TIERS = list(range(COMPACT_TIER, MAX_TIER + 1))
# Encoded length of each tier code (no-alpha), per spec §3.5.
TIER_BYTES = {0: 21, 1: 32, 2: 108, 3: 411, 4: 1623}


def parse_tiers(raw: str) -> list[int]:
    """Parse the --tiers argument: 'all', or a comma-separated list of codes."""
    if raw.strip().lower() == "all":
        return list(ALL_TIERS)
    tiers = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            tier = int(part)
        except ValueError:
            raise argparse.ArgumentTypeError(f"{part!r} is not a tier code") from None
        if tier not in ALL_TIERS:
            raise argparse.ArgumentTypeError(f"tier {tier} is not a valid code (0..={MAX_TIER})")
        tiers.append(tier)
    if not tiers:
        raise argparse.ArgumentTypeError("no tiers given")
    # Report order is the quality ladder, and each tier is measured once.
    return sorted(set(tiers))


OPERATIONS = ["encode", "decode"]
MODES = ["single", "bulk"]


def build_harnesses() -> None:
    """Build every harness in release mode.

    Note: `just benchmark` already builds with mise-pinned toolchains and then
    runs this script with --skip-build. This function exists for standalone
    `uv run benchmark.py` use and relies on the toolchains being on PATH.
    """
    print("Building all harnesses (release mode)...")
    steps = [
        (
            "Rust",
            [
                "cargo",
                "build",
                "--manifest-path",
                str(ROOT / "rust/Cargo.toml"),
                "--release",
                "--example",
                "encode_stdin",
            ],
            str(ROOT),
        ),
        ("TypeScript", ["pnpm", "--prefix", str(ROOT / "typescript"), "run", "build"], str(ROOT)),
        (
            "Go",
            ["go", "build", "-o", str(ROOT / "go/encode-stdin"), "./cmd/encode-stdin"],
            str(ROOT / "go"),
        ),
        ("Kotlin", ["./gradlew", "installDist", "-q"], str(ROOT / "bindings/uniffi/jvm")),
        ("Swift", ["swift", "build", "-c", "release"], str(ROOT / "swift")),
        (
            "C#",
            [
                "dotnet",
                "build",
                str(ROOT / "csharp/src/Chromahash.Cli"),
                "-c",
                "Release",
                "--verbosity",
                "quiet",
            ],
            str(ROOT),
        ),
        # Native ThumbHash harness — standalone crate (keeps the core zero-dep).
        (
            "ThumbHash (Rust)",
            [
                "cargo",
                "build",
                "--manifest-path",
                str(ROOT / "tools/thumbhash-rs/Cargo.toml"),
                "--release",
            ],
            str(ROOT),
        ),
        # JS ThumbHash harness lives in the comparison tool (which owns the dep).
        (
            "ThumbHash (JS)",
            ["pnpm", "--prefix", str(ROOT / "tools/comparison"), "run", "build"],
            str(ROOT),
        ),
    ]

    for label, cmd, cwd in steps:
        print(f"  Building {label}...")
        try:
            subprocess.run(cmd, cwd=cwd, check=True, capture_output=True, timeout=300)
        except subprocess.CalledProcessError as e:
            print(f"  WARNING: {label} build failed: {e.stderr.decode()[:200]}")
        except FileNotFoundError:
            print(f"  WARNING: {label} build command not found, skipping")


def make_gradient_rgba(w: int, h: int) -> bytes:
    """Deterministic w×h RGBA gradient: R ramps with x, G with y, B fixed, A=255."""
    buf = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 4
            buf[i] = x * 255 // (w - 1) if w > 1 else 0
            buf[i + 1] = y * 255 // (h - 1) if h > 1 else 0
            buf[i + 2] = 128
            buf[i + 3] = 255
    return bytes(buf)


def run_harness(
    config: dict, sub_args: list[str], stdin_bytes: bytes, env: dict | None = None
) -> bytes:
    """Run a harness once with sub_args, feeding stdin_bytes; return stdout."""
    parts = shlex.split(config["cmd"]) + sub_args
    result = subprocess.run(
        parts,
        input=stdin_bytes,
        env={**os.environ, **env} if env else None,
        capture_output=True,
        cwd=config.get("cwd"),
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode()[:300])
    return result.stdout


def prepare_fixtures(tmp_dir: Path, tier: int) -> dict:
    """Write the gradient and the decode-hash fixtures to tmp_dir.

    Returns {"gradient": Path, "chroma_hash": Path, "thumb_hash": {name: Path}}.

    chromahash hashes are byte-identical across all 7 languages (spec guarantee),
    so one shared hash (produced by the Rust harness) drives every chromahash
    decode. ThumbHash is *not* byte-identical across runtimes, so each ThumbHash
    baseline decodes a hash it encoded itself (keyed by harness name).
    """
    gradient = make_gradient_rgba(GRADIENT_W, GRADIENT_H)
    gradient_file = tmp_dir / "gradient.rgba"
    gradient_file.write_bytes(gradient)

    chroma_hash = run_harness(
        HARNESSES["Rust"],
        ["encode", str(GRADIENT_W), str(GRADIENT_H), GAMUT],
        gradient,
        env={"CHROMAHASH_TIER": str(tier)},
    )
    # Variable length at tier > 0; tier 0 is 32 bytes. Just require non-empty.
    if not chroma_hash:
        print("ERROR: Rust encode returned no bytes")
        sys.exit(1)
    chroma_hash_file = tmp_dir / "chroma.hash"
    chroma_hash_file.write_bytes(chroma_hash)

    thumb_hash_files: dict[str, Path] = {}
    for name, config in HARNESSES.items():
        if not config.get("thumbhash"):
            continue
        thumb_hash = run_harness(config, ["encode", str(GRADIENT_W), str(GRADIENT_H)], gradient)
        if not thumb_hash:
            print(f"ERROR: {name} encode returned no bytes")
            sys.exit(1)
        slug = "".join(c if c.isalnum() else "_" for c in name.lower())
        thumb_hash_file = tmp_dir / f"thumb_{slug}.hash"
        thumb_hash_file.write_bytes(thumb_hash)
        thumb_hash_files[name] = thumb_hash_file

    return {
        "gradient": gradient_file,
        "chroma_hash": chroma_hash_file,
        "thumb_hash": thumb_hash_files,
    }


def harness_command(
    name: str, config: dict, operation: str, mode: str, count: int, files: dict, tier: int
) -> str:
    """Build the shell command for one (harness, operation, mode) cell."""
    cmd = config["cmd"]
    is_thumb = config.get("thumbhash", False)
    gamut_arg = "" if is_thumb else f" {GAMUT}"
    # chromahash harnesses read the quality tier from the environment; ThumbHash
    # baselines have no tier concept.
    env_prefix = "" if is_thumb else f"CHROMAHASH_TIER={tier} "

    if operation == "encode":
        verb = "encode" if mode == "single" else "batch-encode"
        count_arg = "" if mode == "single" else f" {count}"
        sub = f"{verb} {GRADIENT_W} {GRADIENT_H}{gamut_arg}{count_arg}"
        redirect = files["gradient"]
    else:  # decode
        sub = "decode" if mode == "single" else f"batch-decode {count}"
        redirect = files["thumb_hash"][name] if is_thumb else files["chroma_hash"]

    full = f"{env_prefix}{cmd} {sub} < {redirect}"
    cwd = config.get("cwd")
    if cwd:
        full = f"cd {cwd} && {full}"
    return full


def run_benchmarks(
    files: dict,
    output_dir: Path,
    warmup: int,
    min_runs: int,
    count: int,
    timeout: int,
    tier: int,
) -> list[dict]:
    """Run one hyperfine comparison per (operation, mode) across all harnesses."""
    results_dir = output_dir / "json"
    results_dir.mkdir(parents=True, exist_ok=True)

    all_results: list[dict] = []
    total = len(OPERATIONS) * len(MODES)
    idx = 0

    for operation in OPERATIONS:
        for mode in MODES:
            idx += 1
            json_file = results_dir / f"t{tier}_{operation}_{mode}.json"
            print(f"  [{idx}/{total}] {operation} — {mode}")

            cmd = [
                "hyperfine",
                "--warmup",
                str(warmup),
                "--min-runs",
                str(min_runs),
                "--export-json",
                str(json_file),
            ]
            for name, config in HARNESSES.items():
                cmd.extend(
                    ["-n", name, harness_command(name, config, operation, mode, count, files, tier)]
                )

            try:
                subprocess.run(cmd, check=True, capture_output=True, timeout=timeout)
            except subprocess.CalledProcessError as e:
                print(f"    WARNING: hyperfine failed: {e.stderr.decode()[:300]}")
                continue
            except subprocess.TimeoutExpired:
                # A single comparison ran past --timeout. The serial-tier harnesses
                # (Python/TypeScript) dominate bulk mode and scale with the machine,
                # so this is usually "too slow", not "hung". Warn and keep the other
                # cells rather than crashing the whole matrix; raise --timeout (or
                # lower --bulk-count / --min-runs) to capture this cell.
                print(
                    f"    WARNING: {operation} — {mode} exceeded --timeout ({timeout}s); "
                    "skipping. Raise --timeout or lower --bulk-count/--min-runs."
                )
                continue
            except FileNotFoundError:
                print(
                    "    ERROR: hyperfine not found. Install it: https://github.com/sharkdp/hyperfine"
                )
                sys.exit(1)

            try:
                with open(json_file) as f:
                    data = json.load(f)
                data["_operation"] = operation
                data["_mode"] = mode
                all_results.append(data)
            except (json.JSONDecodeError, FileNotFoundError) as e:
                print(f"    WARNING: failed to parse results: {e}")

    return all_results


def collect_medians(all_results: list[dict]) -> dict[str, dict[tuple[str, str], float]]:
    """{impl: {(operation, mode): median_seconds}}."""
    medians: dict[str, dict[tuple[str, str], float]] = {}
    for result in all_results:
        key = (result["_operation"], result["_mode"])
        for bench in result.get("results", []):
            medians.setdefault(bench["command"], {})[key] = bench["median"]
    return medians


def format_table(
    medians_by_tier: dict[int, dict[str, dict[tuple[str, str], float]]], count: int
) -> str:
    """Build the markdown summary: one table per tier, in the quality ladder's order."""
    lines = [
        f"## Benchmark Summary — 100×100 RGB gradient, bulk count = {count}",
        "",
        "Tier codes are ordered by quality (spec §2.5): **0** is the 21-byte compact "
        "tier, **1** the 32-byte default, **2–4** carry ~4× the coefficients each. "
        "The ThumbHash baselines do not have tiers — they are the same measurement "
        "in every table, repeated so each is directly comparable to the chromahash "
        "rows beside it.",
    ]

    for tier in sorted(medians_by_tier):
        medians = medians_by_tier[tier]

        def ms(name: str, op: str, mode: str, _m: dict = medians) -> str:
            v = _m.get(name, {}).get((op, mode))
            return f"{v * 1000:.2f} ms" if v is not None else "N/A"

        def per_op_us(name: str, op: str, _m: dict = medians) -> str:
            v = _m.get(name, {}).get((op, "bulk"))
            return f"{v / count * 1e6:.2f} µs" if v is not None else "N/A"

        bytes_at = TIER_BYTES.get(tier)
        heading = f"### Tier {tier}" + (f" — {bytes_at} bytes" if bytes_at else "")
        lines += [
            "",
            heading,
            "",
            "| Implementation | encode single | decode single | encode bulk (total) "
            "| encode bulk (per-op) | decode bulk (total) | decode bulk (per-op) |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for name in HARNESSES:
            label = f"{name} _(ThumbHash baseline)_" if HARNESSES[name].get("thumbhash") else name
            lines.append(
                f"| {label} | {ms(name, 'encode', 'single')} | {ms(name, 'decode', 'single')} "
                f"| {ms(name, 'encode', 'bulk')} | {per_op_us(name, 'encode')} "
                f"| {ms(name, 'decode', 'bulk')} | {per_op_us(name, 'decode')} |"
            )

    lines += [
        "",
        "",
        "> **single** times include process startup (JVM/.NET/Node cold start dominates) "
        "— a startup/latency proxy, not per-op compute. **bulk per-op** (= median / count) "
        "is the real compute number.",
        ">",
        "> Two ThumbHash baselines: **(Rust)** is the fastest native port (official "
        "`thumbhash` crate, parallel bulk encode) — compare it against native chromahash. "
        "**(JS)** is the JS reference on Node (serial) — compare it against chromahash's "
        "TypeScript. For bulk encode, the parallel tier is chromahash Rust/Go/Kotlin/Swift/C# "
        "+ ThumbHash (Rust); the serial tier is chromahash TypeScript/Python + ThumbHash (JS).",
    ]
    return "\n".join(lines)


def generate_charts(
    medians: dict[str, dict[tuple[str, str], float]],
    output_dir: Path,
    count: int,
    tier: int,
) -> None:
    """Two charts: single-mode (startup-dominated) and bulk per-op (real compute)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    names = list(HARNESSES.keys())
    x = np.arange(len(names))
    width = 0.38

    # ── Single-mode (startup-dominated) ──
    fig, ax = plt.subplots(figsize=(12, 6))
    for i, op in enumerate(OPERATIONS):
        vals = [medians.get(n, {}).get((op, "single"), np.nan) * 1000 for n in names]
        ax.bar(x + i * width, vals, width, label=op)
    ax.set_ylabel("Median time (ms)")
    ax.set_title(f"Single call, tier {tier} — process startup + one op (startup-dominated)")
    ax.set_xticks(x + width / 2)
    ax.set_xticklabels(names, rotation=30, ha="right")
    ax.set_yscale("log")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(output_dir / f"benchmark-t{tier}-single.png", dpi=150)
    plt.close(fig)
    print(f"  Saved {output_dir / f'benchmark-t{tier}-single.png'}")

    # ── Bulk per-op (real compute) ──
    fig, ax = plt.subplots(figsize=(12, 6))
    for i, op in enumerate(OPERATIONS):
        vals = [medians.get(n, {}).get((op, "bulk"), np.nan) / count * 1e6 for n in names]
        ax.bar(x + i * width, vals, width, label=op)
    ax.set_ylabel("Per-op time (µs)")
    ax.set_title(f"Bulk {count}, tier {tier} — per-op compute (median / count)")
    ax.set_xticks(x + width / 2)
    ax.set_xticklabels(names, rotation=30, ha="right")
    ax.set_yscale("log")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(output_dir / f"benchmark-t{tier}-bulk.png", dpi=150)
    plt.close(fig)
    print(f"  Saved {output_dir / f'benchmark-t{tier}-bulk.png'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="ChromaHash vs ThumbHash performance benchmark")
    parser.add_argument(
        "--output-dir", type=Path, default=OUTPUT_DIR_DEFAULT, help="Directory for benchmark output"
    )
    parser.add_argument("--warmup", type=int, default=3, help="Number of warmup runs per benchmark")
    parser.add_argument("--min-runs", type=int, default=10, help="Minimum number of timed runs")
    parser.add_argument(
        "--bulk-count", type=int, default=DEFAULT_BULK_COUNT, help="Images per bulk run"
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT,
        help=(
            "Per-comparison hyperfine timeout in seconds. One comparison times all "
            "harnesses, so the serial-tier (Python/TypeScript) bulk runs dominate and "
            "scale with the machine; raise this on slower hosts."
        ),
    )
    parser.add_argument("--skip-build", action="store_true", help="Skip building harnesses")
    parser.add_argument(
        "--tiers",
        type=parse_tiers,
        default=[DEFAULT_TIER],
        metavar="CODES",
        help=(
            f"chromahash quality tier codes to benchmark: a comma-separated list "
            f"(0-{MAX_TIER}, ordered by quality), or 'all' for every shipped tier. "
            f"Default {DEFAULT_TIER} (the 32-byte tier); 0 is the 21-byte compact "
            "tier, and each higher code carries more detail in more bytes (~4x per "
            "code). ThumbHash baselines ignore this and are measured once."
        ),
    )
    args = parser.parse_args()

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_build:
        build_harnesses()

    # One full sweep per tier. The fixtures differ per tier (the decode hash is
    # that tier's), so each tier gets its own temp dir, its own JSON files and
    # its own charts; the summary stitches them into one table.
    medians_by_tier: dict[int, dict] = {}
    for tier in args.tiers:
        print(f"\nPreparing fixtures (100×100 gradient + decode hashes, tier {tier})...")
        with tempfile.TemporaryDirectory(prefix="chromahash-bench-") as tmp_dir:
            files = prepare_fixtures(Path(tmp_dir), tier)

            print(
                f"\nRunning benchmarks, tier {tier} "
                f"({len(OPERATIONS)} operations × {len(MODES)} modes)..."
            )
            all_results = run_benchmarks(
                files, output_dir, args.warmup, args.min_runs, args.bulk_count, args.timeout, tier
            )

        if not all_results:
            print(f"No benchmark results collected at tier {tier}")
            sys.exit(1)

        medians_by_tier[tier] = collect_medians(all_results)

        print(f"\nGenerating charts (tier {tier})...")
        generate_charts(medians_by_tier[tier], output_dir, args.bulk_count, tier)

    table = format_table(medians_by_tier, args.bulk_count)
    print("\n" + table)
    (output_dir / "benchmark-summary.md").write_text(table + "\n")
    print(f"\nResults saved to {output_dir}")


if __name__ == "__main__":
    main()
