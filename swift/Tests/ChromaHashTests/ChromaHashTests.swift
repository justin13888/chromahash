import Testing

@testable import ChromaHash

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
  #expect(abs(cbrtSigned(8.0) - 2.0) < 1e-12)
  #expect(abs(cbrtSigned(27.0) - 3.0) < 1e-12)
  #expect(abs(cbrtSigned(1.0) - 1.0) < 1e-12)
}

@Test func cbrtNegative() {
  #expect(abs(cbrtSigned(-8.0) - (-2.0)) < 1e-12)
  #expect(abs(cbrtSigned(-27.0) - (-3.0)) < 1e-12)
}

@Test func cbrtZero() {
  #expect(cbrtSigned(0.0) == 0.0)
}

// MARK: - Aspect Tests

@Test func aspectSquareEncodesTo128() {
  #expect(encodeAspect(w: 1, h: 1) == 128)
}

@Test func aspectExtreme4to1() {
  #expect(encodeAspect(w: 4, h: 1) == 255)
}

@Test func aspectExtreme1to4() {
  #expect(encodeAspect(w: 1, h: 4) == 0)
}

@Test func aspectGoldenVectors() {
  // From unit-aspect.json
  let cases: [(w: Int, h: Int, byte: UInt8, decodedRatio: Double, outW: Int, outH: Int)] = [
    (1, 1, 128, 1.0054512527764397, 32, 32),
    (3, 2, 165, 1.503406653856055, 32, 21),
    (4, 3, 154, 1.333933063801182, 32, 24),
    (16, 9, 180, 1.7697301721873238, 32, 18),
    (4, 1, 255, 4.0, 32, 8),
    (1, 4, 0, 0.25, 8, 32),
    (2, 1, 191, 1.9945709335778188, 32, 16),
    (1, 2, 64, 0.5013609609793227, 16, 32),
    (100, 25, 255, 4.0, 32, 8),
  ]
  for c in cases {
    let byte = encodeAspect(w: c.w, h: c.h)
    #expect(byte == c.byte, "aspect byte for \(c.w):\(c.h)")

    let decoded = decodeAspect(byte: byte)
    #expect(abs(decoded - c.decodedRatio) < 1e-10, "decoded ratio for \(c.w):\(c.h)")

    let (outW, outH) = decodeOutputSize(byte: byte)
    #expect(outW == c.outW, "output width for \(c.w):\(c.h)")
    #expect(outH == c.outH, "output height for \(c.w):\(c.h)")
  }
}

// MARK: - DCT Scan Order Tests

@Test func scanOrderCounts() {
  #expect(triangularScanOrder(nx: 3, ny: 3).count == 5)
  #expect(triangularScanOrder(nx: 4, ny: 4).count == 9)
  #expect(triangularScanOrder(nx: 6, ny: 6).count == 20)
  #expect(triangularScanOrder(nx: 7, ny: 7).count == 27)
}

@Test func scanOrderGoldenVectors() {
  // From unit-dct.json
  let expected3x3: [(Int, Int)] = [(1, 0), (2, 0), (0, 1), (1, 1), (0, 2)]
  let order3x3 = triangularScanOrder(nx: 3, ny: 3)
  for (i, pair) in expected3x3.enumerated() {
    #expect(order3x3[i].0 == pair.0 && order3x3[i].1 == pair.1, "3x3 scan order[\(i)]")
  }

  let expected4x4: [(Int, Int)] = [
    (1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (2, 1), (0, 2), (1, 2), (0, 3),
  ]
  let order4x4 = triangularScanOrder(nx: 4, ny: 4)
  for (i, pair) in expected4x4.enumerated() {
    #expect(order4x4[i].0 == pair.0 && order4x4[i].1 == pair.1, "4x4 scan order[\(i)]")
  }

  let expected6x6: [(Int, Int)] = [
    (1, 0), (2, 0), (3, 0), (4, 0), (5, 0), (0, 1), (1, 1), (2, 1), (3, 1), (4, 1),
    (0, 2), (1, 2), (2, 2), (3, 2), (0, 3), (1, 3), (2, 3), (0, 4), (1, 4), (0, 5),
  ]
  let order6x6 = triangularScanOrder(nx: 6, ny: 6)
  for (i, pair) in expected6x6.enumerated() {
    #expect(order6x6[i].0 == pair.0 && order6x6[i].1 == pair.1, "6x6 scan order[\(i)]")
  }

  let expected7x7: [(Int, Int)] = [
    (1, 0), (2, 0), (3, 0), (4, 0), (5, 0), (6, 0), (0, 1), (1, 1), (2, 1), (3, 1),
    (4, 1), (5, 1), (0, 2), (1, 2), (2, 2), (3, 2), (4, 2), (0, 3), (1, 3), (2, 3),
    (3, 3), (0, 4), (1, 4), (2, 4), (0, 5), (1, 5), (0, 6),
  ]
  let order7x7 = triangularScanOrder(nx: 7, ny: 7)
  for (i, pair) in expected7x7.enumerated() {
    #expect(order7x7[i].0 == pair.0 && order7x7[i].1 == pair.1, "7x7 scan order[\(i)]")
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

// MARK: - Integration Encode Tests (golden vectors)

func solidImage(w: Int, h: Int, r: UInt8, g: UInt8, b: UInt8, a: UInt8) -> [UInt8] {
  let pixelCount = w * h
  var rgba = [UInt8](repeating: 0, count: pixelCount * 4)
  for i in 0..<pixelCount {
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = a
  }
  return rgba
}

@Test func encodeSolidGray4x4() {
  let rgba = solidImage(w: 4, h: 4, r: 128, g: 128, b: 128, a: 255)
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    76, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ]
  #expect(hash.hash == expected, "solid gray hash mismatch")
}

@Test func encodeSolidRed4x4() {
  let rgba = solidImage(w: 4, h: 4, r: 255, g: 0, b: 0, a: 255)
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    80, 46, 20, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ]
  #expect(hash.hash == expected, "solid red hash mismatch")
}

@Test func encodeSolidGreen4x4() {
  let rgba = solidImage(w: 4, h: 4, r: 0, g: 255, b: 0, a: 255)
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    238, 209, 21, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ]
  #expect(hash.hash == expected, "solid green hash mismatch")
}

@Test func encodeSolidBlue4x4() {
  let rgba = solidImage(w: 4, h: 4, r: 0, g: 0, b: 255, a: 255)
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    57, 94, 6, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ]
  #expect(hash.hash == expected, "solid blue hash mismatch")
}

@Test func encodeSolidWhite4x4() {
  let rgba = solidImage(w: 4, h: 4, r: 255, g: 255, b: 255, a: 255)
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    127, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ]
  #expect(hash.hash == expected, "solid white hash mismatch")
}

@Test func encodeSolidBlack4x4() {
  let rgba = solidImage(w: 4, h: 4, r: 0, g: 0, b: 0, a: 255)
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    0, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ]
  #expect(hash.hash == expected, "solid black hash mismatch")
}

@Test func encodeSolid1x1() {
  let rgba: [UInt8] = [200, 100, 50, 255]
  let hash = ChromaHash.encode(width: 1, height: 1, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    206, 102, 243, 111, 12, 32, 16, 192, 15, 1, 132, 15, 66, 8, 222, 127,
    0, 194, 7, 63, 4, 16, 2, 4, 68, 60, 56, 68, 64, 196, 131, 67,
  ]
  #expect(hash.hash == expected, "solid 1x1 hash mismatch")
}

@Test func encodeSolidP3_4x4() {
  let rgba = solidImage(w: 4, h: 4, r: 200, g: 100, b: 50, a: 255)
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .displayP3)
  let expected: [UInt8] = [
    79, 232, 19, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ]
  #expect(hash.hash == expected, "solid P3 hash mismatch")
}

@Test func encodeGradient16x16() {
  let rgba: [UInt8] = [
    0, 0, 255, 255, 17, 0, 255, 255, 34, 0, 255, 255, 51, 0, 255, 255,
    68, 0, 255, 255, 85, 0, 255, 255, 102, 0, 255, 255, 119, 0, 255, 255,
    136, 0, 255, 255, 153, 0, 255, 255, 170, 0, 255, 255, 187, 0, 255, 255,
    204, 0, 255, 255, 221, 0, 255, 255, 238, 0, 255, 255, 255, 0, 255, 255,
    0, 17, 238, 255, 17, 15, 238, 255, 34, 14, 238, 255, 51, 13, 238, 255,
    68, 12, 238, 255, 85, 11, 238, 255, 102, 10, 238, 255, 119, 9, 238, 255,
    136, 7, 238, 255, 153, 6, 238, 255, 170, 5, 238, 255, 187, 4, 238, 255,
    204, 3, 238, 255, 221, 2, 238, 255, 238, 1, 238, 255, 255, 0, 238, 255,
    0, 34, 221, 255, 17, 31, 221, 255, 34, 29, 221, 255, 51, 27, 221, 255,
    68, 24, 221, 255, 85, 22, 221, 255, 102, 20, 221, 255, 119, 18, 221, 255,
    136, 15, 221, 255, 153, 13, 221, 255, 170, 11, 221, 255, 187, 9, 221, 255,
    204, 6, 221, 255, 221, 4, 221, 255, 238, 2, 221, 255, 255, 0, 221, 255,
    0, 51, 204, 255, 17, 47, 204, 255, 34, 44, 204, 255, 51, 40, 204, 255,
    68, 37, 204, 255, 85, 34, 204, 255, 102, 30, 204, 255, 119, 27, 204, 255,
    136, 23, 204, 255, 153, 20, 204, 255, 170, 17, 204, 255, 187, 13, 204, 255,
    204, 10, 204, 255, 221, 6, 204, 255, 238, 3, 204, 255, 255, 0, 204, 255,
    0, 68, 187, 255, 17, 63, 187, 255, 34, 58, 187, 255, 51, 54, 187, 255,
    68, 49, 187, 255, 85, 45, 187, 255, 102, 40, 187, 255, 119, 36, 187, 255,
    136, 31, 187, 255, 153, 27, 187, 255, 170, 22, 187, 255, 187, 18, 187, 255,
    204, 13, 187, 255, 221, 9, 187, 255, 238, 4, 187, 255, 255, 0, 187, 255,
    0, 85, 170, 255, 17, 79, 170, 255, 34, 73, 170, 255, 51, 68, 170, 255,
    68, 62, 170, 255, 85, 56, 170, 255, 102, 50, 170, 255, 119, 45, 170, 255,
    136, 39, 170, 255, 153, 34, 170, 255, 170, 28, 170, 255, 187, 22, 170, 255,
    204, 16, 170, 255, 221, 11, 170, 255, 238, 5, 170, 255, 255, 0, 170, 255,
    0, 102, 153, 255, 17, 95, 153, 255, 34, 88, 153, 255, 51, 81, 153, 255,
    68, 74, 153, 255, 85, 68, 153, 255, 102, 61, 153, 255, 119, 54, 153, 255,
    136, 47, 153, 255, 153, 40, 153, 255, 170, 34, 153, 255, 187, 27, 153, 255,
    204, 20, 153, 255, 221, 13, 153, 255, 238, 6, 153, 255, 255, 0, 153, 255,
    0, 119, 136, 255, 17, 111, 136, 255, 34, 103, 136, 255, 51, 95, 136, 255,
    68, 87, 136, 255, 85, 79, 136, 255, 102, 71, 136, 255, 119, 63, 136, 255,
    136, 55, 136, 255, 153, 47, 136, 255, 170, 39, 136, 255, 187, 31, 136, 255,
    204, 23, 136, 255, 221, 15, 136, 255, 238, 7, 136, 255, 255, 0, 136, 255,
    0, 136, 119, 255, 17, 126, 119, 255, 34, 117, 119, 255, 51, 108, 119, 255,
    68, 99, 119, 255, 85, 90, 119, 255, 102, 81, 119, 255, 119, 72, 119, 255,
    136, 63, 119, 255, 153, 54, 119, 255, 170, 45, 119, 255, 187, 36, 119, 255,
    204, 27, 119, 255, 221, 18, 119, 255, 238, 9, 119, 255, 255, 0, 119, 255,
    0, 153, 102, 255, 17, 142, 102, 255, 34, 132, 102, 255, 51, 122, 102, 255,
    68, 112, 102, 255, 85, 102, 102, 255, 102, 91, 102, 255, 119, 81, 102, 255,
    136, 71, 102, 255, 153, 61, 102, 255, 170, 51, 102, 255, 187, 40, 102, 255,
    204, 30, 102, 255, 221, 20, 102, 255, 238, 10, 102, 255, 255, 0, 102, 255,
    0, 170, 85, 255, 17, 158, 85, 255, 34, 147, 85, 255, 51, 136, 85, 255,
    68, 124, 85, 255, 85, 113, 85, 255, 102, 101, 85, 255, 119, 90, 85, 255,
    136, 79, 85, 255, 153, 68, 85, 255, 170, 56, 85, 255, 187, 45, 85, 255,
    204, 33, 85, 255, 221, 22, 85, 255, 238, 11, 85, 255, 255, 0, 85, 255,
    0, 187, 68, 255, 17, 174, 68, 255, 34, 162, 68, 255, 51, 149, 68, 255,
    68, 137, 68, 255, 85, 124, 68, 255, 102, 112, 68, 255, 119, 99, 68, 255,
    136, 87, 68, 255, 153, 74, 68, 255, 170, 62, 68, 255, 187, 49, 68, 255,
    204, 37, 68, 255, 221, 24, 68, 255, 238, 12, 68, 255, 255, 0, 68, 255,
    0, 204, 50, 255, 17, 190, 50, 255, 34, 176, 50, 255, 51, 163, 50, 255,
    68, 149, 50, 255, 85, 136, 50, 255, 102, 122, 50, 255, 119, 108, 50, 255,
    136, 95, 50, 255, 153, 81, 50, 255, 170, 68, 50, 255, 187, 54, 50, 255,
    204, 40, 50, 255, 221, 27, 50, 255, 238, 13, 50, 255, 255, 0, 50, 255,
    0, 221, 33, 255, 17, 206, 33, 255, 34, 191, 33, 255, 51, 176, 33, 255,
    68, 162, 33, 255, 85, 147, 33, 255, 102, 132, 33, 255, 119, 117, 33, 255,
    136, 103, 33, 255, 153, 88, 33, 255, 170, 73, 33, 255, 187, 58, 33, 255,
    204, 44, 33, 255, 221, 29, 33, 255, 238, 14, 33, 255, 255, 0, 33, 255,
    0, 238, 16, 255, 17, 222, 16, 255, 34, 206, 16, 255, 51, 190, 16, 255,
    68, 174, 16, 255, 85, 158, 16, 255, 102, 142, 16, 255, 119, 126, 16, 255,
    136, 111, 16, 255, 153, 95, 16, 255, 170, 79, 16, 255, 187, 63, 16, 255,
    204, 47, 16, 255, 221, 31, 16, 255, 238, 15, 16, 255, 255, 0, 16, 255,
    0, 255, 0, 255, 17, 238, 0, 255, 34, 221, 0, 255, 51, 204, 0, 255,
    68, 187, 0, 255, 85, 170, 0, 255, 102, 153, 0, 255, 119, 136, 0, 255,
    136, 119, 0, 255, 153, 102, 0, 255, 170, 85, 0, 255, 187, 68, 0, 255,
    204, 50, 0, 255, 221, 33, 0, 255, 238, 16, 0, 255, 255, 0, 0, 255,
  ]
  let hash = ChromaHash.encode(width: 16, height: 16, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    198, 164, 110, 88, 12, 32, 228, 183, 250, 100, 0, 200, 185, 199, 237, 123,
    15, 58, 248, 168, 132, 239, 73, 184, 227, 60, 187, 179, 60, 168, 187, 59,
  ]
  #expect(hash.hash == expected, "gradient 16x16 hash mismatch")
}

@Test func encodeGradient8x4() {
  let rgba: [UInt8] = [
    0, 0, 255, 255, 36, 0, 255, 255, 72, 0, 255, 255, 109, 0, 255, 255,
    145, 0, 255, 255, 182, 0, 255, 255, 218, 0, 255, 255, 255, 0, 255, 255,
    0, 85, 170, 255, 36, 72, 170, 255, 72, 60, 170, 255, 109, 48, 170, 255,
    145, 36, 170, 255, 182, 24, 170, 255, 218, 12, 170, 255, 255, 0, 170, 255,
    0, 170, 85, 255, 36, 145, 85, 255, 72, 121, 85, 255, 109, 97, 85, 255,
    145, 72, 85, 255, 182, 48, 85, 255, 218, 24, 85, 255, 255, 0, 85, 255,
    0, 255, 0, 255, 36, 218, 0, 255, 72, 182, 0, 255, 109, 145, 0, 255,
    145, 109, 0, 255, 182, 72, 0, 255, 218, 36, 0, 255, 255, 0, 0, 255,
  ]
  let hash = ChromaHash.encode(width: 8, height: 4, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    72, 164, 142, 96, 206, 47, 199, 187, 250, 100, 0, 200, 185, 215, 239, 123,
    48, 66, 248, 224, 131, 238, 9, 64, 100, 189, 186, 179, 60, 168, 51, 68,
  ]
  #expect(hash.hash == expected, "gradient 8x4 hash mismatch")
}

@Test func encodeGradient4x8() {
  let rgba: [UInt8] = [
    0, 0, 255, 255, 85, 0, 255, 255, 170, 0, 255, 255, 255, 0, 255, 255,
    0, 36, 218, 255, 85, 24, 218, 255, 170, 12, 218, 255, 255, 0, 218, 255,
    0, 72, 182, 255, 85, 48, 182, 255, 170, 24, 182, 255, 255, 0, 182, 255,
    0, 109, 145, 255, 85, 72, 145, 255, 170, 36, 145, 255, 255, 0, 145, 255,
    0, 145, 109, 255, 85, 97, 109, 255, 170, 48, 109, 255, 255, 0, 109, 255,
    0, 182, 72, 255, 85, 121, 72, 255, 170, 60, 72, 255, 255, 0, 72, 255,
    0, 218, 36, 255, 85, 145, 36, 255, 170, 72, 36, 255, 255, 0, 36, 255,
    0, 255, 0, 255, 85, 170, 0, 255, 170, 85, 0, 255, 255, 0, 0, 255,
  ]
  let hash = ChromaHash.encode(width: 4, height: 8, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    201, 228, 142, 104, 12, 16, 229, 59, 24, 65, 0, 8, 190, 183, 237, 115,
    16, 62, 8, 169, 132, 239, 69, 64, 228, 60, 187, 43, 61, 168, 179, 59,
  ]
  #expect(hash.hash == expected, "gradient 4x8 hash mismatch")
}

@Test func encodeCheckerboardAlpha8x8() {
  let rgba: [UInt8] = [
    255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
    255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
    0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
    0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
    255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
    255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
    0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
    0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
    255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
    255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
    0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
    0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
    255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
    255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
    0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
    0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
  ]
  let hash = ChromaHash.encode(width: 8, height: 8, rgba: rgba, gamut: .sRGB)
  let expected: [UInt8] = [
    80, 46, 20, 0, 0, 96, 16, 64, 16, 4, 65, 16, 132, 16, 66, 8,
    33, 132, 16, 66, 136, 136, 136, 136, 136, 136, 136, 136, 136, 136, 135, 127,
  ]
  #expect(hash.hash == expected, "checkerboard alpha hash mismatch")
}

// MARK: - Average Color Tests

@Test func averageColorSolidGray() {
  let hash = ChromaHash.fromBytes([
    76, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ])
  let avg = hash.averageColor()
  #expect(avg.r == 128)
  #expect(avg.g == 128)
  #expect(avg.b == 128)
  #expect(avg.a == 255)
}

@Test func averageColorSolidRed() {
  let hash = ChromaHash.fromBytes([
    80, 46, 20, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ])
  let avg = hash.averageColor()
  #expect(avg.r == 255)
  #expect(avg.g == 11)
  #expect(avg.b == 0)
  #expect(avg.a == 255)
}

@Test func averageColorSolidBlack() {
  let hash = ChromaHash.fromBytes([
    0, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ])
  let avg = hash.averageColor()
  #expect(avg.r == 0)
  #expect(avg.g == 0)
  #expect(avg.b == 0)
  #expect(avg.a == 255)
}

@Test func averageColorSolidWhite() {
  let hash = ChromaHash.fromBytes([
    127, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ])
  let avg = hash.averageColor()
  #expect(avg.r == 255)
  #expect(avg.g == 255)
  #expect(avg.b == 255)
  #expect(avg.a == 255)
}

@Test func averageColorCheckerboardAlpha() {
  let hash = ChromaHash.fromBytes([
    80, 46, 20, 0, 0, 96, 16, 64, 16, 4, 65, 16, 132, 16, 66, 8,
    33, 132, 16, 66, 136, 136, 136, 136, 136, 136, 136, 136, 136, 136, 135, 127,
  ])
  let avg = hash.averageColor()
  #expect(avg.r == 255)
  #expect(avg.g == 11)
  #expect(avg.b == 0)
  #expect(avg.a == 132)
}

// MARK: - Decode Tests

@Test func decodeSolidGrayProducesSolidPixels() {
  let hash = ChromaHash.fromBytes([
    76, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ])
  let (w, h, rgba) = hash.decode()
  #expect(w == 32)
  #expect(h == 32)
  #expect(rgba.count == 32 * 32 * 4)
  // All pixels should be [128, 128, 128, 255]
  for i in 0..<(w * h) {
    #expect(abs(Int(rgba[i * 4]) - 128) <= 1, "pixel \(i) R")
    #expect(abs(Int(rgba[i * 4 + 1]) - 128) <= 1, "pixel \(i) G")
    #expect(abs(Int(rgba[i * 4 + 2]) - 128) <= 1, "pixel \(i) B")
    #expect(rgba[i * 4 + 3] == 255, "pixel \(i) A")
  }
}

@Test func decodeSolidRedProducesUniformPixels() {
  let hash = ChromaHash.fromBytes([
    80, 46, 20, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
    16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
  ])
  let (w, h, rgba) = hash.decode()
  #expect(w == 32)
  #expect(h == 32)
  // All pixels should be [255, 11, 0, 255]
  for i in 0..<(w * h) {
    #expect(abs(Int(rgba[i * 4]) - 255) <= 1, "pixel \(i) R")
    #expect(abs(Int(rgba[i * 4 + 1]) - 11) <= 1, "pixel \(i) G")
    #expect(abs(Int(rgba[i * 4 + 2]) - 0) <= 1, "pixel \(i) B")
    #expect(rgba[i * 4 + 3] == 255, "pixel \(i) A")
  }
}

@Test func decodeCheckerboardAlpha() {
  let hash = ChromaHash.fromBytes([
    80, 46, 20, 0, 0, 96, 16, 64, 16, 4, 65, 16, 132, 16, 66, 8,
    33, 132, 16, 66, 136, 136, 136, 136, 136, 136, 136, 136, 136, 136, 135, 127,
  ])
  let (w, h, rgba) = hash.decode()
  #expect(w == 32)
  #expect(h == 32)
  #expect(rgba.count == 32 * 32 * 4)
  // All pixels should be [255, 11, 0, 132]
  for i in 0..<(w * h) {
    #expect(abs(Int(rgba[i * 4]) - 255) <= 1, "pixel \(i) R")
    #expect(abs(Int(rgba[i * 4 + 1]) - 11) <= 1, "pixel \(i) G")
    #expect(abs(Int(rgba[i * 4 + 2]) - 0) <= 1, "pixel \(i) B")
    #expect(abs(Int(rgba[i * 4 + 3]) - 132) <= 1, "pixel \(i) A")
  }
}

// MARK: - Encode + Decode Roundtrip

@Test func encodeDecodeRoundtripDimensions() {
  let rgba = solidImage(w: 4, h: 4, r: 128, g: 64, b: 32, a: 255)
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let (w, h, pixels) = hash.decode()
  #expect(w > 0 && w <= 32)
  #expect(h > 0 && h <= 32)
  #expect(pixels.count == w * h * 4)
}

@Test func fromBytesRoundtrip() {
  let rgba = solidImage(w: 4, h: 4, r: 128, g: 64, b: 32, a: 255)
  let hash = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let hash2 = ChromaHash.fromBytes(hash.hash)
  #expect(hash == hash2)
}

@Test func deterministicEncoding() {
  let rgba = solidImage(w: 4, h: 4, r: 200, g: 100, b: 50, a: 255)
  let hash1 = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  let hash2 = ChromaHash.encode(width: 4, height: 4, rgba: rgba, gamut: .sRGB)
  #expect(hash1.hash == hash2.hash, "encoding should be deterministic")
}

// MARK: - Sendable Conformance

@Test func chromaHashIsSendable() {
  let hash = ChromaHash.fromBytes([UInt8](repeating: 0, count: 32))
  // This compiles only if ChromaHash is Sendable
  let _: any Sendable = hash
  let _: any Sendable = Gamut.sRGB
}
