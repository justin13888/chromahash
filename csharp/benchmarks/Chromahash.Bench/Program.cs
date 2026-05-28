// Throughput benchmark: serial per-image encode vs. BatchEncoder.
//
// Zero dependencies — uses only System.Diagnostics.Stopwatch. Run with:
//
//   dotnet run -c Release --project csharp/benchmarks/Chromahash.Bench
//
// Prints images/sec and speedup for the batch path, plus a scaling sweep over
// worker-thread counts. Verifies batch output equals serial before timing.

using System.Diagnostics;
using ChromaHash;
using CH = ChromaHash.ChromaHash;

const int n = 2000;

int cores = Environment.ProcessorCount;
Console.WriteLine($"chromahash batch benchmark — {n} images, {cores} cores available\n");

var items = new ImageInput[n];
for (int i = 0; i < n; i++)
    items[i] = MakeImage(i);

// Warm up and verify correctness.
var warmSerial = EncodeSerial(items);
using (var warm = new BatchEncoder())
{
    var warmBatch = warm.EncodeBatch(items);
    for (int i = 0; i < n; i++)
        if (!warmSerial[i].Equals(warmBatch[i]))
            throw new InvalidOperationException("batch output must equal serial");
}

var sw = Stopwatch.StartNew();
var serial = EncodeSerial(items);
sw.Stop();
double serialSecs = sw.Elapsed.TotalSeconds;
Console.WriteLine(
    $"serial            : {serialSecs,8:F4}s  {ImagesPerSec(n, serialSecs),10:F0} img/s  (1.00x)"
);

using (var encoder = new BatchEncoder())
{
    encoder.EncodeBatch(items); // warm the pool
    sw.Restart();
    encoder.EncodeBatch(items);
    sw.Stop();
    double batchSecs = sw.Elapsed.TotalSeconds;
    Console.WriteLine(
        $"batch (default)   : {batchSecs,8:F4}s  {ImagesPerSec(n, batchSecs),10:F0} img/s  ({serialSecs / batchSecs:F2}x)"
    );
}

Console.WriteLine("\nscaling sweep (batch):");
var threadCounts = new List<int> { 1, 2, 4, 8 };
if (!threadCounts.Contains(cores))
    threadCounts.Add(cores);
foreach (int t in threadCounts)
{
    using var encoder = new BatchEncoder(t);
    encoder.EncodeBatch(items); // warm
    sw.Restart();
    encoder.EncodeBatch(items);
    sw.Stop();
    double secs = sw.Elapsed.TotalSeconds;
    Console.WriteLine(
        $"  threads={t,-3}      : {secs,8:F4}s  {ImagesPerSec(n, secs),10:F0} img/s  ({serialSecs / secs:F2}x)"
    );
}

static ImageInput MakeImage(int seed)
{
    uint w = (uint)(24 + seed % 40);
    uint h = (uint)(24 + (seed * 7) % 40);
    Gamut gamut = (seed % 5) switch
    {
        0 => Gamut.Srgb,
        1 => Gamut.DisplayP3,
        2 => Gamut.AdobeRgb,
        3 => Gamut.Bt2020,
        _ => Gamut.ProPhotoRgb,
    };
    int pixels = (int)(w * h);
    byte[] rgba = new byte[pixels * 4];
    for (int i = 0; i < pixels; i++)
    {
        rgba[i * 4] = (byte)((i * 3 + seed) % 256);
        rgba[i * 4 + 1] = (byte)((i * 5 + seed * 2) % 256);
        rgba[i * 4 + 2] = (byte)((i * 7 + seed * 3) % 256);
        rgba[i * 4 + 3] = (byte)(seed % 3 == 0 ? 200 : 255);
    }
    return new ImageInput(w, h, rgba, gamut);
}

static CH[] EncodeSerial(IReadOnlyList<ImageInput> items)
{
    var output = new CH[items.Count];
    for (int i = 0; i < items.Count; i++)
        output[i] = CH.Encode(items[i].Width, items[i].Height, items[i].Rgba, items[i].Gamut);
    return output;
}

static double ImagesPerSec(int count, double secs) =>
    secs > 0 ? count / secs : double.PositiveInfinity;
