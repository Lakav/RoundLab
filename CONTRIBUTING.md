# Contributing to RoundLab

RoundLab is a local-first CS2 demo analyser. Correctness, provenance and user privacy take priority
over adding a number to the interface.

## Setup

Requirements:

- Node.js 24 and pnpm 11;
- Rust 1.95 with the `wasm32-unknown-unknown` target;
- `wasm-bindgen-cli` **0.2.126** when regenerating browser artifacts.

```bash
cd web
pnpm install --frozen-lockfile
pnpm dev
```

The committed WASM artifacts are enough for normal web development. To rebuild them, install the
exact CLI and run `pnpm parser:wasm`; then verify reproducibility from the repository root with
`python3 scripts/verify-wasm-reproducibility.py --check-git`.

## Repository structure

- `web/`: Next.js UI, local browser backend, replay and TypeScript analysis;
- `parser/`: shared Rust parser library, native CLI and WASM binding;
- `scripts/`: portable audits and reproducibility tools;
- `docs/`: schemas, formula contracts and validation notes;
- `vendor/`: pinned parser source used by the Rust crate.

Read every applicable `AGENTS.md` before editing. For Next.js changes, also read the relevant
bundled guide under `web/node_modules/next/dist/docs/` because this project follows its installed
Next.js version, not generic examples from the web.

## Rules that protect the product

- Keep parsing, analysis and storage fully local. Do not add telemetry or upload demos, Steam IDs or
  user statistics.
- Missing data stays `null`; never turn absence into zero, `NaN` or infinity.
- Preserve metric provenance, coverage, confidence, unavailable reasons and formula versions.
- Do not add automatic key-moment selection. RoundLab is centered on factual statistics.
- Preserve historical IndexedDB migrations, static GitHub Pages export and the `/RoundLab` base
  path.
- Make structural extractions behind behavior tests; do not rewrite large analytical modules blind.
- Never commit generated bundle reports, local browser profiles or private demo files.

## Demo fixtures

A demo may enter the repository only when its provenance and redistribution permission are explicit.
Record its source URL, license/permission and checksum next to the fixture. Never use a user's local
demo as a test fixture. The current browser import fixture and its attribution are under
`web/tests-e2e/fixtures/`.

## Validation

Before opening a pull request, run the checks proportional to the change. For a complete validation:

```bash
cd web
pnpm audit --audit-level high
pnpm lint
pnpm exec tsc --noEmit
pnpm test:coverage
pnpm build
pnpm test:e2e

cd ../parser
cargo audit
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
cargo check --target wasm32-unknown-unknown --lib

cd ..
python3 scripts/run-local-ci-checks.py
```

Document any skipped check and the exact reason in the pull request. A WebKit Playwright pass is a
cross-engine signal, not proof of physical Safari/iPhone validation.

## Pull requests

Keep commits scoped and explain user impact, tests, privacy and performance. UI changes need a real
browser check and screenshots when the visual result changes. Parser changes must preserve reference
snapshots or explain and review every intended schema difference.
