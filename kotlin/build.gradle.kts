plugins {
    kotlin("jvm") version "2.1.20"
    id("org.jlleitschuh.gradle.ktlint") version "12.1.2"
    application
}

group = "io.chromahash"
version = "0.4.0"

application {
    mainClass.set("chromahash.EncodeStdinKt")
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(kotlin("test"))
    testImplementation("org.json:json:20240303")
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = false
        showExceptions = true
        showStackTraces = true
    }
}

tasks.named<JavaExec>("run") {
    standardInput = System.`in`
}

tasks.register<JavaExec>("bench") {
    group = "verification"
    description = "Run the batch-encode throughput benchmark"
    mainClass.set("chromahash.BatchBenchKt")
    classpath = sourceSets["main"].runtimeClasspath
}

kotlin {
    jvmToolchain(21)
}
