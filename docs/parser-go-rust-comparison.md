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
python3 scripts/audit-reference-snapshots.py --report .roundlab-compare/full-round-audit-projectile-integrity.json
```

Use `--keep-outputs` for targeted event-level debugging.
The generated Markdown report now includes a `Rust Phase Timings` section from
`ROUNDLAB_STATS`, with read, vendor parse, grouping, round build, write output,
JSON serialization, and max RSS per demo.
Round-audit Markdown also includes an `Audit Summary` section that aggregates
diff fields, missing/extra Rust counts, classification totals, and any remaining
unclassified mismatches across all demos.
`scripts/audit-reference-snapshots.py` is a read-only guard for saved reports:
it checks that `parser/reference_demos.json` still matches the Rust side of a
full-quality Go/Rust round audit, that filename/Go/Rust scores agree, and that
the report has no unclassified or critical kill/bomb signature deltas. The
round-audit JSON now carries the same compact Rust snapshot signatures used by
the integration tests, so the read-only audit also verifies per-round
kill/bomb, terminal-event, utility-effect, weapon-fire, bomb-state,
active-action, and projectile-track signatures. It needs the JSON report, not only the Markdown
summary. It intentionally does not regenerate snapshots and does not claim exact
tick-by-tick parity.

The Rust integration tests can also validate the local reference demos directly
without committing demo files. These tests use `parser/reference_demos.json` as
strict lightweight metric snapshots, not loose lower bounds, so intentional
parser output changes must update the snapshot deliberately. The snapshots now
include both aggregate demo metrics and compact per-round metrics for scores,
frames, events, kills, bomb events, utility effects, weapon fires, projectile
frames, and projectile samples. They also include compact per-round kill and
bomb-event signatures, so changes to killer/victim/assist/weapon/headshot or
bomb event type/player/timing fail deliberately. Terminal event signatures also
lock the ordered replay context around `round_end`, `bomb_exploded`, post-round
kills, suicides, world kills, and C4 kills, so those special kill cases cannot
hide behind separate kill and bomb-event lists. Bomb frame state is locked with
compact carried/dropped/planted windows including bucketed timing, frame sample
count, end cause, carrier, and bucketed start/end position, so bomb visibility
or ownership regressions cannot hide behind unchanged frame counts. Active
actions are locked with compact per-player plant/utility windows including
bucketed timing, item, elapsed timing, sample count, and duration; this validates
the visible replay cue, not whether a grenade later detonated. Utility effects
are now locked with compact per-round signatures for bucketed timing, duration,
kind, team, and position, so smoke/flash/HE/fire/decoy/bomb-plant regressions
cannot hide behind unchanged effect counts. Weapon fires are also locked with
compact per-round signatures for bucketed timing, shooter, normalized weapon,
team, position, and yaw, so wrong shooter/weapon/pose regressions cannot hide
behind unchanged fire counts. Targeted unit coverage also locks exact-tick
shooter pose lookup, previous-tick pose fallback, and event retention when no
shooter pose is available; pose lookup is bounded to the current round so stale
positions from earlier rounds cannot leak into weapon fires, planted bomb
effects, or synthesized flash ownership. Projectile tracks are locked with compact
per-round signatures for id, normalized type, thrower, bucketed timing, sample
count, and bucketed start/end position, so grouping or identity regressions
cannot hide behind unchanged projectile-frame counts. The full-quality test also
locks the split JSON contract expected by Tauri: manifest rounds keep empty
`frames`, `events`, `effects`, `weaponFires`, and `projectileFrames` arrays plus
`roundFile`, while split round files contain the full replay arrays without a
recursive `roundFile`. Tauri validation now also rejects split round payloads
where `effects`, `weaponFires`, or `projectileFrames` are missing or not arrays.

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
| ancient4-13 | 4-13 | 4-13 | 4-13 | 14843/187.8 | 13822/2075.2 | -5.70 MB |
| anubis16-19 | 16-19 | 16-19 | 16-19 | 27149/184.3 | 26598/2616.5 | -11.03 MB |
| cache11-13 | 11-13 | 11-13 | 11-13 | 19963/190.9 | 21470/2605.4 | -9.18 MB |
| dust1-13 | 1-13 | 1-13 | 1-13 | 10906/175.0 | 11029/1414.3 | -4.38 MB |
| inferno8-13 | 8-13 | 8-13 | 8-13 | 18639/198.2 | 19013/2517.0 | -7.26 MB |

Summary: Rust full quality outputs are smaller and faster than Go on most demos in this run. With the current "favor time, keep RAM sane" target, Rust uses roughly 1.4-2.6 GB RSS on the current five-demo run. On a 16 GB machine, 60% RAM is about 9.8 GB, so the worst measured run stays well below the target ceiling.

## Functional Findings

- Scores match filename truth for both Go and Rust across all five demos.
- Rust and Go still disagree on frame/effect/weapon-fire/projectile counts. These need field-by-field review, not blind copying from Go.
- Product rule update: replay events must include all kills, including post-round, bomb/explosion cleanup, and suicides. Rust now keeps post-round kills for the owning round within a bounded post-round window.
- On `dust1-13`, Rust now matches Go at 104 kills. The three previously missing kills were `World` self-kills after the useful round end in the final round.
- On `ancient4-13`, Rust previously kept an initial knife round, which shifted round-by-round comparisons and inflated kills/round count. The knife-round detector now accepts longer knife duels, and Ancient now reports 17 real rounds / 123 kills instead of 18 rounds / 132 kills.
- The round audit currently shows Rust kill signatures matching Go on every audited round across the five reference demos after weapon-name normalization. The audit normalizes engine aliases such as M4 family names, `elite`/`dualberettas`, `hkp2000`/`p2000`, and fire kills reported as `inferno` vs `molotov`/`incendiary`.
- Rust now matches Go aggregate `events`, `kills`, and `bombEvents` on all five full-quality reference demos. The fixes keep `round_win_reason`, synthesize missing post-round `bomb_exploded` events for bounded `ct_killed` after-plant cases, and synthesize missing `bomb_defuse_abort` events when defuse starts are repeated or the bomb explodes during an active defuse.
- Bomb events are now audited with a tolerant matcher instead of only bucketed strict signatures. On the latest five-demo full audit, Rust has 0 missing and 0 extra bomb events after matching by type/player. The remaining 10 timing mismatches across 8 rounds are all classified: 6 `synthesized_defuse_abort_timing` cases and 4 `small_explosion_timing_offset` cases. Exact timestamps are not fully identical to Go, but event presence/counts and visible bomb resolution are coherent. A targeted check of Rust frames around the defuse cases did not expose a reliable `useKey` signal, so earlier abort synthesis would be guesswork for now.
- Frame bomb state now consumes the same synthesized `bomb_exploded` decisions as round events. Rust no longer leaves a planted/carried bomb visible after synthetic explosions or defuses. The audit now compares bomb-state windows instead of only raw counts. On the latest five-demo full audit, all 83 bomb-state window deltas are classified with 0 unclassified cases: 47 `single_frame_boundary_shift`, 34 `go_post_resolution_dropped_residue`, 3 `go_post_round_bomb_residue`, and 2 `boundary_shift`. Transition inspection confirms Go keeps a `dropped` bomb after resolution or after post-round carrier death, while Rust clears bomb state at visible round resolution.
- Utility effects are now better classified: Go emits duplicate flash effects for the same flashbang on every reference demo, while Rust emits one visual effect. The harness dedupes near-identical raw flash effects before bucketed signature comparison so boundary-rounding artifacts do not look like missing Rust flashes.
- Rust reconstructs terminal flash detonations from projectile frames when demoparser Rust misses a `flashbang_detonate` at round end. This fixes the Anubis round 18 missing unique flash. Dust 7 and Inferno 13 were confirmed as Go duplicate/bucket artifacts, not missing Rust flashes.
- Decoy timing now uses the projectile's first stationary tick instead of `decoy_detonate - 15s`. Ancient 12/16 now match deduped effect signatures. The harness now compares deduped effects with tolerance and classifies the only remaining deduped utility mismatch: Inferno round 2 decoy is `29.25s` in Rust vs `29.406s` in Go, same team and position, classified as `decoy_stationary_vs_event_timing`. Projectile frames show the decoy reaches its final position at `29.25s`, so this is not treated as a missing replay feature.
- Weapon fire and projectile frame counts are close in full quality, but not identical. After weapon alias normalization, remaining weapon-fire count deltas are small and round-local. The harness now uses ordered dynamic matching by `shooter` + normalized weapon, using a stricter firearm tolerance and a wider grenade tolerance. This avoids shifting an entire AK/M4 burst when one shot is missing, while grenade throw timestamp offsets still do not look like missing events. It also classifies unmatched fire deltas.
- The latest five-demo full audit reports zero pose mismatches for matched weapon fires. Remaining unmatched weapon fires are 26 extra Rust fires and 3 missing Rust fires. The 26 extra Rust fires are classified as 21 `near_related_kill` and 5 `grenade_weapon_fire`. The 3 missing Rust fires are classified as 2 `near_related_kill` and 1 `adjacent_same_shooter_burst_gap`. The Cache round 11 gap is an AK-47 shot at `t=46.328`; Rust has the same shooter/weapon burst continuing at `46.406+`, but the underlying Rust event stream does not expose a safe missing `weapon_fire` source at the skipped tick.
- A Rust-side attempt to synthesize missing firearm `weaponFires` from tick-row `FIRE` state was rejected. Raw `FIRE` is held across many ticks and generated thousands of false extra shots even when restricted to rising edges, so it is not a safe source for weapon-fire reconstruction without deeper shot-cadence/recoil modeling.
- `demoparser-rust` also exposes a custom `fire_bullets` message, but it does not solve the remaining weapon-fire gap. On Cache, `fire_bullets` exists globally (`2635` events in the demo), but neither `weapon_fire` nor `fire_bullets` is emitted around the confirmed missing tick `81163` for the two simultaneous AK-47 shots. Adding `fire_bullets` as a fallback left the five-demo weapon-fire audit unchanged, so the fallback was rejected as dead complexity.
- Projectile frame auditing now checks track count, duplicate projectiles per frame, near-identical physical duplicates in one frame, frame monotonicity, track breaks, teleport-like jumps, and tolerant track matching by normalized type, thrower, time, and 3D start/end position. Rust now keeps IDs through small terminal grenade snaps by using a conservative 128-unit continuity floor instead of 90 units. This fixed confirmed smoke splits on Cache round 8 and Anubis round 29 without reintroducing the previous overmerge bug.
- On the latest five-demo full audit, Rust and Go both have 1870 projectile tracks. Rust has zero duplicate projectiles, zero non-monotonic projectile frames, zero track breaks, and zero teleport-like jumps. Go has zero duplicates but 101 non-monotonic projectile frames and 280 track breaks, so exact Go projectile continuity is not a clean oracle.
- Remaining projectile track tolerance deltas are limited and now classified: 3 rounds differ, with 0 missing Rust tracks, 0 extra Rust tracks, 6 tolerant mismatches, and 0 unclassified mismatches. Four are `post_round_smoke_duration` cases where Rust stops projectile samples at `round_end` while Go keeps stationary smoke projectile samples after the round; the smoke visual duration is already represented by `effects`. Two are `overlapping_same_thrower_projectile` cases on Inferno round 17 where the same player throws repeated HE grenades on nearly identical paths, making ID attribution ambiguous even though type, thrower, and positions remain coherent.
- Bomb state raw frame counts still differ frequently, but the window audit now classifies the five-demo differences. The remaining deltas are not treated as missing Rust replay state unless exact Go residue emulation becomes a requirement.
- `ROUNDLAB_TEST_DEMOS` integration coverage is stricter now. Full-quality local tests enforce structural replay invariants in addition to strict reference-demo snapshots: aggregate metrics, per-round scores/counts, per-round kill/bomb-event/bomb-state/active-action/utility-effect/weapon-fire/projectile-track signatures, monotonic round scores, sorted events and frames, bounded post-round events, no bomb state after bomb defuse/explosion, valid utility effects, valid weapon-fire pose fields, monotonic projectile frames, no duplicate projectile identity or near-identical physical duplicate inside a frame, no projectile track time breaks, and no teleport-like projectile jumps. The full five-demo release test passed locally; the debug test binary is intentionally not used for the full set because it is much slower.

## Optimization Findings

Current Rust full-quality cost centers from `ROUNDLAB_STATS` are now visible in
the generated comparison Markdown. On the latest five-demo full run, Rust took
~91.9s total wall time with ~2.62 GB peak RSS. Aggregated Rust phase timings:

- `write_output_ms`: ~56.9s total, currently the largest measured phase.
- `serialize_json_ms`: ~36.4s inside write output, so JSON serialization is the biggest confirmed write cost.
- vendor parse phase (`create_huffman` + header/players/events/ticks/teams/projectiles): ~28.0s total.
- `build_rounds_ms`: ~3.2s total.
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

1. Decide how strict weapon-fire parity really needs to be. The remaining missing Rust cases appear to come from demoparser-rust event extraction; tick-row `FIRE` is too noisy and `fire_bullets` does not cover the confirmed Cache gap. The current audit has 0 unclassified mismatches, but exact Go weapon-fire parity is still not proven.
2. Inspect the remaining bomb-event timing/order deltas in the replay UI only if exact event timestamp parity becomes required; event counts and visible bomb resolution are currently coherent.
3. If performance work resumes, target `write_output_ms` / `serialize_json_ms` first, then vendor parsing. Do not trade away replay fidelity for smaller micro-gains.
