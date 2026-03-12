package chromahash

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ChromaHashTest {
    // ---- MathUtils tests ----

    @Test
    fun `roundHalfAwayFromZero - positive halves round up`() {
        assertEquals(1.0, roundHalfAwayFromZero(0.5))
        assertEquals(2.0, roundHalfAwayFromZero(1.5))
        assertEquals(3.0, roundHalfAwayFromZero(2.5))
    }

    @Test
    fun `roundHalfAwayFromZero - negative halves round away from zero`() {
        assertEquals(-1.0, roundHalfAwayFromZero(-0.5))
        assertEquals(-2.0, roundHalfAwayFromZero(-1.5))
        assertEquals(-3.0, roundHalfAwayFromZero(-2.5))
    }

    @Test
    fun `roundHalfAwayFromZero - standard cases`() {
        assertEquals(0.0, roundHalfAwayFromZero(0.0))
        assertEquals(0.0, roundHalfAwayFromZero(0.3))
        assertEquals(1.0, roundHalfAwayFromZero(0.7))
        assertEquals(0.0, roundHalfAwayFromZero(-0.3))
        assertEquals(-1.0, roundHalfAwayFromZero(-0.7))
    }

    @Test
    fun `cbrtSigned - positive values`() {
        assertTrue(abs(cbrtSigned(8.0) - 2.0) < 1e-12)
        assertTrue(abs(cbrtSigned(27.0) - 3.0) < 1e-12)
        assertTrue(abs(cbrtSigned(1.0) - 1.0) < 1e-12)
    }

    @Test
    fun `cbrtSigned - negative values`() {
        assertTrue(abs(cbrtSigned(-8.0) - (-2.0)) < 1e-12)
        assertTrue(abs(cbrtSigned(-27.0) - (-3.0)) < 1e-12)
    }

    @Test
    fun `cbrtSigned - zero`() {
        assertEquals(0.0, cbrtSigned(0.0))
    }

    // ---- Aspect tests (from unit-aspect.json) ----

    @Test
    fun `aspect 1 to 1`() {
        assertEquals(128, encodeAspect(1, 1))
        val (w, h) = decodeOutputSize(128)
        assertEquals(32, w)
        assertEquals(32, h)
    }

    @Test
    fun `aspect 3 to 2`() {
        assertEquals(165, encodeAspect(3, 2))
        val (w, h) = decodeOutputSize(165)
        assertEquals(32, w)
        assertEquals(21, h)
    }

    @Test
    fun `aspect 4 to 3`() {
        assertEquals(154, encodeAspect(4, 3))
        val (w, h) = decodeOutputSize(154)
        assertEquals(32, w)
        assertEquals(24, h)
    }

    @Test
    fun `aspect 16 to 9`() {
        assertEquals(180, encodeAspect(16, 9))
        val (w, h) = decodeOutputSize(180)
        assertEquals(32, w)
        assertEquals(18, h)
    }

    @Test
    fun `aspect 4 to 1`() {
        assertEquals(255, encodeAspect(4, 1))
        val (w, h) = decodeOutputSize(255)
        assertEquals(32, w)
        assertEquals(8, h)
    }

    @Test
    fun `aspect 1 to 4`() {
        assertEquals(0, encodeAspect(1, 4))
        val (w, h) = decodeOutputSize(0)
        assertEquals(8, w)
        assertEquals(32, h)
    }

    @Test
    fun `aspect 2 to 1`() {
        assertEquals(191, encodeAspect(2, 1))
        val (w, h) = decodeOutputSize(191)
        assertEquals(32, w)
        assertEquals(16, h)
    }

    @Test
    fun `aspect 1 to 2`() {
        assertEquals(64, encodeAspect(1, 2))
        val (w, h) = decodeOutputSize(64)
        assertEquals(16, w)
        assertEquals(32, h)
    }

    @Test
    fun `aspect 100 to 25 clamps to max`() {
        assertEquals(255, encodeAspect(100, 25))
        val (w, h) = decodeOutputSize(255)
        assertEquals(32, w)
        assertEquals(8, h)
    }

    // ---- DCT scan order tests (from unit-dct.json) ----

    @Test
    fun `scan order 3x3`() {
        val order = triangularScanOrder(3, 3)
        assertEquals(5, order.size)
        val expected =
            listOf(
                Pair(1, 0),
                Pair(2, 0),
                Pair(0, 1),
                Pair(1, 1),
                Pair(0, 2),
            )
        assertEquals(expected, order)
    }

    @Test
    fun `scan order 4x4`() {
        val order = triangularScanOrder(4, 4)
        assertEquals(9, order.size)
        val expected =
            listOf(
                Pair(1, 0), Pair(2, 0), Pair(3, 0),
                Pair(0, 1), Pair(1, 1), Pair(2, 1),
                Pair(0, 2), Pair(1, 2),
                Pair(0, 3),
            )
        assertEquals(expected, order)
    }

    @Test
    fun `scan order 6x6`() {
        val order = triangularScanOrder(6, 6)
        assertEquals(20, order.size)
    }

    @Test
    fun `scan order 7x7`() {
        val order = triangularScanOrder(7, 7)
        assertEquals(27, order.size)
    }

    // ---- BitPack tests ----

    @Test
    fun `bitpack roundtrip basic`() {
        val buf = ByteArray(4)
        writeBits(buf, 0, 8, 0xAB)
        assertEquals(0xAB, readBits(buf, 0, 8))
    }

    @Test
    fun `bitpack cross byte boundary`() {
        val buf = ByteArray(4)
        writeBits(buf, 6, 8, 0xCA)
        assertEquals(0xCA, readBits(buf, 6, 8))
    }

    // ---- Integration encode tests (from integration-encode.json) ----

    private fun solidImage(
        w: Int,
        h: Int,
        r: Int,
        g: Int,
        b: Int,
        a: Int,
    ): ByteArray {
        val pixelCount = w * h
        val rgba = ByteArray(pixelCount * 4)
        for (i in 0 until pixelCount) {
            rgba[i * 4] = r.toByte()
            rgba[i * 4 + 1] = g.toByte()
            rgba[i * 4 + 2] = b.toByte()
            rgba[i * 4 + 3] = a.toByte()
        }
        return rgba
    }

    @Test
    fun `encode solid gray 4x4`() {
        val rgba = solidImage(4, 4, 128, 128, 128, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                76, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode solid red 4x4`() {
        val rgba = solidImage(4, 4, 255, 0, 0, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                80, 46, 20, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode solid green 4x4`() {
        val rgba = solidImage(4, 4, 0, 255, 0, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                238, 209, 21, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode solid blue 4x4`() {
        val rgba = solidImage(4, 4, 0, 0, 255, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                57, 94, 6, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode solid white 4x4`() {
        val rgba = solidImage(4, 4, 255, 255, 255, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                127, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode solid black 4x4`() {
        val rgba = solidImage(4, 4, 0, 0, 0, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                0, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode gradient 16x16`() {
        val rgba = buildGradient16x16()
        val hash = ChromaHash.encode(16, 16, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                198, 164, 110, 88, 12, 32, 228, 183, 250, 100, 0, 200, 185, 199, 237, 123,
                15, 58, 248, 168, 132, 239, 73, 184, 227, 60, 187, 179, 60, 168, 187, 59,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode gradient 8x4`() {
        val rgba = buildGradient8x4()
        val hash = ChromaHash.encode(8, 4, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                72, 164, 142, 96, 206, 47, 199, 187, 250, 100, 0, 200, 185, 215, 239, 123,
                48, 66, 248, 222, 123, 238, 9, 64, 100, 189, 186, 179, 60, 168, 51, 68,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode gradient 4x8`() {
        val rgba = buildGradient4x8()
        val hash = ChromaHash.encode(4, 8, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                201, 228, 142, 104, 12, 16, 229, 187, 23, 65, 0, 8, 190, 183, 237, 115,
                16, 62, 8, 169, 132, 239, 69, 64, 228, 60, 187, 43, 61, 168, 179, 59,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode checkerboard alpha 8x8`() {
        val rgba = buildCheckerboardAlpha8x8()
        val hash = ChromaHash.encode(8, 8, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                80, 46, 20, 0, 0, 96, 16, 64, 16, 4, 65, 16, 132, 16, 66, 8,
                33, 132, 16, 66, 136, 136, 136, 136, 136, 136, 136, 136, 136, 136, 135, 127,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode solid 1x1`() {
        val rgba = solidImage(1, 1, 200, 100, 50, 255)
        val hash = ChromaHash.encode(1, 1, rgba, Gamut.SRGB)
        val expected =
            intArrayOf(
                206, 102, 243, 111, 12, 32, 16, 188, 15, 1, 132, 15, 66, 8, 222, 135,
                224, 65, 8, 63, 4, 16, 2, 132, 67, 60, 184, 67, 56, 196, 131, 59,
            )
        assertHashEquals(expected, hash.hash)
    }

    @Test
    fun `encode solid p3 4x4`() {
        val rgba = solidImage(4, 4, 200, 100, 50, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.DISPLAY_P3)
        val expected =
            intArrayOf(
                79, 232, 19, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            )
        assertHashEquals(expected, hash.hash)
    }

    // ---- Integration encode: average color tests ----

    @Test
    fun `average color solid gray`() {
        val rgba = solidImage(4, 4, 128, 128, 128, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val avg = hash.averageColor()
        assertContentEquals(intArrayOf(128, 128, 128, 255), avg)
    }

    @Test
    fun `average color solid red`() {
        val rgba = solidImage(4, 4, 255, 0, 0, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val avg = hash.averageColor()
        assertContentEquals(intArrayOf(255, 11, 0, 255), avg)
    }

    @Test
    fun `average color solid green`() {
        val rgba = solidImage(4, 4, 0, 255, 0, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val avg = hash.averageColor()
        assertContentEquals(intArrayOf(39, 254, 0, 255), avg)
    }

    @Test
    fun `average color solid blue`() {
        val rgba = solidImage(4, 4, 0, 0, 255, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val avg = hash.averageColor()
        assertContentEquals(intArrayOf(1, 0, 253, 255), avg)
    }

    @Test
    fun `average color solid white`() {
        val rgba = solidImage(4, 4, 255, 255, 255, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val avg = hash.averageColor()
        assertContentEquals(intArrayOf(255, 255, 255, 255), avg)
    }

    @Test
    fun `average color solid black`() {
        val rgba = solidImage(4, 4, 0, 0, 0, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val avg = hash.averageColor()
        assertContentEquals(intArrayOf(0, 0, 0, 255), avg)
    }

    @Test
    fun `average color checkerboard alpha`() {
        val rgba = buildCheckerboardAlpha8x8()
        val hash = ChromaHash.encode(8, 8, rgba, Gamut.SRGB)
        val avg = hash.averageColor()
        assertContentEquals(intArrayOf(255, 11, 0, 132), avg)
    }

    // ---- Decode tests ----

    @Test
    fun `decode solid gray produces uniform pixels`() {
        val hashBytes =
            intArrayOf(
                76, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            ).map { it.toByte() }.toByteArray()
        val hash = ChromaHash.fromBytes(hashBytes)
        val (w, h, rgba) = hash.decode()
        assertEquals(32, w)
        assertEquals(32, h)
        // All pixels should be close to (128, 128, 128, 255)
        for (i in 0 until w * h) {
            val r = rgba[i * 4].toInt() and 0xFF
            val g = rgba[i * 4 + 1].toInt() and 0xFF
            val b = rgba[i * 4 + 2].toInt() and 0xFF
            val a = rgba[i * 4 + 3].toInt() and 0xFF
            assertTrue(abs(r - 128) <= 1, "pixel $i R=$r, expected ~128")
            assertTrue(abs(g - 128) <= 1, "pixel $i G=$g, expected ~128")
            assertTrue(abs(b - 128) <= 1, "pixel $i B=$b, expected ~128")
            assertEquals(255, a, "pixel $i A=$a, expected 255")
        }
    }

    @Test
    fun `decode solid red produces uniform pixels`() {
        val hashBytes =
            intArrayOf(
                80, 46, 20, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            ).map { it.toByte() }.toByteArray()
        val hash = ChromaHash.fromBytes(hashBytes)
        val (w, h, rgba) = hash.decode()
        assertEquals(32, w)
        assertEquals(32, h)
        for (i in 0 until w * h) {
            val r = rgba[i * 4].toInt() and 0xFF
            val g = rgba[i * 4 + 1].toInt() and 0xFF
            val b = rgba[i * 4 + 2].toInt() and 0xFF
            assertTrue(abs(r - 255) <= 1, "pixel $i R=$r, expected ~255")
            assertTrue(abs(g - 11) <= 1, "pixel $i G=$g, expected ~11")
            assertTrue(abs(b - 0) <= 1, "pixel $i B=$b, expected ~0")
        }
    }

    @Test
    fun `decode solid black all zeros`() {
        val hashBytes =
            intArrayOf(
                0, 32, 16, 0, 0, 32, 16, 66, 8, 33, 132, 16, 66, 8, 33, 132,
                16, 66, 8, 33, 132, 16, 66, 68, 68, 68, 68, 68, 68, 68, 68, 68,
            ).map { it.toByte() }.toByteArray()
        val hash = ChromaHash.fromBytes(hashBytes)
        val (w, h, rgba) = hash.decode()
        assertEquals(32, w)
        assertEquals(32, h)
        for (i in 0 until w * h) {
            val r = rgba[i * 4].toInt() and 0xFF
            val g = rgba[i * 4 + 1].toInt() and 0xFF
            val b = rgba[i * 4 + 2].toInt() and 0xFF
            val a = rgba[i * 4 + 3].toInt() and 0xFF
            assertTrue(r <= 1, "pixel $i R=$r, expected ~0")
            assertTrue(g <= 1, "pixel $i G=$g, expected ~0")
            assertTrue(b <= 1, "pixel $i B=$b, expected ~0")
            assertEquals(255, a)
        }
    }

    @Test
    fun `decode produces valid dimensions`() {
        val rgba = solidImage(4, 4, 128, 64, 32, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val (w, h, pixels) = hash.decode()
        assertTrue(w in 1..32)
        assertTrue(h in 1..32)
        assertEquals(w * h * 4, pixels.size)
    }

    // ---- fromBytes roundtrip ----

    @Test
    fun `fromBytes roundtrip`() {
        val rgba = solidImage(4, 4, 128, 64, 32, 255)
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val hash2 = ChromaHash.fromBytes(hash.hash.copyOf())
        assertEquals(hash, hash2)
    }

    @Test
    fun `deterministic encoding`() {
        val rgba = solidImage(4, 4, 200, 100, 50, 255)
        val hash1 = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val hash2 = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        assertContentEquals(hash1.hash, hash2.hash)
    }

    @Test
    fun `all gamuts produce output`() {
        val rgba = solidImage(4, 4, 200, 100, 50, 255)
        for (gamut in Gamut.entries) {
            val hash = ChromaHash.encode(4, 4, rgba, gamut)
            assertEquals(32, hash.hash.size, "gamut $gamut should produce 32 bytes")
        }
    }

    // ---- Helper functions to build test images matching test vectors ----

    private fun assertHashEquals(
        expected: IntArray,
        actual: ByteArray,
    ) {
        assertEquals(expected.size, actual.size, "hash length mismatch")
        for (i in expected.indices) {
            val actualUnsigned = actual[i].toInt() and 0xFF
            assertEquals(
                expected[i],
                actualUnsigned,
                "hash byte $i: expected ${expected[i]}, got $actualUnsigned",
            )
        }
    }

    private fun buildGradient16x16(): ByteArray {
        // Must match Rust reference: gradient_image(16, 16) in test_vectors.rs
        val w = 16
        val h = 16
        val rgba = ByteArray(w * h * 4)
        for (y in 0 until h) {
            for (x in 0 until w) {
                val tx = x.toDouble() / maxOf(w - 1, 1).toDouble()
                val ty = y.toDouble() / maxOf(h - 1, 1).toDouble()
                val idx = (y * w + x) * 4
                rgba[idx] = (tx * 255.0).toInt().toByte()
                rgba[idx + 1] = ((1.0 - tx) * ty * 255.0).toInt().toByte()
                rgba[idx + 2] = ((1.0 - ty) * 255.0).toInt().toByte()
                rgba[idx + 3] = 255.toByte()
            }
        }
        return rgba
    }

    @Suppress("LongMethod")
    private fun buildGradient8x4(): ByteArray {
        // From integration-encode.json gradient_8x4
        val data =
            intArrayOf(
                0, 0, 255, 255, 36, 0, 255, 255, 72, 0, 255, 255, 109, 0, 255, 255,
                145, 0, 255, 255, 182, 0, 255, 255, 218, 0, 255, 255, 255, 0, 255, 255,
                0, 85, 170, 255, 36, 72, 170, 255, 72, 60, 170, 255, 109, 48, 170, 255,
                145, 36, 170, 255, 182, 24, 170, 255, 218, 12, 170, 255, 255, 0, 170, 255,
                0, 170, 85, 255, 36, 145, 85, 255, 72, 121, 85, 255, 109, 97, 85, 255,
                145, 72, 85, 255, 182, 48, 85, 255, 218, 24, 85, 255, 255, 0, 85, 255,
                0, 255, 0, 255, 36, 218, 0, 255, 72, 182, 0, 255, 109, 145, 0, 255,
                145, 109, 0, 255, 182, 72, 0, 255, 218, 36, 0, 255, 255, 0, 0, 255,
            )
        return data.map { it.toByte() }.toByteArray()
    }

    @Suppress("LongMethod")
    private fun buildGradient4x8(): ByteArray {
        // From integration-encode.json gradient_4x8
        val data =
            intArrayOf(
                0, 0, 255, 255, 85, 0, 255, 255, 170, 0, 255, 255, 255, 0, 255, 255,
                0, 36, 218, 255, 85, 24, 218, 255, 170, 12, 218, 255, 255, 0, 218, 255,
                0, 72, 182, 255, 85, 48, 182, 255, 170, 24, 182, 255, 255, 0, 182, 255,
                0, 109, 145, 255, 85, 72, 145, 255, 170, 36, 145, 255, 255, 0, 145, 255,
                0, 145, 109, 255, 85, 97, 109, 255, 170, 48, 109, 255, 255, 0, 109, 255,
                0, 182, 72, 255, 85, 121, 72, 255, 170, 60, 72, 255, 255, 0, 72, 255,
                0, 218, 36, 255, 85, 145, 36, 255, 170, 72, 36, 255, 255, 0, 36, 255,
                0, 255, 0, 255, 85, 170, 0, 255, 170, 85, 0, 255, 255, 0, 0, 255,
            )
        return data.map { it.toByte() }.toByteArray()
    }

    @Suppress("LongMethod")
    private fun buildCheckerboardAlpha8x8(): ByteArray {
        // From integration-encode.json checkerboard_alpha_8x8
        val data =
            intArrayOf(
                255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
                255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
                0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
                0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
                255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
                255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
                0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
                0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
                255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
                255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
                0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
                0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
                255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
                255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0,
                0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
                0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255, 0, 255, 0, 0, 255,
            )
        return data.map { it.toByte() }.toByteArray()
    }
}
