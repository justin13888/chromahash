# chromahash-jvm

The **desktop/server JVM** binding for ChromaHash: the zero-dependency Rust core
exposed to Kotlin/Java over [JNA](https://github.com/java-native-access/jna) via
[UniFFI](https://mozilla.github.io/uniffi-rs/), packaged as a JAR with the host
native library bundled. Output is byte-identical to every other ChromaHash
implementation.

It shares the `chromahash-uniffi` crate (one directory up) and the generated
`io.chromahash.ffi` API with the **Android** AAR (`../android`). Two artifacts,
one binding:

| Target | Artifact | Module |
|---|---|---|
| Desktop / server (Linux, macOS, Windows) | `io.github.visualcommons:chromahash-jvm` (JAR) | `bindings/uniffi/jvm` |
| Android | `io.github.visualcommons:chromahash-android` (AAR) | `bindings/uniffi/android` |

Both are "the Java library" and expose the same Kotlin/Java API — pick the JAR
for JVM apps and the AAR for Android.

## Build pipeline

`./gradlew build` runs, in order:

1. `cargoBuildHost` — `cargo build --release` produces the host `cdylib`.
2. `generateUniffiBindings` — `uniffi-bindgen` emits the Kotlin bindings into
   `build/generated/uniffi` (package `io.chromahash.ffi`).
3. `stageNativeLib` — copies the `cdylib` into JNA's `<os>-<arch>` resource
   layout (`build/generated/jna-resources`) so the JAR ships it; consumers need
   nothing on `jna.library.path`.

The generated bindings and staged lib are build outputs under `build/` — never
committed. The published JAR currently bundles only the **build host's** native
library; the cross-platform native matrix is wired up at release time.

## Usage

```sh
mise run test:jvm      # spec-vector parity gate through the binding (builds the host lib)
mise run build:jvm     # assemble the JAR
mise run benchmark:batch:jvm
```

```kotlin
import io.chromahash.ffi.ChromaHash
import io.chromahash.ffi.Gamut

val hash = ChromaHash.encode(width.toUInt(), height.toUInt(), rgba, Gamut.SRGB)
val bytes = hash.asBytes()                       // ByteArray(32)
val (w, h, pixels) = ChromaHash.fromBytes(bytes).decode()
```
