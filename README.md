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

For real replay-integrity coverage, point `ROUNDLAB_TEST_DEMO` at a local `.dem`
or `.dem.zst` file. Large demos must stay outside Git.

```bash
cd parser
ROUNDLAB_TEST_DEMO=/path/to/demo.dem.zst cargo test roundlab_test_demo_produces_replay_json_when_configured -- --nocapture
ROUNDLAB_TEST_DEMO=/path/to/demo.dem.zst cargo test roundlab_test_demo_honors_quality_and_skip_options_when_configured -- --nocapture
```

When the demo is the current reference file
`1-128af027-81e2-40d5-a0ea-0281f0b5d16e-1-1.dem.zst`, the test enforces
strong floors for rounds, scores, players, frames, kills, bomb events, bomb
state, utility effects, weapon fires, and projectile frames. The medium-quality
skip test also verifies that lightweight parsing keeps core replay data while
omitting weapon fires and projectile payloads.

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
