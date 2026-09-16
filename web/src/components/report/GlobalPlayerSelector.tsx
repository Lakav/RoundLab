import { DefinitionTerm } from "@/components/ui/definition-term";
import type { PlayerAnalysis } from "@/lib/analysis/types";

export function GlobalPlayerSelector({
  players,
  selectedPlayerId,
  onChange,
}: {
  players: PlayerAnalysis[];
  selectedPlayerId: string;
  onChange: (playerId: string) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <span className="text-[13px] font-semibold text-[var(--rl-fg-muted)]">
        <DefinitionTerm
          label="Joueur"
          definition="Le joueur choisi ici reste sélectionné dans toutes les sections du rapport."
        />
      </span>
      <select
        aria-label="Joueur analysé dans toutes les statistiques"
        value={selectedPlayerId}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-44 rounded-md border border-[var(--rl-border)] bg-[#121515] px-3 text-sm font-semibold text-[var(--rl-fg)]"
      >
        {players.map((player) => (
          <option key={player.playerId} value={player.playerId}>{player.name}</option>
        ))}
      </select>
    </div>
  );
}
