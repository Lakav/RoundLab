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
    applied more aggressively. Strip it from Terminal, then launch normally:
    ```bash
    xattr -cr /Applications/RoundLab.app
    ```
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

```bash
cd web
pnpm install
# Build the Go sidecar once for your host triple.
./src-tauri/binaries/build-sidecar.sh
pnpm tauri dev
```

## Notes

Demo files and parsed outputs are intentionally ignored by Git because they are large and should live in object storage later.
