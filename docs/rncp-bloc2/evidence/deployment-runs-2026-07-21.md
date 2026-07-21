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
