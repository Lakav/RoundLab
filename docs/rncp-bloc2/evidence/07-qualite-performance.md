# Qualité, couverture et performance

## Portes de qualité

| Porte | Attendu | Résultat du 20/07/2026 |
| --- | --- | --- |
| ESLint / TypeScript | 0 erreur | PASS |
| Vitest | tests verts et seuil de garde 30/25/50/30 | 47 tests, PASS |
| Build statique normal et `/RoundLab` | 0 erreur, assets résolus | PASS |
| Playwright + axe-core | 0 violation sur 2 scénarios | PASS |
| Rust test/fmt/Clippy | 0 échec/warning Clippy | PASS |
| WASM | deux builds propres identiques sur un même OS | PASS |
| Audits supply chain | 0 vulnérabilité bloquante | PASS avec 2 warnings Rust |

## Couverture mesurée

Le périmètre frontend comprend `src/lib/**/*.ts`, la page d'accueil, `MatchViewer` et tous les composants de replay. Seuls les types purs, interfaces backend déclaratives et bindings WASM générés sont exclus.

| Couverture frontend globale | Couvert / total | Pourcentage |
| --- | --- | --- |
| Statements | 1181 / 3654 | 32,32 % |
| Branches | 711 / 2629 | 27,04 % |
| Fonctions | 308 / 593 | 51,93 % |
| Lignes | 1036 / 3068 | 33,76 % |

Ces chiffres passent le seuil de garde actuel mais **ne démontrent pas une majorité de code applicatif couverte**. `MapRenderer` reste exercé au navigateur et par audits de contrat, pas couvert par Vitest.

Avec `demos/dust1-13.dem.zst`, le parser Rust atteint 4867/5231 lignes (93,04 %), 389/452 fonctions (86,06 %) et 6868/7627 régions (90,05 %). Cette mesure dépend d'une fixture locale de 128,8 Mio ignorée par Git ; l'artefact de couverture portable de la CI n'inclut pas cette démo.

## Performance réellement observée

- fichier réel utilisé : 128,8 Mio compressé ; parsing et ouverture réussis dans Chrome lors des captures du 20/07/2026 ;
- Worker et transfert d'`ArrayBuffer` évitent la copie par `postMessage` et le blocage principal ;
- limite d'entrée compressée et décompressée : 1 Gio ;
- rounds stockés séparément et chargés à la demande ;
- aucune durée de parsing reproductible ni SLA n'est revendiqué, car aucune série de benchmark matériel contrôlée n'a été exécutée.

Les indications de temps restantes visibles dans l'interface sont des estimations adaptatives, pas une preuve de performance.
