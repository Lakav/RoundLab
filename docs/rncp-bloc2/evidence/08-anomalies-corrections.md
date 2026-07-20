# Anomalies détectées, corrigées et retestées

| ID / recette | Gravité | Cause | Correction et commit | Test ajouté / re-test | Résultat |
| --- | --- | --- | --- | --- | --- |
| RL-2026-001 / REC-08 | majeure | snapshot Dust2 antérieur à la gestion des dernières expirations d'inferno | retenir la dernière expiration proche et régénérer uniquement les signatures réelles ; `3d2b54d` | `fire_effect_uses_latest_nearby_cell_expire`, démo Dust2 release | CORRIGÉ |
| RL-2026-002 / REC-11 | majeure sécurité | Next/PostCSS, js-yaml et crossbeam obsolètes | Next 16.2.10, PostCSS 8.5.10 justifié, résolution js-yaml corrigée, crossbeam 0.9.20 ; `3d2b54d` | audits npm/RustSec, build complet | CORRIGÉ, 2 warnings Rust suivis |
| RL-2026-003 / REC-09 | majeure CI | pnpm 11 refusait les scripts `msw` et `sharp` non déclarés sous Linux | politique explicite false pour MSW/Sharp, true pour unrs ; `e0ce74c` | installation gelée et job frontend distant | CORRIGÉ |
| RL-2026-004 / REC-09 | majeure livraison | le WASM était stable sur un OS mais différent entre macOS et Linux | sections variables retirées, artefact Linux canonique, builds temporaires et comparaison Git ; `37aba84`, `8bb9451` | deux builds propres sur chaque OS et CI Linux | CORRIGÉ |
| RL-2026-005 / REC-10 | moyenne qualité | tests encore insuffisants sur MapRenderer et branches d'interface | seuil de garde honnête et dette explicitée ; aucun faux pourcentage | rapport global Vitest | NON CORRIGÉ : C2.2.2 partiel |

Les cinq cartes sans fixture et l'absence de VoiceOver sont des limites de preuve, pas des bogues prétendument corrigés.
