package chromahash

import org.json.JSONArray
import java.io.File
import java.nio.file.Paths
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ChromaHashTest {
    // ---- Spec vector loading ----

    private fun specVectorsDir(): File {
        // <repo>/kotlin/src/test/kotlin/chromahash/<this file>
        // -> <repo>/spec/test-vectors
        val cwd = Paths.get("").toAbsolutePath().toFile()
        return cwd.resolve("../spec/test-vectors")
    }

    private fun loadJsonArray(name: String): JSONArray? {
        val f = specVectorsDir().resolve(name)
        if (!f.exists()) return null
        return JSONArray(f.readText())
    }

    private fun gamutFromName(name: String): Gamut =
        when (name) {
            "sRGB" -> Gamut.SRGB
            "Display P3" -> Gamut.DISPLAY_P3
            "Adobe RGB" -> Gamut.ADOBE_RGB
            "BT.2020" -> Gamut.BT2020
            "ProPhoto RGB" -> Gamut.PROPHOTO_RGB
            else -> Gamut.SRGB
        }

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
    fun `cbrtHalley - positive values`() {
        assertTrue(abs(cbrtHalley(8.0) - 2.0) < 1e-12)
        assertTrue(abs(cbrtHalley(27.0) - 3.0) < 1e-12)
        assertTrue(abs(cbrtHalley(1.0) - 1.0) < 1e-12)
    }

    @Test
    fun `cbrtHalley - negative values`() {
        assertTrue(abs(cbrtHalley(-8.0) - (-2.0)) < 1e-12)
        assertTrue(abs(cbrtHalley(-27.0) - (-3.0)) < 1e-12)
    }

    @Test
    fun `cbrtHalley - zero`() {
        assertEquals(0.0, cbrtHalley(0.0))
    }

    // ---- Aspect tests ----

    @Test
    fun `aspect 1 to 1`() {
        assertEquals(128, encodeAspect(1, 1))
        val (w, h) = decodeOutputSize(128)
        assertEquals(32, w)
        assertEquals(32, h)
    }

    @Test
    fun `aspect 3 to 2`() {
        assertEquals(146, encodeAspect(3, 2))
        val (w, h) = decodeOutputSize(146)
        assertEquals(32, w)
        assertEquals(21, h)
    }

    @Test
    fun `aspect 4 to 3`() {
        assertEquals(141, encodeAspect(4, 3))
        val (w, h) = decodeOutputSize(141)
        assertEquals(32, w)
        assertEquals(24, h)
    }

    @Test
    fun `aspect 16 to 9`() {
        assertEquals(154, encodeAspect(16, 9))
        val (w, h) = decodeOutputSize(154)
        assertEquals(32, w)
        assertEquals(18, h)
    }

    @Test
    fun `aspect 4 to 1`() {
        assertEquals(191, encodeAspect(4, 1))
        val (w, h) = decodeOutputSize(191)
        assertEquals(32, w)
        assertEquals(8, h)
    }

    @Test
    fun `aspect 1 to 4`() {
        assertEquals(64, encodeAspect(1, 4))
        val (w, h) = decodeOutputSize(64)
        assertEquals(8, w)
        assertEquals(32, h)
    }

    @Test
    fun `aspect 16 to 1`() {
        assertEquals(255, encodeAspect(16, 1))
        val (w, h) = decodeOutputSize(255)
        assertEquals(32, w)
        assertEquals(2, h)
    }

    @Test
    fun `aspect 1 to 16`() {
        assertEquals(0, encodeAspect(1, 16))
        val (w, h) = decodeOutputSize(0)
        assertEquals(2, w)
        assertEquals(32, h)
    }

    @Test
    fun `aspect 2 to 1`() {
        assertEquals(159, encodeAspect(2, 1))
        val (w, h) = decodeOutputSize(159)
        assertEquals(32, w)
        assertEquals(16, h)
    }

    @Test
    fun `aspect 1 to 2`() {
        assertEquals(96, encodeAspect(1, 2))
        val (w, h) = decodeOutputSize(96)
        assertEquals(16, w)
        assertEquals(32, h)
    }

    @Test
    fun `aspect 100 to 25 is 4 to 1`() {
        assertEquals(191, encodeAspect(100, 25))
        val (w, h) = decodeOutputSize(191)
        assertEquals(32, w)
        assertEquals(8, h)
    }

    // ---- DCT scan order tests (v0.4 priority-based) ----

    @Test
    fun `scan order counts`() {
        // aspectByte=128 → square; AC count depends only on (nx, ny).
        assertEquals(5, scanOrder(3, 3, 128).size)
        assertEquals(9, scanOrder(4, 4, 128).size)
        assertEquals(20, scanOrder(6, 6, 128).size)
        assertEquals(27, scanOrder(7, 7, 128).size)
    }

    @Test
    fun `separable matches dctEncode`() {
        // dctEncodeSeparable must produce bit-identical output to dctEncode.
        val w = 8
        val h = 6
        val nx = 5
        val ny = 4
        val scan = scanOrder(nx, ny, 128)
        val cosX = precomputeCosTable(w, nx)
        val cosY = precomputeCosTable(h, ny)
        val channel = DoubleArray(w * h) { i -> ((i * 7) % 17).toDouble() / 17.0 - 0.5 }
        val (dc1, ac1, s1) = dctEncode(channel, w, h, scan)
        val (dc2, ac2, s2) = dctEncodeSeparable(channel, w, h, scan, cosX, cosY)
        assertEquals(dc1, dc2, "DC must be bit-identical")
        assertEquals(s1, s2, "scale must be bit-identical")
        assertContentEquals(ac1, ac2, "AC must be bit-identical")
    }

    @Test
    fun `separable decode matches dctDecodePixel`() {
        // dctDecodePixelSeparable must produce bit-identical output to dctDecodePixel.
        val w = 8
        val h = 6
        val nx = 5
        val ny = 4
        val scan = scanOrder(nx, ny, 128)
        val cosX = precomputeCosTable(w, nx)
        val cosY = precomputeCosTable(h, ny)
        val dc = 0.37
        val ac = DoubleArray(scan.size) { j -> ((j * 5) % 11).toDouble() / 11.0 - 0.5 }
        for (y in 0 until h) {
            for (x in 0 until w) {
                val naive = dctDecodePixel(dc, ac, scan, x, y, w, h)
                val sep = dctDecodePixelSeparable(dc, ac, scan, x, y, cosX, cosY)
                assertEquals(naive, sep, "decode must be bit-identical at ($x,$y)")
            }
        }
    }

    @Test
    fun `scan order 4x4 square is radial`() {
        val order = scanOrder(4, 4, 128)
        val expected =
            listOf(
                Pair(0, 1), Pair(1, 0), Pair(1, 1),
                Pair(0, 2), Pair(2, 0), Pair(1, 2),
                Pair(2, 1), Pair(0, 3), Pair(3, 0),
            )
        assertEquals(expected, order)
    }

    @Test
    fun `scan order 3x3 square is radial`() {
        val order = scanOrder(3, 3, 128)
        val expected = listOf(Pair(0, 1), Pair(1, 0), Pair(1, 1), Pair(0, 2), Pair(2, 0))
        assertEquals(expected, order)
    }

    @Test
    fun `scan order spec vectors`() {
        val arr = loadJsonArray("unit-dct.json") ?: return
        for (i in 0 until arr.length()) {
            val tc = arr.getJSONObject(i)
            val name = tc.getString("name")
            val input = tc.getJSONObject("input")
            val expected = tc.getJSONObject("expected")
            val nx = input.getInt("nx")
            val ny = input.getInt("ny")
            val w = input.getInt("w")
            val h = input.getInt("h")
            val acCount = expected.getInt("ac_count")
            val expectedScan = expected.getJSONArray("scan_order")
            // Find aspect byte producing (w, h)
            var aspectByte = -1
            for (b in 0..255) {
                val (bw, bh) = decodeOutputSize(b)
                if (bw == w && bh == h) {
                    aspectByte = b
                    break
                }
            }
            assertTrue(aspectByte >= 0, "$name: no aspect byte for (w=$w, h=$h)")
            val order = scanOrder(nx, ny, aspectByte)
            assertEquals(acCount, order.size, "$name: ac_count")
            for (j in 0 until order.size) {
                if (j >= expectedScan.length()) break
                val pair = order[j]
                val exp = expectedScan.getJSONArray(j)
                assertEquals(exp.getInt(0), pair.first, "$name: scan[$j].cx")
                assertEquals(exp.getInt(1), pair.second, "$name: scan[$j].cy")
            }
        }
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

    @Test
    fun `bitpack multiple fields`() {
        val buf = ByteArray(8)
        writeBits(buf, 0, 7, 100)
        writeBits(buf, 7, 7, 64)
        writeBits(buf, 14, 7, 80)
        writeBits(buf, 21, 6, 33)
        writeBits(buf, 27, 6, 20)
        writeBits(buf, 33, 5, 15)
        writeBits(buf, 38, 8, 128)

        assertEquals(100, readBits(buf, 0, 7))
        assertEquals(64, readBits(buf, 7, 7))
        assertEquals(80, readBits(buf, 14, 7))
        assertEquals(33, readBits(buf, 21, 6))
        assertEquals(20, readBits(buf, 27, 6))
        assertEquals(15, readBits(buf, 33, 5))
        assertEquals(128, readBits(buf, 38, 8))
    }

    // ---- MuLaw tests ----

    @Test
    fun `mulaw roundtrip extremes`() {
        for (v in doubleArrayOf(-1.0, -0.5, 0.0, 0.5, 1.0)) {
            val c = muCompress(v)
            val rt = muExpand(c)
            assertTrue(abs(rt - v) < 1e-12, "mu-law roundtrip failed at v=$v")
        }
    }

    @Test
    fun `mulaw quantize 4 bit`() {
        assertEquals(8, muLawQuantize(0.0, 4), "midpoint for 4-bit should be 8")
        assertEquals(0, muLawQuantize(-1.0, 4))
        assertEquals(15, muLawQuantize(1.0, 4))
    }

    @Test
    fun `mulaw quantize 5 bit`() {
        assertEquals(16, muLawQuantize(0.0, 5), "midpoint for 5-bit should be 16")
        assertEquals(0, muLawQuantize(-1.0, 5))
        assertEquals(31, muLawQuantize(1.0, 5))
    }

    // ---- Transfer tests ----

    @Test
    fun `srgb boundaries`() {
        assertEquals(0.0, srgbEotf(0.0))
        assertTrue(abs(srgbEotf(1.0) - 1.0) < 1e-12)
        assertEquals(0.0, srgbGamma(0.0))
        assertTrue(abs(srgbGamma(1.0) - 1.0) < 1e-12)
    }

    @Test
    fun `srgb roundtrip`() {
        for (x in doubleArrayOf(0.0, 0.01, 0.04045, 0.1, 0.5, 0.9, 1.0)) {
            val linear = srgbEotf(x)
            val gamma = srgbGamma(linear)
            assertTrue(abs(gamma - x) < 1e-4, "sRGB roundtrip failed at x=$x")
        }
    }

    // ---- Color tests ----

    @Test
    fun `white to oklab`() {
        val lab = linearRgbToOklab(doubleArrayOf(1.0, 1.0, 1.0), Gamut.SRGB)
        assertTrue(abs(lab[0] - 1.0) < 1e-6, "white L should be near 1")
        assertTrue(abs(lab[1]) < 1e-6, "white a should be near 0")
        assertTrue(abs(lab[2]) < 1e-6, "white b should be near 0")
    }

    @Test
    fun `black to oklab`() {
        val lab = linearRgbToOklab(doubleArrayOf(0.0, 0.0, 0.0), Gamut.SRGB)
        assertTrue(abs(lab[0]) < 1e-12, "black L should = 0")
        assertTrue(abs(lab[1]) < 1e-12, "black a should = 0")
        assertTrue(abs(lab[2]) < 1e-12, "black b should = 0")
    }

    @Test
    fun `oklab roundtrip sRGB`() {
        val testColors =
            listOf(
                doubleArrayOf(1.0, 0.0, 0.0),
                doubleArrayOf(0.0, 1.0, 0.0),
                doubleArrayOf(0.0, 0.0, 1.0),
                doubleArrayOf(0.5, 0.5, 0.5),
                doubleArrayOf(0.2, 0.7, 0.3),
            )
        for (rgb in testColors) {
            val lab = linearRgbToOklab(rgb, Gamut.SRGB)
            val rgb2 = oklabToLinearSrgb(lab)
            for (i in 0..2) {
                assertTrue(abs(rgb[i] - rgb2[i]) < 1e-6, "roundtrip failed for ${rgb.toList()} at $i")
            }
        }
    }

    // ---- Integration encode (spec vectors) ----

    @Test
    fun `integration encode spec vectors`() {
        val arr = loadJsonArray("integration-encode.json") ?: return
        for (i in 0 until arr.length()) {
            val tc = arr.getJSONObject(i)
            val name = tc.getString("name")
            val input = tc.getJSONObject("input")
            val width = input.getInt("width")
            val height = input.getInt("height")
            val gamut = gamutFromName(input.getString("gamut"))
            val rgbaArr = input.getJSONArray("rgba")
            val rgba = ByteArray(rgbaArr.length()) { (rgbaArr.getInt(it) and 0xFF).toByte() }
            val expected = tc.getJSONObject("expected")
            val expectedHashArr = expected.getJSONArray("hash")
            val expectedHash =
                ByteArray(expectedHashArr.length()) { (expectedHashArr.getInt(it) and 0xFF).toByte() }
            val hash = ChromaHash.encode(width, height, rgba, gamut)
            assertContentEquals(expectedHash, hash.hash, "$name: hash mismatch")
            if (expected.has("average_color")) {
                val avgArr = expected.getJSONArray("average_color")
                val avg = hash.averageColor()
                assertEquals(avgArr.getInt(0), avg.r, "$name: avg.r")
                assertEquals(avgArr.getInt(1), avg.g, "$name: avg.g")
                assertEquals(avgArr.getInt(2), avg.b, "$name: avg.b")
                assertEquals(avgArr.getInt(3), avg.a, "$name: avg.a")
            }
        }
    }

    // ---- Integration decode (spec vectors) ----

    @Test
    fun `integration decode spec vectors`() {
        val arr = loadJsonArray("integration-decode.json") ?: return
        for (i in 0 until arr.length()) {
            val tc = arr.getJSONObject(i)
            val name = tc.getString("name")
            val input = tc.getJSONObject("input")
            val hashArr = input.getJSONArray("hash")
            val hashBytes = ByteArray(hashArr.length()) { (hashArr.getInt(it) and 0xFF).toByte() }
            val expected = tc.getJSONObject("expected")
            val expectedW = expected.getInt("width")
            val expectedH = expected.getInt("height")
            val expectedRgba = expected.getJSONArray("rgba")
            val hash = ChromaHash.fromBytes(hashBytes)
            val result = hash.decode()
            assertEquals(expectedW, result.width, "$name: width")
            assertEquals(expectedH, result.height, "$name: height")
            assertEquals(expectedRgba.length(), result.rgba.size, "$name: rgba length")
            for (j in 0 until result.rgba.size) {
                if (j >= expectedRgba.length()) break
                val got = result.rgba[j].toInt() and 0xFF
                assertEquals(expectedRgba.getInt(j), got, "$name: rgba[$j]")
            }
        }
    }

    // ---- Encode + Decode roundtrip ----

    @Test
    fun `encode decode roundtrip dimensions`() {
        val rgba =
            ByteArray(64) { i ->
                when (i % 4) {
                    0 -> 128.toByte()
                    1 -> 64.toByte()
                    2 -> 32.toByte()
                    else -> 255.toByte()
                }
            }
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val result = hash.decode()
        assertTrue(result.width in 1..32)
        assertTrue(result.height in 1..32)
        assertEquals(result.width * result.height * 4, result.rgba.size)
    }

    @Test
    fun `fromBytes roundtrip`() {
        val rgba =
            ByteArray(64) { i ->
                when (i % 4) {
                    0 -> 128.toByte()
                    1 -> 64.toByte()
                    2 -> 32.toByte()
                    else -> 255.toByte()
                }
            }
        val hash = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val hash2 = ChromaHash.fromBytes(hash.hash)
        assertEquals(hash, hash2)
    }

    @Test
    fun `deterministic encoding`() {
        val rgba =
            ByteArray(64) { i ->
                when (i % 4) {
                    0 -> 200.toByte()
                    1 -> 100.toByte()
                    2 -> 50.toByte()
                    else -> 255.toByte()
                }
            }
        val h1 = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        val h2 = ChromaHash.encode(4, 4, rgba, Gamut.SRGB)
        assertContentEquals(h1.hash, h2.hash, "encoding should be deterministic")
    }

    @Test
    fun `spec vectors directory exists`() {
        val dir = specVectorsDir()
        assertNotNull(dir, "spec vectors directory should be resolvable")
        // Sanity check: directory exists or our test paths are wrong
        assertTrue(dir.exists(), "spec vectors dir not found at ${dir.absolutePath}")
    }
}
