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
- Review utility habits by playing every round for a selected player at once.

## Project Structure

```txt
desktop/         Next.js web app
parser/          Rust demo parser and WebAssembly entrypoint
ressources/      Source assets
docs/            Architecture and migration notes
```

## Local Development

Prerequisites: Rust (`rustup`), Node 24, pnpm, `wasm32-unknown-unknown`, and
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
pnpm audit --audit-level high
pnpm lint
pnpm exec tsc --noEmit
pnpm test:coverage
pnpm build
```

Parser checks:

```bash
cd parser
cargo test
cargo check --target wasm32-unknown-unknown --lib
```

The CI runs both native parser tests and the `wasm32-unknown-unknown` library
check, then regenerates the committed browser WASM artifacts and fails if
`desktop/src/wasm/roundlab_parser` is stale.

For the complete local product check suite, use:

```bash
python3 scripts/run-local-ci-checks.py
```

This runs the frontend checks, browser accessibility scenarios, production
build, and the portable parser/replay integrity checks used by CI.

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

For deeper replay-integrity checks on local `.roundlab-compare` fixtures and
parsed matches in `desktop/data/parsed`, run:

```bash
python3 scripts/audit-replay-rendering.py
```

This checks map calibration, player positions, projectile/effect associations,
and multi-level radar layers. The fixture manifest can be checked separately:

```bash
python3 scripts/audit-replay-fixture-coverage.py
```

Immediately before creating a release tag, verify that the tag matches the web
package version and has not already been published:

```bash
python3 scripts/validate-release-version.py --tag v0.1.40
```

The remote release check runs the full reusable CI suite first. It validates
the requested version but deliberately does not create or push the tag.

## Notes

Demo files, parsed outputs, build artifacts, and local caches are intentionally
ignored by Git.
