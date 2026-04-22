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
  const [width, setWidth] = useState(3);
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

  return (
    <div className="h-screen flex flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-4 px-5 h-14 border-b border-white/5 shrink-0 bg-neutral-950/90 backdrop-blur">
        <Link href="/">
          <Button variant="ghost" size="icon" className="text-neutral-400 hover:text-white hover:bg-white/5">
            <ChevronLeft className="size-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <div className="text-xs uppercase tracking-widest text-neutral-500 font-semibold">
            {match.meta.map.replace("de_", "")}
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="text-sky-400">{match.meta.teamA}</span>
            <span className="tabular-nums text-neutral-400">
              {match.meta.scoreA} : {match.meta.scoreB}
            </span>
            <span className="text-amber-400">{match.meta.teamB}</span>
          </div>
        </div>
        <div className="ml-auto text-xs text-neutral-500">
          Round <span className="text-neutral-200 font-semibold">{round?.number}</span>
          <span className="text-neutral-600"> / {match.rounds.length}</span>
          {round && (
            <>
              <span className="mx-2 text-neutral-700">·</span>
              <span className={round.winner === "CT" ? "text-sky-400" : "text-amber-400"}>
                {round.winner} win
              </span>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <RoundList />

        <main className="flex-1 flex flex-col items-center justify-center gap-4 overflow-auto p-4 xl:p-6">
          <div className="flex items-center justify-center gap-4">
            <DrawingToolbar
              tool={tool}
              setTool={setTool}
              color={color}
              setColor={setColor}
              width={width}
              setWidth={setWidth}
              strokes={strokes}
              setStrokes={setStrokes}
            />

            <div
              className="relative"
              style={{ width: MAP_SIZE, height: MAP_SIZE }}
            >
              <MapRenderer size={MAP_SIZE} />
              <DrawingLayer
                size={MAP_SIZE}
                tool={tool}
                color={color}
                width={width}
                strokes={strokes}
                setStrokes={setStrokes}
              />
            </div>
          </div>

          <div
            className="w-full rounded-xl border border-white/5 bg-neutral-900/85 backdrop-blur px-4 py-3 flex flex-col gap-3 shadow-xl shadow-black/20"
            style={{ maxWidth: MAP_SIZE }}
          >
            <Timeline />
            <div className="flex items-center justify-between">
              <Controls />
              <div className="text-xs text-neutral-500 tabular-nums">
                t = {(time ?? 0).toFixed(2)}s
              </div>
            </div>
          </div>
        </main>

        <PlayerHUD />
      </div>
    </div>
  );
}
