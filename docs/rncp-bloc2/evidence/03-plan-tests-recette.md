# Campagne de recette v0.1.40

Les statuts sont strictement `OK`, `NOK` ou `BLOQUÉ`. La date distingue l'exécution historique du re-test du 21 juillet 2026. Les compteurs sont générés depuis ce tableau par `scripts/summarize-recipe.py` dans `recipe-summary.json`.

| ID | Préconditions | Données | Étapes | Attendu | Observé | Statut | Date | Preuve |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REC-01 | Chrome système | contrôle import + audits locaux | activer l'import au clavier | sélecteur local, aucun upload | contrôle focus reçu ; Worker local vérifié | OK | 2026-07-21 | Playwright + audits locality/import |
| REC-02 | backend navigateur | fichier déclaré > 1 Gio | appeler le backend | rejet avant lecture | erreur de taille attendue | OK | 2026-07-20 | test `browser-backend` |
| REC-03 | parser Rust | flux zstd dépassant 1 Gio | décompresser | arrêt avant parsing/stockage | limite Rust déclenchée | OK | 2026-07-20 | tests Rust zstd |
| REC-04 | fake IndexedDB | match et rounds valides | écrire puis relire | métadonnées et rounds séparés | CRUD et index `matchId` conformes | OK | 2026-07-20 | tests `browser-store` |
| REC-05 | fake IndexedDB | enregistrement corrompu | lire match/round | erreur explicite | payload rejeté | OK | 2026-07-20 | tests IndexedDB |
| REC-06 | Vitest/jsdom | fixture replay TypeScript | play, pause, seek, vitesse, round | temps borné, état cohérent | assertions Zustand/composants vertes | OK | 2026-07-21 | tests replay |
| REC-07 | calibrations livrées | cartes multi-niveaux | choisir couche selon altitude et au clavier | couche correcte, état annoncé | calculs valides et contrôle `aria-pressed` | OK | 2026-07-21 | tests maps + Playwright commandes |
| REC-08 | parser `release` | `demos/dust1-13.dem.zst`, 135 076 363 o | parser et comparer références | carte, score, signatures exacts | test réel vert | OK | 2026-07-20 | `rust-real-demo-reference.txt` |
| REC-09 | Node/pnpm attendus | build normal et `/RoundLab` | construire l'export | routes statiques, assets résolus | build local v0.1.40 vert ; preuve distante à rejouer | OK | 2026-07-21 | build + audit output local |
| REC-10 | périmètre Vitest global | code frontend incluant `MapRenderer` | exécuter la couverture | ≥ 60/50/60/60 et CI bloquante | 61,68/52,41/72,51/63,70 ; `MapRenderer` 52,72 % statements | OK | 2026-07-21 | HTML, JSON, LCOV, log couverture ; RL-2026-005 |
| REC-11 | lockfiles courants | dépendances web/Rust | lancer audits | aucune vulnérabilité bloquante | dernier contrôle collecté vert, warnings Rust documentés | OK | 2026-07-20 | logs d'audit |
| REC-12 | Chrome système | accueil, erreur, bibliothèque, dialogues, replay, commandes | lancer 5 scénarios axe/clavier/reflow | 0 violation axe, contrôles nommés | écart contraste détecté puis corrigé ; campagne finale 5/5 verte | OK | 2026-07-21 | rapport Playwright ; RL-2026-006 à 008 |
| REC-13 | replay seedé | alternative DOM et état courant | lire la région reliée au radar | joueurs, événements, bombe disponibles | région accessible synchronisée et testée | OK | 2026-07-21 | test replay accessibility |
| REC-14 | 10 cartes calibrées | vraies fixtures disponibles | exécuter une fixture par carte | preuve réelle pour chaque carte livrée | Ancient, Anubis, Cache, Dust2, Inferno seulement ; recherche étendue à Desktop/Documents/Downloads sans candidat Mirage, Nuke, Overpass, Train ou Vertigo | BLOQUÉ | 2026-07-21 | `docs/replay-fixture-coverage.json`, `fixture-search-2026-07-21.json` |
| REC-15 | macOS + VoiceOver | accueil, import, progression, bibliothèque, replay, dialogues | exécuter le protocole manuel | restitution et focus compréhensibles | VoiceOver activé réellement sur l'accueil local, mais raccourcis VO et annonces non observables par l'outil ; aucune session humaine | BLOQUÉ | 2026-07-21 | `05-accessibilite-rgaa.md` |
| REC-16 | v0.1.40 fusionnée avec CI verte | workflow Pages et SHA v0.1.40 | déployer, smoke, rollback, restaurer | révision v0.1.40 restaurable | séquence v0.1.39 historiquement prouvée ; v0.1.40 non publiée | BLOQUÉ | 2026-07-21 | `deployment-runs-2026-07-20.md` |

## Synthèse générée

- OK : 13
- NOK : 0
- BLOQUÉ : 3

REC-14, REC-15 et REC-16 ne doivent changer de statut qu'après exécution avec leurs données réelles respectives. Le tag v0.1.40 reste interdit tant que REC-16 est bloqué.
