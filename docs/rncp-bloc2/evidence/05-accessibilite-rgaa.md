# Accessibilité — RGAA 4.1.2

Le référentiel principal est le RGAA 4.1.2. Il fournit une méthode française de vérification fondée sur les exigences WCAG 2.1 A et AA, mais une règle axe-core verte ne suffit pas à déclarer un critère RGAA conforme. Aucun taux global n'est calculé sans audit des critères applicables.

## Exécution automatisée du 21 juillet 2026

Cinq scénarios Playwright/axe-core couvrent désormais :

- accueil, import local, bibliothèque et contrôle de focus ;
- erreur de fichier annoncée, menus d'actions, dialogues de renommage/suppression, focus initial et fermeture par Échap ;
- replay, alternative DOM synchronisée au canvas, titres, régions et noms accessibles ;
- lecture, timeline, vitesse, couche radar, zoom, mode condensé, sélection du joueur, outils d'annotation et annulation au clavier ; dessin et déplacement de carte au pointeur ;
- reflow équivalent à des largeurs de 640 px et 320 px.

Le premier passage étendu a détecté un contraste de 3,93:1 et une timeline écrasée à 640 px. Les couleurs et la disposition ont été corrigées. La collecte finale passe 5/5 sans relance. Un passage antérieur avait subi un `SIGKILL` de Chrome avant création de page ; il a motivé une unique relance configurée, mais ne constitue pas un défaut d'accessibilité.

## Grille de contrôles réellement renseignée

| Critère / exigence | Applicable | Méthode | Résultat | Preuve | Correction |
| --- | --- | --- | --- | --- | --- |
| RGAA 3.2 / WCAG 1.4.3 — contraste du texte | oui | axe-core sur accueil et replay dans les états classique/condensé | PASS automatisé après correction | scénario replay commandes | `text-neutral-300`, contrôle axe rejoué |
| RGAA 8.3 — langue de la page | oui | inspection DOM + axe | PASS automatisé | rapport axe | aucune |
| RGAA 8.6 — titre de page pertinent | oui | inspection du document | PASS automatisé | rapport axe | aucune |
| RGAA 9.1 / WCAG 1.3.1 — titres structurés | oui | rôles Playwright + axe | PASS automatisé | scénarios accueil/replay | aucune |
| RGAA 9.2 — structure et landmarks | oui | rôles `banner`, `main`, `navigation`, régions | PASS automatisé | rapport axe | aucune |
| RGAA 10.4 / WCAG 1.4.4 — zoom texte | oui | viewport 640 px, équivalent de reflow 200 % | PASS automatisé limité | scénario reflow | barre de commandes empilée sous 768 px |
| RGAA 10.11 / WCAG 1.4.10 — reflow 400 % | oui | viewport 320 px, contrôles essentiels visibles | PASS automatisé limité | scénario reflow | timeline sur ligne dédiée, zones secondaires défilables |
| RGAA 11.1 — nom des champs | oui | nom accessible du fichier, de la timeline et du joueur comparé | PASS automatisé | scénarios accueil/replay | ajout `aria-label="Compared player"` |
| RGAA 11.10 — erreurs de saisie | oui | fichier invalide injecté, assertion `role=alert` | PASS automatisé | scénario erreurs/dialogues | aucune |
| RGAA 12.6 — regroupement/navigation | oui | landmarks et navigation nommée | PASS automatisé | rapport axe | aucune |
| RGAA 12.8 — ordre de tabulation | oui | focus ciblé sur import, dialogues et commandes | PARTIEL | assertions Playwright | parcours manuel complet requis |
| RGAA 12.9 — absence de piège clavier | oui | Échap sur dialogue, navigation clavier des commandes | PARTIEL | scénario dialogues/commandes | piège clavier complet à vérifier manuellement |
| RGAA 12.11 — contenus additionnels au focus | oui | menus/dialogues Base UI | PASS automatisé sur échantillon | scénario dialogues | aucune |
| RGAA 13.3 — alternatives aux contenus en mouvement | oui | région DOM reliée au radar par `aria-describedby` | PASS automatisé | scénario alternative replay | aucune |
| WCAG 2.1.1 / commandes replay au clavier | oui | Entrée/Espace sur lecture, vitesse, couche, zoom, mode, outil de dessin et annulation | PASS automatisé | scénario commandes | états `aria-pressed` ajoutés, dessin et pan testés au pointeur |
| restitution VoiceOver des pages et changements d'état | oui | VoiceOver macOS réel | NON DÉMONTRÉ | activation réelle confirmée le 21/07, mais navigation VO et annonces non observables par l'outil | intervention humaine requise |
| focus visible et ordre complet | oui | observation visuelle + Tab/Shift+Tab | NON DÉMONTRÉ | aucune session enregistrée | intervention humaine requise |
| zoom navigateur réel à 200 % et 400 % | oui | zoom Chrome/Safari réel | NON DÉMONTRÉ | aucun procès-verbal manuel | intervention humaine requise |
| contrastes internes au canvas PixiJS | oui | mesure visuelle/colorimétrique sur états réels | NON DÉMONTRÉ | axe exclut l'intérieur du canvas | intervention humaine requise |
| audit exhaustif des 106 critères RGAA | selon pages | audit manuel complet | NON DÉMONTRÉ | grille exhaustive vierge préparée ; 0 résultat manuel sur 106 | audit dédié requis |

## Grille exhaustive prête à renseigner

Le fichier `rgaa-4.1.2-grille.csv` contient les 106 critères du référentiel officiel RGAA 4.1.2 et les colonnes `critere`, `description`, `applicable`, `methode`, `resultat`, `preuve`, `correction`, `auditeur` et `date`. Les champs d'audit sont volontairement vides : leur présence ne constitue pas une validation.

Pour chaque critère, l'auditeur doit :

1. indiquer `oui` ou `non` dans `applicable` et justifier toute non-applicabilité dans `methode` ;
2. décrire la vérification réellement effectuée, sur les pages et états concernés ;
3. utiliser uniquement `CONFORME`, `NON CONFORME` ou `NON APPLICABLE` dans `resultat` ;
4. relier une preuve vérifiable et, pour tout écart, une correction ou une anomalie suivie ;
5. renseigner son identifiant, la date et conserver les versions du navigateur, de macOS et des technologies d'assistance dans le procès-verbal.

Le taux de conformité ne doit être calculé qu'après renseignement des 106 lignes, sur les seuls critères applicables, selon la méthode officielle. Dès qu'un élément testé invalide un critère sur une page de l'échantillon, ce critère n'est pas conforme. Source : [RGAA 4.1.2 — critères et tests](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/).

## Protocole VoiceOver à exécuter sur macOS

### Tentative outillée du 21 juillet 2026

VoiceOver a réellement été activé dans macOS, avec le panneau Légende configuré, puis Chrome a ouvert l'export local v0.1.40. L'arbre d'accessibilité de Chrome exposait correctement le titre, le bouton Settings, l'import et le contenu du panneau de réglages. La tabulation standard a aussi déplacé le focus vers le bouton Close.

Cette tentative ne vaut toutefois **pas** parcours VoiceOver : l'outil de contrôle d'interface ne peut pas émettre les raccourcis globaux `VO+…`, et aucune annonce exploitable n'est apparue dans le panneau Légende. Les essais de zoom navigateur piloté n'ont pas non plus fourni un niveau de zoom observable et vérifiable. VoiceOver a été remis sur `off`, Chrome restauré avec `Cmd+0` et le serveur local arrêté. Il faut donc toujours une personne devant le Mac pour exécuter et consigner le protocole ci-dessous.

1. Ouvrir Chrome sur l'accueil, activer VoiceOver avec `Cmd+F5`, puis la navigation web avec `VO+U`.
2. Parcourir le bandeau, le bouton d'import et la bibliothèque avec `VO+Flèche droite`; noter chaque nom, rôle, état et ordre.
3. Activer l'import au clavier, sélectionner une vraie démo et vérifier l'annonce du dialogue, de la progression, du pourcentage, du message de phase et de l'erreur éventuelle.
4. Ouvrir les menus Renommer et Supprimer ; vérifier le titre annoncé, le focus initial, l'ordre Tab/Shift+Tab, la fermeture Échap et le retour de focus.
5. Ouvrir un replay ; vérifier le titre, la navigation des commandes, leurs états appuyés, la timeline et les changements lecture/pause/vitesse/couche.
6. Lire la région « Text alternative for the replay radar » à trois instants : début, après un kill et pendant un état de bombe. Comparer oralement avec l'état visible.
7. Tester toutes les commandes au clavier sans souris, y compris dessin, annulation et effacement.
8. Refaire le parcours à 200 % puis 400 % de zoom navigateur et noter toute perte, superposition ou défilement bidimensionnel obligatoire.
9. Mesurer ou inspecter les contrastes du canvas sur joueurs, projectiles, fumée, feu, bombe et annotations.
10. Renseigner pour chaque étape : date, navigateur, version macOS, résultat observé, anomalie, capture ou enregistrement autorisé.

Statut global honnête : **PARTIEL**. Les contrôles automatisables sont renforcés et les écarts détectés ont été corrigés, mais C2.2.3 ne peut pas être déclaré ACQUIS avant le parcours VoiceOver, les contrôles manuels et la grille RGAA complète.
