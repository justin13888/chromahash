package chromahash

import kotlin.test.Test
import kotlin.test.assertNotNull

class ChromaHashTest {
    @Test
    fun `it creates an instance`() {
        val instance = ChromaHash()
        assertNotNull(instance)
    }
}
