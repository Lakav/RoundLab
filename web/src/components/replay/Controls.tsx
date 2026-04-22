"use client";

import { Play, Pause, Rewind, FastForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReplay } from "@/lib/replay-store";
import { cn } from "@/lib/utils";

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export function Controls() {
  const playing = useReplay((s) => s.playing);
  const speed = useReplay((s) => s.speed);
  const togglePlay = useReplay((s) => s.togglePlay);
  const setSpeed = useReplay((s) => s.setSpeed);
  const setTime = useReplay((s) => s.setTime);
  const time = useReplay((s) => s.time) ?? 0;
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const match = useReplay((s) => s.match);
  const round = match?.rounds[currentRoundIdx];

  const skip = (dt: number) => {
    if (!round) return;
    setTime(Math.max(0, Math.min(round.duration, time + dt)));
  };

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => skip(-5)}
        title="-5s (J)"
        className="text-neutral-400 hover:text-white hover:bg-white/5 size-8"
      >
        <Rewind className="size-4" />
      </Button>
      <Button
        size="icon"
        onClick={togglePlay}
        title="Play/Pause (Space)"
        className="bg-white text-neutral-950 hover:bg-neutral-200 size-9 rounded-full"
      >
        {playing ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => skip(5)}
        title="+5s (L)"
        className="text-neutral-400 hover:text-white hover:bg-white/5 size-8"
      >
        <FastForward className="size-4" />
      </Button>

      <div className="h-5 w-px bg-white/10 mx-2" />

      <div className="flex items-center gap-0.5 bg-white/5 rounded-md p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={cn(
              "px-2 h-6 text-[11px] font-semibold tabular-nums rounded transition-colors",
              speed === s
                ? "bg-white text-neutral-950"
                : "text-neutral-400 hover:text-white"
            )}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
