# Processus de maintenance opérationnelle

> Processus applicable à chaque évolution de maintenance intégrée dans `main`.

## 1. Objectif et périmètre

Ce processus organise la veille des dépendances, la détection des incidents,
la consignation des anomalies, les correctifs et les versions de RoundLab.

Il couvre l'application web, le parseur Rust/WASM, les ressources statiques,
la CI et le déploiement GitHub Pages.

## 2. Rôles

| Rôle | Responsabilité |
| --- | --- |
| Mainteneur | triage, diagnostic, correctif, tests, version et communication |
| Utilisateur ou client | description du problème, étapes, données partageables, validation fonctionnelle |
| GitHub Actions | contrôles automatiques et conservation temporaire des rapports |
| GitHub Pages | hébergement de l'export statique validé |

À ce jour, le mainteneur peut cumuler plusieurs rôles. Ce tableau décrit les
responsabilités, pas l'existence d'une équipe support dédiée.

## 3. Veille et mises à jour des dépendances

### Fréquence

- à chaque PR et push sur `main` : `pnpm audit` et `cargo audit` ;
- chaque lundi : revue des avis et versions disponibles ;
- premier jour ouvré du mois : lot de mises à jour mineures et correctives ;
- immédiatement : analyse d'une alerte critique affectant le périmètre.

Dependabot automatise la détection hebdomadaire pour npm, Cargo et GitHub
Actions. Il propose des PR, mais ne les fusionne pas automatiquement.

### Ordre de traitement

1. vulnérabilité exploitable dans le navigateur ou la chaîne de déploiement ;
2. vulnérabilité d'une dépendance Rust/WASM utilisée à l'exécution ;
3. incompatibilité avec Node, pnpm, Rust, Next.js ou GitHub Actions ;
4. correctifs et versions mineures ;
5. versions majeures, une par branche dédiée.

### Types de mise à jour

- sécurité : priorité sur le calendrier normal ;
- corrective : regroupée si le risque est faible ;
- mineure : regroupée et testée sur l'ensemble de la CI ;
- majeure : isolée, accompagnée des notes de migration et d'un plan de retour.

### Validation

```text
lockfile figé -> audit -> tests -> lint/typage -> build -> accessibilité
-> audits applicatifs -> revue du diff -> fusion -> contrôle post-déploiement
```

Une mise à jour ne doit pas être fusionnée uniquement parce que l'installation
réussit. Elle doit passer les contrôles fonctionnels et les audits du projet.

## 4. Supervision

### Indicateurs existants avant déploiement

- vulnérabilités de dépendances ;
- succès des tests et seuils de couverture ;
- erreurs de typage et de lint ;
- succès du build statique ;
- conformité accessibilité automatisée ;
- taille totale JavaScript ;
- taille et nombre d'artefacts WebAssembly ;
- reproductibilité de l'artefact WASM ;
- invariants de sécurité, de portabilité et de localité des données.

### Indicateurs de production à ajouter

- disponibilité de la page d'accueil ;
- disponibilité d'une route exportée, par exemple `/feedback/` ;
- disponibilité du fichier WebAssembly attendu ;
- durée de réponse HTTP ;
- succès d'un parcours navigateur minimal sur une version déployée.

Les quatre premiers contrôles sont implémentés par la sonde de la version
0.1.41. Un parcours complet avec import d'une démo reste à ajouter, car il
nécessite une fixture publiable et un vrai navigateur.

### Signalement

La sonde s'exécute toutes les six heures. En cas d'échec, elle conserve ses
rapports JSON et Markdown pendant 90 jours, ouvre ou actualise une issue unique
et laisse le workflow en échec. Lors du retour à la normale, elle commente puis
ferme l'incident existant.

### Seuils proposés

| Indicateur | Avertissement | Critique |
| --- | --- | --- |
| Page publique | une sonde échouée | deux sondes consécutives échouées |
| Réponse HTTP | plus de 2 s | plus de 5 s ou code non-2xx/3xx |
| Ressource WASM | sans objet | absente ou non chargeable |
| CI de `main` | sans objet | un job obligatoire échoue |
| Audit de sécurité | avis modéré à analyser | avis élevé ou critique |
| Budget JavaScript | moins de 40 Kio de marge | plus de 2 150 000 octets |
| Budget WASM | moins de 100 Kio de marge | plus de 3 500 000 octets |

Les seuils de disponibilité devront être ajustés après collecte d'une première
semaine de mesures. Avant cette baseline, ils sont des choix de départ.

## 5. Cycle de traitement d'une anomalie

1. **Collecter** : créer une issue à partir de `/feedback` ou saisir une fiche
   équivalente.
2. **Qualifier** : vérifier version, environnement, données concernées et
   impact.
3. **Reproduire** : écrire les étapes minimales et conserver uniquement des
   données partageables.
4. **Prioriser** : appliquer la grille de sévérité ci-dessous.
5. **Diagnostiquer** : identifier la cause et consigner les hypothèses rejetées.
6. **Corriger** : travailler sur une branche dédiée avec le plus petit diff
   cohérent.
7. **Tester** : ajouter au moins un test qui échoue avant le correctif et passe
   après, lorsque le défaut est automatisable.
8. **Intégrer** : ouvrir une PR, obtenir une CI verte et relire le diff.
9. **Déployer** : fusionner vers `main`, laisser le workflow GitHub Pages
   publier le commit validé.
10. **Contrôler** : vérifier la production et demander confirmation à la
    personne ayant signalé le problème.
11. **Clore** : renseigner version, commit, preuve et éventuelles suites.

## 6. Sévérité et délais cibles

| Niveau | Définition | Décision cible | Résolution ou contournement cible |
| --- | --- | --- | --- |
| P0 | indisponibilité générale, perte de données ou faille critique exploitable | 4 h | 24 h |
| P1 | fonction principale bloquée sans contournement raisonnable | 1 jour ouvré | 3 jours ouvrés |
| P2 | défaut important avec contournement | 2 jours ouvrés | prochaine version planifiée |
| P3 | défaut mineur, cosmétique ou amélioration | une semaine | selon priorité produit |

Ces délais sont des objectifs de maintenance, pas des SLA contractuels.

## 7. Retour arrière

RoundLab étant statique, le retour arrière consiste à redéployer un commit connu
comme sain. Le commit cible doit avoir passé la CI. Pour un défaut de données
locales, aucune suppression automatique d'IndexedDB ne doit être déclenchée :
les imports historiques doivent rester récupérables ou migrables.

## 8. Données et confidentialité

- ne jamais joindre une démo utilisateur sans accord explicite ;
- privilégier une démo minimale ou synthétique pour les tests ;
- supprimer les identifiants inutiles d'une preuve ;
- ne pas centraliser les logs navigateur sans consentement ;
- documenter la durée de conservation de tout futur rapport distant.

## 9. Critères de clôture

Une anomalie est close seulement si :

- la cause et l'impact sont compris ;
- le correctif ou le contournement est documenté ;
- les tests adaptés passent ;
- la CI du commit livré est verte ;
- la version ou le commit déployé est renseigné ;
- le contrôle de production est réussi ;
- la personne à l'origine du signalement a été informée, si elle est connue.
