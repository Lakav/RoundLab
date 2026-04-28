"use client";

import type { PointerEvent } from "react";
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
  const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setTime(ratio * duration);
  };

  return (
    <div className="flex w-full items-center gap-3.5">
      <span className="w-11 text-right text-xs font-medium tabular-nums text-neutral-500">
        {fmt(time)}
      </span>
      <div
        className="flex h-8 flex-1 items-center"
        onPointerDown={seekFromPointer}
      >
        <Slider
          value={[time]}
          min={0}
          max={duration || 1}
          step={0.05}
          onValueChange={(v) => setTime(Array.isArray(v) ? v[0] : v)}
          className="flex-1 [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-track]]:h-1.5"
        />
      </div>
      <span className="w-11 text-xs font-medium tabular-nums text-neutral-500">
        {fmt(duration)}
      </span>
    </div>
  );
}
