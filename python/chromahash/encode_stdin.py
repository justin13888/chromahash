"""CLI harness: ChromaHash encode/decode/average-color via stdin/stdout."""

import os
import sys
import time

from chromahash import (
    DEFAULT_TIER,
    MAX_TIER,
    BatchEncoder,
    ChromaHash,
    Gamut,
    ImageInput,
)

GAMUT_MAP = {
    "srgb": Gamut.SRGB,
    "displayp3": Gamut.DISPLAY_P3,
    "adobergb": Gamut.ADOBE_RGB,
    "bt2020": Gamut.BT2020,
    "prophoto": Gamut.PROPHOTO_RGB,
}


def tier_from_env() -> int:
    """Quality tier from CHROMAHASH_TIER, matching the Rust harness so the
    cross-language benchmark measures the same workload in every language.
    Defaults to the 32-byte tier."""
    raw = os.environ.get("CHROMAHASH_TIER")
    if not raw:
        return DEFAULT_TIER
    try:
        tier = int(raw)
    except ValueError:
        tier = -1
    if not 0 <= tier <= MAX_TIER:
        sys.stderr.write(f"CHROMAHASH_TIER: {raw!r} is not a valid tier code (0..={MAX_TIER})\n")
        sys.exit(1)
    return tier


def usage() -> None:
    sys.stderr.write(
        "Usage:\n"
        "  encode_stdin encode <width> <height> <gamut>\n"
        "  encode_stdin decode\n"
        "  encode_stdin average-color\n"
        "  encode_stdin batch-encode <width> <height> <gamut> <count>\n"
        "  encode_stdin batch-decode <count>\n"
        "  encode_stdin bench-encode <width> <height> <gamut> <iters>\n"
        "  encode_stdin bench-decode <iters> [max_width max_height]\n"
        "  encode_stdin bench-batch <width> <height> <gamut> <count>\n"
        "  encode_stdin bench-info\n"
    )
    sys.exit(1)


def reject_rust_only_env() -> None:
    """Fail loudly if asked for a knob only the Rust harness has.

    CHROMAHASH_TUNE overrides format constants through chromahash::Tunables,
    which no binding exposes; CHROMAHASH_OUT selects a decode output gamut this
    CLI does not implement. Ignoring either silently is the dangerous failure: a
    sweep would label shipped-default numbers as an ablation and nothing
    downstream could tell.
    """
    for key in ("CHROMAHASH_TUNE", "CHROMAHASH_OUT"):
        if os.environ.get(key):
            sys.stderr.write(
                f"{key} is not supported by this harness (Rust-only); refusing to "
                "report numbers that would be silently mislabelled\n"
            )
            sys.exit(1)


def _bench_env_int(key: str, default: int) -> int:
    raw = os.environ.get(key)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        sys.stderr.write(f"{key}: invalid value {raw!r}\n")
        sys.exit(1)


def run_bench(iters, op) -> None:
    """Warm up for CHROMAHASH_BENCH_WARMUP_MS, then run CHROMAHASH_BENCH_REPS
    timed blocks of `iters` iterations, printing one mean-ns/op line per block
    on stdout. Everything else goes to stderr.

    Warmup is time-based rather than count-based because this contract is shared
    across seven harnesses whose per-op costs differ by two orders of magnitude
    — a fixed count is either useless for Rust or minutes for Python.
    """
    reps = max(1, _bench_env_int("CHROMAHASH_BENCH_REPS", 1))
    warmup_ns = _bench_env_int("CHROMAHASH_BENCH_WARMUP_MS", 0) * 1_000_000
    iters = max(1, iters)
    acc = 0

    # At least one iteration, so the default also validates the input before the
    # first timed block.
    warm_start = time.perf_counter_ns()
    while True:
        acc ^= op()
        if time.perf_counter_ns() - warm_start >= warmup_ns:
            break

    for _ in range(reps):
        start = time.perf_counter_ns()
        for _ in range(iters):
            acc ^= op()
        sys.stdout.write(f"{(time.perf_counter_ns() - start) // iters}\n")
    sys.stdout.flush()
    sys.stderr.write(f"checksum={acc:x}\niters={iters}\n")


def main() -> None:
    if len(sys.argv) < 2:
        usage()

    subcommand = sys.argv[1]

    if subcommand == "encode":
        if len(sys.argv) != 5:
            sys.stderr.write("Usage: encode_stdin encode <width> <height> <gamut>\n")
            sys.exit(1)

        w = int(sys.argv[2])
        h = int(sys.argv[3])

        gamut = GAMUT_MAP.get(sys.argv[4])
        if gamut is None:
            sys.stderr.write(f"unknown gamut: {sys.argv[4]}\n")
            sys.exit(1)

        expected_len = w * h * 4
        rgba = sys.stdin.buffer.read(expected_len)
        if len(rgba) != expected_len:
            sys.stderr.write(f"expected {expected_len} bytes, got {len(rgba)}\n")
            sys.exit(1)

        ch = ChromaHash.encode_with_quality(w, h, rgba, gamut, tier_from_env())
        sys.stdout.buffer.write(ch.as_bytes())

    elif subcommand == "decode":
        hash_bytes = sys.stdin.buffer.read()
        ch = ChromaHash.from_bytes(hash_bytes)
        _w, _h, rgba = ch.decode()
        sys.stdout.buffer.write(rgba)

    elif subcommand == "average-color":
        hash_bytes = sys.stdin.buffer.read()
        ch = ChromaHash.from_bytes(hash_bytes)
        r, g, b, a = ch.average_color()
        sys.stdout.buffer.write(bytes([r, g, b, a]))

    elif subcommand == "batch-encode":
        # Read one image, encode it `count` times through the BatchEncoder
        # (serial under the GIL). Used to benchmark bulk throughput.
        if len(sys.argv) != 6:
            sys.stderr.write("Usage: encode_stdin batch-encode <width> <height> <gamut> <count>\n")
            sys.exit(1)

        w = int(sys.argv[2])
        h = int(sys.argv[3])
        gamut = GAMUT_MAP.get(sys.argv[4])
        if gamut is None:
            sys.stderr.write(f"unknown gamut: {sys.argv[4]}\n")
            sys.exit(1)
        count = int(sys.argv[5])

        rgba = sys.stdin.buffer.read(w * h * 4)
        items = [ImageInput(w, h, rgba, gamut, tier_from_env()) for _ in range(count)]
        encoder = BatchEncoder()
        hashes = encoder.encode_batch(items)
        encoder.close()
        # Write one result-derived byte so the work cannot be optimized away.
        sys.stdout.buffer.write(bytes([hashes[0].as_bytes()[0]]))

    elif subcommand == "batch-decode":
        # No batch decode API exists; loop the single decode `count` times.
        if len(sys.argv) != 3:
            sys.stderr.write("Usage: encode_stdin batch-decode <count>\n")
            sys.exit(1)

        count = int(sys.argv[2])
        hash_bytes = sys.stdin.buffer.read()
        ch = ChromaHash.from_bytes(hash_bytes)
        acc = 0
        for _ in range(count):
            _w, _h, rgba = ch.decode()
            acc ^= rgba[0]
        sys.stdout.buffer.write(bytes([acc & 0xFF]))

    elif subcommand == "bench-encode":
        if len(sys.argv) != 6:
            sys.stderr.write("Usage: encode_stdin bench-encode <width> <height> <gamut> <iters>\n")
            sys.exit(1)
        reject_rust_only_env()
        w = int(sys.argv[2])
        h = int(sys.argv[3])
        gamut = GAMUT_MAP.get(sys.argv[4])
        if gamut is None:
            sys.stderr.write(f"unknown gamut: {sys.argv[4]}\n")
            sys.exit(1)
        iters = int(sys.argv[5])
        expected_len = w * h * 4
        rgba = sys.stdin.buffer.read(expected_len)
        if len(rgba) != expected_len:
            sys.stderr.write(f"expected {expected_len} bytes, got {len(rgba)}\n")
            sys.exit(1)
        tier = tier_from_env()
        run_bench(
            iters,
            lambda: ChromaHash.encode_with_quality(w, h, rgba, gamut, tier).as_bytes()[0],
        )

    elif subcommand == "bench-decode":
        if len(sys.argv) not in (3, 5):
            sys.stderr.write("Usage: encode_stdin bench-decode <iters> [max_width max_height]\n")
            sys.exit(1)
        reject_rust_only_env()
        iters = int(sys.argv[2])
        ch = ChromaHash.from_bytes(sys.stdin.buffer.read())
        if len(sys.argv) == 5:
            max_w = int(sys.argv[3])
            max_h = int(sys.argv[4])

            def _op() -> int:
                w, h, rgba = ch.decode_capped(max_w, max_h)
                return rgba[0] ^ (w & 0xFF) ^ (h & 0xFF)
        else:

            def _op() -> int:
                w, h, rgba = ch.decode()
                return rgba[0] ^ (w & 0xFF) ^ (h & 0xFF)

        run_bench(iters, _op)

    elif subcommand == "bench-batch":
        if len(sys.argv) != 6:
            sys.stderr.write("Usage: encode_stdin bench-batch <width> <height> <gamut> <count>\n")
            sys.exit(1)
        reject_rust_only_env()
        w = int(sys.argv[2])
        h = int(sys.argv[3])
        gamut = GAMUT_MAP.get(sys.argv[4])
        if gamut is None:
            sys.stderr.write(f"unknown gamut: {sys.argv[4]}\n")
            sys.exit(1)
        count = int(sys.argv[5])
        # This binding's BatchEncoder takes no thread count — it is serial under
        # the GIL — so accept only the values that mean "however many you have".
        threads = _bench_env_int("CHROMAHASH_BATCH_THREADS", 0)
        if threads > 1:
            sys.stderr.write(
                f"CHROMAHASH_BATCH_THREADS={threads}: this binding's BatchEncoder is "
                "serial and takes no thread count\n"
            )
            sys.exit(1)
        rgba = sys.stdin.buffer.read(w * h * 4)
        tier = tier_from_env()
        items = [ImageInput(w, h, rgba, gamut, tier) for _ in range(count)]
        encoder = BatchEncoder()
        # One batch is one iteration, so the printed number is ns per batch.
        run_bench(1, lambda: encoder.encode_batch(items)[0].as_bytes()[0])
        encoder.close()

    elif subcommand == "bench-info":
        sys.stdout.write("runtime=python\n")
        sys.stdout.write(f"python_version={sys.version.split()[0]}\n")
        sys.stdout.write(f"implementation={sys.implementation.name}\n")
        sys.stdout.write(f"threads={os.cpu_count() or 0}\n")

    else:
        usage()


if __name__ == "__main__":
    main()
