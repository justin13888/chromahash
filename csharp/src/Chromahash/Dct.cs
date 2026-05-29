namespace ChromaHash;

internal static class Dct
{
    /// <summary>
    /// Compute the AC coefficient scan order for an nx×ny grid keyed on aspectByte.
    /// Per spec §6.2 (v0.4): coefficients sorted ascending by per-pixel frequency priority
    /// `(cx*h)^2 + (cy*w)^2` where (w,h) = decodeOutputSize(aspectByte).
    /// Ties broken by (cx, cy). Excludes DC at (0,0).
    /// </summary>
    public static List<(int Cx, int Cy)> ScanOrder(int nx, int ny, byte aspectByte)
    {
        (uint wU, uint hU) = Aspect.DecodeOutputSize(aspectByte);
        ulong wL = wU;
        ulong hL = hU;
        var entries = new List<(ulong Priority, int Cx, int Cy)>();
        for (int cy = 0; cy < ny; cy++)
        {
            int cxStart = cy == 0 ? 1 : 0;
            int cx = cxStart;
            while (cx * ny < nx * (ny - cy))
            {
                ulong a = (ulong)cx * hL;
                ulong b = (ulong)cy * wL;
                entries.Add((a * a + b * b, cx, cy));
                cx++;
            }
        }
        entries.Sort((x, y) =>
        {
            int p = x.Priority.CompareTo(y.Priority);
            if (p != 0)
                return p;
            int c = x.Cx.CompareTo(y.Cx);
            if (c != 0)
                return c;
            return x.Cy.CompareTo(y.Cy);
        });
        return entries.Select(e => (e.Cx, e.Cy)).ToList();
    }

    /// <summary>
    /// Forward DCT encode for a channel. Per spec §12.6 dctEncode (v0.4).
    /// AC values are emitted in `scan` order. Returns (dc, ac_coefficients, scale).
    /// </summary>
    public static (double Dc, List<double> Ac, double Scale) DctEncode(
        double[] channel,
        int w,
        int h,
        List<(int Cx, int Cy)> scan
    )
    {
        double wh = (double)(w * h);

        // DC = mean (cos(0)=1 everywhere)
        double sum = 0.0;
        for (int i = 0; i < channel.Length; i++)
            sum += channel[i];
        double dc = sum / wh;

        var ac = new List<double>(scan.Count);
        double scale = 0.0;

        foreach (var (cx, cy) in scan)
        {
            double f = 0.0;
            for (int y = 0; y < h; y++)
            {
                double fy = MathUtils.PortableCos(Math.PI / h * cy * (y + 0.5));
                for (int x = 0; x < w; x++)
                {
                    f += channel[x + y * w] * MathUtils.PortableCos(Math.PI / w * cx * (x + 0.5)) * fy;
                }
            }
            f /= wh;
            ac.Add(f);
            scale = Math.Max(scale, Math.Abs(f));
        }

        // Floor near-zero scale to exactly zero.
        if (scale < 1e-10)
        {
            for (int i = 0; i < ac.Count; i++)
                ac[i] = 0.0;
            scale = 0.0;
        }

        return (dc, ac, scale);
    }

    /// <summary>
    /// Precompute cosine table for DCT: table[freq][pos] = cos(pi/dim * freq * (pos+0.5)).
    /// Per spec §12.6. Uses PortableCos for cross-platform determinism.
    /// </summary>
    public static double[][] PrecomputeCosTable(int dim, int maxFreq)
    {
        var table = new double[maxFreq][];
        for (int freq = 0; freq < maxFreq; freq++)
        {
            var row = new double[dim];
            for (int pos = 0; pos < dim; pos++)
            {
                row[pos] = MathUtils.PortableCos(Math.PI / dim * freq * (pos + 0.5));
            }
            table[freq] = row;
        }
        return table;
    }

    /// <summary>
    /// Forward DCT encode using precomputed cosine tables. Per spec §12.6 (v0.4).
    /// Semantically identical to DctEncode but avoids redundant cosine evaluations.
    /// cosX/cosY must have rows for all (cx, cy) in `scan`.
    /// </summary>
    public static (double Dc, List<double> Ac, double Scale) DctEncodeSeparable(
        double[] channel,
        int w,
        int h,
        List<(int Cx, int Cy)> scan,
        double[][] cosX,
        double[][] cosY
    )
    {
        double wh = (double)(w * h);

        // DC = mean (cosX[0]/cosY[0] are all-ones by construction)
        double sum = 0.0;
        for (int i = 0; i < channel.Length; i++)
            sum += channel[i];
        double dc = sum / wh;

        var ac = new List<double>(scan.Count);
        double scale = 0.0;

        foreach (var (cx, cy) in scan)
        {
            double[] cxRow = cosX[cx];
            double[] cyRow = cosY[cy];
            double f = 0.0;
            for (int y = 0; y < h; y++)
            {
                double fy = cyRow[y];
                for (int x = 0; x < w; x++)
                {
                    f += channel[x + y * w] * cxRow[x] * fy;
                }
            }
            f /= wh;
            ac.Add(f);
            scale = Math.Max(scale, Math.Abs(f));
        }

        if (scale < 1e-10)
        {
            for (int i = 0; i < ac.Count; i++)
                ac[i] = 0.0;
            scale = 0.0;
        }

        return (dc, ac, scale);
    }

    /// <summary>Inverse DCT at a single pixel (x, y) for a channel.</summary>
    public static double DctDecodePixel(
        double dc,
        List<double> ac,
        List<(int Cx, int Cy)> scanOrder,
        int x,
        int y,
        int w,
        int h
    )
    {
        double value = dc;
        for (int j = 0; j < scanOrder.Count; j++)
        {
            (int cx, int cy) = scanOrder[j];
            double cxFactor = cx > 0 ? 2.0 : 1.0;
            double cyFactor = cy > 0 ? 2.0 : 1.0;
            double fx = MathUtils.PortableCos(Math.PI / w * cx * (x + 0.5));
            double fy = MathUtils.PortableCos(Math.PI / h * cy * (y + 0.5));
            value += ac[j] * fx * fy * cxFactor * cyFactor;
        }
        return value;
    }

    /// <summary>
    /// Inverse DCT at a single pixel using precomputed cosine tables. Per spec §12.6.
    /// Semantically identical to DctDecodePixel but reads cosX[cx][x] / cosY[cy][y].
    /// The cx/cy factors stay as separate multiplies to preserve the float operation order.
    /// </summary>
    public static double DctDecodePixelSeparable(
        double dc,
        List<double> ac,
        List<(int Cx, int Cy)> scanOrder,
        int x,
        int y,
        double[][] cosX,
        double[][] cosY
    )
    {
        double value = dc;
        for (int j = 0; j < scanOrder.Count; j++)
        {
            (int cx, int cy) = scanOrder[j];
            double cxFactor = cx > 0 ? 2.0 : 1.0;
            double cyFactor = cy > 0 ? 2.0 : 1.0;
            double fx = cosX[cx][x];
            double fy = cosY[cy][y];
            value += ac[j] * fx * fy * cxFactor * cyFactor;
        }
        return value;
    }
}
