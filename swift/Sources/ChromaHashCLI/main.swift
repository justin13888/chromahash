import ChromaHash
import Foundation

func parseGamut(_ s: String) -> Gamut {
  switch s {
  case "srgb": return .sRGB
  case "displayp3": return .displayP3
  case "adobergb": return .adobeRGB
  case "bt2020": return .bt2020
  case "prophoto": return .proPhotoRGB
  default:
    FileHandle.standardError.write(Data("unknown gamut: \(s)\n".utf8))
    exit(1)
  }
}

/// Quality tier from CHROMAHASH_TIER, matching the Rust harness so the
/// cross-language benchmark measures the same workload in every language.
/// Defaults to the 32-byte tier.
func tierFromEnv() -> UInt8 {
  guard let raw = ProcessInfo.processInfo.environment["CHROMAHASH_TIER"],
    !raw.isEmpty
  else {
    return ChromaHash.defaultTier
  }
  guard let tier = UInt8(raw), tier <= ChromaHash.maxTier else {
    FileHandle.standardError.write(
      Data(
        "CHROMAHASH_TIER: \(raw) is not a valid tier code (0...\(ChromaHash.maxTier))\n".utf8))
    exit(1)
  }
  return tier
}

/// Run a throwing call, or print the error and exit 1. The harness talks to
/// this over pipes, so a readable message beats a trap.
func orExit<T>(_ body: @autoclosure () throws -> T) -> T {
  do {
    return try body()
  } catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
  }
}

/// Fail loudly if asked for a knob only the Rust harness has.
///
/// `CHROMAHASH_TUNE` overrides format constants through `chromahash::Tunables`,
/// which no binding exposes; `CHROMAHASH_OUT` selects a decode output gamut this
/// CLI does not implement. Ignoring either silently is the dangerous failure: a
/// sweep would label shipped-default numbers as an ablation and nothing
/// downstream could tell.
func rejectRustOnlyEnv() {
  for key in ["CHROMAHASH_TUNE", "CHROMAHASH_OUT"] {
    if let value = ProcessInfo.processInfo.environment[key], !value.isEmpty {
      FileHandle.standardError.write(
        Data(
          "\(key) is not supported by this harness (Rust-only); refusing to report numbers that would be silently mislabelled\n"
            .utf8))
      exit(1)
    }
  }
}

func benchEnvInt(_ key: String, _ fallback: Int) -> Int {
  guard let raw = ProcessInfo.processInfo.environment[key], !raw.isEmpty else {
    return fallback
  }
  guard let value = Int(raw) else {
    FileHandle.standardError.write(Data("\(key): invalid value \(raw)\n".utf8))
    exit(1)
  }
  return value
}

/// Warm up for `CHROMAHASH_BENCH_WARMUP_MS`, then run `CHROMAHASH_BENCH_REPS`
/// timed blocks of `iters` iterations, printing one mean-ns/op line per block on
/// stdout. Everything else goes to stderr.
///
/// Warmup is time-based rather than count-based because this contract is shared
/// across seven harnesses whose per-op costs differ by two orders of magnitude.
/// The accumulator is written out at the end so the timed work cannot be elided.
//
// `op` is `rethrows` because the encode call sites wrap a throwing API in
// `orExit`, which makes the closure itself throwing; a non-throwing parameter
// would not accept them.
func runBench(_ iters: Int, _ op: () throws -> UInt8) rethrows {
  let reps = max(1, benchEnvInt("CHROMAHASH_BENCH_REPS", 1))
  let warmupNs = UInt64(max(0, benchEnvInt("CHROMAHASH_BENCH_WARMUP_MS", 0))) * 1_000_000
  let n = max(1, iters)
  var acc: UInt8 = 0

  // At least one iteration, so the default also validates the input before the
  // first timed block.
  let warmStart = DispatchTime.now().uptimeNanoseconds
  repeat {
    acc ^= try op()
  } while DispatchTime.now().uptimeNanoseconds - warmStart < warmupNs

  var out = ""
  for _ in 0..<reps {
    let start = DispatchTime.now().uptimeNanoseconds
    for _ in 0..<n {
      acc ^= try op()
    }
    let elapsed = DispatchTime.now().uptimeNanoseconds - start
    out += "\(elapsed / UInt64(n))\n"
  }
  FileHandle.standardOutput.write(Data(out.utf8))
  FileHandle.standardError.write(Data("checksum=\(String(acc, radix: 16))\niters=\(n)\n".utf8))
}

func printUsage() -> Never {
  FileHandle.standardError.write(
    Data(
      """
      Usage:
        ChromaHashCLI encode <width> <height> <gamut>
        ChromaHashCLI decode
        ChromaHashCLI average-color
        ChromaHashCLI batch-encode <width> <height> <gamut> <count>
        ChromaHashCLI batch-decode <count>
        ChromaHashCLI bench-encode <width> <height> <gamut> <iters>
        ChromaHashCLI bench-decode <iters> [max_width max_height]
        ChromaHashCLI bench-batch <width> <height> <gamut> <count>
        ChromaHashCLI bench-info\n
      """.utf8))
  exit(1)
}

guard CommandLine.arguments.count >= 2 else {
  printUsage()
}

switch CommandLine.arguments[1] {
case "encode":
  guard CommandLine.arguments.count == 5 else {
    FileHandle.standardError.write(
      Data("Usage: ChromaHashCLI encode <width> <height> <gamut>\n".utf8))
    exit(1)
  }
  guard let w = Int(CommandLine.arguments[2]),
    let h = Int(CommandLine.arguments[3])
  else {
    FileHandle.standardError.write(Data("invalid width or height\n".utf8))
    exit(1)
  }
  let gamut = parseGamut(CommandLine.arguments[4])

  let expectedLen = w * h * 4
  let stdinData = FileHandle.standardInput.readDataToEndOfFile()
  let rgba = [UInt8](stdinData)

  guard rgba.count == expectedLen else {
    FileHandle.standardError.write(
      Data("expected \(expectedLen) bytes, got \(rgba.count)\n".utf8))
    exit(1)
  }

  let hash = orExit(
    try ChromaHash.encodeWithQuality(
      width: w, height: h, rgba: rgba, gamut: gamut, quality: tierFromEnv()))
  FileHandle.standardOutput.write(Data(hash.hash))

case "decode":
  let hashBytes = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let ch = orExit(try ChromaHash.fromBytes(hashBytes))
  let (_, _, rgba) = ch.decode()
  FileHandle.standardOutput.write(Data(rgba))

case "average-color":
  let hashBytes = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let ch = orExit(try ChromaHash.fromBytes(hashBytes))
  let avg = ch.averageColor()
  FileHandle.standardOutput.write(Data([avg.r, avg.g, avg.b, avg.a]))

case "batch-encode":
  // Read one image, encode it `count` times through the parallel
  // BatchEncoder. Used to benchmark bulk throughput.
  guard CommandLine.arguments.count == 6 else {
    FileHandle.standardError.write(
      Data("Usage: ChromaHashCLI batch-encode <width> <height> <gamut> <count>\n".utf8))
    exit(1)
  }
  guard let w = Int(CommandLine.arguments[2]),
    let h = Int(CommandLine.arguments[3]),
    let count = Int(CommandLine.arguments[5])
  else {
    FileHandle.standardError.write(Data("invalid width, height, or count\n".utf8))
    exit(1)
  }
  let gamut = parseGamut(CommandLine.arguments[4])

  let rgba = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let tier = tierFromEnv()
  let items = (0..<count).map { _ in
    ImageInput(width: w, height: h, rgba: rgba, gamut: gamut, quality: tier)
  }
  let hashes = orExit(try BatchEncoder().encodeBatch(items))
  // Write one result-derived byte so the work cannot be optimized away.
  FileHandle.standardOutput.write(Data([hashes[0].hash[0]]))

case "batch-decode":
  // No batch decode API exists; loop the single decode `count` times.
  guard CommandLine.arguments.count == 3, let count = Int(CommandLine.arguments[2]) else {
    FileHandle.standardError.write(Data("Usage: ChromaHashCLI batch-decode <count>\n".utf8))
    exit(1)
  }
  let hashBytes = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let ch = orExit(try ChromaHash.fromBytes(hashBytes))
  var acc: UInt8 = 0
  for _ in 0..<count {
    let (_, _, rgba) = ch.decode()
    acc ^= rgba[0]
  }
  FileHandle.standardOutput.write(Data([acc]))

case "bench-encode":
  guard CommandLine.arguments.count == 6 else {
    FileHandle.standardError.write(
      Data("Usage: ChromaHashCLI bench-encode <width> <height> <gamut> <iters>\n".utf8))
    exit(1)
  }
  guard let w = Int(CommandLine.arguments[2]),
    let h = Int(CommandLine.arguments[3]),
    let iters = Int(CommandLine.arguments[5])
  else {
    FileHandle.standardError.write(Data("invalid width, height, or iters\n".utf8))
    exit(1)
  }
  rejectRustOnlyEnv()
  let gamut = parseGamut(CommandLine.arguments[4])
  let rgba = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let expectedLen = w * h * 4
  guard rgba.count == expectedLen else {
    FileHandle.standardError.write(
      Data("expected \(expectedLen) bytes, got \(rgba.count)\n".utf8))
    exit(1)
  }
  let tier = tierFromEnv()
  try runBench(iters) {
    orExit(
      try ChromaHash.encodeWithQuality(
        width: w, height: h, rgba: rgba, gamut: gamut, quality: tier)
    ).hash[0]
  }

case "bench-decode":
  guard CommandLine.arguments.count == 3 || CommandLine.arguments.count == 5,
    let iters = Int(CommandLine.arguments[2])
  else {
    FileHandle.standardError.write(
      Data("Usage: ChromaHashCLI bench-decode <iters> [max_width max_height]\n".utf8))
    exit(1)
  }
  rejectRustOnlyEnv()
  let hashBytes = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let ch = orExit(try ChromaHash.fromBytes(hashBytes))
  if CommandLine.arguments.count == 5 {
    guard let maxW = Int(CommandLine.arguments[3]), let maxH = Int(CommandLine.arguments[4]) else {
      FileHandle.standardError.write(Data("invalid max_width or max_height\n".utf8))
      exit(1)
    }
    runBench(iters) {
      let (dw, dh, rgba) = ch.decodeCapped(maxWidth: maxW, maxHeight: maxH)
      return rgba[0] ^ UInt8(truncatingIfNeeded: dw) ^ UInt8(truncatingIfNeeded: dh)
    }
  } else {
    runBench(iters) {
      let (dw, dh, rgba) = ch.decode()
      return rgba[0] ^ UInt8(truncatingIfNeeded: dw) ^ UInt8(truncatingIfNeeded: dh)
    }
  }

case "bench-batch":
  guard CommandLine.arguments.count == 6 else {
    FileHandle.standardError.write(
      Data("Usage: ChromaHashCLI bench-batch <width> <height> <gamut> <count>\n".utf8))
    exit(1)
  }
  guard let w = Int(CommandLine.arguments[2]),
    let h = Int(CommandLine.arguments[3]),
    let count = Int(CommandLine.arguments[5])
  else {
    FileHandle.standardError.write(Data("invalid width, height, or count\n".utf8))
    exit(1)
  }
  rejectRustOnlyEnv()
  let gamut = parseGamut(CommandLine.arguments[4])
  let rgba = [UInt8](FileHandle.standardInput.readDataToEndOfFile())
  let tier = tierFromEnv()
  let items = (0..<count).map { _ in
    ImageInput(width: w, height: h, rgba: rgba, gamut: gamut, quality: tier)
  }
  let threads = benchEnvInt("CHROMAHASH_BATCH_THREADS", 0)
  let encoder = threads > 0 ? BatchEncoder(threads: threads) : BatchEncoder()
  // One batch is one iteration, so the printed number is ns per batch.
  try runBench(1) { orExit(try encoder.encodeBatch(items))[0].hash[0] }

case "bench-info":
  var info = "runtime=swift\n"
  info += "swift_version=\(ProcessInfo.processInfo.operatingSystemVersionString)\n"
  info += "threads=\(ProcessInfo.processInfo.activeProcessorCount)\n"
  FileHandle.standardOutput.write(Data(info.utf8))

default:
  printUsage()
}
