"use client";

import { useEffect, useRef, useState } from "react";
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

const DRAW_WIDTH = 3;
const MIN_MAP = 360;
const MAX_MAP = 2000;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

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
  const mainRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panState = useRef({ dragging: false, lastX: 0, lastY: 0 });

  useEffect(() => {
    if (loading) return;
    const el = mainRef.current;
    if (!el) return;
    let raf = 0;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const size = Math.max(MIN_MAP, Math.min(MAX_MAP, Math.floor(Math.min(w, h))));
      setMapSize(size);
    };
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    });
    ro.observe(el);
    compute();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [loading]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [zoom, mapSize]);
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
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#080b0a]/95 px-2 text-[11px] backdrop-blur">
        <Link href="/" className="text-neutral-500 hover:text-white">
          <ChevronLeft className="size-4" />
        </Link>
        <span className="text-[10px] font-black tracking-tight text-emerald-300">RL</span>
        <span className="truncate font-medium text-neutral-300">
          {match.meta.map.replace("de_", "")}
        </span>
        <span className="h-4 w-px bg-white/10" />
        <span className="truncate text-sky-300">{match.meta.teamA || "CT"}</span>
        <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 font-mono text-neutral-200">
          {match.meta.scoreA}:{match.meta.scoreB}
        </span>
        <span className="truncate text-amber-300">{match.meta.teamB || "T"}</span>
        <div className="ml-auto flex items-center gap-2 text-neutral-500">
          <span className="font-mono text-sm text-neutral-200">{score.a}:{score.b}</span>
          <span className="text-neutral-700">·</span>
          <span>R{currentRoundIdx + 1}/{match.rounds.length}</span>
          {round && (
            <span className={round.winner === "CT" ? "text-sky-300" : "text-amber-300"}>
              {round.winner}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 flex min-h-0 overflow-hidden bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:28px_28px]">
        <RoundList />

        <main
          ref={mainRef}
          className="relative flex-1 flex min-h-0 items-center justify-center overflow-hidden"
        >
          <div className="pointer-events-none absolute left-2 top-1/2 z-20 -translate-y-1/2">
            <div className="pointer-events-auto">
              <DrawingToolbar
                tool={tool}
                setTool={setTool}
                color={color}
                setColor={setColor}
                strokes={strokes}
                setStrokes={setStrokes}
              />
            </div>
          </div>

            <div
              className="relative overflow-hidden bg-black/25"
              onWheel={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  const delta = -e.deltaY * 0.0015;
                  setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta * z)));
                }
              }}
              onPointerDown={(e) => {
                if (tool !== "none") return;
                if (zoom <= 1) return;
                panState.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
                (e.target as Element).setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!panState.current.dragging) return;
                const dx = e.clientX - panState.current.lastX;
                const dy = e.clientY - panState.current.lastY;
                panState.current.lastX = e.clientX;
                panState.current.lastY = e.clientY;
                const max = (mapSize * (zoom - 1)) / 2;
                setPan((p) => ({
                  x: Math.max(-max, Math.min(max, p.x + dx)),
                  y: Math.max(-max, Math.min(max, p.y + dy)),
                }));
              }}
              onPointerUp={() => {
                panState.current.dragging = false;
              }}
              onPointerCancel={() => {
                panState.current.dragging = false;
              }}
              style={{
                cursor: zoom > 1 && tool === "none" ? (panState.current.dragging ? "grabbing" : "grab") : undefined,
              }}
            >
              <div
                className="relative"
                style={{
                  width: mapSize,
                  height: mapSize,
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: panState.current.dragging ? "none" : "transform 80ms linear",
                }}
              >
                <MapRenderer size={mapSize} />
                <DrawingLayer
                  size={mapSize}
                  tool={tool}
                  color={color}
                  width={DRAW_WIDTH}
                  strokes={strokes}
                  setStrokes={setStrokes}
                />
              </div>
              {zoom > 1 && (
                <button
                  onClick={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                  className="absolute right-3 top-3 rounded-md border border-white/10 bg-black/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-300 hover:bg-black/80"
                >
                  Reset · {zoom.toFixed(1)}x
                </button>
              )}
            </div>

          <div
            className="pointer-events-none absolute bottom-2 left-1/2 z-20 w-full -translate-x-1/2 px-14"
            style={{ maxWidth: Math.min(mapSize + 120, 1400) }}
          >
            <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-white/[0.08] bg-[#0b0f0d]/92 px-2 py-0.5 shadow-xl shadow-black/40 backdrop-blur">
              <Controls />
              <div className="min-w-0 flex-1">
                <Timeline />
              </div>
              <div className="shrink-0 font-mono text-[11px] tabular-nums text-neutral-500">
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
