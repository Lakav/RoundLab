# CI, déploiement, rollback et restauration v0.1.40

Séquence réellement exécutée le 21 juillet 2026 sur GitHub Actions et contrôlée dans le navigateur public.

## Révisions

- commit candidat : `de30fd86ea29b20e30f6c87e5b472e2931955890` ;
- merge sur `main` : `2dc622d96d6731873e3f6706347808328dfe7989` ;
- révision de rollback v0.1.39 : `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a`.

## Séquence distante

| Étape | Révision vérifiée | Run | Résultat |
| --- | --- | --- | --- |
| CI de la PR #2 | `de30fd86ea29b20e30f6c87e5b472e2931955890` | [29826700102](https://github.com/Lakav/RoundLab/actions/runs/29826700102) | SUCCESS, frontend 1 min 35, Rust 2 min 22 |
| CI `main` après merge | `2dc622d96d6731873e3f6706347808328dfe7989` | [29826905878](https://github.com/Lakav/RoundLab/actions/runs/29826905878) | SUCCESS, frontend 1 min 25, Rust 2 min 37 |
| déploiement automatique | `2dc622d96d6731873e3f6706347808328dfe7989` | [29827081068](https://github.com/Lakav/RoundLab/actions/runs/29827081068) | SUCCESS |
| rollback manuel | `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a` | [29827246534](https://github.com/Lakav/RoundLab/actions/runs/29827246534) | SUCCESS |
| restauration manuelle | `2dc622d96d6731873e3f6706347808328dfe7989` | [29827340756](https://github.com/Lakav/RoundLab/actions/runs/29827340756) | SUCCESS |

Les logs du rollback contiennent explicitement :

```text
ref: 2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a
HEAD is now at 2e51eaf Finalize RoundLab v0.1.39 for RNCP Bloc 2
```

Les logs de restauration contiennent explicitement :

```text
ref: 2dc622d96d6731873e3f6706347808328dfe7989
HEAD is now at 2dc622d Prepare RNCP Bloc 2 v0.1.40 evidence
```

## Smokes publics

URL : [https://lakav.github.io/RoundLab/](https://lakav.github.io/RoundLab/)

Après le déploiement v0.1.40, le navigateur a observé :

- titre et `h1` `RoundLab` ;
- import `Open a local CS2 demo file` et bouton `Settings` visibles ;
- logo `/RoundLab/logo.png` chargé, largeur naturelle 899 px ;
- chunks servis sous `/RoundLab/_next/static/chunks/`, dont `3gzjaewd3cdr_.js`.

Après rollback, les mêmes contrôles fonctionnels restaient verts et le manifeste avait réellement changé : le chunk `3gzjaewd3cdr_.js` avait été remplacé par `0g-6joqzacvgb.js`.

Après restauration, les contrôles fonctionnels étaient toujours verts et `3gzjaewd3cdr_.js` était revenu. Cette alternance, associée aux SHA de checkout présents dans les logs, démontre le rollback puis la restauration effectifs ; elle ne repose pas uniquement sur le statut SUCCESS du workflow.

Les annotations GitHub relatives au runtime Node 20 interne de certaines actions sont des avis de dépréciation ; aucun job n'a échoué. REC-14 a depuis été validé par les dix fixtures réelles. Aucun tag v0.1.40 n'est créé tant que REC-15 reste BLOQUÉ.

## Révision applicative candidate après renforcement des preuves

La PR #4 a ajouté les cinq fixtures publiques manquantes, verrouillé les preuves RGAA et utilisateur structurées, puis introduit une porte de release stricte. Elle a été fusionnée après CI verte :

- tête de branche : `58076d4548e17082b1bd1e0119fc7f5681d54511` ;
- merge applicatif candidat sur `main` : `07fb59a84a9c96444f80e07e190a797f4495193f` ;
- révision de rollback : `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a` (v0.1.39).

| Étape | Révision vérifiée | Run | Résultat |
| --- | --- | --- | --- |
| CI de la PR #4 | `58076d4548e17082b1bd1e0119fc7f5681d54511` | [29835730211](https://github.com/Lakav/RoundLab/actions/runs/29835730211) | SUCCESS, frontend et Rust verts |
| CI `main` après merge | `07fb59a84a9c96444f80e07e190a797f4495193f` | [29835960094](https://github.com/Lakav/RoundLab/actions/runs/29835960094) | SUCCESS, frontend et Rust verts |
| déploiement automatique | `07fb59a84a9c96444f80e07e190a797f4495193f` | [29836168860](https://github.com/Lakav/RoundLab/actions/runs/29836168860) | SUCCESS, HTTP 200 public |
| garde-fou strict v0.1.40 | `07fb59a84a9c96444f80e07e190a797f4495193f` | [29836262142](https://github.com/Lakav/RoundLab/actions/runs/29836262142) | ÉCHEC ATTENDU après contrôles techniques verts : 15 OK, 1 BLOQUÉ, RGAA 0/106, aucun participant |
| rollback manuel | `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a` | [29836670660](https://github.com/Lakav/RoundLab/actions/runs/29836670660) | SUCCESS, HTTP 200, chunk historique observé |
| restauration manuelle | `07fb59a84a9c96444f80e07e190a797f4495193f` | [29836787032](https://github.com/Lakav/RoundLab/actions/runs/29836787032) | SUCCESS, HTTP 200, chunk courant rétabli |

Le rollback du run 29836670660 contient explicitement `ref: 2e51eaf...` et `HEAD is now at 2e51eaf`. Le HTML public exposait alors `0g-6joqzacvgb.js`. Le run 29836787032 contient `ref: 07fb59a...`, `HEAD is now at 07fb59a` et `pages_build_version: 07fb59a...` ; le HTML public a réexposé `3gzjaewd3cdr_.js`. Cette variation confirme que le contenu servi a réellement basculé puis été restauré.

Le garde-fou distant n'a créé aucun tag. Son échec ne vient pas de la CI : ses jobs frontend et Rust sont intégralement verts. Il refuse uniquement les preuves humaines manquantes, conformément aux règles de publication. Au 21 juillet 2026, `v0.1.40` est toujours absent du dépôt local et du dépôt distant.

Les commits postérieurs limités à la documentation de preuve et à son générateur peuvent changer le SHA de `main` sans changer l'artefact applicatif contrôlé ci-dessus. Toute modification future du code, des dépendances ou de la construction invaliderait en revanche cette équivalence et imposerait une nouvelle séquence complète.

## Dernière synchronisation de `main` avant l'audit final

Les trois runs demandés ont été vérifiés via GitHub CLI le 21 juillet 2026 :

| Étape | Révision vérifiée | Run | Résultat |
| --- | --- | --- | --- |
| CI de la PR #5 | `dd1ef9ef8c58a2a10b65cbee0704901ecf298d8e` | [29837544323](https://github.com/Lakav/RoundLab/actions/runs/29837544323) | SUCCESS |
| CI `main` après fusion | `189bb265d048a0bd00cf0e18dce7ff7cab8ff2a8` | [29837787045](https://github.com/Lakav/RoundLab/actions/runs/29837787045) | SUCCESS |
| déploiement Pages post-fusion | `189bb265d048a0bd00cf0e18dce7ff7cab8ff2a8` | [29837978763](https://github.com/Lakav/RoundLab/actions/runs/29837978763) | SUCCESS |

Ces runs prouvent l'état de départ `origin/main`. La branche finale ajoute du code applicatif d'accessibilité (lien d'évitement et raccourcis modifiés) : la preuve de rollback antérieure reste une preuve de procédure, mais la branche devra obtenir sa propre CI et son propre déploiement avant tout tag.
