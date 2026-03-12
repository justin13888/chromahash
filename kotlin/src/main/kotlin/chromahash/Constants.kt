package chromahash

/** Gamut identifiers for source color spaces. */
enum class Gamut {
    SRGB,
    DISPLAY_P3,
    ADOBE_RGB,
    BT2020,
    PROPHOTO_RGB,
    ;

    /** Return the M1 matrix for this gamut. */
    internal fun m1Matrix(): Array<DoubleArray> =
        when (this) {
            SRGB -> M1_SRGB
            DISPLAY_P3 -> M1_DISPLAY_P3
            ADOBE_RGB -> M1_ADOBE_RGB
            BT2020 -> M1_BT2020
            PROPHOTO_RGB -> M1_PROPHOTO_RGB
        }
}

/** mu-law companding parameter. */
internal const val MU: Double = 5.0

/** Scale factor maximums. */
internal const val MAX_CHROMA_A: Double = 0.5
internal const val MAX_CHROMA_B: Double = 0.5
internal const val MAX_L_SCALE: Double = 0.5
internal const val MAX_A_SCALE: Double = 0.5
internal const val MAX_B_SCALE: Double = 0.5
internal const val MAX_A_ALPHA_SCALE: Double = 0.5

/** M2: LMS (cube-root) -> OKLAB [L, a, b] (Ottosson). */
internal val M2: Array<DoubleArray> =
    arrayOf(
        doubleArrayOf(0.2104542553, 0.7936177850, -0.0040720468),
        doubleArrayOf(1.9779984951, -2.4285922050, 0.4505937099),
        doubleArrayOf(0.0259040371, 0.7827717662, -0.8086757660),
    )

/** M2_INV: OKLAB [L, a, b] -> LMS (cube-root). */
internal val M2_INV: Array<DoubleArray> =
    arrayOf(
        doubleArrayOf(1.0000000000, 0.3963377774, 0.2158037573),
        doubleArrayOf(1.0000000000, -0.1055613458, -0.0638541728),
        doubleArrayOf(1.0000000000, -0.0894841775, -1.2914855480),
    )

/** M1[sRGB]: Linear sRGB -> LMS (Ottosson published). */
internal val M1_SRGB: Array<DoubleArray> =
    arrayOf(
        doubleArrayOf(0.4122214708, 0.5363325363, 0.0514459929),
        doubleArrayOf(0.2119034982, 0.6806995451, 0.1073969566),
        doubleArrayOf(0.0883024619, 0.2817188376, 0.6299787005),
    )

/** M1[Display P3]: Linear Display P3 -> LMS. */
internal val M1_DISPLAY_P3: Array<DoubleArray> =
    arrayOf(
        doubleArrayOf(0.4813798544, 0.4621183697, 0.0565017758),
        doubleArrayOf(0.2288319449, 0.6532168128, 0.1179512422),
        doubleArrayOf(0.0839457557, 0.2241652689, 0.6918889754),
    )

/** M1[Adobe RGB]: Linear Adobe RGB -> LMS. */
internal val M1_ADOBE_RGB: Array<DoubleArray> =
    arrayOf(
        doubleArrayOf(0.5764322615, 0.3699132211, 0.0536545174),
        doubleArrayOf(0.2963164739, 0.5916761266, 0.1120073994),
        doubleArrayOf(0.1234782548, 0.2194986958, 0.6570230494),
    )

/** M1 for BT.2020: Linear BT.2020 -> LMS. */
internal val M1_BT2020: Array<DoubleArray> =
    arrayOf(
        doubleArrayOf(0.6167557872, 0.3601983994, 0.0230458134),
        doubleArrayOf(0.2651330640, 0.6358393641, 0.0990275718),
        doubleArrayOf(0.1001026342, 0.2039065194, 0.6959908464),
    )

/** M1[ProPhoto RGB]: Linear ProPhoto RGB -> LMS (includes Bradford D50->D65). */
internal val M1_PROPHOTO_RGB: Array<DoubleArray> =
    arrayOf(
        doubleArrayOf(0.7154484635, 0.3527915480, -0.0682400115),
        doubleArrayOf(0.2744116551, 0.6677976408, 0.0577907040),
        doubleArrayOf(0.1097844385, 0.1861982875, 0.7040172740),
    )

/** M1_INV[sRGB]: LMS -> Linear sRGB (decoder matrix, Ottosson published). */
internal val M1_INV_SRGB: Array<DoubleArray> =
    arrayOf(
        doubleArrayOf(4.0767416621, -3.3077115913, 0.2309699292),
        doubleArrayOf(-1.2684380046, 2.6097574011, -0.3413193965),
        doubleArrayOf(-0.0041960863, -0.7034186147, 1.7076147010),
    )
