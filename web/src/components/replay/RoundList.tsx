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
    <div className="w-full overflow-x-auto overflow-y-hidden py-2 [scrollbar-width:thin]">
      <div className="flex min-w-max items-center justify-start gap-1.5 px-1 font-mono text-[12px] tabular-nums">
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
              "relative flex h-6 min-w-9 items-center justify-center rounded-[3px] border px-2 font-semibold transition-colors",
              active
                ? "border-white/15 bg-white/[0.08] opacity-100"
                : "border-transparent opacity-55 hover:border-white/[0.08] hover:bg-white/[0.04] hover:opacity-100"
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
    </div>
  );
}
