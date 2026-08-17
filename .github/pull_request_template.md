## Objectif

<!-- Quel problème précis est résolu ? -->

## Impact utilisateur

<!-- Comportement visible, compatibilité, migration ou absence d'impact. -->

## Validation

- [ ] lint et TypeScript
- [ ] tests unitaires / couverture
- [ ] build statique
- [ ] tests navigateur pertinents
- [ ] tests Rust et snapshots si le parseur change
- [ ] audits locaux pertinents

Commandes et résultats :

## Confidentialité et sécurité

- [ ] aucune démo privée, Steam ID, donnée utilisateur, chemin local ou secret ajouté
- [ ] aucun envoi réseau ou télémétrie silencieuse ajouté
- [ ] les erreurs et diagnostics restent expurgés

## Performance

- [ ] budgets vérifiés ou impact non applicable expliqué
- [ ] aucun outil de debug/benchmark ajouté au bundle initial

## Interface

- [ ] vérification clavier et responsive effectuée si l'UI change
- [ ] captures avant/après jointes si le rendu change

## Non-régression

- [ ] imports et migrations historiques préservés
- [ ] export GitHub Pages et base path `/RoundLab` préservés
- [ ] sélection globale du joueur et comparaison de coéquipiers préservées
- [ ] une donnée absente ne devient jamais un faux zéro

## Maintenance et livraison

- [ ] identifiant d'anomalie ou issue liée indiqué
- [ ] entrée ajoutée à `CHANGELOG.md` si le changement est livrable
- [ ] procédure de retour arrière décrite pour un changement risqué
- [ ] contrôle post-déploiement prévu

## Preuves

Ajouter les commandes, résultats, captures ou liens GitHub Actions utiles.
