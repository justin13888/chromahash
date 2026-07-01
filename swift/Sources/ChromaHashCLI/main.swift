import ChromaHash
import Foundation

func parseGamut(_ s: String) -> Gamut {
  switch s {
  case "srgb": return .sRGB
  case "displayp3": return .displayP3
  case "adobergb": return .adobeRGB
  case "bt2020": return .bt2020
  case "prophoto": return .proPhotoRGB
  default:
    FileHandle.standardError.write(Data("unknown gamut: \(s)\n".utf8))
    exit(1)
  }
}

func printUsage() -> Never {
  FileHandle.standardError.write(
    Data(
      """
      Usage:
        ChromaHashCLI encode <width> <height> <gamut>
        ChromaHashCLI decode
        ChromaHashCLI average-color
        ChromaHashCLI batch-encode <width> <height> <gamut> <count>
        ChromaHashCLI batch-decode <count>\n
      """.utf8))
  exit(1)
}

guard CommandLine.arguments.count >= 2 else {
  printUsage()
}

switch CommandLine.arguments[1] {
case "encode":
  guard CommandLine.arguments.count == 5 else {
    FileHandle.standardError.write(
      Data("Usage: ChromaHashCLI encode <width> <height> <gamut>\n".utf8))
    exit(1)
  }
  guard let w = Int(CommandLine.arguments[2]),
    let h = Int(CommandLine.arguments[3])
  else {
    FileHandle.standardError.write(Data("invalid width or height\n".utf8))
    exit(1)
  }
  let gamut = parseGamut(CommandLine.arguments[4])

  let expectedLen = w * h * 4
  let stdinData = FileHandle.standardInput.readDataToEndOfFile()
  let rgba = [UInt8](stdinData)

  guard rgba.count == expectedLen else {
    FileHandle.standardError.write(
      Data("expected \(expectedLen) bytes, got \(rgba.count)\n".utf8))
    exit(1)
  }

  let hash = ChromaHash.encode(width: w, height: h, rgba: rgba, gamut: gamut)
  FileHandle.standardOutput.write(Data(hash.hash))

case "decode":
  let hashBytes = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let ch = ChromaHash.fromBytes(hashBytes)
  let (_, _, rgba) = ch.decode()
  FileHandle.standardOutput.write(Data(rgba))

case "average-color":
  let hashBytes = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let ch = ChromaHash.fromBytes(hashBytes)
  let avg = ch.averageColor()
  FileHandle.standardOutput.write(Data([avg.r, avg.g, avg.b, avg.a]))

case "batch-encode":
  // Read one image, encode it `count` times through the parallel
  // BatchEncoder. Used to benchmark bulk throughput.
  guard CommandLine.arguments.count == 6 else {
    FileHandle.standardError.write(
      Data("Usage: ChromaHashCLI batch-encode <width> <height> <gamut> <count>\n".utf8))
    exit(1)
  }
  guard let w = Int(CommandLine.arguments[2]),
    let h = Int(CommandLine.arguments[3]),
    let count = Int(CommandLine.arguments[5])
  else {
    FileHandle.standardError.write(Data("invalid width, height, or count\n".utf8))
    exit(1)
  }
  let gamut = parseGamut(CommandLine.arguments[4])

  let rgba = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let items = (0..<count).map { _ in
    ImageInput(width: w, height: h, rgba: rgba, gamut: gamut)
  }
  let hashes = BatchEncoder().encodeBatch(items)
  // Write one result-derived byte so the work cannot be optimized away.
  FileHandle.standardOutput.write(Data([hashes[0].hash[0]]))

case "batch-decode":
  // No batch decode API exists; loop the single decode `count` times.
  guard CommandLine.arguments.count == 3, let count = Int(CommandLine.arguments[2]) else {
    FileHandle.standardError.write(Data("Usage: ChromaHashCLI batch-decode <count>\n".utf8))
    exit(1)
  }
  let hashBytes = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let ch = ChromaHash.fromBytes(hashBytes)
  var acc: UInt8 = 0
  for _ in 0..<count {
    let (_, _, rgba) = ch.decode()
    acc ^= rgba[0]
  }
  FileHandle.standardOutput.write(Data([acc]))

default:
  printUsage()
}
