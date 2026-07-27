# RoundLab

RoundLab est une application web d'analyse de démos Counter-Strike 2. Elle
importe des fichiers GOTV, les analyse localement dans le navigateur et permet
de rejouer chaque round sur un radar 2D interactif.

**Application publique :** [lakav.github.io/RoundLab](https://lakav.github.io/RoundLab/)

> RoundLab est actuellement un lecteur de replay avancé. La prochaine grande
> évolution prévue est la construction d'un véritable rapport de partie avec
> des analyses détaillées pour chaque joueur. Cette roadmap est décrite dans ce
> document, mais elle n'est pas encore implémentée.

## Sommaire

- [Principes du projet](#principes-du-projet)
- [État actuel](#état-actuel)
- [Limites actuelles](#limites-actuelles)
- [Vision produit](#vision-produit)
- [Architecture analytique cible](#architecture-analytique-cible)
- [Domaines d'analyse prévus](#domaines-danalyse-prévus)
- [Faisabilité selon les données](#faisabilité-selon-les-données)
- [Roadmap](#roadmap)
- [Première version analytique recommandée](#première-version-analytique-recommandée)
- [Structure du dépôt](#structure-du-dépôt)
- [Développement et validation](#développement-local)
- [Déploiement](#déploiement)

## Principes du projet

- **Traitement local :** aucune démo n'est envoyée vers un serveur.
- **Résultats explicables :** une statistique doit indiquer comment elle est
  calculée et permettre de retrouver les actions qui la justifient.
- **Replay comme preuve :** les futures analyses devront ouvrir directement le
  replay au round et au timestamp concernés.
- **Fiabilité avant quantité :** aucune note globale ne doit être affichée sans
  données suffisantes, formule documentée et validation sérieuse.
- **Séparation des responsabilités :** le parseur extrait les faits, le moteur
  d'analyse calcule les métriques et l'interface les présente.

## État actuel

RoundLab sait aujourd'hui :

- importer des fichiers `.dem` et `.dem.zst` ;
- parser les démos localement avec le parseur Rust compilé en WebAssembly ;
- conserver les matchs et les rounds dans IndexedDB ;
- rejouer un round sur le radar de la map ;
- afficher les joueurs, leur orientation, leur équipement et leur état ;
- afficher la bombe, les poses, les désamorçages et l'explosion ;
- afficher les tirs, trajectoires et effets des grenades ;
- afficher le killfeed et ses modificateurs ;
- parcourir la timeline, changer la vitesse et passer d'un round à l'autre ;
- dessiner des annotations sur la map ;
- superposer plusieurs rounds d'un même joueur avec le mode condensé ;
- fonctionner comme un site statique déployé sur GitHub Pages.

Le replay interactif constitue la première grande fonctionnalité du produit.
Il doit rester stable pendant la construction de la partie analytique.

## Limites actuelles

RoundLab ne fournit pas encore :

- de rapport statistique complet de la partie ;
- de fiche analytique par joueur ;
- d'ADR calculé ni de rapport de dégâts ;
- d'analyse précise de l'aim, du spray ou du counter-strafe ;
- d'analyse des lignes de vue et du placement du viseur ;
- de score de positionnement ;
- de benchmarks par niveau ;
- de suivi de progression sur plusieurs matchs ;
- de recommandations d'entraînement automatiques.

Le schéma de replay actuel contient déjà les positions, orientations
horizontales, inventaires, économies, kills, dégâts détaillés, hitgroups,
actions de bombe, tirs, impacts et projectiles. Il ne contient pas encore
toutes les données nécessaires aux analyses les plus avancées : pitch, états
de mouvement précis, crouch et visibilité réelle entre les joueurs.

Le format produit par le parseur est versionné
[`roundlab.replay.v2`](docs/replay-schema-v2.md). Les Steam IDs y sont des
chaînes afin de rester exacts dans les navigateurs.

## Vision produit

La cible est une interface d'analyse post-match approfondie, inspirée par les
meilleures plateformes d'analyse CS2, mais centrée sur trois niveaux de lecture :

1. **Résumé :** comprendre rapidement la partie, les forces et les faiblesses.
2. **Détail :** explorer les métriques par équipe, joueur, côté et round.
3. **Preuve :** ouvrir le replay exactement au moment qui explique le résultat.

RoundLab ne doit pas devenir un tableau rempli de scores opaques. Une analyse
doit rester vérifiable, contextualisée et exploitable par un joueur ou un coach.

## Architecture analytique cible

```mermaid
flowchart LR
    A["Démo CS2"] --> B["Parseur Rust enrichi"]
    B --> C["Événements normalisés"]
    C --> D["Moteur d'analyse"]
    D --> E["Métriques vérifiables"]
    D --> F["Erreurs et habitudes"]
    E --> G["Benchmarks et modèles"]
    F --> H["Rapport de partie"]
    G --> H
    H --> I["Replay au bon timestamp"]
```

Le pipeline devra rester versionné : une évolution de formule ou de schéma ne
doit pas modifier silencieusement les anciennes analyses.

## Domaines d'analyse prévus

### Impact et combat

- kills, morts, assists, K/D et KAST ;
- dégâts, ADR et dégâts d'armure ;
- headshots et hitgroups ;
- openings tentés, gagnés et perdus ;
- multikills et séries de kills ;
- impact d'un kill selon l'économie et la situation numérique ;
- conversions et pertes d'avantage ;
- performance CT/T, par arme et par type d'achat ;
- morts évitables et équipement perdu.

### Aim et mécanique

- précision globale et par arme ;
- précision du premier tir ;
- placement du viseur ;
- temps entre la première visibilité et le premier dégât ;
- vitesse au moment du tir ;
- qualité du counter-strafe ;
- taps, bursts et sprays ;
- contrôle et précision des sprays ;
- tirs nécessaires pour obtenir un kill ;
- duels où le joueur tire ou touche en premier ;
- performance spécifique à l'AWP.

### Trading et jeu collectif

- opportunités, tentatives et réussites de trade ;
- temps nécessaire pour effectuer le trade ;
- morts tradeables ou non ;
- spacing entre coéquipiers ;
- joueurs trop isolés ;
- doubles peeks ;
- flash assists et contributions indirectes ;
- comportement collectif en avantage numérique.

### Utilitaires

- grenades utilisées par round ;
- utilitaires conservés à la mort ;
- dégâts par HE et par molotov ;
- ennemis et coéquipiers flashés ;
- durée de blindage ;
- flashs menant à un kill ;
- smokes qui bloquent réellement une attaque ;
- utilitaires trop tardifs, redondants ou sans impact ;
- timings et régularité des lineups ;
- séparation entre quantité utilisée et qualité obtenue.

### Positionnement et décisions

- zones occupées et routes utilisées ;
- timings d'arrivée ;
- exposition à plusieurs angles ;
- distance avec les coéquipiers ;
- rotations précoces ou tardives ;
- positions tradeables ;
- comportement en avantage et désavantage ;
- qualité des post-plants, retakes et sauvegardes ;
- zones où le joueur gagne ou perd ses duels ;
- répétition de positions ou de routes prévisibles ;
- heatmaps séparées pour les côtés T et CT.

### Économie

- valeur de l'équipement au début du round ;
- achats désynchronisés de l'équipe ;
- utilitaires oubliés ;
- pertes économiques ;
- armes sauvegardées ;
- performance contre éco, force-buy et full-buy ;
- impact d'une mort sur le round suivant.

### Clutches et situations décisives

- opportunités de clutch ;
- résultats en 1v1, 1v2, 1v3 et plus ;
- post-plants et retakes ;
- contexte de temps, bombe et information ;
- probabilité de victoire avant et après les événements importants.

### Progression sur plusieurs parties

- tendances sur les derniers matchs ;
- évolution par map, côté, arme et rôle ;
- erreurs récurrentes ;
- zones faibles ;
- habitudes d'utilitaires ;
- comparaison du joueur avec ses propres performances passées ;
- objectifs d'entraînement mesurables.

## Faisabilité selon les données

| Niveau | Analyses concernées |
| --- | --- |
| Déjà largement calculables | K/D, headshots, ADR, dégâts par arme et utilitaire, hitgroups, openings, multikills, survie, situations de clutch, trades temporels, économie approximative, grenades lancées, routes et rotations simples |
| Parseur à enrichir | Impacts de balles, spray accuracy, crouch, vitesse exacte, pitch et événements de flash détaillés |
| Géométrie des maps nécessaire | Visibilité réelle, placement du viseur, temps de réaction, angles exposés, contrôle des zones et positionnement avancé |
| Corpus de parties nécessaire | Percentiles, benchmarks par niveau, probabilité de victoire, scores globaux et comparaisons fiables |

Un score `78/100` calculé sans corpus ni benchmark serait trompeur. Les premières
versions du rapport devront donc afficher des faits et des métriques brutes
avant de chercher à produire une note RoundLab.

## Roadmap

Cette roadmap décrit l'ordre prévu. Elle ne constitue pas un engagement de
date et ne signifie pas que les étapes sont déjà en développement.

### Étape 0 — Spécification des métriques

- [x] définir le public principal : joueur individuel, équipe ou coach ;
- [x] créer un dictionnaire des métriques ;
- [x] documenter chaque formule ;
- [x] lister les données nécessaires et les cas exclus ;
- [x] distinguer faits, heuristiques, benchmarks et modèles ;
- [x] définir le lien entre une métrique et ses preuves dans le replay.

**Critère de sortie :** une même entrée produit le même résultat pour toute
implémentation respectant la spécification.

La spécification initiale est disponible dans
[`docs/analytics-metrics-v1.md`](docs/analytics-metrics-v1.md). Elle fixe le
public principal, les formules V1, les exclusions, les données requises et le
format des preuves. Ses formules implémentées sont verrouillées par les tests
déterministes du moteur ; les autres restent non validées.

### Étape 1 — Stabilisation de l'architecture

- [x] découper progressivement le renderer principal ;
- [x] séparer joueurs, projectiles, effets, bombe et cycle Pixi :
  - [x] extraire la bombe :
    - [x] isoler sa reconstruction et sa chronologie ;
    - [x] isoler son rendu Pixi ;
  - [x] extraire le rendu et l'état des joueurs :
    - [x] isoler les règles de présentation et la création/destruction des sprites ;
    - [x] isoler leur mise à jour à chaque frame ;
    - [x] isoler l'échantillonnage, les tirs et le rendu du mode habitudes ;
  - [x] extraire les projectiles :
    - [x] isoler l'échantillonnage, les trajectoires et les hauteurs ;
    - [x] isoler les associations avec les effets et le rendu principal ;
    - [x] isoler les diagnostics et le rendu du mode habitudes ;
  - [x] extraire les effets :
    - [x] isoler la résolution des variantes, durées et interactions ;
    - [x] isoler les rendus principal et habitudes ;
  - [x] isoler le cycle de vie Pixi :
    - [x] isoler l'initialisation, les couches, le redimensionnement et la destruction ;
    - [x] isoler la file de nettoyage et la boucle d'animation ;
- [x] isoler les calculs d'analyse hors des composants React ;
- [x] versionner le format des matchs et des analyses ;
- [x] prévoir les migrations IndexedDB.

**Critère de sortie :** ajouter une métrique ne nécessite aucune modification du
moteur d'affichage du replay.

### Étape 2 — Enrichissement du parseur

- [x] ajouter les événements complets de dégâts ;
- [x] conserver dégâts de vie, dégâts d'armure, arme et hitgroup ;
- [x] extraire les impacts de balles ;
- [x] ajouter pitch, vitesse et états de mouvement ;
- [x] améliorer les informations de flash ;
- [x] conserver les achats (la valeur d'équipement est déjà extraite).

**Critère de sortie :** les statistiques de combat et d'utilitaires peuvent être
recalculées sans déductions fragiles depuis les seules variations de HP.

Une première tranche est implémentée : chaque round conserve désormais les
événements `player_hurt` avec attaquant et arme lorsqu'ils sont fournis,
victime, dégâts de vie et d'armure, état restant, hitgroup, tick et timestamp.
Les événements `bullet_impact` conservent également le tireur, le tick, l'ordre
d'origine et leurs coordonnées XYZ exactes dans `rounds[].bulletImpacts`.
Chaque position joueur peut désormais conserver le pitch, la vitesse et ses
composantes XYZ, ainsi que les états en l'air, en marche et d'accroupissement.
Ces propriétés restent optionnelles lorsqu'elles sont absentes de la démo.
Les événements `player_blind` sont maintenant conservés avec lanceur, victime,
durée, tick, ordre et timestamp ; ils alimentent aussi directement l'état de
flash affiché dans les frames.
Les achats effectués pendant le freeze time sont conservés avec joueur, objet,
coût, slot d'inventaire et statut de remboursement lorsqu'il est disponible.
Les frames conservent également la valeur d'équipement courante et incluent
désormais le tick exact de fin du freeze time. L'implémentation prévue pour
cette étape est complète. La validation terrain sur des démos réelles est
confiée au beta testing et ne bloque plus cette feuille de route.

### Étape 3 — Moteur d'analyse V1

- [x] produire un `MatchAnalysis` indépendant de l'interface ;
- [x] calculer les statistiques par match, joueur et round ;
- [x] calculer les agrégats par équipe logique ;
- [x] détecter openings, multikills, clutches et trades ;
- [x] calculer survie, économie et utilisation des grenades ;
- [x] conserver les rounds, ticks, séquences et timestamps servant de preuves ;
- [x] ajouter des tests déterministes pour chaque formule implémentée ;
- [x] produire la liste chronologique des moments importants.

**Critère de sortie :** un rapport JSON stable peut être produit sans lancer
l'interface.

Une première tranche du moteur pur est implémentée dans
[`desktop/src/lib/analysis`](desktop/src/lib/analysis). Elle produit un
`MatchAnalysis` versionné avec K/D/A, headshot rate, dégâts de vie, ADR,
openings, multikills, survie, clutches, trades, KAST, lancers de grenades,
flash assists, agrégats CT/T, raisons d'indisponibilité et preuves reliées au
round, tick, séquence et timestamp.
Les agrégats d'équipe A/B conservent maintenant l'identité des effectifs à
travers les changements de côté grâce aux variations du score par round. Ils
incluent les victoires, le taux de victoire, les participations joueur-round et
les métriques de combat agrégées. Si cette identité ne peut pas être établie
sans ambiguïté, le résultat reste explicitement indisponible plutôt que
partiel.
Les tentatives de trade restent explicitement indisponibles si le flux de
dégâts manque, sans masquer les trade kills et morts tradées encore
calculables. Le moteur compte aussi les utilitaires conservés à chaque mort à
partir du dernier inventaire antérieur, en excluant les grenades déjà lancées.
Il classe chaque économie de camp au freeze time selon les seuils V1 documentés.
Les mêmes métriques joueur sont recalculées séparément pour les rounds eco,
force-buy et full-buy, avec leurs preuves et le nombre de rounds inclassables.
Les openings, multikills, trades, clutches gagnés et actions de bombe sont
également fusionnés dans une chronologie stable de moments importants.

### Étape 4 — Rapport de partie V1

Créer une nouvelle interface organisée autour de :

- [x] Vue d'ensemble ;
- [x] Joueurs ;
- [x] Rounds ;
- [x] Aim ;
- [x] Utilitaires ;
- [x] Trading ;
- [x] Positionnement ;
- [x] Économie ;
- [x] Replay.

Chaque fiche joueur devra proposer :

1. [x] un résumé avec les métriques importantes ;
2. [x] un détail avec tableaux et graphiques ;
3. [x] les actions justificatives ouvrables dans le replay.

**Critère de sortie :** un utilisateur comprend la performance d'un joueur sans
être confronté à un mur de statistiques.

Une première tranche du rapport est disponible directement depuis le replay.
Elle charge l'analyse complète uniquement à l'ouverture, présente le score et
les agrégats A/B, classe les joueurs, puis affiche une fiche joueur avec résumé,
détail, profil graphique, performance T/CT et preuves. Chaque preuve ouvre le
round concerné trois secondes avant l'action.
La section Rounds permet aussi de parcourir toute la partie, y compris les
prolongations, avec score, gagnant logique, côté gagnant, économie, statistiques
des joueurs et moments importants de chaque round. Ces moments ouvrent eux
aussi directement le replay.
La section Économie synthétise la répartition des side-rounds eco, force-buy et
full-buy, compare les performances de chaque joueur par catégorie et détaille
les valeurs d'équipement T/CT de chaque round. Lorsqu'une preuve économique est
disponible, elle ouvre le replay au snapshot exact de fin du freeze time.
La section Trading présente séparément les tentatives de réponse, trade kills et
morts tradées, sans fabriquer de score composite. Le bilan par joueur conserve
KAST comme contexte et chaque trade kill ou mort initiale tradée peut être
ouverte dans le replay.
La section Utilitaires détaille les lancers par type, les flash assists et les
grenades encore détenues à la mort, avec les actions sources rejouables. Elle ne
prétend pas mesurer l'impact spatial, qui appartient à l'étape 6.
La section Aim regroupe uniquement les résultats de combat déjà défendables :
kills, headshots, ADR, openings et multikills, avec leurs preuves. Les mesures
de placement du viseur, spray et counter-strafe restent explicitement réservées
au moteur mécanique de l'étape 5.
La section Positionnement sert de passerelle vers la vue condensée par joueur :
elle superpose les trajectoires, morts et utilitaires réellement enregistrés.
Elle distingue explicitement ces faits disponibles des zones tactiques, lignes
de vue, espacements et rotations qui nécessitent encore le moteur spatial de
l'étape 6. L'interface prévue pour cette étape est désormais complète.

### Étape 5 — Analyse mécanique avancée

- [x] construire la détection des engagements ;
- [x] déterminer la première visibilité entre deux joueurs ;
- [x] associer tirs, impacts et dégâts ;
- [x] mesurer le placement du viseur ;
- [x] mesurer mouvement et counter-strafe ;
- [x] identifier taps, bursts et sprays ;
- [x] analyser chaque duel avec son contexte.

**Critère de sortie :** chaque mesure d'aim peut être vérifiée sur une action
rejouable.

Le moteur mécanique possède sa propre spécification versionnée dans
[`docs/mechanics-analysis-v1.md`](docs/mechanics-analysis-v1.md), car ces
formules étaient explicitement hors périmètre de `roundlab.metrics.v1`.
La première brique regroupe maintenant, de manière déterministe, les dégâts et
kills adverses d'une même paire dans une fenêtre maximale de cinq secondes. Elle
conserve initiateur, participants, dégâts par joueur, kill terminal et preuves
chronologiques. Un engagement limité à un kill reste disponible mais signale
explicitement l'absence du flux de dégâts.
Le moteur relie aussi chaque impact et dégât balistique au tir antérieur le plus
récent du même joueur dans une fenêtre maximale de deux ticks. L'arme du dégât
doit correspondre au tir. Les associations indécidables restent explicitement
ambiguës au lieu d'être devinées, et les flux manquants conservent une raison
d'indisponibilité.
Les tirs sont ensuite regroupés par joueur et par arme tant que l'intervalle
entre deux tirs ne dépasse pas 250 ms. La convention V1 classe une séquence
d'un tir en tap, de deux à quatre tirs en burst, et d'au moins cinq tirs en
spray. Cette convention et sa limite sont documentées et testées explicitement.
Pour chaque tir, le moteur mesure aussi la vitesse horizontale issue de la
frame récente. Il distingue tir arrêté et tir en mouvement, puis signale les
arrêts rapides compatibles avec un counter-strafe. Il ne prétend pas connaître
la touche pressée lorsque la démo ne contient pas les commandes d'entrée.
Le moteur de première visibilité accepte maintenant un maillage triangulaire
3D versionné, vérifie son association à la bonne map et détecte les obstacles
entre les joueurs. Son comportement est validé sur des géométries synthétiques.
Aucun maillage réel des maps CS2 n'est encore présent dans le dépôt, donc les
parties réelles signalent `missing_map_geometry`. L'implémentation est
considérée terminée ; la validation sur les assets réels est reportée au
bêta-test et ne bloque plus la roadmap.
À partir de cette première frame visible, le moteur calcule aussi pour les deux
joueurs l'écart horizontal et vertical entre le viseur et l'adversaire. Le yaw
reste disponible si le pitch manque, mais aucun score total n'est alors
fabriqué. Le branchement aux maillages réels sera vérifié pendant le bêta-test.
Chaque engagement est enfin assemblé en duel contextualisé avec participants,
initiateur, visibilité, délai avant le premier combat, tirs, séquences,
mouvement, placement, dégâts, issue et preuves. Le duel reste disponible lorsque
certains flux manquent, avec des raisons d'indisponibilité explicites.

### Étape 6 — Utilitaires et positionnement avancés

- [x] découper les maps en zones tactiques ;
- [x] intégrer la géométrie et les lignes de vue ;
- [x] analyser les prises de zone et rotations ;
- [x] mesurer spacing et tradeability ;
- [x] évaluer l'impact réel des smokes et molotovs ;
- [x] comparer les trajectoires entre rounds similaires ;
- [x] détecter les habitudes répétitives.

**Critère de sortie :** les analyses dépassent les simples comptes d'événements
et prennent en compte le contexte spatial.

Une chaîne d'import glTF/GLB est désormais disponible et documentée dans
[`docs/map-geometry-import.md`](docs/map-geometry-import.md). Elle applique les
transformations de scène, convertit le repère glTF vers Source, valide les
buffers et produit un JSON chargé par nom de map. Les lignes de vue utilisent
un BVH mis en cache afin d'éviter un parcours complet des triangles à chaque
frame. Aucun asset Valve n'est distribué ; l'import d'un maillage réel et sa
vérification sur une partie sont reportés au bêta-test.
Le moteur spatial versionné décrit également des zones tactiques par polygone,
intervalle d'altitude et priorité, puis compresse les frames en visites de zones
par joueur. Les chevauchements indécidables restent ambigus. La spécification
est disponible dans
[`docs/spatial-analysis-v1.md`](docs/spatial-analysis-v1.md). Des découpages
grossiers sont fournis pour les dix maps calibrées : Ancient, Anubis, Cache,
Dust2, Inferno, Mirage, Nuke, Overpass, Train et Vertigo. Leurs audits réels
couvrent 10 078 864 positions vivantes avec 100 % d'assignation, aucune
ambiguïté et aucune zone vide. Nuke, Train et Vertigo utilisent leurs altitudes
pour distinguer les étages superposés.
À partir de ces visites, le moteur produit les transitions directes, les états
de contrôle vide/T/CT/contesté, les prises après contrôle adverse et les
rotations d'au moins deux joueurs vers une même zone en trois secondes maximum.
Les passages séparés par une position inconnue ne sont jamais raccordés. Les
cas réels seront calibrés pendant le bêta-test.
Le spacing agrège maintenant les distances 3D et horizontales de chaque paire
de coéquipiers vivants. Pour chaque kill, la tradeability spatiale conserve les
coéquipiers disponibles, leurs distances, leur flash et leur ligne de vue
statique vers le killer. Une ligne bloquée et une géométrie absente restent deux
résultats distincts ; aucun score arbitraire n'est fabriqué.
Les smokes et feux utilisent désormais les mêmes rayons que le replay. Le
moteur compte les joueurs exposés, les lignes adverses coupées par une smoke
alors qu'elles étaient statiquement ouvertes, les dégâts de feu réellement
enregistrés et les chevauchements smoke/feu. Une association de dégâts entre
deux feux équidistants reste explicitement ambiguë.
Les trajectoires d'un même joueur sont aussi comparées entre rounds du même camp
lorsque leurs départs se trouvent à 256 unités ou moins. Elles sont
rééchantillonnées sur 20 points de progression, puis comparées par distance 3D
moyenne, médiane et maximale.
Une habitude de trajectoire exige au moins trois rounds tous similaires deux à
deux : chaque paire doit rester à 128 unités ou moins en moyenne et à 256
unités ou moins au pire point. Un simple chaînage de rounds dont les extrêmes
divergent n'est pas présenté comme une habitude.

### Étape 7 — Benchmarks et scores

- [ ] constituer un corpus de parties suffisamment large ;
- [x] séparer les distributions par niveau, map et côté ;
- [x] calculer médianes, percentiles et intervalles de confiance ;
- [x] construire un modèle de probabilité de victoire ;
- [x] versionner et documenter les modèles ;
- [x] expliquer pourquoi un joueur gagne ou perd des points.

**Critère de sortie :** les scores sont statistiquement défendables et restent
compréhensibles pour l'utilisateur.

Le format de corpus versionné et ses règles sont décrits dans
[`docs/benchmark-corpus-v1.md`](docs/benchmark-corpus-v1.md). Il produit un
échantillon par joueur et par camp, rejette les matchs dupliqués, exige une map
et un niveau explicites, puis sépare douze distributions normalisées par map,
niveau et côté. Les valeurs indisponibles sont exclues et comptées, jamais
remplacées par zéro.
La collecte reproductible est décrite dans
[`docs/benchmark-collection-v1.md`](docs/benchmark-collection-v1.md). Deux
commandes transforment un replay parsé en analyse métrique, puis un manifeste
étiqueté en bundle de corpus. Chaque match conserve sa provenance et la base
autorisant son utilisation ; doublons, chemins sortant du manifeste, provenance
absente et versions d'analyse incompatibles sont refusés.
Les bêta-testeurs peuvent aussi utiliser l'action `Benchmark export` sur une
partie moderne. Ils choisissent leur joueur, leur niveau et la date, puis
consentent explicitement à créer un fichier local. L'export ne conserve que
leurs métriques agrégées sous un identifiant aléatoire ; tous les Steam IDs,
noms et autres joueurs sont supprimés. La commande `benchmark:collect` agrège
ensuite ces contributions et réapplique les seuils de disponibilité.
L'audit des données locales trouve 17 parties uniques et 602 rounds, mais
uniquement sur Inferno, sans niveau ni schéma moderne déclaré. Ce n'est pas un
corpus de benchmark suffisant : la première case reste donc volontairement
ouverte.
Une porte de disponibilité automatique empêche maintenant de déclarer ce
corpus prêt. Chaque strate requise map/niveau/camp doit atteindre simultanément
20 matchs, 50 joueurs, 100 échantillons joueur/camp, 1 000 player-rounds et
30 résultats de round. Les strates totalement absentes sont matérialisées et
signalées, pas ignorées.
Chaque distribution expose désormais médiane, P10, P25, P75 et P90. Leurs
intervalles de confiance à 95 % utilisent une borne DKW non paramétrique. Sous
20 valeurs valides, la statistique descriptive reste visible mais l'intervalle
est explicitement indisponible.
Le premier modèle de victoire versionné est un baseline Wilson par map, niveau
et côté. Il estime une probabilité de victoire de round avec son intervalle à
95 % et refuse de produire un résultat sous 30 rounds. Il n'utilise aucune
statistique calculée après le début du round, afin d'éviter une fuite de la
réponse à prédire.
L'indice benchmark V1 compare six métriques à des distributions contenant au
moins 100 valeurs chacune. Chaque contribution expose la valeur, le percentile,
le sens de la métrique et les points gagnés ou perdus autour d'une base de 50.
Si une métrique ou une distribution manque, aucun score global n'est fabriqué.

### Étape 8 — Historique et recommandations

- [x] agréger plusieurs parties d'un même joueur ;
- [x] détecter tendances et régressions ;
- [x] identifier les erreurs récurrentes ;
- [x] générer des objectifs mesurables ;
- [x] résumer les constats déjà calculés sans IA en V1.

L'IA n'est volontairement pas intégrée en V1 : l'application locale ne possède
pas de backend sûr pour protéger une clé ni de consentement prévu pour envoyer
les données joueur à un service externe. Le résumé reste donc déterministe et
ne peut reformuler que les preuves et métriques déjà produites par le moteur.

L'historique joueur versionné est décrit dans
[`docs/player-history-v1.md`](docs/player-history-v1.md). Il ordonne les parties
avec un `playedAt` validé, conserve leurs échantillons sources et recalcule les
ratios depuis les totaux. Il produit des agrégats globaux, par map et par côté ;
une donnée source absente ne devient jamais zéro.
Les tendances V1 utilisent ensuite un test de Mann–Kendall par map et côté sur
au moins huit observations. Une amélioration ou régression exige une p-value
bilatérale inférieure ou égale à 0,05 ; les séries trop courtes ou non
significatives ne sont pas surinterprétées.
Une faiblesse récurrente exige au moins trois occurrences sous le 25e
percentile orienté dans les cinq dernières parties comparables de la même map
et du même côté. Les matchs concernés sont conservés comme preuves ; un
benchmark insuffisant rend la série indisponible au lieu de créer une erreur.
Chaque faiblesse disponible devient un objectif chiffré vers la médiane de son
benchmark. La réussite exige d'atteindre la cible dans au moins trois des cinq
prochaines parties comparables ; la valeur initiale, le comparateur et les
matchs ayant déclenché l'objectif restent attachés au résultat.
Le résumé joueur V1 assemble enfin les tendances significatives, faiblesses
récurrentes et objectifs en phrases françaises. Chaque phrase conserve
l'identifiant du calcul source et les matchs preuves. Les tendances stables ou
indisponibles ne sont pas transformées en constats.

## Première version analytique recommandée

La première version utile du rapport devrait rester limitée à environ quinze
métriques fiables :

- K/D/A ;
- headshot rate ;
- ADR ;
- KAST ;
- openings gagnés et perdus ;
- multikills ;
- clutches ;
- trades réussis ;
- morts tradées ;
- survie ;
- grenades utilisées ;
- flash assists ;
- utilitaires conservés à la mort ;
- performance CT/T ;
- moments importants reliés au replay.

Cette base doit être validée avant l'ajout d'un score global ou d'analyses de
positionnement complexes.

## Ce que le projet doit éviter

- copier les formules, le nom ou l'identité visuelle d'une autre plateforme ;
- inventer immédiatement un score RoundLab ;
- mélanger les calculs d'analyse avec React ou Pixi ;
- afficher une recommandation sans preuve ;
- utiliser une IA comme source de vérité ;
- commencer par le positionnement avancé avant de fiabiliser les dégâts ;
- comparer un joueur à des professionnels sans benchmark adapté ;
- casser le replay existant pendant la transformation.

## Structure du dépôt

```text
desktop/         Application web Next.js, interface et moteur de replay
parser/          Parseur Rust et point d'entrée WebAssembly
vendor/          Dépendances du parseur conservées dans le dépôt
ressources/      Ressources graphiques sources
scripts/         Audits, validations et outils de développement
docs/            Notes techniques et données de référence
```

Le parseur Rust est le seul parseur produit. L'ancien travail de comparaison
avec le parseur Go est conservé uniquement comme documentation historique dans
[`docs/parser-go-rust-comparison.md`](docs/parser-go-rust-comparison.md).

## Développement local

Prérequis :

- Node.js 24 ;
- pnpm 11 ;
- Rust stable ;
- la cible `wasm32-unknown-unknown` ;
- `wasm-bindgen-cli` pour reconstruire le parseur navigateur.

```bash
cd desktop
pnpm install
pnpm dev
```

L'application est ensuite disponible sur `http://localhost:3000`.

Après une modification du parseur Rust :

```bash
cd desktop
pnpm parser:wasm
```

## Validation

Vérifications principales de l'interface :

```bash
cd desktop
pnpm lint
pnpm exec tsc --noEmit
pnpm test:coverage
pnpm build
pnpm test:e2e
```

Vérifications principales du parseur :

```bash
cd parser
cargo test
cargo check --target wasm32-unknown-unknown --lib
```

La suite locale complète peut être lancée avec :

```bash
python3 scripts/run-local-ci-checks.py
```

Les démos réelles restent hors du dépôt. Elles peuvent être utilisées par les
tests d'intégrité et de performance grâce aux variables
`ROUNDLAB_TEST_DEMOS` et `ROUNDLAB_BENCHMARK_DEMOS`.

Les références et invariants du parseur sont décrits dans
[`docs/parser-rust-only.md`](docs/parser-rust-only.md) et
[`parser/reference_demos.json`](parser/reference_demos.json).

## Navigateurs

Le parseur local nécessite Web Workers, WebAssembly, IndexedDB, la File API et
`crypto.randomUUID`.

- Chrome : validé avec de vraies démos et des fichiers volumineux ;
- Safari : pas encore validé ;
- Firefox : pas encore validé ;
- Edge : pas encore validé.

La compatibilité multi-navigateur fait partie du travail de stabilisation à
effectuer avant de considérer RoundLab comme un produit finalisé.

## Déploiement

La branche `main` est validée par la CI GitHub. Après réussite des contrôles, le
workflow GitHub Pages construit et publie automatiquement l'application sur
[lakav.github.io/RoundLab](https://lakav.github.io/RoundLab/).

## Prochaine action quand la roadmap reprendra

La spécification versionnée initiale des métriques est rédigée, les événements
complets de dégâts sont extraits, le replay V2 conserve les Steam IDs sans perte
et le `MatchAnalysis` déterministe calcule maintenant K/D/A, headshots, ADR,
openings, multikills, survie, clutches, trades, KAST, lancers de grenades et
flash assists, avec les mêmes calculs séparés entre CT et T. Les utilitaires
conservés à la mort sont également calculés lorsque l'inventaire antérieur est
disponible. Les rounds sont maintenant classés en eco, force-buy ou full-buy
depuis la valeur d'équipement exacte au freeze time, et les performances sont
agrégées dans chacune de ces catégories. Les moments importants sont maintenant
produits dans l'ordre exact du replay. La prochaine tranche du moteur V1 est
d'ajouter les agrégats équipe et les fiches par round. Les résultats devront
ensuite être validés sur toutes les démos de référence avant de construire
l'interface du rapport.
