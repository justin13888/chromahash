"""CLI harness: ChromaHash encode/decode/average-color via stdin/stdout."""

import sys

from chromahash import ChromaHash, Gamut

GAMUT_MAP = {
    "srgb": Gamut.SRGB,
    "displayp3": Gamut.DISPLAY_P3,
    "adobergb": Gamut.ADOBE_RGB,
    "bt2020": Gamut.BT2020,
    "prophoto": Gamut.PROPHOTO_RGB,
}


def usage() -> None:
    sys.stderr.write(
        "Usage:\n"
        "  encode_stdin encode <width> <height> <gamut>\n"
        "  encode_stdin decode\n"
        "  encode_stdin average-color\n"
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

        ch = ChromaHash.encode(w, h, rgba, gamut)
        sys.stdout.buffer.write(ch.as_bytes())

    elif subcommand == "decode":
        hash_bytes = sys.stdin.buffer.read(32)
        if len(hash_bytes) != 32:
            sys.stderr.write(f"expected 32 bytes, got {len(hash_bytes)}\n")
            sys.exit(1)

        ch = ChromaHash.from_bytes(hash_bytes)
        _w, _h, rgba = ch.decode()
        sys.stdout.buffer.write(rgba)

    elif subcommand == "average-color":
        hash_bytes = sys.stdin.buffer.read(32)
        if len(hash_bytes) != 32:
            sys.stderr.write(f"expected 32 bytes, got {len(hash_bytes)}\n")
            sys.exit(1)

        ch = ChromaHash.from_bytes(hash_bytes)
        r, g, b, a = ch.average_color()
        sys.stdout.buffer.write(bytes([r, g, b, a]))

    else:
        usage()


if __name__ == "__main__":
    main()
