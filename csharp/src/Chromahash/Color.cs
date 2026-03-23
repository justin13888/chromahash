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
        double[] lmsCbrt = [CbrtHalley(lms[0]), CbrtHalley(lms[1]), CbrtHalley(lms[2])];
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

    /// <summary>Check whether all RGB channels are in [0, 1].</summary>
    public static bool InGamut(double[] rgb) =>
        rgb[0] >= 0.0 && rgb[0] <= 1.0 &&
        rgb[1] >= 0.0 && rgb[1] <= 1.0 &&
        rgb[2] >= 0.0 && rgb[2] <= 1.0;

    /// <summary>Soft gamut clamp via OKLch bisection. Per spec §6.1.</summary>
    public static double[] SoftGamutClamp(double l, double a, double b)
    {
        double[] rgb = OklabToLinearSrgb([l, a, b]);
        if (InGamut(rgb)) return [l, a, b];

        double c = Math.Sqrt(a * a + b * b);
        if (c < 1e-10) return [l, 0.0, 0.0];

        double hCos = a / c;
        double hSin = b / c;
        double lo = 0.0;
        double hi = c;
        // Exactly 16 iterations — deterministic per spec §6.1
        for (int i = 0; i < 16; i++)
        {
            double mid = (lo + hi) / 2.0;
            double[] rgbTest = OklabToLinearSrgb([l, mid * hCos, mid * hSin]);
            if (InGamut(rgbTest)) lo = mid; else hi = mid;
        }
        return [l, lo * hCos, lo * hSin];
    }

    /// <summary>4096-entry sRGB gamma LUT: lut[i] = sRGB8(i/4095). Per spec §6.2.</summary>
    public static readonly int[] GammaLut = Enumerable.Range(0, 4096)
        .Select(i => (int)RoundHalfAwayFromZero(Transfer.SrgbGamma(i / 4095.0) * 255.0))
        .ToArray();

    /// <summary>Map a linear [0,1] value to sRGB u8 via the gamma LUT. Per spec §6.2.</summary>
    public static byte LinearToSrgb8(double x)
    {
        long raw = (long)RoundHalfAwayFromZero(x * 4095.0);
        int idx = (int)Math.Clamp(raw, 0, 4095);
        return (byte)GammaLut[idx];
    }
}
