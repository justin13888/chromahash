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

if (args.Length < 1)
{
    Console.Error.WriteLine("Usage:");
    Console.Error.WriteLine("  Chromahash.Cli encode <width> <height> <gamut>");
    Console.Error.WriteLine("  Chromahash.Cli decode");
    Console.Error.WriteLine("  Chromahash.Cli average-color");
    Console.Error.WriteLine("  Chromahash.Cli batch-encode <width> <height> <gamut> <count>");
    Console.Error.WriteLine("  Chromahash.Cli batch-decode <count>");
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

            var hash = ChromaHash.ChromaHash.Encode(w, h, rgba, gamut);
            using var stdout = Console.OpenStandardOutput();
            stdout.Write(hash.AsBytes());
            return 0;
        }
    case "decode":
        {
            using var stdin = Console.OpenStandardInput();
            byte[] hashBytes = ReadExact(stdin, 32);

            var ch = ChromaHash.ChromaHash.FromBytes(hashBytes);
            var (_, _, rgba) = ch.Decode();
            using var stdout = Console.OpenStandardOutput();
            stdout.Write(rgba);
            return 0;
        }
    case "average-color":
        {
            using var stdin = Console.OpenStandardInput();
            byte[] hashBytes = ReadExact(stdin, 32);

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

            var items = new ImageInput[count];
            for (int i = 0; i < count; i++)
                items[i] = new ImageInput(w, h, rgba, gamut);

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
            byte[] hashBytes = ReadExact(stdin, 32);

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
    default:
        Console.Error.WriteLine($"unknown subcommand: {args[0]}");
        return 1;
}
