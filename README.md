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

For the local browser/static check suite, use the CI-safe runner:

```bash
python3 scripts/run-local-ci-checks.py
```

This runs the frontend checks, rebuilds `desktop/out`, then runs the portable
audit suite with the same safe modes as CI. Do not replace it with
`for f in scripts/audit-*.py; do python3 "$f"; done`: some audit scripts have
deep modes that require private local comparison outputs.

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

The reproducible RNCP Bloc 2 evidence pack is stored in
`docs/rncp-bloc2/evidence/`. Regenerate its raw logs with a local reference
demo using:

```bash
python3 scripts/collect-rncp-bloc2-evidence.py --demo demos/dust1-13.dem.zst
```

For a fast snapshot check that does not require parser outputs, run:

```bash
python3 scripts/audit-reference-snapshots.py --reference-only
```

For replay rendering invariants on local `.roundlab-compare` fixtures and
local parsed matches in `desktop/data/parsed` when present, run:

```bash
python3 scripts/audit-replay-rendering.py
```

This checks map assets, map calibration/crop, start-frame spawn positions,
invalid projectile samples, utility tracks without a player thrower, and utility
effects that have no plausible player-owned projectile trajectory near
detonation. It also checks that condensed replay effects resolve to a single
best player-owned trajectory.
Split fixtures must contain utility effect/projectile signal to count as replay
proof. Opportunistic parsed matches without that signal are reported as `WEAK`
instead of `OK` so they are not mistaken for utility-rendering coverage.
Add `--skip-parsed` to audit only the split `.roundlab-compare` fixtures, or
`--assets-only` to run the CI-safe map asset/calibration check without local
fixtures. Add `--require-all-map-fixtures` to fail when a calibrated map has no
replay fixture coverage.
For multi-level maps with committed `*_lower` radar assets, currently Nuke,
Train, and Vertigo, fixture coverage must include observed player samples on
every radar layer; a fixture that only touches one floor is not enough proof.

The current replay fixture coverage is tracked in
`docs/replay-fixture-coverage.json`. The manifest is deliberately explicit
about maps that are not yet proven by local replay fixtures. To validate the
manifest against calibrated maps, and against local `.roundlab-compare`
fixtures when present, run:

```bash
python3 scripts/audit-replay-fixture-coverage.py
```

Use `--require-all-maps` when you need a hard proof gate for replay coverage
across every calibrated map. The current local fixture set passes that stricter
mode with all ten calibrated maps represented.

Maps with committed `*_lower` radar assets need dedicated replay proof that
exercises both the default and lower radar layers. Nuke, Train, and Vertigo now
have that proof.

To catch accidental regressions back to desktop/Tauri-only code paths, run:

```bash
python3 scripts/audit-web-portability.py
```

To catch accidental regressions back to server-required Next.js features such
as API routes, middleware, server actions, or image optimization, run:

```bash
python3 scripts/audit-static-web-export.py
```

After a production build, validate the generated static export artifact:

```bash
cd desktop
pnpm build
cd ..
python3 scripts/audit-static-export-output.py
```

To ensure every `scripts/audit-*.py` check is compiled, run in CI, and listed
here, run:

```bash
python3 scripts/audit-ci-coverage.py
```

To catch accidental demo upload or non-local parser regressions in the browser
import path, run:

```bash
python3 scripts/audit-browser-parser-locality.py
```

To validate browser import capability checks, file size limits, demo extension
filters, and parser progress estimate invariants, run:

```bash
python3 scripts/audit-browser-import-flow.py
```

To validate parse-time ETA constants and simulated progress/remaining-time
behavior, run:

```bash
python3 scripts/audit-parse-estimate.py
```

To validate the user-facing import workflow from file pick/drop through
post-parse naming and match opening, run:

```bash
python3 scripts/audit-browser-import-workflow.py
```

To validate that parsed matches stay split between lightweight metadata and
on-demand round payloads in IndexedDB, run:

```bash
python3 scripts/audit-browser-store-contract.py
```

To validate the home import screen accessibility contract, including the demo
file input and the settings panel semantics, run:

```bash
python3 scripts/audit-home-accessibility.py
```

To validate the exhaustive RGAA 4.1.2 grid without treating empty rows as real
results, run:

```bash
python3 scripts/audit-rgaa-grid.py
```

After the human audit, require all 106 criteria to be coherently documented
before computing a compliance rate:

```bash
python3 scripts/audit-rgaa-grid.py --require-complete
```

To validate the anonymized user-session evidence without treating empty files
as completed sessions, run:

```bash
python3 scripts/audit-user-validation.py
```

After at least one real participant has completed the eight protocol tasks,
require a coherent participant summary and task journal before reporting a
success rate:

```bash
python3 scripts/audit-user-validation.py --require-complete
```

Immediately before creating a release tag, run the strict release gate. A
matching package version is insufficient: all 16 recipe scenarios, the RGAA
grid, and the real user-session evidence must also pass.

```bash
python3 scripts/validate-release-version.py --tag v0.1.40
```

`--manifest-only` deliberately skips those evidence gates and must never be
used to authorize a tag.

For the remote pre-release check, manually dispatch `.github/workflows/release-gate.yml`
on the candidate commit with the expected tag. It runs the full reusable CI
suite first and the strict evidence gate second. It deliberately does not
create or push the tag.

To validate the static security baseline (CSP, referrer policy, dangerous HTML
or dynamic-code sinks, read-only CI permissions, and dependency-audit wiring),
run:

```bash
python3 scripts/audit-security-baseline.py
```

To validate that browser imports still use full-fidelity parser defaults and do
not silently skip projectile or weapon-fire data, run:

```bash
python3 scripts/audit-parser-fidelity.py
```

To validate that public icons, logos, and referenced radar assets exist and are
loadable by the replay UI, run:

```bash
python3 scripts/audit-public-assets.py
```

To validate the match review map sizing, crop transform formulas, and round
selector overflow guard across representative viewport sizes, run:

```bash
python3 scripts/audit-match-layout.py
```

To validate the match review controls, including the user-triggered fullscreen
toggle and map zoom/pan affordances, run:

```bash
python3 scripts/audit-match-controls.py
```

To validate that the Pixi replay renderer still keeps projectile trajectories
visible through effect handoff/future-frame fallbacks in both classic and
condensed replay modes, run:

```bash
python3 scripts/audit-replay-renderer-contract.py
```

## Notes

Demo files, parsed outputs, build artifacts, and local caches are intentionally
ignored by Git.
