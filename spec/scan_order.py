#!/usr/bin/env python3
"""Generate canonical coefficient scan order tables for ChromaHash.

Enumerates exact (cx, cy) AC coefficient pairs for each grid size used by
ChromaHash, using the triangular selection condition:

    cx * ny < nx * (ny - cy)

Scanned row-major, skipping DC at (0, 0).

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


GRIDS = {
    "3x3": (3, 3),
    "4x4": (4, 4),
    "6x6": (6, 6),
    "7x7": (7, 7),
}

EXPECTED_AC_COUNTS = {
    "3x3": 5,
    "4x4": 9,
    "6x6": 20,
    "7x7": 27,
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
        for label, data in result.items():
            print(f"\n{label} grid ({data['ac_count']} AC coefficients):")
            for i, (cx, cy) in enumerate(data["scan_order"]):
                print(f"  [{i:2d}] cx={cx}, cy={cy}")

    print(f"\nAll scan orders validated.", file=sys.stderr)


if __name__ == "__main__":
    main()
