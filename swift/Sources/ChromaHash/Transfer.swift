/// sRGB EOTF (gamma -> linear), per spec.
func srgbEOTF(_ x: Double) -> Double {
  if x <= 0.04045 {
    return x / 12.92
  } else {
    return portablePow((x + 0.055) / 1.055, 2.4)
  }
}

/// sRGB gamma (linear -> gamma), per spec.
func srgbGamma(_ x: Double) -> Double {
  if x <= 0.0031308 {
    return 12.92 * x
  } else {
    return 1.055 * portablePow(x, 1.0 / 2.4) - 0.055
  }
}

/// Adobe RGB EOTF (gamma -> linear): x^2.2.
func adobeRGBEOTF(_ x: Double) -> Double {
  return portablePow(x, 2.2)
}

/// ProPhoto RGB EOTF (gamma -> linear): x^1.8.
func proPhotoRGBEOTF(_ x: Double) -> Double {
  return portablePow(x, 1.8)
}

/// BT.2020 PQ (ST 2084) inverse EOTF -> linear light, then Reinhard tone-map to SDR.
func bt2020PQEOTF(_ x: Double) -> Double {
  // PQ inverse EOTF constants (ST 2084)
  let pqM1: Double = 0.1593017578125
  let pqM2: Double = 78.84375
  let pqC1: Double = 0.8359375
  let pqC2: Double = 18.8515625
  let pqC3: Double = 18.6875

  let n = portablePow(x, 1.0 / pqM2)
  let num = max(n - pqC1, 0.0)
  let den = pqC2 - pqC3 * n
  let yLinear = portablePow(num / den, 1.0 / pqM1)

  // PQ output is in [0, 10000] cd/m^2
  let yNits = yLinear * 10000.0

  // Simple Reinhard tone mapping: L / (1 + L)
  // SDR reference white = 203 nits
  let l = yNits / 203.0
  return l / (1.0 + l)
}
