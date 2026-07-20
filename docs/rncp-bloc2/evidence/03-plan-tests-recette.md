# Campagne de recette du 20 juillet 2026

Les statuts sont `OK`, `NOK` ou `BLOQUÉ`. Un test automatisé vert ne vaut que pour les données et l'environnement indiqués.

| ID | Préconditions et données | Étapes | Attendu | Observé | Statut | Preuve |
| --- | --- | --- | --- | --- | --- | --- |
| REC-01 | Chrome système ; fichier `.dem` simulé | Ouvrir l'accueil, activer l'import au clavier | sélecteur local, aucun upload | contrôle focus vert ; chemin Worker local vérifié | OK | Playwright + audits locality/import |
| REC-02 | fichier déclaré > 1 Gio | appeler le backend navigateur | rejet avant lecture | erreur de taille attendue | OK | test `browser-backend` |
| REC-03 | flux zstd dépassant 1 Gio | décompresser dans le parser | arrêt avant parsing/stockage | limite Rust déclenchée | OK | tests Rust zstd |
| REC-04 | fake IndexedDB | écrire puis relire un match | métadonnées et rounds séparés | CRUD et index `matchId` conformes | OK | tests `browser-store` |
| REC-05 | enregistrement corrompu | lire match/round | erreur explicite, pas de payload utilisé | rejet observé | OK | tests IndexedDB |
| REC-06 | fixture replay TypeScript | play, pause, seek, vitesse, round | temps borné et chargement cohérent | assertions Zustand/composants vertes | OK | tests replay |
| REC-07 | cartes multi-niveaux | choisir couche selon altitude | couche haute/basse correcte | calculs et 10 calibrations valides | OK | tests maps + audit layout |
| REC-08 | `demos/dust1-13.dem.zst`, 128,8 Mio | parser en release et comparer références | carte, score et signatures exacts | 1 test réel vert | OK | log `rust-real-demo-reference` |
| REC-09 | Node 24, pnpm 11.9.0 | build normal puis build `/RoundLab` | export sans route serveur, assets résolus | deux builds et audit output verts | OK | logs `frontend-build` et `frontend-pages-build` |
| REC-10 | périmètre Vitest global déclaré | exécuter couverture | seuil de garde atteint ; majorité signalée seulement si prouvée | seuil de garde vert, lignes à 33,76 % | NOK RNCP | rapport frontend ; lié à RL-2026-005 |
| REC-11 | lockfiles courants | `pnpm audit`, `cargo audit` | aucune vulnérabilité bloquante | npm 0 ; Rust 0 vulnérabilité, 2 warnings sans correctif | OK avec risque | logs d'audit |
| REC-12 | accueil et replay seedé | lancer axe-core, clavier et focus | aucune violation axe, contrôles nommés | 2 scénarios Playwright verts | OK automatisé | rapport Playwright |
| REC-13 | canvas PixiJS | lire l'alternative DOM | round, joueurs, événements et état disponibles | région accessible présente et testée | OK | test replay accessibility |
| REC-14 | 10 cartes calibrées | exécuter les fixtures réelles disponibles | replay vérifié pour chaque carte | 5 cartes sur 10 documentées | BLOQUÉ | `docs/replay-fixture-coverage.json` |
| REC-15 | macOS, VoiceOver | parcours accueil/import/replay | restitution compréhensible | session non conduite | BLOQUÉ | absence de rapport manuel |
| REC-16 | workflow Pages | publier, smoke test URL, rollback puis restauration | URL accessible et révision restaurable | workflow préparé ; aucune exécution possible avant fusion sur `main` | BLOQUÉ avant fusion | workflow `deploy-pages.yml` |

## Synthèse

- `OK` : 12 scénarios, dont REC-11 avec deux warnings Rust résiduels documentés.
- `NOK` : 1 scénario, la majorité de couverture frontend demandée n'est pas atteinte.
- `BLOQUÉ` : 3 scénarios, faute de cinq fixtures, de session VoiceOver et de publication avant fusion.

Cette synthèse doit être mise à jour dans le dossier Word après le déploiement réel ; les données historiques de cette campagne ne doivent pas être réécrites rétroactivement.
