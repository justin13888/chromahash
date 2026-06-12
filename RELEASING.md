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
   [Unreleased]: https://github.com/justin13888/chromahash/compare/vX.Y.Z...HEAD
   [X.Y.Z]: https://github.com/justin13888/chromahash/compare/v<prev>...vX.Y.Z
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

Pushing the `vX.Y.Z` tag is all that's needed — CI publishes automatically, and
each workflow is idempotent (a version already on the registry is skipped, so
re-pushing a tag is safe):

- [`release-rust`](.github/workflows/release-rust.yml) → the
  [`chromahash`](https://crates.io/crates/chromahash) crate on crates.io.
- [`release-android`](.github/workflows/release-android.yml) → the
  `io.github.justin13888:chromahash-jvm` and `chromahash-android` artifacts on
  Maven Central.

The one-time account/key bootstrap (crates.io trusted publishing; Sonatype
namespace + GPG signing key) is already done for this repo. If it ever needs
redoing, the steps live in those workflow files and the `just android-*` recipes.
