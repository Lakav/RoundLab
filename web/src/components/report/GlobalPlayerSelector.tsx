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
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200/10 bg-emerald-200/[0.035] px-3 py-2">
      <div>
        <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-300/70">
          Joueur analysé
        </div>
        <div className="mt-0.5 text-xs text-neutral-500">
          Ce choix reste actif dans toutes les sections du rapport.
        </div>
      </div>
      <select
        aria-label="Joueur analysé dans toutes les statistiques"
        value={selectedPlayerId}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-44 rounded-md border border-white/10 bg-[#121515] px-3 text-sm font-semibold text-neutral-100"
      >
        {players.map((player) => (
          <option key={player.playerId} value={player.playerId}>{player.name}</option>
        ))}
      </select>
    </div>
  );
}
