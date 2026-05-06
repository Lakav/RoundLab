"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
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
import { Home, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MatchData, Round } from "@/lib/types";
import { cropFor, MAP_CALIBRATION, RADAR_SIZE } from "@/lib/maps";
import { getMatchMetadata, getRound } from "@/lib/api";
import { invoke } from "@tauri-apps/api/core";

const DRAW_WIDTH = 3;
const MIN_MAP = 360;
const MAX_MAP = 760;

function hideKnifeRound(data: MatchData): MatchData {
  if (data.rounds.length < 2) return data;
  const r0 = data.rounds[0];
  const r0Total = (r0.scoreA ?? 0) + (r0.scoreB ?? 0);
  const weaponNames = [
    ...r0.events.map((e) => e.weapon ?? ""),
    ...r0.frames.flatMap((f) =>
      f.players.flatMap((p) => [p.active ?? "", ...(p.weapons ?? [])]),
    ),
  ].filter(Boolean);
  const hasGun = weaponNames.some((w) => !/knife|bayonet|karambit|c4/i.test(w));
  const looksLikeKnifeRound = r0Total === 0 && r0.duration <= 75 && !hasGun;
  if (!looksLikeKnifeRound) return data;
  return { ...data, rounds: data.rounds.slice(1) };
}

function assertRenderableRound(round: Round): Round {
  if (round.frames.length === 0) {
    throw new Error(`Round ${round.number} has no frame data.`);
  }
  return round;
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
  const loadingRoundsRef = useRef<Set<number>>(new Set());
  const [mapSize, setMapSize] = useState(600);

  useEffect(() => {
    document.documentElement.classList.add("overflow-hidden");
    document.body.classList.add("overflow-hidden");
    return () => {
      document.documentElement.classList.remove("overflow-hidden");
      document.body.classList.remove("overflow-hidden");
    };
  }, []);

  useEffect(() => {
    if (loading || !match) return;
    let cancelled = false;
    (async () => {
      try {
        if (cancelled) return;
        await invoke("enter_match_fullscreen");
      } catch (error) {
        console.warn("Could not enter fullscreen", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, match]);

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

  const loadRoundData = useCallback(
    async (roundNumber: number) => {
      if (loadingRoundsRef.current.has(roundNumber)) return;
      loadingRoundsRef.current.add(roundNumber);
      try {
        const data = assertRenderableRound(await getRound(id, roundNumber));
        startTransition(() => setRoundData(id, roundNumber, data));
      } catch (e) {
        throw e;
      } finally {
        loadingRoundsRef.current.delete(roundNumber);
      }
    },
    [id, setRoundData],
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const data = await getMatchMetadata(id);
        if (cancel) return;
        const visibleData = hideKnifeRound(data);
        if (visibleData.rounds.length === 0) {
          throw new Error("This demo parsed successfully, but no playable rounds were found.");
        }
        if (!MAP_CALIBRATION[visibleData.meta.map]) {
          throw new Error(`Unsupported map "${visibleData.meta.map || "unknown"}".`);
        }
        startTransition(() => setMatch(id, visibleData));
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
        await loadRoundData(round.number);
      } catch (e) {
        if (!cancel) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancel = true;
    };
  }, [currentRoundIdx, loadRoundData, match]);

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
          await loadRoundData(r.number);
        } catch {
          // Silent: prefetch is best-effort. The main effect will retry
          // if the user actually navigates there.
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [currentRoundIdx, loadRoundData, match]);

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
        <p className="max-w-md text-center text-sm text-red-400">
          {err ?? "Match not found."}
        </p>
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
      <Link href="/" className="fixed left-4 top-4 z-50">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 border border-white/10 bg-black/40 px-2.5 text-[11px] font-semibold text-neutral-300 hover:bg-black/60 hover:text-neutral-100"
        >
          <Home className="size-3.5" />
          Home
        </Button>
      </Link>
      <main className="relative flex min-h-0 flex-1 flex-col overflow-visible">
        <PlayerHUD side="CT" />
        <PlayerHUD side="T" />

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <RoundClock />
          <KillFeed />
          <div ref={mainRef} className="flex min-h-0 flex-1 items-center justify-center px-[290px] pb-4 pt-6">
            <div
              className="relative overflow-hidden opacity-90"
              style={{
                width: mapSize,
                height: mapSize,
              }}
            >
              <div
                style={{
                  width: mapSize,
                  height: mapSize,
                  overflow: "hidden",
                  contain: "strict",
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
