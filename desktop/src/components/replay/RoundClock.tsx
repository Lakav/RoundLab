"use client";

import { useReplay } from "@/lib/replay-store";
import type { Round } from "@/lib/types";

const DEFAULT_ROUND_SECONDS = 115;
const DEFAULT_BOMB_SECONDS = 40;

function firstEventTime(round: Round, type: string): number | null {
  const event = round.events.find((e) => e.type === type);
  return event ? event.t : null;
}

function clockRemaining(round: Round, time: number): number {
  const plantedAt = firstEventTime(round, "bomb_planted");
  const defusedAt = firstEventTime(round, "bomb_defused");
  const explodedAt = firstEventTime(round, "bomb_exploded");
  const roundEndAt = firstEventTime(round, "round_end");
  const bombResolvedAt = defusedAt ?? explodedAt ?? roundEndAt;

  if (roundEndAt !== null && time >= roundEndAt) {
    return Math.max(0, round.duration - time);
  }
  if (bombResolvedAt !== null && time >= bombResolvedAt) {
    return Math.max(0, round.duration - time);
  }
  if (plantedAt !== null && time >= plantedAt) {
    return Math.max(0, plantedAt + DEFAULT_BOMB_SECONDS - time);
  }

  return Math.max(0, DEFAULT_ROUND_SECONDS - time);
}

export function RoundClock() {
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const time = useReplay((s) => s.time) ?? 0;
  if (!match) return null;
  const round = match.rounds[currentRoundIdx];
  if (!round) return null;

  const remain = clockRemaining(round, time);
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
