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

Most publishing uses OIDC **trusted publishing** — no stored tokens — but each
registry needs a one-time policy before its first run succeeds. State below as
probed on 2026-08-28; ✅ means a release has actually landed there.

| Registry | Published | Bootstrap still needed |
|---|---|---|
| crates.io | ✅ 0.6.0 | — |
| PyPI | ✅ 0.6.0 | — |
| NuGet | ✅ 0.6.0 | — |
| Go proxy | ✅ v0.6.0 | — |
| Maven Central | ✅ 0.6.0, but under `io.github.justin13888` | **`io.github.visualcommons` namespace verification** |
| npm | ❌ 404 | **`@chromahash` scope + trusted publisher** |
| Swift Package Index | — (tag-based) | submit the repo once |

**Two blockers before `v0.7.0` publishes everywhere.** Both need the maintainer's
registry accounts; neither can be done from the repo:

1. **npm.** `@chromahash/typescript` has never published — run 28472417808 failed
   with `E404 … PUT`, i.e. the `@chromahash` scope does not exist on npmjs.com.
   Create the scope, then add a trusted publisher for
   `@chromahash/typescript` → repo `visualcommons/chromahash`, workflow
   `release-npm.yml`. A scoped package may need one manual
   `npm publish --access public` to claim the name first.
2. **Sonatype.** The `justin13888` → `visualcommons` migration changed the Maven
   `groupId` to `io.github.visualcommons`, which is **not yet a verified
   namespace** — `repo1.maven.org/maven2/io/github/visualcommons/…` 404s today,
   while the 0.6.0 artifacts sit under `io.github.justin13888`. Verify the new
   namespace at central.sonatype.com before tagging, or both JVM publishes fail.
   Note this also orphans the published `io.github.justin13888` 0.6.0 artifacts:
   consumers must change their coordinates, which is a release-note item.

The rest:

- **PyPI** — *pending publisher* for project `chromahash` → repo + workflow
  `release-pypi.yml`. Already live.
- **NuGet** — trusted-publishing policy for `ChromaHash` → repo + workflow
  `release-nuget.yml`, with the `NUGET_USER` secret set to the owning account.
  Already live.
- **JVM/Android** — GPG signing plus `MAVEN_CENTRAL_USERNAME`/`PASSWORD`
  (see the `just android-*` recipes), on top of the namespace above.
- **Swift Package Index** — submit the repo once at
  `swiftpackageindex.com/add-a-package`. Also ensure no tag-protection rule blocks
  the workflow's `GITHUB_TOKEN` from moving the `vX.Y.Z` tag.

`just check-versions` (and the `versions` job in `ci-repo.yml` / `ci-tools.yml`)
asserts every publishable manifest carries the core crate's version. Each
`release-*.yml` verifies the pushed tag against *its own* manifest, so without
that check a single stale file fails one pipeline quietly and leaves one registry
a version behind while the others publish.
