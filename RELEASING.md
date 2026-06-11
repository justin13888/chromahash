# Releasing ChromaHash

All implementations share a single version. Releases are cut from `master` using
[git-cliff](https://git-cliff.org/) to manage the [`CHANGELOG.md`](CHANGELOG.md).

The `[Unreleased]` section of the changelog lives between two sentinels and is
**generated from conventional commits** — never hand-edit it (except to add
`Removed` entries, which have no conventional commit type):

```markdown
<!-- git-cliff-unreleased-start -->
## [Unreleased]
...generated...
<!-- git-cliff-unreleased-end -->
```

## Commit messages

Commits must be [conventional commits](https://www.conventionalcommits.org/):
`type(scope): description`. This is enforced locally by the `commit-msg` lefthook
hook and in CI by the `ci-commits` workflow (both use [convco](https://convco.github.io/)).

Types that appear in the changelog: `feat` → **Added**, `perf`/`refactor` →
**Changed**, `fix` → **Fixed**, `docs` → **Documentation**. `chore`, `ci`, `build`,
`test`, and `style` are intentionally excluded. Scopes are language/area names:
`rust`, `c`, `ts`, `wasm`, `jvm`, `swift`, `go`, `py`, `csharp`, `android`, `uniffi`,
`spec`, `tools`, `comparison`.

## Keeping the changelog current

At any time, refresh the `[Unreleased]` section from the commits since the last
tag:

```bash
just changelog
```

This is idempotent — re-running produces the same result. Review the output and
manually add any `Removed` entries.

## Cutting a release

1. **Refresh and review** the unreleased entries:

   ```bash
   just changelog
   ```

   Add any `Removed` entries by hand.

2. **Cut the version section.** This turns `[Unreleased]` into `[X.Y.Z] - <date>`,
   re-seeds an empty `[Unreleased]`, and prints the remaining manual steps:

   ```bash
   just release X.Y.Z
   ```

3. **Update the link references** at the bottom of `CHANGELOG.md`:

   ```markdown
   [Unreleased]: https://github.com/justin13888/chromahash/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/justin13888/chromahash/compare/v<prev>...vX.Y.Z
   ```

4. **Bump the version** to `X.Y.Z` across every implementation and tool:

   | File | |
   | ---- | --- |
   | `rust/Cargo.toml` | `version = "X.Y.Z"` |
   | `bindings/c/Cargo.toml` | `version = "X.Y.Z"` |
   | `bindings/wasm/Cargo.toml` | `version = "X.Y.Z"` |
   | `typescript/package.json` | `"version": "X.Y.Z"` |
   | `python/pyproject.toml` | `version = "X.Y.Z"` |
   | `csharp/src/Chromahash/Chromahash.csproj` | `<Version>X.Y.Z</Version>` |
   | `bindings/uniffi/Cargo.toml` | `version = "X.Y.Z"` |
   | `bindings/uniffi/jvm/build.gradle.kts` | `version = "X.Y.Z"` |
   | `bindings/uniffi/android/build.gradle.kts` | `version = "X.Y.Z"` |
   | `tools/benchmark/pyproject.toml` | `version = "X.Y.Z"` |
   | `tools/comparison/package.json` | `"version": "X.Y.Z"` |

   (Go and Swift are versioned via the git tag only.)

5. **Commit, tag, and push**:

   ```bash
   git commit -am "chore: release vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push && git push --tags
   ```

## Publishing the Rust crate

Pushing the `vX.Y.Z` tag triggers the [`release-rust`](.github/workflows/release-rust.yml)
workflow, which publishes the [`chromahash`](https://crates.io/crates/chromahash)
crate to crates.io via [trusted publishing](https://crates.io/docs/trusted-publishing)
(OIDC — no stored token). The workflow is idempotent: if the tagged version is
already on crates.io it is skipped, so re-pushing a tag is safe.

### One-time bootstrap

Trusted publishing cannot create a brand-new crate, so the **first** publish is
manual. On the first release, after bumping the version, publish locally from
`rust/`:

```bash
cargo publish --dry-run   # sanity-check packaging and metadata
cargo publish             # claims the `chromahash` name (uses your crates.io token)
```

Then, on crates.io → the `chromahash` crate → **Settings → Trusted Publishing**,
add a GitHub Actions publisher: repository `justin13888/chromahash`, workflow
`release-rust.yml`. Every subsequent `vX.Y.Z` tag then publishes automatically
with no token. (The bootstrap release's own tag is a no-op thanks to the
already-published skip check.)

The `chromahash-uniffi` binding crate stays `publish = false` and is never
published to crates.io.

## Publishing the Android AAR

The same `vX.Y.Z` tag triggers the [`release-android`](.github/workflows/release-android.yml)
workflow, which builds the AAR (cross-compiling the binding crate for every ABI) and publishes
it to **two** channels:

- **Maven Central** (Sonatype Central Portal) — the public, auth-free channel apps consume.
- **GitHub Packages** — a secondary mirror tied to this repo (consumers need a PAT to read it).

The coordinate is `io.github.justin13888:chromahash-android:X.Y.Z`. The `io.github.justin13888`
namespace is GitHub-verified on Sonatype Central (no domain needed); the Kotlin package stays
`io.chromahash.ffi` and is independent of the Maven group. Publishing uses the
[vanniktech maven-publish](https://vanniktech.github.io/gradle-maven-publish-plugin/) plugin
(see `bindings/uniffi/android/build.gradle.kts`).

The workflow is idempotent against Maven Central: a version already on `repo1.maven.org` is
skipped, so re-pushing a tag is safe. **Caveat:** Central propagation to `repo1`/search lags the
Portal by up to ~30 minutes, so a re-push within that window may re-attempt (Central rejects
duplicate coordinates — it fails safe, just noisily). The skip is keyed on Central, so if Central
succeeds but the GitHub Packages mirror fails, a re-push skips both — acceptable for a mirror.

### One-time bootstrap

Maven Central needs a verified namespace and a GPG signing key. Do this once (the `just` recipes
automate everything except the two browser steps):

1. **Claim the namespace.** Sign in to <https://central.sonatype.com/> with GitHub, then
   **Namespaces → Add Namespace → `io.github.justin13888`**. Because it matches the GitHub
   account it is auto-verified.
2. **Generate a Portal token.** Central Portal → **Account → Generate User Token**. Keep the
   username + password halves — they become the `MAVEN_CENTRAL_USERNAME` / `MAVEN_CENTRAL_PASSWORD`
   secrets.
3. **Generate the signing key and push all four secrets:**

   ```bash
   just android-gen-signing-key   # GPG keygen, export signing-key.asc, upload the public key
   just android-set-secrets       # prompts for the Portal token, sets all 4 GitHub secrets via gh
   rm signing-key.asc signing-password.txt   # delete the local key material (or keep in a vault)
   ```

   `gpg` is the only external tool required (one-time key generation); `cargo-ndk` and `gh` are
   mise-managed. The generated `signing-key.asc` / `signing-password.txt` are gitignored.
4. **First publish (staged).** For the very first release, stage it so you can inspect it in the
   Portal before releasing, instead of relying on the workflow's auto-release:

   ```bash
   cd bindings/uniffi/android
   ORG_GRADLE_PROJECT_mavenCentralUsername=<tokenUser> \
   ORG_GRADLE_PROJECT_mavenCentralPassword=<tokenPass> \
   ORG_GRADLE_PROJECT_signingInMemoryKey="$(cat ../../../signing-key.asc)" \
   ORG_GRADLE_PROJECT_signingInMemoryKeyPassword="$(cat ../../../signing-password.txt)" \
   mise exec java@21 gradle@9.4.0 -- ./gradlew publishToMavenCentral --no-configuration-cache
   ```

   Then on <https://central.sonatype.com/publishing/deployments> review the deployment and click
   **Publish**. After this first green release, every subsequent `vX.Y.Z` tag publishes and
   auto-releases via the workflow with no manual step.

GitHub Packages needs no bootstrap — CI's built-in `GITHUB_TOKEN` authenticates it.
