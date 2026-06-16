# Release procedure

How releases work in this repo, and how to operate them. Pair with
`SECURITY_RELEASE.md` for the key-handling rules.

## TL;DR

- **Push to `main` → automatic patch release.** A real GitHub Release
  named `RoundLab vX.Y.Z` is published with `.dmg`, `.exe`, `latest.json`,
  and `.sig` files (when signing secrets are set).
- **Want to merge without releasing?** Put `[skip-release]` anywhere in
  the commit message of the push.
- **Want a `minor` or `major` bump, or a specific version?** Run
  `version-bump` manually from the Actions tab.
- **PRs only run checks**, never bump, never release.

## Workflows at a glance

| File | Trigger | Purpose |
|---|---|---|
| `_checks.yml` | `workflow_call` (reusable) | Typecheck, build, tests, clippy strict |
| `_build.yml` | `workflow_call` (reusable) | Tauri matrix build (macOS arm64 + Windows x64). With `release=true`, publishes to a GitHub Release. With `release=false`, uploads workflow artifacts. |
| `ci.yml` | PR targeting `main` | Run `_checks.yml` only. Blocks the PR if red. |
| `auto-release.yml` | **push to `main`** | THE MAIN RELEASE PATH. Runs checks, patch-bumps the version, commits + tags, then calls `_build.yml(release=true)`. |
| `version-bump.yml` | `workflow_dispatch` (manual) | Secondary release path. Use for `minor`/`major` bumps or an explicit version. Same outcome as auto-release: patches files, commits + tags, calls `_build.yml(release=true)`. |
| `release.yml` | push of `v*.*.*` tag, or manual dispatch | Fallback. Useful only if you tag from a local machine with your own credentials, or want to redo a release on an existing tag. |
| `triage-windows.yml` | `workflow_dispatch` (manual) | One-off Windows-only build, no release. Useful for QA on a non-`main` branch. |

## Why are there two release paths and a fallback?

GitHub Actions has a loop-prevention rule: **a tag or branch pushed by
Actions using `GITHUB_TOKEN` does not trigger any other workflow**.
That's deliberate — without it, an action that pushes a tag could fire
itself and cycle forever.

Consequence: if `auto-release.yml` (or `version-bump.yml`) just pushed
the tag and waited for `release.yml` to pick it up by trigger, **nothing
would happen**. The workaround is for the bumping workflow to call
`_build.yml` directly in the same run. That's why both `auto-release.yml`
and `version-bump.yml` end with a job that uses `_build.yml(release=true)`.

`release.yml` still exists for the case where a tag is pushed from a
human's machine (where the credentials DO trigger workflows), or for
re-running a release on an existing tag from the UI.

## Anti-loop guards (why auto-release doesn't bump itself)

`auto-release.yml` runs on every push to `main`, including the bump
commit it just pushed. Three guards prevent the loop:

1. The `GITHUB_TOKEN`-pushed commit, by design, does not trigger
   workflows. **This alone breaks the loop.**
2. The bump commit message contains `[skip-bump]`. The first job in
   `auto-release.yml` checks for this string and skips everything if
   present.
3. The pusher of the bump commit is `github-actions[bot]`. The same
   first job checks the head commit author and skips if it's the bot.

You only need one of these to hold. They are layered for defence in
depth.

## How to operate

### "Just merge my PR"

Open a PR → CI runs checks → merge when green. On merge to `main`,
`auto-release.yml` triggers, bumps `vA.B.C → vA.B.C+1`, and publishes
a release. Done.

### "Don't release this push"

Include `[skip-release]` anywhere in the PR's merge commit message (or
in any direct push to main). `auto-release.yml` skips the whole
pipeline. The version stays the same. Use this for docs-only changes,
internal refactors that don't ship, or batched fixes.

### "Cut a minor or major release, or pin a specific version"

```bash
gh workflow run version-bump.yml -f bump=minor
# or major:
gh workflow run version-bump.yml -f bump=major
# or explicit:
gh workflow run version-bump.yml -f version=0.5.0
```

The workflow patches manifests, commits with `[skip-bump]`, pushes the
tag, then publishes the release via `_build.yml`.

### "Re-run a release on an existing tag"

If a release publication failed mid-way (e.g. a flaky tauri-action run)
and you want to retry without bumping again:

```bash
gh workflow run release.yml --ref vX.Y.Z
```

Or push the tag from your own machine:

```bash
git push origin vX.Y.Z
```

(Pushing from a developer's credentials does trigger `release.yml`.)

### "I just want a Windows installer to QA, not a release"

```bash
gh workflow run triage-windows.yml --ref my-branch
gh run download <run-id> -n roundlab-windows-x64
```

This produces a workflow artifact, not a release. Retention 30 days.
Not visible to the in-app updater.

## Sources of truth for the version

The bumping workflows keep all four in sync:

1. `desktop/package.json`
2. `desktop/src-tauri/tauri.conf.json`
3. `desktop/src-tauri/Cargo.toml` (`[package]` block)
4. `desktop/src-tauri/Cargo.lock` (regenerated via `cargo update -p roundlab`)

The frontend reads its displayed version via `getVersion()` (Tauri API),
so there is no JS constant to patch.

## Secrets

Set in **Settings → Secrets and variables → Actions**:

| Secret | Used by | Required? | Effect if missing |
|---|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `_build.yml` | Strongly recommended | Bundles still build, but `latest.json` has no `.sig`. The in-app updater rejects updates without a signature, so users won't auto-update. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | same | Required iff the key is password-protected | Build fails if missing and key has a password |
| `GITHUB_TOKEN` | All | Auto-provided | n/a |

No Apple / Microsoft code-signing for the installers themselves;
SmartScreen / Gatekeeper warnings on first launch are expected.

## Don't

- Don't push `v*.*.*` tags by hand without first patching all four
  manifests. `release.yml`'s `verify-version` step will block the
  build, but you'll waste a CI run.
- Don't remove `[skip-bump]` from the bump commits. It's the
  belt-and-suspenders against the auto-release loop.
- Don't expect `triage-windows` artifacts to be picked up by the
  updater — they aren't.
- Don't reuse a version that already shipped (delete + repush ≠ a
  clean release; clients caching `latest.json` will see two binaries
  claiming the same version).
- Don't enable lint in CI yet: 4 preexisting `no-explicit-any` errors
  in `desktop/src/components/DebugConsole.tsx` and
  `desktop/src/lib/api.ts`. Fix those first, then re-add `pnpm lint`
  to `_checks.yml`.

## Branch protection (manual, recommended)

In **Settings → Branches → main → Branch protection rules**, require
the four `_checks.yml` jobs as required status checks:

- `checks / frontend`
- `checks / rust-tauri`
- `checks / rust`

Names appear in the list once at least one PR has run CI. PRs only run
`_checks.yml`, never `_build.yml`, so merge time stays fast.

Optionally also turn on "Restrict who can push to matching branches"
to block direct pushes to `main` so every change goes through a PR
(and therefore through CI).
