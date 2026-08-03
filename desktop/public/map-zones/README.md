# Tactical zone definitions

Place reviewed `<map>.json` tactical-zone definitions in this directory.

Bundled definitions use coarse V2 labels based on common CS2 callouts. The
polygons and altitude ranges are unchanged from the audited V1 definitions:

- `de_ancient.json`: coarse V2 with nine zones, visually checked and audited
  on one real parsed match.
- `de_anubis.json`: coarse V2 with nine zones, visually checked and audited
  on one real parsed match.
- `de_cache.json`: coarse V2 with seven non-empty zones, visually checked and
  audited on one real parsed match.
- `de_dust2.json`: coarse V2 with nine zones, visually checked and audited on
  one real parsed match.
- `de_inferno.json`: coarse V2 with nine zones, visually checked against the
  calibrated radar and audited on 17 real parsed matches.
- `de_mirage.json`: coarse V2 with nine zones, visually checked against the
  calibrated radar and audited on one real parsed match.
- `de_nuke.json`: coarse V2 with seven non-empty zones, including altitude
  separation between the A and B floors, visually checked on both radar layers
  and audited on one real parsed match.
- `de_overpass.json`: coarse V2 with nine non-empty zones, visually checked and
  audited on one real parsed match.
- `de_train.json`: coarse V2 with nine non-empty zones, including its upper
  interior, visually checked on both radar layers and audited on one real
  parsed match.
- `de_vertigo.json`: coarse V2 with seven non-empty zones, including separate
  lower and upper floors, visually checked on both radar layers and audited on
  one real parsed match.

Run the real-position audit with:

```sh
pnpm zones:audit -- \
  --definition public/map-zones/de_inferno.json \
  --parsed-dir data/parsed \
  --min-coverage 0.99
```

`--parsed-dir` accepte aussi le dossier local `.roundlab-compare` : le script
résout alors chaque manifeste scindé et ses fichiers `round-*.json.gz` sans
mélanger les maps.

A definition is not considered reviewed until its polygons, altitude ranges
and labels have been checked against real CS2 coordinates and replays.
Coverage alone is insufficient: every bundled zone must also contain real
samples and its tactical label must match the calibrated radar.

V2 deliberately uses composite labels such as `A Site / Pit / Balcony`: the
current coarse polygons often cover several community callouts. A more precise
single-callout label would be misleading until the polygons are subdivided.
