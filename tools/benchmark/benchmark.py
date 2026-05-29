#!/usr/bin/env python3
"""Performance benchmark for chromahash vs. ThumbHash baseline.

Runs hyperfine to compare **encode** and **decode** in two regimes — a **single**
call and a **bulk 1000** (batched) run — across all 7 chromahash language
implementations (Rust, TypeScript, Go, Python, Kotlin, Swift, C#) plus ThumbHash
(the JS reference implementation) as a baseline.

The input is a fixed 100x100 sRGB RGB gradient. The size is dictated by ThumbHash,
which caps the longest dimension at ~100px.

IMPORTANT — interpreting the numbers:
  * single-mode times are dominated by **process startup** (JVM/.NET/Node cold
    start swamps the microsecond-scale op). They are a startup/latency proxy, not
    per-op compute.
  * bulk-mode runs 1000 ops in one process, amortizing startup. The bulk
    **per-op** time (median / count) is the real compute number, and reflects the
    parallel batch encoder (Rust/Go/Kotlin/Swift/C#) vs. the serial one
    (TypeScript/Python, and ThumbHash's loop).
"""

from __future__ import annotations

import argparse
import json
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

# chromahash in 7 languages + ThumbHash (JS reference baseline).
# "thumbhash": True marks the baseline whose command shape differs — it takes no
# gamut argument and decodes its own (variable-length) hash.
HARNESSES: dict[str, dict] = {
    "Rust": {"cmd": str(ROOT / "rust/target/release/examples/encode_stdin")},
    "Go": {"cmd": str(ROOT / "go/encode-stdin")},
    "TypeScript": {"cmd": f"node {ROOT / 'typescript/dist/encode-stdin.js'}"},
    "Python": {
        "cmd": "uv run python -m chromahash.encode_stdin",
        "cwd": str(ROOT / "python"),
    },
    "Kotlin": {"cmd": str(ROOT / "kotlin/build/install/chromahash/bin/chromahash")},
    "Swift": {"cmd": str(ROOT / "swift/.build/release/ChromaHashCLI")},
    "C#": {
        "cmd": f"dotnet exec {ROOT / 'csharp/src/Chromahash.Cli/bin/Release/net9.0/Chromahash.Cli.dll'}",
    },
    "ThumbHash": {
        "cmd": f"node {ROOT / 'tools/comparison/dist/thumbhash-stdin.js'}",
        "thumbhash": True,
    },
}

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
        ("Go", ["go", "build", "-o", str(ROOT / "go/encode-stdin"), "./cmd/encode-stdin"], str(ROOT / "go")),
        ("Kotlin", ["./gradlew", "installDist", "-q"], str(ROOT / "kotlin")),
        ("Swift", ["swift", "build", "-c", "release"], str(ROOT / "swift")),
        (
            "C#",
            ["dotnet", "build", str(ROOT / "csharp/src/Chromahash.Cli"), "-c", "Release", "--verbosity", "quiet"],
            str(ROOT),
        ),
        # ThumbHash harness lives in the comparison tool (which owns the dep).
        ("ThumbHash", ["pnpm", "--prefix", str(ROOT / "tools/comparison"), "run", "build"], str(ROOT)),
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


def run_harness(config: dict, sub_args: list[str], stdin_bytes: bytes) -> bytes:
    """Run a harness once with sub_args, feeding stdin_bytes; return stdout."""
    parts = shlex.split(config["cmd"]) + sub_args
    result = subprocess.run(
        parts,
        input=stdin_bytes,
        capture_output=True,
        cwd=config.get("cwd"),
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode()[:300])
    return result.stdout


def prepare_fixtures(tmp_dir: Path) -> dict[str, Path]:
    """Write the gradient and the two decode-hash fixtures to tmp_dir.

    chromahash hashes are byte-identical across all 7 languages (spec guarantee),
    so one shared hash (produced by the Rust harness) drives every chromahash
    decode. ThumbHash decodes its own, semantically different hash.
    """
    gradient = make_gradient_rgba(GRADIENT_W, GRADIENT_H)
    gradient_file = tmp_dir / "gradient.rgba"
    gradient_file.write_bytes(gradient)

    chroma_hash = run_harness(
        HARNESSES["Rust"], ["encode", str(GRADIENT_W), str(GRADIENT_H), GAMUT], gradient
    )
    if len(chroma_hash) != 32:
        print(f"ERROR: Rust encode returned {len(chroma_hash)} bytes (expected 32)")
        sys.exit(1)
    chroma_hash_file = tmp_dir / "chroma.hash"
    chroma_hash_file.write_bytes(chroma_hash)

    thumb_hash = run_harness(
        HARNESSES["ThumbHash"], ["encode", str(GRADIENT_W), str(GRADIENT_H)], gradient
    )
    if not thumb_hash:
        print("ERROR: ThumbHash encode returned no bytes")
        sys.exit(1)
    thumb_hash_file = tmp_dir / "thumb.hash"
    thumb_hash_file.write_bytes(thumb_hash)

    return {
        "gradient": gradient_file,
        "chroma_hash": chroma_hash_file,
        "thumb_hash": thumb_hash_file,
    }


def harness_command(
    config: dict, operation: str, mode: str, count: int, files: dict[str, Path]
) -> str:
    """Build the shell command for one (harness, operation, mode) cell."""
    cmd = config["cmd"]
    is_thumb = config.get("thumbhash", False)
    gamut_arg = "" if is_thumb else f" {GAMUT}"

    if operation == "encode":
        verb = "encode" if mode == "single" else "batch-encode"
        count_arg = "" if mode == "single" else f" {count}"
        sub = f"{verb} {GRADIENT_W} {GRADIENT_H}{gamut_arg}{count_arg}"
        redirect = files["gradient"]
    else:  # decode
        sub = "decode" if mode == "single" else f"batch-decode {count}"
        redirect = files["thumb_hash"] if is_thumb else files["chroma_hash"]

    full = f"{cmd} {sub} < {redirect}"
    cwd = config.get("cwd")
    if cwd:
        full = f"cd {cwd} && {full}"
    return full


def run_benchmarks(
    files: dict[str, Path],
    output_dir: Path,
    warmup: int,
    min_runs: int,
    count: int,
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
            json_file = results_dir / f"{operation}_{mode}.json"
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
                cmd.extend(["-n", name, harness_command(config, operation, mode, count, files)])

            try:
                subprocess.run(cmd, check=True, capture_output=True, timeout=900)
            except subprocess.CalledProcessError as e:
                print(f"    WARNING: hyperfine failed: {e.stderr.decode()[:300]}")
                continue
            except FileNotFoundError:
                print("    ERROR: hyperfine not found. Install it: https://github.com/sharkdp/hyperfine")
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


def format_table(medians: dict[str, dict[tuple[str, str], float]], count: int) -> str:
    """Build the markdown summary table."""
    lines = [
        f"## Benchmark Summary — 100×100 RGB gradient, bulk count = {count}",
        "",
        "| Implementation | encode single | decode single | encode bulk (total) | encode bulk (per-op) | decode bulk (total) | decode bulk (per-op) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]

    def ms(name: str, op: str, mode: str) -> str:
        v = medians.get(name, {}).get((op, mode))
        return f"{v * 1000:.2f} ms" if v is not None else "N/A"

    def per_op_us(name: str, op: str) -> str:
        v = medians.get(name, {}).get((op, "bulk"))
        return f"{v / count * 1e6:.2f} µs" if v is not None else "N/A"

    for name in HARNESSES:
        label = f"{name} _(baseline)_" if HARNESSES[name].get("thumbhash") else name
        lines.append(
            f"| {label} | {ms(name, 'encode', 'single')} | {ms(name, 'decode', 'single')} "
            f"| {ms(name, 'encode', 'bulk')} | {per_op_us(name, 'encode')} "
            f"| {ms(name, 'decode', 'bulk')} | {per_op_us(name, 'decode')} |"
        )

    lines += [
        "",
        "> **single** times include process startup (JVM/.NET/Node cold start dominates) "
        "— a startup/latency proxy, not per-op compute. **bulk per-op** (= median / count) "
        "is the real compute number.",
    ]
    return "\n".join(lines)


def generate_charts(
    medians: dict[str, dict[tuple[str, str], float]], output_dir: Path, count: int
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
    ax.set_title("Single call — process startup + one op (startup-dominated)")
    ax.set_xticks(x + width / 2)
    ax.set_xticklabels(names, rotation=30, ha="right")
    ax.set_yscale("log")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(output_dir / "benchmark-single.png", dpi=150)
    plt.close(fig)
    print(f"  Saved {output_dir / 'benchmark-single.png'}")

    # ── Bulk per-op (real compute) ──
    fig, ax = plt.subplots(figsize=(12, 6))
    for i, op in enumerate(OPERATIONS):
        vals = [medians.get(n, {}).get((op, "bulk"), np.nan) / count * 1e6 for n in names]
        ax.bar(x + i * width, vals, width, label=op)
    ax.set_ylabel("Per-op time (µs)")
    ax.set_title(f"Bulk {count} — per-op compute (median / count)")
    ax.set_xticks(x + width / 2)
    ax.set_xticklabels(names, rotation=30, ha="right")
    ax.set_yscale("log")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(output_dir / "benchmark-bulk.png", dpi=150)
    plt.close(fig)
    print(f"  Saved {output_dir / 'benchmark-bulk.png'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="ChromaHash vs ThumbHash performance benchmark")
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR_DEFAULT, help="Directory for benchmark output")
    parser.add_argument("--warmup", type=int, default=3, help="Number of warmup runs per benchmark")
    parser.add_argument("--min-runs", type=int, default=10, help="Minimum number of timed runs")
    parser.add_argument("--bulk-count", type=int, default=DEFAULT_BULK_COUNT, help="Images per bulk run")
    parser.add_argument("--skip-build", action="store_true", help="Skip building harnesses")
    args = parser.parse_args()

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_build:
        build_harnesses()

    print("\nPreparing fixtures (100×100 gradient + decode hashes)...")
    with tempfile.TemporaryDirectory(prefix="chromahash-bench-") as tmp_dir:
        files = prepare_fixtures(Path(tmp_dir))

        print(f"\nRunning benchmarks ({len(OPERATIONS)} operations × {len(MODES)} modes)...")
        all_results = run_benchmarks(files, output_dir, args.warmup, args.min_runs, args.bulk_count)

    if not all_results:
        print("No benchmark results collected")
        sys.exit(1)

    medians = collect_medians(all_results)

    print("\nGenerating charts...")
    generate_charts(medians, output_dir, args.bulk_count)

    table = format_table(medians, args.bulk_count)
    print("\n" + table)
    (output_dir / "benchmark-summary.md").write_text(table + "\n")
    print(f"\nResults saved to {output_dir}")


if __name__ == "__main__":
    main()
