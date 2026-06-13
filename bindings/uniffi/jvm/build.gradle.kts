import com.vanniktech.maven.publish.JavadocJar
import com.vanniktech.maven.publish.KotlinJvm
import java.io.File

plugins {
    kotlin("jvm") version "2.2.20"
    // `encode-stdin` CLI for the cross-language comparison harness + benchmarks.
    application
    // Lints/formats the hand-written Kotlin (CLI + tests); generated bindings excluded.
    id("org.jlleitschuh.gradle.ktlint") version "12.1.2"
    // Publishes the desktop/server JAR to Maven Central + GitHub Packages.
    id("com.vanniktech.maven.publish") version "0.36.0"
}

// Maven coordinate group (GitHub-verified Sonatype Central namespace), shared
// with the Android AAR. INDEPENDENT of the generated package `io.chromahash.ffi`.
group = "io.github.justin13888"
version = "0.6.0" // tracks the chromahash core crate version

repositories {
    mavenCentral()
}

dependencies {
    // UniFFI's generated Kotlin calls into the native lib via JNA at runtime.
    // The plain (non-@aar) artifact ships JNA's desktop/server native libs.
    implementation("net.java.dev.jna:jna:5.14.0")
    testImplementation(kotlin("test"))
    testImplementation("org.json:json:20240303")
}

kotlin {
    jvmToolchain(21)
}

ktlint {
    // The UniFFI-generated bindings live under build/generated — never lint them.
    filter {
        exclude { it.file.path.contains("/build/") }
    }
}

application {
    mainClass.set("io.chromahash.jvm.EncodeStdinKt")
}

// ─── Native build pipeline ────────────────────────────────────────────────────
// The chromahash-uniffi crate lives one directory up. Every step runs with the
// crate dir as the working directory so `cargo metadata` (used by uniffi-bindgen)
// can locate Cargo.toml — there is no Cargo workspace at the repo root.

val crateDir: File = projectDir.parentFile

private val osName = System.getProperty("os.name").lowercase()
private val osArch = System.getProperty("os.arch").lowercase()

/** Host cdylib filename produced by `cargo build`. */
private val hostLib: String =
    when {
        osName.contains("mac") || osName.contains("darwin") -> "libchromahash_uniffi.dylib"
        osName.contains("win") -> "chromahash_uniffi.dll"
        else -> "libchromahash_uniffi.so"
    }

/**
 * JNA's bundled-resource directory (`<os>-<arch>`). Staging the native lib here
 * lets the JAR ship it so consumers need nothing on `jna.library.path`.
 */
private val jnaPrefix: String =
    run {
        val os =
            when {
                osName.contains("mac") || osName.contains("darwin") -> "darwin"
                osName.contains("win") -> "win32"
                else -> "linux"
            }
        val arch =
            when {
                osArch == "aarch64" || osArch == "arm64" -> "aarch64"
                osArch == "x86_64" || osArch == "amd64" -> "x86-64"
                else -> osArch
            }
        "$os-$arch"
    }

private val releaseDir: File = crateDir.resolve("target/release")
private val hostLibFile: File = releaseDir.resolve(hostLib)
private val generatedBindings: File = layout.buildDirectory.dir("generated/uniffi").get().asFile
private val generatedResources: File = layout.buildDirectory.dir("generated/jna-resources").get().asFile

// Build the host cdylib (lib + cdylib + bindgen bin). cargo is incremental, so
// this is cheap when nothing changed; Exec tasks always run (no up-to-date check).
val cargoBuildHost by tasks.registering(Exec::class) {
    group = "build"
    description = "Build the host cdylib for chromahash-uniffi."
    workingDir = crateDir
    commandLine("cargo", "build", "--release")
}

// Generate the Kotlin bindings from the compiled cdylib's embedded metadata.
val generateUniffiBindings by tasks.registering(Exec::class) {
    group = "build"
    description = "Generate Kotlin bindings from the host cdylib via uniffi-bindgen."
    dependsOn(cargoBuildHost)
    workingDir = crateDir
    doFirst { generatedBindings.mkdirs() }
    commandLine(
        "cargo", "run", "--bin", "uniffi-bindgen", "--",
        "generate", "target/release/$hostLib",
        "--language", "kotlin",
        "--out-dir", generatedBindings.absolutePath,
        "--config", "uniffi.toml",
        "--no-format",
    )
}

// Stage the host cdylib into JNA's bundled-resource layout for packaging.
val stageNativeLib by tasks.registering(Copy::class) {
    group = "build"
    description = "Stage the host cdylib into JNA's <os>-<arch> resource layout."
    dependsOn(cargoBuildHost)
    from(hostLibFile)
    into(File(generatedResources, jnaPrefix))
}

sourceSets {
    main {
        kotlin.srcDir(generatedBindings)
        resources.srcDir(generatedResources)
    }
}

tasks.named("compileKotlin") { dependsOn(generateUniffiBindings) }
tasks.named("processResources") { dependsOn(stageNativeLib) }

tasks.test {
    useJUnitPlatform()
    // Belt-and-suspenders alongside the bundled resource: expose the freshly
    // built lib on the JNA search path so the test never depends on packaging.
    systemProperty("jna.library.path", releaseDir.absolutePath)
    testLogging {
        events("passed", "skipped", "failed")
        showExceptions = true
        showStackTraces = true
    }
}

tasks.named<JavaExec>("run") {
    standardInput = System.`in`
}

tasks.register<JavaExec>("bench") {
    group = "verification"
    description = "Run the batch-encode throughput benchmark."
    mainClass.set("io.chromahash.jvm.BatchBenchKt")
    classpath = sourceSets["main"].runtimeClasspath
}

// ─── Publishing ─────────────────────────────────────────────────────────────
// Desktop/server companion to the Android AAR (issue #38). Coordinate
// io.github.justin13888:chromahash-jvm:<version>. See RELEASING.md.
mavenPublishing {
    publishToMavenCentral()
    signAllPublications()

    coordinates("io.github.justin13888", "chromahash-jvm", version.toString())

    // Empty javadoc jar (Central requires one; generated bindings have no
    // meaningful javadoc). Sources jar is produced by default.
    configure(KotlinJvm(javadocJar = JavadocJar.Empty()))

    pom {
        name.set("ChromaHash for the JVM")
        description.set(
            "Desktop/server JVM binding for ChromaHash: the zero-dependency Rust core exposed to " +
                "Kotlin/Java over JNA via UniFFI, packaged as a JAR with bundled host native libraries.",
        )
        inceptionYear.set("2026")
        url.set("https://github.com/justin13888/chromahash")
        licenses {
            license {
                name.set("MIT License")
                url.set("https://github.com/justin13888/chromahash/blob/master/LICENSE-MIT")
                distribution.set("repo")
            }
            license {
                name.set("The Apache License, Version 2.0")
                url.set("https://github.com/justin13888/chromahash/blob/master/LICENSE-APACHE")
                distribution.set("repo")
            }
        }
        developers {
            developer {
                id.set("justin13888")
                name.set("Justin Chung")
                email.set("noreply@justinchung.net")
                url.set("https://github.com/justin13888")
            }
        }
        scm {
            url.set("https://github.com/justin13888/chromahash")
            connection.set("scm:git:git://github.com/justin13888/chromahash.git")
            developerConnection.set("scm:git:ssh://git@github.com/justin13888/chromahash.git")
        }
    }
}

// GitHub Packages as a secondary target (CI sets GITHUB_ACTOR/GITHUB_TOKEN;
// locally set gpr.user/gpr.key). vanniktech owns the publications + signing.
publishing {
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
