/*
 * Smoke test for the ChromaHash C API: proves the generated header compiles and
 * the cdylib links + runs. Encodes a solid color, inspects/decodes it, round-trips
 * the raw bytes, and frees everything. Exits non-zero on any failure.
 *
 * Build (from repo root, after `cargo build --manifest-path bindings/c/Cargo.toml`):
 *   cc bindings/c/examples/roundtrip.c -I bindings/c/include \
 *      -L bindings/c/target/debug -lchromahash_c -o /tmp/roundtrip
 *   DYLD_LIBRARY_PATH=bindings/c/target/debug /tmp/roundtrip   # (LD_LIBRARY_PATH on Linux)
 */
#include "chromahash.h"

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#define W 4u
#define H 4u

int main(void) {
    uint8_t rgba[W * H * 4];
    for (unsigned i = 0; i < W * H; i++) {
        rgba[i * 4 + 0] = 200;
        rgba[i * 4 + 1] = 100;
        rgba[i * 4 + 2] = 50;
        rgba[i * 4 + 3] = 255;
    }

    ChromaHash *hash = NULL;
    if (chromahash_encode(W, H, rgba, sizeof(rgba), CHROMA_HASH_GAMUT_SRGB, &hash) !=
            CHROMA_HASH_STATUS_OK ||
        hash == NULL) {
        fprintf(stderr, "encode failed\n");
        return 1;
    }

    size_t nbytes = chromahash_byte_len(hash);
    uint8_t *bytes = (uint8_t *)malloc(nbytes);
    if (bytes == NULL || chromahash_as_bytes(hash, bytes, nbytes) != CHROMA_HASH_STATUS_OK) {
        fprintf(stderr, "as_bytes failed\n");
        free(bytes);
        return 1;
    }
    printf("hash is %zu bytes; hash[0..4] = %02x %02x %02x %02x\n", nbytes, bytes[0], bytes[1],
           bytes[2], bytes[3]);

    ChromaHashColor avg;
    if (chromahash_average_color(hash, &avg) != CHROMA_HASH_STATUS_OK) {
        fprintf(stderr, "average_color failed\n");
        return 1;
    }
    printf("avg = %u %u %u %u\n", avg.r, avg.g, avg.b, avg.a);

    ChromaHashImage img;
    if (chromahash_decode(hash, &img) != CHROMA_HASH_STATUS_OK) {
        fprintf(stderr, "decode failed\n");
        return 1;
    }
    printf("decoded %ux%u (%zu bytes)\n", img.width, img.height, img.rgba_len);
    if (img.rgba_len != (size_t)img.width * img.height * 4u) {
        fprintf(stderr, "decoded length mismatch\n");
        return 1;
    }

    ChromaHash *hash2 = NULL;
    if (chromahash_from_bytes(bytes, nbytes, &hash2) != CHROMA_HASH_STATUS_OK || hash2 == NULL) {
        fprintf(stderr, "from_bytes failed\n");
        free(bytes);
        return 1;
    }
    free(bytes);

    chromahash_image_free(&img);
    chromahash_free(hash);
    chromahash_free(hash2);

    printf("chromahash %s: roundtrip OK\n", chromahash_version());
    return 0;
}
