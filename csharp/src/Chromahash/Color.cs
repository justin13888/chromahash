namespace ChromaHash;

using static Constants;
using static MathUtils;

internal static class Color
{
    /// <summary>Convert linear RGB to OKLAB using the specified source gamut's M1 matrix.</summary>
    public static double[] LinearRgbToOklab(double[] rgb, Gamut gamut)
    {
        double[,] m1 = GetM1Matrix(gamut);
        double[] lms = Matvec3(m1, rgb);
        double[] lmsCbrt = [CbrtSigned(lms[0]), CbrtSigned(lms[1]), CbrtSigned(lms[2])];
        return Matvec3(M2, lmsCbrt);
    }

    /// <summary>Convert OKLAB to linear sRGB.</summary>
    public static double[] OklabToLinearSrgb(double[] lab)
    {
        double[] lmsCbrt = Matvec3(M2Inv, lab);
        double[] lms =
        [
            lmsCbrt[0] * lmsCbrt[0] * lmsCbrt[0],
            lmsCbrt[1] * lmsCbrt[1] * lmsCbrt[1],
            lmsCbrt[2] * lmsCbrt[2] * lmsCbrt[2],
        ];
        return Matvec3(M1InvSrgb, lms);
    }

    /// <summary>Convert gamma-encoded source RGB to OKLAB.</summary>
    public static double[] GammaRgbToOklab(double r, double g, double b, Gamut gamut)
    {
        Func<double, double> eotf = gamut switch
        {
            Gamut.Srgb or Gamut.DisplayP3 => Transfer.SrgbEotf,
            Gamut.AdobeRgb => Transfer.AdobeRgbEotf,
            Gamut.ProPhotoRgb => Transfer.ProPhotoRgbEotf,
            Gamut.Bt2020 => Transfer.Bt2020PqEotf,
            _ => throw new ArgumentOutOfRangeException(nameof(gamut)),
        };
        return LinearRgbToOklab([eotf(r), eotf(g), eotf(b)], gamut);
    }

    /// <summary>Convert OKLAB to gamma-encoded sRGB [0,1] with clamping.</summary>
    public static double[] OklabToSrgb(double[] lab)
    {
        double[] rgbLinear = OklabToLinearSrgb(lab);
        return
        [
            Transfer.SrgbGamma(Clamp01(rgbLinear[0])),
            Transfer.SrgbGamma(Clamp01(rgbLinear[1])),
            Transfer.SrgbGamma(Clamp01(rgbLinear[2])),
        ];
    }
}
