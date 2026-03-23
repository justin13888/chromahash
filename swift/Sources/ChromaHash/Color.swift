import Foundation

/// Convert linear RGB to OKLAB using the specified source gamut's M1 matrix.
func linearRGBToOKLAB(_ rgb: [Double], gamut: Gamut) -> [Double] {
  let m1 = gamut.m1Matrix
  let lms = matvec3(m1, rgb)
  let lmsCbrt = [
    cbrtHalley(lms[0]),
    cbrtHalley(lms[1]),
    cbrtHalley(lms[2]),
  ]
  return matvec3(m2, lmsCbrt)
}

/// Convert OKLAB to linear sRGB.
func oklabToLinearSRGB(_ lab: [Double]) -> [Double] {
  let lmsCbrt = matvec3(m2Inv, lab)
  let lms = [
    lmsCbrt[0] * lmsCbrt[0] * lmsCbrt[0],
    lmsCbrt[1] * lmsCbrt[1] * lmsCbrt[1],
    lmsCbrt[2] * lmsCbrt[2] * lmsCbrt[2],
  ]
  return matvec3(m1InvSRGB, lms)
}

/// Convert gamma-encoded source RGB to OKLAB.
func gammaRGBToOKLAB(r: Double, g: Double, b: Double, gamut: Gamut) -> [Double] {
  let eotf: (Double) -> Double
  switch gamut {
  case .sRGB, .displayP3:
    eotf = srgbEOTF
  case .adobeRGB:
    eotf = adobeRGBEOTF
  case .proPhotoRGB:
    eotf = proPhotoRGBEOTF
  case .bt2020:
    eotf = bt2020PQEOTF
  }
  return linearRGBToOKLAB([eotf(r), eotf(g), eotf(b)], gamut: gamut)
}

/// Convert OKLAB to gamma-encoded sRGB [0,1] with clamping.
func oklabToSRGB(_ lab: [Double]) -> [Double] {
  let rgbLinear = oklabToLinearSRGB(lab)
  return [
    srgbGamma(clamp01(rgbLinear[0])),
    srgbGamma(clamp01(rgbLinear[1])),
    srgbGamma(clamp01(rgbLinear[2])),
  ]
}

/// Check whether all RGB channels are in [0, 1].
func inGamut(_ rgb: [Double]) -> Bool {
  return rgb[0] >= 0.0 && rgb[0] <= 1.0
    && rgb[1] >= 0.0 && rgb[1] <= 1.0
    && rgb[2] >= 0.0 && rgb[2] <= 1.0
}

/// Soft gamut clamp via OKLch bisection. Per spec §6.1.
/// Preserves L and hue; reduces chroma until all sRGB channels fit [0, 1].
/// Precondition: L must be in [0, 1].
func softGamutClamp(_ l: Double, _ a: Double, _ b: Double) -> [Double] {
  let rgb = oklabToLinearSRGB([l, a, b])
  if inGamut(rgb) { return [l, a, b] }

  let c = Foundation.sqrt(a * a + b * b)
  if c < 1e-10 { return [l, 0.0, 0.0] }

  let hCos = a / c
  let hSin = b / c
  var lo = 0.0
  var hi = c
  // Exactly 16 iterations — deterministic per spec §6.1
  for _ in 0..<16 {
    let mid = (lo + hi) / 2.0
    let rgbTest = oklabToLinearSRGB([l, mid * hCos, mid * hSin])
    if inGamut(rgbTest) { lo = mid } else { hi = mid }
  }
  return [l, lo * hCos, lo * hSin]
}

/// 4096-entry sRGB gamma LUT: lut[i] = sRGB8(i/4095). Per spec §6.2.
let gammaLUT: [Int] = (0..<4096).map { i in
  Int(roundHalfAwayFromZero(srgbGamma(Double(i) / 4095.0) * 255.0))
}

/// Map a linear [0,1] value to sRGB u8 via the gamma LUT. Per spec §6.2.
func linearToSRGB8(_ x: Double) -> UInt8 {
  let raw = Int(roundHalfAwayFromZero(x * 4095.0))
  let idx = max(0, min(4095, raw))
  return UInt8(gammaLUT[idx])
}
