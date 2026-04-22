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
    <ScrollArea className="h-full w-52 shrink-0 border-r border-white/5 bg-neutral-950">
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-widest text-neutral-500 font-semibold mb-2 px-1">
          Rounds
        </div>
        <div className="space-y-1">
          {match.rounds.map((r, i) => {
            const kills = r.events.filter((e) => e.type === "kill").length;
            const active = currentRoundIdx === i;
            return (
              <button
                key={r.number}
                onClick={() => setRound(i)}
                className={cn(
                  "w-full text-left rounded-lg px-3 py-2 text-sm transition-all",
                  "border border-transparent",
                  active
                    ? "bg-white/10 border-white/10"
                    : "hover:bg-white/[0.04] hover:border-white/5"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold tabular-nums">
                    <span className="text-neutral-500 mr-1">#</span>
                    {r.number}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded",
                      r.winner === "CT"
                        ? "bg-sky-500/15 text-sky-400"
                        : "bg-amber-500/15 text-amber-400"
                    )}
                  >
                    {r.winner}
                  </span>
                </div>
                <div className="text-[11px] text-neutral-500 mt-0.5">
                  {kills} kills · {Math.round(r.duration)}s
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
