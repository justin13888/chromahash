#!/usr/bin/env python3
"""Performance benchmark for chromahash — all 7 language implementations.

Runs hyperfine to compare encode, decode, and average-color across
Rust, TypeScript, Go, Python, Kotlin, Swift, and C#.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent

FIXTURES_DIR_DEFAULT = ROOT / "tools" / "comparison" / "fixtures" / "synthetic"
OUTPUT_DIR_DEFAULT = Path(__file__).resolve().parent / "output"

# Gamut detection from fixture filename
GAMUT_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"gamut[_-]p3", re.IGNORECASE), "displayp3"),
    (re.compile(r"gamut[_-]adobe[_-]?rgb", re.IGNORECASE), "adobergb"),
    (re.compile(r"gamut[_-]bt2020", re.IGNORECASE), "bt2020"),
    (re.compile(r"gamut[_-]prophoto", re.IGNORECASE), "prophoto"),
]

HARNESSES: dict[str, dict[str, str]] = {
    "Rust": {"cmd": str(ROOT / "rust/target/release/examples/encode_stdin")},
    "Go": {"cmd": str(ROOT / "go/encode-stdin")},
    "TypeScript": {"cmd": f"node {ROOT / 'typescript/dist/encode-stdin.js'}"},
    "Python": {
        "cmd": f"uv run python -m chromahash.encode_stdin",
        "cwd": str(ROOT / "python"),
    },
    "Kotlin": {
        "cmd": str(ROOT / "kotlin/build/install/chromahash/bin/chromahash"),
    },
    "Swift": {"cmd": str(ROOT / "swift/.build/release/ChromaHashCLI")},
    "C#": {
        "cmd": f"dotnet exec {ROOT / 'csharp/src/Chromahash.Cli/bin/Release/net9.0/Chromahash.Cli.dll'}",
    },
}

OPERATIONS = ["encode", "decode", "average-color"]


def detect_gamut(filename: str) -> str:
    for pattern, gamut in GAMUT_PATTERNS:
        if pattern.search(filename):
            return gamut
    return "srgb"


def build_harnesses() -> None:
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
        (
            "TypeScript",
            [
                "pnpm",
                "--prefix",
                str(ROOT / "typescript"),
                "run",
                "build",
            ],
            str(ROOT),
        ),
        (
            "Go",
            ["go", "build", "-o", str(ROOT / "go/encode-stdin"), "./cmd/encode-stdin"],
            str(ROOT / "go"),
        ),
        (
            "Kotlin",
            ["./gradlew", "installDist", "-q"],
            str(ROOT / "kotlin"),
        ),
        (
            "Swift",
            ["swift", "build", "-c", "release"],
            str(ROOT / "swift"),
        ),
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
    ]

    for label, cmd, cwd in steps:
        print(f"  Building {label}...")
        try:
            subprocess.run(
                cmd,
                cwd=cwd,
                check=True,
                capture_output=True,
                timeout=120,
            )
        except subprocess.CalledProcessError as e:
            print(f"  WARNING: {label} build failed: {e.stderr.decode()[:200]}")
        except FileNotFoundError:
            print(f"  WARNING: {label} build command not found, skipping")


def prepare_fixtures(
    fixtures_dir: Path, tmp_dir: Path
) -> list[dict[str, str | int]]:
    """Load PNGs, extract RGBA bytes and produce hashes via Rust."""
    fixtures = []
    png_files = sorted(fixtures_dir.glob("*.png"))
    if not png_files:
        print(f"No PNG files found in {fixtures_dir}")
        sys.exit(1)

    rust_cmd = HARNESSES["Rust"]["cmd"]

    for png_path in png_files:
        name = png_path.stem
        img = Image.open(png_path).convert("RGBA")
        w, h = img.size
        rgba_bytes = img.tobytes()

        rgba_file = tmp_dir / f"{name}.rgba"
        rgba_file.write_bytes(rgba_bytes)

        gamut = detect_gamut(name)

        # Produce hash using Rust encode
        result = subprocess.run(
            [rust_cmd, "encode", str(w), str(h), gamut],
            input=rgba_bytes,
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            print(f"  WARNING: Rust encode failed for {name}: {result.stderr.decode()[:200]}")
            continue

        hash_bytes = result.stdout
        if len(hash_bytes) != 32:
            print(f"  WARNING: Rust encode returned {len(hash_bytes)} bytes for {name}")
            continue

        hash_file = tmp_dir / f"{name}.hash"
        hash_file.write_bytes(hash_bytes)

        fixtures.append(
            {
                "name": name,
                "rgba_file": str(rgba_file),
                "hash_file": str(hash_file),
                "width": w,
                "height": h,
                "gamut": gamut,
                "pixels": w * h,
            }
        )

    print(f"Prepared {len(fixtures)} fixtures")
    return fixtures


def build_hyperfine_cmd(
    operation: str,
    fixture: dict[str, str | int],
    warmup: int,
    min_runs: int,
    output_json: str,
) -> list[str]:
    """Build a hyperfine command comparing all languages for one (operation, fixture) pair."""
    cmd = [
        "hyperfine",
        "--warmup",
        str(warmup),
        "--min-runs",
        str(min_runs),
        "--export-json",
        output_json,
    ]

    for lang, config in HARNESSES.items():
        harness_cmd = config["cmd"]
        cwd = config.get("cwd")

        if operation == "encode":
            w = fixture["width"]
            h = fixture["height"]
            gamut = fixture["gamut"]
            rgba_file = fixture["rgba_file"]
            if cwd:
                bench_cmd = f"cd {cwd} && {harness_cmd} encode {w} {h} {gamut} < {rgba_file}"
            else:
                bench_cmd = f"{harness_cmd} encode {w} {h} {gamut} < {rgba_file}"
        elif operation == "decode":
            hash_file = fixture["hash_file"]
            if cwd:
                bench_cmd = f"cd {cwd} && {harness_cmd} decode < {hash_file}"
            else:
                bench_cmd = f"{harness_cmd} decode < {hash_file}"
        elif operation == "average-color":
            hash_file = fixture["hash_file"]
            if cwd:
                bench_cmd = f"cd {cwd} && {harness_cmd} average-color < {hash_file}"
            else:
                bench_cmd = f"{harness_cmd} average-color < {hash_file}"
        else:
            raise ValueError(f"unknown operation: {operation}")

        cmd.extend(["-n", lang, bench_cmd])

    return cmd


def run_benchmarks(
    fixtures: list[dict[str, str | int]],
    output_dir: Path,
    warmup: int,
    min_runs: int,
) -> list[dict]:
    """Run hyperfine for each (operation, fixture) pair."""
    results_dir = output_dir / "json"
    results_dir.mkdir(parents=True, exist_ok=True)

    all_results = []
    total = len(fixtures) * len(OPERATIONS)
    idx = 0

    for fixture in fixtures:
        for operation in OPERATIONS:
            idx += 1
            name = fixture["name"]
            json_file = str(results_dir / f"{name}_{operation}.json")

            print(f"  [{idx}/{total}] {operation} — {name}")

            cmd = build_hyperfine_cmd(
                operation, fixture, warmup, min_runs, json_file
            )

            try:
                subprocess.run(
                    cmd,
                    check=True,
                    capture_output=True,
                    timeout=300,
                )
            except subprocess.CalledProcessError as e:
                print(f"    WARNING: hyperfine failed: {e.stderr.decode()[:300]}")
                continue
            except FileNotFoundError:
                print("    ERROR: hyperfine not found. Install it: https://github.com/sharkdp/hyperfine")
                sys.exit(1)

            try:
                with open(json_file) as f:
                    data = json.load(f)
                data["_fixture"] = name
                data["_operation"] = operation
                data["_pixels"] = fixture["pixels"]
                all_results.append(data)
            except (json.JSONDecodeError, FileNotFoundError) as e:
                print(f"    WARNING: failed to parse results: {e}")

    return all_results


def parse_results(
    all_results: list[dict],
) -> dict[str, dict[str, list[float]]]:
    """Parse hyperfine JSON into {lang: {operation: [median_times]}}."""
    lang_op_times: dict[str, dict[str, list[float]]] = {}

    for result in all_results:
        operation = result["_operation"]
        for bench in result.get("results", []):
            lang = bench["command"]
            median = bench["median"]
            lang_op_times.setdefault(lang, {}).setdefault(operation, []).append(
                median
            )

    return lang_op_times


def generate_charts(
    all_results: list[dict], output_dir: Path
) -> None:
    """Generate summary, detail, and size-breakdown charts."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    languages = list(HARNESSES.keys())
    operations = OPERATIONS

    # ── Summary chart: grouped bars, avg median per (lang, op) ──
    lang_op_avg: dict[str, dict[str, float]] = {}
    lang_op_counts: dict[str, dict[str, int]] = {}

    for result in all_results:
        operation = result["_operation"]
        for bench in result.get("results", []):
            lang = bench["command"]
            median = bench["median"]
            lang_op_avg.setdefault(lang, {}).setdefault(operation, 0.0)
            lang_op_counts.setdefault(lang, {}).setdefault(operation, 0)
            lang_op_avg[lang][operation] += median
            lang_op_counts[lang][operation] += 1

    for lang in lang_op_avg:
        for op in lang_op_avg[lang]:
            count = lang_op_counts[lang].get(op, 1)
            if count > 0:
                lang_op_avg[lang][op] /= count

    fig, ax = plt.subplots(figsize=(12, 6))
    x = np.arange(len(languages))
    width = 0.25

    for i, op in enumerate(operations):
        vals = [lang_op_avg.get(lang, {}).get(op, 0) * 1000 for lang in languages]
        ax.bar(x + i * width, vals, width, label=op)

    ax.set_ylabel("Median Time (ms)")
    ax.set_title("ChromaHash Benchmark — Average Across All Fixtures")
    ax.set_xticks(x + width)
    ax.set_xticklabels(languages, rotation=30, ha="right")
    ax.set_yscale("log")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(output_dir / "benchmark-summary.png", dpi=150)
    plt.close(fig)
    print(f"  Saved {output_dir / 'benchmark-summary.png'}")

    # ── Detail chart: heatmap of median times ──
    fixture_names = []
    seen = set()
    for r in all_results:
        name = r["_fixture"]
        if name not in seen:
            fixture_names.append(name)
            seen.add(name)

    # Build matrix: rows=fixtures, cols=languages*operations
    col_labels = [f"{lang}\n{op}" for op in operations for lang in languages]
    matrix = np.full((len(fixture_names), len(col_labels)), np.nan)

    fixture_idx = {name: i for i, name in enumerate(fixture_names)}

    for result in all_results:
        fname = result["_fixture"]
        operation = result["_operation"]
        row = fixture_idx[fname]
        for bench in result.get("results", []):
            lang = bench["command"]
            try:
                op_offset = operations.index(operation)
                lang_offset = languages.index(lang)
                col = op_offset * len(languages) + lang_offset
                matrix[row, col] = bench["median"] * 1000
            except ValueError:
                continue

    if len(fixture_names) > 0:
        fig, ax = plt.subplots(
            figsize=(max(14, len(col_labels) * 0.8), max(8, len(fixture_names) * 0.35))
        )
        im = ax.imshow(matrix, aspect="auto", cmap="YlOrRd")
        ax.set_xticks(range(len(col_labels)))
        ax.set_xticklabels(col_labels, rotation=60, ha="right", fontsize=7)
        ax.set_yticks(range(len(fixture_names)))
        ax.set_yticklabels(fixture_names, fontsize=7)
        ax.set_title("ChromaHash Benchmark — Per-Fixture Detail (ms)")
        fig.colorbar(im, label="ms")
        fig.tight_layout()
        fig.savefig(output_dir / "benchmark-detail.png", dpi=150)
        plt.close(fig)
        print(f"  Saved {output_dir / 'benchmark-detail.png'}")

    # ── Size breakdown: encode time vs pixel count ──
    lang_pixels: dict[str, list[tuple[int, float]]] = {}
    for result in all_results:
        if result["_operation"] != "encode":
            continue
        pixels = result["_pixels"]
        for bench in result.get("results", []):
            lang = bench["command"]
            lang_pixels.setdefault(lang, []).append((pixels, bench["median"] * 1000))

    if lang_pixels:
        fig, ax = plt.subplots(figsize=(10, 6))
        for lang in languages:
            pts = lang_pixels.get(lang, [])
            if not pts:
                continue
            pts.sort()
            px = [p[0] for p in pts]
            ms = [p[1] for p in pts]
            ax.plot(px, ms, "o-", label=lang, markersize=3)

        ax.set_xlabel("Image Size (pixels)")
        ax.set_ylabel("Encode Time (ms)")
        ax.set_title("ChromaHash Encode Time vs Image Size")
        ax.set_xscale("log")
        ax.set_yscale("log")
        ax.legend()
        ax.grid(alpha=0.3)
        fig.tight_layout()
        fig.savefig(output_dir / "benchmark-by-size.png", dpi=150)
        plt.close(fig)
        print(f"  Saved {output_dir / 'benchmark-by-size.png'}")


def print_summary_table(all_results: list[dict]) -> None:
    """Print a markdown summary table to stdout."""
    languages = list(HARNESSES.keys())

    # Collect avg medians per (lang, op)
    sums: dict[str, dict[str, float]] = {}
    counts: dict[str, dict[str, int]] = {}

    for result in all_results:
        operation = result["_operation"]
        for bench in result.get("results", []):
            lang = bench["command"]
            median = bench["median"]
            sums.setdefault(lang, {}).setdefault(operation, 0.0)
            counts.setdefault(lang, {}).setdefault(operation, 0)
            sums[lang][operation] += median
            counts[lang][operation] += 1

    print("\n## Benchmark Summary (average median across all fixtures)\n")
    header = "| Language | " + " | ".join(OPERATIONS) + " |"
    sep = "|" + "|".join(["---"] * (len(OPERATIONS) + 1)) + "|"
    print(header)
    print(sep)

    for lang in languages:
        row = f"| {lang} |"
        for op in OPERATIONS:
            s = sums.get(lang, {}).get(op, 0)
            c = counts.get(lang, {}).get(op, 0)
            if c > 0:
                avg_ms = (s / c) * 1000
                row += f" {avg_ms:.2f} ms |"
            else:
                row += " N/A |"
        print(row)


def main() -> None:
    parser = argparse.ArgumentParser(description="ChromaHash performance benchmark")
    parser.add_argument(
        "--fixtures-dir",
        type=Path,
        default=FIXTURES_DIR_DEFAULT,
        help="Directory containing synthetic PNG fixtures",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=OUTPUT_DIR_DEFAULT,
        help="Directory for benchmark output",
    )
    parser.add_argument(
        "--warmup",
        type=int,
        default=3,
        help="Number of warmup runs per benchmark",
    )
    parser.add_argument(
        "--min-runs",
        type=int,
        default=10,
        help="Minimum number of timed runs",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip building harnesses",
    )
    args = parser.parse_args()

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if not args.skip_build:
        build_harnesses()

    print("\nPreparing fixtures...")
    with tempfile.TemporaryDirectory(prefix="chromahash-bench-") as tmp_dir:
        fixtures = prepare_fixtures(args.fixtures_dir, Path(tmp_dir))

        if not fixtures:
            print("No fixtures to benchmark")
            sys.exit(1)

        print(f"\nRunning benchmarks ({len(fixtures)} fixtures × {len(OPERATIONS)} operations)...")
        all_results = run_benchmarks(fixtures, output_dir, args.warmup, args.min_runs)

    if not all_results:
        print("No benchmark results collected")
        sys.exit(1)

    print("\nGenerating charts...")
    generate_charts(all_results, output_dir)

    print_summary_table(all_results)
    print(f"\nResults saved to {output_dir}")


if __name__ == "__main__":
    main()
