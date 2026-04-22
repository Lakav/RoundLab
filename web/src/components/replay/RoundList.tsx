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
    <ScrollArea className="h-full w-56 shrink-0 border-r border-white/[0.07] bg-[#080b0a]/95">
      <div className="p-3">
        <div className="mb-3 px-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-neutral-600">
            Scoreline
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            Round by round
          </div>
        </div>
        <div className="space-y-1.5">
          {match.rounds.map((r, i) => {
            const active = currentRoundIdx === i;
            const scoreA = r.scoreA ?? 0;
            const scoreB = r.scoreB ?? 0;
            const ctWon = r.winner === "CT";
            const tWon = r.winner === "T";
            return (
              <button
                key={r.number}
                onClick={() => setRound(i)}
                className={cn(
                  "group w-full rounded-xl border px-3 py-2.5 text-left text-sm transition-all",
                  active
                    ? "border-emerald-400/30 bg-emerald-400/[0.08] shadow-[inset_3px_0_0_rgba(52,211,153,0.9)]"
                    : "border-white/[0.04] bg-white/[0.015] hover:border-white/[0.08] hover:bg-white/[0.04]"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-lg font-semibold tabular-nums tracking-tight text-neutral-100">
                    <span
                      className={cn(
                        "inline-block min-w-4 text-sky-500 transition-all",
                        ctWon && "scale-110 text-sky-200 drop-shadow-[0_0_8px_rgba(125,211,252,0.45)]"
                      )}
                    >
                      {scoreA}
                    </span>
                    <span className="mx-0.5 text-neutral-600">:</span>
                    <span
                      className={cn(
                        "inline-block min-w-4 text-amber-500 transition-all",
                        tWon && "scale-110 text-amber-200 drop-shadow-[0_0_8px_rgba(252,211,77,0.45)]"
                      )}
                    >
                      {scoreB}
                    </span>
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-neutral-500">
                  <span>Round {i + 1}</span>
                  <span>{Math.round(r.duration)}s</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
