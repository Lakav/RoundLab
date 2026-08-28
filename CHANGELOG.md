# Journal des changements

Ce journal suit les changements livrables de RoundLab. La version applicative
est issue de `web/package.json`. Un numéro n'est considéré comme livré qu'avec
un commit identifié, une CI réussie et une preuve de déploiement.

## Non publié

Section en attente : les preuves d'intégration, de CI et de déploiement seront
ajoutées à la livraison, conformément à la règle ci-dessus.

### Modifié

- unification des couleurs du replay 2D : le canvas dérive désormais ses
  couleurs de `THEME` au lieu de les redéfinir, ce qui supprime les deux
  bleus CT et les deux ambres T divergents entre le HUD et le radar ;
- le rouge est réservé au danger : le porteur de bombe conserve la couleur
  de son camp et reçoit un anneau distinct, au lieu de prendre la couleur
  du feu ;
- la vie et le nom du joueur sont séparés : la santé passe sur un anneau
  autour du marqueur et le nom reste lisible à toutes les valeurs de HP ;
- un joueur mort est distingué par la forme et non par la seule opacité ;
- les noms des joueurs superposés sont répartis sur des emplacements libres
  et dessinés au-dessus des marqueurs ;
- application du système de tokens au rapport : la marque n'exprime plus un
  jugement de valeur, les couleurs sémantiques sont uniformisées et les
  couleurs d'équipe du rapport rejoignent celles du radar ;
- plancher typographique de 12 px dans l'interface, en remplacement des
  107 occurrences situées sous ce seuil.

### Accessibilité

- correction de contraste : `--rl-fg-dim` et `--rl-critical` étaient
  respectivement à 4,50 et 4,53 pour un seuil AA de 4,5, sans marge ; les
  modificateurs d'opacité appliqués aux couleurs de texte passaient sous le
  seuil et sont retirés.

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
