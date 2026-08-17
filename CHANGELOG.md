# Journal des changements

Ce journal suit les changements livrables de RoundLab. La version applicative
est issue de `web/package.json`. Un numéro n'est considéré comme livré qu'avec
un commit identifié, une CI réussie et une preuve de déploiement.

## 0.1.41 - 17 août 2026

- révision de maintenance : `f1a559b` ;
- intégration dans `main` : `c479298` ;
- suivi de livraison : [pull request #23](https://github.com/Lakav/RoundLab/pull/23) ;
- validation après intégration : [GitHub Actions](https://github.com/Lakav/RoundLab/actions/runs/32021552440) ;
- publication : [GitHub Pages](https://github.com/Lakav/RoundLab/actions/runs/32021948177) ;
- contrôle extérieur : [sonde de production](https://github.com/Lakav/RoundLab/actions/runs/32022029821).

### Ajouté

- documentation du processus de maintenance et registre des incidents ;
- manifeste `health.json` associé à chaque export de production ;
- supervision planifiée de la page d'accueil, du formulaire de signalement et
  de l'intégrité du parseur WebAssembly ;
- création ou mise à jour automatique d'une issue en cas d'incident ;
- propositions hebdomadaires Dependabot pour npm, Cargo et GitHub Actions ;
- formulaire GitHub structuré de signalement d'anomalie.

### Maintenance et sécurité

- conservation pendant 90 jours des rapports produits par la sonde ;
- vérification locale automatisée du comportement de la sonde ;
- ajout d'une checklist de maintenance aux pull requests.
- correction des 16 avis npm observés le 17 août 2026, dont 6 de niveau élevé,
  par verrouillage des versions transitives corrigées ; l'audit final ne remonte
  plus aucune vulnérabilité connue ;
- correction de `RUSTSEC-2026-0190` par mise à jour de `anyhow` de 1.0.102 à
  1.0.103 ;
- correction de `RUSTSEC-2026-0186` par mise à jour de `memmap2` de 0.9.10 à
  0.9.11.

### Validation de la livraison

- les contrôles frontend et Rust ont réussi avant et après l'intégration ;
- la publication GitHub Pages a réussi ;
- le formulaire de signalement, le manifeste et le parseur WebAssembly ont été vérifiés depuis l'extérieur du site.

## 0.1.40 - Candidat du 21 juillet 2026

- commit de version : `de30fd8` ;
- passage de `0.1.39` à `0.1.40` dans le manifeste web ;
- CI, déploiement, retour arrière et restauration consignés dans les pull
  requests [#2](https://github.com/Lakav/RoundLab/pull/2),
  [#3](https://github.com/Lakav/RoundLab/pull/3) et
  [#5](https://github.com/Lakav/RoundLab/pull/5) ;
- aucun tag `v0.1.40` n'a été créé, car les validations humaines prévues à
  l'époque n'étaient pas terminées.

## Historique antérieur

Les anciens tags et releases `v0.1.x` ont été supprimés du dépôt distant lors
du nettoyage décrit dans la pull request
[#11](https://github.com/Lakav/RoundLab/pull/11). L'historique Git reste la
source disponible, mais cette suppression empêche de présenter les anciens tags
comme preuves actuelles de versionnement.
