package chromahash

// Throughput benchmark: serial per-image encode vs. BatchEncoder.
//
// Zero dependencies — uses only System.nanoTime with an explicit JIT warmup.
// Run with:
//
//   ./gradlew bench
//
// Prints images/sec and speedup for the batch path, plus a scaling sweep over
// worker-thread counts.

private const val BENCH_N = 2000

private fun benchImages(n: Int): List<ImageInput> {
    val gamuts = listOf(Gamut.SRGB, Gamut.DISPLAY_P3, Gamut.ADOBE_RGB, Gamut.BT2020, Gamut.PROPHOTO_RGB)
    return (0 until n).map { i ->
        val w = 24 + i % 40
        val h = 24 + (i * 7) % 40
        val rgba = ByteArray(w * h * 4)
        for (p in 0 until w * h) {
            rgba[p * 4] = ((p * 3 + i) % 256).toByte()
            rgba[p * 4 + 1] = ((p * 5 + i * 2) % 256).toByte()
            rgba[p * 4 + 2] = ((p * 7 + i * 3) % 256).toByte()
            rgba[p * 4 + 3] = if (i % 3 == 0) 200.toByte() else 255.toByte()
        }
        ImageInput(w, h, rgba, gamuts[i % gamuts.size])
    }
}

private fun encodeSerial(items: List<ImageInput>): List<ChromaHash> = items.map { ChromaHash.encode(it.w, it.h, it.rgba, it.gamut) }

private fun imagesPerSec(
    n: Int,
    secs: Double,
): Double = if (secs > 0) n / secs else Double.POSITIVE_INFINITY

fun main() {
    val cores = Runtime.getRuntime().availableProcessors()
    println("chromahash batch benchmark — $BENCH_N images, $cores cores available\n")
    val items = benchImages(BENCH_N)

    // JIT warmup: run both paths several times untimed so the measured region
    // reflects optimized (compiled) code rather than interpreter/C1.
    repeat(5) {
        encodeSerial(items)
        BatchEncoder().use { it.encodeBatch(items) }
    }

    val serialStart = System.nanoTime()
    val serial = encodeSerial(items)
    val serialSecs = (System.nanoTime() - serialStart) / 1e9
    check(serial.size == BENCH_N)
    println("serial            : %8.4fs  %10.0f img/s  (1.00x)".format(serialSecs, imagesPerSec(BENCH_N, serialSecs)))

    BatchEncoder().use { encoder ->
        encoder.encodeBatch(items) // warm the pool
        val start = System.nanoTime()
        val batch = encoder.encodeBatch(items)
        val secs = (System.nanoTime() - start) / 1e9
        check(batch == serial) { "batch output must equal serial" }
        println(
            "batch (default)   : %8.4fs  %10.0f img/s  (%.2fx)".format(
                secs,
                imagesPerSec(BENCH_N, secs),
                serialSecs / secs,
            ),
        )
    }

    println("\nscaling sweep (batch):")
    val threadCounts = (listOf(1, 2, 4, 8) + cores).distinct()
    for (t in threadCounts) {
        BatchEncoder(t).use { encoder ->
            encoder.encodeBatch(items) // warm
            val start = System.nanoTime()
            encoder.encodeBatch(items)
            val secs = (System.nanoTime() - start) / 1e9
            println(
                "  threads=%-3d      : %8.4fs  %10.0f img/s  (%.2fx)".format(
                    t,
                    secs,
                    imagesPerSec(BENCH_N, secs),
                    serialSecs / secs,
                ),
            )
        }
    }
}
