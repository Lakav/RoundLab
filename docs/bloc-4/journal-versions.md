# Journal des versions

## État de la traçabilité

La branche Bloc 4 prépare la version `0.1.41`. Le journal livrable principal est
désormais `CHANGELOG.md` à la racine. Aucun tag Git n'est disponible localement
et plusieurs changements importants ont été intégrés après le commit `de30fd8`
intitulé « Prepare RNCP Bloc 2 v0.1.40 evidence ».

Par conséquent, ce document ne prétend pas que tous les changements ci-dessous
ont été publiés sous le numéro `0.1.40`. Ils sont placés dans « Non publié » tant
qu'un numéro, un commit de livraison et une preuve de déploiement ne sont pas
associés.

## 0.1.41 - À publier

### Maintenance opérationnelle

- supervision planifiée toutes les six heures ;
- manifeste de déploiement avec version, commit et intégrité du WASM ;
- incident GitHub automatique en cas d'échec ;
- Dependabot hebdomadaire pour les trois écosystèmes ;
- formulaire d'anomalie et checklist de PR structurés ;
- tests locaux de la sonde et validation du manifeste dans la CI.
- correction de `RUSTSEC-2026-0190` et `RUSTSEC-2026-0186` dans le lockfile
  Rust.

La date, le commit, le run CI, le déploiement et le premier contrôle distant
restent à compléter après publication. Ils ne doivent pas être anticipés.

## Changements postérieurs au candidat 0.1.40

### Maintenance et sécurité

- mise à jour de dépendances web signalées comme vulnérables (`815fd82`) ;
- audit de sécurité web et Rust intégré à la CI ;
- reproductibilité de l'artefact WebAssembly vérifiée en CI ;
- audits du déploiement statique renforcés (`1daf05c`) ;
- alignement de la génération WASM sur Linux (`88a6bde`).

### Corrections

- limitation de la croissance mémoire pendant les longs replays (`19a13c8`) ;
- sécurisation du parsing navigateur des grandes démos (`c995760`) ;
- fiabilisation du moteur d'analyse CS2 (`a702d4c`).

### Évolutions

- refonte du rapport d'analyse et ajout d'analyses avancées (`8ddaa81`,
  `88bbf71`) ;
- clarification de la structure et des noms du projet (`70c4c5e`) ;
- actualisation de la documentation principale (`a9178e5`).

### Limites connues

- absence de supervision périodique du site déployé ;
- validation Safari et Firefox incomplète ;
- absence de corpus assez large pour publier des percentiles fiables ;
- pas de correspondance fiable entre l'historique récent et une version
  déployée.

## Modèle pour la prochaine version

```markdown
## [x.y.z] - AAAA-MM-JJ

- Commit ou tag : `...`
- Déploiement : lien GitHub Actions
- Contrôle post-déploiement : résultat et horodatage

### Ajouté

- ...

### Modifié

- ...

### Corrigé

- anomalie `B4-...` : ...

### Sécurité

- avis/CVE, dépendance, décision et résultat d'audit

### Limites ou migrations

- ...
```
