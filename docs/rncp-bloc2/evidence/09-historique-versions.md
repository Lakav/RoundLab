# Historique et gestion des versions

La préparation de `v0.1.39` est réalisée sur `rncp-bloc2-final` sans supprimer les modifications initiales. Les commits sont séparés pour rendre les corrections auditables :

- `3d2b54d` : tests, accessibilité, sécurité, CI/CD, version et preuves techniques ;
- `e0ce74c` : politique de scripts pnpm validée sous Linux ;
- `37aba84` : normalisation des sections WASM ;
- `2171da4` : publication temporaire de l'artefact Linux de référence ;
- `8bb9451` : artefact Linux canonique et comparaison sans mutation locale.

Le dépôt possédait les tags incrémentaux jusqu'à `v0.1.38`. Le tag annoté `v0.1.39` ne doit être créé qu'après CI distante verte sur le commit final. Le dossier Word doit distinguer le SHA du commit ciblé, le tag et l'état du worktree au moment de la collecte.

Commandes de preuve :

```bash
git log --oneline --decorate -20
git show --no-patch --format=fuller v0.1.39
git status --short
```

Une release ne doit pas être déduite de la seule valeur de `package.json`.
