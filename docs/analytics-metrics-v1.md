# Spécification analytique RoundLab — V1

**Identifiant de spécification :** `roundlab.metrics.v1`  
**Statut :** spécification initiale, moteur V1 en cours d'implémentation  
**Public principal :** joueur individuel  
**Publics secondaires :** équipe et coach

Ce document fixe les règles de calcul de la première version analytique de
RoundLab. Deux implémentations qui reçoivent les mêmes événements normalisés
doivent produire le même résultat JSON.

La V1 décrit des faits et des métriques brutes. Elle ne définit ni score global,
ni benchmark, ni recommandation automatique.

## 1. Règles communes

### 1.1 Version et reproductibilité

Chaque analyse doit conserver :

- `specVersion`, égal à `roundlab.metrics.v1` ;
- `inputSchemaVersion`, version du schéma d'événements normalisés ;
- `parserVersion`, version du parseur ayant produit les faits ;
- `generatedAt`, informatif et exclu de toute comparaison déterministe ;
- l'identifiant du match analysé.

Une modification de formule, de fenêtre temporelle ou de règle d'exclusion
impose une nouvelle version de spécification. Une correction qui change un
résultat existant impose également une nouvelle version.

### 1.2 Unités et arrondis

- Les timestamps sont exprimés en secondes depuis le début du round.
- Les durées sont comparées sans arrondi.
- Les compteurs sont des entiers.
- Les ratios sont stockés sous forme décimale entre `0` et `1`.
- Les moyennes sont stockées sans arrondi par le moteur. L'interface choisit
  uniquement leur format d'affichage.
- Une division dont le dénominateur vaut zéro produit `null`, jamais `0`.

### 1.3 Périmètre d'un round

Un round est analysable s'il possède un début, une fin, un gagnant valide et
une chronologie d'événements complète. Les warmups, rounds restaurés incomplets,
événements postérieurs à la fin du round et rounds marqués `partial` sont
exclus des agrégats.

Une déconnexion ne compte ni comme mort ni comme survie. Si elle empêche de
connaître l'état final du joueur, les métriques dépendantes sont `null` pour ce
joueur et ce round.

### 1.4 Identité, équipe et côté

Un joueur est identifié par son Steam ID. Les bots doivent recevoir un
identifiant stable dans le match ; un contrôle de bot par un humain ne fusionne
pas leurs statistiques en V1.

L'équipe désigne l'effectif logique qui conserve son score malgré le changement
de côté. Le côté (`T` ou `CT`) est déterminé séparément pour chaque joueur et
chaque round. Les agrégats sont produits pour le match complet et séparément
pour les côtés T et CT.

Le lien entre une équipe logique (`A` ou `B`) et un côté est établi lorsqu'un
seul score augmente d'un point et que le côté gagnant du round est connu. Pour
un match complet commençant au premier round, numéroté 0 ou 1 selon la source,
le score précédent initial est `0-0`.
L'identité des effectifs ainsi établie est ensuite conservée d'un round à
l'autre, y compris après un changement de côté. Un extrait commençant en cours
de match n'est jamais supposé commencer à `0-0`.

Si le score, le côté gagnant ou la continuité des effectifs ne permettent pas
d'établir cette correspondance sans contradiction, l'équipe logique du round
et ses agrégats de match valent `null` avec une raison d'indisponibilité. Aucun
agrégat partiel n'est publié comme un résultat complet.

### 1.5 Événements simultanés

L'ordre canonique est :

1. tick serveur ;
2. sous-tick s'il existe ;
3. index d'origine dans la démo ;
4. identifiant stable de l'événement.

Cet ordre est utilisé pour les openings, trades, clutches et changements de
situation numérique. Le timestamp d'affichage ne départage jamais deux
événements.

### 1.6 Valeurs inconnues

Une donnée absente n'est jamais déduite silencieusement depuis une variation de
frame. La métrique concernée vaut `null` et expose un code dans
`unavailableReasons`, par exemple `missing_damage_events`.

Un agrégat de match est `null` si un round inclus manque une donnée nécessaire,
sauf pour un simple compte d'événements dont le flux est explicitement marqué
complet.

## 2. Faits normalisés requis

Le parseur extrait les faits ; il ne calcule pas les métriques. Le moteur V1
consomme au minimum les événements suivants :

| Fait | Champs minimaux |
| --- | --- |
| `round_started` | round, tick, côtés, équipes, joueurs participants |
| `round_ended` | round, tick, gagnant, raison |
| `player_killed` | tick, killer, victime, assistant, arme, headshot, teamkill, suicide |
| `player_damaged` | tick, attaquant si connu, victime, arme si connue, dégâts de vie réels, dégâts d'armure, hitgroup |
| `grenade_thrown` | tick, lanceur, type de grenade, identifiant du projectile |
| `player_flashed` | tick, lanceur, victime, durée de blindage |
| `player_disconnected` | tick, joueur |
| `bomb_planted` | tick, joueur |
| `bomb_defused` | tick, joueur |

Les snapshots de joueur restent utiles comme contexte et comme preuve visuelle,
mais ne remplacent pas les événements de dégâts, de lancer ou de mort.

## 3. Format des preuves

Chaque résultat explicable référence zéro ou plusieurs preuves :

```json
{
  "evidenceId": "r12-kill-0042",
  "roundNumber": 12,
  "tick": 184233,
  "sequence": 421,
  "time": 38.421875,
  "type": "kill",
  "actors": [76561198000000001, 76561198000000002]
}
```

`evidenceId` est stable pour une même entrée et une même version de schéma.
`sequence` départage les faits partageant le même tick. Le replay s'ouvre à
`max(0, time - 3)` secondes. Ce décalage d'interface ne fait pas partie du
calcul.

Les compteurs agrégés conservent les identifiants des preuves qui les composent.
Les ratios conservent séparément les preuves du numérateur et, lorsque c'est
utile, celles du dénominateur.

## 4. Dictionnaire des métriques V1

### 4.1 Kills, morts, assists et K/D

**Identifiants :** `kills`, `deaths`, `assists`, `kdRatio`

- `kills` : morts adverses dont le joueur est le killer.
- `deaths` : morts du joueur causées par un adversaire, par lui-même ou par le
  monde.
- `assists` : morts adverses pour lesquelles le joueur est l'assistant désigné
  par le jeu.
- Un teamkill n'ajoute pas de kill mais ajoute une mort à la victime.
- Un suicide n'ajoute pas de kill mais ajoute une mort.
- `kdRatio = kills / deaths`; si `deaths = 0`, la valeur est `null`.

**Preuves :** événements `player_killed` concernés.

### 4.2 Headshot rate

**Identifiant :** `headshotRate`

`headshotRate = kills par headshot / kills`, en excluant teamkills et suicides.
Si `kills = 0`, la valeur est `null`.

Le hitgroup d'un dégât non létal n'affecte pas cette métrique.

**Preuves :** kills du numérateur et liste de tous les kills du dénominateur.

### 4.3 ADR

**Identifiant :** `adr`

Pour chaque événement `player_damaged`, les dégâts comptés sont les dégâts de
vie réellement retirés à un adversaire, déjà plafonnés par ses points de vie
restants. Les dégâts d'armure, dégâts aux coéquipiers, dégâts à soi-même et
dégâts postérieurs à la fin du round sont exclus.

`ADR = somme des dégâts de vie valides / rounds analysables auxquels le joueur
a participé`.

Un round commencé par le joueur compte même s'il se déconnecte ensuite. L'ADR
est `null` tant que le flux complet `player_damaged` n'est pas disponible.

**Preuves :** tous les événements de dégâts inclus.

### 4.4 KAST

**Identifiant :** `kastRate`

Un round satisfait KAST si le joueur remplit au moins une condition :

- obtient un kill valide ;
- obtient une assist valide ;
- survit jusqu'à `round_ended` ;
- sa mort est tradée selon la définition de la section 4.8.

`kastRate = rounds satisfaisant au moins une condition / rounds analysables
auxquels le joueur a participé`.

Une assist et un kill dans le même round ne comptent qu'une fois.

**Preuves :** condition(s) ayant validé chaque round KAST.

### 4.5 Openings gagnés et perdus

**Identifiants :** `openingAttempts`, `openingWins`, `openingLosses`

Le premier kill valide entre adversaires du round est l'opening :

- le killer reçoit une tentative et une victoire ;
- la victime reçoit une tentative et une défaite.

Les kills monde, suicides et teamkills ne peuvent pas être un opening. Si aucun
kill adverse valide n'a lieu, aucune tentative n'est créée.

**Preuve :** premier `player_killed` valide du round.

### 4.6 Multikills

**Identifiants :** `multiKillRounds.2`, `.3`, `.4`, `.5plus`

Nombre de rounds où le joueur obtient respectivement exactement 2, 3, 4, ou au
moins 5 kills valides. Un round appartient à une seule catégorie. Les kills ne
doivent pas être consécutifs et aucune fenêtre temporelle n'est appliquée.

**Preuves :** tous les kills du joueur dans le round concerné.

### 4.7 Clutches

**Identifiants :** `clutchOpportunities.1v1`, `.1v2`, `.1v3`, `.1v4`, `.1v5plus`
et `clutchWins` avec les mêmes catégories.

Une opportunité commence au premier instant où :

- le joueur est le seul membre vivant de son équipe ;
- au moins un adversaire est vivant ;
- le round n'est pas terminé.

La catégorie est fixée par le nombre d'adversaires vivants à cet instant. Une
seule opportunité est créée par joueur et par round. Elle est gagnée si son
équipe remporte le round et si le joueur ne meurt pas avant la fin. Une victoire
par explosion de bombe ou expiration du temps est valide ; aucun kill minimal
n'est exigé.

**Preuves :** événement déclencheur, changements d'état pertinents et fin du
round.

### 4.8 Trades réussis et morts tradées

**Identifiants :** `tradeAttempts`, `tradeKills`, `tradeDeaths`

Fenêtre V1 : `5.0` secondes, inclusive.

Après la mort valide d'un coéquipier, tuer son killer est un `tradeKill` si :

- le kill survient au plus 5 secondes après la mort initiale ;
- les deux événements appartiennent au même round ;
- le killer initial n'est pas mort entre les deux événements.

La mort initiale devient alors une `tradeDeath` pour la victime. Un kill peut
trader plusieurs morts causées par le même adversaire dans la fenêtre, mais il
ne compte que comme un seul `tradeKill`.

Une `tradeAttempt` est attribuée à chaque coéquipier vivant au moment de la mort
initiale qui produit au moins un événement `player_damaged` contre le killer
initial pendant la fenêtre. Plusieurs dégâts du même joueur ne créent qu'une
tentative. Sans événements de dégâts complets, `tradeAttempts` vaut `null`, mais
`tradeKills` et `tradeDeaths` restent calculables.

**Preuves :** mort initiale, dégâts de tentative et kill de trade.

### 4.9 Survie

**Identifiants :** `survivedRounds`, `survivalRate`

Un joueur survit s'il a participé au round et ne possède aucun événement de mort
avant `round_ended`. Un joueur déconnecté dont l'état final est inconnu rend le
résultat du round indisponible.

`survivalRate = survivedRounds / rounds analysables joués`.

**Preuves :** fin de round et, pour les non-survivants, événement de mort.

### 4.10 Grenades utilisées

**Identifiants :** `grenadesThrown.total`, `.flash`, `.smoke`, `.he`,
`.molotov`, `.incendiary`, `.decoy`

Une grenade est comptée une fois à son événement `weapon_fire`, normalisé en
fait analytique `grenade_thrown` selon le type de l'arme au lancer. Les
projectiles vus dans plusieurs snapshots ne sont jamais recomptés. Une grenade
lâchée à la mort ou supprimée sans lancer n'est pas comptée.

**Preuves :** événements `grenade_thrown`.

### 4.11 Flash assists

**Identifiant :** `flashAssists`

Nombre de kills adverses pour lesquels le jeu désigne explicitement le joueur
comme flash assister. La V1 ne reconstruit pas une flash assist à partir de la
seule durée de blindage.

**Preuves :** événements de kill portant l'assistant flash.

### 4.12 Utilitaires conservés à la mort

**Identifiants :** `utilitySavedOnDeath.total` et détail par type

Pour chaque mort du joueur, compter les grenades encore présentes dans son
inventaire au dernier état canonique strictement antérieur à la mort. Une
grenade active déjà lancée ou dont l'événement de lancer précède la mort n'est
pas conservée.

Le compteur de match est la somme des unités, pas le nombre de morts concernées.
Si l'inventaire précédant une mort manque, toute la métrique agrégée vaut
`null`.

**Preuves :** mort et snapshot d'inventaire utilisé.

### 4.13 Catégorie économique du round

**Identifiant :** `economyRounds`

La catégorie V1 est une convention RoundLab explicite, pas une norme
universelle. Elle utilise la moyenne de `current_equip_value` des joueurs d'un
camp au tick exact de fin du freeze time :

- `eco` si la moyenne est strictement inférieure à 2 000 dollars ;
- `force_buy` de 2 000 inclus à 3 500 exclus ;
- `full_buy` à partir de 3 500 inclus.

La moyenne permet de conserver la même échelle lorsqu'un camp commence le
round avec moins de cinq joueurs. Si le tick de fin de freeze, sa frame, ou la
valeur d'équipement d'au moins un joueur du camp manque, la catégorie vaut
`null` avec une raison d'indisponibilité.

**Preuve :** snapshot exact de l'équipe à la fin du freeze time.

**Identifiant joueur :** `byEconomy.eco`, `.forceBuy`, `.fullBuy`

Toutes les métriques joueur V1 sont recalculées sur les rounds appartenant à
chaque catégorie, avec les mêmes formules et preuves que l'agrégat général.
`byEconomy.unavailableRounds` compte les rounds joués dont l'économie du camp
n'a pas pu être classée ; ils ne sont injectés dans aucune catégorie.

### 4.14 Performance CT/T

**Identifiant :** `bySide.CT` et `bySide.T`

Ce n'est pas une nouvelle formule. Chaque métrique V1 est recalculée sur les
rounds où le joueur appartient au côté demandé. Un événement de trade ne peut
pas traverser un round et appartient donc toujours à un seul côté.

**Preuves :** identiques à celles de la métrique agrégée, filtrées par côté.

### 4.15 Agrégats par équipe logique

**Identifiant :** `teams.A` et `teams.B`

Les compteurs individuels sont additionnés sur tous les joueurs et rounds
rattachés à l'effectif logique. `roundsPlayed` compte les rounds de l'équipe,
tandis que `playerRounds` compte les participations joueur-round utilisées
comme dénominateur pour la survie et le KAST.

- `winRate = roundsWon / roundsPlayed` ;
- `ADR équipe = somme des dégâts de vie / roundsPlayed` ;
- `survivalRate = survivants / playerRounds` ;
- `kastRate = playerRounds satisfaisant KAST / playerRounds`.

Les autres ratios et compteurs reprennent les règles de leurs métriques V1.
Les noms et scores finaux proviennent des équipes logiques A/B, jamais des
côtés T/CT.

### 4.16 Moments importants

**Identifiant :** `keyMoments`

Liste chronologique, sans score opaque, des preuves déjà calculées appartenant
à l'une des catégories suivantes :

1. clutch gagné ;
2. opening gagné ou perdu ;
3. round à 3 kills ou plus ;
4. trade kill ;
5. pose ou désamorçage de bombe.

Un même événement peut porter plusieurs catégories mais ne produit qu'un seul
moment. L'ordre de priorité ci-dessus départage les catégories principales.
Le moment conserve toutes ses catégories, les joueurs concernés et
l'identifiant de sa preuve principale. Les égalités opening sont départagées
par `opening_win` avant `opening_loss`.
La V1 ne limite pas le nombre de moments dans les données ; l'interface peut
en afficher un sous-ensemble sans modifier l'analyse.

### 4.17 Efficacité des flashes

**Identifiants :** `flashes.enemiesFlashed`, `flashes.teammatesFlashed`,
`flashes.averageEnemyBlindDuration`,
`flashes.averageTeammateBlindDuration`

Chaque événement `player_blind` valide est attribué à son lanceur et à sa
victime. Une victime adverse augmente `enemiesFlashed` et la durée ennemie
cumulée. Une victime alliée différente du lanceur augmente
`teammatesFlashed` et la durée alliée cumulée. Un joueur qui se flashe
lui-même n'est compté dans aucune des deux catégories.

La durée moyenne est la durée cumulée divisée par le nombre d'événements de la
catégorie. Sans événement, elle vaut `null`.

### 4.18 Dégâts utilitaires

**Identifiants :** `utilityDamage.heDamage`, `utilityDamage.fireDamage`,
`utilityDamage.teammateHeDamage`, `utilityDamage.teammateFireDamage`

Les événements de dégâts attribués à une HE, une molotov ou une incendiaire
sont séparés des dégâts d'arme. Les dégâts adverses et alliés sont conservés
dans des compteurs distincts. Ils restent `null` si le flux complet de dégâts
ou le contexte d'équipe manque.

## 5. Disponibilité avec le parseur actuel

| État | Métriques |
| --- | --- |
| Calculables après normalisation des événements existants | K/D/A, headshot rate, openings, multikills, clutches, trade kills, morts tradées, survie, flash assists, efficacité des flashes, grenades utilisées, catégories économiques, CT/T, moments importants |
| Nécessitent les événements complets de dégâts | ADR, tentatives de trade, dégâts HE et molotov |
| Nécessitent un inventaire canonique juste avant la mort | Utilitaires conservés à la mort |
| Dépend des métriques précédentes | KAST |

Le moteur ne doit pas publier une valeur partielle comme si elle était complète.

## 6. Structure minimale de `MatchAnalysis`

```json
{
  "specVersion": "roundlab.metrics.v1",
  "inputSchemaVersion": "roundlab.events.v1",
  "parserVersion": "string",
  "matchId": "string",
  "generatedAt": "ISO-8601",
  "players": [
    {
      "playerId": "76561198000000001",
      "name": "string",
      "metrics": {},
      "metricEvidence": {},
      "bySide": {
        "CT": {
          "metrics": {},
          "metricEvidence": {},
          "unavailableReasons": []
        },
        "T": null
      },
      "byEconomy": {
        "eco": null,
        "forceBuy": {
          "metrics": {},
          "metricEvidence": {},
          "unavailableReasons": [],
          "economyEvidence": []
        },
        "fullBuy": null,
        "unavailableRounds": 0
      },
      "unavailableReasons": []
    }
  ],
  "teams": [
    {
      "logicalTeam": "A",
      "name": "string",
      "score": 13,
      "playerIds": ["76561198000000001"],
      "metrics": {
        "roundsPlayed": 24,
        "roundsWon": 13,
        "winRate": 0.5416666666666666,
        "playerRounds": 120,
        "adr": 391.25
      },
      "metricEvidence": {},
      "unavailableReasons": []
    }
  ],
  "rounds": [],
  "economyRounds": [],
  "keyMoments": [],
  "evidence": []
}
```

Les Steam IDs sont sérialisés en chaînes pour éviter toute perte de précision
dans les environnements JavaScript.

## 7. Tests d'acceptation obligatoires

Chaque formule doit couvrir au minimum :

- cas nominal ;
- dénominateur nul ;
- teamkill, suicide et kill monde ;
- événements au même tick ;
- changement de côté ;
- overtime ;
- déconnexion ;
- round incomplet ;
- preuve pointant vers le round et le tick exacts ;
- stabilité du JSON hors `generatedAt`.

Des fixtures synthétiques minimales doivent tester une seule règle à la fois.
Les démos de référence doivent ensuite verrouiller des snapshots globaux, sans
remplacer les tests unitaires de formule.

## 8. Hors périmètre V1

- rating ou score global ;
- benchmarks et percentiles ;
- probabilité de victoire ;
- précision, spray et counter-strafe ;
- visibilité, temps de réaction et placement du viseur ;
- qualité tactique des utilitaires ;
- score de positionnement ;
- fusion des statistiques d'un humain avec celles d'un bot contrôlé.
