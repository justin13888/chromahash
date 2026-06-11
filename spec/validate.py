#!/usr/bin/env python3
"""Validate ChromaHash constants against first-principles derivations.

Independently derives all M1 matrices from gamut chromaticity coordinates
and verifies they match the values in constants.py. Also checks matrix
inverse relationships, white point mapping, and OKLAB bounds.

Usage:
    python3 spec/validate.py

Exit code 0 on success, 1 on any validation failure.
"""
import math
import sys

from constants import (
    M1_ADOBE_RGB,
    M1_BT2020,
    M1_DISPLAY_P3,
    M1_INV_SRGB,
    M1_PROPHOTO_RGB,
    M1_SRGB,
    M2,
    M2_INV,
    M_BRADFORD,
    D50_XY,
    D65_XY,
    GAMUT_PRIMARIES,
    GAMUT_L_BLEND,
    MAX_A_ALPHA_SCALE,
    MAX_A_SCALE,
    MAX_B_SCALE,
    MAX_CHROMA_A,
    MAX_CHROMA_B,
    MAX_L_SCALE,
    MU_ALPHA,
    MU_C,
    MU_L,
    ALPHA_AC_BITS,
    ALPHA_AC_COUNT,
    C_AC_BITS,
    C_AC_COUNT,
    L_AC_BITS,
    L_AC_COUNT,
    LA_TIER1_BITS,
    LA_TIER1_COUNT,
    LA_TIER2_BITS,
    LA_TIER2_COUNT,
)
from selection import FORMAT_KS, decode_output_size, select_coefficients

# Mapping from gamut name → stored M1 matrix
STORED_M1 = {
    "sRGB": M1_SRGB,
    "Display P3": M1_DISPLAY_P3,
    "Adobe RGB": M1_ADOBE_RGB,
    "BT.2020": M1_BT2020,
    "ProPhoto RGB": M1_PROPHOTO_RGB,
}

# Tolerance for floating-point comparisons
MATRIX_TOL = 1e-7   # For matrix element comparisons (derived vs stored)
IDENTITY_TOL = 5e-8  # For identity matrix checks (accounts for 10-digit published precision)
WHITE_TOL = 1e-8     # For white point mapping

passed = 0
failed = 0


def check(condition: bool, label: str):
    """Record a pass/fail check."""
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✓ {label}")
    else:
        failed += 1
        print(f"  ✗ FAIL: {label}")


# =========================================================================
# Pure-Python linear algebra (no numpy dependency)
# =========================================================================

def matmul(A, B):
    n, k, m = len(A), len(B), len(B[0])
    C = [[0.0] * m for _ in range(n)]
    for i in range(n):
        for j in range(m):
            for l in range(k):
                C[i][j] += A[i][l] * B[l][j]
    return C


def matvec(A, v):
    return [sum(A[i][j] * v[j] for j in range(len(v))) for i in range(len(A))]


def matscale_cols(M, s):
    return [[M[i][j] * s[j] for j in range(len(M[0]))] for i in range(len(M))]


def mat_inv_3x3(M):
    a, b, c = M[0]
    d, e, f = M[1]
    g, h, k = M[2]
    det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g)
    inv_det = 1.0 / det
    return [
        [(e * k - f * h) * inv_det, (c * h - b * k) * inv_det, (b * f - c * e) * inv_det],
        [(f * g - d * k) * inv_det, (a * k - c * g) * inv_det, (c * d - a * f) * inv_det],
        [(d * h - e * g) * inv_det, (b * g - a * h) * inv_det, (a * e - b * d) * inv_det],
    ]


def diag3(v):
    return [[v[0], 0, 0], [0, v[1], 0], [0, 0, v[2]]]


def mat_max_diff(A, B):
    return max(abs(A[i][j] - B[i][j]) for i in range(3) for j in range(3))


def identity_error(M):
    return max(abs(M[i][j] - (1.0 if i == j else 0.0)) for i in range(3) for j in range(3))


# =========================================================================
# Matrix derivation from chromaticity coordinates
# =========================================================================

def xy_to_XYZ(x, y):
    return [x / y, 1.0, (1.0 - x - y) / y]


def rgb_to_xyz_matrix(primaries_xy, white_xy):
    """Compute 3×3 linear RGB → CIE XYZ matrix from chromaticities."""
    R = xy_to_XYZ(*primaries_xy[0])
    G = xy_to_XYZ(*primaries_xy[1])
    B = xy_to_XYZ(*primaries_xy[2])
    M = [[R[i], G[i], B[i]] for i in range(3)]
    W = xy_to_XYZ(*white_xy)
    S = matvec(mat_inv_3x3(M), W)
    return matscale_cols(M, S)


def bradford_adapt(src_xy, dst_xy):
    """Bradford chromatic adaptation matrix."""
    src_XYZ = xy_to_XYZ(*src_xy)
    dst_XYZ = xy_to_XYZ(*dst_xy)
    M_inv = mat_inv_3x3(M_BRADFORD)
    src_lms = matvec(M_BRADFORD, src_XYZ)
    dst_lms = matvec(M_BRADFORD, dst_XYZ)
    scale = [dst_lms[i] / src_lms[i] for i in range(3)]
    return matmul(M_inv, matmul(diag3(scale), M_BRADFORD))


def derive_m1(gamut_name: str) -> list:
    """Derive M1[gamut] from first principles using Ottosson's M1[sRGB]."""
    info = GAMUT_PRIMARIES[gamut_name]
    white_xy = D65_XY if info["white"] == "D65" else D50_XY
    primaries = [info["R"], info["G"], info["B"]]

    # Derive implicit M_LMS from Ottosson's M1[sRGB]
    M_XYZ_sRGB = rgb_to_xyz_matrix(
        [GAMUT_PRIMARIES["sRGB"]["R"],
         GAMUT_PRIMARIES["sRGB"]["G"],
         GAMUT_PRIMARIES["sRGB"]["B"]],
        D65_XY,
    )
    M_LMS = matmul(M1_SRGB, mat_inv_3x3(M_XYZ_sRGB))

    # Compute target gamut XYZ matrix
    M_XYZ = rgb_to_xyz_matrix(primaries, white_xy)

    # Apply Bradford adaptation if not D65
    if info["white"] != "D65":
        M_adapt = bradford_adapt(white_xy, D65_XY)
        M_XYZ = matmul(M_adapt, M_XYZ)

    return matmul(M_LMS, M_XYZ)


# =========================================================================
# Validation checks
# =========================================================================

def validate_matrix_inverses():
    """Check M2 × M2_inv ≈ I and M1[sRGB] × M1_inv[sRGB] ≈ I."""
    print("\n1. Matrix inverse relationships")

    product = matmul(M2, M2_INV)
    err = identity_error(product)
    check(err < IDENTITY_TOL, f"M2 × M2_inv ≈ I (err={err:.2e})")

    product = matmul(M1_SRGB, M1_INV_SRGB)
    err = identity_error(product)
    check(err < IDENTITY_TOL, f"M1[sRGB] × M1_inv[sRGB] ≈ I (err={err:.2e})")

    # Also check the inverse computed from M1[sRGB] matches the stored one
    M1_inv_computed = mat_inv_3x3(M1_SRGB)
    diff = mat_max_diff(M1_inv_computed, M1_INV_SRGB)
    check(diff < 1e-8, f"M1_inv[sRGB] matches inv(M1[sRGB]) (diff={diff:.2e})")


def validate_white_point():
    """Check M1[gamut] × (1,1,1) ≈ (1,1,1) for all gamuts."""
    print("\n2. White point mapping: M1 × (1,1,1) ≈ (1,1,1)")

    for name, M1 in STORED_M1.items():
        w = matvec(M1, [1.0, 1.0, 1.0])
        err = max(abs(v - 1.0) for v in w)
        check(err < WHITE_TOL, f"M1[{name}] (err={err:.2e})")

    # M2 × (1,1,1) = (1, 0, 0)
    r = matvec(M2, [1.0, 1.0, 1.0])
    err = abs(r[0] - 1.0) + abs(r[1]) + abs(r[2])
    check(err < IDENTITY_TOL, f"M2 × (1,1,1) ≈ (1,0,0) (err={err:.2e})")


def validate_m1_derivation():
    """Check stored M1 matrices match first-principles derivation."""
    print("\n3. M1 matrices match chromaticity-based derivation")

    for name in STORED_M1:
        derived = derive_m1(name)
        stored = STORED_M1[name]
        diff = mat_max_diff(derived, stored)
        check(diff < MATRIX_TOL, f"M1[{name}] (diff={diff:.2e})")


def validate_row_sums():
    """Check all M1 row sums ≈ 1.0 (white maps to white)."""
    print("\n4. M1 row sums ≈ 1.0")

    for name, M1 in STORED_M1.items():
        rs = [sum(row) for row in M1]
        err = max(abs(s - 1.0) for s in rs)
        check(err < WHITE_TOL, f"M1[{name}] row sums (err={err:.2e})")


def validate_oklab_bounds():
    """Check MAX_CHROMA_A/B cover the sRGB OKLAB hull (the decode target).

    v0.6 sizes the chroma DC ranges to the sRGB hull rather than the union of
    source gamuts: the decoder always clamps to sRGB, so DC chroma beyond the
    hull is unreachable and only wastes quantization precision. Wide-gamut DCs
    outside the hull clip at encode; the decode-aware DC search (spec §10.3)
    selects the codes minimizing the post-clamp error.
    """
    print("\n5. OKLAB bounds and MAX_CHROMA coverage (sRGB hull)")

    srgb_max_a = 0.0
    srgb_max_b = 0.0

    for r in [0.0, 1.0]:
        for g in [0.0, 1.0]:
            for b in [0.0, 1.0]:
                if r == 0 and g == 0 and b == 0:
                    continue
                lms = matvec(M1_SRGB, [r, g, b])
                lms_cbrt = [math.copysign(abs(x) ** (1 / 3), x) for x in lms]
                lab = matvec(M2, lms_cbrt)
                srgb_max_a = max(srgb_max_a, abs(lab[1]))
                srgb_max_b = max(srgb_max_b, abs(lab[2]))

    check(MAX_CHROMA_A >= srgb_max_a,
          f"MAX_CHROMA_A={MAX_CHROMA_A} ≥ sRGB hull max |a|={srgb_max_a:.4f}")
    check(MAX_CHROMA_B >= srgb_max_b,
          f"MAX_CHROMA_B={MAX_CHROMA_B} ≥ sRGB hull max |b|={srgb_max_b:.4f}")
    # Ranges should be tight: more than ~10% slack re-wastes the precision
    # the v0.6 retuning reclaimed.
    check(MAX_CHROMA_A <= srgb_max_a * 1.1,
          f"MAX_CHROMA_A={MAX_CHROMA_A} ≤ 1.1 × sRGB hull max |a| (tight range)")
    check(MAX_CHROMA_B <= srgb_max_b * 1.1,
          f"MAX_CHROMA_B={MAX_CHROMA_B} ≤ 1.1 × sRGB hull max |b| (tight range)")


def validate_scale_constants():
    """Check scale and clamp constants are positive and reasonable."""
    print("\n6. Scale factor and clamp constants")

    for name, val in [
        ("MAX_L_SCALE", MAX_L_SCALE),
        ("MAX_A_SCALE", MAX_A_SCALE),
        ("MAX_B_SCALE", MAX_B_SCALE),
        ("MAX_A_ALPHA_SCALE", MAX_A_ALPHA_SCALE),
    ]:
        check(val > 0, f"{name} = {val} > 0")
        check(val <= 1.0, f"{name} = {val} ≤ 1.0")

    check(0.0 <= GAMUT_L_BLEND <= 1.0, f"GAMUT_L_BLEND = {GAMUT_L_BLEND} in [0, 1]")


def validate_mu_law():
    """Check µ-law round-trip and exact-zero properties for all format µ values."""
    print("\n7. µ-law companding round-trip (v0.6 odd level count)")

    def mu_compress(v, mu):
        return math.copysign(1, v) * math.log(1 + mu * abs(v)) / math.log(1 + mu)

    def mu_expand(c, mu):
        return math.copysign(1, c) * ((1 + mu) ** abs(c) - 1) / mu

    for mu_name, mu in [("MU_L", MU_L), ("MU_C", MU_C), ("MU_ALPHA", MU_ALPHA)]:
        check(mu > 0, f"{mu_name} = {mu} > 0")

        # Round-trip at extreme values
        for v in [-1.0, -0.5, 0.0, 0.5, 1.0]:
            c = mu_compress(v, mu)
            rt = mu_expand(c, mu)
            err = abs(rt - v)
            check(err < 1e-12, f"{mu_name}: round-trip at v={v:+.1f} (err={err:.2e})")

        # Check compressed range is [-1, 1]
        c_max = mu_compress(1.0, mu)
        c_min = mu_compress(-1.0, mu)
        check(abs(c_max - 1.0) < 1e-12, f"{mu_name}: µ-law(1.0) ≈ 1.0")
        check(abs(c_min + 1.0) < 1e-12, f"{mu_name}: µ-law(-1.0) ≈ -1.0")

        # v0.6 exact-zero property: with 2^bits − 1 levels, the center index
        # dequantizes to exactly 0.0 at every bit width the format uses.
        for bits in [4, 5, 6]:
            max_idx = (1 << bits) - 2
            center = max_idx // 2
            c = center / max_idx * 2 - 1
            check(mu_expand(c, mu) == 0.0,
                  f"{mu_name}: center code is exact zero at {bits} bits")


def validate_aspect_ratio():
    """Check aspect ratio encoding for known ratios."""
    print("\n8. Aspect ratio encoding")

    def encode_aspect(w, h):
        import math as m
        return max(0, min(255, round((m.log2(w / h) + 4) / 8 * 255)))

    def decode_aspect(byte_val):
        return 2 ** (byte_val / 255 * 8 - 4)

    test_cases = [
        ("1:1", 1.0, 1.0),
        ("3:2", 3.0, 2.0),
        ("4:3", 4.0, 3.0),
        ("16:9", 16.0, 9.0),
        ("4:1", 4.0, 1.0),
        ("1:4", 1.0, 4.0),
        ("16:1", 16.0, 1.0),
        ("1:16", 1.0, 16.0),
    ]

    for label, w, h in test_cases:
        byte_val = encode_aspect(w, h)
        decoded = decode_aspect(byte_val)
        actual = w / h
        err = abs(decoded - actual) / actual * 100
        check(err < 1.1, f"Aspect {label}: error={err:.3f}% < 1.1%")


def validate_selection():
    """Check top-K coefficient selection properties for all aspect bytes. Per spec §6.2 (v0.6)."""
    print("\n9. Coefficient selection (top-K per-pixel frequency)")

    # Structural invariants over every aspect byte and every format K
    all_ok = True
    min_candidates = 1 << 30
    for byte in range(256):
        w, h = decode_output_size(byte)
        min_candidates = min(min_candidates, w * h - 1)
        for k in FORMAT_KS:
            coeffs, p_k = select_coefficients(byte, k)
            if len(coeffs) != k:
                all_ok = False
            if (0, 0) in coeffs:
                all_ok = False
            if any(cx >= w or cy >= h for cx, cy in coeffs):
                all_ok = False
            priorities = [(cx * h) ** 2 + (cy * w) ** 2 for cx, cy in coeffs]
            if priorities != sorted(priorities):
                all_ok = False
            if p_k != priorities[-1] or p_k <= 0:
                all_ok = False
    check(all_ok, "All 256 bytes × all K: count, DC excluded, in-bounds, "
                  "ascending priority, p_k consistent")
    check(min_candidates >= max(FORMAT_KS),
          f"Min candidate count {min_candidates} ≥ max K {max(FORMAT_KS)} "
          "(selection always fully satisfied)")

    # Square at byte=128 (W=H=32): radial order, ℓ2 ball
    coeffs_9, _ = select_coefficients(128, 9)
    check(coeffs_9[0] == (0, 1) and coeffs_9[1] == (1, 0),
          "Square K=9: first two slots are (0,1),(1,0) — tied priority, lex tiebreak")
    check(coeffs_9[2] == (1, 1), "Square K=9: third slot is (1,1)")

    coeffs_27, _ = select_coefficients(128, 27)
    check((3, 4) in coeffs_27 and (4, 3) in coeffs_27,
          "Square K=27: ℓ2 ball includes diagonals (3,4)/(4,3)")
    check((6, 0) not in coeffs_27 and (0, 6) not in coeffs_27,
          "Square K=27: ℓ2 ball excludes axis extremes (6,0)/(0,6)")

    # Extreme landscape at byte=255 (W=32, H=2): long axis dominates
    coeffs_land, _ = select_coefficients(255, 27)
    cy0 = sum(1 for _, cy in coeffs_land if cy == 0)
    check(cy0 >= 15, f"16:1 landscape K=27: {cy0} ≥ 15 slots on the long axis")
    check(all(cy < 2 for _, cy in coeffs_land),
          "16:1 landscape: no cy ≥ H=2 frequency ever selected")

    # Portrait/landscape symmetry: byte b and byte (255−b) have mirrored
    # (W, H), so the selected priority multisets are identical. The exact
    # coefficient sets may differ within an equal-priority tie group cut at
    # the K boundary (the (priority, cx, cy) tiebreak is not swap-invariant);
    # this is benign and affects 5 of 512 (byte, K) mirror pairs.
    sym_ok = True
    for b in range(128):
        w_lo, h_lo = decode_output_size(b)
        w_hi, h_hi = decode_output_size(255 - b)
        if (w_lo, h_lo) != (h_hi, w_hi):
            sym_ok = False
        for k in FORMAT_KS:
            lo, pk_lo = select_coefficients(b, k)
            hi, pk_hi = select_coefficients(255 - b, k)
            pri_lo = sorted((cx * h_lo) ** 2 + (cy * w_lo) ** 2 for cx, cy in lo)
            pri_hi = sorted((cx * h_hi) ** 2 + (cy * w_hi) ** 2 for cx, cy in hi)
            if pri_lo != pri_hi or pk_lo != pk_hi:
                sym_ok = False
    check(sym_ok, "Portrait/landscape symmetry: mirrored dims, equal priority "
                  "multisets and p_k across all K")


def validate_bit_budget():
    """Check the AC layout fits the 208-bit block exactly. Per spec §3.2 (v0.6)."""
    print("\n10. AC bit budget")

    no_alpha = L_AC_COUNT * L_AC_BITS + 2 * C_AC_COUNT * C_AC_BITS
    check(no_alpha <= 208, f"No-alpha AC payload {no_alpha} ≤ 208 bits")
    check(208 - no_alpha == 1, f"No-alpha padding = {208 - no_alpha} bit (spec §2.6)")

    alpha = (
        5 + 4  # alpha DC + alpha scale
        + LA_TIER1_COUNT * LA_TIER1_BITS
        + LA_TIER2_COUNT * LA_TIER2_BITS
        + 2 * C_AC_COUNT * C_AC_BITS
        + ALPHA_AC_COUNT * ALPHA_AC_BITS
    )
    check(alpha == 208, f"Alpha-mode AC payload {alpha} = 208 bits (no padding)")

    check(LA_TIER1_COUNT + LA_TIER2_COUNT == 20,
          "Alpha-mode L coefficient count = 20")


# =========================================================================
# Main
# =========================================================================

if __name__ == "__main__":
    print("ChromaHash Constants Validation")
    print("=" * 60)

    validate_matrix_inverses()
    validate_white_point()
    validate_m1_derivation()
    validate_row_sums()
    validate_oklab_bounds()
    validate_scale_constants()
    validate_mu_law()
    validate_aspect_ratio()
    validate_selection()
    validate_bit_budget()

    print(f"\n{'=' * 60}")
    print(f"Results: {passed} passed, {failed} failed")

    if failed:
        print("\n⚠ VALIDATION FAILED — constants may be incorrect")
        sys.exit(1)
    else:
        print("\n✓ All validations passed")
        sys.exit(0)
