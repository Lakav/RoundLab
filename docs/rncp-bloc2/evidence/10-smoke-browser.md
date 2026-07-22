# Smoke tests navigateur

Dates : 20 et 21 juillet 2026. Navigateurs : Chrome système piloté par Playwright et navigateur intégré pour l'URL publiée.

| Cible | Contrôle | Observé | Statut |
| --- | --- | --- | --- |
| accueil | titre, `h1`, import, bibliothèque seedée | éléments visibles et nommés | PASS |
| clavier | focus sur l'import | focus effectivement reçu | PASS |
| accueil | axe-core | 0 violation | PASS |
| replay | canvas et contrôles | radar visible, timeline active | PASS |
| replay | alternative DOM | région nommée contenant les joueurs et événements | PASS |
| replay | axe-core | 0 violation, canvas exclu de l'analyse pixel | PASS |
| rendu | icônes PixiJS | aucune erreur de décodage ou rejet non géré | PASS |
| GitHub Pages | export avec `/RoundLab` | logo, chunks, cartes et icônes préfixés ; audit output vert | PASS local |
| GitHub Pages | `https://lakav.github.io/RoundLab/` | HTTP 200, titre et `h1` RoundLab, import nommé, logo et chunks chargés | PASS distant le 21/07 |
| rollback v0.1.40 | `2dc622d` → `2e51eaf` | checkout prouvé, site fonctionnel, manifeste de chunks modifié | PASS distant le 21/07 |
| restauration v0.1.40 | `2e51eaf` → `2dc622d` | checkout prouvé, site fonctionnel, chunk v0.1.40 revenu | PASS distant le 21/07 |
| déploiement candidate applicative | `07fb59a` | checkout prouvé, HTTP 200, chunk `3gzjaewd3cdr_.js` | PASS distant le 21/07 |
| rollback candidate applicative | `07fb59a` → `2e51eaf` | checkout prouvé, HTTP 200, chunk remplacé par `0g-6joqzacvgb.js` | PASS distant le 21/07 |
| restauration candidate applicative | `2e51eaf` → `07fb59a` | checkout prouvé, HTTP 200, chunk `3gzjaewd3cdr_.js` rétabli | PASS distant le 21/07 |
| dialogues | erreur, renommage, suppression, focus, Échap | annonces et focus vérifiés | PASS |
| commandes replay | lecture, vitesse, couche, zoom, mode, timeline | noms, états et activation clavier vérifiés | PASS |
| reflow | largeurs 640 px et 320 px | radar, lecture, timeline et alternative DOM disponibles | PASS automatisé limité |
| focus accueil | premier Tab et activation du lien d'évitement | focus visible, cible `#main-content` reçue | PASS Chrome système, capture datée |
| styles/espacement | CSS désactivée puis espacement RGAA forcé à 320 px | contenu essentiel présent, aucun débordement horizontal | PASS automatisé |

Le smoke d'accessibilité seed IndexedDB avec une fixture synthétique. Séparément, le benchmark production a réellement importé Dust2, Ancient et Cache trois fois chacun dans Chrome puis ouvert et mesuré le replay ; ses résultats sont dans `performance/`. Les raccourcis de zoom du navigateur piloté n'ont produit aucune variation mesurable de `innerWidth`, `devicePixelRatio` ou `visualViewport.scale` : les zooms réels à 200/400 % et les contrastes internes au canvas restent donc non démontrés. Limite résiduelle : lecteur d’écran non testé.

La séquence v0.1.39 est détaillée dans `deployment-runs-2026-07-20.md`. Les deux séquences successives de la candidate v0.1.40, dont le rollback et la restauration de la révision applicative `07fb59a`, sont détaillées dans `deployment-runs-2026-07-21.md`.
