using System.IO;
using ChromaHash;

if (args.Length != 3)
{
    Console.Error.WriteLine("Usage: Chromahash.Cli <width> <height> <gamut>");
    return 1;
}

uint w = uint.Parse(args[0]);
uint h = uint.Parse(args[1]);

Gamut gamut = args[2] switch
{
    "srgb" => Gamut.Srgb,
    "displayp3" => Gamut.DisplayP3,
    "adobergb" => Gamut.AdobeRgb,
    "bt2020" => Gamut.Bt2020,
    "prophoto" => Gamut.ProPhotoRgb,
    _ => throw new ArgumentException($"unknown gamut: {args[2]}"),
};

int expectedLen = (int)(w * h * 4);
byte[] rgba = new byte[expectedLen];
using var stdin = Console.OpenStandardInput();
int totalRead = 0;
while (totalRead < expectedLen)
{
    int read = stdin.Read(rgba, totalRead, expectedLen - totalRead);
    if (read == 0) break;
    totalRead += read;
}

if (totalRead != expectedLen)
{
    Console.Error.WriteLine($"expected {expectedLen} bytes, got {totalRead}");
    return 1;
}

var hash = ChromaHash.ChromaHash.Encode(w, h, rgba, gamut);
using var stdout = Console.OpenStandardOutput();
stdout.Write(hash.AsBytes());

return 0;
