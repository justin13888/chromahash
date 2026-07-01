/*
 * encode_stdin — stdin/stdout CLI for the cross-language comparison harness,
 * mirroring the other languages' `encode-stdin`. Exercises the C ABI end to end.
 *
 *   encode_stdin encode <width> <height> <gamut>   # rgba on stdin -> hash bytes
 *   encode_stdin decode                            # hash bytes on stdin -> rgba
 *   encode_stdin average-color                     # hash bytes on stdin -> 4 bytes
 *
 * <gamut> is one of: srgb displayp3 adobergb bt2020 prophoto
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "chromahash.h"

static int parse_gamut(const char *s, ChromaHashGamut *out) {
    if (strcmp(s, "srgb") == 0) {
        *out = CHROMA_HASH_GAMUT_SRGB;
    } else if (strcmp(s, "displayp3") == 0) {
        *out = CHROMA_HASH_GAMUT_DISPLAY_P3;
    } else if (strcmp(s, "adobergb") == 0) {
        *out = CHROMA_HASH_GAMUT_ADOBE_RGB;
    } else if (strcmp(s, "bt2020") == 0) {
        *out = CHROMA_HASH_GAMUT_BT2020;
    } else if (strcmp(s, "prophoto") == 0) {
        *out = CHROMA_HASH_GAMUT_PRO_PHOTO_RGB;
    } else {
        return -1;
    }
    return 0;
}

/* Read all of stdin into a freshly malloc'd buffer; returns byte count or -1. */
static long read_all(uint8_t **out) {
    size_t cap = 1 << 16;
    size_t len = 0;
    uint8_t *buf = (uint8_t *)malloc(cap);
    if (!buf) {
        return -1;
    }
    for (;;) {
        if (len == cap) {
            cap *= 2;
            uint8_t *bigger = (uint8_t *)realloc(buf, cap);
            if (!bigger) {
                free(buf);
                return -1;
            }
            buf = bigger;
        }
        size_t n = fread(buf + len, 1, cap - len, stdin);
        len += n;
        if (n == 0) {
            break;
        }
    }
    *out = buf;
    return (long)len;
}

static int cmd_encode(int argc, char **argv) {
    if (argc != 5) {
        fprintf(stderr, "Usage: encode_stdin encode <width> <height> <gamut>\n");
        return 1;
    }
    uint32_t w = (uint32_t)strtoul(argv[2], NULL, 10);
    uint32_t h = (uint32_t)strtoul(argv[3], NULL, 10);
    ChromaHashGamut gamut;
    if (parse_gamut(argv[4], &gamut) != 0) {
        fprintf(stderr, "unknown gamut: %s\n", argv[4]);
        return 1;
    }

    uint8_t *rgba = NULL;
    long len = read_all(&rgba);
    size_t expected = (size_t)w * (size_t)h * 4;
    if (len < 0 || (size_t)len != expected) {
        fprintf(stderr, "expected %zu bytes, got %ld\n", expected, len);
        free(rgba);
        return 1;
    }

    ChromaHash *hash = NULL;
    if (chromahash_encode(w, h, rgba, (size_t)len, gamut, &hash) != CHROMA_HASH_STATUS_OK) {
        fprintf(stderr, "encode failed\n");
        free(rgba);
        return 1;
    }
    free(rgba);

    size_t out_len = chromahash_byte_len(hash);
    uint8_t *out = (uint8_t *)malloc(out_len);
    if (out == NULL) {
        chromahash_free(hash);
        fprintf(stderr, "out of memory\n");
        return 1;
    }
    int rc = chromahash_as_bytes(hash, out, out_len);
    chromahash_free(hash);
    if (rc != CHROMA_HASH_STATUS_OK) {
        free(out);
        fprintf(stderr, "as_bytes failed\n");
        return 1;
    }
    fwrite(out, 1, out_len, stdout);
    free(out);
    return 0;
}

static int cmd_decode(void) {
    uint8_t *bytes = NULL;
    long n = read_all(&bytes);
    if (n < 0) {
        fprintf(stderr, "failed to read hash\n");
        free(bytes);
        return 1;
    }
    ChromaHash *hash = NULL;
    if (chromahash_from_bytes(bytes, (size_t)n, &hash) != CHROMA_HASH_STATUS_OK) {
        fprintf(stderr, "from_bytes failed\n");
        free(bytes);
        return 1;
    }
    free(bytes);
    ChromaHashImage image;
    int rc = chromahash_decode(hash, &image);
    chromahash_free(hash);
    if (rc != CHROMA_HASH_STATUS_OK) {
        fprintf(stderr, "decode failed\n");
        return 1;
    }
    fwrite(image.rgba, 1, image.rgba_len, stdout);
    chromahash_image_free(&image);
    return 0;
}

static int cmd_average_color(void) {
    uint8_t *bytes = NULL;
    long n = read_all(&bytes);
    if (n < 0) {
        fprintf(stderr, "failed to read hash\n");
        free(bytes);
        return 1;
    }
    ChromaHash *hash = NULL;
    if (chromahash_from_bytes(bytes, (size_t)n, &hash) != CHROMA_HASH_STATUS_OK) {
        fprintf(stderr, "from_bytes failed\n");
        free(bytes);
        return 1;
    }
    free(bytes);
    ChromaHashColor color;
    int rc = chromahash_average_color(hash, &color);
    chromahash_free(hash);
    if (rc != CHROMA_HASH_STATUS_OK) {
        fprintf(stderr, "average_color failed\n");
        return 1;
    }
    uint8_t out[4] = {color.r, color.g, color.b, color.a};
    fwrite(out, 1, sizeof out, stdout);
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr,
                "Usage:\n"
                "  encode_stdin encode <width> <height> <gamut>\n"
                "  encode_stdin decode\n"
                "  encode_stdin average-color\n");
        return 1;
    }
    if (strcmp(argv[1], "encode") == 0) {
        return cmd_encode(argc, argv);
    }
    if (strcmp(argv[1], "decode") == 0) {
        return cmd_decode();
    }
    if (strcmp(argv[1], "average-color") == 0) {
        return cmd_average_color();
    }
    fprintf(stderr, "unknown subcommand: %s\n", argv[1]);
    return 1;
}
