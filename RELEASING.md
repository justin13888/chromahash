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
`rust`, `ts`, `kotlin`, `swift`, `go`, `py`, `csharp`, `android`, `spec`, `tools`,
`comparison`.

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
   | `typescript/package.json` | `"version": "X.Y.Z"` |
   | `kotlin/build.gradle.kts` | `version = "X.Y.Z"` |
   | `python/pyproject.toml` | `version = "X.Y.Z"` |
   | `csharp/src/Chromahash/Chromahash.csproj` | `<Version>X.Y.Z</Version>` |
   | `bindings/android/Cargo.toml` | `version = "X.Y.Z"` |
   | `bindings/android/android/build.gradle.kts` | `version = "X.Y.Z"` |
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
