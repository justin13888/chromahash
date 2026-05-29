import java.io.File

plugins {
    // AGP 9.0+ has built-in Kotlin support, so the Kotlin Android plugin is NOT
    // applied separately. `src/main/kotlin` is a default source dir, which is
    // where uniffi-bindgen writes the generated ChromaHash bindings.
    id("com.android.library") version "9.1.1"
    `maven-publish`
}

group = "io.chromahash"
version = "0.5.0" // tracks the chromahash core crate version

android {
    namespace = "io.chromahash.ffi"
    compileSdk = 36

    defaultConfig {
        minSdk = 21
    }

    // Expose a single publishable "release" component (the AAR) to maven-publish.
    publishing {
        singleVariant("release")
    }
}

dependencies {
    // UniFFI's generated Kotlin uses JNA to call into the .so at runtime.
    // The `@aar` artifact bundles JNA's own native libraries for Android.
    implementation("net.java.dev.jna:jna:5.14.0@aar")
}

// ─── Native build pipeline ────────────────────────────────────────────────────
// The chromahash-uniffi crate lives one directory up. Both steps run with the
// crate dir as the working directory so `cargo metadata` (used by uniffi-bindgen)
// can locate Cargo.toml — there is no Cargo workspace at the repo root.

val crateDir: File = projectDir.parentFile
val abis = listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")

/** Locate an Android NDK, preferring an explicit env var over the SDK's newest NDK. */
fun resolveNdkHome(): String =
    System.getenv("ANDROID_NDK_HOME")
        ?: System.getenv("ANDROID_NDK_LATEST_HOME")
        ?: System.getenv("ANDROID_HOME")?.let { sdk ->
            File(sdk, "ndk").takeIf { it.isDirectory }
                ?.listFiles { f -> f.isDirectory }
                ?.maxByOrNull { it.name }
                ?.absolutePath
        }
        ?: error(
            "Android NDK not found. Set ANDROID_NDK_HOME (or ANDROID_NDK_LATEST_HOME), " +
                "or install one via Android Studio → SDK Manager → SDK Tools → NDK.",
        )

// Cross-compile the cdylib into android/src/main/jniLibs/<abi>/ for every ABI.
val cargoNdkBuild by tasks.registering(Exec::class) {
    group = "build"
    description = "Cross-compile chromahash-uniffi for all Android ABIs via cargo-ndk."
    workingDir = crateDir
    // workingDir is the crate root, so cargo locates Cargo.toml without --manifest-path.
    val cmd = mutableListOf("cargo", "ndk")
    abis.forEach { cmd += listOf("-t", it) }
    cmd += listOf("-o", "android/src/main/jniLibs", "build", "--release")
    commandLine(cmd)
    // Resolve the NDK lazily so configuring the project doesn't require one.
    doFirst { environment("ANDROID_NDK_HOME", resolveNdkHome()) }
}

// Generate the Kotlin bindings from the compiled cdylib's embedded metadata.
val generateUniffiBindings by tasks.registering(Exec::class) {
    group = "build"
    description = "Generate Kotlin bindings from the compiled cdylib via uniffi-bindgen."
    dependsOn(cargoNdkBuild)
    workingDir = crateDir
    commandLine(
        "cargo", "run", "--bin", "uniffi-bindgen", "--",
        "generate", "android/src/main/jniLibs/arm64-v8a/libchromahash_uniffi.so",
        "--language", "kotlin",
        "--out-dir", "android/src/main/kotlin",
        "--config", "uniffi.toml",
        "--no-format",
    )
}

// Regenerate the .so + Kotlin before every build.
tasks.named("preBuild") {
    dependsOn(generateUniffiBindings)
}

// ─── Publishing ───────────────────────────────────────────────────────────────
// `./gradlew publishToMavenLocal` works out of the box. CI publishes to GitHub
// Packages with GITHUB_ACTOR/GITHUB_TOKEN; locally you can set gpr.user/gpr.key.
// Longer-term distribution (e.g. Maven Central) is tracked in the project issues.
publishing {
    publications {
        register<MavenPublication>("release") {
            groupId = project.group.toString()
            artifactId = "chromahash-android"
            version = project.version.toString()
            afterEvaluate { from(components["release"]) }
        }
    }
    repositories {
        maven {
            name = "GitHubPackages"
            url = uri("https://maven.pkg.github.com/justin13888/chromahash")
            credentials {
                username = System.getenv("GITHUB_ACTOR") ?: (findProperty("gpr.user") as String?)
                password = System.getenv("GITHUB_TOKEN") ?: (findProperty("gpr.key") as String?)
            }
        }
    }
}
