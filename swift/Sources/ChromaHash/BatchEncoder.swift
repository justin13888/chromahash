import Foundation
import Synchronization

/// One image to encode in a batch.
public struct ImageInput: Sendable {
  /// Image width (must be >= 1).
  public let width: Int
  /// Image height (must be >= 1).
  public let height: Int
  /// Pixel data in RGBA format (4 bytes per pixel, count == `width * height * 4`).
  public let rgba: [UInt8]
  /// Source color space.
  public let gamut: Gamut
  /// Quality tier (0...``ChromaHash/maxTier``, ordered by quality). Defaults to
  /// ``ChromaHash/defaultTier`` — note the codes start at 0 for the *compact*
  /// tier, so an explicit 0 is the 21-byte hash.
  public let quality: UInt8

  public init(
    width: Int, height: Int, rgba: [UInt8], gamut: Gamut,
    quality: UInt8 = ChromaHash.defaultTier
  ) {
    self.width = width
    self.height = height
    self.rgba = rgba
    self.gamut = gamut
    self.quality = quality
  }
}

/// A `Sendable` box sharing one lock-guarded result buffer across the worker
/// operations. Each worker writes a disjoint index under the lock.
private final class ResultStore: Sendable {
  let storage: Mutex<[ChromaHash?]>
  init(count: Int) {
    storage = Mutex(Array(repeating: nil, count: count))
  }
}

/// A stateful, self-parallelizing batch encoder backed by an owned
/// `OperationQueue` whose worker pool is reused across `encodeBatch` calls.
///
/// Output is byte-identical to calling
/// ``ChromaHash/encodeWithQuality(width:height:rgba:gamut:quality:)`` on each
/// image individually at that image's tier.
public final class BatchEncoder {
  private let queue: OperationQueue

  /// Create an encoder with a worker pool of `threads` concurrent operations
  /// (defaults to the number of active processors, clamped to >= 1).
  public init(threads: Int = ProcessInfo.processInfo.activeProcessorCount) {
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = max(1, threads)
    self.queue = queue
  }

  deinit {
    queue.cancelAllOperations()
  }

  /// Encode every item, returning hashes in the same order as `items`.
  ///
  /// All items are validated up front, before any work is dispatched, so an
  /// invalid item throws on the calling thread (identifying its index) rather
  /// than failing mid-flight on a worker. Validation matches
  /// `encodeWithQuality`.
  ///
  /// - Throws: ``ChromaHashError`` for the first invalid item.
  public func encodeBatch(_ items: [ImageInput]) throws -> [ChromaHash] {
    for (i, item) in items.enumerated() {
      guard item.width >= 1, item.height >= 1 else {
        throw ChromaHashError.InvalidDimensions(
          reason: "item \(i): width and height must be >= 1")
      }
      guard item.rgba.count == item.width * item.height * 4 else {
        throw ChromaHashError.InvalidLength(reason: "item \(i): rgba length mismatch")
      }
      guard item.quality <= ChromaHash.maxTier else {
        throw ChromaHashError.InvalidTier(
          reason: "item \(i): quality tier must be 0...\(ChromaHash.maxTier)")
      }
    }

    if items.isEmpty { return [] }

    let results = ResultStore(count: items.count)
    let operations: [Operation] = items.enumerated().map { index, item in
      BlockOperation {
        // Validated above, so the throwing encode cannot fail here.
        // swiftlint:disable:next force_try
        let hash = try! ChromaHash.encodeWithQuality(
          width: item.width,
          height: item.height,
          rgba: item.rgba,
          gamut: item.gamut,
          quality: item.quality
        )
        results.storage.withLock { $0[index] = hash }
      }
    }

    queue.addOperations(operations, waitUntilFinished: true)

    return results.storage.withLock { storage in storage.map { $0! } }
  }
}
