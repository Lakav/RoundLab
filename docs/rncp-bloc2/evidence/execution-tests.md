# Rapport d’exécution des contrôles

Généré le `2026-07-21T13:08:24+02:00`.

| Contrôle | Statut | Preuve |
| --- | --- | --- |
| `frontend-dependency-audit` | **PASS** | `logs/frontend-dependency-audit.txt (exit 0)` |
| `frontend-lint` | **PASS** | `logs/frontend-lint.txt (exit 0)` |
| `frontend-typecheck` | **PASS** | `logs/frontend-typecheck.txt (exit 0)` |
| `frontend-coverage` | **PASS** | `logs/frontend-coverage.txt (exit 0)` |
| `frontend-build` | **PASS** | `logs/frontend-build.txt (exit 0)` |
| `frontend-performance-budgets` | **PASS** | `logs/frontend-performance-budgets.txt (exit 0)` |
| `browser-benchmark-evidence` | **PASS** | `logs/browser-benchmark-evidence.txt (exit 0)` |
| `frontend-e2e-accessibility` | **PASS** | `logs/frontend-e2e-accessibility.txt (exit 0)` |
| `frontend-pages-build` | **PASS** | `logs/frontend-pages-build.txt (exit 0)` |
| `rust-format` | **PASS** | `logs/rust-format.txt (exit 0)` |
| `rust-tests` | **PASS** | `logs/rust-tests.txt (exit 0)` |
| `rust-wasm-check` | **PASS** | `logs/rust-wasm-check.txt (exit 0)` |
| `rust-clippy` | **PASS** | `logs/rust-clippy.txt (exit 0)` |
| `rust-dependency-audit` | **PASS** | `logs/rust-dependency-audit.txt (exit 0)` |
| `portable-audits` | **PASS** | `logs/portable-audits.txt (exit 0)` |
| `recipe-summary` | **PASS** | `logs/recipe-summary.txt (exit 0)` |
| `wasm-reproducibility` | **PASS** | `logs/wasm-reproducibility.txt (exit 0)` |
| `rust-real-demo-reference` | **PASS** | `logs/rust-real-demo-reference.txt (exit 0)` |
| `rust-coverage` | **PASS** | `coverage/rust/coverage-summary.json et logs/rust-coverage.txt (exit 0)` |

`BLOQUÉ` signifie que le contrôle n’a pas été exécuté ; il ne vaut jamais succès.

## Vérifications distantes

Les CI de PR et de `main`, les déploiements, les smokes publics, les rollbacks, les restaurations et le garde-fou strict sont consignés avec leurs URL et SHA dans `deployment-runs-2026-07-21.md`. Cette synthèse locale ne duplique pas leurs statuts et ne transforme pas l'échec attendu du garde-fou en échec technique.
