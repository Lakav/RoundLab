# Matrice de traçabilité RNCP39583BC02

| Compétence | Réalisation RoundLab | Preuve | État réel |
| --- | --- | --- | --- |
| C2.1.1 Environnements, qualité et performance | Node 24, pnpm 11.9.0, Rust 1.95.0, wasm-bindgen 0.2.126, export statique et portes de qualité | `environment.txt`, `07-qualite-performance.md`, journaux | ACQUIS pour développement, test et intégration |
| C2.1.2 Intégration continue | PR et `main` : audit, lint, types, couverture, build, axe, audits structurels, Rust, WASM et Clippy | workflow `_checks.yml`, run GitHub Actions, artefacts | ACQUIS après exécution distante verte |
| C2.2.1 Prototype sécurisé et ergonomique | Next.js, React, Worker, Rust/WASM, IndexedDB, Zustand, PixiJS, import et replay locaux | `02-architecture.md`, captures et smoke test | ACQUIS sur le prototype observé |
| C2.2.2 Tests unitaires majoritaires | 47 tests frontend et couverture Rust avec une vraie démo | rapports de couverture et logs | PARTIEL : Rust majoritaire, frontend global non majoritaire |
| C2.2.3 Évolutivité, sécurité, accessibilité | frontières modulaires, CSP, audits, axe-core et alternative DOM au canvas | `04-securite-owasp.md`, `05-accessibilite-rgaa.md` | PARTIEL : audit RGAA manuel et VoiceOver non réalisés |
| C2.2.4 Déploiement progressif | export sous `/RoundLab`, workflow Pages après CI verte, rollback par révision | workflow `deploy-pages.yml`, journaux de build | PARTIEL tant que publication et rollback ne sont pas exécutés |
| C2.3.1 Cahier de recette | campagne fonctionnelle, structurelle, sécurité et accessibilité | `03-plan-tests-recette.md`, `execution-tests.md` | PARTIEL : scénarios automatisés verts, 5 cartes et VoiceOver bloqués |
| C2.3.2 Correction des bogues | anomalies reliées à un scénario, cause, correction, commit et re-test | `08-anomalies-corrections.md` | ACQUIS pour les anomalies consignées |
| C2.4.1 Documentation | installation, utilisation, déploiement, rollback et mise à jour WASM/IndexedDB | `06-exploitation.md`, README | ACQUIS |

## Limites à conserver dans le dossier

- Couverture frontend globale : 32,32 % statements, 27,04 % branches, 51,93 % fonctions et 33,76 % lignes. La majorité du code applicatif frontend n'est pas démontrée.
- Couverture Rust avec Dust2 réel : 93,04 % des lignes, 86,06 % des fonctions et 90,05 % des régions. La CI sans fixture privée mesure un périmètre portable plus faible.
- Fixtures disponibles pour 5 cartes sur 10 ; `de_mirage`, `de_nuke`, `de_overpass`, `de_train` et `de_vertigo` restent bloquées.
- Axe-core ne remplace pas un audit des 106 critères RGAA 4.1.2. VoiceOver, zoom 400 % et revue manuelle exhaustive restent non démontrés.
