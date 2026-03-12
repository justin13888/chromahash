import Foundation

/// Convert linear RGB to OKLAB using the specified source gamut's M1 matrix.
func linearRGBToOKLAB(_ rgb: [Double], gamut: Gamut) -> [Double] {
  let m1 = gamut.m1Matrix
  let lms = matvec3(m1, rgb)
  let lmsCbrt = [
    cbrtSigned(lms[0]),
    cbrtSigned(lms[1]),
    cbrtSigned(lms[2]),
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
