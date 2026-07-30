"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const STAT_DEFINITIONS: Record<string, string> = {
  ADR: "Dégâts moyens infligés par round.",
  KAST: "Pourcentage de rounds où le joueur réalise un kill, une assistance, survit ou est tradé.",
  "K/D": "Nombre de kills divisé par le nombre de morts.",
  "HS kill %": "Part des kills réalisés avec un headshot.",
  "Head accuracy": "Part des impacts associés qui touchent la tête, en excluant l’AWP.",
  "Accuracy all": "Part de tous les tirs qui sont associés à au moins un dégât.",
  "Précision tous tirs": "Part de tous les tirs qui sont associés à au moins un dégât.",
  "Précision sur ennemi repéré": "Part des tirs qui touchent lorsque la démo indique qu’un ennemi est repéré.",
  "Tirs ennemi repéré": "Nombre de tirs effectués pendant qu’au moins un adversaire vivant est repéré.",
  "Time to damage": "Temps médian entre la première visibilité d’un adversaire et le premier dégât, limité aux valeurs inférieures à une seconde.",
  "Temps avant dégâts": "Temps médian entre la première visibilité d’un adversaire et le premier dégât.",
  "Erreur initiale du viseur": "Écart angulaire entre le viseur et la cible au moment de sa première visibilité.",
  "Spray accuracy": "Part des tirs de sprays de fusil qui touchent quand un ennemi est repéré.",
  "Arrêt avant tir": "Part des tirs évaluables précédés d’un arrêt rapide compatible avec un counter-strafe.",
  "Contre-strafe moyen": "Part moyenne des tirs évaluables précédés d’un arrêt rapide.",
  "Tirs en mouvement": "Part des tirs évalués où le joueur se déplace encore au moment du tir.",
  "Tirs scoped": "Tirs dont la dernière frame strictement antérieure, au maximum 250 ms avant le tir, indique que la lunette est active.",
  "Dégâts / impact": "Dégâts de santé moyens par événement d’impact associé.",
  Tap: "Séquence composée d’un seul tir.",
  Burst: "Séquence composée de deux tirs rapprochés.",
  Spray: "Séquence composée d’au moins trois tirs rapprochés.",
  "Tirs touchés": "Tirs associés à au moins un événement de dégâts.",
  Touchés: "Tirs associés à au moins un événement de dégâts.",
  "Dégâts associés": "Dégâts que le moteur a pu relier de façon fiable à un tir.",
  "2K": "Rounds où le joueur réalise exactement deux kills.",
  "3K": "Rounds où le joueur réalise exactement trois kills.",
  "4K": "Rounds où le joueur réalise exactement quatre kills.",
  "5K": "Rounds où le joueur réalise au moins cinq kills.",
  Opening: "Premier duel létal du round.",
  Openings: "Premiers duels létaux des rounds.",
  "Opening duels": "Premiers duels létaux de chaque round.",
  "Tentatives d'opening": "Nombre d’openings gagnés ou perdus par le joueur. Le pourcentage indique la part de ses rounds concernés.",
  "Réussite opening": "Openings gagnés divisés par les tentatives d’opening.",
  "Morts tradées": "Morts suivies rapidement par l’élimination de l’adversaire responsable.",
  "Trade kills": "Kills réalisés rapidement après la mort d’un coéquipier face au même adversaire.",
  "Tentatives de trade": "Réponses où le joueur inflige des dégâts à l’adversaire après la mort d’un coéquipier, dans la fenêtre de trade.",
  "Réussite des trades": "Trade kills divisés par les tentatives de trade mesurables.",
  "Morts tradées / morts": "Part des morts du match suivies d’un trade kill allié.",
  Tradeability: "Situations où un coéquipier pouvait potentiellement répondre après une mort.",
  Clutches: "Situations où un joueur reste seul face à un ou plusieurs adversaires.",
  Opportunités: "Nombre de situations de clutch détectées.",
  "1v1": "Clutch où le joueur reste seul face à un adversaire.",
  "1v2": "Clutch où le joueur reste seul face à deux adversaires.",
  "1v3": "Clutch où le joueur reste seul face à trois adversaires.",
  "1v4": "Clutch où le joueur reste seul face à quatre adversaires.",
  "1v5+": "Clutch où le joueur reste seul face à au moins cinq adversaires.",
  "Force-buy": "Achat partiel engagé malgré une économie insuffisante pour un équipement complet.",
  Eco: "Round joué avec un investissement faible pour préserver l’économie.",
  "Full-buy": "Round joué avec un équipement complet selon les seuils documentés par RoundLab.",
  "Rounds anti-eco": "Rounds où l’équipement moyen adverse est classé eco à la fin du freeze time.",
  "Conversion anti-eco": "Part des rounds gagnés parmi les rounds où l’adversaire est classé eco.",
  "Pertes contre eco": "Rounds perdus alors que l’équipement moyen adverse est classé eco.",
  "Valeur perdue à la mort": "Somme de current_equip_value sur la dernière frame strictement antérieure à chaque mort.",
  "Valeur moyenne perdue": "Valeur d’équipement moyenne observée juste avant chaque mort exploitable.",
  "Dépenses nettes": "Somme des achats moins remboursements. RoundLab la laisse indisponible tant que la sémantique temporelle du flux d’achats n’est pas validée.",
  "Armes principales sauvegardées": "Rounds perdus terminés en vie avec un fusil, sniper, PM, pompe ou mitrailleuse dans l’inventaire.",
  "Rounds en avantage": "Rounds où l’équipe possède au moins une fois plus de joueurs vivants que l’adversaire après une mort ou déconnexion.",
  "Conversion de l’avantage": "Part des rounds gagnés parmi ceux où l’équipe obtient un avantage numérique.",
  Spacing: "Distance observée entre un joueur et ses coéquipiers.",
  "Distance équipiers": "Distance horizontale moyenne entre le joueur et ses coéquipiers.",
  Rotations: "Déplacements collectifs vers une autre zone de la carte.",
  Transitions: "Passages enregistrés d’une zone tactique à une autre.",
  "Zones visitées": "Nombre de zones tactiques distinctes occupées par le joueur.",
  "Échantillons spacing": "Nombre de mesures de distance utilisées pour calculer l’espacement.",
  "KAST rounds": "Nombre de rounds satisfaisant au moins une condition KAST.",
  "Utility Quantity": "Note de quantité d’utilitaires fondée sur la formule publique documentée.",
  Quantity: "Note de quantité d’utilitaires fondée sur la formule publique documentée.",
  Quantité: "Note de quantité d’utilitaires fondée sur la formule publique documentée.",
  "Blind moyen": "Durée moyenne pendant laquelle les adversaires restent aveuglés par une flash.",
  "Ennemis / flash": "Nombre moyen d’adversaires effectivement aveuglés par flash lancée.",
  "Alliés / flash": "Nombre moyen de coéquipiers effectivement aveuglés par flash lancée.",
  "Kills / flash": "Nombre moyen de kills alliés réalisés pendant l’aveuglement provoqué par une flash.",
  "Dégâts / HE": "Dégâts moyens infligés par grenade HE lancée.",
  "Alliés / HE": "Dégâts moyens infligés aux coéquipiers par grenade HE lancée.",
  "Inutilisés / mort": "Valeur moyenne des utilitaires encore détenus au moment de la mort.",
  "Rounds survécus": "Rounds terminés avec le joueur encore en vie.",
  Survie: "Rounds terminés en vie. Le pourcentage est calculé sur les rounds effectivement joués.",
  "Habitudes répétées": "Trajectoires similaires détectées sur plusieurs rounds comparables.",
  "Actions rejouables": "Événements disposant d’une preuve permettant d’ouvrir le replay au moment correspondant.",
};

export function DefinitionTerm({
  label,
  definition,
  className = "",
}: {
  label: string;
  definition?: string;
  className?: string;
}) {
  const explanation = definition ?? STAT_DEFINITIONS[label];
  if (!explanation) return <>{label}</>;

  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <span
            tabIndex={0}
            className={[
              "cursor-help decoration-neutral-500/70 underline decoration-dotted underline-offset-[3px] outline-none transition-colors hover:text-neutral-100 focus-visible:text-neutral-100",
              className,
            ].join(" ")}
          />
        )}
      >
        {label}
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={8}
        className="max-w-[19rem] border border-white/10 bg-[#eef2ef] px-3 py-2 text-[12px] leading-relaxed text-[#17201d] shadow-2xl"
      >
        {explanation}
      </TooltipContent>
    </Tooltip>
  );
}
