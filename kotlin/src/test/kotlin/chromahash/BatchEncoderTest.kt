package chromahash

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class BatchEncoderTest {
    private fun solidImage(
        w: Int,
        h: Int,
        r: Int,
        g: Int,
        b: Int,
        a: Int,
    ): ByteArray {
        val rgba = ByteArray(w * h * 4)
        for (i in 0 until w * h) {
            rgba[i * 4] = r.toByte()
            rgba[i * 4 + 1] = g.toByte()
            rgba[i * 4 + 2] = b.toByte()
            rgba[i * 4 + 3] = a.toByte()
        }
        return rgba
    }

    private fun horizontalGradient(
        w: Int,
        h: Int,
    ): ByteArray {
        val rgba = ByteArray(w * h * 4)
        for (y in 0 until h) {
            for (x in 0 until w) {
                val t = x.toDouble() / maxOf(w - 1, 1)
                val idx = (y * w + x) * 4
                rgba[idx] = (t * 255).toInt().toByte()
                rgba[idx + 1] = ((1.0 - t) * 255).toInt().toByte()
                rgba[idx + 2] = 128.toByte()
                rgba[idx + 3] = 255.toByte()
            }
        }
        return rgba
    }

    /** A spread of dimensions, gamuts, and alpha, mirroring the bulk-migration use case. */
    private fun mixedItems(): List<ImageInput> =
        listOf(
            ImageInput(4, 4, solidImage(4, 4, 200, 100, 50, 255), Gamut.SRGB),
            ImageInput(8, 4, horizontalGradient(8, 4), Gamut.DISPLAY_P3),
            ImageInput(4, 8, solidImage(4, 8, 30, 200, 120, 128), Gamut.ADOBE_RGB),
            ImageInput(16, 16, horizontalGradient(16, 16), Gamut.BT2020),
            ImageInput(1, 1, solidImage(1, 1, 255, 0, 0, 255), Gamut.PROPHOTO_RGB),
        )

    private fun encodeSerial(items: List<ImageInput>): List<ChromaHash> = items.map { ChromaHash.encode(it.w, it.h, it.rgba, it.gamut) }

    @Test
    fun `batch matches serial`() {
        val items = mixedItems()
        BatchEncoder().use { enc ->
            val batch = enc.encodeBatch(items)
            val serial = encodeSerial(items)
            assertEquals(serial.size, batch.size)
            for (i in items.indices) {
                assertEquals(serial[i], batch[i], "item $i differs")
            }
        }
    }

    @Test
    fun `batch preserves order`() {
        // Many same-shape items to exercise out-of-order completion.
        val items =
            (0 until 64).map { i ->
                ImageInput(8, 8, solidImage(8, 8, i, 255 - i, i * 3, 255), Gamut.SRGB)
            }
        BatchEncoder(4).use { enc ->
            val batch = enc.encodeBatch(items)
            val serial = encodeSerial(items)
            for (i in items.indices) {
                assertEquals(serial[i], batch[i], "item $i out of order")
            }
        }
    }

    @Test
    fun `empty batch returns empty`() {
        BatchEncoder().use { enc ->
            assertTrue(enc.encodeBatch(emptyList()).isEmpty())
        }
    }

    @Test
    fun `reusable across batches`() {
        val items = mixedItems()
        BatchEncoder().use { enc ->
            val first = enc.encodeBatch(items)
            val second = enc.encodeBatch(items)
            for (i in items.indices) {
                assertEquals(first[i], second[i])
            }
        }
    }
}
