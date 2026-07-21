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
| dialogues | erreur, renommage, suppression, focus, Échap | annonces et focus vérifiés | PASS |
| commandes replay | lecture, vitesse, couche, zoom, mode, timeline | noms, états et activation clavier vérifiés | PASS |
| reflow | largeurs 640 px et 320 px | radar, lecture, timeline et alternative DOM disponibles | PASS automatisé limité |

Le smoke d'accessibilité seed IndexedDB avec une fixture synthétique. Séparément, le benchmark production a réellement importé Dust2, Ancient et Cache trois fois chacun dans Chrome puis ouvert et mesuré le replay ; ses résultats sont dans `performance/`. VoiceOver a été activé réellement sur l'accueil local, mais l'outil n'a pas pu piloter les raccourcis VO ni observer les annonces. Le parcours VoiceOver, le zoom navigateur manuel à 400 % et les contrastes internes au canvas restent donc non démontrés.

La séquence v0.1.39 est détaillée dans `deployment-runs-2026-07-20.md`. La séquence complète v0.1.40 est détaillée dans `deployment-runs-2026-07-21.md`.
