# Smoke tests navigateur

Date : 20 juillet 2026. Navigateur : Chrome système piloté par Playwright.

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

Le test seed IndexedDB avec une fixture synthétique ; il ne prétend pas parser une démo réelle dans le navigateur. La vraie démo Dust2 est validée séparément par le parser Rust et les captures d'import/replay. VoiceOver et le zoom 400 % restent non démontrés.
