# Decoding ChromaHash on Android (Rust core via JNI)

ChromaHash ships an Android binding under [`bindings/uniffi/`](../bindings/uniffi/): the
dependency-free **Rust** core called natively across the JNI boundary and packaged as an AAR,
rather than the pure-JVM Kotlin implementation. This guide explains the design and how to build,
test, and consume it; [`bindings/uniffi/README.md`](../bindings/uniffi/README.md) is the
hands-on reference for the build/publish commands.

## 1. Why not just use the Kotlin implementation?

The Kotlin implementation ([`kotlin/`](../kotlin/)) is correct, spec-compatible, and the most
ergonomic choice if you only decode a handful of placeholders. But it is pure-JVM **scalar** code:
decoding runs a per-pixel inverse DCT, a per-channel gamut clip, and an OKLab→sRGB conversion
entirely on the JVM heap, with no SIMD. The JVM has no portable SIMD story, so the planned SIMD work
([#3](https://github.com/visualcommons/chromahash/issues/3)) only targets Rust, Swift, and C#.

On the client, **decode is the hot path** — encoding is normally done server-side, and an app
decodes placeholders at render time, often many per screen. The Rust core
([`rust/`](../rust/), crate `chromahash` v0.6.0, **zero dependencies**) is portable, compiles
natively for Android's ARM64 devices, and is the implementation that will gain SIMD. Bridging it to
Kotlin/Java over JNI gives Android the fast decoder while keeping a Kotlin-shaped API.

The binding uses **[UniFFI](https://mozilla.github.io/uniffi-rs/)** (Mozilla) for the binding layer.
It auto-generates idiomatic Kotlin from the Rust crate — minimal boilerplate, proven in Firefox for
Android. Because decode is a one-shot call returning a small buffer (≤ 32×32 RGBA), per-call FFI
overhead is irrelevant. A lower-level `jni`-crate alternative is covered in
[§11](#11-alternative-hand-written-jni-rs).

## 2. Architecture

The core crate stays untouched and zero-dependency. A **separate** binding crate depends on it and
carries the UniFFI dependency:

```
chromahash (rust/)                       # core, zero deps — unchanged
        ▲
        │ path dependency
        │
chromahash-uniffi (bindings/uniffi/)    # crate-type = ["lib", "cdylib", "staticlib"]; depends on uniffi
        │
        │ cargo-ndk → one .so per Android ABI   +   uniffi-bindgen → io/chromahash/ffi/*.kt
        ▼
Android library module (bindings/uniffi/android/)   # AAR: jniLibs/<abi>/*.so + generated Kotlin + JNA
        ▼
Your Android app                         # io.chromahash.ffi.ChromaHash
```

The core crate's zero-dependency property (`rust/Cargo.toml`) is preserved — `uniffi` lives only in
the binding crate. The `lib` crate-type (beyond the doc-era `cdylib`/`staticlib`) lets the
spec-vector integration tests link the crate ([§9](#9-validate-correctness)).

## 3. The API ([`bindings/uniffi/src/lib.rs`](../bindings/uniffi/src/lib.rs))

UniFFI's **proc-macro (UDL-less)** mode is used: Rust is annotated directly, no `.udl` file. A
`ChromaHash` *object* mirrors the pure-Kotlin
[`ChromaHash`](../kotlin/src/main/kotlin/chromahash/ChromaHash.kt) class, plus the `Gamut` enum and
the `DecodeResult` / `RgbaColor` records. `uniffi.toml` sets the generated package to
`io.chromahash.ffi`, so it does not collide with the pure-Kotlin `chromahash` package.

Two deliberate differences from a naïve 1:1 mapping, both at the FFI boundary:

- **`fromBytes` is fallible.** It returns `Result<Arc<Self>, ChromaHashError>` in Rust →
  `@Throws(ChromaHashException::class)` in Kotlin, throwing `InvalidLength` if the input is not
  exactly 32 bytes. A panic across the FFI boundary is unsafe, so the binding validates instead.
- **Record integers are signed.** `DecodeResult.width/height` and `RgbaColor.r/g/b/a` are declared
  `i32` (→ Kotlin `Int`), matching the pure-Kotlin API and Android's `Bitmap`/ARGB call sites. Only
  *size parameters* (`encode`'s `w`/`h`, `decodeCapped`'s `maxW`/`maxH`) remain `u32` → Kotlin
  `UInt`. UniFFI maps `Vec<u8>` → `ByteArray` either way.

> **Pinned versions.** `uniffi = "0.31"` (the doc was originally drafted against 0.28; 0.31 is the
> edition-2024-clean line). The `Vec<u8>`→`ByteArray` and the signed-`i32` mappings above are
> verified against this release.

## 4. Build, test, and publish

All commands live in the root `justfile`; full details in
[`bindings/uniffi/README.md`](../bindings/uniffi/README.md).

**Host-only (no Android toolchain) — the enforced correctness gate:**

```bash
just test-android          # spec vectors through the binding (byte-exact)
just lint-android          # clippy -D warnings
just build-android-crate   # host build of the crate
```

**The AAR (requires the Android NDK + `cargo-ndk` + Rust Android targets):**

```bash
just build-android-aar     # cargo ndk (all ABIs) → uniffi-bindgen → gradle assembleRelease
```

`assembleRelease`'s `preBuild` depends on the `cargoNdkBuild` → `generateUniffiBindings` Gradle
tasks, so that single command cross-compiles `arm64-v8a`, `armeabi-v7a`, `x86_64`, `x86` into
`jniLibs/<abi>/libchromahash_uniffi.so`, regenerates the Kotlin, and produces
`android/build/outputs/aar/chromahash-android-release.aar`. Drop ABIs you don't ship to shrink the
AAR; `arm64-v8a` covers essentially all modern physical devices.

The generated Kotlin runtime depends on **JNA** (the Android `@aar` artifact,
`net.java.dev.jna:jna:5.14.0@aar`) and loads the `.so` itself — you don't call `System.loadLibrary`.
Publishing is wired via the [vanniktech maven-publish](https://vanniktech.github.io/gradle-maven-publish-plugin/)
plugin to **Maven Central** and **GitHub Packages** as `io.github.visualcommons:chromahash-android`
(plus `publishToMavenLocal` for local dev); a `vX.Y.Z` tag publishes both channels via the
[`release-android`](../.github/workflows/release-android.yml) workflow. See
[RELEASING.md](../RELEASING.md#publishing-the-android-aar) and the
[binding README](../bindings/uniffi/README.md#publish).

## 5. Use it from an app

```kotlin
import android.graphics.Bitmap
import io.chromahash.ffi.ChromaHash
import java.nio.ByteBuffer

/** Decode a 32-byte ChromaHash into a Bitmap for use as a placeholder. */
fun decodeToBitmap(hashBytes: ByteArray): Bitmap {
    val hash = ChromaHash.fromBytes(hashBytes)        // throws on non-32-byte input
    val result = hash.decode()
    val bitmap = Bitmap.createBitmap(result.width, result.height, Bitmap.Config.ARGB_8888)
    bitmap.copyPixelsFromBuffer(ByteBuffer.wrap(result.rgba))
    return bitmap
}
```

> **Pixel order.** Decode output is RGBA (bytes `R, G, B, A` per pixel). `Bitmap.Config.ARGB_8888`
> stores pixels in native memory as `R, G, B, A`, so `copyPixelsFromBuffer` consumes the decoded
> bytes directly. If your placeholders carry partial alpha, note that `ARGB_8888` Bitmaps are
> **premultiplied** by default — premultiply the RGBA yourself or call `bitmap.setPremultiplied`
> as appropriate. Verify on your target device.

For a solid-color placeholder you can skip the full decode and use the DC color only (fields are
`Int`, so no `.toInt()` is needed):

```kotlin
val c = ChromaHash.fromBytes(hashBytes).averageColor()
val argb = (c.a shl 24) or (c.r shl 16) or (c.g shl 8) or c.b
```

## 6. API parity

The native API mirrors the pure-Kotlin implementation 1:1, modulo the two FFI-boundary differences
in [§3](#3-the-api-bindingsandroidsrclibrs):

| Pure Kotlin (`chromahash`)             | Native (UniFFI, `io.chromahash.ffi`)      |
| -------------------------------------- | ----------------------------------------- |
| `ChromaHash.encode(w, h, rgba, gamut)` | `ChromaHash.encode(w, h, rgba, gamut)`    |
| `ChromaHash.fromBytes(bytes)`          | `ChromaHash.fromBytes(bytes)` — `@Throws` |
| `chromaHash.decode(): DecodeResult`    | `chromaHash.decode(): DecodeResult`       |
| `chromaHash.averageColor(): RgbaColor` | `chromaHash.averageColor(): RgbaColor`    |
| `chromaHash.hash: ByteArray`           | `chromaHash.asBytes(): ByteArray`         |
| —                                      | `chromaHash.decodeCapped(maxW, maxH)`     |
| `Gamut` enum                           | `Gamut` enum                              |

Swapping the import (`chromahash.ChromaHash` → `io.chromahash.ffi.ChromaHash`) and handling the
`fromBytes` exception is the bulk of the migration.

## 7. Validate correctness

The binding is bit-exact with every other implementation. The enforced gate is a Rust integration
test, [`bindings/uniffi/tests/spec_vectors.rs`](../bindings/uniffi/tests/spec_vectors.rs), which
runs the spec test vectors in [`spec/test-vectors/`](../spec/test-vectors/) through the **binding
wrappers** and asserts exact output — no NDK/SDK required, so it runs in `just test` (lefthook
pre-push) and the `ci-android` `check` job:

- `integration-encode.json` — encode pixels, compare the 32-byte hash (+ average color).
- `integration-decode.json` — decode a hash, compare RGBA byte-for-byte.

The contract is defined in the spec: binary format in [§3](../spec/README.md#3-binary-format),
decode algorithm in [§11](../spec/README.md#11-decoding-algorithm), average color in
[§11.2](../spec/README.md#112-average-color-extraction), decode output sizing in
[§8.2](../spec/README.md#82-decode-output-size). Because the binding just forwards to the core
crate, correctness reduces to the core crate's own test suite plus this marshalling check. An
optional host-JVM end-to-end check through the generated Kotlin is described in the
[binding README](../bindings/uniffi/README.md#optional-end-to-end-check-through-the-generated-kotlin).

## 8. Performance & trade-offs

**Use the native path when** you decode many placeholders or decode on the render hot path:

- One-shot decode amortizes JNI/UniFFI marshalling to noise; the work is the inner DCT + color-conversion
  loops, where native scalar already beats the JVM and avoids GC churn from per-pixel float math.
- ARM64 plus the upcoming SIMD work ([#3](https://github.com/visualcommons/chromahash/issues/3))
  widens the gap further.
- The `.so` is loaded once per process.

**Prefer the pure-Kotlin implementation when** decode volume is low and simplicity matters:

- No NDK toolchain, no native build step in CI.
- Smaller artifact — each shipped ABI adds a copy of the `.so`.
- Pure-JVM portability (any JVM target, not just Android ABIs).

## 9. CI

[`.github/workflows/ci-android.yml`](../.github/workflows/ci-android.yml) (triggered on
`bindings/uniffi/**`) has two jobs:

- **`check`** — `cargo fmt --check`, `clippy -D warnings`, and `cargo test` against the binding
  crate. No NDK; this is the required correctness gate.
- **`aar`** — installs the Rust Android targets + `cargo-ndk`, points at the runner's NDK
  (`ANDROID_NDK_LATEST_HOME`), and runs `gradle assembleRelease`, uploading the AAR artifact.

Releases are separate: pushing a `vX.Y.Z` tag triggers
[`.github/workflows/release-android.yml`](../.github/workflows/release-android.yml), which builds
the AAR the same way and publishes it to Maven Central + GitHub Packages (see
[RELEASING.md](../RELEASING.md#publishing-the-android-aar)).

## 10. Alternative: hand-written `jni-rs`

If you want zero codegen and no JNA runtime dependency, write the bridge by hand with the
[`jni`](https://docs.rs/jni) crate: `#[unsafe(no_mangle)] pub extern "system" fn Java_io_chromahash_ffi_ChromaHash_decode(...)`
functions that marshal `jbyteArray` ↔ `&[u8]` and call the core crate directly. This gives the
lowest possible call overhead and full control, at the cost of maintaining JNI signatures and
manual memory marshalling by hand. `cargo-ndk` ([§4](#4-build-test-and-publish)) is identical for
this path — only the binding layer and Kotlin `external fun` declarations differ. The crate already
builds a `staticlib` to support this.
