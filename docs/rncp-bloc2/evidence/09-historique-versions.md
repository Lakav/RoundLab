# Historique et gestion des versions

`v0.1.39` existe réellement : tag annoté sur `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a`, daté du 20/07/2026. Sa CI, son déploiement, un rollback vers `8bb9451`, puis la restauration de `main` sont documentés dans `deployment-runs-2026-07-20.md`.

Sa préparation a été réalisée sur `rncp-bloc2-final` avec des commits séparés :

- `3d2b54d` : tests, accessibilité, sécurité, CI/CD, version et preuves techniques ;
- `e0ce74c` : politique de scripts pnpm validée sous Linux ;
- `37aba84` : normalisation des sections WASM ;
- `2171da4` : publication temporaire de l'artefact Linux de référence ;
- `8bb9451` : artefact Linux canonique et comparaison sans mutation locale.

La candidate suivante est préparée sur `codex/rncp-bloc2-v0.1.40`. `package.json` vaut `0.1.40`, mais **aucun tag v0.1.40 n'est créé** : la CI distante, le déploiement, le smoke distant et le rollback de cette révision n'ont pas encore eu lieu. Une valeur de package n'est pas une release.

Commandes de preuve :

```bash
git log --oneline --decorate -20
git show --no-patch --format=fuller v0.1.39
git status --short
```

Une release ne doit pas être déduite de la seule valeur de `package.json`.
