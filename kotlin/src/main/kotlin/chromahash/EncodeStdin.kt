package chromahash

fun main(args: Array<String>) {
    if (args.size != 3) {
        System.err.println("Usage: encode_stdin <width> <height> <gamut>")
        System.exit(1)
    }

    val w = args[0].toInt()
    val h = args[1].toInt()
    val gamut =
        when (args[2]) {
            "srgb" -> Gamut.SRGB
            "displayp3" -> Gamut.DISPLAY_P3
            "adobergb" -> Gamut.ADOBE_RGB
            "bt2020" -> Gamut.BT2020
            "prophoto" -> Gamut.PROPHOTO_RGB
            else -> {
                System.err.println("unknown gamut: ${args[2]}")
                System.exit(1)
                throw IllegalStateException() // unreachable
            }
        }

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
