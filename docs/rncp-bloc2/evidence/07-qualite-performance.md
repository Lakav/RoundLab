# Qualité, couverture et performance

## Portes de qualité

| Porte | Attendu | Résultat du 21/07/2026 |
| --- | --- | --- |
| ESLint / TypeScript | 0 erreur | PASS |
| Vitest | 70 tests verts et seuils 60/50/60/60 | 70 tests, PASS |
| Build statique normal et `/RoundLab` | 0 erreur, assets résolus | PASS |
| Playwright + axe-core | 0 violation sur 5 scénarios | 5/5, PASS sans relance dans la collecte finale |
| Budget export | JS ≤ 2 000 000 octets ; WASM ≤ 3 500 000 octets et 1 fichier | PASS |
| Rust test/fmt/Clippy | 0 échec/warning Clippy | PASS |
| WASM | deux builds propres identiques sur un même OS | PASS |
| Audits supply chain | 0 vulnérabilité bloquante | PASS avec 2 warnings Rust |

## Couverture mesurée

Le périmètre frontend comprend `src/lib/**/*.ts`, la page d'accueil, `MatchViewer` et tous les composants de replay. Seuls les types purs, interfaces backend déclaratives et bindings WASM générés sont exclus.

| Couverture frontend globale | Couvert / total | Pourcentage |
| --- | --- | --- |
| Statements | 2257 / 3659 | 61,68 % |
| Branches | 1382 / 2635 | 52,44 % |
| Fonctions | 430 / 593 | 72,51 % |
| Lignes | 1957 / 3072 | 63,70 % |

Ces chiffres passent les quatre seuils de garde. `MapRenderer` est à 52,72 % statements/lignes grâce à 23 tests de sa logique pure et de ses primitives de rendu. Cela démontre une majorité du périmètre instrumenté, pas une couverture exhaustive du canvas ni du GPU.

| Exigence test ciblée | Preuve exécutée |
| --- | --- |
| joueurs, interpolation et sélection | `map-renderer-logic`, `PlayerHUD`, `MatchViewer` |
| projectiles, utilitaires et événements | `map-renderer-logic`, `replay-logic`, benchmark réel |
| couche radar | tests `maps` + activation clavier Playwright |
| zoom et déplacement | zoom clavier + pan réel au pointeur Playwright |
| annotations | trait réel au pointeur, état outil, annulation clavier et tests canvas jsdom |
| timeline et synchronisation | seek pointeur, lecture, vitesses et transitions de rounds |
| état de bombe | reconstruction, pose, désamorçage, explosion, horloge et alternative DOM |
| erreurs et données incomplètes | store/browser, round vide, trajectoires invalides et fallbacks renderer |
| nettoyage PixiJS | file de destruction, objets déjà détruits et démontage des conteneurs |
| accueil, import, progression et IndexedDB | tests home/backend/store + vrais imports benchmark |

Avec `demos/dust1-13.dem.zst`, le parser Rust atteint 4867/5231 lignes (93,04 %), 389/452 fonctions (86,06 %) et 6868/7627 régions (90,05 %). Cette mesure dépend d'une fixture locale de 128,8 Mio ignorée par Git ; l'artefact de couverture portable de la CI n'inclut pas cette démo.

La CI cible Node 24 conformément au manifeste. La collecte locale a tourné sous Node 25.1.0, hors plage `>=24 <25` ; ses résultats restent utiles, mais la preuve canonique sous Node 24 est désormais la CI verte de la PR #4 puis de `main`, référencée dans `deployment-runs-2026-07-21.md`.

## Performance réellement observée

Trois fichiers réels ont été mesurés trois fois avec le parser natif `release` sur Apple M4 / 16 Gio. Les médianes murales sont 3,603 s (Dust2, 135 076 363 octets), 5,232 s (Ancient, 175 843 432 octets) et 8,949 s (Cache, 253 484 029 octets). Les maxima de mémoire résidente observés sont respectivement 1,45, 2,26 et 2,98 Go. Le seuil choisi avant lecture des résultats est ≤ 10 s et ≤ 4 Go : 9/9 exécutions passent.

L'export normal produit 1 811 900 octets de JavaScript ; l'export préfixé `/RoundLab` en produit 1 812 199. Les deux contiennent un WASM de 2 925 102 octets et passent les budgets CI. Le protocole, les trois répétitions, les journaux bruts et les réserves méthodologiques sont dans `performance/benchmark-protocol-and-results.md`.

Le benchmark production Chrome couvre aussi trois répétitions par fichier. Les médianes d'import sont 17,144 s (Dust2), 26,355 s (Ancient) et 48,832 s (Cache) ; le pire RSS Chrome total est 3,802 Go, la pire ouverture de round 295 ms et le pire p95 des intervalles de rendu 9,3 ms. Les neuf runs passent les budgets du résumé automatisé. Les temps visibles dans l'interface restent des estimations adaptatives, distinctes de ces mesures.
