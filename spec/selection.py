#!/usr/bin/env python3
"""Generate canonical coefficient selection tables for ChromaHash v0.6.

v0.6 replaces v0.4's deriveGrid + triangular mask + scan-order sort with a
single deterministic top-K selection over the natural-decode frequency domain
(spec §6.2):

  1. (W, H) = decodeOutputSize(aspect_byte)   # long side 32, short side ≥ 2
  2. Candidates: all (cx, cy) in [0, W) × [0, H) except DC (0, 0).
     The bound makes selecting a frequency unrepresentable at the natural
     render structurally impossible.
  3. priority = (cx·H)² + (cy·W)²             # integer, fits in uint32
  4. Sort ascending by (priority, cx, cy); take the first K.

p_k (the priority of the K-th selected pair) is emitted alongside each
selection; it is reserved for frequency-normalized decoder extensions and
pinned by the test vectors.

K per channel (constants.py): L = 27 (no-alpha) / 20 (alpha mode),
chroma a/b = 9, alpha = 5.

Usage:
    python3 spec/selection.py           # pretty-print
    python3 spec/selection.py --json    # JSON output
"""

import json
import math
import sys

from constants import (
    ALPHA_AC_COUNT,
    C_AC_COUNT,
    L_AC_COUNT,
    LA_TIER1_COUNT,
    LA_TIER2_COUNT,
)

# Every K the format uses, in ascending order.
FORMAT_KS = sorted(
    {
        ALPHA_AC_COUNT,
        C_AC_COUNT,
        LA_TIER1_COUNT + LA_TIER2_COUNT,
        L_AC_COUNT,
    }
)


def round_half_away_from_zero(x: float) -> int:
    """Round half away from zero (spec-mandated rounding, §2.2)."""
    if x >= 0:
        return math.floor(x + 0.5)
    return math.ceil(x - 0.5)


def decode_output_size(aspect_byte: int) -> tuple[int, int]:
    """Decode (W, H) from aspect byte. Longer side = 32px. Per spec §8.2."""
    ratio = math.pow(2.0, aspect_byte / 255.0 * 8.0 - 4.0)
    if ratio > 1.0:
        h = max(round_half_away_from_zero(32.0 / ratio), 1)
        return (32, h)
    w = max(round_half_away_from_zero(32.0 * ratio), 1)
    return (w, 32)


def select_coefficients(
    aspect_byte: int, k: int
) -> tuple[list[tuple[int, int]], int]:
    """Return (selected (cx, cy) pairs in transmission order, p_k). Per spec §6.2.

    The candidate count is ≥ 2·32 − 1 = 63 for every aspect byte, so any
    K ≤ 63 is always fully satisfied.
    """
    w, h = decode_output_size(aspect_byte)
    entries = []
    for cy in range(h):
        for cx in range(w):
            if cx == 0 and cy == 0:
                continue
            priority = (cx * h) ** 2 + (cy * w) ** 2
            entries.append((priority, cx, cy))
    entries.sort()
    entries = entries[:k]
    p_k = entries[-1][0]
    return [(cx, cy) for (_, cx, cy) in entries], p_k


def main() -> None:
    use_json = "--json" in sys.argv

    # Enumerate all unique (W, H, K) selections across all 256 aspect bytes.
    seen: set[tuple[int, int, int]] = set()
    entries = []

    for byte in range(256):
        w, h = decode_output_size(byte)
        for k in FORMAT_KS:
            key = (w, h, k)
            if key in seen:
                continue
            seen.add(key)
            coeffs, p_k = select_coefficients(byte, k)
            assert len(coeffs) == k, f"byte={byte} k={k}: got {len(coeffs)}"
            assert all(cx < w and cy < h for cx, cy in coeffs), (
                f"byte={byte} k={k}: frequency out of bounds"
            )
            entries.append(
                {
                    "aspect_byte": byte,
                    "w": w,
                    "h": h,
                    "k": k,
                    "coeffs": coeffs,
                    "p_k": p_k,
                }
            )

    if use_json:
        json_entries = [
            {**e, "coeffs": [list(pair) for pair in e["coeffs"]]} for e in entries
        ]
        print(json.dumps(json_entries, indent=2))
    else:
        for k in FORMAT_KS:
            subset = [e for e in entries if e["k"] == k]
            print(f"\n=== K={k} ({len(subset)} unique (W,H) selections) ===")
            for e in subset:
                print(f"\n  W={e['w']} H={e['h']} (p_k={e['p_k']}):")
                for i, (cx, cy) in enumerate(e["coeffs"]):
                    print(f"    [{i:2d}] cx={cx}, cy={cy}")

    print(f"\nAll {len(entries)} unique selections validated.", file=sys.stderr)


if __name__ == "__main__":
    main()
