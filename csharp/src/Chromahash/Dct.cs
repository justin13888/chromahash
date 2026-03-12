namespace ChromaHash;

internal static class Dct
{
    /// <summary>
    /// Compute the triangular scan order for an nx×ny grid, excluding DC.
    /// Per spec §6.6: row-major, condition cx*ny &lt; nx*(ny-cy), skip (0,0).
    /// </summary>
    public static List<(int Cx, int Cy)> TriangularScanOrder(int nx, int ny)
    {
        var order = new List<(int, int)>();
        for (int cy = 0; cy < ny; cy++)
        {
            int cxStart = cy == 0 ? 1 : 0;
            int cx = cxStart;
            while (cx * ny < nx * (ny - cy))
            {
                order.Add((cx, cy));
                cx++;
            }
        }
        return order;
    }

    /// <summary>
    /// Forward DCT encode for a channel. Per spec §12.7 dctEncode.
    /// Returns (dc, ac_coefficients, scale).
    /// </summary>
    public static (double Dc, List<double> Ac, double Scale) DctEncode(
        double[] channel,
        int w,
        int h,
        int nx,
        int ny
    )
    {
        double wh = (double)(w * h);
        double dc = 0.0;
        var ac = new List<double>();
        double scale = 0.0;

        for (int cy = 0; cy < ny; cy++)
        {
            int cx = 0;
            while (cx * ny < nx * (ny - cy))
            {
                double f = 0.0;
                for (int y = 0; y < h; y++)
                {
                    double fy = Math.Cos(Math.PI / h * cy * (y + 0.5));
                    for (int x = 0; x < w; x++)
                    {
                        f += channel[x + y * w] * Math.Cos(Math.PI / w * cx * (x + 0.5)) * fy;
                    }
                }
                f /= wh;
                if (cx > 0 || cy > 0)
                {
                    ac.Add(f);
                    scale = Math.Max(scale, Math.Abs(f));
                }
                else
                {
                    dc = f;
                }
                cx++;
            }
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
            double fx = Math.Cos(Math.PI / w * cx * (x + 0.5));
            double fy = Math.Cos(Math.PI / h * cy * (y + 0.5));
            value += ac[j] * fx * fy * cxFactor * cyFactor;
        }
        return value;
    }
}
