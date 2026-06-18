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
python3 scripts/compare-parsers.py --quality full --round-audit --out .roundlab-compare/full-round-audit-replay-fidelity-kill-fire-normalized.json
python3 scripts/compare-parsers.py --build-rust --quality full --round-audit --out .roundlab-compare/full-round-audit-projectile-integrity.json
```

Use `--keep-outputs` for targeted event-level debugging.

## Results

### Medium + skipProjectiles + skipWeaponFires

| demo | expected | Go score | Rust score | Go ms/RSS MB | Rust ms/RSS MB |
| --- | --- | --- | --- | ---: | ---: |
| ancient4-13 | 4-13 | 4-13 | 4-13 | 7240/67.7 | 1486/443.7 |
| anubis16-19 | 16-19 | 16-19 | 16-19 | 17013/57.2 | 2814/897.6 |
| cache11-13 | 11-13 | 11-13 | 11-13 | 10274/61.7 | 2198/593.0 |
| dust1-13 | 1-13 | 1-13 | 1-13 | 5962/51.8 | 1257/327.8 |
| inferno8-13 | 8-13 | 8-13 | 8-13 | 10017/62.1 | 2142/651.6 |

Summary: Rust is much faster in medium skip mode, but uses much more memory.

### Full quality

| demo | expected | Go score | Rust score | Go ms/RSS MB | Rust ms/RSS MB | Rust output delta |
| --- | --- | --- | --- | ---: | ---: | ---: |
| ancient4-13 | 4-13 | 4-13 | 4-13 | 14958/219.8 | 14450/1974.9 | -5.69 MB |
| anubis16-19 | 16-19 | 16-19 | 16-19 | 27020/186.0 | 26765/2711.6 | -11.05 MB |
| cache11-13 | 11-13 | 11-13 | 11-13 | 20956/184.2 | 21396/2334.0 | -9.22 MB |
| dust1-13 | 1-13 | 1-13 | 1-13 | 10600/189.5 | 10468/1315.6 | -4.39 MB |
| inferno8-13 | 8-13 | 8-13 | 8-13 | 18911/198.0 | 18072/2555.4 | -7.28 MB |

Summary: Rust full quality outputs are smaller and faster than Go on most demos in this run. With the current "favor time, keep RAM sane" target, Rust uses roughly 1.3-2.7 GB RSS on the current five-demo run. On a 16 GB machine, 60% RAM is about 9.8 GB, so the worst measured run stays well below the target ceiling.

## Functional Findings

- Scores match filename truth for both Go and Rust across all five demos.
- Rust and Go still disagree on frame/effect/weapon-fire/projectile counts. These need field-by-field review, not blind copying from Go.
- Product rule update: replay events must include all kills, including post-round, bomb/explosion cleanup, and suicides. Rust now keeps post-round kills for the owning round within a bounded post-round window.
- On `dust1-13`, Rust now matches Go at 104 kills. The three previously missing kills were `World` self-kills after the useful round end in the final round.
- On `ancient4-13`, Rust previously kept an initial knife round, which shifted round-by-round comparisons and inflated kills/round count. The knife-round detector now accepts longer knife duels, and Ancient now reports 17 real rounds / 123 kills instead of 18 rounds / 132 kills.
- The round audit currently shows Rust kill signatures matching Go on every audited round across the five reference demos after weapon-name normalization. The audit normalizes engine aliases such as M4 family names, `elite`/`dualberettas`, `hkp2000`/`p2000`, and fire kills reported as `inferno` vs `molotov`/`incendiary`.
- Rust now matches Go aggregate `events`, `kills`, and `bombEvents` on all five full-quality reference demos. The fixes keep `round_win_reason`, synthesize missing post-round `bomb_exploded` events for bounded `ct_killed` after-plant cases, and synthesize missing `bomb_defuse_abort` events when defuse starts are repeated or the bomb explodes during an active defuse.
- Bomb event signatures still have timing/order differences on six audited rounds: Ancient 9/14, Anubis 23, Cache 11, Inferno 2/11/20. The counts and event types now match, but exact timestamps are not fully identical to Go.
- Frame bomb state now consumes the same synthesized `bomb_exploded` decisions as round events. Rust no longer leaves a planted/carried bomb visible after synthetic explosions. Some `framesWithBombState` deltas got larger because Go keeps a `dropped` bomb after explosion on inspected rounds such as Anubis 23/26/29; that is treated as a Go artifact unless the UI proves otherwise.
- Utility effects are now better classified: Go emits duplicate flash effects for the same flashbang on every reference demo, while Rust emits one visual effect. The harness dedupes near-identical raw flash effects before bucketed signature comparison so boundary-rounding artifacts do not look like missing Rust flashes.
- Rust reconstructs terminal flash detonations from projectile frames when demoparser Rust misses a `flashbang_detonate` at round end. This fixes the Anubis round 18 missing unique flash. Dust 7 and Inferno 13 were confirmed as Go duplicate/bucket artifacts, not missing Rust flashes.
- Decoy timing now uses the projectile's first stationary tick instead of `decoy_detonate - 15s`. Ancient 12/16 now match deduped effect signatures. One deduped utility effect signature still differs: Inferno round 2 decoy is `29.25s` in Rust vs `29.5s` bucketed in Go, with matching team and position.
- Weapon fire and projectile frame counts are close in full quality, but not identical. After weapon alias normalization, remaining weapon-fire count deltas are small and round-local. The harness now also performs tolerant fire-pose matching on `shooter`, weapon, time, `x/y/z`, `yaw`, and `team`; the latest five-demo full audit reports zero pose mismatches for matched fires. Remaining unmatched weapon fires are rare across the full set: 26 extra Rust fires and 3 missing Rust fires, still requiring targeted review before claiming full parity.
- Projectile frame auditing now checks track count, duplicate projectiles per frame, frame monotonicity, track breaks, teleport-like jumps, and tolerant track matching by normalized type, thrower, time, and start/end position. Rust now keeps IDs through small terminal grenade snaps by using a conservative 128-unit continuity floor instead of 90 units. This fixed confirmed smoke splits on Cache round 8 and Anubis round 29 without reintroducing the previous overmerge bug.
- On the latest five-demo full audit, Rust and Go both have 1870 projectile tracks. Rust has zero duplicate projectiles, zero non-monotonic projectile frames, zero track breaks, and zero teleport-like jumps. Go has zero duplicates but 101 non-monotonic projectile frames and 280 track breaks, so exact Go projectile continuity is not a clean oracle.
- Remaining projectile track tolerance deltas are limited and now classified: 3 rounds differ, with 0 missing Rust tracks, 0 extra Rust tracks, 6 tolerant mismatches, and 0 unclassified mismatches. Four are `post_round_smoke_duration` cases where Rust stops projectile samples at `round_end` while Go keeps stationary smoke projectile samples after the round; the smoke visual duration is already represented by `effects`. Two are `overlapping_same_thrower_projectile` cases on Inferno round 17 where the same player throws repeated HE grenades on nearly identical paths, making ID attribution ambiguous even though type, thrower, and positions remain coherent.
- Bomb state frame counts still differ frequently. Many differences are one-frame boundary shifts or Go's post-explosion dropped-bomb residue, but some dropped-state windows still need targeted replay/UI inspection before claiming full parity.

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

1. Inspect remaining bomb-state frame deltas in the replay UI, excluding confirmed Go post-explosion dropped-bomb residue.
2. Tighten remaining bomb-event signature timing/order if replay UI needs exact Go parity instead of matching event presence and counts.
3. Investigate the remaining Inferno round 2 decoy timing difference and decide whether Rust's stationary-projectile timing is preferable to Go's later event timing.
4. Review the remaining unmatched weapon-fire deltas case-by-case, especially whether extra Rust fires without matching projectile/effect evidence are useful replay events or demoparser noise.
5. Review the remaining unmatched weapon-fire deltas case-by-case in the same style as projectiles: first classify explained differences, then only patch Rust when a real replay bug is proven.
6. Add phase/RSS tracking per parser run to identify whether the remaining peak happens inside vendor parsing, grouping, or replay frame construction.
