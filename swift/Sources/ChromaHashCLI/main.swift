import ChromaHash
import Foundation

guard CommandLine.arguments.count == 4 else {
  FileHandle.standardError.write(Data("Usage: ChromaHashCLI <width> <height> <gamut>\n".utf8))
  exit(1)
}

guard let w = Int(CommandLine.arguments[1]),
  let h = Int(CommandLine.arguments[2])
else {
  FileHandle.standardError.write(Data("invalid width or height\n".utf8))
  exit(1)
}

let gamut: Gamut
switch CommandLine.arguments[3] {
case "srgb": gamut = .sRGB
case "displayp3": gamut = .displayP3
case "adobergb": gamut = .adobeRGB
case "bt2020": gamut = .bt2020
case "prophoto": gamut = .proPhotoRGB
default:
  FileHandle.standardError.write(Data("unknown gamut: \(CommandLine.arguments[3])\n".utf8))
  exit(1)
}

let expectedLen = w * h * 4
let stdinData = FileHandle.standardInput.readDataToEndOfFile()
let rgba = [UInt8](stdinData)

guard rgba.count == expectedLen else {
  FileHandle.standardError.write(Data("expected \(expectedLen) bytes, got \(rgba.count)\n".utf8))
  exit(1)
}

let hash = ChromaHash.encode(width: w, height: h, rgba: rgba, gamut: gamut)
FileHandle.standardOutput.write(Data(hash.hash))
