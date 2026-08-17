# Rapport de preuves du 17 août 2026

## Périmètre

- branche : `codex/bloc-4-criteres-2026-08-17` ;
- base : `53a918e6b194555329762c51d6ab2c666aa86a1d` ;
- version candidate : `0.1.41` ;
- application : <https://lakav.github.io/RoundLab/>.

## C4.1.1 - Mise à jour des dépendances

L'audit initial retournait 16 vulnérabilités connues : 1 faible, 9 modérées et
6 élevées. Les versions transitives corrigées ont été verrouillées dans
`web/pnpm-workspace.yaml`, puis `web/pnpm-lock.yaml` a été régénéré.

Résultat final du 17 août 2026 : `pnpm audit` retourne **No known
vulnerabilities found**. Les paquets élevés corrigés sont `undici`, `fast-uri`,
`ip-address`, `brace-expansion`, `js-yaml` et `nanoid`. Les avis modérés ou
faibles restants dans Hono ont également été corrigés, ce qui explique le
résultat final à zéro.

## C4.1.2 - Supervision

La sonde a été exécutée sur l'export statique réellement construit :

| Contrôle | Résultat local |
| --- | --- |
| accueil | HTTP 200, conforme |
| `/feedback/` | HTTP 200, conforme |
| `health.json` | HTTP 200, version 0.1.41 |
| parseur WASM | taille, en-tête et SHA-256 conformes |

Le même contrôle sur la production existante a retourné HTTP 200 pour l'accueil
et `/feedback/`, puis HTTP 404 pour `health.json`. C'est le résultat attendu
avant déploiement de cette branche. Il serait faux de présenter la supervision
planifiée comme déjà active en production.

## Contrôles locaux réussis

- 3 tests unitaires dédiés à la sonde ;
- lint et vérification TypeScript ;
- 400 tests unitaires web avec seuils de couverture ;
- build statique Next.js ;
- 18 parcours Playwright réussis sur Chromium, Firefox, WebKit et mobile ; un
  benchmark optionnel sans corpus local a été ignoré ;
- génération du manifeste de santé ;
- audit complet de l'artefact statique ;
- budgets JavaScript et WebAssembly respectés ;
- 50 tests Rust, formatage, Clippy et `cargo audit` réussis ;
- audit npm final sans vulnérabilité connue.

## Preuves encore attendues

- run CI distant de cette branche ;
- déploiement de la version 0.1.41 après fusion ;
- premier run distant réussi de `monitor-production` ;
- issue et échange avec un utilisateur ou support réel pour C4.3.3.
