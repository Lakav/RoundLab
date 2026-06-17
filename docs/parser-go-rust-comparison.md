# Go vs Rust Parser Comparison

Local comparison only. The archived Go parser is used as an oracle/debug aid, not as a product dependency or fallback.

## Setup

- Go parser source: `parser/` extracted from Git commit `35c238c` into ignored local directory `.roundlab-go-parser/`.
- Rust parser: current `parser/target/release/roundlab-parser`.
- Harness: `scripts/compare-parsers.py`.
- Demos: local ignored files under `demos/`.
- Score truth: demo filename, for example `dust1-13.dem.zst` means `scoreA=1`, `scoreB=13`.

## Commands

```bash
python3 scripts/compare-parsers.py --prepare-go --build-rust --quality medium --skip-heavy --out .roundlab-compare/medium-skip.json
python3 scripts/compare-parsers.py --quality full --out .roundlab-compare/full.json
```

Use `--keep-outputs` for targeted event-level debugging.

## Results

### Medium + skipProjectiles + skipWeaponFires

| demo | expected | Go score | Rust score | Go ms/RSS MB | Rust ms/RSS MB |
| --- | --- | --- | --- | ---: | ---: |
| ancient4-13 | 4-13 | 4-13 | 4-13 | 6924/63.6 | 1374/440.8 |
| anubis16-19 | 16-19 | 16-19 | 16-19 | 13881/57.4 | 2645/889.7 |
| cache11-13 | 11-13 | 11-13 | 11-13 | 8987/63.2 | 1975/591.2 |
| dust1-13 | 1-13 | 1-13 | 1-13 | 5515/52.0 | 1028/322.8 |
| inferno8-13 | 8-13 | 8-13 | 8-13 | 9584/62.0 | 1937/670.4 |

Summary: Rust is much faster in medium skip mode, but uses much more memory.

### Full quality

| demo | expected | Go score | Rust score | Go ms/RSS MB | Rust ms/RSS MB | Rust output delta |
| --- | --- | --- | --- | ---: | ---: | ---: |
| ancient4-13 | 4-13 | 4-13 | 4-13 | 14535/219.3 | 12771/2001.0 | -4.72 MB |
| anubis16-19 | 16-19 | 16-19 | 16-19 | 27130/176.0 | 25731/3578.0 | -11.00 MB |
| cache11-13 | 11-13 | 11-13 | 11-13 | 20697/190.6 | 19276/3064.0 | -9.20 MB |
| dust1-13 | 1-13 | 1-13 | 1-13 | 10940/172.3 | 9281/1375.1 | -4.40 MB |
| inferno8-13 | 8-13 | 8-13 | 8-13 | 18986/197.7 | 15713/2707.1 | -7.26 MB |

Summary: Rust full quality outputs are smaller and now faster than Go on all five measured demos. With the current "favor time, keep RAM sane" target, Rust uses roughly 1.4-3.6 GB RSS. On a 16 GB machine, 60% RAM is about 9.8 GB, so the worst measured run stays well below the target ceiling.

## Functional Findings

- Scores match filename truth for both Go and Rust across all five demos.
- Rust and Go disagree on event/effect counts. These need field-by-field review, not blind copying from Go.
- Product rule update: replay events must include all kills, including post-round, bomb/explosion cleanup, and suicides. Rust now keeps post-round kills for the owning round within a bounded post-round window.
- On `dust1-13`, Rust now matches Go at 104 kills. The three previously missing kills were `World` self-kills after the useful round end in the final round.
- Bomb events match exactly on `dust1-13` after event-level inspection.
- Weapon fire and projectile frame counts are close in full quality, but not identical. Differences are small enough to inspect case-by-case.

## Optimization Findings

Current Rust full-quality cost centers from `ROUNDLAB_STATS`:

- `parse_ticks_ms`: still the largest parse phase, but typed tick row extraction substantially reduced it.
- `parse_projectiles_ms`: reduced by typed projectile extraction.
- `serialize_json_ms` / `write_output_ms`: still large. Round streaming reduces retained output memory but currently serializes round files, so it costs wall time.
- Peak RSS is still the biggest problem: current Rust no longer needs to retain every built `Round` before split writing, but the dominant peak is still tick/projectile parsing and grouped replay rows.

Typed projectile extraction removed the previous `serde_json::Value` conversion for projectile rows. On the five full-quality demos, Rust total time went from ~151s to ~128s, with identical projectile output counts. This is a real gain, but it does not solve the main memory problem; peak RSS is still dominated by full tick/frame materialization.

Typed tick row extraction removed the previous `serde_json::Value` conversion for player/tick rows. On the five full-quality demos, Rust total time went from ~128s to ~93s and max RSS went from ~5.5 GB to ~3.4 GB, with stable replay metrics and output sizes.

Round streaming writes each split round file as soon as the round is built instead of keeping the whole `Vec<Round>` until the manifest write. This kept Rust replay metrics stable, but by itself only reduced max RSS from ~3.36 GB to ~3.22 GB and increased total full-quality time from ~93s to ~138s. Because the current target favors time as long as RSS stays below roughly 60% of machine RAM, the CLI uses the faster parallel split writer again.

Removing full-column helper clones and interning repeated tick weapon strings plus projectile type strings improved the fast parallel run to ~82.8s total and ~3.58 GB max RSS. This is currently the better product tradeoff on the local 16 GB machine: faster than the prior ~93s Rust run, stable output metrics, and far below the ~9.8 GB RAM ceiling.

A quick test with `ROUNDLAB_PARSER_GZIP_LEVEL=1` on `dust1-13` did not improve full parse time and made output much larger, so gzip level alone is not the right optimization.

## Next Targets

1. Replace `rows_by_tick: BTreeMap<i32, Vec<TickRow>>` with a denser tick-group representation and avoid per-tick `Vec` overhead where possible.
2. Add optional bounded parallel round writing only if future demos approach the 60% RAM ceiling.
3. Keep event/effect divergences under review with `--keep-outputs`; only copy Go behavior when Go is clearly more correct for replay.
4. Add phase/RSS tracking per parser run to identify whether the remaining peak happens inside vendor parsing, grouping, or replay frame construction.
