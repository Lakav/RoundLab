# Spécification mécanique RoundLab — V1

**Identifiant :** `roundlab.mechanics.v1`  
**Statut :** en cours d'implémentation  
**Dépendance :** faits normalisés `roundlab.replay.v2`

Cette spécification est séparée de `roundlab.metrics.v1`. Elle couvre les
mesures mécaniques avancées sans modifier rétroactivement les formules du
rapport statistique V1.

## 1. Règles communes

- Une donnée absente produit une raison d'indisponibilité ; elle n'est jamais
  reconstruite depuis une variation de frame.
- L'ordre canonique utilise le tick serveur, puis la séquence d'origine. Le
  timestamp et l'index source ne servent que de départage déterministe lorsque
  la séquence manque.
- Chaque résultat conserve des identifiants de preuves ouvrables dans le replay.
- Les Steam IDs restent des chaînes.
- Un événement entre coéquipiers, un suicide, un kill monde ou un événement
  sans contexte d'équipe fiable est exclu.

## 2. Engagements V1

### 2.1 Définition

Un engagement est une succession de dégâts de vie ou de kills adverses entre
la même paire de joueurs dans un même round.

Le premier événement valide fixe :

- les deux participants ;
- l'initiateur ;
- le tick et le timestamp de début.

Un événement suivant appartient au même engagement si :

- il concerne exactement la même paire, quel que soit l'attaquant ;
- il survient au plus cinq secondes après le précédent événement de la paire ;
- aucun kill de cette paire n'a déjà terminé l'engagement.

Une inactivité strictement supérieure à cinq secondes ouvre un nouvel
engagement. Un kill termine immédiatement l'engagement.

### 2.2 Résultat

Chaque engagement conserve :

- un identifiant stable ;
- le round, les participants et l'initiateur ;
- le début et la fin en tick et timestamp ;
- les dégâts de vie cumulés par participant ;
- le killer et la victime lorsqu'un kill termine l'échange ;
- la liste chronologique de toutes les preuves.

Si le flux de dégâts manque mais qu'un kill adverse valide existe, un
engagement limité au kill est conservé avec
`missing_damage_events`. Il ne doit pas être présenté comme un échange complet.

### 2.3 Ce que cette définition ne prétend pas mesurer

Un engagement basé sur les événements de combat ne détermine pas encore :

- le premier instant où les joueurs pouvaient se voir ;
- le premier instant où leur viseur croisait une cible ;
- les tirs manqués dirigés vers un adversaire précis ;
- le temps de réaction ;
- la qualité du placement ou du mouvement.

La première visibilité exige une géométrie de map et un test de ligne de vue
fiables. Elle n'est pas approximée par la seule distance ou par l'angle du
joueur. Le moteur de calcul existe désormais. Sa validation sur les maillages
réels des maps est reportée au bêta-test et n'est plus un critère de blocage de
la roadmap.

## 3. Première visibilité V1

Le moteur accepte un maillage triangulaire 3D identifié et rattaché à une map
précise. Une géométrie absente, invalide ou portant un autre nom de map produit
respectivement `missing_map_geometry`, `invalid_map_geometry` ou
`map_geometry_mismatch`.

Pour chaque engagement, les frames sont parcourues chronologiquement jusqu'au
premier événement de combat. Les deux participants doivent être vivants,
présents et adversaires. Leur hauteur d'œil interpole entre 64 unités debout et
46 unités accroupi. La première frame dont le segment œil-à-œil ne traverse
aucun triangle devient la première visibilité et produit une preuve rejouable.

Le test segment-triangle est tridimensionnel et ignore les contacts limités aux
deux extrémités. Cette V1 ne traite pour l'instant que la géométrie statique :
elle ne modélise pas encore les smokes, portes ou autres obstacles dynamiques,
et ne teste pas plusieurs points du corps. Les maillages synthétiques servent
uniquement à valider le moteur ; ils ne rendent pas une map réelle disponible.

## 4. Placement du viseur V1

À la première frame visible, le moteur calcule pour chacun des deux joueurs la
direction œil-à-œil vers l'adversaire. L'erreur horizontale est la plus courte
distance angulaire entre le yaw du joueur et le yaw cible. L'erreur verticale
compare le pitch du joueur au pitch cible selon la convention Source. L'erreur
totale est la norme des deux écarts.

Le yaw reste mesurable si le pitch manque, mais l'erreur verticale et le total
restent alors indisponibles avec `missing_pitch`. Une visibilité indisponible
propage sa raison au placement au lieu de produire un angle depuis une frame
arbitraire.

Cette mesure décrit le décalage angulaire au premier échantillon visible. Sa
précision temporelle est limitée par la fréquence des frames et sa précision
spatiale par le modèle œil-à-œil de la V1.

## 5. Association tirs, impacts et dégâts V1

### 5.1 Événements éligibles

Un tir ouvre une chaîne uniquement si son tireur et son arme balistique sont
connus. Les armes de mêlée, les utilitaires, la bombe et les dégâts du monde
sont exclus.

Un impact est associé à un tir du même joueur. Un dégât est associé à un tir du
même attaquant et de la même arme normalisée. Les dégâts d'équipe, suicides et
dégâts non balistiques sont exclus.

### 5.2 Fenêtre et ordre

L'association cherche uniquement un tir antérieur situé au plus deux ticks
avant l'impact ou le dégât, bornes incluses. Le tir valide le plus récent dans
l'ordre canonique est retenu. Plusieurs impacts et plusieurs dégâts peuvent
appartenir au même tir.

Lorsque plusieurs tirs candidats sont impossibles à départager avec les données
disponibles, l'événement reste non associé avec `ambiguous_fire`. Le moteur ne
choisit jamais arbitrairement un tir. Un événement sans candidat conserve
`no_matching_fire`; un tireur ou une arme manquante produit respectivement
`missing_shooter` ou `missing_weapon`.

Cette association ne désigne pas une cible pour un impact manqué et ne prétend
pas reconstruire une trajectoire complète. L'absence du flux de tirs, d'impacts
ou de dégâts reste visible via les raisons d'indisponibilité du round.

### 5.3 Résultat

Chaque chaîne conserve :

- le tir source, son joueur, son arme, sa position et son orientation ;
- l'état approximatif « au moins un ennemi repéré » lorsqu'il est exposé par
  le masque `approximate_spotted_by` de la démo ;
- les impacts associés avec leurs coordonnées ;
- les dégâts associés avec victime, dégâts de vie et d'armure, et hitgroup ;
- les identifiants de preuves ouvrables dans le replay ;
- les éventuelles raisons d'indisponibilité.

### 5.4 Précision sur ennemi repéré

Le parseur échantillonne explicitement chaque tick de `weapon_fire`. À cet
instant, un tir est marqué comme effectué sur un ennemi repéré si au moins un
adversaire vivant indique le Steam ID du tireur dans son masque
`approximate_spotted_by`.

La précision correspond au nombre de ces tirs ayant au moins un dégât associé,
divisé par le nombre total de tirs effectués pendant qu'un ennemi est repéré.
Elle reste indisponible si le masque manque sur une partie des tirs, si aucun
tir éligible n'existe ou si l'association tir-dégât n'est pas fiable.

Cette mesure est explicitement approximative : elle dépend d'un état réseau de
la démo que le parseur amont lui-même qualifie d'`approximate`. Elle n'est pas
présentée comme identique au calcul géométrique ou propriétaire de Leetify.

## 6. Taps, bursts et sprays V1

### 6.1 Définition opérationnelle

Les tirs balistiques déjà normalisés sont regroupés par joueur, dans leur ordre
canonique. Un tir continue la séquence courante si :

- l'arme normalisée n'a pas changé ;
- l'intervalle avec le tir précédent est inférieur ou égal à 250 ms.

Un changement d'arme ou un intervalle strictement supérieur à 250 ms ouvre une
nouvelle séquence. La séquence est classée selon son nombre de tirs :

- un tir : `tap` ;
- deux tirs : `burst` ;
- trois tirs ou plus : `spray`.

Cette classification est une convention analytique V1, pas une reconstruction
de l'état interne du recul de l'arme. Sans télémétrie supplémentaire, elle ne
peut pas distinguer une rafale de plusieurs taps volontairement très rapides.
Le seuil reste donc exposé dans le moteur et couvert par des tests de frontière.

Chaque séquence conserve ses bornes temporelles, son joueur, son arme, ses tirs
et les preuves de chaque événement de tir.

## 7. Mouvement au tir et counter-strafe V1

Pour chaque tir, le moteur utilise la dernière frame du joueur située au plus
250 ms avant l'événement. La vitesse horizontale provient en priorité des
composantes X/Y, puis du champ de vitesse fourni par le parseur. Elle n'est
jamais reconstruite depuis deux positions.

Un tir est classé `stationary` jusqu'à 5 unités/s incluses et `moving` au-delà.
Un arrêt est considéré `compatible` avec un counter-strafe si une frame des
250 ms précédentes montre au moins 30 unités/s et que la frame du tir est
`stationary`.

`compatible` mesure le résultat cinématique d'un arrêt rapide, pas la touche
pressée. Une démo sans commandes d'entrée ne permet pas de distinguer avec
certitude un counter-strafe actif d'un autre arrêt rapide. Le moteur conserve
donc `not_observed` ou `unavailable` plutôt que d'affirmer ce qu'il ne sait pas.
Une frame trop ancienne, un joueur absent ou une vitesse manquante produisent
une raison d'indisponibilité explicite.

## 8. Contexte des duels V1

Chaque engagement produit un duel qui rassemble :

- participants, initiateur, bornes temporelles, dégâts et kill terminal ;
- première visibilité et délai jusqu'au premier événement de combat ;
- tirs et séquences de tir de chaque joueur dans la fenêtre visible ;
- analyses de mouvement liées à ces tirs ;
- placement du viseur de chaque joueur à la première visibilité ;
- toutes les preuves disponibles.

La fenêtre commence à la première visibilité lorsqu'elle existe, sinon au début
de l'engagement. Dans ce second cas, les raisons de visibilité manquantes sont
conservées et le délai de réaction reste nul au sens de donnée absente, jamais
au sens de réaction instantanée. Un flux de tirs absent est lui aussi signalé.

Le duel ne produit pas de score composite ni de jugement qualitatif : il expose
le contexte mesurable et ses limites.

## 9. Tests obligatoires

### 9.1 Engagements

- échange bilatéral terminé par un kill ;
- séparation après la fenêtre d'inactivité ;
- événements partageant un tick mais ordonnés par séquence ;
- exclusion des dégâts d'équipe et teamkills ;
- contexte d'équipe manquant ;
- flux de dégâts absent ;
- round sans payload ;
- stabilité du résultat et des identifiants de preuves.

### 9.2 Première visibilité

- segment libre et segment traversant un triangle ;
- obstacle uniquement sur les premières frames ;
- contact à une extrémité du segment ;
- géométrie absente, invalide ou associée à une autre map ;
- ordre chronologique de la visibilité et des faits de combat.

### 9.3 Placement du viseur

- erreur de yaw et de pitch pour les deux joueurs ;
- normalisation de l'angle horizontal ;
- pitch absent mais yaw conservé ;
- propagation d'une visibilité indisponible.

### 9.4 Tirs, impacts et dégâts

- chaîne nominale tir, impact et dégât ;
- plusieurs tirs dans un même tick départagés par séquence ;
- tirs simultanés indiscernables laissés ambigus ;
- arme du dégât différente de celle du tir ;
- événement situé au-delà de la fenêtre de deux ticks ;
- flux d'événements manquants signalés explicitement.

### 9.5 Taps, bursts et sprays

- classification d'un tap, d'un burst et d'un spray ;
- intervalle exactement égal à 250 ms ;
- intervalle strictement supérieur à 250 ms ;
- séparation lors d'un changement d'arme.

### 9.6 Mouvement et counter-strafe

- arrêt aux seuils exacts compatible avec un counter-strafe ;
- tir strictement au-dessus du seuil classé en mouvement ;
- priorité des composantes de vélocité et repli sur la vitesse du parseur ;
- vitesse manquante conservée comme indisponible.

### 9.7 Contexte des duels

- duel complet avec visibilité, tirs, mouvement, placement, dégâts et kill ;
- délai entre première visibilité et premier événement de combat ;
- répartition des preuves et mesures par joueur ;
- duel conservé mais explicitement incomplet sans géométrie ni tirs.
