# Accessibilité - RGAA 4.1.2

Le référentiel principal est **RGAA 4.1.2**, adapté à un livrable français. Il opérationnalise les exigences WCAG 2.1 pour l'audit ; une absence de violation axe-core n'est pas une déclaration de conformité RGAA.

## Réalisations vérifiées

- langue anglaise déclarée, titre `h1`, landmarks `header`, `main` et `nav` ;
- import fichier accessible au clavier et correctement nommé ;
- erreurs en `role="alert"`, progression en `role="status"` et `aria-live` ;
- dialogues nommés, modaux, fermables par Échap et avec focus initial ;
- boutons de dessin nommés avec état `aria-pressed`, curseur de timeline nommé ;
- contrastes textuels améliorés sur les principaux contrôles ;
- canvas exposé comme image interactive et relié à une alternative DOM décrivant round, temps, joueurs, événements et état de bombe.

## Résultats

| Contrôle | Résultat | Portée |
| --- | --- | --- |
| axe-core accueil/import/bibliothèque | 0 violation | Chrome système, fixture locale |
| axe-core replay | 0 violation hors analyse interne du canvas | page replay seedée |
| clavier/focus import | PASS | test Playwright |
| noms accessibles et landmarks | PASS | axe + assertions |
| alternative DOM du canvas | PASS | contenu et relation ARIA testés |
| contrastes automatisés | PASS sur l'échantillon axe | ne couvre pas toutes les couleurs dessinées dans PixiJS |
| VoiceOver | NON DÉMONTRÉ | aucune session manuelle enregistrée |
| zoom 200/400 %, reflow | NON DÉMONTRÉ | aucun procès-verbal manuel |
| audit exhaustif des 106 critères | NON DÉMONTRÉ | aucun taux de conformité calculé |

Statut global : **PARTIEL**. Le code et les tests améliorent réellement l'accès, mais le dossier ne doit afficher aucun pourcentage de conformité RGAA.
