"use client";

import { useReplay } from "@/lib/replay-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export function RoundList() {
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const setRound = useReplay((s) => s.setRound);
  if (!match) return null;

  return (
    <ScrollArea className="h-full w-24 shrink-0 border-r border-white/[0.07] bg-[#080b0a]/95">
      <div className="p-1.5">
        <div className="space-y-1">
          {match.rounds.map((r, i) => {
            const active = currentRoundIdx === i;
            const scoreA = r.scoreA ?? 0;
            const scoreB = r.scoreB ?? 0;
            const prev = match.rounds[i - 1];
            const prevA = prev?.scoreA ?? 0;
            const prevB = prev?.scoreB ?? 0;
            const aWon = scoreA > prevA;
            const bWon = scoreB > prevB;
            const winnerSide = r.winner;
            const aIsCT = (aWon && winnerSide === "CT") || (bWon && winnerSide === "T");
            const leftIsCT = aIsCT;
            return (
              <button
                key={r.number}
                onClick={() => setRound(i)}
                className={cn(
                  "group relative w-full overflow-hidden rounded-md border text-left transition-all",
                  active
                    ? "border-emerald-400/60 shadow-[inset_2px_0_0_rgba(52,211,153,0.9)]"
                    : "border-white/[0.04] hover:border-white/[0.15]"
                )}
              >
                <div
                  className={cn(
                    "flex items-stretch font-mono text-sm font-bold tabular-nums leading-none",
                    active && "ring-1 ring-emerald-400/40"
                  )}
                >
                  <div
                    className={cn(
                      "flex w-7 items-center justify-center py-1.5 transition-all",
                      leftIsCT
                        ? aWon
                          ? "bg-sky-500/85 text-white"
                          : "bg-sky-500/10 text-sky-300/50"
                        : aWon
                          ? "bg-amber-500/85 text-white"
                          : "bg-amber-500/10 text-amber-300/50"
                    )}
                  >
                    {scoreA}
                  </div>
                  <div className="flex flex-1 items-center justify-center bg-white/[0.015] px-1 text-[10px] font-medium text-neutral-500">
                    R{i + 1}
                  </div>
                  <div
                    className={cn(
                      "flex w-7 items-center justify-center py-1.5 transition-all",
                      leftIsCT
                        ? bWon
                          ? "bg-amber-500/85 text-white"
                          : "bg-amber-500/10 text-amber-300/50"
                        : bWon
                          ? "bg-sky-500/85 text-white"
                          : "bg-sky-500/10 text-sky-300/50"
                    )}
                  >
                    {scoreB}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
