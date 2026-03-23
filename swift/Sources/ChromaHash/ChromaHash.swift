import Foundation

/// ChromaHash: a 32-byte LQIP (Low Quality Image Placeholder).
public struct ChromaHash: Sendable, Equatable {
  /// The raw 32-byte hash data.
  public let hash: [UInt8]

  /// Encode an image into a ChromaHash.
  ///
  /// - Parameters:
  ///   - width: image width (1-100)
  ///   - height: image height (1-100)
  ///   - rgba: pixel data in RGBA format (4 bytes per pixel)
  ///   - gamut: source color space
  public static func encode(width: Int, height: Int, rgba: [UInt8], gamut: Gamut) -> ChromaHash {
    return ChromaHash(hash: encodeHash(w: width, h: height, rgba: rgba, gamut: gamut))
  }

  /// Decode a ChromaHash into an RGBA image.
  /// Returns (width, height, rgba_pixels).
  public func decode() -> (width: Int, height: Int, rgba: [UInt8]) {
    return decodeHash(hash: hash)
  }

  /// Extract the average color without full decode.
  /// Returns (r, g, b, a) as UInt8 values.
  public func averageColor() -> (r: UInt8, g: UInt8, b: UInt8, a: UInt8) {
    return averageColorFromHash(hash: hash)
  }

  /// Create a ChromaHash from raw 32-byte data.
  public static func fromBytes(_ bytes: [UInt8]) -> ChromaHash {
    precondition(bytes.count == 32, "ChromaHash must be exactly 32 bytes")
    return ChromaHash(hash: bytes)
  }
}

// MARK: - Encode

/// Encode an image into a 32-byte ChromaHash. Per spec.
func encodeHash(w: Int, h: Int, rgba: [UInt8], gamut: Gamut) -> [UInt8] {
  precondition(w >= 1 && w <= 100, "width must be 1-100")
  precondition(h >= 1 && h <= 100, "height must be 1-100")
  precondition(rgba.count == w * h * 4, "rgba length mismatch")

  let pixelCount = w * h

  // 1-2. Convert all pixels to OKLAB, accumulate alpha-weighted average
  var oklabPixels = [[Double]](repeating: [0.0, 0.0, 0.0], count: pixelCount)
  var alphaPixels = [Double](repeating: 0.0, count: pixelCount)
  var avgL = 0.0
  var avgA = 0.0
  var avgB = 0.0
  var avgAlpha = 0.0

  for i in 0..<pixelCount {
    let r = Double(rgba[i * 4]) / 255.0
    let g = Double(rgba[i * 4 + 1]) / 255.0
    let b = Double(rgba[i * 4 + 2]) / 255.0
    let a = Double(rgba[i * 4 + 3]) / 255.0

    let lab = gammaRGBToOKLAB(r: r, g: g, b: b, gamut: gamut)

    avgL += a * lab[0]
    avgA += a * lab[1]
    avgB += a * lab[2]
    avgAlpha += a

    oklabPixels[i] = lab
    alphaPixels[i] = a
  }

  // 3. Compute alpha-weighted average color
  if avgAlpha > 0.0 {
    avgL /= avgAlpha
    avgA /= avgAlpha
    avgB /= avgAlpha
  }

  // 4. Composite transparent pixels over average
  let hasAlpha = avgAlpha < Double(pixelCount)
  var lChan = [Double](repeating: 0.0, count: pixelCount)
  var aChan = [Double](repeating: 0.0, count: pixelCount)
  var bChan = [Double](repeating: 0.0, count: pixelCount)

  for i in 0..<pixelCount {
    let alpha = alphaPixels[i]
    lChan[i] = avgL * (1.0 - alpha) + alpha * oklabPixels[i][0]
    aChan[i] = avgA * (1.0 - alpha) + alpha * oklabPixels[i][1]
    bChan[i] = avgB * (1.0 - alpha) + alpha * oklabPixels[i][2]
  }

  // 5. DCT encode each channel
  let lResult: (dc: Double, ac: [Double], scale: Double)
  if hasAlpha {
    lResult = dctEncode(channel: lChan, w: w, h: h, nx: 6, ny: 6)
  } else {
    lResult = dctEncode(channel: lChan, w: w, h: h, nx: 7, ny: 7)
  }
  let aResult = dctEncode(channel: aChan, w: w, h: h, nx: 4, ny: 4)
  let bResult = dctEncode(channel: bChan, w: w, h: h, nx: 4, ny: 4)
  let alphaResult: (dc: Double, ac: [Double], scale: Double)
  if hasAlpha {
    alphaResult = dctEncode(channel: alphaPixels, w: w, h: h, nx: 3, ny: 3)
  } else {
    alphaResult = (dc: 0.0, ac: [], scale: 0.0)
  }

  // 6. Quantize header values
  let lDcQ = UInt64(roundHalfAwayFromZero(127.0 * clamp01(lResult.dc)))
  let aDcQ = UInt64(
    roundHalfAwayFromZero(
      64.0 + 63.0 * clampNeg1To1(aResult.dc / maxChromaA)))
  let bDcQ = UInt64(
    roundHalfAwayFromZero(
      64.0 + 63.0 * clampNeg1To1(bResult.dc / maxChromaB)))
  let lSclQ = UInt64(roundHalfAwayFromZero(63.0 * clamp01(lResult.scale / maxLScale)))
  let aSclQ = UInt64(roundHalfAwayFromZero(63.0 * clamp01(aResult.scale / maxAScale)))
  let bSclQ = UInt64(roundHalfAwayFromZero(31.0 * clamp01(bResult.scale / maxBScale)))

  // 7. Compute aspect byte
  let aspect = UInt64(encodeAspect(w: w, h: h))

  // 8. Pack header (48 bits = 6 bytes)
  let header: UInt64 =
    lDcQ
    | (aDcQ << 7)
    | (bDcQ << 14)
    | (lSclQ << 21)
    | (aSclQ << 27)
    | (bSclQ << 33)
    | (aspect << 38)
    | (hasAlpha ? (1 << 46) : 0)
    | (1 << 47) // version bit = 1 (v0.2+)

  var hashBytes = [UInt8](repeating: 0, count: 32)
  for i in 0..<6 {
    hashBytes[i] = UInt8((header >> (i * 8)) & 0xFF)
  }

  // 9. Pack AC coefficients with mu-law companding
  var bitpos = 48

  let quantizeAC = { (value: Double, scale: Double, bits: UInt32) -> UInt32 in
    if scale == 0.0 {
      return muLawQuantize(0.0, bits: bits)
    } else {
      return muLawQuantize(value / scale, bits: bits)
    }
  }

  if hasAlpha {
    let alphaDcQ = UInt32(roundHalfAwayFromZero(31.0 * clamp01(alphaResult.dc)))
    let alphaSclQ = UInt32(
      roundHalfAwayFromZero(
        15.0 * clamp01(alphaResult.scale / maxAAlphaScale)))
    writeBits(&hashBytes, bitpos: bitpos, count: 5, value: alphaDcQ)
    bitpos += 5
    writeBits(&hashBytes, bitpos: bitpos, count: 4, value: alphaSclQ)
    bitpos += 4

    // L AC: first 7 at 6 bits, remaining 13 at 5 bits
    for j in 0..<7 {
      let q = quantizeAC(lResult.ac[j], lResult.scale, 6)
      writeBits(&hashBytes, bitpos: bitpos, count: 6, value: q)
      bitpos += 6
    }
    for j in 7..<20 {
      let q = quantizeAC(lResult.ac[j], lResult.scale, 5)
      writeBits(&hashBytes, bitpos: bitpos, count: 5, value: q)
      bitpos += 5
    }
  } else {
    // L AC: all 27 at 5 bits
    for j in 0..<27 {
      let q = quantizeAC(lResult.ac[j], lResult.scale, 5)
      writeBits(&hashBytes, bitpos: bitpos, count: 5, value: q)
      bitpos += 5
    }
  }

  // a AC: 9 at 4 bits
  for j in 0..<aResult.ac.count {
    let q = quantizeAC(aResult.ac[j], aResult.scale, 4)
    writeBits(&hashBytes, bitpos: bitpos, count: 4, value: q)
    bitpos += 4
  }

  // b AC: 9 at 4 bits
  for j in 0..<bResult.ac.count {
    let q = quantizeAC(bResult.ac[j], bResult.scale, 4)
    writeBits(&hashBytes, bitpos: bitpos, count: 4, value: q)
    bitpos += 4
  }

  if hasAlpha {
    // Alpha AC: 5 at 4 bits
    for j in 0..<alphaResult.ac.count {
      let q = quantizeAC(alphaResult.ac[j], alphaResult.scale, 4)
      writeBits(&hashBytes, bitpos: bitpos, count: 4, value: q)
      bitpos += 4
    }
  }

  return hashBytes
}

// MARK: - Decode

/// Decode a ChromaHash into RGBA pixel data. Per spec.
/// Returns (width, height, rgba_pixels).
func decodeHash(hash: [UInt8]) -> (width: Int, height: Int, rgba: [UInt8]) {
  // 1. Unpack header (48 bits)
  var header: UInt64 = 0
  for i in 0..<6 {
    header |= UInt64(hash[i]) << (i * 8)
  }

  let lDcQ = UInt32(header & 0x7F)
  let aDcQ = UInt32((header >> 7) & 0x7F)
  let bDcQ = UInt32((header >> 14) & 0x7F)
  let lSclQ = UInt32((header >> 21) & 0x3F)
  let aSclQ = UInt32((header >> 27) & 0x3F)
  let bSclQ = UInt32((header >> 33) & 0x1F)
  let aspect = UInt8((header >> 38) & 0xFF)
  let hasAlpha = ((header >> 46) & 1) == 1

  // 2. Decode DC values and scale factors
  let lDc = Double(lDcQ) / 127.0
  let aDc = (Double(aDcQ) - 64.0) / 63.0 * maxChromaA
  let bDc = (Double(bDcQ) - 64.0) / 63.0 * maxChromaB
  let lScale = Double(lSclQ) / 63.0 * maxLScale
  let aScale = Double(aSclQ) / 63.0 * maxAScale
  let bScale = Double(bSclQ) / 31.0 * maxBScale

  // 3-4. Decode aspect ratio and compute output size
  let (w, h) = decodeOutputSize(byte: aspect)

  // 5. Dequantize AC coefficients
  var bitpos = 48

  let alphaDcVal: Double
  let alphaScaleVal: Double
  if hasAlpha {
    alphaDcVal = Double(readBits(hash, bitpos: bitpos, count: 5)) / 31.0
    bitpos += 5
    alphaScaleVal = Double(readBits(hash, bitpos: bitpos, count: 4)) / 15.0 * maxAAlphaScale
    bitpos += 4
  } else {
    alphaDcVal = 1.0
    alphaScaleVal = 0.0
  }

  let lAC: [Double]
  let lx: Int
  let ly: Int
  if hasAlpha {
    var lac = [Double]()
    lac.reserveCapacity(20)
    for _ in 0..<7 {
      let q = readBits(hash, bitpos: bitpos, count: 6)
      bitpos += 6
      lac.append(muLawDequantize(q, bits: 6) * lScale)
    }
    for _ in 7..<20 {
      let q = readBits(hash, bitpos: bitpos, count: 5)
      bitpos += 5
      lac.append(muLawDequantize(q, bits: 5) * lScale)
    }
    lAC = lac
    lx = 6
    ly = 6
  } else {
    var lac = [Double]()
    lac.reserveCapacity(27)
    for _ in 0..<27 {
      let q = readBits(hash, bitpos: bitpos, count: 5)
      bitpos += 5
      lac.append(muLawDequantize(q, bits: 5) * lScale)
    }
    lAC = lac
    lx = 7
    ly = 7
  }

  var aAC = [Double]()
  aAC.reserveCapacity(9)
  for _ in 0..<9 {
    let q = readBits(hash, bitpos: bitpos, count: 4)
    bitpos += 4
    aAC.append(muLawDequantize(q, bits: 4) * aScale)
  }

  var bAC = [Double]()
  bAC.reserveCapacity(9)
  for _ in 0..<9 {
    let q = readBits(hash, bitpos: bitpos, count: 4)
    bitpos += 4
    bAC.append(muLawDequantize(q, bits: 4) * bScale)
  }

  let alphaAC: [Double]
  if hasAlpha {
    var aac = [Double]()
    aac.reserveCapacity(5)
    for _ in 0..<5 {
      let q = readBits(hash, bitpos: bitpos, count: 4)
      bitpos += 4
      aac.append(muLawDequantize(q, bits: 4) * alphaScaleVal)
    }
    alphaAC = aac
  } else {
    alphaAC = []
  }

  // Precompute scan orders
  let lScan = triangularScanOrder(nx: lx, ny: ly)
  let chromaScan = triangularScanOrder(nx: 4, ny: 4)
  let alphaScan = hasAlpha ? triangularScanOrder(nx: 3, ny: 3) : []

  // 6. Render output image
  var rgbaOut = [UInt8](repeating: 0, count: w * h * 4)

  for y in 0..<h {
    for x in 0..<w {
      let l = dctDecodePixel(
        dc: lDc, ac: lAC, scanOrder: lScan, x: x, y: y, w: w, h: h)
      let a = dctDecodePixel(
        dc: aDc, ac: aAC, scanOrder: chromaScan, x: x, y: y, w: w, h: h)
      let b = dctDecodePixel(
        dc: bDc, ac: bAC, scanOrder: chromaScan, x: x, y: y, w: w, h: h)
      let alpha: Double
      if hasAlpha {
        alpha = dctDecodePixel(
          dc: alphaDcVal, ac: alphaAC, scanOrder: alphaScan, x: x, y: y, w: w, h: h)
      } else {
        alpha = 1.0
      }

      let lClamped = clamp01(l)
      let gamutClamped = softGamutClamp(lClamped, a, b)
      let rgbLinear = oklabToLinearSRGB(gamutClamped)
      let idx = (y * w + x) * 4
      rgbaOut[idx] = linearToSRGB8(clamp01(rgbLinear[0]))
      rgbaOut[idx + 1] = linearToSRGB8(clamp01(rgbLinear[1]))
      rgbaOut[idx + 2] = linearToSRGB8(clamp01(rgbLinear[2]))
      rgbaOut[idx + 3] = UInt8(roundHalfAwayFromZero(255.0 * clamp01(alpha)))
    }
  }

  return (w, h, rgbaOut)
}

// MARK: - Average Color

/// Extract the average color from a ChromaHash without full decode.
/// Returns (r, g, b, a) as UInt8 values. Per spec.
func averageColorFromHash(hash: [UInt8]) -> (r: UInt8, g: UInt8, b: UInt8, a: UInt8) {
  var header: UInt64 = 0
  for i in 0..<6 {
    header |= UInt64(hash[i]) << (i * 8)
  }

  let lDcQ = UInt32(header & 0x7F)
  let aDcQ = UInt32((header >> 7) & 0x7F)
  let bDcQ = UInt32((header >> 14) & 0x7F)
  let hasAlpha = ((header >> 46) & 1) == 1

  let lDc = Double(lDcQ) / 127.0
  let aDc = (Double(aDcQ) - 64.0) / 63.0 * maxChromaA
  let bDc = (Double(bDcQ) - 64.0) / 63.0 * maxChromaB

  let lClamped = clamp01(lDc)
  let gamutClamped = softGamutClamp(lClamped, aDc, bDc)
  let rgbLinear = oklabToLinearSRGB(gamutClamped)

  let alpha: Double
  if hasAlpha {
    alpha = Double(readBits(hash, bitpos: 48, count: 5)) / 31.0
  } else {
    alpha = 1.0
  }

  return (
    r: linearToSRGB8(clamp01(rgbLinear[0])),
    g: linearToSRGB8(clamp01(rgbLinear[1])),
    b: linearToSRGB8(clamp01(rgbLinear[2])),
    a: UInt8(roundHalfAwayFromZero(255.0 * clamp01(alpha)))
  )
}
