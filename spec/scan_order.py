#!/usr/bin/env python3
"""Generate canonical coefficient scan order tables for ChromaHash.

Enumerates exact (cx, cy) AC coefficient pairs for each grid size used by
ChromaHash, using the triangular selection condition:

    cx * ny < nx * (ny - cy)

Scanned row-major, skipping DC at (0, 0).

Includes all grid configurations produced by deriveGrid() for v0.2 adaptive
grids across all channel types and aspect ratios.

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

# Non-square grids produced by deriveGrid() for v0.2 adaptive geometry.
# Exhaustive: every (nx, ny) pair produced by deriveGrid() for all 256
# aspect byte values, organized by channel type.
ADAPTIVE_GRIDS = {
    # Luminance (base_n=7)
    "5x10": (5, 10),   # L at bytes 0-15    (ratio 0.25-0.29, ~1:4)
    "5x9": (5, 9),     # L at bytes 16-38   (ratio 0.30-0.38, ~1:3)
    "6x9": (6, 9),     # L at bytes 39-56   (ratio 0.38-0.46, ~1:2.4)
    "6x8": (6, 8),     # L at bytes 57-100  (ratio 0.47-0.74, ~1:2)
    "7x8": (7, 8),     # L at bytes 101-102 (ratio 0.75-0.76, ~3:4)
    # 7x7 is the square base grid
    "8x7": (8, 7),     # L at bytes 153-154 (ratio 1.32-1.33, ~4:3)
    "8x6": (8, 6),     # L at bytes 155-198 (ratio 1.35-2.15, ~3:2)
    "9x6": (9, 6),     # L at bytes 199-216 (ratio 2.18-2.62, ~5:2)
    "9x5": (9, 5),     # L at bytes 217-239 (ratio 2.65-3.36, ~3:1)
    "10x5": (10, 5),   # L at bytes 240-255 (ratio 3.40-4.00, ~4:1)
    # Chroma a/b (base_n=4)
    "3x6": (3, 6),     # a/b at bytes 0-10   (ratio 0.25-0.28, ~1:4)
    "3x5": (3, 5),     # a/b at bytes 11-78  (ratio 0.28-0.58, ~1:2)
    "4x5": (4, 5),     # a/b at bytes 79-84  (ratio 0.59-0.62, ~3:5)
    # 4x4 is the square base grid
    "5x4": (5, 4),     # a/b at bytes 171-176 (ratio 1.61-1.69, ~5:3)
    "5x3": (5, 3),     # a/b at bytes 177-244 (ratio 1.71-3.55, ~2:1)
    "6x3": (6, 3),     # a/b at bytes 245-255 (ratio 3.59-4.00, ~4:1)
    # Alpha-mode luminance (base_n=6)
    "4x8": (4, 8),     # alpha-L at bytes 0-21   (ratio 0.25-0.31, ~1:4)
    "5x8": (5, 8),     # alpha-L at bytes 22-45  (ratio 0.32-0.41, ~1:3)
    "5x7": (5, 7),     # alpha-L at bytes 46-95  (ratio 0.41-0.70, ~1:2)
    "6x7": (6, 7),     # alpha-L at bytes 96-98  (ratio 0.71-0.73, ~5:7)
    # 6x6 is the square base grid
    "7x6": (7, 6),     # alpha-L at bytes 157-159 (ratio 1.38-1.41, ~7:5)
    "7x5": (7, 5),     # alpha-L at bytes 160-209 (ratio 1.42-2.43, ~2:1)
    "8x5": (8, 5),     # alpha-L at bytes 210-233 (ratio 2.45-3.15, ~3:1)
    "8x4": (8, 4),     # alpha-L at bytes 234-255 (ratio 3.18-4.00, ~4:1)
    # Alpha channel (base_n=3)
    "3x4": (3, 4),     # alpha at bytes 0-70   (ratio 0.25-0.54, ~1:2)
    # 3x3 is the square base grid
    "4x3": (4, 3),     # alpha at bytes 185-255 (ratio 1.87-4.00, ~2:1)
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
    # Chroma adaptive (base_n=4)
    "3x6": 11,
    "3x5": 10,
    "4x5": 13,
    "5x4": 13,
    "5x3": 10,
    "6x3": 11,
    # Alpha-mode luminance adaptive (base_n=6)
    "4x8": 19,
    "5x8": 25,
    "5x7": 22,
    "6x7": 26,
    "7x6": 26,
    "7x5": 22,
    "8x5": 25,
    "8x4": 19,
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
            ("Luminance adaptive (base_n=7)", {k: v for k, v in ADAPTIVE_GRIDS.items() if k in ["5x10", "5x9", "6x9", "6x8", "7x8", "8x7", "8x6", "9x6", "9x5", "10x5"]}),
            ("Chroma adaptive (base_n=4)", {k: v for k, v in ADAPTIVE_GRIDS.items() if k in ["3x6", "3x5", "4x5", "5x4", "5x3", "6x3"]}),
            ("Alpha-mode luminance adaptive (base_n=6)", {k: v for k, v in ADAPTIVE_GRIDS.items() if k in ["4x8", "5x8", "5x7", "6x7", "7x6", "7x5", "8x5", "8x4"]}),
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
