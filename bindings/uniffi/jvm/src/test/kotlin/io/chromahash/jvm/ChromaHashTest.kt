package io.chromahash.jvm

import io.chromahash.ffi.ChromaHash
import io.chromahash.ffi.Gamut
import org.json.JSONArray
import java.io.File
import java.nio.file.Paths
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Drives the spec test vectors through the UniFFI binding (`io.chromahash.ffi`),
 * proving the generated Kotlin + JNA + bundled native lib produce byte-identical
 * output to the Rust reference. This is the JVM module's enforced correctness gate.
 */
class ChromaHashTest {
    private fun specVectorsDir(): File {
        // <repo>/bindings/uniffi/jvm  ->  <repo>/spec/test-vectors
        val cwd = Paths.get("").toAbsolutePath().toFile()
        return cwd.resolve("../../../spec/test-vectors")
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
            "ProPhoto RGB" -> Gamut.PRO_PHOTO_RGB
            else -> Gamut.SRGB
        }

    @Test
    fun `spec vectors directory exists`() {
        val dir = specVectorsDir()
        assertTrue(dir.exists(), "spec vectors dir not found at ${dir.absolutePath}")
    }

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
            val tier = input.getInt("tier")
            val rgbaArr = input.getJSONArray("rgba")
            val rgba = ByteArray(rgbaArr.length()) { (rgbaArr.getInt(it) and 0xFF).toByte() }
            val expected = tc.getJSONObject("expected")
            val expectedHashArr = expected.getJSONArray("hash")
            val expectedHash =
                ByteArray(expectedHashArr.length()) { (expectedHashArr.getInt(it) and 0xFF).toByte() }

            ChromaHash.encodeWithQuality(width.toUInt(), height.toUInt(), rgba, gamut, tier.toUByte()).use { hash ->
                assertContentEquals(expectedHash, hash.asBytes(), "$name: hash mismatch")
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
    }

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

            ChromaHash.fromBytes(hashBytes).use { hash ->
                val result = hash.decode()
                assertEquals(expectedW, result.width, "$name: width")
                assertEquals(expectedH, result.height, "$name: height")
                assertEquals(expectedRgba.length(), result.rgba.size, "$name: rgba length")
                for (j in 0 until result.rgba.size) {
                    val got = result.rgba[j].toInt() and 0xFF
                    assertTrue(
                        abs(got - expectedRgba.getInt(j)) <= 1,
                        "$name: rgba[$j] expected ${expectedRgba.getInt(j)}, got $got",
                    )
                }
            }
        }
    }

    @Test
    fun `integration decode capped spec vectors`() {
        val arr = loadJsonArray("integration-decode-capped.json") ?: return
        for (i in 0 until arr.length()) {
            val tc = arr.getJSONObject(i)
            val name = tc.getString("name")
            val input = tc.getJSONObject("input")
            val hashArr = input.getJSONArray("hash")
            val hashBytes = ByteArray(hashArr.length()) { (hashArr.getInt(it) and 0xFF).toByte() }
            val maxW = input.getInt("max_width")
            val maxH = input.getInt("max_height")
            val expected = tc.getJSONObject("expected")
            val expectedW = expected.getInt("width")
            val expectedH = expected.getInt("height")
            val expectedRgba = expected.getJSONArray("rgba")

            ChromaHash.fromBytes(hashBytes).use { hash ->
                val result = hash.decodeCapped(maxW.toUInt(), maxH.toUInt())
                assertEquals(expectedW, result.width, "$name: width")
                assertEquals(expectedH, result.height, "$name: height")
                assertEquals(expectedRgba.length(), result.rgba.size, "$name: rgba length")
                for (j in 0 until result.rgba.size) {
                    val got = result.rgba[j].toInt() and 0xFF
                    assertTrue(
                        abs(got - expectedRgba.getInt(j)) <= 1,
                        "$name: rgba[$j] expected ${expectedRgba.getInt(j)}, got $got",
                    )
                }
            }
        }
    }

    @Test
    fun `fromBytes rejects wrong length`() {
        assertFailsWith<Exception> { ChromaHash.fromBytes(ByteArray(16)) }
        assertFailsWith<Exception> { ChromaHash.fromBytes(ByteArray(64)) }
    }

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
        ChromaHash.encode(4u, 4u, rgba, Gamut.SRGB).use { hash ->
            val result = hash.decode()
            assertTrue(result.width in 1..32)
            assertTrue(result.height in 1..32)
            assertEquals(result.width * result.height * 4, result.rgba.size)
        }
    }
}
