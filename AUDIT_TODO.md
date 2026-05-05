# RoundLab - Audit et reste a faire

Date de l'audit : 2026-05-05

Ce document regroupe les problemes identifies pendant l'audit et les points observes dans l'app. Il est volontairement oriente action : ce qui peut casser, pourquoi, et quoi corriger.

## Resume executif

- Critique : 1 point a verifier
- Haut : 6 points
- Moyen / Faible : 6 points

Risques principaux :

1. Cle privee Tauri presente localement dans le workspace.
2. Fuite de fichiers temporaires du parseur Go a cause de `os.Exit(0)`.
3. Risque OOM / freezes : match complet decompresse en memoire, cache Rust, store JS, prechargement de rounds.
4. Race async : un round d'un ancien match peut etre injecte dans le match courant.
5. Fallback Rust dangereux sur gros `.dem.zst` car il lit et decompresse tout en RAM.

Zones les plus sensibles :

- `desktop/src-tauri/src/lib.rs`
- `parser/main.go`
- `parser-fallback/src/main.rs`
- `desktop/src/app/match/MatchViewer.tsx`
- `desktop/src/components/replay/MapRenderer.tsx`

## Priorite 0 - Securite / release

### 1. Cle privee Tauri presente localement

- Gravite : Critique, a verifier
- Fichier : `.tauri-keys/roundlab.key`
- Description : une cle privee de signature Tauri existe dans le workspace. Elle est ignoree par `.gitignore`, donc elle ne semble pas trackee, mais elle reste presente localement.
- Impact possible : si cette cle fuite et que c'est la vraie cle d'update, quelqu'un peut signer des updates malveillants si le canal de distribution est compromis.
- Preuve : `.tauri-keys/roundlab.key` existe, `.gitignore` ignore `.tauri-keys/`.
- Correction :
  - Sortir la cle du dossier projet.
  - Stocker la cle privee uniquement dans un secret manager / CI.
  - Garder seulement la cle publique dans `tauri.conf.json`.
  - Regenerer la paire de cles si le dossier a deja ete partage ou archive.

### 2. Systeme de mise a jour a faire fonctionner

- Gravite : Haute
- Fichiers : `desktop/src-tauri/tauri.conf.json`, `desktop/src/components/UpdateChecker.tsx`
- Description : l'updater est configure vers GitHub Releases, mais il faut valider toute la chaine : `latest.json`, signature, artefacts, versions, download, installation, relaunch.
- Impact possible : les utilisateurs ne recoivent pas les updates, ou pire, une mauvaise config bloque l'installation.
- Preuve : updater actif dans `tauri.conf.json`, UI presente dans `UpdateChecker.tsx`, mais pas de verification end-to-end realisee pendant l'audit.
- Correction :
  - Creer une release de test avec `latest.json` signe.
  - Tester depuis une version inferieure installee.
  - Verifier les logs Tauri si `check()` retourne une erreur silencieuse.
  - Documenter la procedure exacte de release.

### 3. CSP desactivee et permissions Tauri larges

- Gravite : Moyenne
- Fichiers : `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/capabilities/default.json`
- Description : `csp` est `null`, et les permissions Tauri incluent notamment `shell:allow-open` et `process:default`.
- Impact possible : si une XSS apparait un jour, elle aura plus de latitude dans l'environnement desktop.
- Preuve : config `security.csp = null`.
- Correction :
  - Ajouter une CSP stricte compatible avec les assets locaux.
  - Reduire les permissions aux commandes vraiment utilisees.

## Priorite 1 - Memoire, ressources, freezes

### 4. Fuite de fichiers temporaires du parseur Go

- Gravite : Haute
- Fichier : `parser/main.go`
- Zone : `newRoundSpool()`, `defer roundSpool.Close()`, `os.Exit(0)`
- Description : le parseur cree des fichiers temporaires de rounds, mais `os.Exit(0)` bypass les `defer`, donc le nettoyage ne s'execute pas.
- Impact possible : fuite de donnees locales dans `/tmp` et remplissage disque progressif.
- Preuve : `roundSpool.Close()` est en `defer`, mais `os.Exit(0)` est appele a la fin du parse.
- Correction recommandee :

```go
if roundSpool != nil {
    roundSpool.Close()
}
os.Stderr.Sync()
os.Stdout.Sync()
os.Exit(0)
```

### 5. Gros risque RAM / OOM / freezes

- Gravite : Haute
- Fichiers : `desktop/src-tauri/src/lib.rs`, `desktop/src/app/match/MatchViewer.tsx`, `desktop/src/lib/replay-store.ts`
- Description : Tauri decompresse tout le match en memoire, garde jusqu'a 4 matchs complets en cache, puis le frontend precharge progressivement tous les rounds.
- Impact possible : freezes au lancement d'un match, changement de round lent, RAM qui grimpe, crash sur gros fichiers.
- Preuve :
  - `read_match_file()` fait `gz.read_to_end()`.
  - `MatchCache` garde des `Arc<MatchFile>`.
  - `MatchViewer` lance un warmup de tous les rounds.
- Correction :
  - Stocker les rounds separement au parse.
  - Charger seulement metadata + round courant + voisins directs.
  - Remplacer le cache "4 matchs" par un cache borne en bytes.
  - Ajouter mesures RAM / temps de chargement par etape.

### 6. Fallback Rust lit et decompresse tout en memoire

- Gravite : Haute
- Fichier : `parser-fallback/src/main.rs`
- Zone : `read_demo()`
- Description : le fallback fait `fs::read(path)` puis `zstd::decode_all`.
- Impact possible : gros fichier ou zstd bomb = OOM local.
- Preuve : lecture/decompression full-buffer.
- Correction :
  - Passer en streaming.
  - Ajouter une limite stricte de taille decompressee.
  - Refuser les fichiers trop gros avec une erreur claire.

### 7. Freezes legers dans l'app

- Gravite : Haute
- Observation utilisateur : freezes de temps en temps pendant une game, au lancement d'un match, au changement de round.
- Causes probables :
  - deserialization gzip/json complete cote Rust,
  - transfert de gros payloads Tauri vers JS,
  - injection de gros rounds dans Zustand,
  - creation/destruction Pixi massive par frame,
  - chargement lazy des textures/icons.
- Correction :
  - Profiler avec des timestamps autour de `get_match_metadata`, `get_round`, `setRoundData`, render Pixi.
  - Precharger les textures d'icones au lancement du match.
  - Eviter le warmup de tous les rounds.
  - Virtualiser / limiter les payloads round.

### 8. Backlog de destruction Pixi potentiellement fuyant

- Gravite : Moyenne
- Fichier : `desktop/src/components/replay/MapRenderer.tsx`
- Zone : `deferredDestroyRef`
- Description : chaque frame retire beaucoup d'objets Pixi, mais n'en detruit que 40. Si la creation depasse la destruction, le backlog grossit.
- Impact possible : baisse FPS et RAM qui monte pendant les rounds charges en smokes, mollies, projectiles, tirs.
- Correction :
  - Reutiliser les objets Pixi au lieu de les recreer.
  - Detruire tout le backlog si un seuil est depasse.
  - Mesurer `deferredDestroyRef.current.length` en dev.

### 9. RAM optimisee sur Windows mais bloquee a 95%

- Gravite : Haute
- Observation utilisateur : la RAM semble optimisee sur Windows, mais le parsing reste bloque a 95%.
- Description reformulee : verifier si le blocage vient vraiment de la RAM ou plutot de la phase finale : compression gzip, flush disque, `fsync`, fermeture process, pipe stderr/stdout, ou nettoyage sidecar.
- Preuve probable : le code contient deja des commentaires sur Windows, gzip flush et UI bloquee a 95/99%.
- Correction :
  - Instrumenter les etapes finales : `writeOutput`, `gz.Close`, `of.Sync`, `of.Close`, emission `OK`, terminaison process.
  - Verifier que Tauri recoit bien `CommandEvent::Terminated`.
  - Ajouter un timeout post-95% avec message technique clair.
  - Tester sans `of.Sync()` pour isoler le cout disque.

## Priorite 2 - Bugs fonctionnels / exactitude replay

### 10. Race async entre matchs

- Gravite : Haute
- Fichiers : `desktop/src/app/match/MatchViewer.tsx`, `desktop/src/lib/replay-store.ts`
- Description : `loadRoundData()` charge un round puis appelle `setRoundData(roundNumber, data)` sans verifier que le match courant correspond encore au `id` original.
- Impact possible : un round d'un ancien match peut se retrouver dans un nouveau match si la navigation arrive pendant un chargement lent.
- Correction :
  - Stocker `matchId` dans le store.
  - Passer `matchId` a `setRoundData`.
  - Ignorer les resultats obsoletes.

Exemple :

```ts
setRoundData: (matchId, roundNumber, round) =>
  set((s) => {
    if (!s.match || s.matchId !== matchId) return s;
    return {
      match: {
        ...s.match,
        rounds: s.match.rounds.map((r) =>
          r.number === roundNumber ? round : r
        ),
      },
    };
  });
```

### 11. Parses partiels consideres comme succes

- Gravite : Haute
- Fichier : `parser/main.go`
- Description : si `ParseToEnd()` echoue apres quelques rounds, le parseur conserve les rounds partiels et sort avec code 0.
- Impact possible : l'utilisateur croit analyser un match complet alors que la fin est absente.
- Correction :
  - Ajouter `meta.partial = true`.
  - Ajouter `meta.parseError`.
  - Afficher un warning dans l'UI.
  - Eventuellement sortir non-zero si l'app ne veut pas accepter les parses partiels.

### 12. Manque map Cache

- Gravite : Moyenne
- Observation utilisateur : la map Cache manque ou ne fonctionne pas correctement.
- Fichiers probables : `desktop/src/lib/maps.ts`, `desktop/public/cs2lens-maps/de_cache.png`, `desktop/public/radars/de_cache.png`
- Description reformulee : verifier si `de_cache` est bien declaree dans la calibration et si le nom retourne par le parseur correspond exactement a la cle attendue.
- Impact possible : match refuse avec "Unsupported map" ou radar mal calibre.
- Correction :
  - Verifier les noms possibles : `de_cache`, `de_cache_...`, majuscules, variantes workshop.
  - Ajouter/valider la calibration dans `MAP_CALIBRATION`.
  - Ajouter un fallback clair si l'image existe mais la calibration manque.

### 13. Certains stuffs suppriment l'animation de trajectoire

- Gravite : Moyenne
- Observation utilisateur : certains stuffs font disparaitre l'animation de trajectoire.
- Fichier probable : `desktop/src/components/replay/MapRenderer.tsx`
- Zones probables : `detonatedIds`, `visibleProjectiles`, `projectileHideStart`, `effectSuppressionRadius`, `resolveEffects`
- Description reformulee : la logique qui masque les projectiles apres detonation/effect semble trop agressive ou associe le mauvais projectile au mauvais effet.
- Impact possible : trajectoires incompletes ou invisibles, surtout quand plusieurs stuffs explosent proche dans le temps/espace.
- Correction :
  - Logger `projectile.id`, `effect.type`, distance, tick/time d'association.
  - Tester cas flash double, HE proche, molo/inc, smoke.
  - Remplacer l'association greedy par une association stable par id quand disponible.

### 14. Trajectoire stuff plus lisible quand ca tape un mur/plafond

- Gravite : Moyenne
- Observation utilisateur : les trajectoires sont parfois peu lisibles, notamment rebond mur/plafond.
- Description reformulee : ameliorer le rendu des trajectoires pour distinguer vol, rebond, chute et impact.
- Correction :
  - Ajouter points de rebond quand la direction change brutalement.
  - Utiliser un style different apres impact ou sur segments courts.
  - Tester sur trajectoires connues : wallbang de stuff, plafond, rebond court, lineup long.

### 15. Parser quand une molo est pompier

- Gravite : Moyenne, a verifier
- Observation utilisateur : detecter quand une molotov/incendiary est eteinte par une smoke.
- Description reformulee : enrichir les effects pour marquer une molo "smoked/extinguished".
- Impact possible : replay plus fidele, meilleure lecture des executes/retakes.
- Correction :
  - Cote parser : voir si demoinfocs expose un event d'extinction inferno ou un changement d'etat.
  - Cote renderer : fallback geometrique possible si une smoke active recouvre le centre/rayon du feu.
  - Ajouter `effect.extinguishedAt` ou `effect.suppressedBySmokeAt`.

### 16. Smoke blast : retirer le voile gris quelques secondes

- Gravite : Moyenne
- Observation utilisateur : quand une smoke est blast, enlever le voile gris pendant quelques secondes meme si le timer continue.
- Description reformulee : il faut differencier duree logique de la smoke et visibilite effective apres explosion/blast.
- Correction :
  - Ajouter un etat visuel `visibilitySuppressedUntil`.
  - Garder le timer actif, mais rendre le cercle gris transparent pendant la fenetre de dissipation.
  - Parser l'event si disponible, sinon detection par HE proche dans un rayon donne.

### 17. Ajouter un point a l'endroit ou un joueur meurt

- Gravite : Faible / Moyenne
- Fichiers probables : `parser/main.go`, `parser-fallback/src/main.rs`, `desktop/src/components/replay/MapRenderer.tsx`
- Description : afficher un marqueur de mort sur la position du joueur tue.
- Correction :
  - Ideal : ajouter `x/y/z` dans l'event `kill` cote parser au moment de l'event.
  - Fallback : cote frontend, chercher la position la plus proche du `victim` au temps `event.t`.
  - Rendre un marqueur discret, avec fade ou affichage permanent optionnel.

### 18. Fullscreen au lancement d'un match

- Gravite : Faible
- Observation utilisateur : quand un match se lance, mettre l'app en fullscreen.
- Etat actuel : le code tente deja `invoke("enter_match_fullscreen")` apres chargement du match.
- Fichier : `desktop/src/app/match/MatchViewer.tsx`
- Correction :
  - Verifier si le fullscreen arrive trop tard ou echoue silencieusement.
  - Le declencher plus tot, des que `id` est connu ou avant le chargement metadata.
  - Afficher/logguer l'erreur Tauri si `set_fullscreen(true)` echoue.

## Priorite 3 - Produit / polish

### 19. Ajouter un logo

- Gravite : Faible
- Description : ajouter un logo identifiable dans l'app et les assets packagés.
- Fichiers probables :
  - `desktop/public/app-icon.png`
  - `desktop/src-tauri/icons/*`
  - header dans `desktop/src/app/page.tsx`
- Correction :
  - Definir une source unique du logo.
  - Generer les tailles Tauri.
  - Verifier rendu macOS/Windows.

### 20. Options de parse mortes ou trompeuses

- Gravite : Faible
- Fichiers : `desktop/src/lib/api.ts`, `desktop/src/components/SettingsPanel.tsx`, `desktop/src-tauri/src/lib.rs`
- Description : l'UI parle de settings de parse, mais `loadParseOptions()` retourne toujours les defaults, `saveParseOptions()` ignore `opts`, et Rust a `ParseOptions {}` vide.
- Impact possible : UX mensongere.
- Correction :
  - Soit supprimer les options.
  - Soit brancher vraiment `quality`, `skipProjectiles`, `skipWeaponFires`.

## Priorite 4 - Dependances / qualite

### 21. Vulnerabilite PostCSS via Next

- Gravite : Moyenne
- Fichiers : `desktop/package.json`, `desktop/pnpm-lock.yaml`
- Description : `pnpm audit --prod` remonte `postcss@8.4.31` via `next@16.2.4`, vuln GHSA-qx2v-qp2m-jg93.
- Impact possible : XSS via CSS stringify si CSS controle par attaquant dans un pipeline concerne. Exploitabilite probablement faible ici, mais c'est reel.
- Correction :
  - Mettre a jour Next quand il embarque `postcss >= 8.5.10`.
  - Ou tester un override pnpm compatible.

### 22. `cargo audit` et `govulncheck` absents

- Gravite : Moyenne
- Description : l'audit de vuln Rust/Go n'a pas pu etre fait.
- Commandes :
  - `cargo audit` -> commande absente.
  - `govulncheck ./...` -> commande absente.
- Correction :
  - Installer `cargo-audit`.
  - Installer `govulncheck`.
  - Ajouter ces checks a la CI.

### 23. Clippy echoue en mode strict

- Gravite : Faible
- Fichiers : `desktop/src-tauri/src/lib.rs`, `parser-fallback/src/main.rs`
- Description : `cargo clippy --all-targets -- -D warnings` echoue sur des warnings simples.
- Impact possible : CI stricte impossible, dette qualite.
- Correction :
  - Appliquer les suggestions Clippy.
  - Ajouter Clippy a la CI.

### 24. Peu ou pas de tests utiles sur les parseurs

- Gravite : Moyenne
- Description :
  - `go test ./...` passe mais indique `[no test files]`.
  - `cargo test` fallback passe avec 0 test.
  - Tauri a seulement 2 tests.
- Impact possible : regressions parser/replay non detectees.
- Correction :
  - Ajouter fixtures `.dem` petites.
  - Tester parse normal, parse corrompu, parse partiel, grosses smokes/mollies/projectiles.
  - Tester schema JSON produit.

## Resultats des commandes lancees

- `pnpm lint` : OK
- `pnpm renderer:build` : OK
- `pnpm audit --prod` : echec, 1 vulnerabilite moderee PostCSS
- `go test ./...` : OK, mais aucun test
- `go vet ./...` : OK
- `cargo test` dans `desktop/src-tauri` : OK, 2 tests
- `cargo test` dans `parser-fallback` : OK, 0 test
- `cargo audit` : indisponible
- `govulncheck ./...` : indisponible
- `cargo clippy --all-targets -- -D warnings` : echec sur warnings

## Ordre recommande de traitement

1. Sortir/rotater la cle Tauri si elle est reelle.
2. Corriger la fuite `/tmp` du parseur Go.
3. Corriger la race async entre matchs.
4. Instrumenter les freezes et le blocage Windows a 95%.
5. Revoir la strategie memoire : stockage par round, cache borne, pas de warmup global.
6. Streamer le fallback Rust et limiter la taille decompressee.
7. Rendre visibles les parses partiels.
8. Faire fonctionner l'updater end-to-end.
9. Corriger Cache / calibration map.
10. Debugger trajectoires de stuffs, smoke blast, molo pompier.
11. Ajouter marqueur de mort.
12. Ajouter logo et polish fullscreen.
13. Corriger dependances, Clippy, audit Go/Rust.
14. Ajouter tests parser/replay.
