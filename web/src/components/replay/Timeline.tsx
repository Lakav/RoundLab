"use client";

import { useReplay } from "@/lib/replay-store";
import { Slider } from "@/components/ui/slider";

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function Timeline() {
  const time = useReplay((s) => s.time) ?? 0;
  const setTime = useReplay((s) => s.setTime);
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const round = match?.rounds[currentRoundIdx];
  const duration = round?.duration ?? 0;

  return (
    <div className="flex items-center gap-3 w-full">
      <span className="text-[11px] tabular-nums text-neutral-500 w-10 text-right font-medium">
        {fmt(time)}
      </span>
      <Slider
        value={[time]}
        min={0}
        max={duration || 1}
        step={0.05}
        onValueChange={(v) => setTime(Array.isArray(v) ? v[0] : v)}
        className="flex-1"
      />
      <span className="text-[11px] tabular-nums text-neutral-500 w-10 font-medium">
        {fmt(duration)}
      </span>
    </div>
  );
}
