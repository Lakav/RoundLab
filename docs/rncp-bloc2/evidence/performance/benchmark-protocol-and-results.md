# Protocole et résultats de performance v0.1.40

Date d'exécution : 21 juillet 2026. Les valeurs ci-dessous proviennent des fichiers bruts de ce dossier ; elles ne reprennent pas les chiffres historiques du dossier Word.

## Environnement vérifié

- machine : Apple M4, 16 Gio de mémoire ;
- système : macOS 26.5 (build 25F71) ;
- navigateur automatisé : Google Chrome 150.0.7871.129 via Playwright 1.61.1 ;
- chaîne native : Rust 1.95.0, profil `release` ;
- chaîne web : Node 25.1.0, pnpm 11.9.0, Next.js 16.2.10 ;
- application d'édition vérifiable pendant cette intervention : Codex Desktop (`com.openai.codex`) ;
- aucun fichier de configuration VS Code, Cursor, Zed ou JetBrains n'est présent dans le dépôt. Leur usage n'est donc pas revendiqué.

## Méthode native reproductible

Commande exécutée depuis la racine :

```text
python3 scripts/benchmark-native-parser.py --repetitions 3 \
  demos/dust1-13.dem.zst demos/ancient4-13.dem.zst demos/cache11-13.dem.zst
```

Chaque exécution utilise le binaire `release`, la qualité `full`, un dossier de sortie temporaire distinct et `/usr/bin/time -l`. Le script conserve les statistiques internes, le temps mural, le RSS maximal, un CSV, un JSON et le journal intégral de chaque répétition.

| Démo réelle | Taille compressée | Temps total min / médiane / max | Lecture + décompression min / médiane / max | Parsing ticks min / médiane / max | RSS max min / médiane / max |
| --- | ---: | ---: | ---: | ---: | ---: |
| dust1-13 | 135 076 363 o | 3 570 / 3 603 / 3 676 ms | 218 / 219 / 224 ms | 1 841 / 1 898 / 1 902 ms | 1,437 / 1,443 / 1,447 Go |
| ancient4-13 | 175 843 432 o | 5 167 / 5 232 / 5 385 ms | 289 / 290 / 304 ms | 2 893 / 2 900 / 3 036 ms | 2,156 / 2,235 / 2,261 Go |
| cache11-13 | 253 484 029 o | 8 848 / 8 949 / 9 176 ms | 409 / 411 / 469 ms | 5 360 / 5 682 / 5 723 ms | 2,589 / 2,971 / 2,980 Go |

La sérialisation n'est plus le goulet historique annoncé : sur `dust1-13`, `serialize_json_ms` vaut 211 / 218 / 218 ms et `write_output_ms` 209 / 217 / 232 ms. Les anciens chiffres voisins de 7 secondes sont périmés.

## Méthode navigateur reproductible

Le benchmark Playwright sert l'export statique de production, vide le cache HTTP et la base IndexedDB avant chaque répétition, puis écoute directement les messages structurés du Worker. Toutes les phases utilisent la même horloge `performance.now()`. Le RSS est échantillonné toutes les 250 ms en additionnant le processus Chrome Playwright et tous ses descendants ; le heap JavaScript du renderer reste enregistré séparément et n'est jamais présenté comme la mémoire totale.

Commande exécutée depuis `desktop/` :

```text
ROUNDLAB_BENCHMARK_DEMOS="../demos/dust1-13.dem.zst:../demos/ancient4-13.dem.zst:../demos/cache11-13.dem.zst" \
ROUNDLAB_BENCHMARK_REPETITIONS=3 \
pnpm exec playwright test tests-e2e/performance.spec.ts --project=chromium
```

| Démo réelle | Décompression min / médiane / max | Chargement WASM min / médiane / max | Parsing min / médiane / max | Stockage min / médiane / max | Import total min / médiane / max |
| --- | ---: | ---: | ---: | ---: | ---: |
| dust1-13 | 406 / 425 / 517 ms | 7 / 10 / 14 ms | 15 616 / 15 761 / 17 918 ms | 857 / 886 / 1 036 ms | 16 999 / 17 144 / 19 627 ms |
| ancient4-13 | 516 / 541 / 545 ms | 8 / 9 / 9 ms | 24 247 / 24 700 / 25 201 ms | 1 003 / 1 012 / 1 085 ms | 25 861 / 26 355 / 26 931 ms |
| cache11-13 | 751 / 766 / 820 ms | 7 / 8 / 10 ms | 45 161 / 46 074 / 46 744 ms | 1 738 / 1 782 / 2 187 ms | 47 801 / 48 832 / 49 847 ms |

| Démo réelle | Ouverture round min / médiane / max | P95 intervalle rendu min / médiane / max | RSS Chrome total min / médiane / max |
| --- | ---: | ---: | ---: |
| dust1-13 | 198 / 206 / 295 ms | 9,2 / 9,3 / 9,3 ms | 2,399 / 2,581 / 2,969 Go |
| ancient4-13 | 216 / 218 / 225 ms | 9,2 / 9,3 / 9,3 ms | 3,106 / 3,406 / 3,527 Go |
| cache11-13 | 243 / 263 / 294 ms | 9,2 / 9,3 / 9,3 ms | 3,080 / 3,099 / 3,802 Go |

Le lot exécute les neuf imports dans le même processus Chrome. Le RSS peut donc inclure des caches et allocations conservés entre deux imports ; il a effectivement augmenté sur certains passages puis diminué avant Cache. C'est une mesure volontairement conservatrice du processus complet, pas une attribution mémoire précise au Worker.

## Tailles de production

Le build statique du 21 juillet 2026 produit :

- JavaScript : 1 811 900 octets sur l'export normal et 1 812 199 octets sur l'export `/RoundLab`, 37 fichiers dans les deux cas ;
- WASM : 2 925 102 octets, un fichier.

La CI échoue désormais au-delà de 2 000 000 octets de JavaScript total, de 3 500 000 octets de WASM ou si le nombre de fichiers WASM diffère de un. Ces marges d'environ 10 % et 20 % autorisent les variations mineures de bundling tout en bloquant une régression importante.

## Seuils d'acceptation

| Mesure | Seuil | Résultat |
| --- | ---: | --- |
| temps natif total, démo compressée jusqu'à 255 Mio | ≤ 10 s | PASS, pire valeur 9,176 s |
| lecture + décompression native | ≤ 500 ms | PASS, pire valeur 469 ms |
| RSS maximal natif | ≤ 4 Gio | PASS, pire valeur 2,980 Go |
| JavaScript de production | ≤ 2 000 000 o | PASS, pire export 1 812 104 o |
| WASM de production | ≤ 3 500 000 o | PASS, 2 925 102 o |
| décompression dans Chrome | ≤ 1 s | PASS, pire valeur 820 ms |
| chargement WASM dans Chrome | ≤ 250 ms | PASS, pire valeur 14 ms |
| import Chrome ≤ 140 Mo compressés | ≤ 20 s | PASS, pire valeur 19,627 s |
| import Chrome ≤ 180 Mo compressés | ≤ 30 s | PASS, pire valeur 26,931 s |
| import Chrome ≤ 260 Mo compressés | ≤ 55 s | PASS, pire valeur 49,847 s |
| ouverture d'un round dans Chrome | ≤ 2 s | PASS, pire valeur 295 ms |
| rendu replay, p95 des intervalles | ≤ 25 ms | PASS, pire valeur 9,3 ms |
| mémoire maximale totale de Chrome | ≤ 4 Gio | PASS, pire valeur 3,802 Go (3,541 Gio) |

Les seuils d'ouverture, de rendu et de mémoire existaient avant la série finale. Les budgets d'import par taille, de décompression et de chargement WASM ont été fixés à partir de cette première baseline complète, avec une marge de régression ; ce sont des budgets internes, pas un SLA externe pré-enregistré. `scripts/summarize-browser-benchmark.py` recalcule min/médiane/max, vérifie les neuf runs et échoue si un budget est dépassé.

## Historique et limites du benchmark navigateur

Les premières tentatives reposaient sur un texte de progression transitoire et ont manqué l'événement de fin de décompression ; plusieurs lancements Chrome ont aussi subi un `SIGKILL`. Le protocole final intercepte directement les messages du Worker, écrit un checkpoint JSON/CSV après chaque répétition, n'applique aucune relance automatique à ce test coûteux et sépare son rapport Playwright de celui d'accessibilité. La série finale production est passée en une seule exécution.

Le champ `rendererJsHeapPeakBytes` reste un proxy incomplet. La mesure de référence mémoire est `browserProcessRssPeakBytes`, issue du processus système complet. Le p95 de 120 intervalles `requestAnimationFrame` mesure la cadence sur la scène ouverte mais ne constitue pas un profil GPU exhaustif de toutes les animations et couches.

## Preuves

- `native-benchmark-raw.json` : résultats structurés des 9 exécutions ;
- `native-benchmark-raw.csv` : mêmes résultats pour tableur ;
- `native-raw/` : sorties intégrales de chaque exécution ;
- `browser-benchmark-raw.json` et `.csv` : métriques des 9 imports production ;
- `browser-benchmark-summary.json` : min/médiane/max, seuils et statut machine `PASS` ;
- `playwright-report/index.html` et `playwright-results/.last-run.json` : exécution navigateur finale verte ;
- `tests-e2e/performance.spec.ts` : protocole navigateur opt-in et checkpoint après chaque run.
