# Protocole de validation utilisateur v0.1.40

Statut au 21 juillet 2026 : **BLOQUÉ — aucun participant humain réel n'a été observé**. Les tests automatisés et le smoke HTTP ne remplacent pas cette validation.

## Conditions

- participant n'ayant pas contribué au code testé ;
- utilisation d'une vraie démo autorisée, sur un navigateur et une machine identifiés ;
- traitement local expliqué sans guider les actions ;
- chronométrage du début de la consigne jusqu'à la réussite ou l'abandon ;
- notes anonymisées (`P01`, `P02`, etc.), sans nom, adresse ou identifiant de jeu ;
- consentement recueilli avant la prise de notes.

## Tâches

| ID | Consigne donnée sans aide | Réussite attendue |
| --- | --- | --- |
| UT-01 | Importer la démo fournie | la démo est parsée et apparaît dans la bibliothèque |
| UT-02 | Retrouver le match importé | le bon match est identifié sans aide |
| UT-03 | Ouvrir un round demandé | le replay affiche le bon round |
| UT-04 | Lancer, mettre en pause puis aller à un instant donné | lecture, pause et timeline sont utilisées correctement |
| UT-05 | Afficher les utilitaires d'un round | projectiles et effets sont repérés sur le radar |
| UT-06 | Créer puis effacer une annotation | un trait est créé puis supprimé |
| UT-07 | Consulter le résumé accessible | l'alternative textuelle du radar est retrouvée et comprise |
| UT-08 | Supprimer le match | le dialogue est compris et la suppression confirmée |

Deux participants réels distincts sont obligatoires. Une seule session, même complète, ne valide pas ce gate.

## Fiche par participant

| Participant | Profil | Environnement | Tâches réussies / 8 | Durée totale | Difficultés observées | Problèmes rencontrés | Commentaire verbatim court |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| — | — | — | — | — | — | — | — |

## Journal par tâche

| Participant | Tâche | Réussite | Durée | Aide fournie | Difficulté (1–5) | Problème rencontré | Observation factuelle |
| --- | --- | --- | ---: | --- | ---: | --- | --- |
| — | — | — | — | — | — | — | — |

## Synthèse à remplir après les sessions

| Problème observé | Participants concernés | Gravité | Correction décidée | Test ajouté | Re-test utilisateur |
| --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — |

Aucun taux de réussite, aucune durée moyenne et aucune conclusion d'utilisabilité ne doivent être ajoutés tant que les lignes réelles ne sont pas renseignées.

## Fichiers structurés et contrôle

- `validation-utilisateur-participants.csv` reçoit une ligne par participant anonymisé, uniquement après consentement et session réelle.
- `validation-utilisateur-taches.csv` reçoit exactement les huit tâches `UT-01` à `UT-08` pour chaque participant.
- les durées sont saisies en secondes ; `duree_totale_secondes` doit être la somme des huit durées ; `taches_reussies` doit correspondre aux huit résultats `oui` ou `non`.
- `aide_fournie`, `difficultes`, `problemes_rencontres`, `probleme_rencontre` et `observation` doivent contenir une observation réelle ; écrire `aucun` ou `aucune` lorsque c'est factuellement le cas plutôt que laisser le champ vide.

`python3 scripts/audit-user-validation.py` vérifie la structure sans transformer les fichiers vides en preuve. Après deux sessions réelles complètes, `python3 scripts/audit-user-validation.py --require-complete` doit réussir avant de calculer un taux ou de présenter la validation comme acquise.
