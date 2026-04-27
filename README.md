# RoundLab

RoundLab is a CS2 demo review tool for uploading GOTV demos, parsing match data, and replaying rounds on a 2D radar with timeline controls and drawing tools.

## Current MVP

- Upload `.dem` and `.dem.zst` files.
- Parse CS2 demos with a Go parser built on `demoinfocs-golang`.
- Replay rounds on a 2D radar map.
- Scrub the round timeline, play/pause, and change playback speed.
- Draw annotations over the review.
- Show player HP, armor, helmet, defuse kit, weapons, and utility.

## Project Structure

```txt
parser/  Go demo parser
web/     Next.js web app
```

## Local Development

Build the parser:

```bash
cd parser
go build -o parser .
```

Run the web app:

```bash
cd web
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Desktop app (Tauri)

The `desktop` branch packages RoundLab as a Tauri app that parses demos fully
on-device — nothing is uploaded. It ships the Go parser as a bundled sidecar
and persists parsed matches locally under the OS app-data directory.

### Install

Grab the installer for your platform from the
[latest release](https://github.com/Lakav/RoundLab/releases/latest):

- **macOS (Apple Silicon)** — `RoundLab_<version>_aarch64.dmg`
- **Windows (x64)** — `RoundLab_<version>_x64-setup.exe`

> macOS Intel is not shipped. Build from source if you need it — see "Developing the desktop app" below.

Because builds are **not code-signed** (no Apple Developer / Microsoft
certificate), you'll see a warning on first launch:

- **macOS** — Gatekeeper blocks unsigned apps. Two cases:
  - _"can't be opened because Apple cannot check it for malicious software"_ →
    right-click the app in Applications → **Open** → **Open** again in the
    confirmation dialog. Only needed once.
  - _"RoundLab is damaged and can't be opened"_ → the quarantine attribute got
    applied more aggressively. Strip it from Terminal, then launch the app:
    ```bash
    xattr -dr com.apple.quarantine /Applications/RoundLab.app
    open /Applications/RoundLab.app
    ```
    If macOS says permission is denied, rerun the first command with `sudo`.
- **Windows** — SmartScreen shows _"Windows protected your PC"_. Click
  **More info → Run anyway**.

### Auto-update

The app polls
[`releases/latest/download/latest.json`](https://github.com/Lakav/RoundLab/releases/latest/download/latest.json)
on launch. When a new version is published it appears as an **Install** banner
on the home screen; clicking it downloads and verifies the signed update, then
prompts to restart.

Update payloads are signed with a minisign keypair. The public key is
embedded in `web/src-tauri/tauri.conf.json`; the private key is stored as the
`TAURI_SIGNING_PRIVATE_KEY` repo secret and only used by the release workflow.

### Cutting a release

1. Bump `version` in `web/src-tauri/tauri.conf.json` and `web/package.json`.
2. Commit and push.
3. Tag and push:
   ```bash
   git tag v0.2.0 && git push --tags
   ```

The `release.yml` workflow builds for macOS (arm64) and Windows (x64) in
parallel, uploads installers to a new GitHub release, and writes the
`latest.json` the in-app updater expects.

### Developing the desktop app

Prerequisites: Rust (`rustup`), Go 1.23+, Node 20+, pnpm 10+, and `protoc` 23.x
on your `PATH` (the parser-fallback Rust crate generates code from `.proto`
files at build time).

```bash
cd web
pnpm install

# Build the Go sidecar once for your host triple. Re-run after editing
# anything under parser/ — Tauri picks up the new binary on its next launch.
./src-tauri/binaries/build-sidecar.sh

# Hot-reload dev loop: opens the native window, watches the Next.js frontend
# and the Rust backend (web/src-tauri/src). Frontend edits hot-reload; Rust
# edits trigger an app restart.
pnpm tauri dev
```

If you only need to iterate on the frontend (no native shell), `pnpm dev` from
`web/` runs the Next.js app at `http://localhost:3000` — but the Tauri-only
commands (`parse_demo`, `list_matches`, …) won't work there.

To produce a release build locally:

```bash
pnpm tauri build
```

The resulting installers land in `web/src-tauri/target/release/bundle/`.

## Notes

Demo files and parsed outputs are intentionally ignored by Git because they are large and should live in object storage later.
