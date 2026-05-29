package chromahash

fun parseGamut(s: String): Gamut =
    when (s) {
        "srgb" -> Gamut.SRGB
        "displayp3" -> Gamut.DISPLAY_P3
        "adobergb" -> Gamut.ADOBE_RGB
        "bt2020" -> Gamut.BT2020
        "prophoto" -> Gamut.PROPHOTO_RGB
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

            val hash = ChromaHash.encode(w, h, rgba, gamut)
            System.out.write(hash.hash)
            System.out.flush()
        }
        "decode" -> {
            val hashBytes = System.`in`.readNBytes(32)
            if (hashBytes.size != 32) {
                System.err.println("expected 32 bytes, got ${hashBytes.size}")
                System.exit(1)
            }
            val ch = ChromaHash.fromBytes(hashBytes)
            val result = ch.decode()
            System.out.write(result.rgba)
            System.out.flush()
        }
        "average-color" -> {
            val hashBytes = System.`in`.readNBytes(32)
            if (hashBytes.size != 32) {
                System.err.println("expected 32 bytes, got ${hashBytes.size}")
                System.exit(1)
            }
            val ch = ChromaHash.fromBytes(hashBytes)
            val color = ch.averageColor()
            System.out.write(byteArrayOf(color.r.toByte(), color.g.toByte(), color.b.toByte(), color.a.toByte()))
            System.out.flush()
        }
        "batch-encode" -> {
            // Read one image, encode it `count` times through the parallel
            // BatchEncoder. Used to benchmark bulk throughput.
            if (args.size != 5) {
                System.err.println("Usage: chromahash batch-encode <width> <height> <gamut> <count>")
                System.exit(1)
            }
            val w = args[1].toInt()
            val h = args[2].toInt()
            val gamut = parseGamut(args[3])
            val count = args[4].toInt()

            val rgba = System.`in`.readNBytes(w * h * 4)
            val items = List(count) { ImageInput(w, h, rgba, gamut) }
            val hashes = BatchEncoder().use { it.encodeBatch(items) }
            // Write one result-derived byte so the work cannot be optimized away.
            System.out.write(byteArrayOf(hashes[0].hash[0]))
            System.out.flush()
        }
        "batch-decode" -> {
            // No batch decode API exists; loop the single decode `count` times.
            if (args.size != 2) {
                System.err.println("Usage: chromahash batch-decode <count>")
                System.exit(1)
            }
            val count = args[1].toInt()
            val hashBytes = System.`in`.readNBytes(32)
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
