# Release procedure

This file describes the GitHub Actions workflows in `.github/workflows/` and
the exact steps to cut a release. Pair it with `SECURITY_RELEASE.md` for the
key-handling rules.

## Workflows at a glance

| File | Trigger | Purpose | Produces |
|---|---|---|---|
| `_checks.yml` | `workflow_call` (reusable) | Typecheck, build, tests, clippy strict | Status only |
| `_build.yml` | `workflow_call` (reusable) | Build the Tauri matrix (macOS arm64 + Windows x64) | Bundles, either as workflow artifacts (release=false) or attached to a GitHub Release (release=true) |
| `ci.yml` | push to `main`, PR targeting `main` | Run `_checks.yml`. On push to `main` only, also run `_build.yml` (release=false) | PR: status only. Push to main: status + workflow artifacts (`roundlab-macos-arm64`, `roundlab-windows-x64`), 30-day retention |
| `version-bump.yml` | `workflow_dispatch` | Patch version everywhere, commit, tag, push | A new commit + tag on `main` |
| `release.yml` | push of `v*.*.*` tag (or `workflow_dispatch`) | Run `_checks.yml`, verify the tag matches the manifests, then `_build.yml` (release=true) | Public **GitHub Release** with `.dmg`, `.exe`, `latest.json`, and `.sig` signatures if configured |
| `triage-windows.yml` | `workflow_dispatch` | One-off Windows-only build off any branch (thin wrapper around `_build.yml` with `only-windows: true`) | Workflow artifact (`roundlab-windows-x64`), 30-day retention |

## CI artifacts vs GitHub Release — which one do I want?

Both contain the same kind of file (a `.dmg`, an installer `.exe`). The
difference is **how they get to users** and **whether the in-app updater
treats them as updates**.

|  | CI artifact (push to `main`) | GitHub Release (tag push) |
|---|---|---|
| Created automatically? | Yes, on every push to `main` | Only when a `v*.*.*` tag is pushed |
| Where to find it | Actions tab → run page → Artifacts section | Releases tab on the repo |
| Visible to non-collaborators | No (requires repo access) | Yes (public download URL) |
| Retention | 30 days, then deleted | Forever, unless you delete it |
| Visible to the in-app Tauri updater | No (no `latest.json`) | Yes — clients call `latest.json` to discover updates |
| Has signed `latest.json` for the updater | No | Yes (when secrets configured) |
| Triggers the user's "update available" prompt | No | Yes |
| Use case | Smoke-test a build of `main` on Windows / macOS without polluting the public release feed | Ship to end users |

**Rule of thumb**: if you would be embarrassed for a stranger to install
this build, it's a CI artifact. If users should see "update available", it's
a Release.

## Secrets required on the repo

Set these in **Settings → Secrets and variables → Actions**:

| Secret | Used by | Required? | Effect if missing |
|---|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `_build.yml` | Strongly recommended for releases; optional for CI/triage | Installers build, but `latest.json` has no `.sig` → in-app updater rejects every "update" |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | same | Required iff the key is password-protected | Build fails if the key has a password and this is missing |
| `GITHUB_TOKEN` | All | Auto-provided | n/a |

No Apple / Microsoft code-signing secrets are wired up. Installer EXEs and
DMGs will trigger SmartScreen / Gatekeeper warnings on first launch.

## How to cut a real release

1. **Run `version-bump`** from the Actions tab (or via `gh`):
   ```bash
   gh workflow run version-bump.yml -f bump=patch
   # or, for an explicit version:
   gh workflow run version-bump.yml -f version=0.2.0
   ```
   The workflow:
   - reads the current version from `tauri.conf.json`,
   - validates the new one (refuses no-op, refuses downgrade, refuses an
     existing tag),
   - patches `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`,
     `desktop/src-tauri/Cargo.toml`,
   - regenerates `desktop/src-tauri/Cargo.lock` (via `cargo update -p roundlab`),
   - commits as `chore: bump version to vX.Y.Z`,
   - creates and pushes the annotated tag `vX.Y.Z`.

2. **Wait for `release` to run** on the new tag (`gh run watch`). The
   pipeline:
   - `checks`           — full matrix (frontend build, go vet/test, cargo
                          test+clippy strict on both Rust crates);
   - `verify-version`   — refuses to build if any manifest disagrees with
                          the tag;
   - `build`            — calls `_build.yml` with `release=true`. tauri-action
                          publishes bundles to a Release named `RoundLab vX.Y.Z`.

3. **The release is published on success**. If `checks` or `verify-version`
   fails, no Release is created. Fix the bug, run `version-bump` with the
   next version, and try again. (Don't reuse a failed version number.)

### Manual tagging escape hatch

If you absolutely need to tag manually (don't, unless you have to):

```bash
# 1. patch the four files yourself, EXACTLY like version-bump would
# 2. commit
# 3. tag and push
git tag -a v0.2.0 -m "RoundLab v0.2.0"
git push origin main
git push origin v0.2.0
```

`release.yml`'s `verify-version` will block the build if you forgot any
manifest.

## How to get a build without releasing

Two paths, pick the one that matches your situation:

- **Just merged something into `main`** → CI already produced the bundles
  for you. Go to the Actions tab → latest `ci` run on `main` → Artifacts
  section. Or via CLI:
  ```bash
  gh run download <run-id> -n roundlab-windows-x64
  gh run download <run-id> -n roundlab-macos-arm64
  ```

- **You need a build off a non-main branch** (e.g. an experimental fix
  for the 95/99% wedge) → run `triage-windows`:
  ```bash
  gh workflow run triage-windows.yml --ref my-branch
  gh run watch
  gh run download <run-id> -n roundlab-windows-x64
  ```

Neither path creates a GitHub Release. Neither path triggers the in-app
updater.

## Don't

- Don't push `v*.*.*` tags by hand unless you've patched all manifests.
  `verify-version` will block the build if not.
- Don't reuse a tag that already shipped (delete + repush ≠ a clean
  release; clients caching `latest.json` will see two binaries claiming
  the same version).
- Don't enable lint in CI yet: there are 4 preexisting `no-explicit-any`
  errors in `desktop/src/components/DebugConsole.tsx` and
  `desktop/src/lib/api.ts`. Fix those first, then re-add `pnpm lint` to
  `_checks.yml` → `frontend` job.
- Don't expect the in-app updater to pick up CI artifacts. They are
  intentionally invisible to it.

## Branch protection (recommended, manual setup)

In **Settings → Branches → main → Branch protection rules**, require:
- Required status checks: `checks / frontend`, `checks / go`,
  `checks / rust-tauri`, `checks / rust-fallback` (the names come from
  `_checks.yml`'s jobs invoked by `ci.yml`; they appear once a PR has
  run CI at least once).
- "Require branches to be up to date before merging".

PRs only run `checks`, not `_build.yml`, so merging stays fast.
