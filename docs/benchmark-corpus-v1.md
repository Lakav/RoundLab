# Corpus de benchmarks RoundLab — V1

**Identifiant :** `roundlab.benchmarks.corpus.v1`  
**Statut :** infrastructure implémentée, corpus de production absent  
**Dépendance :** analyses `roundlab.metrics.v1`

Le flux d'ingestion, le manifeste de provenance et les commandes de collecte
sont documentés dans
[`benchmark-collection-v1.md`](benchmark-collection-v1.md).

## 1. Unité d'observation

Le corpus reçoit des analyses de matchs déjà calculées, accompagnées de deux
libellés obligatoires : la map et le niveau. Les `matchId` doivent être uniques.

Chaque joueur produit au maximum un échantillon T et un échantillon CT. Un
échantillon sans round joué dans le camp concerné est exclu. Il conserve :

- le match, le joueur, la map, le niveau et le camp ;
- les versions du moteur de métriques, du schéma d'entrée et du parseur ;
- le nombre de rounds observés ;
- les métriques V1 et leurs valeurs indisponibles.

L'audit du corpus compte les matchs, joueurs, échantillons et player-rounds
pour chaque combinaison exacte map, niveau et camp.

Une porte de disponibilité versionnée matérialise ensuite toutes les strates
requises par le produit, y compris celles complètement absentes. Par défaut,
chaque combinaison map, niveau et camp exige simultanément :

- 20 matchs distincts ;
- 50 joueurs distincts ;
- 100 échantillons joueur/camp ;
- 1 000 player-rounds ;
- 30 résultats de round.

Ces seuils sont une convention V1 explicite, pas une loi statistique
universelle. Les 100 échantillons rendent le score benchmark disponible et les
30 résultats rendent le baseline Wilson disponible. Les exigences de diversité
et de player-rounds empêchent qu'une poignée de joueurs répétés fasse passer
artificiellement la strate. Le produit peut relever ces seuils, jamais les
contourner silencieusement.

Une strate contenant une analyse qui n'utilise pas
`roundlab.metrics.v1`, `roundlab.replay.v2` ou une version de parseur connue
reste indisponible. Les payloads incompatibles sont comptés et signalés ; leur
présence ne peut pas être masquée par un volume suffisant de parties modernes.

## 2. Distributions V1

Les distributions ne mélangent jamais deux maps, niveaux ou camps. Les volumes
de kills, morts, assists, grenades et flash assists sont divisés par les rounds
joués. Les ratios déjà définis par `roundlab.metrics.v1` sont conservés.

Les métriques distribuées sont :

- kills, morts et assists par round ;
- K/D, headshot rate et ADR ;
- taux de victoire en opening ;
- survie, trade kills par tentative et KAST ;
- grenades et flash assists par round.

Une valeur indisponible ou un ratio sans dénominateur est exclu et compté dans
`excludedSampleCount`. Elle ne devient jamais artificiellement zéro. Les
valeurs valides sont triées et arrondies à six décimales pour produire un JSON
déterministe.

## 3. Résumés statistiques V1

Chaque distribution produit séparément :

- la médiane ;
- les percentiles P10, P25, P75 et P90 ;
- un intervalle de confiance à 95 % pour chacun de ces quantiles.

Les quantiles utilisent l'interpolation linéaire
`index = (n - 1) × probabilité`. Les résultats sont arrondis à six décimales.

Les intervalles sont non paramétriques. Le moteur applique la borne simultanée
de Dvoretzky-Kiefer-Wolfowitz :

`epsilon = sqrt(log(2 / alpha) / (2 × n))`, avec `alpha = 0,05`.

L'intervalle du quantile `p` est obtenu entre les quantiles empiriques
`max(0, p - epsilon)` et `min(1, p + epsilon)`. Cette méthode ne suppose ni
distribution normale ni variance stable et couvre simultanément la fonction de
répartition.

Sous 20 valeurs valides, le quantile descriptif reste disponible, mais
l'intervalle vaut `null` avec
`insufficient_samples_for_confidence_interval`. Ce seuil est une convention de
prudence versionnée ; il ne transforme pas un petit échantillon en preuve
statistique.

Les valeurs non finies sont retirées du calcul et ajoutées au compteur
d'exclusion.

## 4. Modèle de probabilité de victoire V1

**Version :** `roundlab.win-probability.wilson.v1`

Le premier modèle est volontairement un baseline de victoire de round. Pour
chaque combinaison map, niveau et côté, le corpus conserve une observation
gagnée et une observation perdue par round valide, respectivement pour les
camps T et CT.

Le modèle compte les victoires et estime la probabilité centrale avec le centre
de l'intervalle de Wilson à 95 %. Il fournit également les bornes basse et
haute de cet intervalle. Contrairement au taux brut, cette estimation ne produit
jamais exactement 0 ou 1 sur un échantillon fini.

Une strate exige au moins 30 rounds. Sous ce seuil, la probabilité et
l'intervalle valent `null` avec `insufficient_round_samples`.

Ce baseline mesure uniquement le taux de victoire observé d'un côté dans une
strate. Il ne s'agit pas encore d'un modèle personnalisé ni causal : il
n'utilise ni identité du joueur, ni forme récente, ni statistiques produites
après le début du round. Cette limite évite notamment d'introduire les kills du
round comme une fuite de données pour prédire le résultat de ce même round.

## 5. Score benchmark explicable V1

**Version :** `roundlab.benchmark-score.v1`

Le score compare un échantillon joueur/côté à six distributions de la même map,
du même niveau et du même côté :

- kills par round ;
- morts par round ;
- ADR ;
- taux de victoire en opening ;
- trade kills par tentative ;
- KAST.

Chaque distribution doit contenir au moins 100 valeurs finies. Les six
métriques doivent être disponibles ; sinon le score vaut `null` et chaque cause
est listée. Cette règle interdit notamment d'afficher un score avec le corpus
local actuel.

Le rang percentile utilise le rang moyen en cas d'égalité. Pour les morts par
round, le percentile est inversé ; pour les cinq autres métriques, une valeur
plus haute est considérée meilleure. Le score final est la moyenne des six
percentiles orientés. Un joueur exactement à la médiane obtient donc 50.

Chaque contribution conserve :

- la valeur du joueur et l'effectif du benchmark ;
- le percentile brut et le percentile orienté ;
- l'orientation de la métrique ;
- les points ajoutés ou retirés par rapport à la base 50 ;
- un impact `gain`, `loss` ou `neutral`.

Les six métriques ont le même poids. Ce choix rend l'indice entièrement
auditable, mais ce n'est pas une preuve que ces métriques ont le même impact
causal sur la victoire. Le score est un indice de position relative, distinct
du modèle Wilson de victoire.

## 6. Audit du corpus local au 27 juillet 2026

Le dossier local contient 17 payloads uniques, 602 rounds et uniquement
`de_inferno`. Ils ne déclarent ni version de schéma moderne ni niveau de joueur.
Ce jeu est utile pour des tests de parsing, mais il n'est pas un corpus de
benchmarks défendable.

La chaîne de collecte peut désormais transformer un match parsé complet en
analyse métrique, charger un manifeste versionné, vérifier sa provenance,
construire le corpus et produire son rapport de préparation. Cela rend la
collecte reproductible, mais ne remplace pas les parties et labels absents.

La tâche « constituer un corpus suffisamment large » reste donc incomplète.
Il faut au minimum collecter plusieurs maps et niveaux, documenter la provenance
et les règles d'inclusion, puis vérifier les effectifs de chaque strate avant
de calculer des références.

## 7. Tests obligatoires

- rejet des `matchId` dupliqués ;
- rejet d'une map ou d'un niveau vide ;
- échantillons séparés par camp ;
- audit exact des matchs, joueurs, échantillons et player-rounds ;
- corpus vide signalé comme indisponible ;
- matérialisation des strates map/niveau/camp totalement absentes ;
- refus tant qu'un seuil de matchs, joueurs, échantillons, player-rounds ou
  résultats de round n'est pas atteint ;
- disponibilité uniquement lorsque toutes les strates requises sont prêtes ;
- manifeste, date de jeu et provenance obligatoires ;
- chemin d'analyse absolu, sortant du manifeste ou dupliqué refusé ;
- `matchId` dupliqué entre deux analyses refusé ;
- analyse legacy ou version de parseur inconnue signalée comme incompatible ;
- distributions strictement séparées par map, niveau et camp ;
- normalisation des volumes par round ;
- valeur indisponible exclue et comptée, jamais remplacée par zéro ;
- médiane et percentiles interpolés sur une série non triée ;
- intervalles DKW déterministes à 95 % ;
- intervalle refusé sous 20 valeurs ;
- distribution vide explicitement indisponible ;
- valeurs non finies exclues et comptées ;
- observations T et CT complémentaires pour chaque round ;
- modèle Wilson équilibré ;
- modèle refusé sous 30 rounds ;
- probabilité extrême maintenue strictement entre 0 et 1 ;
- séparation stricte des modèles par map, niveau et côté ;
- score neutre et contributions nulles aux médianes ;
- inversion correcte des morts par round ;
- gains et pertes détaillés par métrique ;
- score refusé si une métrique ou distribution manque ;
- score refusé sous 100 valeurs par distribution.
