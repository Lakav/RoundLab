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
  const durationOverride = useReplay((s) => s.durationOverride);
  const round = match?.rounds[currentRoundIdx];
  const roundReady = Boolean(round?.frames.length);
  const duration = durationOverride ?? round?.duration ?? 0;
  const seekFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (!roundReady || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setTime(ratio * duration);
  };

  return (
    <div className="flex w-full items-center gap-3.5 rounded-[4px] border border-white/[0.06] bg-white/[0.03] px-3 py-1.5">
      <span className="w-11 text-right text-xs font-semibold tabular-nums text-[var(--rl-fg-muted)]">
        {fmt(time)}
      </span>
      <div
        className="flex h-8 flex-1 items-center"
        onPointerDown={seekFromPointer}
      >
        <Slider
          thumbLabel="Replay time"
          value={[time]}
          min={0}
          max={duration || 1}
          step={0.05}
          disabled={!roundReady}
          onValueChange={(v) => {
            if (!roundReady) return;
            setTime(Array.isArray(v) ? v[0] : v);
          }}
          className="flex-1 [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-track]]:h-1.5"
        />
      </div>
      <span className="w-11 text-xs font-semibold tabular-nums text-[var(--rl-fg-muted)]">
        {fmt(duration)}
      </span>
    </div>
  );
}
