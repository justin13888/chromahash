namespace ChromaHash;

/// <summary>Gamut identifiers for source color spaces.</summary>
public enum Gamut
{
    Srgb,
    DisplayP3,
    AdobeRgb,
    Bt2020,
    ProPhotoRgb,
}

internal static class Constants
{
    /// <summary>µ-law companding parameter (§7.3).</summary>
    public const double Mu = 5.0;

    /// <summary>Scale factor maximums (§7.2, §12.1).</summary>
    public const double MaxChromaA = 0.45;
    public const double MaxChromaB = 0.45;
    public const double MaxLScale = 0.5;
    public const double MaxAScale = 0.5;
    public const double MaxBScale = 0.5;
    public const double MaxAlphaScale = 0.5;

    /// <summary>M2: LMS (cube-root) → OKLAB [L, a, b] (Ottosson).</summary>
    public static readonly double[,] M2 =
    {
        { 0.2104542553, 0.7936177850, -0.0040720468 },
        { 1.9779984951, -2.4285922050, 0.4505937099 },
        { 0.0259040371, 0.7827717662, -0.8086757660 },
    };

    /// <summary>M2_INV: OKLAB [L, a, b] → LMS (cube-root).</summary>
    public static readonly double[,] M2Inv =
    {
        { 1.0000000000, 0.3963377774, 0.2158037573 },
        { 1.0000000000, -0.1055613458, -0.0638541728 },
        { 1.0000000000, -0.0894841775, -1.2914855480 },
    };

    /// <summary>M1[sRGB]: Linear sRGB → LMS (Ottosson published).</summary>
    public static readonly double[,] M1Srgb =
    {
        { 0.4122214708, 0.5363325363, 0.0514459929 },
        { 0.2119034982, 0.6806995451, 0.1073969566 },
        { 0.0883024619, 0.2817188376, 0.6299787005 },
    };

    /// <summary>M1[Display P3]: Linear Display P3 → LMS.</summary>
    public static readonly double[,] M1DisplayP3 =
    {
        { 0.4813798544, 0.4621183697, 0.0565017758 },
        { 0.2288319449, 0.6532168128, 0.1179512422 },
        { 0.0839457557, 0.2241652689, 0.6918889754 },
    };

    /// <summary>M1[Adobe RGB]: Linear Adobe RGB → LMS.</summary>
    public static readonly double[,] M1AdobeRgb =
    {
        { 0.5764322615, 0.3699132211, 0.0536545174 },
        { 0.2963164739, 0.5916761266, 0.1120073994 },
        { 0.1234782548, 0.2194986958, 0.6570230494 },
    };

    /// <summary>M1[BT.2020]: Linear BT.2020 → LMS.</summary>
    public static readonly double[,] M1Bt2020 =
    {
        { 0.6167557872, 0.3601983994, 0.0230458134 },
        { 0.2651330640, 0.6358393641, 0.0990275718 },
        { 0.1001026342, 0.2039065194, 0.6959908464 },
    };

    /// <summary>M1[ProPhoto RGB]: Linear ProPhoto RGB → LMS (includes Bradford D50→D65).</summary>
    public static readonly double[,] M1ProPhotoRgb =
    {
        { 0.7154484635, 0.3527915480, -0.0682400115 },
        { 0.2744116551, 0.6677976408, 0.0577907040 },
        { 0.1097844385, 0.1861982875, 0.7040172740 },
    };

    /// <summary>M1_INV[sRGB]: LMS → Linear sRGB (decoder matrix, Ottosson published).</summary>
    public static readonly double[,] M1InvSrgb =
    {
        { 4.0767416621, -3.3077115913, 0.2309699292 },
        { -1.2684380046, 2.6097574011, -0.3413193965 },
        { -0.0041960863, -0.7034186147, 1.7076147010 },
    };

    public static double[,] GetM1Matrix(Gamut gamut) =>
        gamut switch
        {
            Gamut.Srgb => M1Srgb,
            Gamut.DisplayP3 => M1DisplayP3,
            Gamut.AdobeRgb => M1AdobeRgb,
            Gamut.Bt2020 => M1Bt2020,
            Gamut.ProPhotoRgb => M1ProPhotoRgb,
            _ => throw new ArgumentOutOfRangeException(nameof(gamut)),
        };
}
