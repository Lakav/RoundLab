# Historique et gestion des versions

`v0.1.39` existe réellement : tag annoté sur `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a`, daté du 20/07/2026. Sa CI, son déploiement, un rollback vers `8bb9451`, puis la restauration de `main` sont documentés dans `deployment-runs-2026-07-20.md`.

Sa préparation a été réalisée sur `rncp-bloc2-final` avec des commits séparés :

- `3d2b54d` : tests, accessibilité, sécurité, CI/CD, version et preuves techniques ;
- `e0ce74c` : politique de scripts pnpm validée sous Linux ;
- `37aba84` : normalisation des sections WASM ;
- `2171da4` : publication temporaire de l'artefact Linux de référence ;
- `8bb9451` : artefact Linux canonique et comparaison sans mutation locale.

Une première candidate v0.1.40 a été préparée dans `de30fd8`, fusionnée sur `main` par la PR #2 dans `2dc622d`, puis validée par CI de PR et de `main`. Elle a été déployée, contrôlée publiquement, rollbackée vers `2e51eaf`, contrôlée, restaurée sur `2dc622d` et contrôlée une dernière fois.

Les preuves ont ensuite été renforcées jusqu'à `58076d4`, puis fusionnées par la PR #4 dans la révision applicative candidate `07fb59a`. La CI de PR, la CI de `main` et le déploiement automatique ont réussi. Un nouveau rollback réel vers `2e51eaf` a exposé le chunk historique `0g-6joqzacvgb.js`, puis la restauration de `07fb59a` a rétabli `3gzjaewd3cdr_.js`, avec HTTP 200 dans les deux états. Les commits ultérieurs qui ne modifient que ces preuves n'altèrent pas cet artefact applicatif. Les deux séquences et leurs runs sont détaillés dans `deployment-runs-2026-07-21.md`.

La PR #5 (`dd1ef9e`) a ensuite stabilisé les dernières preuves, avec CI verte 29837544323. Son merge `189bb265d048a0bd00cf0e18dce7ff7cab8ff2a8` a obtenu la CI `main` verte 29837787045 et le déploiement Pages vert 29837978763.

`package.json` vaut `0.1.40`, mais **aucun tag v0.1.40 n'est créé** : REC-15 reste BLOQUÉ par quatre contrôles non démontrés et deux participants réels sont toujours absents. La limite lecteur d’écran non testé n'est pas, à elle seule, bloquante. Une valeur de package et un déploiement technique ne suffisent pas à déclarer la release acquise.

Commandes de preuve :

```bash
git log --oneline --decorate -20
git show --no-patch --format=fuller v0.1.39
git status --short
```

Une release ne doit pas être déduite de la seule valeur de `package.json`.

Avant toute création de tag, `python3 scripts/validate-release-version.py --tag v0.1.40` doit réussir. Cette commande vérifie l'alignement des manifests, les 16 scénarios `OK`, la grille RGAA, les neuf contrôles REC-15, la limite résiduelle exacte et deux sessions utilisateur réelles de huit tâches. Le mode `--manifest-only` sert uniquement au diagnostic de version et ne donne jamais l'autorisation de créer le tag.

Le workflow manuel `release-gate.yml` est la porte distante correspondante : il exécute d'abord la totalité du workflow réutilisable `_checks.yml`, récupère l'historique et les tags, puis lance le validateur strict sur le même commit. Il refuse un tag déjà existant afin d'empêcher sa réutilisation ou son déplacement. Il ne crée pas le tag ; son succès est une condition préalable vérifiable, pas une release automatique.

Le run [29836262142](https://github.com/Lakav/RoundLab/actions/runs/29836262142) a effectivement exécuté cette porte sur `07fb59a` pour v0.1.40. Les contrôles frontend et Rust sont verts ; le job final échoue volontairement sur REC-15, la grille RGAA vide et l'absence de participant réel. Le tag reste absent localement et sur le dépôt distant.
