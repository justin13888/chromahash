import Testing

@testable import ChromaHash

// MARK: - Batch helpers

private func solidImage(_ w: Int, _ h: Int, _ r: UInt8, _ g: UInt8, _ b: UInt8, _ a: UInt8)
  -> [UInt8]
{
  var rgba = [UInt8](repeating: 0, count: w * h * 4)
  for i in 0..<(w * h) {
    rgba[i * 4] = r
    rgba[i * 4 + 1] = g
    rgba[i * 4 + 2] = b
    rgba[i * 4 + 3] = a
  }
  return rgba
}

private func horizontalGradient(_ w: Int, _ h: Int) -> [UInt8] {
  var rgba = [UInt8](repeating: 0, count: w * h * 4)
  for y in 0..<h {
    for x in 0..<w {
      let t = Double(x) / Double(max(w - 1, 1))
      let idx = (y * w + x) * 4
      rgba[idx] = UInt8(t * 255)
      rgba[idx + 1] = UInt8((1.0 - t) * 255)
      rgba[idx + 2] = 128
      rgba[idx + 3] = 255
    }
  }
  return rgba
}

/// A spread of dimensions, gamuts, and alpha, mirroring the bulk-migration use case.
private func mixedItems() -> [ImageInput] {
  [
    ImageInput(width: 4, height: 4, rgba: solidImage(4, 4, 200, 100, 50, 255), gamut: .sRGB),
    ImageInput(width: 8, height: 4, rgba: horizontalGradient(8, 4), gamut: .displayP3),
    ImageInput(width: 4, height: 8, rgba: solidImage(4, 8, 30, 200, 120, 128), gamut: .adobeRGB),
    ImageInput(width: 16, height: 16, rgba: horizontalGradient(16, 16), gamut: .bt2020),
    ImageInput(width: 1, height: 1, rgba: solidImage(1, 1, 255, 0, 0, 255), gamut: .proPhotoRGB),
  ]
}

private func encodeSerial(_ items: [ImageInput]) -> [ChromaHash] {
  items.map {
    ChromaHash.encode(width: $0.width, height: $0.height, rgba: $0.rgba, gamut: $0.gamut)
  }
}

// MARK: - Tests

@Test func batchMatchesSerial() {
  let items = mixedItems()
  let batch = BatchEncoder().encodeBatch(items)
  #expect(batch == encodeSerial(items))
}

@Test func batchPreservesOrder() {
  // Many same-shape items to exercise out-of-order completion.
  var items: [ImageInput] = []
  for i in 0..<64 {
    let r = UInt8(i & 0xFF)
    let g = UInt8((255 - i) & 0xFF)
    let b = UInt8((i * 3) & 0xFF)
    items.append(
      ImageInput(width: 8, height: 8, rgba: solidImage(8, 8, r, g, b, 255), gamut: .sRGB))
  }
  let batch = BatchEncoder(threads: 4).encodeBatch(items)
  #expect(batch == encodeSerial(items))
}

@Test func batchReusableAcrossCalls() {
  let encoder = BatchEncoder()
  let items = mixedItems()
  let first = encoder.encodeBatch(items)
  let second = encoder.encodeBatch(items)
  #expect(first == second)
  #expect(first == encodeSerial(items))
}

@Test func emptyBatchReturnsEmpty() {
  #expect(BatchEncoder().encodeBatch([]).isEmpty)
}

@Test func singleThreadMatchesDefault() {
  let items = mixedItems()
  #expect(BatchEncoder(threads: 1).encodeBatch(items) == BatchEncoder().encodeBatch(items))
}
