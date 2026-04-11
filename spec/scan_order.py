#!/usr/bin/env python3
"""Generate canonical coefficient scan order tables for ChromaHash v0.4.

In v0.4 the scan order depends on (nx, ny, w, h), not just (nx, ny).
Multiple aspect bytes can produce the same grid shape (nx, ny) but different
decode output dimensions (w, h), yielding different per-pixel priority orderings.

The scan order is:
  1. Enumerate all (cx, cy) pairs satisfying  cx*ny < nx*(ny-cy), skip DC (0,0).
  2. Assign priority = (cx*h)^2 + (cy*w)^2  (integer, u64-safe).
  3. Sort ascending by (priority, cx, cy).

decodeOutputSize(aspect_byte):
  ratio = 2^(aspect_byte/255*8 - 4)
  if ratio >= 1.0: w=32, h=max(round(32/ratio), 1)
  else:            h=32, w=max(round(32*ratio), 1)

deriveGrid(aspect_byte, base_n):
  ratio = 2^(aspect_byte/255*8 - 4); nx_cap = 2*base_n
  if ratio >= 1.0: nx=min(round(base_n*sqrt(scale)), nx_cap); ny=round(base_n^2/nx)
  else:            ny=min(round(base_n*sqrt(scale)), nx_cap); nx=round(base_n^2/ny)
  return (max(nx,3), max(ny,3))

Usage:
    python3 spec/scan_order.py          # pretty-print
    python3 spec/scan_order.py --json   # JSON output
"""
import json
import math
import sys


def round_half_away_from_zero(x: float) -> int:
    """Round half away from zero (spec-mandated rounding)."""
    if x >= 0:
        return math.floor(x + 0.5)
    else:
        return math.ceil(x - 0.5)


def decode_output_size(aspect_byte: int) -> tuple[int, int]:
    """Decode (w, h) from aspect byte. Longer side = 32px. Per spec §8.2."""
    ratio = math.pow(2.0, aspect_byte / 255.0 * 8.0 - 4.0)
    if ratio >= 1.0:
        h = max(round_half_away_from_zero(32.0 / ratio), 1)
        return (32, h)
    else:
        w = max(round_half_away_from_zero(32.0 * ratio), 1)
        return (w, 32)


def derive_grid(aspect_byte: int, base_n: int) -> tuple[int, int]:
    """Derive adaptive DCT grid (nx, ny). Per spec §6.3 (v0.4)."""
    ratio = math.pow(2.0, aspect_byte / 255.0 * 8.0 - 4.0)
    nx_cap = 2 * base_n
    if ratio >= 1.0:
        scale = min(ratio, 16.0)
        nx = min(round_half_away_from_zero(base_n * math.sqrt(scale)), nx_cap)
        ny = round_half_away_from_zero(base_n * base_n / nx)
    else:
        scale = min(1.0 / ratio, 16.0)
        ny = min(round_half_away_from_zero(base_n * math.sqrt(scale)), nx_cap)
        nx = round_half_away_from_zero(base_n * base_n / ny)
    return (max(nx, 3), max(ny, 3))


def triangle_members(nx: int, ny: int) -> list[tuple[int, int]]:
    """Enumerate all (cx, cy) AC pairs satisfying cx*ny < nx*(ny-cy), skip DC."""
    members = []
    for cy in range(ny):
        cx_start = 1 if cy == 0 else 0
        cx = cx_start
        while cx * ny < nx * (ny - cy):
            members.append((cx, cy))
            cx += 1
    return members


def scan_order(nx: int, ny: int, w: int, h: int) -> list[tuple[int, int]]:
    """Return AC coefficient (cx, cy) pairs sorted by per-pixel frequency priority.

    priority = (cx*h)^2 + (cy*w)^2  (integer, bit-exact across languages)
    Ties broken by (cx, cy) lex order.
    """
    members = triangle_members(nx, ny)
    def key(pair):
        cx, cy = pair
        return ((cx * h) ** 2 + (cy * w) ** 2, cx, cy)
    return sorted(members, key=key)


def main():
    use_json = "--json" in sys.argv

    # Enumerate all unique (nx, ny, w, h) tuples across all aspect bytes and base_n values
    seen: set[tuple[int, int, int, int]] = set()
    entries = []  # ordered by first occurrence (byte ascending, base_n ascending)

    for byte in range(256):
        for base_n in [3, 4, 6, 7]:
            nx, ny = derive_grid(byte, base_n)
            w, h = decode_output_size(byte)
            key = (nx, ny, w, h)
            if key not in seen:
                seen.add(key)
                order = scan_order(nx, ny, w, h)
                # AC count is a function of (nx, ny) only
                ac_count = len(triangle_members(nx, ny))
                assert len(order) == ac_count, (
                    f"{nx}x{ny} w={w} h={h}: got {len(order)} AC, expected {ac_count}"
                )
                entries.append({
                    "nx": nx, "ny": ny, "w": w, "h": h,
                    "base_n": base_n,
                    "ac_count": ac_count,
                    "scan_order": order,
                })

    if use_json:
        json_entries = []
        for e in entries:
            json_entries.append({
                "nx": e["nx"], "ny": e["ny"], "w": e["w"], "h": e["h"],
                "base_n": e["base_n"],
                "ac_count": e["ac_count"],
                "scan_order": [list(pair) for pair in e["scan_order"]],
            })
        print(json.dumps(json_entries, indent=2))
    else:
        # Group by base_n for readability
        for base_n in [7, 6, 4, 3]:
            subset = [e for e in entries if e["base_n"] == base_n]
            if not subset:
                continue
            print(f"\n=== base_n={base_n} ({len(subset)} unique (nx,ny,w,h) tuples) ===")
            for e in subset:
                print(f"\n  {e['nx']}x{e['ny']} w={e['w']} h={e['h']} ({e['ac_count']} AC):")
                for i, (cx, cy) in enumerate(e["scan_order"]):
                    print(f"    [{i:2d}] cx={cx}, cy={cy}")

    print(f"\nAll {len(entries)} unique scan orders validated.", file=sys.stderr)


if __name__ == "__main__":
    main()
