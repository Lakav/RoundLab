# Parité fonctionnelle du rapport Leetify

Ce document décrit l’organisation des données observée sur un rapport public
Leetify en juillet 2026. Il sert de cible fonctionnelle pour RoundLab. La cible
porte sur la hiérarchie de l’information et les familles de métriques, pas sur
la copie de l’identité visuelle de Leetify.

## Navigation principale

1. **Overview**
   - résultat, date, carte et format ;
   - prévision du résultat et contexte de niveau lorsqu’ils sont disponibles ;
   - meilleurs joueurs ;
   - scoreboard configurable.
2. **Match Details**
   - General ;
   - Timeline ;
   - Aim ;
   - Utility ;
   - Activity ;
   - Trades ;
   - Opening Duels ;
   - Clutches.
3. **Head to Head**
   - duels entre chaque paire d’adversaires ;
   - kills et dégâts échangés ;
   - armes ;
   - comparaison aim ;
   - flashes échangées.
4. **Rating Breakdown**
   - rating global, T et CT ;
   - contributions positives et négatives ;
   - rating par round.
5. **Map Zones**
   - performances et événements par zone.
6. **2D Replay**
   - reste un mode de consultation séparé du rapport.

## Scoreboard configurable

Le tableau Overview permet de choisir des colonnes dans quatre familles.

### Ratings

- Aim Rating
- HLTV Rating 1.0
- Rating global, T et CT
- Personal Performance
- Positioning Rating
- Utility Rating

### General

- kills, assists, deaths, kill difference et K/D ;
- ADR, dégâts totaux, KAST et rounds survécus ;
- rounds à 2K, 3K, 4K et 5K ;
- wasted magazine percentage.

### Aim

- accuracy all shots et enemy spotted ;
- crosshair placement ;
- headshot accuracy et headshot kill percentage ;
- counter-strafing ;
- shots fired ;
- spray accuracy ;
- time to damage.

### Positioning

- tentatives, succès et trades des opening duels T et CT ;
- opportunités, tentatives et succès de trade kills ;
- opportunités, tentatives et succès des morts tradées.

### Utility

- dégâts moyens ennemis et alliés par HE ;
- ennemis et alliés flashés par flash ;
- durée moyenne d’aveuglement ;
- flashes menant à un kill ;
- total d’ennemis flashés ;
- dégâts HE et molotov ;
- utilitaires inutilisés à la mort ;
- Utility Quality et Quantity Rating.

## Sous-pages Match Details

| Sous-page | Sorties principales |
| --- | --- |
| General | K, A, D, K/D, ADR, KAST, 2K à 5K, HLTV Rating, rating et performance personnelle |
| Timeline | issue et événements de chaque round |
| Aim | spotted accuracy, time to damage, crosshair placement, head accuracy, HS kill %, spray accuracy, counter-strafing, accuracy all shots |
| Utility | usage global par équipe, rating, quality breakdown, flash assists, ennemis/alliés flashés, blind time, dégâts HE, unused utility |
| Activity | dégâts, dégâts HE/molotov, ennemis flashés, tirs, chargeurs gaspillés, rounds survécus |
| Trades | opportunités, tentatives et taux de réussite pour trade kills et morts tradées |
| Opening Duels | tentatives, succès, trades, adversaire le plus tué, arme principale et détail par round |
| Clutches | opportunités 1vX, rounds gagnés/perdus/sauvés et détail par round |

## État de couverture RoundLab

### Déjà calculé

- K/A/D, K/D, ADR, KAST, survie et dégâts ;
- headshot kills et HS kill percentage ;
- 2K à 5K ;
- opening attempts, wins et losses ;
- opportunités et victoires de clutch 1v1 à 1v5+ ;
- trade attempts, trade kills et traded deaths ;
- grenades lancées, flash assists et utilitaires inutilisés à la mort ;
- ennemis et alliés flashés, durée moyenne d’aveuglement ;
- dégâts HE et molotov, y compris les dégâts aux coéquipiers ;
- économie par round ;
- preuves rejouables pour les actions principales ;
- timeline des rounds.

### Exposé dans le rapport depuis l’intégration des moteurs avancés

- tirs et séquences de spray ;
- précision, head accuracy et spray accuracy uniquement lorsque
  l’association tir-dégât est fiable ;
- compatibilité du counter-strafe lorsqu’un échantillon de mouvement existe ;
- time to damage et crosshair placement lorsqu’une géométrie de visibilité
  est disponible ;
- visites, temps d’occupation et transitions de zones ;
- rotations, tradeability et habitudes de trajectoire répétées.

### Calculé par les moteurs mais pas encore présenté dans sa vue dédiée

- spacing détaillé entre coéquipiers ;
- changements de contrôle de zone ;
- impacts spatiaux des smokes et molotovs ;
- détail complet des engagements et duels.

### Non calculé ou non calibré

- Leetify Rating et Personal Performance ;
- HLTV Rating ;
- Aim, Positioning et Utility Rating sur une échelle 0–100 ;
- benchmarks par niveau ;
- prévision de victoire ;
- Utility Quality et Quantity Rating calibrés ;
- spotted accuracy sans géométrie de visibilité.

RoundLab ne doit jamais remplacer ces valeurs absentes par une estimation
présentée comme équivalente à Leetify. Une valeur indisponible doit rester
explicitement indisponible jusqu’à ce que son modèle soit implémenté et validé.
