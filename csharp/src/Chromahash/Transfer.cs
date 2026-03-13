namespace ChromaHash;

internal static class Transfer
{
    /// <summary>sRGB EOTF (gamma → linear), per spec §5.4.</summary>
    public static double SrgbEotf(double x)
    {
        if (x <= 0.04045)
            return x / 12.92;
        else
            return MathUtils.PortablePow((x + 0.055) / 1.055, 2.4);
    }

    /// <summary>sRGB gamma (linear → gamma), per spec §12.7.</summary>
    public static double SrgbGamma(double x)
    {
        if (x <= 0.0031308)
            return 12.92 * x;
        else
            return 1.055 * MathUtils.PortablePow(x, 1.0 / 2.4) - 0.055;
    }

    /// <summary>Adobe RGB EOTF (gamma → linear): x^2.2.</summary>
    public static double AdobeRgbEotf(double x) => MathUtils.PortablePow(x, 2.2);

    /// <summary>ProPhoto RGB EOTF (gamma → linear): x^1.8.</summary>
    public static double ProPhotoRgbEotf(double x) => MathUtils.PortablePow(x, 1.8);

    /// <summary>BT.2020 PQ (ST 2084) inverse EOTF → linear light, then Reinhard tone-map to SDR.</summary>
    public static double Bt2020PqEotf(double x)
    {
        const double m1 = 0.1593017578125;
        const double m2 = 78.84375;
        const double c1 = 0.8359375;
        const double c2 = 18.8515625;
        const double c3 = 18.6875;

        double n = MathUtils.PortablePow(x, 1.0 / m2);
        double num = Math.Max(n - c1, 0.0);
        double den = c2 - c3 * n;
        double yLinear = MathUtils.PortablePow(num / den, 1.0 / m1);

        // PQ output is in [0, 10000] cd/m²
        double yNits = yLinear * 10000.0;

        // Simple Reinhard tone mapping: L / (1 + L)
        // SDR reference white = 203 nits
        double l = yNits / 203.0;
        return l / (1.0 + l);
    }
}
