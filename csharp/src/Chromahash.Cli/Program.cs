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
    default:
        Console.Error.WriteLine($"unknown subcommand: {args[0]}");
        return 1;
}
