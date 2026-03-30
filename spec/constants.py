"""ChromaHash Format Constants
==============================

Authoritative constant definitions for the ChromaHash LQIP format.
All implementations MUST use these exact values.

Matrices are derived from Björn Ottosson's OKLAB color space. M1[sRGB]
and M1_inv[sRGB] use Ottosson's published values directly. Other M1
matrices are computed as M_LMS × M_XYZ[gamut], where M_LMS is derived
from M1[sRGB] and the sRGB XYZ matrix. Run validate.py to verify.
"""

# =========================================================================
# Scalar Parameters
# =========================================================================

# µ-law companding parameter (§7.3)
MU = 5

# =========================================================================
# Scale Factor Maximums (§7.2, §12.1)
# =========================================================================
# These define quantization range bounds. Values exceeding these are clamped.
# Preliminary values — may be tightened in a future revision after empirical
# tuning against a reference image corpus.

MAX_CHROMA_A = 0.45        # Max absolute OKLAB 'a' DC value (covers BT.2020 max |a|=0.416)
MAX_CHROMA_B = 0.45        # Max absolute OKLAB 'b' DC value (covers ProPhoto max |b|=0.427)
MAX_L_SCALE = 0.5          # Max luminance AC amplitude
MAX_A_SCALE = 0.5          # Max chroma-a AC amplitude
MAX_B_SCALE = 0.5          # Max chroma-b AC amplitude
MAX_A_ALPHA_SCALE = 0.5    # Max alpha AC amplitude

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
# M1_inv: OKLAB LMS → Linear sRGB (Decoder Matrix)
# =========================================================================
# This is the ONLY M1 inverse the decoder needs. Ottosson's published values.

M1_INV_SRGB = [
    [ 4.0767416621, -3.3077115913,  0.2309699292],
    [-1.2684380046,  2.6097574011, -0.3413193965],
    [-0.0041960863, -0.7034186147,  1.7076147010],
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
