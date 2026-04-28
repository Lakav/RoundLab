"use client";

import { useReplay } from "@/lib/replay-store";
import { cn } from "@/lib/utils";
import { THEME } from "@/lib/theme";

export function RoundList() {
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const setRound = useReplay((s) => s.setRound);
  if (!match) return null;

  return (
    <div className="flex w-full items-center justify-center gap-5 py-2 font-mono text-[12px] tabular-nums">
      {match.rounds.map((r, i) => {
        const active = currentRoundIdx === i;
        const winner = r.winner;
        const color =
          winner === "CT" ? THEME.ct : winner === "T" ? THEME.t : THEME.textMuted;
        return (
          <button
            key={r.number}
            onClick={() => setRound(i)}
            className={cn(
              "relative transition-opacity",
              active ? "opacity-100" : "opacity-55 hover:opacity-100"
            )}
            style={{ color }}
          >
            {String(i + 1).padStart(2, "0")}
            {active && (
              <span
                className="absolute -bottom-1 left-0 right-0 h-[2px] rounded-full"
                style={{ background: color }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
