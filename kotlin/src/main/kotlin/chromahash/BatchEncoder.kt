package chromahash

import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** One image to encode in a batch. */
class ImageInput(
    val w: Int,
    val h: Int,
    val rgba: ByteArray,
    val gamut: Gamut,
)

/**
 * Stateful, self-parallelizing batch encoder backed by an owned thread pool.
 *
 * Construct one, reuse it across many [encodeBatch] calls, then release it with
 * [close]. It is [AutoCloseable], so `BatchEncoder().use { ... }` works. Output
 * is byte-identical to calling [ChromaHash.encode] on each image individually.
 */
class BatchEncoder(
    threads: Int = Runtime.getRuntime().availableProcessors(),
) : AutoCloseable {
    private val pool = Executors.newFixedThreadPool(maxOf(1, threads))

    /**
     * Encode every item, returning hashes in the same order as [items].
     *
     * All items are validated up front, before any work is dispatched, so an
     * invalid item throws on the calling thread (identifying its index) rather
     * than failing a worker mid-flight. Validation matches [ChromaHash.encode].
     */
    fun encodeBatch(items: List<ImageInput>): List<ChromaHash> {
        items.forEachIndexed { i, it ->
            require(it.w >= 1) { "item $i: width must be >= 1" }
            require(it.h >= 1) { "item $i: height must be >= 1" }
            require(it.rgba.size == it.w * it.h * 4) { "item $i: rgba length mismatch" }
        }
        if (items.isEmpty()) return emptyList()

        val futures =
            items.map { item ->
                pool.submit<ChromaHash> {
                    ChromaHash.encode(item.w, item.h, item.rgba, item.gamut)
                }
            }
        return futures.map { it.get() }
    }

    override fun close() {
        pool.shutdown()
        pool.awaitTermination(Long.MAX_VALUE, TimeUnit.NANOSECONDS)
    }
}
