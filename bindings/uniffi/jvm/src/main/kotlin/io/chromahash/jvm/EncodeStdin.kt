package io.chromahash.jvm

import io.chromahash.ffi.BatchEncoder
import io.chromahash.ffi.ChromaHash
import io.chromahash.ffi.Gamut
import io.chromahash.ffi.ImageInput
import io.chromahash.ffi.defaultTier
import io.chromahash.ffi.maxTier

/**
 * stdin/stdout CLI used by the cross-language comparison harness, mirroring the
 * other languages' `encode-stdin`. Backed by the UniFFI binding (`io.chromahash.ffi`).
 *
 * Tier codes are ordered by quality (spec §2.5) and come from the core across
 * the FFI, so a renumbering cannot leave a stale literal here.
 */

private val DEFAULT_TIER: UByte = defaultTier()
private val MAX_TIER: UByte = maxTier()

/**
 * Quality tier from CHROMAHASH_TIER, matching the Rust harness so the
 * cross-language benchmark measures the same workload in every language.
 * Defaults to the 32-byte tier.
 */
private fun tierFromEnv(): UByte {
    val raw = System.getenv("CHROMAHASH_TIER")
    if (raw.isNullOrEmpty()) return DEFAULT_TIER
    val tier = raw.toUByteOrNull()
    if (tier == null || tier > MAX_TIER) {
        System.err.println("CHROMAHASH_TIER: '$raw' is not a valid tier code (0..=$MAX_TIER)")
        System.exit(1)
    }
    return tier!!
}

/**
 * Fail loudly if asked for a knob only the Rust harness has.
 *
 * `CHROMAHASH_TUNE` overrides format constants through `chromahash::Tunables`,
 * which no binding exposes; `CHROMAHASH_OUT` selects a decode output gamut this
 * CLI does not implement. Ignoring either silently is the dangerous failure: a
 * sweep would label shipped-default numbers as an ablation and nothing
 * downstream could tell.
 */
private fun rejectRustOnlyEnv() {
    for (key in listOf("CHROMAHASH_TUNE", "CHROMAHASH_OUT")) {
        if (!System.getenv(key).isNullOrEmpty()) {
            System.err.println(
                "$key is not supported by this harness (Rust-only); refusing to " +
                    "report numbers that would be silently mislabelled",
            )
            System.exit(1)
        }
    }
}

private fun benchEnvLong(
    key: String,
    fallback: Long,
): Long {
    val raw = System.getenv(key)
    if (raw.isNullOrEmpty()) return fallback
    val value = raw.toLongOrNull()
    if (value == null) {
        System.err.println("$key: invalid value '$raw'")
        System.exit(1)
    }
    return value!!
}

/**
 * Warm up for `CHROMAHASH_BENCH_WARMUP_MS`, then run `CHROMAHASH_BENCH_REPS`
 * timed blocks of [iters] iterations, printing one mean-ns/op line per block on
 * stdout. Everything else goes to stderr.
 *
 * Warmup is time-based rather than count-based because this contract is shared
 * across seven harnesses whose per-op costs differ by two orders of magnitude,
 * and because C2 needs wall-clock time rather than a trip count to settle. The
 * accumulator is written out at the end so the timed work cannot be elided.
 */
private fun runBench(
    iters: Int,
    op: () -> Byte,
) {
    val reps = maxOf(1L, benchEnvLong("CHROMAHASH_BENCH_REPS", 1))
    val warmupMs = benchEnvLong("CHROMAHASH_BENCH_WARMUP_MS", 0)
    val n = maxOf(1, iters)
    var acc = 0

    // At least one iteration, so the default also validates the input before the
    // first timed block.
    val warmStart = System.nanoTime()
    do {
        acc = acc xor (op().toInt() and 0xFF)
    } while ((System.nanoTime() - warmStart) / 1_000_000 < warmupMs)

    val out = StringBuilder()
    for (r in 0 until reps) {
        val start = System.nanoTime()
        for (i in 0 until n) {
            acc = acc xor (op().toInt() and 0xFF)
        }
        out.append((System.nanoTime() - start) / n).append('\n')
    }
    print(out)
    System.out.flush()
    System.err.println("checksum=${Integer.toHexString(acc)}")
    System.err.println("iters=$n")
}

private fun parseGamut(s: String): Gamut =
    when (s) {
        "srgb" -> Gamut.SRGB
        "displayp3" -> Gamut.DISPLAY_P3
        "adobergb" -> Gamut.ADOBE_RGB
        "bt2020" -> Gamut.BT2020
        "prophoto" -> Gamut.PRO_PHOTO_RGB
        else -> {
            System.err.println("unknown gamut: $s")
            System.exit(1)
            throw IllegalStateException() // unreachable
        }
    }

fun main(args: Array<String>) {
    if (args.isEmpty()) {
        System.err.println("Usage:")
        System.err.println("  chromahash encode <width> <height> <gamut>")
        System.err.println("  chromahash decode")
        System.err.println("  chromahash average-color")
        System.err.println("  chromahash batch-encode <width> <height> <gamut> <count>")
        System.err.println("  chromahash batch-decode <count>")
        System.err.println("  chromahash bench-encode <width> <height> <gamut> <iters>")
        System.err.println("  chromahash bench-decode <iters> [max_width max_height]")
        System.err.println("  chromahash bench-batch <width> <height> <gamut> <count>")
        System.err.println("  chromahash bench-info")
        System.exit(1)
    }

    when (args[0]) {
        "encode" -> {
            if (args.size != 4) {
                System.err.println("Usage: chromahash encode <width> <height> <gamut>")
                System.exit(1)
            }
            val w = args[1].toInt()
            val h = args[2].toInt()
            val gamut = parseGamut(args[3])

            val expectedLen = w * h * 4
            val rgba = System.`in`.readNBytes(expectedLen)
            if (rgba.size != expectedLen) {
                System.err.println("expected $expectedLen bytes, got ${rgba.size}")
                System.exit(1)
            }

            val hash =
                ChromaHash.encodeWithQuality(w.toUInt(), h.toUInt(), rgba, gamut, tierFromEnv())
            System.out.write(hash.asBytes())
            System.out.flush()
        }
        "decode" -> {
            val hashBytes = System.`in`.readBytes()
            val result = ChromaHash.fromBytes(hashBytes).decode()
            System.out.write(result.rgba)
            System.out.flush()
        }
        "average-color" -> {
            val hashBytes = System.`in`.readBytes()
            val color = ChromaHash.fromBytes(hashBytes).averageColor()
            System.out.write(
                byteArrayOf(color.r.toByte(), color.g.toByte(), color.b.toByte(), color.a.toByte()),
            )
            System.out.flush()
        }
        "batch-encode" -> {
            // Read one image, encode it `count` times through the parallel
            // BatchEncoder (backed by the Rust worker pool). Benchmarks throughput.
            if (args.size != 5) {
                System.err.println("Usage: chromahash batch-encode <width> <height> <gamut> <count>")
                System.exit(1)
            }
            val w = args[1].toInt()
            val h = args[2].toInt()
            val gamut = parseGamut(args[3])
            val count = args[4].toInt()

            val rgba = System.`in`.readNBytes(w * h * 4)
            val tier = tierFromEnv()
            val items = List(count) { ImageInput(w.toUInt(), h.toUInt(), rgba, gamut, tier) }
            val firstByte = BatchEncoder().use { it.encodeBatch(items)[0].asBytes()[0] }
            // Write one result-derived byte so the work cannot be optimized away.
            System.out.write(byteArrayOf(firstByte))
            System.out.flush()
        }
        "batch-decode" -> {
            // No batch decode API exists; loop the single decode `count` times.
            if (args.size != 2) {
                System.err.println("Usage: chromahash batch-decode <count>")
                System.exit(1)
            }
            val count = args[1].toInt()
            val hashBytes = System.`in`.readBytes()
            val ch = ChromaHash.fromBytes(hashBytes)
            var acc = 0
            repeat(count) { acc = acc xor (ch.decode().rgba[0].toInt() and 0xFF) }
            System.out.write(byteArrayOf(acc.toByte()))
            System.out.flush()
        }
        "bench-encode" -> {
            if (args.size != 5) {
                System.err.println("Usage: chromahash bench-encode <width> <height> <gamut> <iters>")
                System.exit(1)
            }
            rejectRustOnlyEnv()
            val w = args[1].toInt()
            val h = args[2].toInt()
            val gamut = parseGamut(args[3])
            val iters = args[4].toInt()
            val rgba = System.`in`.readNBytes(w * h * 4)
            val tier = tierFromEnv()
            runBench(iters) {
                ChromaHash.encodeWithQuality(w.toUInt(), h.toUInt(), rgba, gamut, tier).asBytes()[0]
            }
        }
        "bench-decode" -> {
            if (args.size != 2 && args.size != 4) {
                System.err.println("Usage: chromahash bench-decode <iters> [max_width max_height]")
                System.exit(1)
            }
            rejectRustOnlyEnv()
            val iters = args[1].toInt()
            val ch = ChromaHash.fromBytes(System.`in`.readBytes())
            if (args.size == 4) {
                val maxW = args[2].toUInt()
                val maxH = args[3].toUInt()
                runBench(iters) {
                    val r = ch.decodeCapped(maxW, maxH)
                    (r.rgba[0].toInt() xor r.width.toInt() xor r.height.toInt()).toByte()
                }
            } else {
                runBench(iters) {
                    val r = ch.decode()
                    (r.rgba[0].toInt() xor r.width.toInt() xor r.height.toInt()).toByte()
                }
            }
        }
        "bench-batch" -> {
            if (args.size != 5) {
                System.err.println("Usage: chromahash bench-batch <width> <height> <gamut> <count>")
                System.exit(1)
            }
            rejectRustOnlyEnv()
            val w = args[1].toInt()
            val h = args[2].toInt()
            val gamut = parseGamut(args[3])
            val count = args[4].toInt()
            val rgba = System.`in`.readNBytes(w * h * 4)
            val tier = tierFromEnv()
            val items = List(count) { ImageInput(w.toUInt(), h.toUInt(), rgba, gamut, tier) }
            val threads = benchEnvLong("CHROMAHASH_BATCH_THREADS", 0)
            val encoder =
                if (threads > 0) BatchEncoder.withThreads(threads.toUInt()) else BatchEncoder()
            // One batch is one iteration, so the printed number is ns per batch.
            encoder.use { enc -> runBench(1) { enc.encodeBatch(items)[0].asBytes()[0] } }
        }
        "bench-info" -> {
            println("runtime=kotlin")
            println("java_version=${System.getProperty("java.version")}")
            println("jvm=${System.getProperty("java.vm.name")}")
            // Rust, Go, C# and Swift all report arch; without it a Kotlin row in
            // the perf report cannot say which machine produced it.
            println("arch=${System.getProperty("os.arch")}")
            println("threads=${Runtime.getRuntime().availableProcessors()}")
        }
        else -> {
            System.err.println("unknown subcommand: ${args[0]}")
            System.exit(1)
        }
    }
}
