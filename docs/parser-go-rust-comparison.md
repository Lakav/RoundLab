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
| ancient4-13 | 4-13 | 4-13 | 4-13 | 7363/66.5 | 1533/430.6 |
| anubis16-19 | 16-19 | 16-19 | 16-19 | 14095/58.5 | 3172/874.6 |
| cache11-13 | 11-13 | 11-13 | 11-13 | 9812/63.8 | 2377/576.3 |
| dust1-13 | 1-13 | 1-13 | 1-13 | 5111/57.2 | 1455/318.1 |
| inferno8-13 | 8-13 | 8-13 | 8-13 | 9832/65.7 | 2142/665.2 |

Summary: Rust is much faster in medium skip mode, but uses much more memory.

### Full quality

| demo | expected | Go score | Rust score | Go ms/RSS MB | Rust ms/RSS MB | Rust output delta |
| --- | --- | --- | --- | ---: | ---: | ---: |
| ancient4-13 | 4-13 | 4-13 | 4-13 | 14330/212.2 | 18036/1841.0 | -4.74 MB |
| anubis16-19 | 16-19 | 16-19 | 16-19 | 25747/178.3 | 38337/3103.0 | -11.00 MB |
| cache11-13 | 11-13 | 11-13 | 11-13 | 20776/192.2 | 27739/2526.7 | -9.19 MB |
| dust1-13 | 1-13 | 1-13 | 1-13 | 11164/191.0 | 14295/1333.4 | -4.40 MB |
| inferno8-13 | 8-13 | 8-13 | 8-13 | 18787/199.7 | 23760/2266.9 | -7.28 MB |

Summary: Rust full quality outputs are smaller, but the current streaming/compaction pass trades time for memory. Rust now uses roughly 1.3-3.1 GB RSS, down from the previous 1.7-3.4 GB, but it is slower than the prior Rust run on these five demos. Go stays around 178-212 MB RSS.

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

Round streaming writes each split round file as soon as the round is built instead of keeping the whole `Vec<Round>` until the manifest write. This kept Rust replay metrics stable, but by itself only reduced max RSS from ~3.36 GB to ~3.22 GB and increased total full-quality time from ~93s to ~138s.

Removing full-column helper clones and interning repeated tick weapon strings plus projectile type strings improved the final streaming run to ~122s total and ~3.10 GB max RSS. This is a real memory improvement, but it did not reach the sub-2 GB target. The remaining peak is almost certainly dominated by parser/vendor column storage, `rows_by_tick`, `projectiles_by_tick`, and per-frame player payloads.

A quick test with `ROUNDLAB_PARSER_GZIP_LEVEL=1` on `dust1-13` did not improve full parse time and made output much larger, so gzip level alone is not the right optimization.

## Next Targets

1. Add bounded parallel round writing so streaming keeps low retained memory without paying the full serial gzip cost.
2. Replace `rows_by_tick: BTreeMap<i32, Vec<TickRow>>` with a denser tick-group representation and avoid per-tick `Vec` overhead where possible.
3. Keep event/effect divergences under review with `--keep-outputs`; only copy Go behavior when Go is clearly more correct for replay.
4. Add phase/RSS tracking per parser run to identify whether the remaining peak happens inside vendor parsing, grouping, or replay frame construction.
