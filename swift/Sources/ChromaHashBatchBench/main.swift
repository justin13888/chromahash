// Throughput benchmark: serial per-image encode vs. BatchEncoder.
//
// Zero dependencies — uses only Foundation's ContinuousClock. Run with:
//
//   swift run -c release ChromaHashBatchBench
//
// Prints images/sec and speedup for the batch path, plus a scaling sweep over
// worker-thread counts. Asserts the batch output is byte-identical to serial
// before timing.

import ChromaHash
import Foundation

let n = 2000

func makeImage(_ seed: Int) -> ImageInput {
  let w = 24 + seed % 40
  let h = 24 + (seed * 7) % 40
  let gamut: Gamut
  switch seed % 5 {
  case 0: gamut = .sRGB
  case 1: gamut = .displayP3
  case 2: gamut = .adobeRGB
  case 3: gamut = .bt2020
  default: gamut = .proPhotoRGB
  }
  let pixels = w * h
  var rgba = [UInt8](repeating: 0, count: pixels * 4)
  for i in 0..<pixels {
    rgba[i * 4] = UInt8((i * 3 + seed) % 256)
    rgba[i * 4 + 1] = UInt8((i * 5 + seed * 2) % 256)
    rgba[i * 4 + 2] = UInt8((i * 7 + seed * 3) % 256)
    rgba[i * 4 + 3] = seed % 3 == 0 ? 200 : 255
  }
  return ImageInput(width: w, height: h, rgba: rgba, gamut: gamut)
}

func encodeSerial(_ items: [ImageInput]) -> [ChromaHash] {
  items.map {
    ChromaHash.encode(width: $0.width, height: $0.height, rgba: $0.rgba, gamut: $0.gamut)
  }
}

func seconds(_ body: () -> Void) -> Double {
  let clock = ContinuousClock()
  let elapsed = clock.measure(body)
  return Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
}

func imagesPerSec(_ count: Int, _ secs: Double) -> Double {
  secs > 0 ? Double(count) / secs : .infinity
}

let cores = ProcessInfo.processInfo.activeProcessorCount
print("chromahash batch benchmark — \(n) images, \(cores) cores available\n")

let items = (0..<n).map(makeImage)

// Warm up and verify correctness.
let warmSerial = encodeSerial(items)
let warmBatch = BatchEncoder().encodeBatch(items)
precondition(warmSerial == warmBatch, "batch output must equal serial")

let serialSecs = seconds {
  let out = encodeSerial(items)
  precondition(out.count == n)
}
print(
  String(
    format: "serial            : %8.4fs  %10.0f img/s  (1.00x)", serialSecs,
    imagesPerSec(n, serialSecs)))

let encoder = BatchEncoder()
_ = encoder.encodeBatch(items)  // warm the pool
let batchSecs = seconds {
  let out = encoder.encodeBatch(items)
  precondition(out.count == n)
}
print(
  String(
    format: "batch (default)   : %8.4fs  %10.0f img/s  (%.2fx)",
    batchSecs, imagesPerSec(n, batchSecs), serialSecs / batchSecs))

print("\nscaling sweep (batch):")
var threadCounts = [1, 2, 4, 8]
if !threadCounts.contains(cores) { threadCounts.append(cores) }
for t in threadCounts {
  let enc = BatchEncoder(threads: t)
  _ = enc.encodeBatch(items)  // warm
  let secs = seconds {
    let out = enc.encodeBatch(items)
    precondition(out.count == n)
  }
  print(
    String(
      format: "  threads=%-3d      : %8.4fs  %10.0f img/s  (%.2fx)",
      t, secs, imagesPerSec(n, secs), serialSecs / secs))
}
