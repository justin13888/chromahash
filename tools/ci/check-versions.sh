#!/usr/bin/env bash
# Every publishable manifest must carry the same version as the core crate.
#
# Each release-*.yml refuses to publish when the pushed tag disagrees with its
# own manifest, so a single stale manifest does not fail loudly at release time
# — it fails *that one pipeline*, silently leaving one registry a version
# behind while the others go out. That happened between 0.6.0 and 0.7.0: the
# core crate was bumped and eight manifests were not, which would have failed
# five of the eight publish workflows on the v0.7.0 tag.
#
# `just check-versions`, and the versions job of ci-versions.yml.
set -euo pipefail

cd "$(dirname "$0")/../.."

fail=0
expected="$(grep -m1 '^version = ' rust/Cargo.toml | cut -d'"' -f2)"
echo "core crate (rust/Cargo.toml): $expected"

check() {
    local file="$1" found="$2"
    if [ -z "$found" ]; then
        echo "  MISSING  $file — could not read a version" >&2
        fail=1
    elif [ "$found" != "$expected" ]; then
        echo "  MISMATCH $file: $found (expected $expected)" >&2
        fail=1
    else
        echo "  ok       $file"
    fi
}

for f in bindings/c/Cargo.toml bindings/uniffi/Cargo.toml bindings/wasm/Cargo.toml; do
    check "$f" "$(grep -m1 '^version = ' "$f" | cut -d'"' -f2)"
done
check python/pyproject.toml \
    "$(grep -m1 '^version = ' python/pyproject.toml | cut -d'"' -f2)"
for f in typescript/package.json tools/comparison/package.json; do
    check "$f" "$(grep -m1 '"version":' "$f" | cut -d'"' -f4)"
done
check csharp/src/Chromahash/Chromahash.csproj \
    "$(grep -m1 '<Version>' csharp/src/Chromahash/Chromahash.csproj |
        sed -e 's/.*<Version>//' -e 's|</Version>.*||')"
for f in bindings/uniffi/jvm/build.gradle.kts bindings/uniffi/android/build.gradle.kts; do
    check "$f" "$(grep -m1 '^version = ' "$f" | cut -d'"' -f2)"
done

if [ "$fail" -ne 0 ]; then
    echo >&2
    echo "Release workflows verify the pushed tag against each manifest, so a" >&2
    echo "mismatch here means that registry silently misses the release." >&2
    echo "See RELEASING.md step 2." >&2
    exit 1
fi
echo "All manifests agree on $expected."
