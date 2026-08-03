# Rust-Only Parser Workflow

The Rust parser is the product parser and the source of truth for normal
development. The archived Go parser comparison harness is retained only for
historical debugging. It should not be used as a daily oracle and should not
block Rust optimization unless it exposes a clear Rust replay bug.

## Guardrails

- Keep the web replay JSON contract stable: `meta`, `players`, manifest `rounds`,
  split round files, and per-round `frames`, `events`, `effects`,
  `weaponFires`, and `projectileFrames`.
- Use `parser/reference-demos.json` and `ROUNDLAB_TEST_DEMOS` as the replay
  regression source of truth.
- Do not optimize by dropping replay features. Full quality must keep kills,
  bomb events/states, utility effects, weapon-fire pose fields, and projectile
  tracks.
- Clean generated parser outputs and build artifacts after large local runs.

## Validation Commands

Fast structural snapshot check:

```bash
python3 scripts/audit-reference-snapshots.py --reference-only
```

Rust parser checks:

```bash
cd parser
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

Full local replay checks when the five ignored demos are available:

```bash
cd parser
ROUNDLAB_TEST_DEMOS="/abs/path/ancient4-13.dem.zst:/abs/path/anubis16-19.dem.zst:/abs/path/cache11-13.dem.zst:/abs/path/dust1-13.dem.zst:/abs/path/inferno8-13.dem.zst" cargo test --release roundlab_test_demo_produces_replay_json_when_configured -- --nocapture
ROUNDLAB_TEST_DEMOS="/abs/path/ancient4-13.dem.zst:/abs/path/anubis16-19.dem.zst:/abs/path/cache11-13.dem.zst:/abs/path/dust1-13.dem.zst:/abs/path/inferno8-13.dem.zst" cargo test --release roundlab_test_demo_honors_quality_and_skip_options_when_configured -- --nocapture
```

Rust-only performance sample:

```bash
cargo build --manifest-path parser/Cargo.toml --release
/usr/bin/time -l parser/target/release/roundlab-parser \
  -in demos/dust1-13.dem.zst \
  -out .roundlab-compare/dust-rust-only-stats.json.gz \
  -quality full \
  -stats
rm -rf .roundlab-compare/* parser/target
```

## Current Rust-Only Cost Centers

Baseline from `demos/dust1-13.dem.zst`, full quality, local release build:

| cost center | measured cost |
| --- | ---: |
| `write_output_ms` / `serialize_json_ms` | `7151 ms` / `7142 ms` |
| `parse_ticks_ms` | `1738 ms` |
| `parse_projectiles_ms` + `build_rounds_ms` | `387 ms` + `350 ms` |

Other measurements from the same run:

- wall time: `10.68s`
- max RSS: about `1.36 GiB`
- raw JSON bytes: `154,073,230`
- gzip output bytes: `13,518,534`
- frames: `67,290`
- frame players: `485,810`
- projectile frames/samples: `51,555` / `130,332`

The next optimization target should be split-output serialization/compression
cost first, then tick parsing. `build_rounds` is not the main bottleneck on
this sample.
