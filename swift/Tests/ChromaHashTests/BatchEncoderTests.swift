import Testing

@testable import ChromaHash

// NOTE: these tests drive BatchEncoder, whose encodeBatch blocks the calling
// thread on an OperationQueue (waitUntilFinished: true). Under Swift Testing's
// default parallel executor, several blocking batch tests can saturate the
// Swift-concurrency cooperative pool on low-core machines and deadlock, so the
// suite is run with `swift test --no-parallel` (in ci-swift.yml and the
// `test-swift` just recipe). Keep that flag if you add more batch tests.

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

/// A spread of dimensions, gamuts, and alpha, mirroring the bulk-migration use
/// case. It also spans every tier, so a batch path that ignored `quality` would
/// fail.
private func mixedItems() -> [ImageInput] {
  [
    ImageInput(
      width: 4, height: 4, rgba: solidImage(4, 4, 200, 100, 50, 255), gamut: .sRGB,
      quality: ChromaHash.compactTier),
    ImageInput(
      width: 8, height: 4, rgba: horizontalGradient(8, 4), gamut: .displayP3,
      quality: ChromaHash.defaultTier),
    ImageInput(
      width: 4, height: 8, rgba: solidImage(4, 8, 30, 200, 120, 128), gamut: .adobeRGB,
      quality: 2),
    ImageInput(
      width: 16, height: 16, rgba: horizontalGradient(16, 16), gamut: .bt2020, quality: 3),
    ImageInput(
      width: 1, height: 1, rgba: solidImage(1, 1, 255, 0, 0, 255), gamut: .proPhotoRGB,
      quality: ChromaHash.maxTier),
  ]
}

private func encodeSerial(_ items: [ImageInput]) throws -> [ChromaHash] {
  try items.map {
    try ChromaHash.encodeWithQuality(
      width: $0.width, height: $0.height, rgba: $0.rgba, gamut: $0.gamut, quality: $0.quality)
  }
}

// MARK: - Tests

@Test func batchMatchesSerial() throws {
  let items = mixedItems()
  let batch = try BatchEncoder().encodeBatch(items)
  #expect(batch == (try encodeSerial(items)))
}

/// Pins the tier down to the byte count. Comparing batch against serial alone
/// would pass if both silently used one tier.
@Test func batchHonorsQuality() throws {
  let rgba = solidImage(8, 8, 200, 100, 50, 255)
  let items = (ChromaHash.compactTier...ChromaHash.maxTier).map {
    ImageInput(width: 8, height: 8, rgba: rgba, gamut: .sRGB, quality: $0)
  }
  let batch = try BatchEncoder().encodeBatch(items)
  #expect(batch.map { $0.hash.count } == [21, 32, 108, 411, 1623])
}

/// An item with no explicit tier must match `encode` — the codes are ordered by
/// quality, so a zero default would be the 21-byte compact tier.
@Test func batchOmittedQualityIsTheDefaultTier() throws {
  let rgba = solidImage(8, 8, 200, 100, 50, 255)
  let batch = try BatchEncoder().encodeBatch(
    [ImageInput(width: 8, height: 8, rgba: rgba, gamut: .sRGB)])
  #expect(batch == [try ChromaHash.encode(width: 8, height: 8, rgba: rgba, gamut: .sRGB)])
}

@Test func batchRejectsReservedTierNamingTheItem() {
  let rgba = solidImage(4, 4, 200, 100, 50, 255)
  let items = [
    ImageInput(width: 4, height: 4, rgba: rgba, gamut: .sRGB),
    ImageInput(width: 4, height: 4, rgba: rgba, gamut: .sRGB, quality: ChromaHash.maxTier + 1),
  ]
  #expect(throws: ChromaHashError.self) { try BatchEncoder().encodeBatch(items) }
}

@Test func batchRejectsInvalidItems() {
  let rgba = solidImage(4, 4, 200, 100, 50, 255)
  #expect(throws: ChromaHashError.self) {
    try BatchEncoder().encodeBatch(
      [ImageInput(width: 0, height: 4, rgba: [], gamut: .sRGB)])
  }
  #expect(throws: ChromaHashError.self) {
    try BatchEncoder().encodeBatch(
      [ImageInput(width: 4, height: 4, rgba: Array(rgba.dropLast()), gamut: .sRGB)])
  }
}

@Test func batchPreservesOrder() throws {
  // Many same-shape items to exercise out-of-order completion.
  var items: [ImageInput] = []
  for i in 0..<64 {
    let r = UInt8(i & 0xFF)
    let g = UInt8((255 - i) & 0xFF)
    let b = UInt8((i * 3) & 0xFF)
    items.append(
      ImageInput(width: 8, height: 8, rgba: solidImage(8, 8, r, g, b, 255), gamut: .sRGB))
  }
  let batch = try BatchEncoder(threads: 4).encodeBatch(items)
  #expect(batch == (try encodeSerial(items)))
}

@Test func batchReusableAcrossCalls() throws {
  let encoder = BatchEncoder()
  let items = mixedItems()
  let first = try encoder.encodeBatch(items)
  let second = try encoder.encodeBatch(items)
  #expect(first == second)
  #expect(first == (try encodeSerial(items)))
}

@Test func emptyBatchReturnsEmpty() throws {
  #expect(try BatchEncoder().encodeBatch([]).isEmpty)
}

@Test func singleThreadMatchesDefault() throws {
  let items = mixedItems()
  #expect(
    try BatchEncoder(threads: 1).encodeBatch(items) == (try BatchEncoder().encodeBatch(items)))
}
