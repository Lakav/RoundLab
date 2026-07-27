# Schéma de replay RoundLab V2

**Identifiant :** `roundlab.replay.v2`  
**Statut :** format produit par le parseur

## Changement par rapport au format historique

Le format historique n'avait pas d'identifiant de version et sérialisait les
Steam IDs comme des nombres JSON. Cette représentation est incorrecte dans un
navigateur : un Steam ID dépasse généralement la limite d'entier exact de
JavaScript (`2^53 - 1`).

La V2 ajoute à la racine :

```json
{
  "schemaVersion": "roundlab.replay.v2",
  "parserVersion": "0.1.0"
}
```

Les événements de round conservent également leur tick serveur exact. Les
anciens matchs sans `tick` restent lisibles, mais leurs preuves analytiques ne
peuvent référencer qu'un timestamp.

Les faits conservent aussi `sequence`, leur ordre d'origine dans la démo. Ce
champ départage deux actions au même tick de façon déterministe. Les
déconnexions en cours de round sont exposées dans `rounds[].disconnects` avec
leur joueur, tick, séquence et timestamp. Les tirs, y compris les lancers de
grenades, conservent eux aussi `tick` et `sequence` dans
`rounds[].weaponFires`. Les positions joueur peuvent porter
`equipmentValue`, et l'échantillonnage inclut le tick exact
`rounds[].freezeEndTick` afin de figer l'économie après les achats.
Chaque position joueur peut également exposer `pitch`, `speed`,
`velocityX`, `velocityY`, `velocityZ`, `airborne`, `walking` et `duckAmount`.
Ces champs restent absents lorsque la propriété correspondante n'est pas
disponible dans la démo ; le parseur ne remplace pas une donnée manquante par
un faux état immobile.
Les impacts de balles sont exposés dans `rounds[].bulletImpacts` avec leur
shooter, tick, séquence et coordonnées exactes. Un événement sans coordonnées
XYZ complètes est rejeté plutôt que remplacé par une position artificielle.
Les aveuglements sont conservés dans `rounds[].flashes` avec le lanceur, la
victime, le tick, la séquence, le timestamp et la durée exacte. Ces mêmes faits
alimentent `flashLeft` et `flashTotal` dans les frames ; le rendu et l'analyse
partagent donc désormais une seule source.
Les achats sont conservés dans `rounds[].purchases`, y compris ceux effectués
pendant le freeze time précédant le début du replay. Chaque entrée peut porter
le joueur, l'objet, son coût, le slot d'inventaire et `wasSold` lorsque le
parseur observe un remboursement ultérieur. Le tick et la séquence restent la
référence exacte lorsque plusieurs achats ont un timestamp de replay égal à
zéro.

Tous les Steam IDs sont désormais des chaînes décimales, sans signe ni zéro
initial :

- `players[].steamId` ;
- `rounds[].frames[].players[].id` ;
- `bomb.carrier` ;
- `projectiles[].thrower` ;
- `events[].player`, `killer`, `victim` et `assist` ;
- `damages[].attacker` et `victim` ;
- `weaponFires[].shooter` ;
- `bulletImpacts[].shooter` ;
- `flashes[].thrower` et `victim` ;
- `purchases[].player`.

Les identifiants techniques qui ne sont pas des Steam IDs restent numériques,
notamment le numéro de round, les ticks et les identifiants de projectile.

## Compatibilité

L'application accepte encore les IDs numériques des matchs historiques stockés
dans IndexedDB. Elle ne peut pas récupérer les bits déjà perdus dans ces anciens
JSON : seule une réimportation de la démo garantit leur exactitude.

Les nouvelles sorties du parseur utilisent exclusivement les chaînes. Le code
ne doit jamais reconvertir un Steam ID V2 avec `Number`, `parseInt` ou un cast
équivalent.

## Évolution

Tout changement incompatible de structure ou de sémantique impose un nouvel
identifiant `roundlab.replay.vN`. L'ajout d'un champ optionnel peut rester dans
la même version s'il ne change pas le sens des champs existants.
