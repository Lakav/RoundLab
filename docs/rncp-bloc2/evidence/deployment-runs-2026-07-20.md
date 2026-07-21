# CI, déploiement, rollback et restauration vérifiés

Vérification effectuée le 21 juillet 2026 avec l'API GitHub, les journaux GitHub Actions, un smoke HTTP et le navigateur intégré.

## Séquence distante du 20 juillet 2026

| Étape | Révision réellement checkoutée | Run | Résultat |
| --- | --- | --- | --- |
| CI `main` | `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a` | [29744947768](https://github.com/Lakav/RoundLab/actions/runs/29744947768) | SUCCESS |
| déploiement automatique | `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a` | [29745332315](https://github.com/Lakav/RoundLab/actions/runs/29745332315) | SUCCESS |
| rollback manuel | `8bb94511a4d5c5821840734eab4d4ee05694bea0` | [29745573237](https://github.com/Lakav/RoundLab/actions/runs/29745573237) | SUCCESS |
| restauration de `main` | `main`, alors à `2e51eafabba2e8672b83911d1e2cf9ac6ae51b2a` | [29745662118](https://github.com/Lakav/RoundLab/actions/runs/29745662118) | SUCCESS |

Les logs du rollback contiennent explicitement :

```text
ref: 8bb94511a4d5c5821840734eab4d4ee05694bea0
HEAD is now at 8bb9451 Pin Linux WASM release artifact
```

Limite importante : l'action `deploy-pages` inscrit `pages_build_version=2e51eaf...` même lors du checkout de `8bb9451`, parce que cette métadonnée vient du contexte du workflow et non de la révision donnée à `actions/checkout`. Pour le rollback, la preuve fiable est donc le log de checkout, pas le SHA affiché par l'API Pages.

## Smoke de l'URL restaurée — 21 juillet 2026

URL : [https://lakav.github.io/RoundLab/](https://lakav.github.io/RoundLab/)

Contrôle HTTP :

```text
home status=200 content_type=text/html; charset=utf-8 time_total=0.203719
logo status=200 content_type=image/png size=496772 time_total=0.347063
```

Contrôle navigateur :

- titre du document : `RoundLab` ;
- `h1` visible : `RoundLab` ;
- bouton nommé `Open a local CS2 demo file` présent ;
- logo chargé depuis `https://lakav.github.io/RoundLab/logo.png`, largeur naturelle 899 px ;
- scripts Next.js chargés sous `https://lakav.github.io/RoundLab/_next/static/chunks/`.

Cette preuve valide le déploiement, le rollback et la restauration de la révision v0.1.39. Elle ne valide pas encore la future v0.1.40, qui devra exécuter sa propre CI, son propre déploiement, son smoke et son rollback avant création du tag.
