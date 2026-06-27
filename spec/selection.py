#!/usr/bin/env python3
"""Generate canonical coefficient selection tables for ChromaHash (format v1).

v1 keeps v0.6's single deterministic top-K selection over the natural-decode
frequency domain (spec §6.1), now parameterized by quality tier:

  1. (W, H) = decodeOutputSize(aspect_byte, tier)   # long edge 32·2^tier
  2. Candidates: all (cx, cy) in [0, W) × [0, H) except DC (0, 0).
     The bound makes selecting a frequency unrepresentable at the natural
     render structurally impossible.
  3. priority = (cx·H)² + (cy·W)²             # integer, bit-exact across langs
  4. Sort ascending by (priority, cx, cy); take the first K.

p_k (the priority of the K-th selected pair) is emitted alongside each
selection; it is reserved for frequency-normalized decoder extensions and
pinned by the test vectors.

K per channel at tier 0 (constants.py LAYOUT_B): L = 26 (no-alpha) /
20 (alpha mode), chroma a/b = 9, alpha = 5. Tier m scales every K by 4^m, and
the larger grid keeps the higher K satisfiable (candidates ≥ 64·4^m − 1).

Usage:
    python3 spec/selection.py           # pretty-print (tier 0)
    python3 spec/selection.py --json    # JSON output (tier 0)
"""

import json
import math
import sys

from constants import ALPHA_AC_COUNT, BASE_LONG_EDGE, LAYOUT_B

# Every per-channel K the format uses at tier 0, in ascending order. Tier m
# uses each of these scaled by 4^m.
FORMAT_KS = sorted(
    {
        ALPHA_AC_COUNT,
        LAYOUT_B.c_count,
        LAYOUT_B.la_tiers[0][0] + LAYOUT_B.la_tiers[1][0],
        LAYOUT_B.l_tiers[0][0] + LAYOUT_B.l_tiers[1][0],
    }
)


def round_half_away_from_zero(x: float) -> int:
    """Round half away from zero (spec-mandated rounding, §2.2)."""
    if x >= 0:
        return math.floor(x + 0.5)
    return math.ceil(x - 0.5)


def base_output_size(aspect_byte: int) -> tuple[int, int]:
    """Tier-0 (W, H) from an aspect byte. Longer side = BASE_LONG_EDGE (32px),
    shorter side ≥ 1. Per spec §8.2."""
    ratio = math.pow(2.0, aspect_byte / 255.0 * 8.0 - 4.0)
    if ratio > 1.0:
        h = max(round_half_away_from_zero(BASE_LONG_EDGE / ratio), 1)
        return (BASE_LONG_EDGE, h)
    w = max(round_half_away_from_zero(BASE_LONG_EDGE * ratio), 1)
    return (w, BASE_LONG_EDGE)


def decode_output_size(aspect_byte: int, tier: int) -> tuple[int, int]:
    """Natural output size for an aspect byte at a quality tier. Per spec §8.2 (v1).

    The tier-0 size is scaled by a power of two — (w << tier, h << tier) — so the
    long edge is 32·2^tier (32 / 64 / 128 / 256 px). Scaling the already-rounded
    base size by a bit shift (rather than re-rounding 32·2^tier/ratio) is
    mandatory: the two disagree for non-power-of-two ratios (round(64/3) = 21 vs
    round(32/3) << 1 = 22), and the encoder and decoder MUST derive identical
    grids or the reconstruction desynchronizes.
    """
    w, h = base_output_size(aspect_byte)
    return (w << tier, h << tier)


def select_coefficients(
    aspect_byte: int, tier: int, k: int
) -> tuple[list[tuple[int, int]], int]:
    """Return (selected (cx, cy) pairs in transmission order, p_k). Per §6.1 (v1).

    The candidate count is ≥ 64·4^tier − 1 for every aspect byte (the 16:1
    extreme), and every per-channel K(tier) the format uses is < that bound, so
    the selection is always fully satisfied.
    """
    w, h = decode_output_size(aspect_byte, tier)
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
    tier = 0  # the canonical table is dumped at tier 0

    # Enumerate all unique (W, H, K) selections across all 256 aspect bytes.
    seen: set[tuple[int, int, int]] = set()
    entries = []

    for byte in range(256):
        w, h = decode_output_size(byte, tier)
        for k in FORMAT_KS:
            key = (w, h, k)
            if key in seen:
                continue
            seen.add(key)
            coeffs, p_k = select_coefficients(byte, tier, k)
            assert len(coeffs) == k, f"byte={byte} k={k}: got {len(coeffs)}"
            assert all(cx < w and cy < h for cx, cy in coeffs), (
                f"byte={byte} k={k}: frequency out of bounds"
            )
            entries.append(
                {
                    "aspect_byte": byte,
                    "tier": tier,
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
