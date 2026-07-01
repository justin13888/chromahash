package io.chromahash.jvm

import io.chromahash.ffi.BatchEncoder
import io.chromahash.ffi.ChromaHash
import io.chromahash.ffi.Gamut
import io.chromahash.ffi.ImageInput

/**
 * stdin/stdout CLI used by the cross-language comparison harness, mirroring the
 * other languages' `encode-stdin`. Backed by the UniFFI binding (`io.chromahash.ffi`).
 */

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

            val hash = ChromaHash.encode(w.toUInt(), h.toUInt(), rgba, gamut)
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
            val items = List(count) { ImageInput(w.toUInt(), h.toUInt(), rgba, gamut) }
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
        else -> {
            System.err.println("unknown subcommand: ${args[0]}")
            System.exit(1)
        }
    }
}
