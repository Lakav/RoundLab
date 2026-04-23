"use client";

import { useReplay } from "@/lib/replay-store";

export function RoundClock() {
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const time = useReplay((s) => s.time) ?? 0;
  if (!match) return null;
  const round = match.rounds[currentRoundIdx];
  if (!round) return null;

  const remain = Math.max(0, round.duration - time);
  const mm = Math.floor(remain / 60)
    .toString()
    .padStart(2, "0");
  const ss = Math.floor(remain % 60)
    .toString()
    .padStart(2, "0");

  return (
    <div
      className="pointer-events-none absolute left-1/2 top-0 z-30 h-[30px] min-w-[74px] -translate-x-1/2 rounded-[3px] border border-white/15 bg-[#171818] px-3 text-center font-mono text-[16px] leading-[29px] text-neutral-200 shadow-lg shadow-black/30 tabular-nums"
    >
      {mm}:{ss}
    </div>
  );
}
