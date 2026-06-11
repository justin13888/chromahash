# chromahash-c

The **C ABI** for ChromaHash: a hand-written `extern "C"` surface over the
zero-dependency [`chromahash`](../../rust) core, with a `cbindgen`-generated
header. This is the first-class C API and the FFI foundation the C# (P/Invoke)
and Go (cgo) bindings link against.

## Layout

```
bindings/c/
  src/lib.rs              # the extern "C" surface
  cbindgen.toml           # header generation config
  build.rs                # runs cbindgen on every build → include/chromahash.h
  include/chromahash.h    # GENERATED, committed; CI diffs it to catch drift
  examples/roundtrip.c    # smoke test proving the header compiles + cdylib links
  tests/spec_vectors.rs   # parity gate: spec vectors driven through the C ABI
```

## Build

```sh
just build-c     # builds libchromahash_c.{a,dylib,so} + regenerates the header
just test-c      # spec-vector parity gate + compile/link/run the C example
just gen-c-header
```

The library is emitted under `bindings/c/target/<profile>/`:
- `libchromahash_c.a` — static library (Go links this via cgo)
- `libchromahash_c.{dylib,so,dll}` — shared library (C consumers and the C#
  P/Invoke layer load this)

## Using it from C

```c
#include "chromahash.h"

uint8_t rgba[/* width*height*4 */];
ChromaHash *h = NULL;
if (chromahash_encode(width, height, rgba, sizeof(rgba),
                      CHROMA_HASH_GAMUT_SRGB, &h) == CHROMA_HASH_STATUS_OK) {
    ChromaHashImage img;
    chromahash_decode(h, &img);     /* library-owned buffer */
    /* … use img.rgba (img.width*img.height*4 bytes) … */
    chromahash_image_free(&img);
    chromahash_free(h);
}
```

### Conventions
- Fallible functions return a `ChromaHashStatus` (`CHROMA_HASH_STATUS_OK == 0`);
  results are written through out-parameters.
- `ChromaHash` / `ChromaHashBatchEncoder` are opaque handles — create with a
  constructor, release with the matching `*_free`.
- A decoded `ChromaHashImage` is owned by the library — release it with
  `chromahash_image_free`. Input RGBA buffers are read-only and caller-owned.
- Panics in the core are caught at the boundary and reported as
  `CHROMA_HASH_STATUS_INTERNAL` (never unwound across FFI).

Output is byte-identical to every other ChromaHash implementation — the parity
gate (`tests/spec_vectors.rs`) drives the shared `spec/test-vectors/` through this
ABI on every CI run.
