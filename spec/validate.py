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
    MAX_A_ALPHA_SCALE,
    MAX_A_SCALE,
    MAX_B_SCALE,
    MAX_CHROMA_A,
    MAX_CHROMA_B,
    MAX_L_SCALE,
    MU,
)

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
    """Check MAX_CHROMA_A/B cover all gamut corners (except extreme ProPhoto)."""
    print("\n5. OKLAB bounds and MAX_CHROMA coverage")

    max_a = 0.0
    max_b = 0.0
    practical_max_a = 0.0  # Excluding ProPhoto imaginary primaries
    practical_max_b = 0.0  # Excluding ProPhoto imaginary primaries

    for name, M1 in STORED_M1.items():
        for r in [0.0, 1.0]:
            for g in [0.0, 1.0]:
                for b in [0.0, 1.0]:
                    if r == 0 and g == 0 and b == 0:
                        continue
                    lms = matvec(M1, [r, g, b])
                    lms_cbrt = [math.copysign(abs(x) ** (1/3), x) for x in lms]
                    lab = matvec(M2, lms_cbrt)

                    max_a = max(max_a, abs(lab[1]))
                    max_b = max(max_b, abs(lab[2]))

                    if name != "ProPhoto RGB":
                        practical_max_a = max(practical_max_a, abs(lab[1]))
                        practical_max_b = max(practical_max_b, abs(lab[2]))

    check(MAX_CHROMA_A >= practical_max_a,
          f"MAX_CHROMA_A={MAX_CHROMA_A} ≥ practical max |a|={practical_max_a:.4f}")
    check(MAX_CHROMA_B >= practical_max_b,
          f"MAX_CHROMA_B={MAX_CHROMA_B} ≥ practical max |b|={practical_max_b:.4f}")
    check(MAX_CHROMA_B >= max_b,
          f"MAX_CHROMA_B={MAX_CHROMA_B} ≥ all-gamut max |b|={max_b:.4f}")

    # Check margin over BT.2020 (tightest practical constraint)
    margin_a = MAX_CHROMA_A - practical_max_a
    check(margin_a >= 0.03,
          f"MAX_CHROMA_A margin over BT.2020: {margin_a:.4f} ≥ 0.03")

    # Note ProPhoto blue exceeds MAX_CHROMA_A (expected, documented)
    if max_a > MAX_CHROMA_A:
        print(f"  ℹ ProPhoto RGB blue |a|={max_a:.4f} exceeds MAX_CHROMA_A={MAX_CHROMA_A} (expected, clips)")


def validate_scale_constants():
    """Check scale constants are positive and reasonable."""
    print("\n6. Scale factor constants")

    for name, val in [
        ("MAX_L_SCALE", MAX_L_SCALE),
        ("MAX_A_SCALE", MAX_A_SCALE),
        ("MAX_B_SCALE", MAX_B_SCALE),
        ("MAX_A_ALPHA_SCALE", MAX_A_ALPHA_SCALE),
    ]:
        check(val > 0, f"{name} = {val} > 0")
        check(val <= 1.0, f"{name} = {val} ≤ 1.0")


def validate_mu_law():
    """Check µ-law round-trip properties."""
    print("\n7. µ-law companding round-trip")

    def mu_compress(v, mu):
        return math.copysign(1, v) * math.log(1 + mu * abs(v)) / math.log(1 + mu)

    def mu_expand(c, mu):
        return math.copysign(1, c) * ((1 + mu) ** abs(c) - 1) / mu

    # Round-trip at extreme values
    for v in [-1.0, -0.5, 0.0, 0.5, 1.0]:
        c = mu_compress(v, MU)
        rt = mu_expand(c, MU)
        err = abs(rt - v)
        check(err < 1e-12, f"µ-law round-trip at v={v:+.1f} (err={err:.2e})")

    # Check compressed range is [-1, 1]
    c_max = mu_compress(1.0, MU)
    c_min = mu_compress(-1.0, MU)
    check(abs(c_max - 1.0) < 1e-12, f"µ-law(1.0) = {c_max:.10f} ≈ 1.0")
    check(abs(c_min + 1.0) < 1e-12, f"µ-law(-1.0) = {c_min:.10f} ≈ -1.0")


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


def validate_derive_grid():
    """Check deriveGrid() produces correct grids for all aspect bytes."""
    print("\n9. Adaptive grid derivation (deriveGrid)")

    def round_half_away_from_zero(x):
        return math.floor(x + 0.5) if x >= 0 else math.ceil(x - 0.5)

    def derive_grid(aspect_byte, base_n):
        ratio = 2.0 ** (aspect_byte / 255.0 * 8.0 - 4.0)
        if ratio >= 1.0:
            scale = min(ratio, 16.0)
            nx = round_half_away_from_zero(base_n * scale ** 0.25)
            ny = round_half_away_from_zero(base_n / scale ** 0.25)
        else:
            scale = min(1.0 / ratio, 16.0)
            nx = round_half_away_from_zero(base_n / scale ** 0.25)
            ny = round_half_away_from_zero(base_n * scale ** 0.25)
        return (max(int(nx), 3), max(int(ny), 3))

    def tri_ac(nx, ny):
        c = 0
        for cy in range(ny):
            cx = 1 if cy == 0 else 0
            while cx * ny < nx * (ny - cy):
                c += 1
                cx += 1
        return c

    # Channel configs: (base_n, ac_cap, label)
    channels = [
        (7, 27, "L no-alpha"),
        (4, 9, "chroma"),
        (6, 20, "L alpha"),
        (3, 5, "alpha"),
    ]

    for base_n, cap, label in channels:
        min_ac = 999
        all_ok = True
        unique_grids = set()
        for b in range(256):
            nx, ny = derive_grid(b, base_n)
            ac = tri_ac(nx, ny)
            unique_grids.add((nx, ny))
            min_ac = min(min_ac, ac)
            if nx < 3 or ny < 3:
                all_ok = False

        check(all_ok, f"{label} (base_n={base_n}): all grids have nx,ny ≥ 3")
        # For all channels except alpha-mode L, min_ac >= cap
        if base_n != 6:
            check(min_ac >= cap,
                  f"{label} (base_n={base_n}): min raw AC {min_ac} ≥ cap {cap}")
        else:
            # Alpha-mode L: 4x8 and 8x4 produce 19, cap is 20
            check(min_ac >= cap - 1,
                  f"{label} (base_n={base_n}): min raw AC {min_ac} ≥ cap-1 ({cap - 1})")

    # Spot-check known grid values from REVISION.md tables
    spot_checks = [
        # (aspect_byte, base_n, expected_nx, expected_ny)
        (0, 7, 4, 14),     # L extreme portrait
        (128, 7, 7, 7),    # L square (approx 1:1)
        (255, 7, 14, 4),   # L extreme landscape
        (0, 4, 3, 8),      # chroma extreme portrait
        (128, 4, 4, 4),    # chroma square
        (255, 4, 8, 3),    # chroma extreme landscape
        (0, 6, 3, 12),     # alpha-L extreme portrait
        (128, 6, 6, 6),    # alpha-L square
        (255, 6, 12, 3),   # alpha-L extreme landscape
        (0, 3, 3, 6),      # alpha extreme portrait
        (128, 3, 3, 3),    # alpha square
        (255, 3, 6, 3),    # alpha extreme landscape
    ]
    for ab, bn, exp_nx, exp_ny in spot_checks:
        nx, ny = derive_grid(ab, bn)
        check(nx == exp_nx and ny == exp_ny,
              f"deriveGrid({ab}, {bn}) = ({nx},{ny}), expected ({exp_nx},{exp_ny})")

    # Verify portrait/landscape symmetry: grid at byte b mirrors grid at byte (255-b)
    # with swapped nx, ny (due to log-symmetric aspect encoding)
    sym_ok = True
    for base_n in [7, 4, 6, 3]:
        for b in range(128):
            nx_lo, ny_lo = derive_grid(b, base_n)
            nx_hi, ny_hi = derive_grid(255 - b, base_n)
            if not (nx_lo == ny_hi and ny_lo == nx_hi):
                sym_ok = False
    check(sym_ok, "Portrait/landscape grid symmetry across all channels")


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
    validate_derive_grid()

    print(f"\n{'=' * 60}")
    print(f"Results: {passed} passed, {failed} failed")

    if failed:
        print("\n⚠ VALIDATION FAILED — constants may be incorrect")
        sys.exit(1)
    else:
        print("\n✓ All validations passed")
        sys.exit(0)
