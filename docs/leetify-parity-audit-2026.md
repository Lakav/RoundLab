# Audit fonctionnel Leetify / RoundLab — 30 juillet 2026

## Objet

Ce document inventorie les fonctionnalités CS2 publiquement vérifiables de
Leetify, les compare à l'état réel de RoundLab et prépare leur éventuelle
implémentation.

L'objectif n'est pas de copier l'identité visuelle de Leetify ni de fabriquer
des scores qui lui ressemblent. L'objectif est de comprendre :

1. ce que chaque fonctionnalité apporte ;
2. quelles données elle consomme ;
3. si sa formule est publique ;
4. ce que RoundLab possède déjà ;
5. ce qui est reproductible localement et honnêtement.

La décision produit actuelle est maintenue : RoundLab reste centré sur les
statistiques factuelles. La sélection automatique de moments clés et la Review
tactique ne font pas partie de la cible.

## Méthode et niveau de certitude

L'audit s'appuie en priorité sur les sources officielles Leetify accessibles
publiquement au 30 juillet 2026 :

- la page produit publique ;
- le glossaire des statistiques ;
- les articles expliquant les ratings et leurs mises à jour ;
- les annonces produit concernant profils, journal, imports, entraînement,
  highlights et confidentialité ;
- l'organisation observée d'un rapport public déjà documentée dans le dépôt.

Les pages authentifiées n'ont pas toutes une documentation publique complète.
Chaque élément est donc classé :

- **confirmé** : décrit explicitement par une source officielle récente ;
- **historique** : décrit officiellement, mais sans preuve publique récente
  garantissant que l'interface actuelle est identique ;
- **non documenté** : visible ou mentionné, mais formule ou comportement exact
  inconnu.

Une absence de documentation n'autorise jamais RoundLab à inventer la formule.

## Résumé exécutif

Leetify n'est pas seulement un rapport de match. Le produit possède six couches
distinctes :

1. ingestion automatique ou manuelle des démos ;
2. rapport statistique détaillé par match ;
3. replay 2D et vues spatiales ;
4. profil et progression multi-matchs ;
5. fonctions sociales, accomplissements et notifications ;
6. services externes : highlights et serveurs d'entraînement.

RoundLab couvre déjà correctement la deuxième couche sur les statistiques
brutes et possède un replay 2D plus autonome. Il dispose aussi de moteurs
expérimentaux pour l'historique, les tendances et les benchmarks, mais ceux-ci
ne sont pas encore exposés comme un vrai produit.

Les écarts utiles à traiter en premier sont beaucoup plus limités que
« reproduire tout Leetify » :

- finir les métriques de match reproductibles ;
- rendre les filtres et ventilations statistiques plus puissants ;
- construire un historique joueur local ;
- créer ensuite un corpus RoundLab avant tout rating ou couleur comparative.

Les highlights, le feed social, les serveurs de pratique et les notifications
anti-triche sont de vrais produits séparés. Ils ne doivent pas bloquer
l'amélioration du rapport statistique.

## Carte complète du produit Leetify

| Domaine | Fonctionnalités confirmées | RoundLab | Décision |
| --- | --- | --- | --- |
| Ingestion | Matchmaking, FACEIT avec upload, Gamers Club, CYBERSHOKE, Esplay, upload manuel | import local `.dem` et `.dem.zst` | garder l'import local ; automatisation plateforme plus tard |
| Rapport | résumé, scoreboard configurable, détails par famille, head-to-head, rating breakdown, map zones | rapport local riche | priorité immédiate |
| Replay | replay 2D séparé du rapport | replay 2D interactif avancé | déjà fort ; maintenir |
| Ratings | Leetify Rating, Aim, Utility, Positioning, HLTV, benchmarks | Quantity seulement ; infrastructure de corpus non alimentée | ne pas simuler |
| Profil | historique, forme, rang, statistiques agrégées, meilleurs résultats | moteurs d'historique présents, interface absente | priorité après le rapport |
| Journal | questions oui/non et corrélations avec la victoire | absent | pertinent après historique |
| Social | feed, amis suivis, clubs, classements, accomplissements | absent | hors priorité statistique |
| Highlights | clips automatiques via Allstar | absent | hors périmètre local |
| Entraînement | warmup, aim, utility, prefire, retakes, practice et scrim servers | absent | produit serveur séparé |
| Notifications | rapports, records, bans, Discord | absent | nécessite comptes et backend |
| Outils publics | données publiques, leaderboards, spray patterns, bot Discord | absent | hors cœur du projet |
| Confidentialité | compte Steam, profil masquable, API restreinte | données traitées localement | avantage structurel RoundLab |

## 1. Ingestion et gestion des matchs

### Ce que Leetify propose

- rapports automatiques depuis les plateformes supportées ;
- import Matchmaking au moyen des données Valve ;
- intégrations annoncées pour Gamers Club, CYBERSHOKE et Esplay ;
- pages FACEIT pouvant recevoir la démo exacte du match ;
- upload manuel de démos pour certains usages ;
- historique de matchs et placeholders quand la démo manque ;
- rapport partagé entre les participants quand l'origine du match est validée.

La page publique de Leetify liste actuellement Matchmaking, FACEIT, Gamers
Club, CYBERSHOKE et Esplay. L'article Esplay confirme l'import automatique.
Pour FACEIT, l'intégration a évolué : Leetify documente l'upload d'une démo
associée au match et un endpoint permettant de soumettre une URL de démo.

### État RoundLab

- import direct de `.dem` et `.dem.zst` ;
- analyse entièrement locale ;
- stockage IndexedDB ;
- renommage et suppression locale des matchs ;
- aucun compte, aucune synchronisation et aucun backend ;
- aucune association vérifiée avec un match de plateforme.

### Conclusion

RoundLab est déjà meilleur pour la confidentialité et l'autonomie locale.
L'automatisation d'import n'est pas une métrique et nécessite des intégrations
externes fragiles. Elle ne doit être envisagée qu'après stabilisation du
rapport et avec une architecture optionnelle.

## 2. Rapport de match

### Navigation Leetify observée

Le rapport Leetify est organisé autour des familles suivantes :

- Overview et scoreboard configurable ;
- Match Details : General, Timeline, Aim, Utility, Activity, Trades,
  Opening Duels et Clutches ;
- Head to Head ;
- Rating Breakdown ;
- Map Zones ;
- 2D Replay séparé.

RoundLab reprend déjà une grande partie de cette hiérarchie avec Résumé,
Joueurs, Rounds, Général, Aim, Utilitaires, Activité, Trades, Opening Duels,
Clutches, Comparer et Positionnement.

### 2.1 Général

| Métrique ou vue | Leetify | RoundLab | Écart |
| --- | --- | --- | --- |
| score, équipes, map, format | oui | oui | mineur |
| K / A / D | oui | oui | couvert |
| différence de kills | oui | calculable, non mise en avant | affichage |
| K/D | oui | oui | couvert |
| dégâts totaux | oui | oui | couvert |
| ADR | oui | oui | couvert |
| KAST | oui | oui | couvert |
| rounds survécus | oui | oui | couvert |
| 2K, 3K, 4K, 5K | oui | oui | couvert |
| CT / T | oui | oui | couvert |
| eco / force / full-buy | oui | oui | méthode RoundLab documentée |
| HLTV Rating | oui | absent | formule exacte/version à décider |
| wasted magazine percentage | oui/historique | absent | munitions manquantes |
| résultat par round | oui | oui | couvert |
| performance par arme | présente dans certaines vues | vue dédiée filtrable | tirs, kills et HS couverts ; hits/dégâts selon la couverture de l'import |
| performance par map | profil multi-matchs | moteur historique possible | interface absente |

### 2.2 Aim

| Métrique | Définition Leetify publiée | RoundLab | Statut |
| --- | --- | --- | --- |
| tirs | tirs enregistrés | oui | couvert |
| Accuracy all shots | hits / tirs | oui | couvert si association fiable |
| Accuracy enemy spotted | hits / tirs avec ennemi repéré | approximation par masque de visibilité | partiel |
| Head accuracy | impacts tête / impacts, AWP exclue | oui | proche de la formule publique |
| HS kill % | kills HS / kills | oui | couvert |
| Spray accuracy | hits / tirs des sprays 3+, rifles, ennemi repéré | oui avec visibilité approximative | partiel |
| Proper counter-strafing | vitesse <34 % vitesse max, rifles, non accroupi, ennemi repéré | arrêt avant tir selon méthode RoundLab | différent |
| Crosshair placement | angle entre première visibilité et premier dégât, médiane | erreur initiale vers la cible | différent |
| Time to Damage | première visibilité → premier dégât, valeurs <1 s, médiane | moteur présent | géométrie réelle manquante |
| Aim Rating | combinaison de z-scores, hors Accuracy all | absent | corpus privé manquant |

La vue Aim RoundLab expose également les volumes bruts utiles au contrôle des
formules : tirs touchés, dégâts associés, dégâts moyens par impact, impacts
tête/corps, taps, bursts, sprays, tirs en mouvement et nombres d'échantillons
des métriques avancées.

#### Vérification de l'interface connectée — 30 juillet 2026

La page Aim d'un rapport Leetify connecté présente les joueurs par équipe dans
un tableau unique de huit mesures : Spotted Accuracy, Time to Damage, Crosshair
Placement, Head Accuracy, HS Kill %, Spray Accuracy, Counter-Strafing et
Accuracy All. Les volumes techniques ne dominent pas la page.

RoundLab reprend cette hiérarchie sans copier les ratings propriétaires :

- les métriques mécaniques comparables restent immédiatement visibles ;
- les volumes, impacts et séquences sont conservés dans un panneau secondaire
  repliable pour permettre l'audit des calculs ;
- les équipes sont distinguées par une couleur discrète ;
- les définitions restent accessibles au survol ou au clavier.

Les blocs personnalisés observés dans « Your Match » (classements, objectifs,
comparaisons sur 30 matchs, achievements et journal post-match) sont
volontairement hors périmètre : ils ne correspondent pas au choix produit de
rester sur des statistiques de match pures.

Les pages connectées Utility, Activity, Trades, Opening Duels et Clutches ont
également été vérifiées. Cette vérification a conduit aux choix suivants :

- afficher le taux de survie avec le nombre de rounds survécus ;
- afficher la fréquence et la réussite des opening duels, avec filtres Global,
  T et CT ;
- afficher le taux de réussite des trades et la part des morts tradées ;
- comparer la répartition des utilitaires par équipe ;
- conserver les clutches par taille de situation, déjà calculés par RoundLab.

Le « Wasted Magazine % » observé chez Leetify n'est pas ajouté : le parseur
RoundLab ne collecte actuellement ni événement de rechargement ni état fiable
du chargeur au moment du rechargement. Afficher un nombre dérivé des seuls tirs
serait faux. Les opportunités de trade Leetify ne sont pas non plus assimilées
aux candidats spatiaux RoundLab : une ligne de vue statique ne prouve ni
l'orientation, ni la visibilité à travers les smokes, ni la décision de tenter
le trade.

#### Données nécessaires pour fermer l'écart

- géométrie 3D réelle et versionnée des maps ;
- visibilité exacte incluant fumées et obstacles ;
- vitesse maximale canonique par arme et état du joueur ;
- association robuste tirs, impacts et dégâts ;
- posture accroupie et état air/échelle ;
- corpus par version du jeu pour un rating comparable.

### 2.3 Utilitaires

| Métrique | Leetify | RoundLab | Statut |
| --- | --- | --- | --- |
| grenades lancées par type | oui | oui | couvert |
| ennemis flashés / flash | blind >1,1 s | oui | couvert |
| alliés flashés / flash | inclut le lanceur | oui | couvert |
| blind moyen | plus long blind ennemi par flash | oui | couvert |
| kills menés par flash | victime efficacement aveuglée | oui | couvert |
| dégâts ennemis / HE | dégâts / HE lancées | oui | couvert |
| dégâts alliés / HE | oui | oui | couvert |
| dégâts molotov/incendiaire | oui | oui | couvert |
| utilitaires inutilisés à la mort | valeur moyenne | oui | couvert |
| CT smokes that stopped a push | ennemi à moins de 800 unités du bloom | données spatiales présentes | calcul final manquant |
| Utility Quantity | formule publique 0–100 | oui | équivalent |
| Utility Quality | z-scores pondérés | absent | corpus et poids manquants |
| Utility Rating | moyenne géométrique Quantity/Quality | absent | dépend de Quality |

La formule Quantity est publique :

```text
grenadesParRound = grenades hors decoy / rounds
ratio = min(grenadesParRound / 3, 1)
Quantity = ratio^(2/3) × 100
```

Le Quality Rating utilise les z-scores des métriques d'utilitaires et des
benchmarks Leetify. Les poids, distributions complètes et règles de gestion des
valeurs absentes ne sont pas publiés de façon suffisante pour une parité.

### 2.4 Trades et positionnement

Le glossaire Leetify distingue :

- opportunités de trade kill ;
- tentatives de trade kill ;
- succès ;
- opportunités de mort tradable ;
- réponse d'un coéquipier ;
- mort effectivement tradée ;
- opening attempts, successes et trades ;
- Positioning Rating calibré.

RoundLab possède :

- trade kills ;
- morts tradées ;
- réponses par dégâts ;
- openings gagnés et perdus ;
- spacing ;
- tradeability spatiale ;
- rotations, visites et transitions de zones.

L'écart essentiel est l'**opportunité réelle**. La proximité seule ne suffit
pas. Il faut déterminer si le coéquipier pouvait répondre compte tenu de :

- la ligne de vue ;
- la distance ;
- l'orientation ;
- les obstacles et fumées ;
- son état vivant/aveuglé ;
- le timing exact.

Sans géométrie validée, RoundLab doit continuer à afficher les résultats
observés et non prétendre connaître toutes les opportunités.

### 2.5 Opening duels

Leetify expose au minimum :

- tentatives ;
- succès ;
- trades après l'opening ;
- ventilation T/CT ;
- adversaire le plus tué ;
- arme principale ;
- détail par round.

RoundLab couvre tentatives, victoires, défaites, T/CT, preuves et une partie du
détail par round. Les agrégats adversaire et arme sont calculables depuis les
preuves existantes et constituent un ajout peu risqué.

### 2.6 Clutches

Leetify distingue les opportunités 1vX et plusieurs résultats :

- gagné ;
- perdu ;
- sauvé ;
- contexte afterplant ou objectif selon les vues.

RoundLab calcule les opportunités et victoires 1v1 à 1v5+. Il reste à
classifier :

- tentative réellement jouée ;
- save ;
- mort avant tentative ;
- bombe posée ou non ;
- temps restant ;
- issue par kill, temps, explosion ou désamorçage.

Cette extension est factuelle et compatible avec l'orientation « statistiques
pures ».

### 2.7 Head to Head

Leetify compare les paires d'adversaires avec :

- kills échangés ;
- dégâts ;
- armes ;
- aim ;
- flashes.

RoundLab expose déjà kills, dégâts estimés, armes principales, aim et flashes
dans sa vue Comparer. La priorité est la validation des dégâts par paire et
l'ajout de ventilations T/CT, pas une refonte complète.

### 2.8 Timeline

Leetify propose une lecture round par round des résultats et événements.
RoundLab possède les rounds, scores, économies, joueurs et actions factuelles.

La timeline RoundLab doit rester factuelle :

- score et côté ;
- équipement de départ ;
- kills, bombe et utilitaires ;
- avantage numérique au fil du round ;
- aucun classement automatique en « moment important ».

## 3. Ratings et benchmarks

### 3.1 Leetify Rating

Le Leetify Rating actuel est :

- centré sur zéro ;
- à somme nulle dans un match ;
- calculé par round puis moyenné ;
- fondé sur le changement de probabilité de victoire ;
- sensible aux économies, au XvX et au côté ayant perdu le joueur précédent ;
- réparti entre kill, dégâts, flash assist et mort tradée ;
- ajusté pour les saves et fins de round par objectif.

La documentation de novembre 2024 publie la répartition de base d'un kill :

- 35 % au killer ;
- 30 % aux joueurs ayant infligé des dégâts ;
- 15 % à la flash assist ;
- 20 % au joueur dont la mort est tradée ;
- redistribution proportionnelle si une contribution manque.

Mais la valeur totale dépend de tables de probabilités historiques construites
sur les matchs HLTV. La mise à jour appliquée le 25 février 2026 a encore
modifié les tables 1v1 issues d'un 1vX et la gestion des afterplants.

**Conclusion :** RoundLab ne peut pas reproduire honnêtement le Leetify Rating
avec une simple formule locale. Il peut seulement construire un futur
`RoundLab Impact` à partir d'un corpus propre, versionné et suffisamment grand.

### 3.2 Aim, Utility et Positioning Ratings

Ces ratings comparent des métriques à des distributions de référence au moyen
de z-scores. Leetify précise :

- une moyenne globale autour de 50 ;
- des benchmarks recalibrés avec les saisons de CS2 ;
- des tranches Premier allant notamment jusqu'à 20–25k et 25k+ depuis 2025 ;
- des couleurs dépendant des distributions ;
- des ratings différents des métriques brutes.

RoundLab possède une infrastructure de corpus, distributions et scoring, mais
pas un corpus utilisable. Le code seul ne rend donc aucun rating publiable.

### 3.3 Benchmarks et couleurs

Avant d'afficher « faible », « moyen », « bon » ou une couleur de performance,
RoundLab doit connaître :

- la population ;
- le niveau ou rang ;
- la version du jeu ;
- la map et éventuellement le côté ;
- la taille de l'échantillon ;
- la moyenne, l'écart-type et les percentiles ;
- les règles d'exclusion ;
- la date de validité.

Copier les seuils Leetify observés dans une capture serait faux : leurs
benchmarks changent dans le temps et reposent sur leur population.

## 4. Replay 2D et Map Zones

### Leetify

- replay 2D séparé du rapport ;
- accès Pro mentionné dans les offres et annonces ;
- Map Zones pour explorer la performance spatiale ;
- navigation vers les rounds et événements.

### RoundLab

- radar interactif local ;
- joueurs, orientation, équipement et état ;
- bombe, tirs, killfeed, projectiles et effets ;
- dessin libre ;
- superposition de trajectoires ;
- couches de radar sur les maps multi-étages ;
- zones tactiques, temps d'occupation, transitions et rotations.

RoundLab est déjà bien placé sur ce domaine. Les priorités ne sont pas de
rajouter une Review automatique, mais :

- fiabiliser les géométries ;
- exposer les statistiques par zone ;
- filtrer par joueur, côté et round ;
- comparer proprement plusieurs périodes ou matchs.

## 5. Profil et progression multi-matchs

### Fonctionnalités Leetify confirmées ou historiques

- profil joueur avec statistiques agrégées ;
- historique de rang et de matchs ;
- forme récente ;
- records personnels ;
- forces relatives ;
- comparaison à des benchmarks ;
- résultats par map et période ;
- accomplissements ;
- rapports de session.

### État RoundLab

Le dépôt contient déjà des moteurs pour :

- agréger un historique joueur ;
- analyser des tendances Mann-Kendall ;
- détecter des erreurs récurrentes ;
- construire des objectifs ;
- résumer des constats ;
- préparer un corpus de benchmark.

Ces moteurs ne constituent pas encore une fonctionnalité utilisateur complète.
Ils ne sont pas reliés à une page de profil stable, et plusieurs modules
d'interprétation/objectifs ne correspondent plus à la décision récente de
rester sur les statistiques pures.

### Cible recommandée

Construire d'abord un profil purement statistique :

- nombre de matchs et de rounds ;
- win rate ;
- K/D, ADR, KAST ;
- aim brut ;
- utilitaires ;
- openings, trades et clutches ;
- tendances par fenêtre de 5, 10, 20 et 50 matchs ;
- ventilation par map et côté ;
- médiane et intervalle interquartile ;
- taille d'échantillon et couverture ;
- aucun conseil automatique.

## 6. Journal et corrélations

Le Post-Match Journal Leetify permet :

- de créer des questions oui/non ;
- de répondre après chaque match ;
- de calculer la corrélation avec le taux de victoire ;
- d'afficher un intervalle de confiance ;
- de calculer aussi des corrélations automatiques depuis les statistiques.

Cette fonctionnalité est compatible avec RoundLab à condition de rester
statistiquement honnête.

### Données nécessaires

- historique de matchs fiable ;
- réponses datées et liées aux matchs ;
- nombre minimal d'observations ;
- estimation d'effet ;
- intervalle de confiance ;
- avertissement explicite : corrélation ≠ causalité.

### Priorité

Pertinent après la page de profil et l'historique, pas avant.

## 7. Accomplissements, social et sessions

Leetify propose ou a officiellement décrit :

- records personnels ;
- accomplissements rares ;
- progression de rang ;
- Home feed centré sur soi ou ses amis ;
- demandes de suivi avec consentement ;
- clubs et classements ;
- rapports de session ;
- comparaison et célébration entre amis.

Ces fonctionnalités reposent volontairement sur une sélection de faits
remarquables. Elles entrent en conflit avec l'orientation actuelle de RoundLab
si elles sont présentées comme analyse de jeu.

Décision recommandée :

- ne pas les inclure dans la roadmap statistique immédiate ;
- éventuellement ajouter plus tard des records purement numériques et
  désactivables ;
- ne pas réintroduire un moteur de « moments clés » sous un autre nom.

## 8. Highlights, entraînement et notifications

### Highlights

Leetify sélectionne des rounds et délègue la génération/hébergement des clips à
Allstar. Les seuils sont personnalisés selon l'historique du joueur.

RoundLab n'a pas de pipeline vidéo. Cette fonctionnalité suppose :

- rendu ou service de génération vidéo ;
- stockage ;
- coûts et quotas ;
- nouvelle sélection automatique de moments.

Elle est hors périmètre.

### Entraînement

Leetify Pro annonce en 2026 :

- warmup guidé ;
- modes Aim et Utility ;
- Prefire et Grenade Learner ;
- retakes ;
- practice servers ;
- scrim servers avec slot coach.

Ce sont des services de serveurs CS2, pas des fonctions d'analyse de démo.
Ils ne doivent pas être inclus dans la roadmap de parité statistique.

### Notifications

Leetify mentionne :

- rapports disponibles après le match ;
- records ;
- notifications de bans ;
- bot Discord.

RoundLab étant local et sans compte, ces fonctions nécessiteraient un backend.
Elles restent hors priorité.

## 9. Matrice de faisabilité

### A — Directement réalisable avec les données actuelles

| Fonctionnalité | Travail restant |
| --- | --- |
| kill difference | affichage |
| openings par adversaire et arme | agrégation des preuves existantes |
| clutch outcomes détaillés | classification factuelle des fins de round |
| statistiques par arme | agrégation kills, tirs, hits et dégâts |
| statistiques par côté | généraliser les vues existantes |
| statistiques par round | densifier la timeline factuelle |
| statistiques par zone | exposer visites, durée et événements |
| médianes et dispersions | agrégation multi-matchs |
| profil local | relier stockage et moteur d'historique |

### B — Réalisable après enrichissement du parseur

| Fonctionnalité | Donnée manquante |
| --- | --- |
| wasted magazines | munitions du chargeur avant/après la séquence |
| counter-strafe équivalent | vitesse max arme, posture, état précis |
| visibilité exacte | géométrie, fumées et occlusion |
| TTD fiable | première visibilité exacte |
| crosshair placement équivalent | angles et visibilité exacts |
| trade opportunities | visibilité, distance, orientation et aveuglement |
| CT smokes stopped push | lanceur, bloom exact et positions adverses |

### C — Réalisable après historique multi-matchs

| Fonctionnalité | Condition |
| --- | --- |
| tendances 5/10/20/50 matchs | profil local stable |
| performance par map | volume suffisant par map |
| forme récente | règle de fenêtre documentée |
| records personnels numériques | historique complet |
| journal | réponses et matchs liés |
| corrélations | taille d'échantillon et intervalles |

### D — Nécessite un corpus de référence

| Fonctionnalité | Condition |
| --- | --- |
| couleurs de performance | percentiles versionnés |
| Aim Rating | distributions et poids |
| Positioning Rating | métriques finalisées et distributions |
| Utility Quality | distributions et poids |
| Utility Rating global | Quality fiable |
| RoundLab Impact | modèle de probabilité de victoire |

### E — Hors périmètre de l'application locale actuelle

- feed social ;
- clubs et demandes d'amis ;
- Discord bot ;
- notifications anti-triche ;
- highlights vidéo ;
- serveurs de warmup, retake, practice et scrim ;
- import automatique de toutes les plateformes sans service externe.

## 10. Roadmap recommandée

### Phase 1 — Fermer le rapport statistique

- [x] ajouter une vue par arme avec tirs, tirs associés à des dégâts, précision,
  dégâts, kills et headshot kills ;
- [x] enrichir les clutches avec issue sauvée et contexte bombe ; le save est
  déduit du vainqueur du round et de la survie du clutcheur, `round_end` ne
  portant aucun motif de fin de round ;
- [x] compléter Opening Duels avec adversaire, arme et T/CT ;
- [x] exposer le spacing joueur en plus des statistiques par zone ;
- [x] ajouter les filtres joueur, équipe, côté et round à la vue par arme ;
- [x] généraliser ces filtres aux autres tableaux du rapport ;
- [x] ne pas afficher `0 %` quand l'association tir-dégât est absente et
  expliquer explicitement l'indisponibilité ;
- [x] généraliser l'affichage de couverture à toutes les sous-pages.

### Phase 2 — Fiabiliser Aim, trades et smokes

1. importer une géométrie de map locale versionnée ;
2. valider la visibilité sur toutes les maps ;
3. extraire vitesse d'arme, posture et munitions ;
4. recalculer TTD, crosshair placement et counter-strafe ;
5. calculer les opportunités de trade ;
6. calculer les CT smokes stoppant une poussée.

### Phase 3 — Construire le profil local

1. sélectionner le joueur propriétaire ;
2. agréger tous ses matchs ;
3. afficher séries temporelles et fenêtres récentes ;
4. ventiler par map, côté et arme ;
5. afficher médiane, dispersion, échantillon et couverture ;
6. retirer des moteurs historiques les recommandations automatiques non
   désirées.

### Phase 4 — Journal statistique

1. questions oui/non locales ;
2. réponses liées aux matchs ;
3. estimation de corrélation ;
4. intervalle de confiance ;
5. seuil minimal d'échantillon ;
6. aucune formulation causale.

### Phase 5 — Corpus et scores RoundLab

1. collecter uniquement des contributions consenties ;
2. versionner population et provenance ;
3. auditer biais et taille d'échantillon ;
4. publier d'abord des percentiles bruts ;
5. ne créer des ratings qu'après validation ;
6. ne jamais les appeler « Leetify Rating ».

## 11. Fonctionnalités à ne pas ajouter maintenant

- détection automatique de moments clés ;
- Review tactique ;
- score global inventé ;
- couleurs sans benchmark ;
- Personal Performance approximative ;
- faux HLTV Rating sans version et formule explicites ;
- conseils d'entraînement générés automatiquement ;
- highlights ou social avant le profil statistique.

## Sources officielles principales

- [Page produit Leetify](https://leetify.com/)
- [Glossaire officiel des statistiques](https://leetify.com/blog/leetify-stats-glossary/)
- [Fonctionnement du Leetify Rating](https://leetify.com/blog/leetify-rating-explained/)
- [Mise à jour du Leetify Rating de mars 2026](https://leetify.com/blog/leetify-rating-update-2026-02-25/)
- [Rating Breakdown](https://leetify.com/blog/rating-breakdown/)
- [Benchmarks CS2](https://leetify.com/blog/cs2-benchmarks/)
- [Recalibrage Aim et Utility 2025](https://leetify.com/blog/benchmarks-season-3/)
- [Utility Quantity et Quality](https://leetify.com/blog/utility-ratings/)
- [Post-Match Journal](https://leetify.com/blog/post-match-journal/)
- [Nouvelle Home sociale](https://leetify.com/blog/our-new-home-page-a-place-to-celebrate-accomplishments/)
- [Upload des démos FACEIT](https://leetify.com/blog/faceit-uploads/)
- [Endpoint d'upload FACEIT](https://leetify.com/blog/faceit-demo-upload-api/)
- [Import Esplay](https://leetify.com/blog/esplay/)
- [Serveurs d'entraînement 2026](https://leetify.com/blog/scl-training-collab/)
- [Highlights automatiques](https://leetify.com/blog/improved-highlight-selection/)
- [Confidentialité des profils et API](https://leetify.com/blog/privacy-updates-to-our-api-and-profiles/)

## Conclusion

Leetify doit être traité comme une référence de couverture produit, pas comme
une spécification directement copiable.

La meilleure suite pour RoundLab n'est pas de reproduire les fonctions les plus
visibles de Leetify. C'est de terminer les statistiques de match calculables,
construire un historique local rigoureux, puis créer son propre corpus. Tant
que le corpus et la géométrie n'existent pas, les ratings et conclusions
tactiques doivent rester absents.
