"""ChromaHash Format Constants
==============================

Authoritative constant definitions for the ChromaHash LQIP format.
All implementations MUST use these exact values.

Matrices are derived from Björn Ottosson's OKLAB color space. M1[sRGB]
and M1_inv[sRGB] use Ottosson's published values directly. Other M1
matrices are computed as M_LMS × M_XYZ[gamut], where M_LMS is derived
from M1[sRGB] and the sRGB XYZ matrix. Run validate.py to verify.
"""

from dataclasses import dataclass

# =========================================================================
# Scalar Parameters (locked by the 2026-06 comparison-corpus sweep;
# carried unchanged into wire-format v1)
# =========================================================================

# µ-law companding parameters, per channel group (§7.3). Chroma uses a higher
# µ because its scale range is tight (MAX_A/B_SCALE = 0.125), concentrating
# resolution where chroma coefficients actually live.
MU_L = 5         # Luminance AC
MU_C = 8         # Chroma a/b AC
MU_ALPHA = 5     # Alpha AC

# =========================================================================
# Quantization Range Maximums (§7.1, §7.2, §12.1)
# =========================================================================
# Values exceeding these are clamped at encode. The chroma DC ranges are
# sized to the union OKLAB hull of the display-output gamuts
# (sRGB ∪ Display P3 ∪ Adobe RGB: max |a| ≈ 0.347, max |b| ≈ 0.321), so
# wide-gamut colors are stored faithfully for rendering to a P3/Adobe
# display (§5.1) instead of being truncated to the sRGB hull. Range beyond
# the union hull is unreachable by any supported output and only wastes
# precision. The AC scale maximums are sized to measured signal: across the
# reference corpus the chroma AC scale never exceeds 0.113 (v0.5's 0.5
# range wasted two bits of precision and caused the characteristic chroma
# banding and desaturation).

MAX_CHROMA_A = 0.35        # Max absolute OKLAB 'a' DC (sRGB∪P3∪Adobe hull max |a| ≈ 0.347)
MAX_CHROMA_B = 0.33        # Max absolute OKLAB 'b' DC (sRGB∪P3∪Adobe hull max |b| ≈ 0.321)
MAX_L_SCALE = 0.5          # Max luminance AC amplitude
MAX_A_SCALE = 0.125        # Max chroma-a AC amplitude
MAX_B_SCALE = 0.125        # Max chroma-b AC amplitude
MAX_A_ALPHA_SCALE = 0.5    # Max alpha AC amplitude

# Out-of-sRGB OKLAB values are mapped by relative-colorimetric per-channel
# clipping in linear sRGB (§12.6) — no separate clamp constant is needed.

# =========================================================================
# Wire Format v1 — Framing (§2, §3)
# =========================================================================
# chromahash ships as release 0.7.0, but the on-wire format carries its own
# generation number, independent of the package semver. This is wire-format
# generation v1. Every framing parameter is a named constant so the encoder,
# decoder, and this file agree without scattered literals.

FORMAT_VERSION = 0      # 3-bit byte-0 version field; 0 = format v1. A decoder
#                         MUST reject any version it does not implement.
VERSION_BITS = 3        # Width of the byte-0 version field (bits 0..3)
TIER_BITS = 3           # Width of the byte-0 tier field (bits 3..6)
ALPHA_FLAG_BIT = 6      # Bit position of the hasAlpha flag within byte 0
RESERVED_FLAG_BIT = 7   # Bit position of the reserved flag (MUST be 0 in v1)

# Highest quality tier v1 defines: tiers 0..=MAX_TIER are valid; 4..=7 are
# reserved and MUST be rejected by a v1 decoder.
MAX_TIER = 3
# Tier-0 natural-render long edge (px). The long edge scales to
# BASE_LONG_EDGE << tier (32 / 64 / 128 / 256 px).
BASE_LONG_EDGE = 32

# DC code bit widths (L, a, b) — identical quantization to v0.6.
L_DC_BITS = 7
A_DC_BITS = 7
B_DC_BITS = 7
# AC scale code bit widths (L, a, b).
L_SCALE_BITS = 6
A_SCALE_BITS = 6
B_SCALE_BITS = 5
# Alpha DC / scale code bit widths (present only in alpha mode).
ALPHA_DC_BITS = 5
ALPHA_SCALE_BITS = 4

# Byte 0 (descriptor) + byte 1 (aspect) = 16 bits.
DESCRIPTOR_BITS = 16
# DC + scale prefix after the descriptor/aspect bytes
# (L/a/b DC = 21 bits, L/a/b scale = 17 bits).
DC_SCALE_BITS = (
    L_DC_BITS + A_DC_BITS + B_DC_BITS + L_SCALE_BITS + A_SCALE_BITS + B_SCALE_BITS
)
# Fixed prefix before the AC payload: descriptor + aspect + DC + scales = 54 bits.
PREFIX_BITS = DESCRIPTOR_BITS + DC_SCALE_BITS
# Extra prefix bits present only in alpha mode (alpha DC 5 + alpha scale 4).
ALPHA_PREFIX_BITS = ALPHA_DC_BITS + ALPHA_SCALE_BITS

# =========================================================================
# AC Layout (§3.2, §6.4)
# =========================================================================
# How the per-channel AC budget is split. Counts are the TIER-0 BASE; tier m
# scales every count by 4^m (bits per coefficient stay constant — higher tiers
# carry MORE coefficients, not finer ones). L coefficients are written in
# selection order through up to two precision tiers (a tier with count 0 is
# unused). Chroma a/b each get c_count coefficients at c_bits. The la_*/ca_*
# fields are the alpha-mode equivalents (alpha mode additionally stores alpha
# DC 5b + scale 4b + scaled alpha AC). Which K coefficients are chosen is
# defined in §6 (see selection.py).


@dataclass(frozen=True)
class AcLayout:
    """AC bit layout: tier-0 base counts and bit widths (mirrors Rust AcLayout)."""

    l_tiers: tuple[tuple[int, int], tuple[int, int]]   # no-alpha L (count, bits) ×2
    c_count: int                                       # no-alpha chroma a/b count
    c_bits: int
    la_tiers: tuple[tuple[int, int], tuple[int, int]]  # alpha-mode L (count, bits) ×2
    ca_count: int                                      # alpha-mode chroma a/b count
    ca_bits: int


# Layout B: the v1 tier-0 base (the shipped default). Sized so a tier-0 hash is
# exactly 32 bytes for both alpha modes (the v0.6 footprint, for equal-budget
# comparison):
#   no-alpha = 54 prefix + 26·5 L + 2·9·4 chroma                  = 256 bits
#   alpha    = 54 + 9 + 20·5 L + 2·9·4 chroma + 5·4 alpha         = 255 bits
# (both round up to 32 bytes).
LAYOUT_B = AcLayout(
    l_tiers=((26, 5), (0, 5)),
    c_count=9,
    c_bits=4,
    la_tiers=((20, 5), (0, 5)),
    ca_count=9,
    ca_bits=4,
)

# The shipped default layout (Tunables::DEFAULT.layout in the Rust reference).
DEFAULT_LAYOUT = LAYOUT_B

# Alpha-channel AC coefficients at tier 0 (alpha mode only) and their bit width.
ALPHA_AC_COUNT = 5
ALPHA_AC_BITS = 4


@dataclass(frozen=True)
class AcShape:
    """Per-channel AC counts/bit-widths resolved for one (alpha mode, tier).

    The base AcLayout describes tier 0; tier m scales every coefficient COUNT
    by 4^m while bit widths stay fixed.
    """

    l_tiers: tuple[tuple[int, int], tuple[int, int]]   # L precision tiers (count, bits)
    c_count: int                                       # chroma a/b count (each channel)
    c_bits: int
    alpha_ac_count: int                                # 0 when not in alpha mode

    def l_count(self) -> int:
        """Total L coefficient count across both precision tiers."""
        return self.l_tiers[0][0] + self.l_tiers[1][0]


def tier_count_scale(tier: int) -> int:
    """4^tier — the count multiplier for a quality tier (1, 4, 16, 64)."""
    return 1 << (2 * tier)


def ac_shape(layout: AcLayout, has_alpha: bool, tier: int) -> AcShape:
    """Resolve the base layout for a (alpha mode, tier): pick the alpha or
    no-alpha base counts, then scale every count by 4^tier."""
    s = tier_count_scale(tier)
    if has_alpha:
        return AcShape(
            l_tiers=(
                (layout.la_tiers[0][0] * s, layout.la_tiers[0][1]),
                (layout.la_tiers[1][0] * s, layout.la_tiers[1][1]),
            ),
            c_count=layout.ca_count * s,
            c_bits=layout.ca_bits,
            alpha_ac_count=ALPHA_AC_COUNT * s,
        )
    return AcShape(
        l_tiers=(
            (layout.l_tiers[0][0] * s, layout.l_tiers[0][1]),
            (layout.l_tiers[1][0] * s, layout.l_tiers[1][1]),
        ),
        c_count=layout.c_count * s,
        c_bits=layout.c_bits,
        alpha_ac_count=0,
    )


def ac_payload_bits(shape: AcShape) -> int:
    """AC payload bits for a resolved shape: L tiers + both chroma channels +
    alpha AC. Excludes the prefix and the alpha DC/scale (see body_len_bytes)."""
    l_bits = sum(n * b for (n, b) in shape.l_tiers)
    return (
        l_bits
        + 2 * shape.c_count * shape.c_bits
        + shape.alpha_ac_count * ALPHA_AC_BITS
    )


def body_len_bytes(layout: AcLayout, has_alpha: bool, tier: int) -> int:
    """Total encoded length in bytes for a (layout, alpha mode, tier): the fixed
    prefix (+ alpha DC/scale in alpha mode) plus the AC payload, rounded up to a
    whole number of bytes. The deterministic length a decoder recomputes to
    validate a hash."""
    bits = PREFIX_BITS + ac_payload_bits(ac_shape(layout, has_alpha, tier))
    if has_alpha:
        bits += ALPHA_PREFIX_BITS
    return (bits + 7) // 8

# =========================================================================
# OKLAB Core Matrices (Björn Ottosson)
# =========================================================================

# M2: LMS (cube-root) → OKLAB [L, a, b]
# Property: M2 × [1, 1, 1]^T = [1, 0, 0]^T (white → L=1, a=0, b=0)
M2 = [
    [ 0.2104542553,  0.7936177850, -0.0040720468],
    [ 1.9779984951, -2.4285922050,  0.4505937099],
    [ 0.0259040371,  0.7827717662, -0.8086757660],
]

# M2_inv: OKLAB [L, a, b] → LMS (cube-root)
M2_INV = [
    [1.0000000000,  0.3963377774,  0.2158037573],
    [1.0000000000, -0.1055613458, -0.0638541728],
    [1.0000000000, -0.0894841775, -1.2914855480],
]

# =========================================================================
# M1 Matrices: Linear RGB → OKLAB LMS
# =========================================================================
# Each matrix converts from linear RGB in the specified gamut to the LMS
# space used by OKLAB. The full OKLAB forward transform is:
#
#   linear_rgb → LMS (M1) → cbrt → OKLAB (M2)
#
# Property: For all gamuts, M1 × [1, 1, 1]^T ≈ [1, 1, 1]^T
# (D65 white maps to LMS white)
#
# Derivation: M1[gamut] = M_LMS × M_XYZ[gamut], where M_LMS is the
# implicit XYZ→LMS matrix derived from Ottosson's M1[sRGB] and the
# standard sRGB XYZ matrix. See validate.py for full derivation.

# sRGB (IEC 61966-2-1) — Ottosson's published values
M1_SRGB = [
    [ 0.4122214708,  0.5363325363,  0.0514459929],
    [ 0.2119034982,  0.6806995451,  0.1073969566],
    [ 0.0883024619,  0.2817188376,  0.6299787005],
]

# Display P3 (DCI-P3 primaries, D65 white, sRGB transfer function)
M1_DISPLAY_P3 = [
    [ 0.4813798544,  0.4621183697,  0.0565017758],
    [ 0.2288319449,  0.6532168128,  0.1179512422],
    [ 0.0839457557,  0.2241652689,  0.6918889754],
]

# Adobe RGB (1998)
M1_ADOBE_RGB = [
    [ 0.5764322615,  0.3699132211,  0.0536545174],
    [ 0.2963164739,  0.5916761266,  0.1120073994],
    [ 0.1234782548,  0.2194986958,  0.6570230494],
]

# BT.2020 (ITU-R BT.2020)
M1_BT2020 = [
    [ 0.6167557872,  0.3601983994,  0.0230458134],
    [ 0.2651330640,  0.6358393641,  0.0990275718],
    [ 0.1001026342,  0.2039065194,  0.6959908464],
]

# ProPhoto RGB (ROMM RGB) — includes Bradford adaptation from D50 to D65
M1_PROPHOTO_RGB = [
    [ 0.7154484635,  0.3527915480, -0.0682400115],
    [ 0.2744116551,  0.6677976408,  0.0577907040],
    [ 0.1097844385,  0.1861982875,  0.7040172740],
]

# =========================================================================
# M1_inv: OKLAB LMS → Linear RGB (Decoder Matrices)
# =========================================================================
# One inverse per supported display-output gamut (§11.1): sRGB (the default
# and the fallback for BT.2020/ProPhoto output requests), Display P3, and
# Adobe RGB. sRGB values are Ottosson's published constants; the others are
# the inverses of the corresponding M1 matrices above (verified by
# validate.py).

M1_INV_SRGB = [
    [ 4.0767416621, -3.3077115913,  0.2309699292],
    [-1.2684380046,  2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147,  1.7076147010],
]

M1_INV_DISPLAY_P3 = [
    [ 3.1277689869, -2.2571357957,  0.1293668089],
    [-1.0910090475,  2.4133317585, -0.3223227108],
    [-0.0260108130, -0.5080413260,  1.5340521389],
]

M1_INV_ADOBE_RGB = [
    [ 2.5540368478, -1.6219762024,  0.0679393544],
    [-1.2684380042,  2.6097574007, -0.3413193963],
    [-0.0562347471, -0.5670418342,  1.6232765812],
]

# =========================================================================
# Gamut Chromaticity Coordinates (CIE 1931 xy)
# =========================================================================
# Used by validate.py to independently derive M1 matrices from first
# principles. These are from the respective color space standards.

GAMUT_PRIMARIES = {
    "sRGB": {
        "R": (0.6400, 0.3300),
        "G": (0.3000, 0.6000),
        "B": (0.1500, 0.0600),
        "white": "D65",
    },
    "Display P3": {
        "R": (0.6800, 0.3200),
        "G": (0.2650, 0.6900),
        "B": (0.1500, 0.0600),
        "white": "D65",
    },
    "Adobe RGB": {
        "R": (0.6400, 0.3300),
        "G": (0.2100, 0.7100),
        "B": (0.1500, 0.0600),
        "white": "D65",
    },
    "BT.2020": {
        "R": (0.7080, 0.2920),
        "G": (0.1700, 0.7970),
        "B": (0.1310, 0.0460),
        "white": "D65",
    },
    "ProPhoto RGB": {
        "R": (0.734699, 0.265301),
        "G": (0.159597, 0.840403),
        "B": (0.036598, 0.000105),
        "white": "D50",
    },
}

# Standard illuminant chromaticities
D65_XY = (0.3127, 0.3290)
D50_XY = (0.3457, 0.3585)

# Bradford chromatic adaptation matrix (CIE)
M_BRADFORD = [
    [ 0.8951000,  0.2664000, -0.1614000],
    [-0.7502000,  1.7135000,  0.0367000],
    [ 0.0389000, -0.0685000,  1.0296000],
]
