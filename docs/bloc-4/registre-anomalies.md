# Registre initial des anomalies

Ce registre est reconstruit à partir de l'historique Git. Lorsque le ticket
d'origine ou les mesures exactes ne sont pas disponibles, la limite est indiquée
au lieu d'être inventée.

## Vue d'ensemble

| ID | Date | Anomalie | Sévérité estimée | Statut | Correctif |
| --- | --- | --- | --- | --- | --- |
| B4-001 | 22/07/2026 | croissance mémoire pendant les longs replays | P1 | corrigée | `19a13c8` |
| B4-002 | 22/07/2026 | échec d'import d'une très grande démo | P1 | corrigée | `c995760` |
| B4-003 | 30/07/2026 | dépendances web vulnérables | indéterminée | corrigée selon le commit | `815fd82` |
| B4-004 | 03/08/2026 | deux dépendances Rust affectées par des avis d'unsoundness | P2 | corrigée sur la branche | `Cargo.lock` |
| B4-005 | 17/08/2026 | 16 avis npm, dont 6 élevés | P1 | corrigée sur la branche | `pnpm-workspace.yaml`, `pnpm-lock.yaml` |

La sévérité de B4-001 et B4-002 est une estimation faite pour ce dossier à
partir de l'impact visible. Elle n'était pas enregistrée lors du traitement.
La sévérité de B4-003 est impossible à déterminer sans l'avis de sécurité
d'origine.

## B4-005 - Avis npm détectés le 17 août 2026

| Champ | Contenu |
| --- | --- |
| Source | `pnpm audit` exécuté localement le 17 août 2026 |
| Résultat initial | 16 avis : 1 faible, 9 modérés et 6 élevés |
| Paquets élevés | `undici`, `fast-uri`, `ip-address`, `brace-expansion`, `js-yaml`, `nanoid` |
| Résultat attendu | aucun avis connu après mise à jour et non-régression complète |
| Sévérité projet | P1, car l'audit `high` bloque la CI et donc tout déploiement |
| Statut | corrigé sur `codex/bloc-4-criteres-2026-08-17` |

### Reproduction et analyse

1. Depuis `web/`, exécuter `pnpm audit --audit-level high` sur le lockfile de
   `main` au commit `53a918e`.
2. Constater les six avis élevés dans des dépendances transitives de Next,
   shadcn, ESLint, Vitest et PostCSS.
3. Vérifier les versions corrigées indiquées par l'audit.

Les paquets concernés ne sont pas déclarés directement par RoundLab. Une mise à
jour des dépendances parentes dans leurs plages existantes ne suffisait pas. La
solution retenue impose uniquement les versions transitives corrigées dans
`web/pnpm-workspace.yaml`, avec une exception explicite au délai de maturité de
14 jours pour ces correctifs de sécurité.

### Correctif et non-régression

Après régénération de `web/pnpm-lock.yaml`, `pnpm audit` retourne **No known
vulnerabilities found**. Les validations suivantes passent : lint, TypeScript,
400 tests unitaires avec couverture, build Next statique, génération du
manifeste `health.json` et audit de l'export. La CI distante reste à obtenir
après publication de la branche.

## B4-001 - Croissance mémoire pendant le replay

| Champ | Contenu |
| --- | --- |
| Source | historique Git local |
| Commit | `19a13c8` - « Fix replay memory growth » |
| Environnement | application web, replay PixiJS et stockage Zustand |
| Résultat observé | accumulation de rounds complets et d'objets graphiques détachés pendant les longs matchs |
| Résultat attendu | mémoire bornée autour du round courant et destruction des ressources graphiques inutiles |
| Sévérité estimée | P1, car un long replay peut devenir inutilisable |
| Ticket ou utilisateur d'origine | non conservé dans le dépôt |

### Reproduction reconstruite

1. Charger un match contenant plusieurs rounds.
2. Parcourir le replay ou construire la vue condensée sur tout le match.
3. Observer que les payloads complets de nombreux rounds restent en mémoire.
4. Observer que la file d'objets PixiJS détachés peut croître sans borne.

Ces étapes sont déduites du diff et des tests ajoutés. Elles ne remplacent pas
un ticket d'origine horodaté.

### Cause et correctif

Deux rétentions sont corrigées :

- les rounds complets visités pour l'analyse condensée étaient conservés dans
  l'état global ;
- la file de destruction différée des objets PixiJS pouvait grandir et les
  ressources associées n'étaient pas toutes détruites.

Le correctif charge transitoirement les rounds d'analyse, ne conserve que le
round courant et ses voisins, borne la file de destruction et détruit les
ressources graphiques avec leurs contextes et styles.

### Non-régression

Le commit ajoute ou renforce des tests dans :

- `web/tests/match-viewer.test.tsx` ;
- `web/tests/replay-store.test.ts` ;
- `web/tests/map-renderer-logic.test.ts`.

### Preuves manquantes

- mesure mémoire avant/après ;
- capture du défaut ;
- ticket ou échange avec la personne ayant signalé le problème ;
- lien du run CI et du déploiement.

## B4-002 - Échec d'import d'une très grande démo

| Champ | Contenu |
| --- | --- |
| Source | historique Git local et tests actuels |
| Commit | `c995760` - « Fix large demo browser parsing » |
| Environnement | navigateur, décompression Zstd, parseur Rust/WASM |
| Résultat observé | erreur mémoire WebAssembly lors de certains imports volumineux |
| Résultat attendu | import réalisable avec une stratégie sûre ou refus explicite du mode trop coûteux |
| Sévérité estimée | P1, car l'import est une fonction principale |
| Ticket ou utilisateur d'origine | non conservé dans le dépôt |

### Reproduction reconstruite

1. Choisir une démo `.dem.zst` dont la taille décompressée atteint au moins
   384 Mio.
2. Tenter un traitement avec l'échantillonnage complet.
3. Avant correction, la coexistence des tas de décompression et de parsing peut
   déclencher une erreur telle que `out of memory`, `unreachable` ou
   `memory access out of bounds`.

Le test actuel inclut le cas de 569 931 815 octets, mais ce nombre n'est pas une
mesure de consommation mémoire. C'est une taille d'entrée utilisée pour vérifier
la stratégie.

### Cause et correctif

- décompression transférée dans un Worker dédié puis terminé ;
- buffer transféré sans copie inutile ;
- mode rapide utilisant l'échantillonnage `high` ;
- mode précis interdit au-dessus du seuil de 384 Mio ;
- message d'erreur compréhensible pour les erreurs mémoire connues ;
- audit garantissant que le traitement reste local au navigateur.

### Non-régression

`web/tests/parser-memory.test.ts` vérifie le seuil, les modes autorisés et la
conversion du message d'erreur. `scripts/audit-browser-parser-locality.py`
vérifie les invariants du flux local et la terminaison du Worker.

### Preuves manquantes

- fichier de reproduction partageable ;
- mesure avant/après dans le même navigateur ;
- ticket initial et validation de l'utilisateur ;
- lien de PR et de déploiement.

## B4-003 - Dépendances web vulnérables

| Champ | Contenu |
| --- | --- |
| Source | historique Git local |
| Commit | `815fd82` - « Met à jour les dépendances web vulnérables » |
| Environnement | dépendances web verrouillées par pnpm |
| Résultat observé | présence d'au moins une dépendance considérée vulnérable selon le message du commit |
| Résultat attendu | aucun avis élevé ou critique bloquant dans `pnpm audit` |
| Sévérité | impossible à déterminer avec les preuves conservées |
| Ticket ou avis d'origine | absent du dépôt |

### Traitement observable

Le commit modifie le lockfile web et la configuration du workspace. La CI
actuelle exécute `pnpm audit --audit-level high`, ce qui bloque les avis élevés
ou critiques détectés par cet outil.

### Limite de preuve

Le dépôt ne permet pas d'identifier les paquets touchés, les CVE, leur
exploitabilité dans RoundLab ou le résultat chiffré de l'audit avant/après. Il
serait faux d'inventer ces détails. Une prochaine mise à jour de sécurité devra
conserver la sortie de l'audit dans la PR ou dans une annexe expurgée.

## B4-004 - Avis RustSec sur `anyhow` et `memmap2`

| Champ | Contenu |
| --- | --- |
| Source | `cargo audit` exécuté le 3 août 2026 |
| Avis | `RUSTSEC-2026-0190` et `RUSTSEC-2026-0186` |
| Dépendances | `anyhow` 1.0.102 et `memmap2` 0.9.10 |
| Type | avertissements d'unsoundness avec risque de comportement indéfini |
| Exposition observée | aucun appel aux fonctions affectées trouvé dans le dépôt |
| Sévérité projet estimée | P2, correction disponible sans migration majeure |
| Statut | corrigé dans le lockfile de la version candidate 0.1.41 |

### Traitement

Les avis indiquent des corrections disponibles à partir de `anyhow` 1.0.103 et
`memmap2` 0.9.11. Les deux dépendances ont été mises à jour précisément vers
ces versions. Les 50 tests Rust actuels, `cargo fmt`, Clippy, la cible WASM et
`cargo audit` passent après la modification.

### Analyse de risque

La recherche locale ne trouve aucun usage de `Error::downcast_mut`,
`advise_range`, `unchecked_advise_range`, `flush_range` ou
`flush_async_range`. Cela réduit l'exposition observée, sans constituer une
preuve formelle d'inexploitabilité à travers tout code transitoire. La mise à
jour restait donc préférable à une exception d'audit.
