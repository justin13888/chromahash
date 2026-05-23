import Foundation
import Testing

@testable import ChromaHash

// MARK: - Spec Vector Loading

/// Resolve `spec/test-vectors/<name>` relative to this source file.
func specVectorPath(_ name: String, sourceFile: String = #filePath) -> URL {
  // <repo>/swift/Tests/ChromaHashTests/ChromaHashTests.swift
  // -> <repo>/spec/test-vectors/<name>
  let testFile = URL(fileURLWithPath: sourceFile)
  let repoRoot =
    testFile
    .deletingLastPathComponent()  // ChromaHashTests
    .deletingLastPathComponent()  // Tests
    .deletingLastPathComponent()  // swift
    .deletingLastPathComponent()  // <repo>
  return repoRoot.appendingPathComponent("spec/test-vectors/\(name)")
}

func loadVectors(_ name: String) -> Any? {
  let url = specVectorPath(name)
  guard let data = try? Data(contentsOf: url) else { return nil }
  return try? JSONSerialization.jsonObject(with: data, options: [])
}

func gamutFromName(_ name: String) -> Gamut {
  switch name {
  case "sRGB": return .sRGB
  case "Display P3": return .displayP3
  case "Adobe RGB": return .adobeRGB
  case "BT.2020": return .bt2020
  case "ProPhoto RGB": return .proPhotoRGB
  default: return .sRGB
  }
}

// MARK: - MathUtils Tests

@Test func roundPositiveHalf() {
  #expect(roundHalfAwayFromZero(0.5) == 1.0)
  #expect(roundHalfAwayFromZero(1.5) == 2.0)
  #expect(roundHalfAwayFromZero(2.5) == 3.0)
}

@Test func roundNegativeHalf() {
  #expect(roundHalfAwayFromZero(-0.5) == -1.0)
  #expect(roundHalfAwayFromZero(-1.5) == -2.0)
  #expect(roundHalfAwayFromZero(-2.5) == -3.0)
}

@Test func roundStandardCases() {
  #expect(roundHalfAwayFromZero(0.0) == 0.0)
  #expect(roundHalfAwayFromZero(0.3) == 0.0)
  #expect(roundHalfAwayFromZero(0.7) == 1.0)
  #expect(roundHalfAwayFromZero(-0.3) == 0.0)
  #expect(roundHalfAwayFromZero(-0.7) == -1.0)
}

@Test func cbrtPositive() {
  #expect(abs(cbrtHalley(8.0) - 2.0) < 1e-12)
  #expect(abs(cbrtHalley(27.0) - 3.0) < 1e-12)
  #expect(abs(cbrtHalley(1.0) - 1.0) < 1e-12)
}

@Test func cbrtNegative() {
  #expect(abs(cbrtHalley(-8.0) - (-2.0)) < 1e-12)
  #expect(abs(cbrtHalley(-27.0) - (-3.0)) < 1e-12)
}

@Test func cbrtZero() {
  #expect(cbrtHalley(0.0) == 0.0)
}

// MARK: - Aspect Tests

@Test func aspectSquareEncodesTo128() {
  #expect(encodeAspect(w: 1, h: 1) == 128)
}

@Test func aspectExtreme4to1() {
  #expect(encodeAspect(w: 4, h: 1) == 191)
}

@Test func aspectExtreme1to4() {
  #expect(encodeAspect(w: 1, h: 4) == 64)
}

@Test func aspectExtreme16to1() {
  #expect(encodeAspect(w: 16, h: 1) == 255)
}

@Test func aspectExtreme1to16() {
  #expect(encodeAspect(w: 1, h: 16) == 0)
}

@Test func aspectGoldenVectors() {
  let cases: [(w: Int, h: Int, byte: UInt8, outW: Int, outH: Int)] = [
    (1, 1, 128, 32, 32),
    (3, 2, 146, 32, 21),
    (4, 3, 141, 32, 24),
    (16, 9, 154, 32, 18),
    (4, 1, 191, 32, 8),
    (1, 4, 64, 8, 32),
    (16, 1, 255, 32, 2),
    (1, 16, 0, 2, 32),
    (2, 1, 159, 32, 16),
    (1, 2, 96, 16, 32),
    (100, 25, 191, 32, 8),
  ]
  for c in cases {
    let byte = encodeAspect(w: c.w, h: c.h)
    #expect(byte == c.byte, "aspect byte for \(c.w):\(c.h)")

    let decoded = decodeAspect(byte: byte)
    let actualRatio = Double(c.w) / Double(c.h)
    let err = abs(decoded - actualRatio) / actualRatio * 100.0
    #expect(err < 1.1, "decoded ratio error \(err)% ≥ 1.1% for \(c.w):\(c.h)")

    let (outW, outH) = decodeOutputSize(byte: byte)
    #expect(outW == c.outW, "output width for \(c.w):\(c.h)")
    #expect(outH == c.outH, "output height for \(c.w):\(c.h)")
  }
}

// MARK: - DCT Scan Order Tests (v0.4 priority-based)

@Test func scanOrderCounts() {
  // AC count depends only on (nx, ny); aspectByte=128 (square) for stability.
  #expect(scanOrder(nx: 3, ny: 3, aspectByte: 128).count == 5)
  #expect(scanOrder(nx: 4, ny: 4, aspectByte: 128).count == 9)
  #expect(scanOrder(nx: 6, ny: 6, aspectByte: 128).count == 20)
  #expect(scanOrder(nx: 7, ny: 7, aspectByte: 128).count == 27)
}

@Test func scanOrder4x4SquareIsRadial() {
  // aspectByte=128 → w=h=32 → priority ∝ cx²+cy².
  // (0,1) and (1,0) tied at 1; cx tiebreak → (0,1) first.
  let expected: [(Int, Int)] = [
    (0, 1), (1, 0), (1, 1), (0, 2), (2, 0), (1, 2), (2, 1), (0, 3), (3, 0),
  ]
  let order = scanOrder(nx: 4, ny: 4, aspectByte: 128)
  for (i, pair) in expected.enumerated() {
    #expect(order[i].0 == pair.0 && order[i].1 == pair.1, "4x4 scan order[\(i)]")
  }
}

@Test func scanOrder3x3SquareIsRadial() {
  let expected: [(Int, Int)] = [(0, 1), (1, 0), (1, 1), (0, 2), (2, 0)]
  let order = scanOrder(nx: 3, ny: 3, aspectByte: 128)
  for (i, pair) in expected.enumerated() {
    #expect(order[i].0 == pair.0 && order[i].1 == pair.1, "3x3 scan order[\(i)]")
  }
}

@Test func scanOrderUnitVectors() throws {
  guard let raw = loadVectors("unit-dct.json") as? [[String: Any]] else {
    Issue.record("unit-dct.json missing — skipping")
    return
  }
  for tc in raw {
    let name = tc["name"] as? String ?? "?"
    guard let input = tc["input"] as? [String: Int],
      let expected = tc["expected"] as? [String: Any],
      let nx = input["nx"], let ny = input["ny"],
      let wt = input["w"], let ht = input["h"],
      let acCount = expected["ac_count"] as? Int,
      let expectedScan = expected["scan_order"] as? [[Int]]
    else {
      Issue.record("malformed unit-dct entry: \(name)")
      continue
    }
    // Find an aspect byte producing (wt, ht).
    var aspectByte: UInt8? = nil
    for byteVal in 0...255 {
      let (bw, bh) = decodeOutputSize(byte: UInt8(byteVal))
      if bw == wt && bh == ht {
        aspectByte = UInt8(byteVal)
        break
      }
    }
    guard let aspect = aspectByte else {
      Issue.record("\(name): no aspect byte for (w=\(wt), h=\(ht))")
      continue
    }
    let order = scanOrder(nx: nx, ny: ny, aspectByte: aspect)
    #expect(order.count == acCount, "\(name): ac_count")
    for (i, pair) in order.enumerated() {
      if i >= expectedScan.count { break }
      let exp = expectedScan[i]
      #expect(
        pair.0 == exp[0] && pair.1 == exp[1],
        "\(name): scan[\(i)] = (\(pair.0),\(pair.1)), want \(exp)"
      )
    }
  }
}

// MARK: - BitPack Tests

@Test func bitpackRoundtrip() {
  var buf = [UInt8](repeating: 0, count: 4)
  writeBits(&buf, bitpos: 0, count: 8, value: 0xAB)
  #expect(readBits(buf, bitpos: 0, count: 8) == 0xAB)
}

@Test func bitpackCrossByteBoundary() {
  var buf = [UInt8](repeating: 0, count: 4)
  writeBits(&buf, bitpos: 6, count: 8, value: 0xCA)
  #expect(readBits(buf, bitpos: 6, count: 8) == 0xCA)
}

@Test func bitpackMultipleFields() {
  var buf = [UInt8](repeating: 0, count: 8)
  writeBits(&buf, bitpos: 0, count: 7, value: 100)
  writeBits(&buf, bitpos: 7, count: 7, value: 64)
  writeBits(&buf, bitpos: 14, count: 7, value: 80)
  writeBits(&buf, bitpos: 21, count: 6, value: 33)
  writeBits(&buf, bitpos: 27, count: 6, value: 20)
  writeBits(&buf, bitpos: 33, count: 5, value: 15)
  writeBits(&buf, bitpos: 38, count: 8, value: 128)

  #expect(readBits(buf, bitpos: 0, count: 7) == 100)
  #expect(readBits(buf, bitpos: 7, count: 7) == 64)
  #expect(readBits(buf, bitpos: 14, count: 7) == 80)
  #expect(readBits(buf, bitpos: 21, count: 6) == 33)
  #expect(readBits(buf, bitpos: 27, count: 6) == 20)
  #expect(readBits(buf, bitpos: 33, count: 5) == 15)
  #expect(readBits(buf, bitpos: 38, count: 8) == 128)
}

// MARK: - MuLaw Tests

@Test func mulawRoundtripExtremes() {
  for v in [-1.0, -0.5, 0.0, 0.5, 1.0] {
    let c = muCompress(v)
    let rt = muExpand(c)
    #expect(abs(rt - v) < 1e-12, "mu-law roundtrip failed at v=\(v)")
  }
}

@Test func mulawQuantize4bit() {
  let mid = muLawQuantize(0.0, bits: 4)
  #expect(mid == 8, "midpoint for 4-bit should be 8")
  #expect(muLawQuantize(-1.0, bits: 4) == 0)
  #expect(muLawQuantize(1.0, bits: 4) == 15)
}

@Test func mulawQuantize5bit() {
  let mid = muLawQuantize(0.0, bits: 5)
  #expect(mid == 16, "midpoint for 5-bit should be 16")
  #expect(muLawQuantize(-1.0, bits: 5) == 0)
  #expect(muLawQuantize(1.0, bits: 5) == 31)
}

// MARK: - Transfer Tests

@Test func srgbBoundaries() {
  #expect(srgbEOTF(0.0) == 0.0)
  #expect(abs(srgbEOTF(1.0) - 1.0) < 1e-12)
  #expect(srgbGamma(0.0) == 0.0)
  #expect(abs(srgbGamma(1.0) - 1.0) < 1e-12)
}

@Test func srgbRoundtrip() {
  for x in [0.0, 0.01, 0.04045, 0.1, 0.5, 0.9, 1.0] {
    let linear = srgbEOTF(x)
    let gamma = srgbGamma(linear)
    #expect(abs(gamma - x) < 1e-4, "sRGB roundtrip failed at x=\(x)")
  }
}

// MARK: - Color Tests

@Test func whiteToOklab() {
  let lab = linearRGBToOKLAB([1.0, 1.0, 1.0], gamut: .sRGB)
  #expect(abs(lab[0] - 1.0) < 1e-6, "white L should be near 1")
  #expect(abs(lab[1]) < 1e-6, "white a should be near 0")
  #expect(abs(lab[2]) < 1e-6, "white b should be near 0")
}

@Test func blackToOklab() {
  let lab = linearRGBToOKLAB([0.0, 0.0, 0.0], gamut: .sRGB)
  #expect(abs(lab[0]) < 1e-12, "black L should = 0")
  #expect(abs(lab[1]) < 1e-12, "black a should = 0")
  #expect(abs(lab[2]) < 1e-12, "black b should = 0")
}

@Test func oklabRoundtripSRGB() {
  let testColors: [[Double]] = [
    [1.0, 0.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 1.0],
    [0.5, 0.5, 0.5],
    [0.2, 0.7, 0.3],
  ]
  for rgb in testColors {
    let lab = linearRGBToOKLAB(rgb, gamut: .sRGB)
    let rgb2 = oklabToLinearSRGB(lab)
    for i in 0..<3 {
      #expect(abs(rgb[i] - rgb2[i]) < 1e-6, "roundtrip failed for \(rgb) at channel \(i)")
    }
  }
}

// MARK: - Integration Encode (spec vectors)

@Test func integrationEncodeVectors() {
  guard let raw = loadVectors("integration-encode.json") as? [[String: Any]] else {
    Issue.record("integration-encode.json missing — skipping")
    return
  }
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
    let rgba = rgbaNums.map { UInt8($0) }
    let expectedHash = hashNums.map { UInt8($0) }
    let hash = ChromaHash.encode(
      width: width, height: height, rgba: rgba, gamut: gamutFromName(gamutName)
    )
    #expect(hash.hash == expectedHash, "\(name): encoded hash mismatch")
    if let avg = expected["average_color"] as? [Int], avg.count == 4 {
      let got = hash.averageColor()
      #expect(Int(got.r) == avg[0], "\(name): avg.r")
      #expect(Int(got.g) == avg[1], "\(name): avg.g")
      #expect(Int(got.b) == avg[2], "\(name): avg.b")
      #expect(Int(got.a) == avg[3], "\(name): avg.a")
    }
  }
}

// MARK: - Integration Decode (spec vectors)

@Test func integrationDecodeVectors() {
  guard let raw = loadVectors("integration-decode.json") as? [[String: Any]] else {
    Issue.record("integration-decode.json missing — skipping")
    return
  }
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
    let hash = ChromaHash.fromBytes(hashNums.map { UInt8($0) })
    let (w, h, rgba) = hash.decode()
    #expect(w == expectedW, "\(name): width")
    #expect(h == expectedH, "\(name): height")
    #expect(rgba.count == expectedRGBA.count, "\(name): rgba length")
    for (i, byte) in rgba.enumerated() {
      if i >= expectedRGBA.count { break }
      #expect(Int(byte) == expectedRGBA[i], "\(name): rgba[\(i)]")
    }
  }
}

// MARK: - Encode + Decode Roundtrip

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
  let hash2 = ChromaHash.fromBytes(hash.hash)
  #expect(hash == hash2)
}

@Test func deterministicEncoding() {
  let rgba: [UInt8] = Array(repeating: [200, 100, 50, 255], count: 16).flatMap { $0 }
  let hash1 = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let hash2 = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  #expect(hash1.hash == hash2.hash, "encoding should be deterministic")
}

// MARK: - Sendable Conformance

@Test func chromaHashIsSendable() {
  let hash = ChromaHash.fromBytes([UInt8](repeating: 0, count: 32))
  let _: any Sendable = hash
  let _: any Sendable = Gamut.sRGB
}
