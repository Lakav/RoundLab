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
  const durationOverride = useReplay((s) => s.durationOverride);
  const round = match?.rounds[currentRoundIdx];
  const roundReady = Boolean(round?.frames.length);

  const skip = (dt: number) => {
    if (!round || !roundReady) return;
    setTime(Math.max(0, Math.min(durationOverride ?? round.duration, time + dt)));
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5 rounded-[4px] border border-white/[0.06] bg-white/[0.03] px-1.5 py-1 text-neutral-400">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => skip(-5)}
        disabled={!roundReady}
        title={roundReady ? "-5s (J)" : "Loading round..."}
        className="size-7 rounded-[3px] text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-40"
      >
        <SkipBack className="size-4" />
      </Button>
      <Button
        size="icon"
        onClick={togglePlay}
        disabled={!roundReady}
        title={roundReady ? "Play/Pause (Space)" : "Loading round..."}
        className="size-8 rounded-[3px] bg-[#6fea76]/12 text-[#6fea76] shadow-none hover:bg-[#6fea76]/18 hover:text-[#8dff91] disabled:pointer-events-none disabled:opacity-40"
      >
        {playing ? <Pause className="size-[18px] fill-current" /> : <Play className="size-[18px] fill-current" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => skip(5)}
        disabled={!roundReady}
        title={roundReady ? "+5s (L)" : "Loading round..."}
        className="size-7 rounded-[3px] text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-40"
      >
        <SkipForward className="size-4" />
      </Button>

      <div className="ml-1 flex items-center gap-1 border-l border-white/10 pl-2">
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Playback speed ${s} ${s === 1 ? "time" : "times"}`}
            aria-pressed={speed === s}
            onClick={() => setSpeed(s)}
            disabled={!roundReady}
            className={cn(
              "h-6 min-w-8 rounded-[3px] px-1.5 text-[11px] font-semibold tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-40",
              speed === s
                ? "bg-white text-neutral-950"
                : "text-neutral-300 hover:bg-white/[0.05] hover:text-white"
            )}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
