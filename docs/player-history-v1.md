# Historique joueur RoundLab — V1

**Identifiant :** `roundlab.player-history.v1`  
**Dépendance :** corpus `roundlab.benchmarks.corpus.v1`

## 1. Entrées

Chaque match du corpus doit déclarer un timestamp `playedAt` valide, normalisé
en UTC à l'entrée. La date
d'import dans l'application ne doit pas être confondue avec la date réelle de
la partie lorsque cette dernière est connue.

L'historique sélectionne tous les échantillons T et CT correspondant au même
Steam ID, puis les trie par `playedAt`, `matchId` et côté. Il conserve les
échantillons sources pour que chaque agrégat reste vérifiable.

## 2. Agrégations

Le moteur produit :

- un agrégat global ;
- un agrégat par map ;
- un agrégat par côté T/CT.

Chaque groupe expose le nombre d'échantillons, le nombre de matchs distincts,
les rounds joués et les douze métriques du corpus.

Les ratios ne sont jamais moyennés directement entre matchs. Les numérateurs et
dénominateurs sont additionnés, puis la formule est recalculée :

- K/D = somme des kills / somme des morts ;
- headshot rate = somme des headshots / somme des kills ;
- ADR = somme des dégâts / somme des rounds ;
- opening win rate = somme des openings gagnés / somme des tentatives ;
- survie et KAST = rounds correspondants / somme des rounds ;
- trade kill rate = somme des trade kills / somme des tentatives ;
- volumes par round = somme du volume / somme des rounds.

Si un total source nécessaire manque dans un seul échantillon, l'agrégat
dépendant vaut `null`. Les autres métriques restent calculables. Un joueur absent
du corpus produit `player_not_found_in_corpus`.

## 3. Tendances et régressions V1

**Version :** `roundlab.player-trends.mann-kendall.v1`

Les tendances sont recherchées séparément par map et côté sur les six métriques
de l'indice benchmark. Chaque série exige au moins huit valeurs valides.

Le moteur applique le test non paramétrique de Mann–Kendall avec correction des
égalités. Il conserve le tau de Kendall, le score Z et la p-value bilatérale.
Une série est classée `improving` ou `regressing` uniquement si `p <= 0,05`.
Sinon elle reste `stable`.

Le sens de la métrique est pris en compte : une baisse des morts par round est
une amélioration, tandis qu'une hausse est une régression. Les identifiants de
tous les échantillons utilisés sont conservés comme preuves. Sous huit valeurs,
le résultat vaut `unavailable` avec `insufficient_metric_samples`.

Ce test détecte une tendance monotone, pas forcément linéaire. Une p-value
supérieure à 0,05 ne prouve pas l'absence d'évolution ; elle signifie seulement
que les données disponibles ne suffisent pas à déclarer cette tendance.

## 4. Erreurs récurrentes V1

**Version :** `roundlab.recurring-errors.v1`

Une erreur récurrente V1 est une faiblesse benchmark observée dans au moins
trois des cinq derniers échantillons comparables d'une même map, d'un même
niveau et d'un même côté. Une occurrence est faible lorsque son percentile
orienté est inférieur ou égal à 25.

Cette analyse réutilise les six métriques et les exigences de l'indice
benchmark : chaque distribution doit contenir au moins 100 valeurs. Elle
conserve le taux d'occurrence, le percentile orienté moyen de la fenêtre et les
identifiants exacts des matchs faibles.

Deux mauvaises parties ne suffisent donc pas. Une série trop courte, une
métrique absente ou un benchmark insuffisant est listé dans
`unavailableSeries`, jamais transformé en erreur.

Le terme `benchmark_weakness` est volontaire : le moteur constate une
performance récurrente sous le benchmark, mais ne prétend pas connaître sa
cause mentale, tactique ou mécanique.

## 5. Objectifs mesurables V1

**Version :** `roundlab.training-objectives.v1`

Chaque faiblesse récurrente disponible produit un objectif sur la même map, le
même niveau, le même côté et la même métrique.

La cible est la médiane de la distribution benchmark correspondante. Pour une
métrique où une hausse est favorable, l'objectif demande une valeur au moins
égale à cette médiane. Pour les morts par round, il demande une valeur au plus
égale à la médiane.

L'objectif est réussi si la cible est atteinte dans au moins trois des cinq
prochains échantillons comparables. Il conserve :

- la moyenne des cinq valeurs ayant déclenché l'objectif ;
- la cible, son comparateur et l'effectif du benchmark ;
- la fenêtre d'évaluation et le nombre de succès requis ;
- l'erreur source, son taux de récurrence et les matchs preuves.

Si le benchmark disparaît ou si les cinq valeurs ne sont plus disponibles,
l'erreur est listée dans `unavailableErrorIds` et aucun objectif vague n'est
créé.

## 6. Résumé des constats V1

**Version :** `roundlab.player-findings-summary.v1`

Le résumé assemble uniquement les tendances significatives, erreurs récurrentes
et objectifs déjà calculés. Chaque phrase conserve l'identifiant de son calcul
source et les échantillons qui le prouvent. Une tendance stable ou indisponible
n'est pas présentée comme une progression ou une régression.

L'IA n'est pas retenue pour cette V1. Le produit est local, sans backend prévu
pour protéger une clé ou recueillir le consentement à un envoi externe des
données joueur. Un résumé déterministe évite aussi qu'une reformulation invente
une cause ou une recommandation absente des calculs.

## 7. Limites

Cette V1 ne remplace pas le niveau manquant d'un match et ne fusionne pas deux
Steam IDs supposés appartenir à la même personne. Les tendances restent des
associations temporelles, pas des explications causales.

## 8. Tests obligatoires

- ordre chronologique indépendant de l'ordre d'entrée ;
- nombre distinct de matchs et somme des rounds ;
- ratios recalculés depuis les totaux ;
- séparation globale, par map et par côté ;
- indisponibilité propagée seulement aux métriques dépendantes ;
- joueur absent explicitement signalé ;
- timestamp de corpus invalide rejeté et fuseau normalisé ;
- amélioration monotone significative ;
- hausse des morts classée comme régression ;
- série constante classée stable ;
- tendance refusée sous huit observations ;
- séparation stricte par map et côté ;
- faiblesse présente trois fois dans les cinq dernières parties ;
- deux occurrences insuffisantes ;
- orientation inversée des morts respectée ;
- benchmark trop petit signalé comme indisponible ;
- preuves limitées aux matchs réellement faibles ;
- cible ADR égale à la médiane benchmark ;
- comparateur inversé pour les morts ;
- critère de réussite fixé à trois parties sur cinq ;
- objectif absent si sa distribution disparaît ;
- preuves de l'erreur recopiées sans invention ;
- résumé limité aux constats calculés avec leurs preuves ;
- tendance stable absente du résumé ;
- analyses de joueurs différents rejetées ;
- indisponibilités conservées sans fabriquer de constat.
