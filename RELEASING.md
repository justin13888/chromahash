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
mise run changelog
```

## Cutting a release

1. **Refresh the changelog** and add any `Removed` entries by hand:

   ```bash
   mise run changelog
   ```

2. **Cut the version section.** Turns `[Unreleased]` into `[X.Y.Z] - <date>` and
   re-seeds an empty `[Unreleased]`:

   ```bash
   mise run release X.Y.Z
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
| crates.io | ✅ 0.7.1 | — (re-pointed 2026-08-29) |
| PyPI | ✅ 0.7.1 | — (re-pointed 2026-08-29) |
| NuGet | ✅ 0.7.1 | — (re-pointed 2026-08-29) |
| Go proxy | ✅ v0.7.1 | — |
| Maven Central | ✅ 0.7.1 under `io.github.visualcommons` | — |
| npm | ✅ 0.7.1 (0.7.0 broken — no `wasm/`) | **deprecate 0.7.0** |
| Swift Package Index | ✅ v0.7.1 release + xcframework | submit the repo once |

> **Renaming the GitHub org invalidates every trusted-publishing policy.** A
> policy is keyed on the repository's `owner/name`, so `justin13888` →
> `visualcommons` silently voided the crates.io, PyPI and NuGet configs that the
> table above had recorded as "already live". Nothing warns you: each workflow
> builds fine and fails at its *auth* step, so nothing half-publishes — but the
> v0.7.1 tag went out with three of eight registries dead. Re-pointing all three
> and re-running the failed workflows (`gh run rerun <id>` — no re-tag needed,
> they are idempotent) published them. On the next org or repo rename, re-point
> all four policies (npm included) *before* tagging.

**npm** (resolved, with one artifact left behind). Run
28472417808 first failed with `E404 … PUT` against the then-current name
`@chromahash/typescript`, whose scope did not exist; it was renamed to
`@visualcommons/chromahash`, matching the GitHub org and the
`io.github.visualcommons` Maven group. The manual claim publish on 2026-08-29
then hit the `.gitignore` trap below: **0.7.0 is on npm with no `wasm/`
directory**, and since `dist/index.js` re-exports from `../wasm/chromahash_wasm.js`,
every import from it fails. npm forbids republishing a version, so 0.7.0 is spent
— hence 0.7.1.

The trusted publisher was added on 2026-08-29 (repo `visualcommons/chromahash`,
workflow `release-npm.yml`, no environment), and `v0.7.1` published over OIDC with
provenance — no second manual publish was needed, and the workflow's "Drop
wasm-pack's .gitignore" step shipped the runtime the manual publish had dropped
(88 KB tarball, 8 `wasm/` entries). One account action remains: deprecate the
broken version so consumers are steered off it.

```bash
npm deprecate @visualcommons/chromahash@0.7.0 \
  "Published without the wasm/ runtime and is unusable; use 0.7.1 or later."
```

Deprecate rather than `npm unpublish`. Had it been unpublished before 0.7.1
existed it would have taken the whole package with it — npm then blocks
re-registering the name for 24 hours — and an unpublished version can never be
republished either way, so removal buys nothing a deprecation notice does not.

> **The trap, for any future manual publish.** `wasm-pack` writes a `.gitignore`
> containing `*` into its out-dir, and npm's packlist honours nested `.gitignore`
> files. Without removing it, `npm pack` silently drops the entire `wasm/` runtime
> — the tarball builds, publishes, and is unusable — even though `wasm` is in the
> package.json `files` list. It costs a version number, as 0.7.0 shows. A manual
> publish must therefore run:
>
> ```bash
> mise run cbuild:ts                     # wasm-pack → typescript/wasm/, as the workflow does
> rm -f typescript/wasm/.gitignore   # NOT optional
> mise run build:ts
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
central.sonatype.com on 2026-08-28; `v0.7.1` is the first release under it. Both
workflows run `publishAndReleaseToMavenCentral`, which auto-releases on the Portal
— no manual "Publish" click — but `repo1.maven.org` lags the Portal by up to ~30
minutes, so a 404 right after a green run is expected. This does orphan the published `io.github.justin13888` 0.6.0 artifacts:
consumers must change their coordinates, which is a release-note item.

The rest:

- **crates.io** — Trusted Publishing config for crate `chromahash` → repo
  `visualcommons/chromahash` + workflow `release-rust.yml`. Re-pointed 2026-08-29;
  the first v0.7.1 run had failed with `No Trusted Publishing config found for
  repository visualcommons/chromahash` because the config still named the old repo.
- **PyPI** — *pending publisher* for project `chromahash` → repo + workflow
  `release-pypi.yml`. Re-pointed 2026-08-29; the first v0.7.1 run had failed with
  `invalid-publisher: valid token, but no corresponding publisher`, same reason.
- **NuGet** — trusted-publishing policy for `ChromaHash` → repo + workflow
  `release-nuget.yml`, with the `NUGET_USER` secret set to the owning account.
  Re-pointed 2026-08-29; the first v0.7.1 run had failed with HTTP 401
  `No matching trust policy owned by user …`;
  note the error's own hint — the secret must be the policy *creator*, not the
  policy owner.
- **JVM/Android** — GPG signing plus `MAVEN_CENTRAL_USERNAME`/`PASSWORD`
  (see the `android:*` tasks), on top of the namespace above.
- **Swift Package Index** — submit the repo once at
  `swiftpackageindex.com/add-a-package`. Also ensure no tag-protection rule blocks
  the workflow's `GITHUB_TOKEN` from moving the `vX.Y.Z` tag.

`mise run check:versions` (and the `versions` job in `ci-repo.yml` / `ci-tools.yml`)
asserts every publishable manifest carries the core crate's version. Each
`release-*.yml` verifies the pushed tag against *its own* manifest, so without
that check a single stale file fails one pipeline quietly and leaves one registry
a version behind while the others publish.
