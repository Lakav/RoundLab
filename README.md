# RoundLab

RoundLab is a browser-based CS2 GOTV demo review app. It parses `.dem` and
`.dem.zst` files locally on the user's machine in a Web Worker, stores parsed
matches in browser storage, and replays rounds on a 2D radar with timeline
controls and drawing tools.

No demo is uploaded. The parser runs client-side in the browser.

## Features

- Import local `.dem` and `.dem.zst` files.
- Parse demos locally with the Rust parser compiled to WebAssembly.
- Store parsed matches and split round payloads in IndexedDB.
- Replay rounds on a 2D radar.
- Scrub the round timeline, play/pause, and change playback speed.
- Draw annotations over the review.
- Show player HP, armor, helmet, defuse kit, weapons, money, utility, kill feed, bomb, and effect timers.
- Review utility habits by rendering all rounds for a player or team at once.

## Project Structure

```txt
desktop/         Next.js web app
parser/          Rust demo parser and WebAssembly entrypoint
ressources/      Source assets
docs/            Architecture and migration notes
```

## Local Development

Prerequisites: Rust (`rustup`), Node 20+, pnpm, `wasm32-unknown-unknown`, and
`wasm-bindgen-cli`.

```bash
cd desktop
pnpm install

# Rebuild the browser parser after Rust parser changes.
pnpm parser:wasm

# Launch the web app.
pnpm dev
```

Then open `http://localhost:3000`.

## Browser Support

The local parser requires Web Workers, WebAssembly, IndexedDB, the File API, and
`crypto.randomUUID`. The import flow checks these capabilities before parsing
and shows a clear error if the current browser cannot run the client-side
parser.

Current validation status:

- Chrome: validated with real `.dem.zst` parsing, replay open, and utility
  habits overlay on large demos.
- Safari: not validated yet. To automate Safari, enable Safari Settings →
  Developer → Allow Remote Automation, then run the same static-export smoke
  tests through `safaridriver`.
- Edge and Firefox: not validated yet in this workspace because the browsers
  are not installed here.

## Validation

Frontend checks:

```bash
cd desktop
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Parser checks:

```bash
cd parser
cargo test
cargo check --target wasm32-unknown-unknown --lib
```

For real replay-integrity coverage, point `ROUNDLAB_TEST_DEMOS` at local `.dem`
or `.dem.zst` files. Use the platform path separator (`:` on macOS/Linux, `;`
on Windows). Large demos must stay outside Git.

```bash
cd parser
ROUNDLAB_TEST_DEMOS="/path/to/ancient4-13.dem.zst:/path/to/anubis16-19.dem.zst" cargo test roundlab_test_demo_produces_replay_json_when_configured -- --nocapture
ROUNDLAB_TEST_DEMOS="/path/to/ancient4-13.dem.zst:/path/to/anubis16-19.dem.zst" cargo test roundlab_test_demo_honors_quality_and_skip_options_when_configured -- --nocapture
```

Known reference demos are listed in `parser/reference_demos.json`. For those
files, tests enforce exact map and score identity plus snapshots for rounds,
players, frames, kills, bomb events, bomb state, utility effects, weapon fires,
and projectile frames.

For a fast snapshot check that does not require parser outputs, run:

```bash
python3 scripts/audit-reference-snapshots.py --reference-only
```

For replay rendering invariants on local `.roundlab-compare` fixtures and
local parsed matches in `desktop/data/parsed` when present, run:

```bash
python3 scripts/audit-replay-rendering.py
```

This checks map assets, map calibration/crop, invalid projectile samples,
utility tracks without a player thrower, and utility effects that have no
plausible player-owned projectile trajectory near detonation.
Add `--skip-parsed` to audit only the split `.roundlab-compare` fixtures, or
`--assets-only` to run the CI-safe map asset/calibration check without local
fixtures. Add `--require-all-map-fixtures` to fail when a calibrated map has no
replay fixture coverage.

To catch accidental regressions back to desktop/Tauri-only code paths, run:

```bash
python3 scripts/audit-web-portability.py
```

## Notes

Demo files, parsed outputs, build artifacts, and local caches are intentionally
ignored by Git.
