# Rapport de preuves techniques - 3 août 2026

## Révision contrôlée

- branche : `codex/bloc-4-maintenance-operationnelle` ;
- base : `a9178e5ff30d5b1c3e3c1905cc9c5c6160114b0c` ;
- version candidate : `0.1.41` ;
- heure du contrôle initial : 11:35, Europe/Paris.

## Production avant déploiement de la branche

| Contrôle | Résultat |
| --- | --- |
| `https://lakav.github.io/RoundLab/` | HTTP 200 |
| `https://lakav.github.io/RoundLab/feedback/` | HTTP 200 |
| `https://lakav.github.io/RoundLab/health.json` | HTTP 404 |

Le HTTP 404 du manifeste est attendu avant fusion : la version actuellement en
production a été construite avant l'ajout de `health.json`. Ce résultat interdit
de présenter la nouvelle sonde comme déjà active en production.

## Preuves GitHub historiques

| Preuve | Résultat | Lien |
| --- | --- | --- |
| CI `main` du commit `a9178e5` | succès | <https://github.com/Lakav/RoundLab/actions/runs/30799703961> |
| déploiement du commit `a9178e5` | succès | <https://github.com/Lakav/RoundLab/actions/runs/30799877146> |
| préparation 0.1.40 | CI frontend et Rust réussies | <https://github.com/Lakav/RoundLab/pull/2> |
| déploiement et rollback 0.1.40 | consignés avec les runs | <https://github.com/Lakav/RoundLab/pull/3> |
| restauration et smoke test | consignés avec les runs | <https://github.com/Lakav/RoundLab/pull/5> |
| nettoyage et suppression des anciens tags | CI réussie et décision consignée | <https://github.com/Lakav/RoundLab/pull/11> |

Les workflows de déploiement liés aux CI en échec du 27 et du 30 juillet 2026
ont été marqués `skipped`. Le garde-fou CI vers déploiement est donc observable
dans les deux sens.

## Contrôles locaux ajoutés

- compilation Python de la sonde, du manifeste, des audits et des tests ;
- trois tests de la sonde : succès complet, intégrité WASM invalide et route
  manquante ;
- génération d'un manifeste local pour l'export statique ;
- validation du JSON, de la version, du chemin, de la taille et du SHA-256 ;
- validation YAML des workflows, de Dependabot et du formulaire d'issue ;
- validation des workflows avec `actionlint` ;
- audits portables du projet.

Le contrôle local de bout en bout du 3 août 2026 à 11:41, Europe/Paris, a
retourné `PASSED` pour les quatre sondes : accueil, feedback, manifeste 0.1.41
et intégrité du WASM. Les durées observées sur le serveur local étaient
respectivement 11 ms, 1 ms, moins de 1 ms et 1 ms. Ces valeurs valident le
fonctionnement du script, pas la performance du réseau de production.

L'audit Rust a initialement remonté `RUSTSEC-2026-0190` pour `anyhow` 1.0.102 et
`RUSTSEC-2026-0186` pour `memmap2` 0.9.10. La recherche des fonctions affectées
n'a trouvé aucun appel dans le dépôt. Les versions ont tout de même été mises à
jour vers 1.0.103 et 0.9.11. Le second `cargo audit` ne remonte aucun avis.

## Activation restant à prouver

- fusion de la branche ;
- CI de la version 0.1.41 ;
- déploiement contenant `health.json` ;
- premier run manuel réussi de `monitor-production` ;
- plusieurs runs planifiés conservés ;
- première PR Dependabot ;
- premier signalement réel et échange avec un tiers.
