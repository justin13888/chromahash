import Foundation
import Testing

import ChromaHash

// The Swift package is now a thin facade over UniFFI-generated bindings to the Rust
// core, so these tests exercise the public API end-to-end against the shared spec
// vectors — the cross-language parity gate. Per-function unit tests of the algorithm
// live in the Rust core (the single source of truth).

// MARK: - Spec Vector Loading

/// Resolve `spec/test-vectors/<name>` relative to this source file.
func specVectorPath(_ name: String, sourceFile: String = #filePath) -> URL {
  // <repo>/swift/Tests/ChromaHashTests/ChromaHashTests.swift -> <repo>/spec/test-vectors/<name>
  let testFile = URL(fileURLWithPath: sourceFile)
  let repoRoot =
    testFile
    .deletingLastPathComponent()  // ChromaHashTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // swift
    .deletingLastPathComponent()  // <repo>
  return repoRoot.appendingPathComponent("spec/test-vectors/\(name)")
}

func loadVectors(_ name: String) -> [[String: Any]] {
  let url = specVectorPath(name)
  guard let data = try? Data(contentsOf: url),
    let json = try? JSONSerialization.jsonObject(with: data, options: []) as? [[String: Any]]
  else {
    Issue.record("could not load spec vectors: \(name)")
    return []
  }
  return json
}

func gamutFromName(_ name: String) -> Gamut {
  switch name {
  case "Display P3": return .displayP3
  case "Adobe RGB": return .adobeRGB
  case "BT.2020": return .bt2020
  case "ProPhoto RGB": return .proPhotoRGB
  default: return .sRGB
  }
}

// MARK: - Integration: encode (spec vectors)

@Test func integrationEncodeVectors() {
  let raw = loadVectors("integration-encode.json")
  #expect(!raw.isEmpty)
  for tc in raw {
    let name = tc["name"] as? String ?? "?"
    guard let input = tc["input"] as? [String: Any],
      let width = input["width"] as? Int,
      let height = input["height"] as? Int,
      let gamutName = input["gamut"] as? String,
      let rgbaNums = input["rgba"] as? [Int],
      let expected = tc["expected"] as? [String: Any],
      let hashNums = expected["hash"] as? [Int]
    else {
      Issue.record("malformed integration-encode entry: \(name)")
      continue
    }
    let hash = ChromaHash.encode(
      width: width, height: height, rgba: rgbaNums.map { UInt8($0) }, gamut: gamutFromName(gamutName)
    )
    #expect(hash.hash == hashNums.map { UInt8($0) }, "\(name): encoded hash mismatch")
    if let avg = expected["average_color"] as? [Int], avg.count == 4 {
      let got = hash.averageColor()
      #expect([Int(got.r), Int(got.g), Int(got.b), Int(got.a)] == avg, "\(name): average_color")
    }
    #expect(hash.isVersionSupported(), "\(name): fresh hash must report v0.6 supported")
  }
}

// MARK: - Integration: decode (spec vectors)

@Test func integrationDecodeVectors() {
  let raw = loadVectors("integration-decode.json")
  #expect(!raw.isEmpty)
  for tc in raw {
    let name = tc["name"] as? String ?? "?"
    guard let input = tc["input"] as? [String: Any],
      let hashNums = input["hash"] as? [Int],
      let expected = tc["expected"] as? [String: Any],
      let expectedW = expected["width"] as? Int,
      let expectedH = expected["height"] as? Int,
      let expectedRGBA = expected["rgba"] as? [Int]
    else {
      Issue.record("malformed integration-decode entry: \(name)")
      continue
    }
    let (w, h, rgba) = ChromaHash.fromBytes(hashNums.map { UInt8($0) }).decode()
    #expect(w == expectedW, "\(name): width")
    #expect(h == expectedH, "\(name): height")
    #expect(rgba.map { Int($0) } == expectedRGBA, "\(name): rgba")
  }
}

// MARK: - Integration: capped decode (spec vectors)

@Test func integrationDecodeCappedVectors() {
  let raw = loadVectors("integration-decode-capped.json")
  #expect(!raw.isEmpty)
  for tc in raw {
    let name = tc["name"] as? String ?? "?"
    guard let input = tc["input"] as? [String: Any],
      let hashNums = input["hash"] as? [Int],
      let maxW = input["max_width"] as? Int,
      let maxH = input["max_height"] as? Int,
      let expected = tc["expected"] as? [String: Any],
      let expectedW = expected["width"] as? Int,
      let expectedH = expected["height"] as? Int,
      let expectedRGBA = expected["rgba"] as? [Int]
    else {
      Issue.record("malformed integration-decode-capped entry: \(name)")
      continue
    }
    let (w, h, rgba) = ChromaHash.fromBytes(hashNums.map { UInt8($0) })
      .decodeCapped(maxWidth: maxW, maxHeight: maxH)
    #expect(w == expectedW, "\(name): width")
    #expect(h == expectedH, "\(name): height")
    #expect(rgba.map { Int($0) } == expectedRGBA, "\(name): rgba")
  }
}

// MARK: - Public-API properties

@Test func encodeDecodeRoundtripDimensions() {
  let rgba: [UInt8] = Array(repeating: [128, 64, 32, 255], count: 16).flatMap { $0 }
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let (w, h, pixels) = hash.decode()
  #expect(w > 0 && w <= 32)
  #expect(h > 0 && h <= 32)
  #expect(pixels.count == w * h * 4)
}

@Test func fromBytesRoundtrip() {
  let rgba: [UInt8] = Array(repeating: [128, 64, 32, 255], count: 16).flatMap { $0 }
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  #expect(ChromaHash.fromBytes(hash.hash) == hash)
}

@Test func deterministicEncoding() {
  let rgba: [UInt8] = Array(repeating: [200, 100, 50, 255], count: 64).flatMap { $0 }
  let a = ChromaHash.encode(width: 8, height: 8, rgba: rgba, gamut: .sRGB)
  let b = ChromaHash.encode(width: 8, height: 8, rgba: rgba, gamut: .sRGB)
  #expect(a.hash == b.hash)
}

@Test func allGamutsProduceOutput() {
  let rgba: [UInt8] = Array(repeating: [200, 100, 50, 255], count: 16).flatMap { $0 }
  for gamut in [Gamut.sRGB, .displayP3, .adobeRGB, .bt2020, .proPhotoRGB] {
    #expect(ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: gamut).hash.count == 32)
  }
}

@Test func versionSupportedDetectsLegacy() {
  let rgba: [UInt8] = Array(repeating: [128, 128, 128, 255], count: 16).flatMap { $0 }
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  #expect(hash.isVersionSupported())
  var legacy = hash.hash
  legacy[5] |= 0x80  // flip header bit 47 to simulate a legacy v0.2–v0.5 hash
  #expect(!ChromaHash.fromBytes(legacy).isVersionSupported())
}
