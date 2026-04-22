"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useReplay } from "@/lib/replay-store";
import { MapRenderer } from "@/components/replay/MapRenderer";
import { DrawingLayer, type DrawTool, type Stroke } from "@/components/replay/DrawingLayer";
import { DrawingToolbar } from "@/components/replay/DrawingToolbar";
import { Controls } from "@/components/replay/Controls";
import { Timeline } from "@/components/replay/Timeline";
import { RoundList } from "@/components/replay/RoundList";
import { PlayerHUD } from "@/components/replay/PlayerHUD";
import { Loader2, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MatchData } from "@/lib/types";

const MAP_SIZE = 760;
const DRAW_WIDTH = 3;

function hideKnifeRound(data: MatchData): MatchData {
  // Current demos start with a knife round. This is intentionally frontend-only
  // for now so the parsed source data stays complete.
  if (data.rounds.length <= 1) return data;
  return { ...data, rounds: data.rounds.slice(1) };
}

export default function MatchViewer({ id }: { id: string }) {
  const setMatch = useReplay((s) => s.setMatch);
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const setTime = useReplay((s) => s.setTime);
  const time = useReplay((s) => s.time) ?? 0;
  const togglePlay = useReplay((s) => s.togglePlay);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [tool, setTool] = useState<DrawTool>("none");
  const [color, setColor] = useState("#ef4444");
  const [strokesByRound, setStrokesByRound] = useState<Record<number, Stroke[]>>({});
  const strokes = strokesByRound[currentRoundIdx] ?? [];
  const setStrokes = (s: Stroke[]) =>
    setStrokesByRound((m) => ({ ...m, [currentRoundIdx]: s }));

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const r = await fetch(`/api/match/${id}`);
        if (!r.ok) throw new Error("not found");
        const data: MatchData = await r.json();
        if (cancel) return;
        setMatch(hideKnifeRound(data));
        setLoading(false);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "error");
        setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id, setMatch]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const st = useReplay.getState();
      const round = st.match?.rounds[st.currentRoundIdx];
      if (!round) return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "j" || e.key === "ArrowLeft") {
        setTime(Math.max(0, (st.time ?? 0) - 5));
      } else if (e.key === "l" || e.key === "ArrowRight") {
        setTime(Math.min(round.duration, (st.time ?? 0) + 5));
      } else if (e.key === "k") {
        togglePlay();
      } else if (e.key === "v") setTool("none");
      else if (e.key === "p") setTool("pen");
      else if (e.key === "a") setTool("arrow");
      else if (e.key === "r") setTool("rect");
      else if (e.key === "e") setTool("ellipse");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, setTime]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950">
        <Loader2 className="size-6 animate-spin text-neutral-400" />
      </div>
    );
  }
  if (err || !match) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-neutral-950 text-neutral-100">
        <p className="text-red-400">Match not found.</p>
        <Link href="/">
          <Button variant="outline">Back home</Button>
        </Link>
      </div>
    );
  }

  const round = match.rounds[currentRoundIdx];
  const score = {
    a: round?.scoreA ?? 0,
    b: round?.scoreB ?? 0,
  };

  return (
    <div className="h-screen flex flex-col bg-[#060807] text-neutral-100">
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-white/[0.07] bg-[#080b0a]/95 px-5 backdrop-blur">
        <Link href="/">
          <Button variant="ghost" size="icon" className="text-neutral-500 hover:bg-white/[0.06] hover:text-white">
            <ChevronLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex size-8 items-center justify-center rounded border border-emerald-400/20 bg-emerald-400/10 text-[11px] font-black tracking-tight text-emerald-300">
            RL
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-neutral-500">
              RoundLab
            </div>
            <div className="truncate text-sm font-medium text-neutral-200">
              {match.meta.map.replace("de_", "")} review
            </div>
          </div>
          <div className="h-7 w-px bg-white/10" />
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <span className="truncate text-sky-300">{match.meta.teamA || "CT"}</span>
            <span className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-sm text-neutral-200">
              {match.meta.scoreA}:{match.meta.scoreB}
            </span>
            <span className="truncate text-amber-300">{match.meta.teamB || "T"}</span>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-5">
          <div className="hidden text-right sm:block">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-neutral-600">
              Current score
            </div>
            <div className="font-mono text-2xl font-semibold leading-none text-neutral-100">
              {score.a}:{score.b}
            </div>
          </div>
          <div className="text-right text-xs text-neutral-500">
            <div className="font-semibold uppercase tracking-[0.2em] text-neutral-600">
              Round
            </div>
            <div>
              <span className="text-neutral-200">{currentRoundIdx + 1}</span>
              <span className="text-neutral-700"> / {match.rounds.length}</span>
              {round && (
                <>
                  <span className="mx-2 text-neutral-700">·</span>
                  <span className={round.winner === "CT" ? "text-sky-300" : "text-amber-300"}>
                    {round.winner}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:28px_28px]">
        <RoundList />

        <main className="flex-1 flex flex-col items-center justify-center gap-4 overflow-auto p-4 xl:p-6">
          <div className="flex items-center justify-center gap-4">
            <DrawingToolbar
              tool={tool}
              setTool={setTool}
              color={color}
              setColor={setColor}
              strokes={strokes}
              setStrokes={setStrokes}
            />

            <div className="relative rounded-2xl border border-white/[0.08] bg-black/25 p-2 shadow-2xl shadow-black/40">
              <div
                className="relative"
                style={{ width: MAP_SIZE, height: MAP_SIZE }}
              >
                <MapRenderer size={MAP_SIZE} />
                <DrawingLayer
                  size={MAP_SIZE}
                  tool={tool}
                  color={color}
                  width={DRAW_WIDTH}
                  strokes={strokes}
                  setStrokes={setStrokes}
                />
              </div>
            </div>
          </div>

          <div
            className="w-full rounded-2xl border border-white/[0.08] bg-[#0b0f0d]/95 px-4 py-3 shadow-2xl shadow-black/30 backdrop-blur"
            style={{ maxWidth: MAP_SIZE + 16 }}
          >
            <Timeline />
            <div className="mt-3 flex items-center justify-between">
              <Controls />
              <div className="font-mono text-xs tabular-nums text-neutral-500">
                {(time ?? 0).toFixed(2)}s
              </div>
            </div>
          </div>
        </main>

        <PlayerHUD />
      </div>
    </div>
  );
}
