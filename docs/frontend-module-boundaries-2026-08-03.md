# Frontend module boundaries — 2026-08-03

This refactor is deliberately incremental: it preserves the report schema, rendered behavior,
global player selection, same-team comparison, replay output, and existing tests. The remaining
orchestrators are still substantial, but domain logic no longer has to accumulate in a single file.

## Match report

`MatchReport.tsx` remains the stateful report orchestrator. Its size moved from 3,660 lines at the
maintenance baseline to 2,970 lines. Responsibilities extracted from it are:

- `ReportNavigation.tsx`: primary and secondary navigation controls;
- `GlobalPlayerSelector.tsx`: the player selection shared by all player-specific sections;
- `ReportHero.tsx`: match identity, score and data-completeness summary;
- `ReportQuality.tsx`: metric primitives, quality metadata and the data-quality table;
- `report-actions.ts`: pure selectors for replayable trade and utility evidence;
- `report-formatters.ts`: labels and number, ratio and percentage formatting;
- `report-types.ts`: component and navigation contracts.

The individual large statistical views remain in the orchestrator for now. Pulling them out safely
requires typed view-models per domain; moving JSX alone would only trade one large file for a large
prop surface. This is known structural debt, not a completed rewrite.

## Match analysis

`analyze-match.ts` remains responsible for walking rounds, associating evidence and assembling the
final result. Its size moved from 2,633 to 2,300 lines. Extracted pure domains are:

- `analyze-match-utility.ts`: grenade classification, flash aggregation, utility damage and utility
  quantity rating;
- `analyze-match-aggregation.ts`: player-side, economy-bucket and logical-team aggregation.

Combat event association and round traversal remain coupled in the orchestrator. They should only
be split behind richer round-domain fixtures because their ordering and availability semantics are
part of the output contract.

## Replay map renderer

`MapRenderer.tsx` now contains React/Pixi orchestration and frame composition. Its size moved from
1,535 to 1,299 lines. The renderer delegates to:

- `map-renderer-pixi.ts`: Pixi lifecycle, resize loop and destruction queues;
- `map-renderer-player.ts`: player sprites, labels, sampled positions and HUD geometry;
- `map-renderer-projectile.ts`: projectile tracks, interpolation and hand-off diagnostics;
- `map-renderer-effect.ts`: smoke, fire and decoy effects;
- `map-renderer-bomb.ts`: bomb, plant, defuse and explosion state;
- `map-renderer-icons.ts`: icon discovery, loading, caching and cooperative preloading;
- `map-renderer-math.ts`: deterministic interpolation and color helpers.

The remaining renderer is still large because its animation callback coordinates all these layers.
Further separation should target a typed frame view-model before extracting more imperative code.

## Verification

The extraction is guarded by the existing analysis, report, replay and renderer suites. No formula
version, parser output, report value, route, persisted player-selection state or replay rendering
contract was intentionally changed.
