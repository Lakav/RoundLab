# Browser tests and coverage scope

## Unit coverage

The V8 report intentionally includes every runtime TypeScript and TSX file in
`web/src`, including report components, storage and migrations, UI components,
and Web Workers. Only type-only modules and generated WASM bindings are
excluded.

This is broader than the scope used before 2026-08-03, which omitted the report
and workers. The comparable baseline changed as follows:

| Scope | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Previous partial scope | 78.76% | 71.78% | 86.36% | 81.74% |
| Full runtime scope (2026-08-03) | 78.74% | 69.90% | 82.02% | 81.33% |

The lower branch and function percentages are a scope correction, not a code
regression. Global thresholds leave a small margin while targeted thresholds
protect the storage backend, the report, and workers independently.
The final measurement also includes the new App Router recovery boundaries and
privacy-preserving diagnostic UI; obsolete experimental coaching engines and
their self-only tests were removed before this measurement.

## Browser matrix

`pnpm test:e2e` builds the static export and runs:

- the real licensed `.dem.zst` import through Zstd, WASM and IndexedDB on
  Chromium, Firefox and WebKit;
- home, browser capability, persistence, backup/restore, replay and report
  smoke tests on those same three engines;
- the principal responsive layout using Chrome mobile emulation and WebKit
  iPhone emulation;
- the full accessibility suite on Chromium.

WebKit is a useful cross-engine indicator. It is not proof that the product was
validated on physical Safari hardware or a real iPhone.
