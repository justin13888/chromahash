"""CLI harness: read RGBA from stdin, encode to ChromaHash, write hash to stdout."""

import sys

from chromahash import ChromaHash, Gamut


def main() -> None:
    if len(sys.argv) != 4:
        sys.stderr.write("Usage: encode_stdin <width> <height> <gamut>\n")
        sys.exit(1)

    w = int(sys.argv[1])
    h = int(sys.argv[2])

    gamut_map = {
        "srgb": Gamut.SRGB,
        "displayp3": Gamut.DISPLAY_P3,
        "adobergb": Gamut.ADOBE_RGB,
        "bt2020": Gamut.BT2020,
        "prophoto": Gamut.PROPHOTO_RGB,
    }

    gamut = gamut_map.get(sys.argv[3])
    if gamut is None:
        sys.stderr.write(f"unknown gamut: {sys.argv[3]}\n")
        sys.exit(1)

    expected_len = w * h * 4
    rgba = sys.stdin.buffer.read(expected_len)
    if len(rgba) != expected_len:
        sys.stderr.write(f"expected {expected_len} bytes, got {len(rgba)}\n")
        sys.exit(1)

    ch = ChromaHash.encode(w, h, rgba, gamut)
    sys.stdout.buffer.write(ch.as_bytes())


if __name__ == "__main__":
    main()
