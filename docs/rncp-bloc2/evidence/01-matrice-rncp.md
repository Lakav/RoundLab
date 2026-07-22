# Matrice de traçabilité RNCP39583BC02

| Compétence | Réalisation RoundLab | Preuve | État réel |
| --- | --- | --- | --- |
| C2.1.1 Environnements, qualité et performance | Node 24, pnpm 11.9.0, Rust 1.95.0, wasm-bindgen 0.2.126, export statique et portes de qualité | `environment.txt`, `07-qualite-performance.md`, journaux | ACQUIS pour développement, test et intégration |
| C2.1.2 Intégration continue | PR et `main` : audit, lint, types, couverture, build, axe, audits structurels, Rust, WASM et Clippy | workflow `_checks.yml`, `deployment-runs-2026-07-21.md`, artefacts | ACQUIS : PR #5 run 29837544323 et `main` run 29837787045 verts sur `189bb26` |
| C2.2.1 Prototype sécurisé et ergonomique | Next.js, React, Worker, Rust/WASM, IndexedDB, Zustand, PixiJS, import et replay locaux | `02-architecture.md`, captures et smoke test | ACQUIS sur le prototype observé |
| C2.2.2 Tests unitaires majoritaires | 70 tests frontend, logique du renderer isolée et couverture Rust avec une vraie démo | rapports HTML/JSON/LCOV, logs et `map-renderer-logic.test.ts` | ACQUIS sur le périmètre mesuré : 61,68 % statements et 63,70 % lignes frontend ; Rust majoritaire avec Dust2 |
| C2.2.3 Évolutivité, sécurité, accessibilité | frontières modulaires, CSP, audits, axe-core, grille RGAA et alternative DOM au canvas | `04-securite-owasp.md`, `05-accessibilite-rgaa.md`, grille et contrôles manuels | PARTIEL : 106/106 lignes renseignées, 49 conformes, 53 non applicables et 4 non démontrées ; 5/9 contrôles REC-15 conformes |
| C2.2.4 Déploiement progressif | export sous `/RoundLab`, workflow Pages après CI verte, rollback par révision | workflow `deploy-pages.yml`, `deployment-runs-2026-07-21.md` | ACQUIS techniquement : `189bb26` déployé par le run 29837978763 ; rollback/restauration applicative antérieurs prouvés ; aucun tag v0.1.40 |
| C2.3.1 Cahier de recette | 16 scénarios avec préconditions, données, étapes, attendu, observé, statut et preuve | `03-plan-tests-recette.md`, `recipe-summary.json`, `execution-tests.md` | PARTIEL : 15 OK, 0 NOK, 1 BLOQUÉ |
| C2.3.2 Correction des bogues | anomalies reliées à un scénario, cause, correction, commit et re-test | `08-anomalies-corrections.md` | ACQUIS pour les anomalies consignées |
| C2.4.1 Documentation | installation, utilisation, déploiement, rollback et mise à jour WASM/IndexedDB | `06-exploitation.md`, README | ACQUIS |

## Limites à conserver dans le dossier

- Couverture frontend globale : 61,68 % statements, 52,32 % branches, 72,51 % fonctions et 63,70 % lignes. Les seuils de garde sont 60/50/60/60.
- Couverture Rust avec Dust2 réel : 93,04 % des lignes, 86,06 % des fonctions et 90,05 % des régions. La CI sans fixture privée mesure un périmètre portable plus faible.
- Fixtures réelles disponibles et auditées pour 10 cartes sur 10, soit 206 rounds locaux. Nuke, Train et Vertigo exercent chacune leurs deux couches radar.
- Six scénarios Playwright/axe et une grille remplie ne transforment pas une preuve manquante en conformité. Les zooms navigateur réels à 200/400 % et le contraste du canvas restent non démontrés. Limite résiduelle : lecteur d’écran non testé.
- Aucune session avec participant réel n'a été menée : le protocole existe, les résultats utilisateurs n'existent pas encore.
- Le benchmark navigateur production est démontré sur 9 imports réels avec mesure des phases, du RSS Chrome total, de l'ouverture et du rendu. Les budgets sont une baseline interne sur Apple M4, pas un SLA multi-machines.
