# Import de géométrie CS2

## Statut

RoundLab sait convertir une scène glTF 2.0 ou GLB en triangles 3D, puis charger
le JSON produit par nom de map. Aucun maillage Valve n'est distribué dans ce
dépôt.

La chaîne a été conçue autour de
[ValveResourceFormat / Source 2 Viewer](https://github.com/ValveResourceFormat/ValveResourceFormat),
qui sait parcourir les VPK et traiter notamment les maps, meshes, collisions
physiques et données de visibilité Source 2. Ce projet précise lui-même que ces
formats sont compris par reverse engineering, faute de documentation ou de code
Source 2 public fourni par Valve.

## 1. Extraire depuis une installation autorisée

1. Ouvrir les archives VPK de sa propre installation CS2 avec Source 2 Viewer.
2. Sélectionner la map et ses données statiques d'occlusion/collision.
3. Exporter la scène en glTF 2.0 ou GLB.
4. Noter la version de CS2, la version de l'outil et les ressources incluses.

Un mesh de rendu complet ne doit pas être accepté aveuglément comme collision :
des décorations non bloquantes peuvent fausser la visibilité, tandis que des
collisions invisibles peuvent manquer. La validation sur des lignes de vue
connues reste obligatoire.

Les fichiers extraits du jeu ne doivent pas être commités sans vérification
explicite de leurs droits de redistribution.

## 2. Convertir pour RoundLab

Depuis `desktop` :

```bash
pnpm geometry:import -- \
  --input /chemin/vers/de_nuke.glb \
  --map de_nuke \
  --geometry-id vrf-VERSION_cs2-BUILD \
  --output public/map-geometry/de_nuke.json
```

L'identifiant doit permettre de retrouver la source exacte. La commande :

- accepte `.gltf` avec buffers externes ou data URI, et `.glb` ;
- applique toute la hiérarchie de transformations ;
- accepte les positions `float32` et les indices 8, 16 ou 32 bits ;
- convertit par défaut le repère glTF Y-up vers le repère Source Z-up ;
- rejette les primitives non triangulées et les accès hors buffer ;
- refuse d'écraser un résultat existant sans `--force`.

`--scale` applique un facteur uniforme positif. `--keep-gltf-axes` désactive la
conversion d'axes uniquement si l'export a déjà été remis dans le repère Source.

## 3. Charger et valider

L'application recherche une map sous :

```text
/map-geometry/<nom-de-map>.json
```

Le chargeur vérifie le schéma, les nombres finis et la concordance du nom de
map. Une absence produit `missing_map_geometry`; une donnée invalide n'est pas
silencieusement ignorée.

À la première requête, le moteur construit et met en cache un BVH déterministe.
Chaque ligne de vue traverse d'abord les boîtes englobantes puis seulement les
triangles des feuilles candidates. Une mesure locale de développement sur un
maillage synthétique de 50 000 triangles a donné environ 24 ms de construction
et 3 ms pour 1 000 requêtes dégagées à l'intérieur du volume. Ces nombres ne
remplacent pas une mesure sur une vraie map et une vraie partie.

Avant de valider une map réelle :

1. vérifier plusieurs coordonnées connues dans les trois axes ;
2. tester des lignes ouvertes et des murs évidents ;
3. tester les niveaux superposés de Nuke, Vertigo ou Train ;
4. comparer plusieurs premières visibilités au replay ;
5. mesurer le coût sur une partie complète.

Le moteur actuel traite la géométrie statique. Les smokes, portes et obstacles
dynamiques nécessitent encore une couche temporelle séparée.
