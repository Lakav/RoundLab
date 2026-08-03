# Spécification spatiale RoundLab — V1

**Identifiant :** `roundlab.spatial.v1`  
**Statut :** implémentée  
**Dépendance :** frames `roundlab.replay.v2`

## 1. Zones tactiques

Une définition de map contient un nom de map, une version et des zones
identifiées. Chaque zone possède :

- un identifiant stable et un libellé ;
- un polygone 2D en coordonnées monde ;
- une altitude minimale incluse ;
- une altitude maximale exclue ;
- une priorité optionnelle.

Les polygones doivent avoir au moins trois points finis. Les identifiants sont
uniques et les intervalles d'altitude non vides. Les frontières du polygone
appartiennent à la zone.

Quand plusieurs zones contiennent une position, la priorité la plus haute
l'emporte. Plusieurs zones de même priorité maximale rendent l'échantillon
`ambiguous` : le moteur ne choisit pas selon l'ordre du fichier.

## 2. Visites de zones

Pour chaque joueur vivant, chaque frame est affectée à une zone. Des
échantillons consécutifs dans la même zone forment une visite avec :

- joueur, round et zone ;
- premier et dernier timestamp ;
- ticks dérivés correspondants ;
- nombre d'échantillons.

Une sortie de toutes les zones, une ambiguïté, une disparition de la frame ou
une mort termine la visite. Les échantillons hors zone et ambigus restent
comptés séparément.

## 3. Transitions

Une transition relie deux visites successives du même joueur uniquement lorsque
le changement de zone est observé directement entre deux frames valides. Une
frame hors zone, ambiguë, absente ou avec joueur mort rompt la continuité :
aucune origine ou destination n'est alors inventée.

Chaque transition conserve le joueur, son camp, les deux visites, les zones,
le timestamp et le tick.

## 4. Contrôle et prises de zone

À chaque frame, une zone est :

- `empty` sans joueur vivant affecté ;
- `T` avec seulement des Terroristes ;
- `CT` avec seulement des Contre-Terroristes ;
- `contested` avec les deux camps.

Les états identiques consécutifs sont compressés en intervalles. Le premier camp
exclusif observé établit le contrôle. Une prise (`takeover`) est produite
uniquement lorsqu'un camp devient exclusif alors que l'autre était le dernier
contrôleur exclusif connu. Les passages par `empty` ou `contested` ne suppriment
pas ce dernier contrôleur.

## 5. Rotations V1

Une rotation coordonnée exige au moins deux joueurs distincts du même camp
effectuant une transition directe vers la même zone. Le premier et le dernier
passage doivent être séparés d'au plus trois secondes, borne incluse.

Un déplacement isolé, une arrivée après cette fenêtre ou un trajet traversant
une zone inconnue n'est pas appelé rotation. Cette convention mesure une arrivée
coordonnée observable ; elle ne prétend pas connaître l'intention tactique.

## 6. Spacing V1

À chaque frame, les joueurs vivants d'un même camp sont regroupés par paire.
Pour chaque paire et chaque round, le moteur conserve :

- le nombre d'échantillons ;
- la moyenne, médiane, valeur minimale et maximale de la distance 3D ;
- la moyenne de la distance horizontale.

Les identifiants de joueurs sont triés afin que la même paire reste stable quel
que soit l'ordre des joueurs dans la frame. Le spacing ne dépend pas des zones
tactiques et reste donc calculable si leur définition manque.

## 7. Tradeability spatiale V1

Pour chaque kill adverse valide, le moteur cherche une frame contenant killer
et victime au plus 250 ms avant l'événement. Il liste ensuite chaque coéquipier
vivant de la victime avec :

- sa distance 3D à la victime ;
- sa distance 3D au killer ;
- son temps de flash restant lorsqu'il est disponible ;
- sa ligne de vue statique vers le killer.

Un joueur figure dans `coveringPlayerIds` uniquement si la géométrie statique
confirme une ligne dégagée. Une ligne bloquée vaut `false`; une géométrie absente
vaut `null` avec une raison d'indisponibilité. Ces états ne sont jamais fusionnés.

Cette mesure décrit la possibilité spatiale immédiate de répondre. Elle ne
produit pas de score binaire de tradeability et ne garantit pas un trade :
l'orientation, le temps de réaction, les smokes et la décision du joueur restent
des facteurs séparés.

## 8. Impact spatial des smokes et feux V1

Les rayons partagés avec le replay sont :

- smoke : 144 unités ;
- molotov : 116 unités ;
- incendiaire : 104 unités.

Pour chaque smoke active, le moteur compte les échantillons de joueurs dont les
yeux se trouvent dans le volume sphérique V1. Il examine aussi les paires
adverses : une ligne est attribuée à la smoke uniquement si la géométrie statique
laissait les joueurs se voir avant que le segment ne traverse le volume. Sans
géométrie, les comptes de lignes valent `null`, jamais zéro.
Pour chaque paire réellement coupée, le moteur conserve les deux joueurs, le
nombre d'échantillons ainsi que les premier et dernier timestamps. Le rapport peut
ainsi montrer une relation concrète au lieu d'un compteur anonyme répété à
chaque frame.

Pour chaque feu actif, le moteur compte les joueurs dans son rayon horizontal
avec une tolérance verticale de 64 unités. Les événements de dégâts
`inferno`/molotov/incendiaire sont associés au feu actif le plus proche de la
victime. Deux feux équidistants restent ambigus. Les dégâts de vie et d'armure,
ainsi que les victimes, sont conservés.

Une smoke temporellement active couvrant plus de 25 % du disque de feu est
référencée comme chevauchement. Ce lien ne prétend pas prouver l'extinction si
le flux d'événements ne l'indique pas explicitement.

Ces volumes sont des conventions analytiques cohérentes avec le replay, pas une
reconstruction cellule par cellule des particules ou de l'inferno Source 2.

## 9. Comparaison des trajectoires V1

Deux trajectoires sont candidates si elles concernent le même joueur, le même
camp et deux rounds différents, avec des positions initiales distantes d'au
plus 256 unités. Chaque trajectoire exige au moins deux timestamps distincts et
un camp stable dans le round.

Les trajectoires sont interpolées sur 20 points de progression normalisée entre
leur premier et leur dernier échantillon vivant. Le moteur conserve la distance
initiale, puis la moyenne, la médiane et le maximum des distances 3D entre les
points correspondants.

La progression normalisée compare la forme générale malgré des durées
différentes. Elle ne constitue pas un Dynamic Time Warping et ne prétend pas
aligner automatiquement deux timings tactiques différents. Les métriques sont
arrondies à six décimales à la sortie afin de supprimer le bruit flottant du
JSON versionné.

## 10. Habitudes de trajectoire V1

Une habitude exige au moins trois rounds du même joueur et du même camp. Tous
les rounds du groupe doivent être similaires deux à deux : leur distance 3D
moyenne ne dépasse pas 128 unités et leur distance maximale ne dépasse pas 256
unités, bornes incluses.

Le moteur cherche les groupes maximaux qui respectent cette contrainte. Il ne
fusionne donc pas une chaîne où A ressemble à B et B à C si A ne ressemble pas
à C. Pour chaque groupe, il conserve les rounds concernés, le nombre de paires,
la moyenne des distances moyennes et les pires distances moyenne et maximale.

Trois occurrences constituent une convention analytique minimale, pas la
preuve d'une intention tactique. Les seuils sont versionnés et devront être
recalibrés sur le corpus de benchmarks prévu à l'étape 7.

## 11. Contrat de qualité joueur

**Version de formule :** `roundlab.spatial.v2.quality`

Chaque joueur expose sous `SpatialAnalysis.players` la couverture
d'attribution des zones, le nombre de zones visitées, les transitions,
rotations, distances moyennes aux coéquipiers et habitudes répétées sous forme
de `QualityMetric`.

Le taux d'attribution peut être publié avec une couverture partielle. En
revanche, les comptes dérivés des zones restent `null` dès qu'une position
vivante du joueur n'a pas pu être affectée sans ambiguïté : une trajectoire
partielle ne doit pas être présentée comme exhaustive. Le spacing est
`estimated`, avec confiance moyenne, car il repose sur les paires de positions
échantillonnées dans les frames plutôt que sur une trajectoire client continue.
Le rapport affiche les échantillons, la provenance et les raisons
d'indisponibilité de ces métriques.

## 12. Disponibilité

Les définitions sont chargées depuis `/map-zones/<map>.json`. Une définition
absente, invalide ou associée à une autre map produit une raison
d'indisponibilité. Un round sans frames produit `missing_frame_payload`.

Le moteur est validé sur des zones synthétiques et sur dix découpages réels
grossiers :

- Ancient `roundlab.de_ancient.coarse.v2` : 591 066 positions vivantes ;
- Anubis `roundlab.de_anubis.coarse.v2` : 1 119 460 positions vivantes ;
- Cache `roundlab.de_cache.coarse.v2` : 959 645 positions vivantes ;
- Dust2 `roundlab.de_dust2.coarse.v2` : 485 810 positions vivantes ;
- Inferno `roundlab.de_inferno.coarse.v2` : 17 parties et 3 793 470
  positions vivantes ;
- Mirage `roundlab.de_mirage.coarse.v2` : une partie et 299 244 positions
  vivantes ;
- Nuke `roundlab.de_nuke.coarse.v2` : une partie et 610 885 positions
  vivantes, avec séparation des étages A et B par altitude ;
- Overpass `roundlab.de_overpass.coarse.v2` : une partie et 753 803 positions
  vivantes ;
- Train `roundlab.de_train.coarse.v2` : une partie et 471 190 positions
  vivantes, avec séparation de l'intérieur supérieur ;
- Vertigo `roundlab.de_vertigo.coarse.v2` : une partie et 994 291 positions
  vivantes, avec séparation des niveaux inférieur et supérieur.

Chaque audit assigne 100 % des positions, sans position hors zone ni ambiguïté.
Les zones de chaque map ont aussi été superposées au radar calibré pour une
vérification visuelle. L'ensemble couvre 10 078 864 positions vivantes. Deux
zones Cache initialement vides et une zone Nuke presque vide ont été fusionnées
après l'audit. Chaque map calibrée et prise en charge possède désormais sa
définition relue.

Les frontières restent volontairement grossières. La V2 conserve les polygones
audités de la V1 et remplace les directions génériques par des libellés
composites issus des callouts CS2 courants. Une couverture de 100 %
ne prouve pas à elle seule leur qualité tactique ; le bêta-test devra notamment
confirmer que les regroupements restent compréhensibles pour les joueurs.

## 13. Tests obligatoires

- validation des identifiants, polygones et altitudes ;
- appartenance aux frontières ;
- séparation des étages par altitude ;
- chevauchement ambigu à priorité égale ;
- résolution par priorité explicite ;
- compression des échantillons en visites stables ;
- transition directe entre deux zones ;
- rupture de continuité sur un échantillon inconnu ;
- états vide, exclusif et contesté ;
- prise après le dernier contrôle exclusif adverse ;
- rotation coordonnée à la borne des trois secondes ;
- rejet d'un passage isolé ou tardif ;
- agrégats de spacing indépendants des zones ;
- coéquipier couvrant avec distances et flash ;
- distinction entre ligne bloquée et géométrie absente ;
- kill sans frame de combat suffisamment récente ;
- smoke traversant une ligne statiquement ouverte ;
- mur déjà bloquant avant la smoke ;
- géométrie absente distincte de zéro ligne coupée ;
- présence et dégâts réels dans un feu ;
- chevauchement temporel smoke/feu ;
- dégâts de feu ambigus ou sans position récente ;
- flux d'effets ou de dégâts absents ;
- comparaison à progression normalisée malgré des durées différentes ;
- borne inclusive des 256 unités au départ ;
- exclusion immédiate au-delà de cette borne ;
- exclusion d'un camp instable ou d'une trajectoire trop courte ;
- stabilité des métriques flottantes ;
- habitude formée par trois rounds tous similaires deux à deux ;
- rejet d'une simple chaîne de similarités ;
- seuils d'habitude inclusifs ;
- séparation stricte des joueurs et des camps ;
- définitions absentes ou incompatibles ;
- round sans frames.
