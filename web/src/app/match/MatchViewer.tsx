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
import { RoundClock } from "@/components/replay/RoundClock";
import { KillFeed } from "@/components/replay/KillFeed";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MatchData, Round } from "@/lib/types";
import { cropFor, RADAR_SIZE } from "@/lib/maps";
import { getMatchMetadata, getRound } from "@/lib/api";

const DRAW_WIDTH = 3;
const MIN_MAP = 360;
const MAX_MAP = 760;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function hideKnifeRound(data: MatchData): MatchData {
  if (data.rounds.length < 2) return data;
  const r0 = data.rounds[0];
  const r1 = data.rounds[1];
  const r0Total = (r0.scoreA ?? 0) + (r0.scoreB ?? 0);
  const r1Total = (r1.scoreA ?? 0) + (r1.scoreB ?? 0);
  if (r0Total !== 0 || r1Total !== 1) return data;
  return { ...data, rounds: data.rounds.slice(1) };
}

export default function MatchViewer({ id }: { id: string }) {
  const setMatch = useReplay((s) => s.setMatch);
  const setRoundData = useReplay((s) => s.setRoundData);
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const setTime = useReplay((s) => s.setTime);
  const togglePlay = useReplay((s) => s.togglePlay);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [tool, setTool] = useState<DrawTool>("none");
  const [color, setColor] = useState("#ef4444");
  const mainRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
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
      const size = Math.max(MIN_MAP, Math.min(MAX_MAP, Math.floor(Math.min(w, h) * 0.88)));
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

  const [strokesByRound, setStrokesByRound] = useState<Record<number, Stroke[]>>({});
  const strokes = strokesByRound[currentRoundIdx] ?? [];
  const setStrokes = (s: Stroke[]) =>
    setStrokesByRound((m) => ({ ...m, [currentRoundIdx]: s }));

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const data = await getMatchMetadata(id);
        if (cancel) return;
        setMatch(hideKnifeRound(data));
        setLoading(false);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [id, setMatch]);

  useEffect(() => {
    if (!match) return;
    const round = match.rounds[currentRoundIdx];
    if (!round || round.frames.length > 0) return;

    let cancel = false;
    (async () => {
      try {
        const data: Round = await getRound(id, round.number);
        if (!cancel) setRoundData(round.number, data);
      } catch (e) {
        if (!cancel) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancel = true;
    };
  }, [currentRoundIdx, id, match, setRoundData]);

  // Prefetch the two neighbouring rounds in the background so switching
  // rounds feels instantaneous. The Rust side caches the decoded match
  // across calls, so these fetches are cheap — they mostly re-serialize
  // the round payload for transit.
  useEffect(() => {
    if (!match) return;
    const neighbours = [currentRoundIdx - 1, currentRoundIdx + 1];
    let cancel = false;
    (async () => {
      for (const idx of neighbours) {
        if (cancel) return;
        const r = match.rounds[idx];
        if (!r || r.frames.length > 0) continue;
        try {
          const data: Round = await getRound(id, r.number);
          if (cancel) return;
          setRoundData(r.number, data);
        } catch {
          // Silent: prefetch is best-effort. The main effect will retry
          // if the user actually navigates there.
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [currentRoundIdx, id, match, setRoundData]);

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

  const crop = cropFor(match.meta.map);
  const cropScale = RADAR_SIZE / crop.size;
  const innerSize = mapSize * cropScale;
  const cropTx = -crop.x * (mapSize / crop.size);
  const cropTy = -crop.y * (mapSize / crop.size);

  return (
    <div className="h-screen flex flex-col text-neutral-100" style={{ background: "#1d1f1f" }}>
      <main className="relative flex min-h-0 flex-1 flex-col overflow-visible">
        <PlayerHUD side="CT" />
        <PlayerHUD side="T" />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <RoundClock />
          <KillFeed />
          <div ref={mainRef} className="flex min-h-0 flex-1 items-center justify-center px-[290px] pb-4 pt-6">
            <div
              className="relative overflow-hidden opacity-90"
              onWheel={(e) => {
                if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const cx = e.clientX - rect.left - rect.width / 2;
                  const cy = e.clientY - rect.top - rect.height / 2;
                  const delta = -e.deltaY * 0.0015;
                  const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta * zoom));
                  if (nz === zoom) return;
                  const ratio = nz / zoom;
                  const nx = cx - (cx - pan.x) * ratio;
                  const ny = cy - (cy - pan.y) * ratio;
                  const max = (mapSize * (nz - 1)) / 2;
                  setZoom(nz);
                  setPan({
                    x: Math.max(-max, Math.min(max, nx)),
                    y: Math.max(-max, Math.min(max, ny)),
                  });
                }
              }}
              onPointerDown={(e) => {
                if (tool !== "none") return;
                if (zoom <= 1) return;
                panState.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
                setPanning(true);
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
                setPanning(false);
              }}
              onPointerCancel={() => {
                panState.current.dragging = false;
                setPanning(false);
              }}
              style={{
                cursor: zoom > 1 && tool === "none" ? (panning ? "grabbing" : "grab") : undefined,
              }}
            >
              <div
                style={{
                  width: mapSize,
                  height: mapSize,
                  overflow: "hidden",
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transformOrigin: "center center",
                  transition: panning ? "none" : "transform 80ms linear",
                }}
              >
                <div
                  className="relative"
                  style={{
                    width: innerSize,
                    height: innerSize,
                    transform: `translate(${cropTx}px, ${cropTy}px)`,
                  }}
                >
                  <MapRenderer size={innerSize} />
                  <DrawingLayer
                    size={innerSize}
                    tool={tool}
                    color={color}
                    width={DRAW_WIDTH}
                    strokes={strokes}
                    setStrokes={setStrokes}
                  />
                </div>
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
          </div>
        </div>

        <div className="shrink-0 border-t border-dashed border-white/10 bg-[#121414] px-5 pb-3 pt-1">
          <RoundList />
          <div className="flex items-center gap-3">
          <Controls />
          <div className="min-w-0 flex-1">
            <Timeline />
          </div>
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
      </main>
    </div>
  );
}
