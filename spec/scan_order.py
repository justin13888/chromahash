#!/usr/bin/env python3
"""Generate canonical coefficient scan order tables for ChromaHash.

Enumerates exact (cx, cy) AC coefficient pairs for each grid size used by
ChromaHash, using the triangular selection condition:

    cx * ny < nx * (ny - cy)

Scanned row-major, skipping DC at (0, 0).

Includes all grid configurations produced by deriveGrid() for v0.3 adaptive
grids across all channel types and aspect ratios [1:16, 16:1].

Usage:
    python3 spec/scan_order.py          # pretty-print
    python3 spec/scan_order.py --json   # JSON output
"""
import json
import sys


def triangular_scan_order(nx: int, ny: int) -> list[tuple[int, int]]:
    """Return AC coefficient (cx, cy) pairs in scan order."""
    order = []
    for cy in range(ny):
        cx_start = 1 if cy == 0 else 0
        cx = cx_start
        while cx * ny < nx * (ny - cy):
            order.append((cx, cy))
            cx += 1
    return order


# Square grids (v0.1 fixed grids + alpha-mode base grids)
SQUARE_GRIDS = {
    "3x3": (3, 3),
    "4x4": (4, 4),
    "6x6": (6, 6),
    "7x7": (7, 7),
}

# Non-square grids produced by deriveGrid() for v0.3 adaptive geometry.
# Exhaustive: every (nx, ny) pair produced by deriveGrid() for all 256
# aspect byte values across the v0.3 ratio range [1:16, 16:1],
# organized by channel type.
ADAPTIVE_GRIDS = {
    # Luminance (base_n=7) — 20 non-square grids
    # Portrait (tall)
    "4x14": (4, 14),   # L portrait, ~1:16–1:12
    "4x13": (4, 13),   # L portrait, ~1:12–1:10
    "4x12": (4, 12),   # L portrait, ~1:10–1:8
    "4x11": (4, 11),   # L portrait, ~1:8–1:6
    "5x11": (5, 11),   # L portrait, ~1:6–1:5
    "5x10": (5, 10),   # L portrait, ~1:5–1:4
    "5x9": (5, 9),     # L portrait, ~1:4–1:3
    "6x9": (6, 9),     # L portrait, ~1:3–1:2
    "6x8": (6, 8),     # L portrait, ~1:2–1:1.3
    "7x8": (7, 8),     # L portrait, ~1:1.3–1:1
    # 7x7 is the square base grid
    # Landscape (wide)
    "8x7": (8, 7),     # L landscape, ~1.1:1–1.3:1
    "8x6": (8, 6),     # L landscape, ~1.3:1–2:1
    "9x6": (9, 6),     # L landscape, ~2:1–3:1
    "9x5": (9, 5),     # L landscape, ~3:1–4:1
    "10x5": (10, 5),   # L landscape, ~4:1–5:1
    "11x5": (11, 5),   # L landscape, ~5:1–6:1
    "11x4": (11, 4),   # L landscape, ~6:1–8:1
    "12x4": (12, 4),   # L landscape, ~8:1–10:1
    "13x4": (13, 4),   # L landscape, ~10:1–12:1
    "14x4": (14, 4),   # L landscape, ~12:1–16:1
    # Chroma a/b (base_n=4) — 10 non-square grids
    # Portrait (tall)
    "3x8": (3, 8),     # a/b portrait, ~1:16–1:6
    "3x7": (3, 7),     # a/b portrait, ~1:6–1:4
    "3x6": (3, 6),     # a/b portrait, ~1:4–1:2 (also alpha portrait)
    "3x5": (3, 5),     # a/b portrait, ~1:2–1:1.3 (also alpha portrait)
    "4x5": (4, 5),     # a/b portrait, ~1:1.3–1:1
    # 4x4 is the square base grid
    # Landscape (wide)
    "5x4": (5, 4),     # a/b landscape, ~1.1:1–1.3:1
    "5x3": (5, 3),     # a/b landscape, ~1.3:1–4:1 (also alpha landscape)
    "6x3": (6, 3),     # a/b landscape, ~4:1–6:1 (also alpha landscape)
    "7x3": (7, 3),     # a/b landscape, ~6:1–10:1
    "8x3": (8, 3),     # a/b landscape, ~10:1–16:1
    # Alpha-mode luminance (base_n=6) — 18 non-square grids
    # Portrait (tall)
    "3x12": (3, 12),   # alpha-L portrait, ~1:16–1:12
    "3x11": (3, 11),   # alpha-L portrait, ~1:12–1:10
    "3x10": (3, 10),   # alpha-L portrait, ~1:10–1:7
    "4x10": (4, 10),   # alpha-L portrait, ~1:7–1:5
    "4x9": (4, 9),     # alpha-L portrait, ~1:5–1:4
    "4x8": (4, 8),     # alpha-L portrait, ~1:4–1:3
    "5x8": (5, 8),     # alpha-L portrait, ~1:3–1:2
    "5x7": (5, 7),     # alpha-L portrait, ~1:2–1:1.3
    "6x7": (6, 7),     # alpha-L portrait, ~1:1.3–1:1
    # 6x6 is the square base grid
    # Landscape (wide)
    "7x6": (7, 6),     # alpha-L landscape, ~1.1:1–1.3:1
    "7x5": (7, 5),     # alpha-L landscape, ~1.3:1–2:1
    "8x5": (8, 5),     # alpha-L landscape, ~2:1–3:1
    "8x4": (8, 4),     # alpha-L landscape, ~3:1–4:1
    "9x4": (9, 4),     # alpha-L landscape, ~4:1–5:1
    "10x4": (10, 4),   # alpha-L landscape, ~5:1–7:1
    "10x3": (10, 3),   # alpha-L landscape, ~7:1–10:1
    "11x3": (11, 3),   # alpha-L landscape, ~10:1–12:1
    "12x3": (12, 3),   # alpha-L landscape, ~12:1–16:1
    # Alpha channel (base_n=3) — 6 non-square grids
    # Note: 3x6, 3x5, 5x3, 6x3 are shared with chroma (already listed above).
    # Portrait (tall)
    # 3x6 — alpha portrait, ~1:16–1:4 (same grid as chroma 3x6)
    # 3x5 — alpha portrait, ~1:4–1:2 (same grid as chroma 3x5)
    "3x4": (3, 4),         # alpha portrait, ~1:2–1:1
    # 3x3 is the square base grid
    # Landscape (wide)
    "4x3": (4, 3),         # alpha landscape, ~1.1:1–2:1
    # 5x3 — alpha landscape, ~2:1–6:1 (same grid as chroma 5x3)
    # 6x3 — alpha landscape, ~6:1–16:1 (same grid as chroma 6x3)
}

# All grids combined
GRIDS = {**SQUARE_GRIDS, **ADAPTIVE_GRIDS}

EXPECTED_AC_COUNTS = {
    # Square
    "3x3": 5,
    "4x4": 9,
    "6x6": 20,
    "7x7": 27,
    # Luminance adaptive (base_n=7)
    "4x14": 35,
    "4x13": 33,
    "4x12": 29,
    "4x11": 28,
    "5x11": 34,
    "5x10": 29,
    "5x9": 28,
    "6x9": 32,
    "6x8": 29,
    "7x8": 34,
    "8x7": 34,
    "8x6": 29,
    "9x6": 32,
    "9x5": 28,
    "10x5": 29,
    "11x5": 34,
    "11x4": 28,
    "12x4": 29,
    "13x4": 33,
    "14x4": 35,
    # Chroma adaptive (base_n=4)
    "3x8": 16,
    "3x7": 14,
    "3x6": 11,
    "3x5": 10,
    "4x5": 13,
    "5x4": 13,
    "5x3": 10,
    "6x3": 11,
    "7x3": 14,
    "8x3": 16,
    # Alpha-mode luminance adaptive (base_n=6)
    "3x12": 23,
    "3x11": 22,
    "3x10": 20,
    "4x10": 25,
    "4x9": 23,
    "4x8": 19,
    "5x8": 25,
    "5x7": 22,
    "6x7": 26,
    "7x6": 26,
    "7x5": 22,
    "8x5": 25,
    "8x4": 19,
    "9x4": 23,
    "10x4": 25,
    "10x3": 20,
    "11x3": 22,
    "12x3": 23,
    # Alpha channel adaptive (base_n=3)
    "3x4": 8,
    "4x3": 8,
}


def main():
    use_json = "--json" in sys.argv

    result = {}
    for label, (nx, ny) in GRIDS.items():
        order = triangular_scan_order(nx, ny)
        expected = EXPECTED_AC_COUNTS[label]
        assert len(order) == expected, (
            f"{label}: got {len(order)} AC coefficients, expected {expected}"
        )
        result[label] = {
            "nx": nx,
            "ny": ny,
            "ac_count": len(order),
            "scan_order": order,
        }

    if use_json:
        # Convert tuples to lists for JSON
        json_result = {}
        for label, data in result.items():
            json_result[label] = {
                "nx": data["nx"],
                "ny": data["ny"],
                "ac_count": data["ac_count"],
                "scan_order": [list(pair) for pair in data["scan_order"]],
            }
        print(json.dumps(json_result, indent=2))
    else:
        # Group output by category
        categories = [
            ("Square grids (v0.1 base)", SQUARE_GRIDS),
            ("Luminance adaptive (base_n=7)", {k: v for k, v in ADAPTIVE_GRIDS.items() if k in ["4x14", "4x13", "4x12", "4x11", "5x11", "5x10", "5x9", "6x9", "6x8", "7x8", "8x7", "8x6", "9x6", "9x5", "10x5", "11x5", "11x4", "12x4", "13x4", "14x4"]}),
            ("Chroma adaptive (base_n=4)", {k: v for k, v in ADAPTIVE_GRIDS.items() if k in ["3x8", "3x7", "3x6", "3x5", "4x5", "5x4", "5x3", "6x3", "7x3", "8x3"]}),
            ("Alpha-mode luminance adaptive (base_n=6)", {k: v for k, v in ADAPTIVE_GRIDS.items() if k in ["3x12", "3x11", "3x10", "4x10", "4x9", "4x8", "5x8", "5x7", "6x7", "7x6", "7x5", "8x5", "8x4", "9x4", "10x4", "10x3", "11x3", "12x3"]}),
            ("Alpha channel adaptive (base_n=3)", {k: v for k, v in ADAPTIVE_GRIDS.items() if k in ["3x4", "4x3"]}),
        ]
        for cat_name, cat_grids in categories:
            print(f"\n=== {cat_name} ===")
            for label in cat_grids:
                data = result[label]
                print(f"\n  {label} grid ({data['ac_count']} AC coefficients):")
                for i, (cx, cy) in enumerate(data["scan_order"]):
                    print(f"    [{i:2d}] cx={cx}, cy={cy}")

    print(f"\nAll scan orders validated.", file=sys.stderr)


if __name__ == "__main__":
    main()
