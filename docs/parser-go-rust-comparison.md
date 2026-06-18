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
The generated Markdown report now includes a `Rust Phase Timings` section from
`ROUNDLAB_STATS`, with read, vendor parse, grouping, round build, write output,
JSON serialization, and max RSS per demo.

The Rust integration tests can also validate the local reference demos directly
without committing demo files:

```bash
cd parser
ROUNDLAB_TEST_DEMOS="/abs/path/ancient4-13.dem.zst:/abs/path/anubis16-19.dem.zst:/abs/path/cache11-13.dem.zst:/abs/path/dust1-13.dem.zst:/abs/path/inferno8-13.dem.zst" cargo test --release roundlab_test_demo_produces_replay_json_when_configured -- --nocapture
ROUNDLAB_TEST_DEMOS="/abs/path/ancient4-13.dem.zst:/abs/path/anubis16-19.dem.zst:/abs/path/cache11-13.dem.zst:/abs/path/dust1-13.dem.zst:/abs/path/inferno8-13.dem.zst" cargo test --release roundlab_test_demo_honors_quality_and_skip_options_when_configured -- --nocapture
```

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
- Bomb events are now audited with a tolerant matcher instead of only bucketed strict signatures. On the latest five-demo full audit, Rust has 0 missing and 0 extra bomb events after matching by type/player. The remaining 10 timing mismatches across 8 rounds are all classified: 6 `synthesized_defuse_abort_timing` cases and 4 `small_explosion_timing_offset` cases. Exact timestamps are not fully identical to Go, but event presence/counts and visible bomb resolution are coherent. A targeted check of Rust frames around the defuse cases did not expose a reliable `useKey` signal, so earlier abort synthesis would be guesswork for now.
- Frame bomb state now consumes the same synthesized `bomb_exploded` decisions as round events. Rust no longer leaves a planted/carried bomb visible after synthetic explosions or defuses. Transition inspection confirms Go keeps a `dropped` bomb at the plant site after resolution, for example Ancient 4, Cache 1, Anubis 23/26, and Inferno 2/20. These `framesWithBombState`/`dropped` deltas are treated as Go visual residue, not missing Rust state.
- Utility effects are now better classified: Go emits duplicate flash effects for the same flashbang on every reference demo, while Rust emits one visual effect. The harness dedupes near-identical raw flash effects before bucketed signature comparison so boundary-rounding artifacts do not look like missing Rust flashes.
- Rust reconstructs terminal flash detonations from projectile frames when demoparser Rust misses a `flashbang_detonate` at round end. This fixes the Anubis round 18 missing unique flash. Dust 7 and Inferno 13 were confirmed as Go duplicate/bucket artifacts, not missing Rust flashes.
- Decoy timing now uses the projectile's first stationary tick instead of `decoy_detonate - 15s`. Ancient 12/16 now match deduped effect signatures. The harness now compares deduped effects with tolerance and classifies the only remaining deduped utility mismatch: Inferno round 2 decoy is `29.25s` in Rust vs `29.406s` in Go, same team and position, classified as `decoy_stationary_vs_event_timing`. Projectile frames show the decoy reaches its final position at `29.25s`, so this is not treated as a missing replay feature.
- Weapon fire and projectile frame counts are close in full quality, but not identical. After weapon alias normalization, remaining weapon-fire count deltas are small and round-local. The harness now performs sequential tolerant fire-pose matching by `shooter` + normalized weapon, using a stricter firearm tolerance and a wider grenade tolerance so rapid AK/M4 bursts do not get misaligned while grenade throw timestamp offsets do not look like missing events. It also classifies unmatched fire deltas.
- The latest five-demo full audit reports zero pose mismatches for matched weapon fires. Remaining unmatched weapon fires are 26 extra Rust fires and 3 missing Rust fires. The 26 extra Rust fires are classified as 21 `near_related_kill` and 5 `grenade_weapon_fire`. The 3 missing Rust fires are 2 `near_related_kill` and 1 unclassified Cache round 11 AK-47 shot at `t=46.328`.
- A Rust-side attempt to synthesize missing firearm `weaponFires` from tick-row `FIRE` state was rejected. Raw `FIRE` is held across many ticks and generated thousands of false extra shots even when restricted to rising edges, so it is not a safe source for weapon-fire reconstruction without deeper shot-cadence/recoil modeling.
- Projectile frame auditing now checks track count, duplicate projectiles per frame, frame monotonicity, track breaks, teleport-like jumps, and tolerant track matching by normalized type, thrower, time, and start/end position. Rust now keeps IDs through small terminal grenade snaps by using a conservative 128-unit continuity floor instead of 90 units. This fixed confirmed smoke splits on Cache round 8 and Anubis round 29 without reintroducing the previous overmerge bug.
- On the latest five-demo full audit, Rust and Go both have 1870 projectile tracks. Rust has zero duplicate projectiles, zero non-monotonic projectile frames, zero track breaks, and zero teleport-like jumps. Go has zero duplicates but 101 non-monotonic projectile frames and 280 track breaks, so exact Go projectile continuity is not a clean oracle.
- Remaining projectile track tolerance deltas are limited and now classified: 3 rounds differ, with 0 missing Rust tracks, 0 extra Rust tracks, 6 tolerant mismatches, and 0 unclassified mismatches. Four are `post_round_smoke_duration` cases where Rust stops projectile samples at `round_end` while Go keeps stationary smoke projectile samples after the round; the smoke visual duration is already represented by `effects`. Two are `overlapping_same_thrower_projectile` cases on Inferno round 17 where the same player throws repeated HE grenades on nearly identical paths, making ID attribution ambiguous even though type, thrower, and positions remain coherent.
- Bomb state frame counts still differ frequently. Many differences are one-frame boundary shifts or Go's post-explosion dropped-bomb residue, but some dropped-state windows still need targeted replay/UI inspection before claiming full parity.
- `ROUNDLAB_TEST_DEMOS` integration coverage is stricter now. Full-quality local tests enforce structural replay invariants in addition to reference-demo metric floors: monotonic round scores, sorted events and frames, bounded post-round events, no bomb state after bomb defuse/explosion, valid utility effects, valid weapon-fire pose fields, monotonic projectile frames, and no duplicate projectile identity inside a frame. The full five-demo release test passed locally; the debug test binary is intentionally not used for the full set because it is much slower.

## Optimization Findings

Current Rust full-quality cost centers from `ROUNDLAB_STATS` are now visible in
the generated comparison Markdown. On the latest five-demo full run, Rust took
~88.0s total wall time with ~3.04 GB peak RSS. Aggregated Rust phase timings:

- `write_output_ms`: ~53.2s total, currently the largest measured phase.
- `serialize_json_ms`: ~34.1s inside write output, so JSON serialization is the biggest confirmed write cost.
- vendor parse phase (`create_huffman` + header/players/events/ticks/teams/projectiles): ~28.0s total.
- `build_rounds_ms`: ~3.1s total.
- grouping: ~0.5s total.
- read/decompress: ~1.8s total.

This changes the performance diagnosis: after the typed extraction work, replay
fidelity work should not assume `build_rounds` is the main remaining cost. The
next meaningful optimization target is split-output serialization/write cost,
followed by vendor tick/projectile parsing. Any optimization still has to keep
the full replay invariants and Go/Rust audit classifications stable.

Typed projectile extraction removed the previous `serde_json::Value` conversion for projectile rows. On the five full-quality demos, Rust total time went from ~151s to ~128s, with identical projectile output counts. This is a real gain, but it does not solve the main memory problem; peak RSS is still dominated by full tick/frame materialization.

Typed tick row extraction removed the previous `serde_json::Value` conversion for player/tick rows. On the five full-quality demos, Rust total time went from ~128s to ~93s and max RSS went from ~5.5 GB to ~3.4 GB, with stable replay metrics and output sizes.

Round streaming writes each split round file as soon as the round is built instead of keeping the whole `Vec<Round>` until the manifest write. This kept Rust replay metrics stable, but by itself only reduced max RSS from ~3.36 GB to ~3.22 GB and increased total full-quality time from ~93s to ~138s. Because the current target favors time as long as RSS stays below roughly 60% of machine RAM, the CLI uses the faster parallel split writer again.

Removing full-column helper clones and interning repeated tick weapon strings plus projectile type strings improved the fast parallel run to ~82.8s total and ~3.58 GB max RSS. This is currently the better product tradeoff on the local 16 GB machine: faster than the prior ~93s Rust run, stable output metrics, and far below the ~9.8 GB RAM ceiling.

A quick test with `ROUNDLAB_PARSER_GZIP_LEVEL=1` on `dust1-13` did not improve full parse time and made output much larger, so gzip level alone is not the right optimization.

## Next Targets

1. Decide how strict weapon-fire parity really needs to be. The remaining missing Rust cases appear to come from demoparser-rust event extraction, and tick-row `FIRE` is too noisy to use directly.
2. Inspect the remaining bomb-event timing/order deltas in the replay UI only if exact event timestamp parity becomes required; event counts and visible bomb resolution are currently coherent.
3. If performance work resumes, target `write_output_ms` / `serialize_json_ms` first, then vendor parsing. Do not trade away replay fidelity for smaller micro-gains.
