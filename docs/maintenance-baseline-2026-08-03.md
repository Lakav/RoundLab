# Baseline de maintenance — 3 août 2026

Ce document fige les mesures prises sur `main` au commit `a9178e5` avant le
chantier de robustesse. Les valeurs finales doivent être comparées sur la même
machine et avec les mêmes commandes.

## État GitHub

- CI : réussie ([run 30799703961](https://github.com/Lakav/RoundLab/actions/runs/30799703961)).
- Déploiement Pages : réussi ([run 30799877146](https://github.com/Lakav/RoundLab/actions/runs/30799877146)).
- Protection de `main` : absente (`GET /branches/main/protection` retourne 404).

## Tests et couverture

Commande : `cd web && pnpm test:coverage`.

- 47 fichiers de tests unitaires ;
- 392 tests réussis ;
- durée Vitest : 6,99 s ;
- durée murale de la commande : 8,67 s ;
- statements : 78,76 % (4 665 / 5 923) ;
- branches : 71,78 % (3 511 / 4 891) ;
- fonctions : 86,36 % (1 064 / 1 232) ;
- lignes : 81,74 % (4 255 / 5 205).

Ce périmètre initial exclut notamment `src/components/report/**` et
`src/workers/**`. Il ne doit donc pas être comparé directement au futur
périmètre élargi sans rappeler cette différence.

Playwright contient deux fichiers et huit cas déclarés. Le test de performance
avec import réel est ignoré sans `ROUNDLAB_BENCHMARK_DEMOS`.

## Build et poids

Commande : `cd web && pnpm build`.

- durée murale : 6,95 s ;
- JavaScript de production : 2 110 189 octets dans 40 fichiers ;
- budget JavaScript : 2 150 000 octets ;
- WASM : 2 953 515 octets dans un fichier ;
- budget WASM : 3 500 000 octets ;
- export `web/out` : 9 412 608 octets sur disque ;
- `web/public/logo.png` : 496 772 octets ;
- plus gros chunk JavaScript : environ 448 Kio sur disque.

## Dette statique

`pnpm dlx knip --reporter compact` ne signale aucun fichier ni paquet npm
inutilisé. Il signale :

- le binaire externe `wasm-bindgen`, appelé par le script `parser:wasm` ;
- 28 exports de valeurs inutilisés ;
- 10 groupes de types exportés inutilisés.

Ces résultats doivent être triés : un contrat public documenté n'est pas du
code mort uniquement parce que l'application courante ne l'importe pas.
