using System.Diagnostics;
using System.IO;
using ChromaHash;

static Gamut ParseGamut(string s) => s switch
{
    "srgb" => Gamut.Srgb,
    "displayp3" => Gamut.DisplayP3,
    "adobergb" => Gamut.AdobeRgb,
    "bt2020" => Gamut.Bt2020,
    "prophoto" => Gamut.ProPhotoRgb,
    _ => throw new ArgumentException($"unknown gamut: {s}"),
};

static byte[] ReadExact(Stream stream, int count)
{
    byte[] buf = new byte[count];
    int totalRead = 0;
    while (totalRead < count)
    {
        int read = stream.Read(buf, totalRead, count - totalRead);
        if (read == 0) break;
        totalRead += read;
    }
    if (totalRead != count)
    {
        Console.Error.WriteLine($"expected {count} bytes, got {totalRead}");
        Environment.Exit(1);
    }
    return buf;
}

static byte[] ReadAll(Stream stream)
{
    using var ms = new MemoryStream();
    stream.CopyTo(ms);
    return ms.ToArray();
}

// Quality tier from CHROMAHASH_TIER, matching the Rust harness so the
// cross-language benchmark measures the same workload in every language.
// Defaults to the 32-byte tier.
static byte TierFromEnv()
{
    string? raw = Environment.GetEnvironmentVariable("CHROMAHASH_TIER");
    if (string.IsNullOrEmpty(raw))
    {
        return ChromaHash.ChromaHash.DefaultTier;
    }
    if (!byte.TryParse(raw, out byte tier) || tier > ChromaHash.ChromaHash.MaxTier)
    {
        Console.Error.WriteLine(
            $"CHROMAHASH_TIER: '{raw}' is not a valid tier code (0..={ChromaHash.ChromaHash.MaxTier})");
        Environment.Exit(1);
    }
    return tier;
}

// Fail loudly if asked for a knob only the Rust harness has.
//
// CHROMAHASH_TUNE overrides format constants through chromahash::Tunables,
// which no binding exposes; CHROMAHASH_OUT selects a decode output gamut this
// CLI does not implement. Ignoring either silently is the dangerous failure: a
// sweep would label shipped-default numbers as an ablation and nothing
// downstream could tell.
static void RejectRustOnlyEnv()
{
    foreach (string key in new[] { "CHROMAHASH_TUNE", "CHROMAHASH_OUT" })
    {
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable(key)))
        {
            Console.Error.WriteLine(
                $"{key} is not supported by this harness (Rust-only); refusing to report numbers that would be silently mislabelled");
            Environment.Exit(1);
        }
    }
}

static long BenchEnvInt(string key, long fallback)
{
    string? raw = Environment.GetEnvironmentVariable(key);
    if (string.IsNullOrEmpty(raw))
    {
        return fallback;
    }
    if (!long.TryParse(raw, out long value))
    {
        Console.Error.WriteLine($"{key}: invalid value '{raw}'");
        Environment.Exit(1);
    }
    return value;
}

// Warm up for CHROMAHASH_BENCH_WARMUP_MS, then run CHROMAHASH_BENCH_REPS timed
// blocks of `iters` iterations, printing one mean-ns/op line per block on
// stdout. Everything else goes to stderr.
//
// Warmup is time-based rather than count-based because this contract is shared
// across seven harnesses whose per-op costs differ by two orders of magnitude,
// and because RyuJIT needs wall-clock time rather than a trip count to settle.
// The accumulator is written out at the end so the timed work cannot be elided.
static void RunBench(int iters, Func<byte> op)
{
    long reps = Math.Max(1, BenchEnvInt("CHROMAHASH_BENCH_REPS", 1));
    long warmupMs = BenchEnvInt("CHROMAHASH_BENCH_WARMUP_MS", 0);
    int n = Math.Max(1, iters);
    byte acc = 0;

    // At least one iteration, so the default also validates the input before the
    // first timed block.
    var warm = Stopwatch.StartNew();
    do
    {
        acc ^= op();
    }
    while (warm.ElapsedMilliseconds < warmupMs);

    for (long r = 0; r < reps; r++)
    {
        var sw = Stopwatch.StartNew();
        for (int i = 0; i < n; i++)
        {
            acc ^= op();
        }
        sw.Stop();
        long nsPerOp = (long)(sw.Elapsed.TotalNanoseconds / n);
        Console.Out.WriteLine(nsPerOp);
    }
    Console.Out.Flush();
    Console.Error.WriteLine($"checksum={acc:x}");
    Console.Error.WriteLine($"iters={n}");
}

if (args.Length < 1)
{
    Console.Error.WriteLine("Usage:");
    Console.Error.WriteLine("  Chromahash.Cli encode <width> <height> <gamut>");
    Console.Error.WriteLine("  Chromahash.Cli decode");
    Console.Error.WriteLine("  Chromahash.Cli average-color");
    Console.Error.WriteLine("  Chromahash.Cli batch-encode <width> <height> <gamut> <count>");
    Console.Error.WriteLine("  Chromahash.Cli batch-decode <count>");
    Console.Error.WriteLine("  Chromahash.Cli bench-encode <width> <height> <gamut> <iters>");
    Console.Error.WriteLine("  Chromahash.Cli bench-decode <iters> [max_width max_height]");
    Console.Error.WriteLine("  Chromahash.Cli bench-batch <width> <height> <gamut> <count>");
    Console.Error.WriteLine("  Chromahash.Cli bench-info");
    return 1;
}

switch (args[0])
{
    case "encode":
        {
            if (args.Length != 4)
            {
                Console.Error.WriteLine("Usage: Chromahash.Cli encode <width> <height> <gamut>");
                return 1;
            }
            uint w = uint.Parse(args[1]);
            uint h = uint.Parse(args[2]);
            Gamut gamut = ParseGamut(args[3]);

            int expectedLen = (int)(w * h * 4);
            using var stdin = Console.OpenStandardInput();
            byte[] rgba = ReadExact(stdin, expectedLen);

            var hash = ChromaHash.ChromaHash.EncodeWithQuality(w, h, rgba, gamut, TierFromEnv());
            using var stdout = Console.OpenStandardOutput();
            stdout.Write(hash.AsBytes());
            return 0;
        }
    case "decode":
        {
            using var stdin = Console.OpenStandardInput();
            byte[] hashBytes = ReadAll(stdin);

            var ch = ChromaHash.ChromaHash.FromBytes(hashBytes);
            var (_, _, rgba) = ch.Decode();
            using var stdout = Console.OpenStandardOutput();
            stdout.Write(rgba);
            return 0;
        }
    case "average-color":
        {
            using var stdin = Console.OpenStandardInput();
            byte[] hashBytes = ReadAll(stdin);

            var ch = ChromaHash.ChromaHash.FromBytes(hashBytes);
            byte[] avg = ch.AverageColor();
            using var stdout = Console.OpenStandardOutput();
            stdout.Write(avg);
            return 0;
        }
    case "batch-encode":
        {
            // Read one image, encode it `count` times through the parallel
            // BatchEncoder. Used to benchmark bulk throughput.
            if (args.Length != 5)
            {
                Console.Error.WriteLine(
                    "Usage: Chromahash.Cli batch-encode <width> <height> <gamut> <count>"
                );
                return 1;
            }
            uint w = uint.Parse(args[1]);
            uint h = uint.Parse(args[2]);
            Gamut gamut = ParseGamut(args[3]);
            int count = int.Parse(args[4]);

            using var stdin = Console.OpenStandardInput();
            byte[] rgba = ReadExact(stdin, (int)(w * h * 4));

            byte tier = TierFromEnv();
            var items = new ImageInput[count];
            for (int i = 0; i < count; i++)
                items[i] = new ImageInput(w, h, rgba, gamut, tier);

            using var enc = new BatchEncoder();
            var hashes = enc.EncodeBatch(items);
            // Write one result-derived byte so the work cannot be optimized away.
            using var stdout = Console.OpenStandardOutput();
            stdout.Write(new byte[] { hashes[0].AsBytes()[0] });
            return 0;
        }
    case "batch-decode":
        {
            // No batch decode API exists; loop the single decode `count` times.
            if (args.Length != 2)
            {
                Console.Error.WriteLine("Usage: Chromahash.Cli batch-decode <count>");
                return 1;
            }
            int count = int.Parse(args[1]);
            using var stdin = Console.OpenStandardInput();
            byte[] hashBytes = ReadAll(stdin);

            var ch = ChromaHash.ChromaHash.FromBytes(hashBytes);
            byte acc = 0;
            for (int i = 0; i < count; i++)
            {
                var (_, _, rgba) = ch.Decode();
                acc ^= rgba[0];
            }
            using var stdout = Console.OpenStandardOutput();
            stdout.Write(new byte[] { acc });
            return 0;
        }
    case "bench-encode":
        {
            if (args.Length != 5)
            {
                Console.Error.WriteLine("Usage: Chromahash.Cli bench-encode <width> <height> <gamut> <iters>");
                return 1;
            }
            RejectRustOnlyEnv();
            uint w = uint.Parse(args[1]);
            uint h = uint.Parse(args[2]);
            var gamut = ParseGamut(args[3]);
            int iters = int.Parse(args[4]);
            using var stdin = Console.OpenStandardInput();
            byte[] rgba = ReadExact(stdin, checked((int)(w * h * 4)));
            byte tier = TierFromEnv();
            RunBench(iters, () => ChromaHash.ChromaHash.EncodeWithQuality(w, h, rgba, gamut, tier).AsBytes()[0]);
            return 0;
        }
    case "bench-decode":
        {
            if (args.Length != 2 && args.Length != 4)
            {
                Console.Error.WriteLine("Usage: Chromahash.Cli bench-decode <iters> [max_width max_height]");
                return 1;
            }
            RejectRustOnlyEnv();
            int iters = int.Parse(args[1]);
            using var stdin = Console.OpenStandardInput();
            var ch = ChromaHash.ChromaHash.FromBytes(ReadAll(stdin));
            if (args.Length == 4)
            {
                uint maxW = uint.Parse(args[2]);
                uint maxH = uint.Parse(args[3]);
                RunBench(iters, () =>
                {
                    var (dw, dh, rgba) = ch.DecodeCapped(maxW, maxH);
                    return (byte)(rgba[0] ^ (byte)dw ^ (byte)dh);
                });
            }
            else
            {
                RunBench(iters, () =>
                {
                    var (dw, dh, rgba) = ch.Decode();
                    return (byte)(rgba[0] ^ (byte)dw ^ (byte)dh);
                });
            }
            return 0;
        }
    case "bench-batch":
        {
            if (args.Length != 5)
            {
                Console.Error.WriteLine("Usage: Chromahash.Cli bench-batch <width> <height> <gamut> <count>");
                return 1;
            }
            RejectRustOnlyEnv();
            uint w = uint.Parse(args[1]);
            uint h = uint.Parse(args[2]);
            var gamut = ParseGamut(args[3]);
            int count = int.Parse(args[4]);
            using var stdin = Console.OpenStandardInput();
            byte[] rgba = ReadExact(stdin, checked((int)(w * h * 4)));
            byte tier = TierFromEnv();
            var items = new ImageInput[count];
            for (int i = 0; i < count; i++)
            {
                items[i] = new ImageInput(w, h, rgba, gamut, tier);
            }
            int threads = (int)BenchEnvInt("CHROMAHASH_BATCH_THREADS", 0);
            using var enc = threads > 0 ? new BatchEncoder(threads) : new BatchEncoder();
            // One batch is one iteration, so the printed number is ns per batch.
            RunBench(1, () => enc.EncodeBatch(items)[0].AsBytes()[0]);
            return 0;
        }
    case "bench-info":
        {
            Console.Out.WriteLine("runtime=csharp");
            Console.Out.WriteLine($"dotnet_version={Environment.Version}");
            Console.Out.WriteLine($"arch={System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture}");
            Console.Out.WriteLine($"threads={Environment.ProcessorCount}");
            return 0;
        }
    default:
        Console.Error.WriteLine($"unknown subcommand: {args[0]}");
        return 1;
}
