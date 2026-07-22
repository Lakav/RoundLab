# Accessibilité — RGAA 4.1.2

Le référentiel principal est le RGAA 4.1.2. Il fournit une méthode française de vérification fondée sur les exigences WCAG 2.1 A et AA, mais une règle axe-core verte ne suffit pas à déclarer un critère RGAA conforme. Aucun taux global n'est calculé sans audit des critères applicables.

## Exécution automatisée du 21 juillet 2026

Six scénarios Playwright/axe-core couvrent désormais :

- accueil, import local, bibliothèque et contrôle de focus ;
- erreur de fichier annoncée, menus d'actions, dialogues de renommage/suppression, focus initial et fermeture par Échap ;
- replay, alternative DOM synchronisée au canvas, titres, régions et noms accessibles ;
- lecture, timeline, vitesse, couche radar, zoom, mode condensé, sélection du joueur, outils d'annotation et annulation au clavier ; dessin et déplacement de carte au pointeur ;
- reflow équivalent à des largeurs de 640 px et 320 px.
- styles désactivés et espacement du texte forcé à 320 px.

Le premier passage étendu a détecté un contraste de 3,93:1 et une timeline écrasée à 640 px. Les couleurs et la disposition ont été corrigées. La collecte finale passe 6/6 sans relance. Un passage antérieur avait subi un `SIGKILL` de Chrome avant création de page ; il a motivé une unique relance configurée, mais ne constitue pas un défaut d'accessibilité.

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
| restitution par lecteur d'écran des pages et changements d'état | oui | aucun parcours fiable observable dans cette campagne | NON DÉMONTRÉ | limite résiduelle explicitement conservée | hors gate REC-15 |
| focus visible et ordre accueil | oui | observation visuelle + Tab dans Chrome système | PASS | capture `02-focus-lien-evitement.png` et scénario Playwright | lien d'évitement ajouté |
| zoom navigateur réel à 200 % et 400 % | oui | Chrome système piloté, plus contrôle automatisé 640/320 px | NON DÉMONTRÉ | les commandes Chrome ont été activées, mais le pourcentage réel n'était pas exposé ou observable de manière fiable | contrôle humain avec niveau affiché requis |
| contrastes internes au canvas PixiJS | oui | inspection du renderer et tentative de définir une mesure pixel reproductible | NON DÉMONTRÉ | axe exclut l'intérieur du canvas ; les couleurs source seules ne prouvent pas leur contraste sur chaque fond texturé et chaque état | mesure colorimétrique sur états réellement rendus requise |
| audit exhaustif des 106 critères RGAA | selon pages | preuves source, DOM, axe, Playwright et captures | PARTIEL | 106/106 renseignés : 49 conformes, 53 non applicables, 4 non démontrés | zoom réel et canvas à compléter |

## Grille exhaustive renseignée

Le fichier `rgaa-4.1.2-grille.csv` contient les 106 critères du référentiel officiel RGAA 4.1.2 et les colonnes `critere`, `description`, `applicable`, `methode`, `resultat`, `preuve`, `correction`, `auditeur` et `date`. Chaque ligne est renseignée. Les quatre résultats `NON DÉMONTRÉ` empêchent volontairement le calcul d'un taux.

Pour chaque critère, l'auditeur doit :

1. indiquer `oui` ou `non` dans `applicable` et justifier toute non-applicabilité dans `methode` ;
2. décrire la vérification réellement effectuée, sur les pages et états concernés ;
3. utiliser uniquement `CONFORME`, `NON CONFORME`, `NON APPLICABLE` ou `NON DÉMONTRÉ` dans `resultat` ;
4. relier une preuve vérifiable et, pour tout écart, une correction ou une anomalie suivie ;
5. renseigner son identifiant, la date et conserver les versions du navigateur, de macOS et des technologies d'assistance dans le procès-verbal.

Le taux de conformité ne doit être calculé qu'après renseignement des 106 lignes, sur les seuls critères applicables, selon la méthode officielle. Dès qu'un élément testé invalide un critère sur une page de l'échantillon, ce critère n'est pas conforme. Source : [RGAA 4.1.2 — critères et tests](https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/).

Le contrôle portable `python3 scripts/audit-rgaa-grid.py` vérifie la structure et la cohérence des 106 lignes. `--require-complete` exige que chaque ligne soit documentée, mais ne transforme jamais `NON DÉMONTRÉ` en conformité. Le script renvoie `complianceRate: null` tant qu'un critère applicable reste `NON DÉMONTRÉ`.

## Limite résiduelle

### Tentative de zoom navigateur réel du 21 juillet 2026

L'export local a été ouvert dans Google Chrome système. Deux tentatives indépendantes ont piloté le menu Chrome et son bouton d'augmentation depuis une remise à 100 % par le raccourci navigateur. Cinq activations successives ont été envoyées à chaque tentative, ce qui aurait normalement dû conduire à 200 %. Cependant, le pourcentage n'était pas exposé dans l'arbre d'accessibilité et, dans les deux cas, le menu a ensuite laissé l'outil sans capture ni arbre de page exploitable, y compris après réinitialisation de la session. Les préférences Chrome lues après la première tentative ne contenaient pas non plus d'entrée persistée permettant d'attester le niveau appliqué à `127.0.0.1`. Un raccourci de remise à 100 % a été envoyé en fin de seconde tentative, mais son effet n'était pas observable non plus.

Cette tentative ne vaut donc pas preuve à 200 %, encore moins à 400 %. Les trois contrôles `zoom_200`, `zoom_400` et `defilement_horizontal` restent volontairement `NON DÉMONTRÉ`.

### Contraste du canvas

Les couleurs, opacités et contours du renderer PixiJS ont été inspectés. Cette inspection confirme que les états ne se réduisent pas à une paire de couleurs fixe : les marqueurs sont composités sur une image radar texturée avec des opacités et des animations variables. Un rapport calculé uniquement depuis les constantes source, ou une recherche de quelques pixels favorables dans une capture, ne démontrerait pas le critère RGAA 3.3. Aucune conformité n'est revendiquée sans capture d'états représentatifs et mesure reproductible de chaque élément porteur d'information par rapport à ses couleurs adjacentes.

### Historique de la tentative du 21 juillet 2026

VoiceOver a été activé sur macOS avec son panneau de légende, puis Chrome a affiché l'export local. L'arbre d'accessibilité exposait le titre, le bouton Settings, l'import et le panneau de réglages. En revanche, l'outil n'a pas pu piloter les raccourcis globaux VO ni observer une annonce exploitable. Cette tentative historique est conservée, mais elle ne vaut pas parcours validé et n'entre pas dans le gate REC-15.

La limite exacte de cette campagne est : **lecteur d’écran non testé**. Aucun succès de restitution orale n'est revendiqué et REC-15 ne dépend pas d'un tel succès. Le gate porte sur le clavier, le focus visible et restitué, les zooms navigateur réels à 200 % et 400 %, l'absence de défilement horizontal bloquant, les contrastes du canvas, la cohérence canvas/alternative DOM et la grille RGAA documentée.

Statut global honnête : **PARTIEL** tant que ces contrôles structurés ne sont pas tous démontrés. La limite « lecteur d’écran non testé » reste publiée même après leur réussite.
