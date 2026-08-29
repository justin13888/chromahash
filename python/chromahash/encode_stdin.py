"""CLI harness: ChromaHash encode/decode/average-color via stdin/stdout."""

import os
import sys

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
    )
    sys.exit(1)


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

    else:
        usage()


if __name__ == "__main__":
    main()
