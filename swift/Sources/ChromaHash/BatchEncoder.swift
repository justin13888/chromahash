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

  public init(width: Int, height: Int, rgba: [UInt8], gamut: Gamut) {
    self.width = width
    self.height = height
    self.rgba = rgba
    self.gamut = gamut
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
/// Output is byte-identical to calling ``ChromaHash/encode(width:height:rgba:gamut:)``
/// on each image individually.
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
  /// invalid item traps on the calling thread (identifying its index) rather
  /// than mid-flight on a worker. Validation matches `encode`.
  public func encodeBatch(_ items: [ImageInput]) -> [ChromaHash] {
    for (i, item) in items.enumerated() {
      precondition(item.width >= 1, "item \(i): width must be >= 1")
      precondition(item.height >= 1, "item \(i): height must be >= 1")
      precondition(
        item.rgba.count == item.width * item.height * 4,
        "item \(i): rgba length mismatch"
      )
    }

    if items.isEmpty { return [] }

    let results = ResultStore(count: items.count)
    let operations: [Operation] = items.enumerated().map { index, item in
      BlockOperation {
        let hash = ChromaHash.encode(
          width: item.width,
          height: item.height,
          rgba: item.rgba,
          gamut: item.gamut
        )
        results.storage.withLock { $0[index] = hash }
      }
    }

    queue.addOperations(operations, waitUntilFinished: true)

    return results.storage.withLock { storage in storage.map { $0! } }
  }
}
