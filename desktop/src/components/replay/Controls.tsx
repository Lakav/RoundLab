"use client";

import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
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
    <div className="flex shrink-0 items-center gap-1.5 text-neutral-500">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => skip(-5)}
        title="-5s (J)"
        className="size-7 rounded-[3px] text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-200"
      >
        <SkipBack className="size-4" />
      </Button>
      <Button
        size="icon"
        onClick={togglePlay}
        title="Play/Pause (Space)"
        className="size-8 rounded-[3px] bg-transparent text-[#6fea76] shadow-none hover:bg-white/[0.05] hover:text-[#8dff91]"
      >
        {playing ? <Pause className="size-[18px] fill-current" /> : <Play className="size-[18px] fill-current" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => skip(5)}
        title="+5s (L)"
        className="size-7 rounded-[3px] text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-200"
      >
        <SkipForward className="size-4" />
      </Button>

      <div className="ml-2 flex items-center gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={cn(
              "h-6 min-w-8 rounded-[3px] px-1.5 text-[11px] tabular-nums transition-colors",
              speed === s
                ? "bg-white text-neutral-950"
                : "text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-200"
            )}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
