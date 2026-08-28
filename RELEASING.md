# Releasing ChromaHash

All implementations share a single version, released from `master`. The
[`CHANGELOG.md`](CHANGELOG.md) `[Unreleased]` section is **generated from
conventional commits** by [git-cliff](https://git-cliff.org/) — never hand-edit
it (except to add `Removed` entries, which have no conventional-commit type). It
lives between two sentinels:

```markdown
<!-- git-cliff-unreleased-start -->
## [Unreleased]
...generated...
<!-- git-cliff-unreleased-end -->
```

Refresh it at any time (idempotent):

```bash
just changelog
```

## Cutting a release

1. **Refresh the changelog** and add any `Removed` entries by hand:

   ```bash
   just changelog
   ```

2. **Cut the version section.** Turns `[Unreleased]` into `[X.Y.Z] - <date>` and
   re-seeds an empty `[Unreleased]`:

   ```bash
   just release X.Y.Z
   ```

3. **Update the link references** at the bottom of `CHANGELOG.md`:

   ```markdown
   [Unreleased]: https://github.com/visualcommons/chromahash/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/visualcommons/chromahash/compare/v<prev>...vX.Y.Z
   ```

4. **Bump the version** to `X.Y.Z` in every manifest (Go and Swift are versioned
   by the git tag only):

   | File |
   | ---- |
   | `rust/Cargo.toml` |
   | `bindings/c/Cargo.toml` |
   | `bindings/wasm/Cargo.toml` |
   | `bindings/uniffi/Cargo.toml` |
   | `bindings/uniffi/jvm/build.gradle.kts` |
   | `bindings/uniffi/android/build.gradle.kts` |
   | `typescript/package.json` |
   | `python/pyproject.toml` |
   | `csharp/src/Chromahash/Chromahash.csproj` |
   | `tools/benchmark/pyproject.toml` |
   | `tools/comparison/package.json` |

5. **Commit, tag, and push:**

   ```bash
   git commit -am "chore: release vX.Y.Z"
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push && git push --tags
   ```

## Publishing

Pushing the `vX.Y.Z` tag is all that's needed — CI fans out to one publish
workflow per registry, and each is idempotent (a version already on the registry
is skipped, so re-pushing a tag is safe):

- [`release-rust`](.github/workflows/release-rust.yml) →
  [`chromahash`](https://crates.io/crates/chromahash) on crates.io.
- [`release-npm`](.github/workflows/release-npm.yml) →
  [`@chromahash/typescript`](https://www.npmjs.com/package/@chromahash/typescript)
  on npm (with provenance).
- [`release-pypi`](.github/workflows/release-pypi.yml) →
  [`chromahash`](https://pypi.org/project/chromahash/) on PyPI (one wheel per
  platform; no sdist, as the package has no buildable source dist).
- [`release-nuget`](.github/workflows/release-nuget.yml) →
  [`ChromaHash`](https://www.nuget.org/packages/ChromaHash) on NuGet (multi-RID
  native assets bundled under `runtimes/<rid>/native`).
- [`release-jvm`](.github/workflows/release-jvm.yml) →
  `io.github.visualcommons:chromahash-jvm` on Maven Central + GitHub Packages
  (cross-platform fat JAR carrying every platform's JNA-loaded native lib).
- [`release-android`](.github/workflows/release-android.yml) →
  `io.github.visualcommons:chromahash-android` (the AAR **only**) on Maven Central +
  GitHub Packages.
- [`release-go`](.github/workflows/release-go.yml) → indexes
  `github.com/visualcommons/chromahash/go` on pkg.go.dev. The module is a cgo wrapper,
  so this builds the prebuilt static libs and commits them onto a **`go/vX.Y.Z`**
  subdirectory tag (the binaries live only on that tag, never on `master`) that
  `go get .../go@vX.Y.Z` resolves. You don't create the `go/` tag by hand.
- [`release-swift`](.github/workflows/release-swift.yml) → makes the package
  resolvable on the [Swift Package Index](https://swiftpackageindex.com/visualcommons/chromahash).
  It builds the multi-platform xcframework, attaches it to the GitHub release, pins
  `Package.swift`'s `url`+`checksum`, and **moves the `vX.Y.Z` tag** onto that
  commit (which re-triggers the other workflows — they all skip, being idempotent).

Go and Swift carry no version manifest (the tag is the version); every other
workflow first verifies the pushed tag matches its package manifest.

### One-time registry bootstrap

JVM/Android reuse the already-bootstrapped Sonatype namespace + GPG signing
secrets (`MAVEN_CENTRAL_USERNAME/PASSWORD`, `SIGNING_KEY/PASSWORD`; see the
`just android-*` recipes). The others use OIDC **trusted publishing** — no stored
tokens — but each needs a one-time policy configured on the registry before its
first run succeeds:

- **crates.io** — already bootstrapped.
- **npm** — add a trusted publisher for `@chromahash/typescript` pointing at repo
  `visualcommons/chromahash`, workflow `release-npm.yml`. A scoped package may need a
  single manual `npm publish --access public` to claim the name first.
- **PyPI** — add a *pending publisher* for project `chromahash` → repo + workflow
  `release-pypi.yml`.
- **NuGet** — add a trusted-publishing policy for `ChromaHash` → repo + workflow
  `release-nuget.yml`, and set the `NUGET_USER` secret to the owning account. May
  need a manual first push to claim the id.
- **Swift Package Index** — submit the repo once at
  `swiftpackageindex.com/add-a-package`. Also ensure no tag-protection rule blocks
  the workflow's `GITHUB_TOKEN` from moving the `vX.Y.Z` tag.
