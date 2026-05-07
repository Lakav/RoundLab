# Release procedure

This file describes the four GitHub Actions workflows in `.github/workflows/`
and the exact steps to cut a release. Pair it with `SECURITY_RELEASE.md` for
the key-handling rules.

## Workflows at a glance

| File | Trigger | Purpose | Produces |
|---|---|---|---|
| `_checks.yml` | `workflow_call` (reusable, not invoked directly) | Typecheck, build, tests, clippy strict | Status only |
| `ci.yml` | push to `main`, PR targeting `main` | Gate every change through `_checks.yml` | Status only |
| `version-bump.yml` | `workflow_dispatch` (manual) | Patch version in 4 manifests, commit, tag, push | A new commit + tag on `main` |
| `release.yml` | push of `v*.*.*` tag, or `workflow_dispatch` | Run checks, verify version alignment, build macOS+Windows installers, publish a GitHub release | Public release with `.dmg`, `.exe`, `latest.json`, signatures if configured |
| `triage-windows.yml` | `workflow_dispatch` (manual) | Build a one-off Windows installer for QA without releasing | Workflow artifact (14-day retention) |

## Secrets required on the repo

Set these in **Settings → Secrets and variables → Actions**:

| Secret | Required by | Required? | Effect if missing |
|---|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `release.yml`, `triage-windows.yml` | Strongly recommended | Installers build, but `latest.json` has no signature → in-app updater rejects every "update" |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | same | Same as above | Required iff the key is password-protected |
| `GITHUB_TOKEN` | All | Auto-provided | n/a |

No Apple/Microsoft code-signing secrets are wired up. Installer EXEs and
DMGs will trigger SmartScreen / Gatekeeper warnings on first launch; this
is acknowledged in the README and in the release notes template.

## How to release

The supported, low-risk path:

1. **Run `version-bump`** from the Actions tab (or via `gh`):
   ```bash
   gh workflow run version-bump.yml -f bump=patch
   # or to set an explicit version:
   gh workflow run version-bump.yml -f version=0.2.0
   ```
   The workflow:
   - reads the current version from `tauri.conf.json`,
   - computes / validates the new one (refuses no-op, refuses downgrade,
     refuses an existing tag),
   - patches `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`,
     `desktop/src-tauri/Cargo.toml`,
   - regenerates `desktop/src-tauri/Cargo.lock` (via `cargo update -p roundlab`),
   - commits as `chore: bump version to vX.Y.Z`,
   - creates and pushes the annotated tag `vX.Y.Z`.

2. **Wait for `release` to run** on the new tag:
   ```bash
   gh run watch
   ```
   Pipeline order:
   - `checks` (frontend build, go test/vet, cargo test+clippy on tauri,
     cargo test+clippy on parser-fallback);
   - `verify-version` (refuses to build if any manifest disagrees with the
     tag — protects against manual tags that skipped `version-bump`);
   - `build` (macOS arm64 + Windows x64, with sidecars).

3. **The release is published automatically** on success. If checks fail,
   no release is created; fix the bug, re-run `version-bump` with the next
   version, and try again. (Don't reuse a failed version number.)

If you absolutely need to tag manually:

```bash
# 1. patch the four files yourself, identically to version-bump
# 2. commit
# 3. tag and push
git tag -a v0.2.0 -m "RoundLab v0.2.0"
git push origin main
git push origin v0.2.0
```

`release.yml`'s `verify-version` step will block the build if you forgot
any manifest.

## How to get a Windows installer without releasing

For QA, log collection, or the 95/99% triage:

```bash
gh workflow run triage-windows.yml
gh run watch
gh run download <run-id> -n roundlab-windows-x64-nsis
```

The artifact is retained for 14 days and is **not** linked to any GitHub
release.

## Don't

- Don't push `v*.*.*` tags by hand unless you've patched the four manifests
  identically to what `version-bump` would do. `verify-version` will block
  the build if not.
- Don't reuse a tag that already shipped (delete + repush ≠ a clean
  release; clients caching `latest.json` will see two binaries claiming
  the same version).
- Don't enable lint in CI yet: there are 4 preexisting `no-explicit-any`
  errors in `desktop/src/components/DebugConsole.tsx` and
  `desktop/src/lib/api.ts`. Fix those first, then re-add `pnpm lint` to
  `_checks.yml` → `frontend` job.
- Don't run `triage-windows` thinking it produces a release — it doesn't.

## Branch protection (recommended, manual setup)

In **Settings → Branches → main → Branch protection rules**, require:
- Status checks: `checks / frontend`, `checks / go`, `checks / rust-tauri`,
  `checks / rust-fallback` (these names come from `_checks.yml` jobs
  invoked by `ci.yml` — they appear once a PR has run CI at least once).
- "Require branches to be up to date before merging".

This makes broken PRs unmergeable.
