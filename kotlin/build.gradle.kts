plugins {
    kotlin("jvm") version "2.1.20"
    id("org.jlleitschuh.gradle.ktlint") version "12.1.2"
    application
}

group = "io.chromahash"
version = "0.3.0"

application {
    mainClass.set("chromahash.EncodeStdinKt")
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}

tasks.named<JavaExec>("run") {
    standardInput = System.`in`
}

kotlin {
    jvmToolchain(21)
}
