# Journal des versions

## État de la traçabilité

La révision de maintenance publiée le 17 août 2026 est documentée dans le
`CHANGELOG.md` à la racine. Aucun tag Git n'est utilisé : la traçabilité repose
sur la pull request, le commit intégré, les contrôles automatisés et la preuve
de publication.

Les changements ci-dessous sont rattachés à des preuves consultables. Les
évolutions futures devront suivre la même règle avant d'être présentées comme
publiées.

## Révision de maintenance publiée le 17 août 2026

- changement principal : `f1a559b` ;
- intégration : `c479298` ;
- suivi : [pull request #23](https://github.com/Lakav/RoundLab/pull/23) ;
- validation : [GitHub Actions](https://github.com/Lakav/RoundLab/actions/runs/32021552440) ;
- publication : [GitHub Pages](https://github.com/Lakav/RoundLab/actions/runs/32021948177) ;
- contrôle public : [sonde de production](https://github.com/Lakav/RoundLab/actions/runs/32022029821).

### Maintenance opérationnelle

- supervision planifiée toutes les six heures ;
- manifeste de déploiement avec version, commit et intégrité du WASM ;
- incident GitHub automatique en cas d'échec ;
- Dependabot hebdomadaire pour les trois écosystèmes ;
- formulaire d'anomalie et checklist de PR structurés ;
- tests locaux de la sonde et validation du manifeste dans la CI.
- correction de `RUSTSEC-2026-0190` et `RUSTSEC-2026-0186` dans le lockfile
  Rust.
- correction de 16 avis npm, dont 6 élevés, avec audit final à zéro avis connu.

La chaîne complète a été observée : validation avant intégration, nouvelle
validation sur `main`, publication du site, puis contrôle public des pages et du
parseur WebAssembly.

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

- la sonde vérifie la disponibilité et l'intégrité des ressources, mais pas
  encore l'import complet d'une démo dans un navigateur ;
- Playwright couvre Firefox et WebKit, mais une campagne Safari sur matériel
  Apple reste à réaliser ;
- le corpus local n'est pas encore assez large pour publier des percentiles de
  performance fiables ;
- aucun retour d'un utilisateur distinct n'est encore rattaché à un correctif
  puis à un re-test.

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
