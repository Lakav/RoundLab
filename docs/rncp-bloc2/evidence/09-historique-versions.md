# Historique et gestion des versions

`v0.1.39` existe réellement : tag annoté sur `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a`, daté du 20/07/2026. Sa CI, son déploiement, un rollback vers `8bb9451`, puis la restauration de `main` sont documentés dans `deployment-runs-2026-07-20.md`.

Sa préparation a été réalisée sur `rncp-bloc2-final` avec des commits séparés :

- `3d2b54d` : tests, accessibilité, sécurité, CI/CD, version et preuves techniques ;
- `e0ce74c` : politique de scripts pnpm validée sous Linux ;
- `37aba84` : normalisation des sections WASM ;
- `2171da4` : publication temporaire de l'artefact Linux de référence ;
- `8bb9451` : artefact Linux canonique et comparaison sans mutation locale.

La candidate v0.1.40 a été préparée dans `de30fd8`, fusionnée sur `main` par la PR #2 dans `2dc622d`, puis validée par CI de PR et de `main`. Elle a été déployée, contrôlée publiquement, rollbackée vers `2e51eaf`, contrôlée, restaurée sur `2dc622d` et contrôlée une dernière fois. La séquence et ses cinq runs sont détaillés dans `deployment-runs-2026-07-21.md`.

`package.json` vaut `0.1.40`, mais **aucun tag v0.1.40 n'est créé** : REC-14 est désormais OK grâce à la fixture CS2 Vertigo vérifiée, tandis que REC-15 reste BLOQUÉ faute de parcours humain VoiceOver/RGAA et de sessions utilisateurs. Une valeur de package et un déploiement technique ne suffisent pas à déclarer l'ensemble de la recette acquis.

Commandes de preuve :

```bash
git log --oneline --decorate -20
git show --no-patch --format=fuller v0.1.39
git status --short
```

Une release ne doit pas être déduite de la seule valeur de `package.json`.
