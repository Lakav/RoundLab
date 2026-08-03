# Collecte du corpus benchmark RoundLab — V1

**Manifeste :** `roundlab.benchmark-collection-manifest.v1`  
**Bundle produit :** `roundlab.benchmark-corpus-bundle.v1`

## 1. Flux de collecte

Une partie brute ne rejoint jamais directement le corpus. Le flux obligatoire
est :

1. parser la démo au format RoundLab ;
2. produire une analyse `roundlab.metrics.v1` ;
3. déclarer la map, le niveau, la date réelle et la provenance dans le
   manifeste ;
4. construire le bundle ;
5. vérifier que toutes les strates requises sont prêtes.

Une analyse peut être générée depuis un match parsé complet, JSON ou JSON
compressé :

```sh
cd web
pnpm benchmark:analyze -- \
  --input data/parsed/<match>.json.gz \
  --output benchmark/analyses/<match>.json \
  --match-id <identifiant-stable> \
  --generated-at 2026-07-27T12:00:00Z
```

`generated-at` date le calcul, pas la partie. La date réelle de jeu appartient
au manifeste.

## 2. Provenance obligatoire

Chaque entrée du manifeste référence une analyse située dans le dossier du
manifeste ou l'un de ses sous-dossiers. Les chemins absolus et les remontées
avec `..` sont refusés.

La provenance conserve :

- le type de source : upload joueur, dataset sous licence ou organisation ;
- une référence vérifiable vers la source ;
- la base autorisant l'usage : consentement joueur, licence du dataset ou
  accord de l'organisation ;
- la date de collecte.

Une provenance absente, un type inconnu ou une base d'autorisation inconnue
bloquent la construction. Les données de QA internes ne doivent pas recevoir
un faux consentement pour entrer dans le corpus.

### Export par un bêta-testeur

Depuis la liste des parties, l'action **Benchmark export** demande :

- le joueur qui consent ;
- son niveau FACEIT ou son rating Premier auto-déclaré ;
- la date réelle de la partie ;
- un consentement explicite avant la création du fichier.

L'export conserve uniquement les métriques agrégées du joueur sélectionné. Son
Steam ID est remplacé par un identifiant aléatoire stable sur l'installation ;
son nom, les Steam IDs et les analyses des neuf autres joueurs sont supprimés.
Le fichier reste local tant que le bêta-testeur ne choisit pas de le partager.
Ce mécanisme est pseudonyme, pas anonyme : le collecteur doit toujours protéger
les fichiers reçus.

Voir
[`benchmark-collection-manifest.example.json`](benchmark-collection-manifest.example.json)
pour un manifeste minimal valide.

## 3. Construction et audit

```sh
cd web
pnpm benchmark:build -- \
  --manifest benchmark/manifest.json \
  --output benchmark/corpus-bundle.json
```

La sortie contient :

- le corpus et ses échantillons joueur/camp ;
- les résultats de round ;
- la provenance rattachée à chaque `matchId` ;
- le rapport de préparation de chaque strate map/niveau/camp.

Les contributions exportées par plusieurs bêta-testeurs peuvent être agrégées
directement :

```sh
cd web
pnpm benchmark:collect -- \
  --input-dir benchmark/contributions \
  --output benchmark/corpus-bundle.json \
  --maps de_inferno,de_mirage \
  --levels faceit-level-9,faceit-level-10 \
  --generated-at 2026-07-27T12:00:00Z
```

Le collecteur refuse un paquet dont les identifiants ne correspondent plus,
qui contient plusieurs joueurs, un Steam ID, un nom non neutralisé ou une
déclaration de confidentialité invalide.

Le bundle reste indisponible tant qu'une strate manque un seuil ou contient une
analyse incompatible. La V1 exige `roundlab.metrics.v1`,
`roundlab.replay.v2` et une version de parseur connue. Les anciens payloads
locaux `roundlab.replay.legacy` restent utilisables pour la QA, mais sont
explicitement refusés comme preuve de préparation du corpus.

## 4. Règles de collecte

- Ne jamais inventer le niveau à partir du score d'une seule partie.
- Ne jamais utiliser la date d'import comme date de jeu lorsqu'elle est
  inconnue.
- Ne jamais mélanger deux systèmes de niveaux sous le même libellé.
- Conserver un `matchId` stable et unique.
- Documenter les suppressions, exclusions et changements de label.
- Recalculer l'analyse avec la version courante avant une publication du
  benchmark.
