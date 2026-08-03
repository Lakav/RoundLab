# Production bundle review — 2026-08-03

The comparison uses clean static production exports from commit `6ff1b13` and
the optimized working tree. Initial route JavaScript is the sum of unique
scripts referenced by each exported HTML document. It excludes chunks fetched
only after user interaction.

| Asset or route | Before | After | Change |
| --- | ---: | ---: | ---: |
| All JavaScript, including deferred chunks | 2,127,110 B | 2,178,057 B | +2.4% |
| Initial `/` JavaScript | 931,804 B | 928,369 B | -0.4% |
| Initial `/feedback/` JavaScript | 822,906 B | 796,237 B | -3.2% |
| Initial `/match/` JavaScript | 1,530,645 B | 1,399,536 B | -8.6% |
| Parser WASM | 2,953,515 B | 2,953,515 B | unchanged |
| `logo.png` | 496,772 B | 167,949 B | -66.2% |

The total JavaScript output grows slightly because deferred entry chunks still
exist in the export. That cost no longer blocks the initial render. The global
2.4 MB ceiling remains a coarse build guardrail, while CI now enforces tighter
initial budgets for every public route.

## Analyzer findings

`next experimental-analyze --output` was run with Next.js 16.2.11. Its roughly
1.2 MB generated report was inspected locally and not committed. The main
findings were:

- Pixi remains the dominant replay dependency and is confined to `/match/`;
- the report implementation was part of the initial match graph even when the
  replay view was open;
- the debug console was present in every route graph;
- offline corpus builders, readiness checks and recurring-error analysis are
  not referenced by product entry points.

`MatchReport` now loads only when the report is opened and displays an
accessible skeleton while its chunk arrives. The debug console loads only when
its keyboard shortcut opens it. Benchmark contribution settings were separated
from the heavy contribution builder so IndexedDB validation does not depend on
the analysis engine.

The PNG logo keeps transparency and favicon/GitHub Pages compatibility. It was
resampled from 899×922 to 499×512 and visually compared before replacement; no
meaningful difference is visible at its product display sizes.
