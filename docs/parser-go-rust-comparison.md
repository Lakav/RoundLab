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
| ancient4-13 | 4-13 | 4-13 | 4-13 | 6761/63.5 | 1735/703.9 |
| anubis16-19 | 16-19 | 16-19 | 16-19 | 14512/58.2 | 3191/1403.7 |
| cache11-13 | 11-13 | 11-13 | 11-13 | 11253/63.6 | 2330/952.8 |
| dust1-13 | 1-13 | 1-13 | 1-13 | 5954/57.3 | 1294/511.4 |
| inferno8-13 | 8-13 | 8-13 | 8-13 | 10438/64.5 | 2324/993.3 |

Summary: Rust is much faster in medium skip mode, but uses much more memory.

### Full quality

| demo | expected | Go score | Rust score | Go ms/RSS MB | Rust ms/RSS MB | Rust output delta |
| --- | --- | --- | --- | ---: | ---: | ---: |
| ancient4-13 | 4-13 | 4-13 | 4-13 | 15371/221.4 | 19157/5526.1 | -4.92 MB |
| anubis16-19 | 16-19 | 16-19 | 16-19 | 29626/177.6 | 40313/5479.9 | -11.52 MB |
| cache11-13 | 11-13 | 11-13 | 11-13 | 21527/190.5 | 31291/5374.5 | -9.65 MB |
| dust1-13 | 1-13 | 1-13 | 1-13 | 11694/192.0 | 13436/4642.8 | -4.63 MB |
| inferno8-13 | 8-13 | 8-13 | 8-13 | 20199/199.1 | 24224/5369.6 | -7.61 MB |

Summary: Rust full quality outputs are smaller, but Rust is still slower than Go and uses roughly 4.6-5.5 GB RSS on these demos. Go stays around 178-221 MB RSS.

## Functional Findings

- Scores match filename truth for both Go and Rust across all five demos.
- Rust and Go disagree on event/effect counts. These need field-by-field review, not blind copying from Go.
- Product rule update: replay events must include all kills, including post-round, bomb/explosion cleanup, and suicides. Rust now keeps post-round kills for the owning round within a bounded post-round window.
- On `dust1-13`, Rust now matches Go at 104 kills. The three previously missing kills were `World` self-kills after the useful round end in the final round.
- Bomb events match exactly on `dust1-13` after event-level inspection.
- Weapon fire and projectile frame counts are close in full quality, but not identical. Differences are small enough to inspect case-by-case.

## Optimization Findings

Current Rust full-quality cost centers from `ROUNDLAB_STATS`:

- `parse_ticks_ms`: largest parse phase.
- `parse_projectiles_ms`: second largest parse phase when projectiles are enabled.
- `serialize_json_ms` / `write_output_ms`: large and repeated across demos.
- Peak RSS is the biggest problem: current Rust materializes large parser row sets and full replay output in memory before writing split round files.

Typed projectile extraction removed the previous `serde_json::Value` conversion for projectile rows. On the five full-quality demos, Rust total time went from ~151s to ~128s, with identical projectile output counts. This is a real gain, but it does not solve the main memory problem; peak RSS is still dominated by full tick/frame materialization.

A quick test with `ROUNDLAB_PARSER_GZIP_LEVEL=1` on `dust1-13` did not improve full parse time and made output much larger, so gzip level alone is not the right optimization.

## Next Targets

1. Reduce Rust peak memory by avoiding `serde_json::Value` rows for full tick/projectile data where typed structs are enough.
2. Move toward round streaming/spooling so full replay output does not remain entirely resident before split writing.
3. Keep event/effect divergences under review with `--keep-outputs`; only copy Go behavior when Go is clearly more correct for replay.
4. Add phase/RSS tracking per parser run to keep perf regressions visible.
