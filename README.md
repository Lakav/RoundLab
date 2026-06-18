# RoundLab

RoundLab is a standalone desktop app for reviewing CS2 GOTV demos locally. It parses `.dem` and `.dem.zst` files on-device, stores parsed matches in the OS app-data directory, and replays rounds on a 2D radar with timeline controls and drawing tools.

No demo is uploaded. No server is required.

## Features

- Import local `.dem` and `.dem.zst` files.
- Parse CS2 demos with a bundled Rust parser sidecar.
- Replay rounds on a 2D radar.
- Scrub the round timeline, play/pause, and change playback speed.
- Draw annotations over the review.
- Show player HP, armor, helmet, defuse kit, weapons, money, utility, kill feed, bomb, and effect timers.

## Project Structure

```txt
desktop/         Tauri desktop app and renderer
parser/          Rust demo parser sidecar
ressources/      Source assets
```

## Local Development

Prerequisites: Rust (`rustup`), Node 20+, pnpm 10+, and `protoc` 23.x on your `PATH`.

```bash
cd desktop
pnpm install

# Build the parser sidecar for your host platform.
pnpm sidecar:build

# Launch the native desktop app.
pnpm tauri:dev
```

To produce a local desktop bundle:

```bash
cd desktop
pnpm tauri:build
```

The resulting installers land in `desktop/src-tauri/target/release/bundle/`.

## Parser Validation

Parser unit tests run without committed demo fixtures:

```bash
cd parser
cargo test
```

For real replay-integrity coverage, point `ROUNDLAB_TEST_DEMOS` at local `.dem`
or `.dem.zst` files. Use the platform path separator (`:` on macOS/Linux, `;`
on Windows). Large demos must stay outside Git.

```bash
cd parser
ROUNDLAB_TEST_DEMOS="/path/to/ancient4-13.dem.zst:/path/to/anubis16-19.dem.zst" cargo test roundlab_test_demo_produces_replay_json_when_configured -- --nocapture
ROUNDLAB_TEST_DEMOS="/path/to/ancient4-13.dem.zst:/path/to/anubis16-19.dem.zst" cargo test roundlab_test_demo_honors_quality_and_skip_options_when_configured -- --nocapture
```

For the full five-demo local set, prefer `cargo test --release ... -- --nocapture`.
The debug test binary is correct but much slower on full-quality replay output.

`ROUNDLAB_TEST_DEMO=/path/to/demo.dem.zst` still works for one-off local runs.

Known reference demos are listed in `parser/reference_demos.json`. For those
files, the tests enforce exact map and score identity plus snapshots for rounds,
players, frames, kills, bomb events, bomb state, utility effects, weapon fires,
and projectile frames. The snapshots also lock compact per-round kill,
bomb-event, bomb-state, active-action, utility-effect, and weapon-fire
signatures plus compact projectile-track signatures. Bomb-state signatures
summarize carried/dropped/planted windows with timing, sample count, end cause,
carrier, and bucketed start/end position. Active-action signatures summarize
visible plant/utility windows by player, item, elapsed timing, sample count, and
duration. Weapon-fire signatures include bucketed timing, shooter, weapon, team,
position, and yaw. Projectile-track signatures summarize id, type, thrower,
timing, samples, and bucketed start/end position. The score in the demo filename
is the expected truth (`dust1-13.dem.zst` means `scoreA=1`, `scoreB=13`). The
medium-quality skip test also verifies that lightweight parsing keeps core
replay data while omitting weapon fires and projectile payloads. Full-quality
integration tests also enforce structural replay invariants: monotonic round
scores, sorted events and frames, bounded post-round events, no bomb state after
bomb resolution, valid utility effects, valid weapon-fire poses, and no
duplicate projectile identity inside a projectile frame.

To add a reference demo, keep the `.dem`/`.dem.zst` outside Git, rename it as
`<map><scoreA>-<scoreB>.dem.zst`, run both parser integration tests, then add
only the lightweight snapshots to `parser/reference_demos.json`.
After a full Go/Rust round audit, run
`python3 scripts/audit-reference-snapshots.py --report .roundlab-compare/<report>.json`
to verify that the saved Rust snapshots still match the Rust side of the latest
audited report, including compact event/terminal-event/effect/weapon-fire/
bomb-state/action and projectile-track signatures, plus the current allowlisted
Go/Rust weapon-fire tolerance signatures. This check is read-only and requires
the JSON report, not only the Markdown summary.

Parser output uses gzip for Tauri compatibility. For benchmarks, set
`ROUNDLAB_PARSER_GZIP_LEVEL=0..9` to compare compression speed and output size.

## Releases

The release workflow builds macOS Apple Silicon and Windows x64 installers when a `v*.*.*` tag is pushed.

1. Bump `version` in `desktop/src-tauri/tauri.conf.json` and `desktop/package.json`.
2. Commit and push.
3. Tag and push:

```bash
git tag v0.2.0
git push origin v0.2.0
```

## Installation notes

### macOS

RoundLab is currently unsigned.

If macOS says the app is damaged or cannot be opened, run:

```bash
xattr -cr ~/Downloads/RoundLab.app
open ~/Downloads/RoundLab.app
```

Then confirm the security prompt from macOS.

### Windows

RoundLab is currently unsigned.

If SmartScreen blocks the app:

1. Click `More info`
2. Click `Run anyway`

## Auto-Update

The app checks GitHub Releases for `latest.json` on launch. Update payloads are signed with the public key embedded in `desktop/src-tauri/tauri.conf.json`; the private key is stored in the `TAURI_SIGNING_PRIVATE_KEY` repository secret.

## Notes

Demo files, parsed outputs, build artifacts, sidecar binaries, signing keys, and local caches are intentionally ignored by Git.
