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
  [`@visualcommons/chromahash`](https://www.npmjs.com/package/@visualcommons/chromahash)
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
probed on 2026-08-29; ✅ means a release has actually landed there.

| Registry | Published | Bootstrap still needed |
|---|---|---|
| crates.io | ✅ 0.6.0 | — |
| PyPI | ✅ 0.6.0 | — |
| NuGet | ✅ 0.6.0 | — |
| Go proxy | ✅ v0.6.0 | — |
| Maven Central | ✅ 0.6.0, under the old `io.github.justin13888` | namespace verified 2026-08-28; first publish under `io.github.visualcommons` is 0.7.1 |
| npm | ⚠️ 0.7.0 — name claimed, tarball broken (no `wasm/`) | **add the trusted publisher, and deprecate 0.7.0** |
| Swift Package Index | — (tag-based) | submit the repo once |

**One blocker before `v0.7.1` publishes everywhere**, and it needs the
maintainer's npm account — it cannot be done from the repo:

**npm.** The name is claimed but the published artifact is unusable. Run
28472417808 first failed with `E404 … PUT` against the then-current name
`@chromahash/typescript`, whose scope did not exist; it was renamed to
`@visualcommons/chromahash`, matching the GitHub org and the
`io.github.visualcommons` Maven group. The manual claim publish on 2026-08-29
then hit the `.gitignore` trap below: **0.7.0 is on npm with no `wasm/`
directory**, and since `dist/index.js` re-exports from `../wasm/chromahash_wasm.js`,
every import from it fails. npm forbids republishing a version, so 0.7.0 is spent
— hence 0.7.1.

Two account actions, both on npmjs.com — **no second manual publish is needed**:

1. Add the trusted publisher on the package's settings page: repo
   `visualcommons/chromahash`, workflow `release-npm.yml`, no environment. This
   is what the claim publish was for; the package now exists, so the policy will
   attach. From 0.7.1 on, CI publishes over OIDC with provenance and no stored
   token — and its "Drop wasm-pack's .gitignore" step avoids the trap that broke
   the manual publish.
2. Deprecate the broken version so consumers are steered off it:

   ```bash
   npm deprecate @visualcommons/chromahash@0.7.0 \
     "Published without the wasm/ runtime and is unusable; use 0.7.1 or later."
   ```

Do **not** `npm unpublish` it: 0.7.0 is the package's only version, so
unpublishing removes the package and npm blocks re-registering the name for 24
hours, stalling the release a full day.

> **The trap, for any future manual publish.** `wasm-pack` writes a `.gitignore`
> containing `*` into its out-dir, and npm's packlist honours nested `.gitignore`
> files. Without removing it, `npm pack` silently drops the entire `wasm/` runtime
> — the tarball builds, publishes, and is unusable — even though `wasm` is in the
> package.json `files` list. It costs a version number, as 0.7.0 shows. A manual
> publish must therefore run:
>
> ```bash
> just ts-cbuild                     # wasm-pack → typescript/wasm/, as the workflow does
> rm -f typescript/wasm/.gitignore   # NOT optional
> just build-ts
> cd typescript
> npm pack --dry-run | grep -c wasm/ # MUST be non-zero before you publish
> npm login                          # interactive; OIDC is unavailable outside CI
> npm publish --access public        # no --provenance: that needs a CI OIDC token
> ```
>
> Publishing manually before tagging is safe either way: `release-npm.yml`'s "Skip
> if version already on npm" step makes the tag push a no-op for npm rather than a
> failure.

**Sonatype** (resolved). The `justin13888` → `visualcommons` migration changed
the Maven `groupId` to `io.github.visualcommons`; that namespace was verified at
central.sonatype.com on 2026-08-28. `repo1.maven.org/maven2/io/github/visualcommons/`
still 404s and will until the first artifact lands — verification does not create
the path. This does orphan the published `io.github.justin13888` 0.6.0 artifacts:
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
