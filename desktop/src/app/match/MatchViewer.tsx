"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { type HabitOverlay, type HabitReplayEffect, type HabitReplayRound, useReplay } from "@/lib/replay-store";
import { MapRenderer } from "@/components/replay/MapRenderer";
import { DrawingLayer, type DrawTool, type Stroke } from "@/components/replay/DrawingLayer";
import { DrawingToolbar } from "@/components/replay/DrawingToolbar";
import { Controls } from "@/components/replay/Controls";
import { Timeline } from "@/components/replay/Timeline";
import { RoundList } from "@/components/replay/RoundList";
import { PlayerHUD } from "@/components/replay/PlayerHUD";
import { RoundClock } from "@/components/replay/RoundClock";
import { KillFeed } from "@/components/replay/KillFeed";
import { ReplayAccessibilitySummary } from "@/components/replay/ReplayAccessibilitySummary";
import { Loader2, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MatchData, PlayerPos, Round, UtilityEffect } from "@/lib/types";
import { cropFor, MAP_CALIBRATION, MAP_VERTICAL_SECTIONS, RADAR_SIZE, type RadarLayer } from "@/lib/maps";
import { enterMatchFullscreen, exitMatchFullscreen, getMatchMetadata, getRound, writeDebugLog } from "@/lib/api";
import { assetPath } from "@/lib/paths";

const DRAW_WIDTH = 3;
const BASE_MAP_VIEW_SCALE = 1;
const MIN_MAP = 280;
const MAX_MAP = 860;
const MIN_MAP_ZOOM = 1;
const MAX_MAP_ZOOM = 2.6;
const MAP_ZOOM_STEP = 0.25;
const PROJECTILE_DEBUG_KEY = "roundlab.debugProjectiles";

type HabitProjectileKind = "smoke" | "flash" | "he" | "fire" | "decoy";
type ReviewMode = "classic" | "condensed";
type RadarLayerMode = RadarLayer | "auto";

const DEFAULT_HABIT_TYPES: Record<HabitProjectileKind, boolean> = {
  smoke: true,
  flash: true,
  he: true,
  fire: true,
  decoy: true,
};

function assertRenderableRound(round: Round): Round {
  if (round.frames.length === 0) {
    throw new Error(`Round ${round.number} has no frame data.`);
  }
  return round;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function clampMapPan(pan: { x: number; y: number }, zoom: number, size: number) {
  const max = Math.max(0, (size * (zoom - 1)) / 2);
  return {
    x: clamp(pan.x, -max, max),
    y: clamp(pan.y, -max, max),
  };
}

function projectileDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.localStorage.getItem(PROJECTILE_DEBUG_KEY) === "1" ||
    String((window as Window & { ROUNDLAB_DEBUG_PROJECTILES?: unknown }).ROUNDLAB_DEBUG_PROJECTILES ?? "") === "1"
  );
}

function logFrontendRoundReceived(matchId: string, round: Round): void {
  if (!projectileDebugEnabled()) return;
  const projectileFrames = round.projectileFrames ?? [];
  const framesWithProjectiles = round.frames.filter((frame) => (frame.projectiles?.length ?? 0) > 0).length;
  const frameProjectiles = round.frames.reduce((total, frame) => total + (frame.projectiles?.length ?? 0), 0);
  const projectileFrameProjectiles = projectileFrames.reduce(
    (total, frame) => total + (frame.projectiles?.length ?? 0),
    0,
  );
  void writeDebugLog(
    "projectiles",
    `ROUNDLAB_DEBUG_PROJECTILES frontend-round-received ${JSON.stringify({
      matchId,
      roundNumber: round.number,
      frames: round.frames.length,
      framesWithProjectiles,
      frameProjectiles,
      projectileFrames: projectileFrames.length,
      projectileFrameProjectiles,
      effects: round.effects?.length ?? 0,
    })}`,
  ).catch(() => {});
}

function projectileSamplesForHabits(round: Round) {
  return round.projectileFrames?.length ? round.projectileFrames : round.frames;
}

function habitProjectileKind(type: string): HabitProjectileKind | null {
  const lower = type.toLowerCase();
  if (lower.includes("smoke")) return "smoke";
  if (lower.includes("molotov") || lower.includes("incendiary") || lower.includes("incgrenade") || lower.includes("inferno")) return "fire";
  if (lower.includes("decoy")) return "decoy";
  if (lower.includes("flash")) return "flash";
  if (lower.startsWith("he") || lower.includes("hegrenade") || lower.includes("high explosive")) return "he";
  return null;
}

function simplifyTimedHabitPoints<T extends { x: number; y: number; z: number }>(points: T[], minDistance = 28): T[] {
  if (points.length <= 2) return points;
  const out = [points[0]];
  for (const point of points.slice(1, -1)) {
    const last = out[out.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z) >= minDistance) out.push(point);
  }
  const final = points[points.length - 1];
  if (out[out.length - 1] !== final) out.push(final);
  return out;
}

function playerAtOrBefore(round: Round, playerId: number, time: number): PlayerPos | null {
  for (let i = round.frames.length - 1; i >= 0; i--) {
    const frame = round.frames[i];
    if (frame.t > time) continue;
    const player = frame.players.find((candidate) => candidate.id === playerId);
    if (player) return player;
  }
  return null;
}

function effectKind(effect: UtilityEffect): HabitProjectileKind | null {
  if (effect.type === "smoke" || effect.type === "flash" || effect.type === "he" || effect.type === "fire" || effect.type === "decoy") {
    return effect.type;
  }
  return null;
}

function habitEffectMatchRadius(kind: HabitProjectileKind): number {
  if (kind === "he") return 1500;
  if (kind === "flash") return 1100;
  return 950;
}

function buildHabitReplayRound(
  round: Round,
  playerId: number,
  playerName: string,
  enabledTypes: Record<HabitProjectileKind, boolean>,
): HabitReplayRound | null {
  const positions = simplifyTimedHabitPoints(
    round.frames
      .map((frame) => {
        const player = frame.players.find((candidate) => candidate.id === playerId);
        return player
          ? {
              t: frame.t,
              x: player.x,
              y: player.y,
              z: player.z,
              yaw: player.yaw,
              hp: player.hp,
              team: player.team,
            }
          : null;
      })
      .filter((sample): sample is HabitReplayRound["positions"][number] => Boolean(sample)),
    22,
  );

  if (!positions.length) return null;

  const allTracks = new Map<
    number,
    { type: string; thrower?: number; samples: Array<{ t: number; x: number; y: number; z: number }> }
  >();
  for (const frame of projectileSamplesForHabits(round)) {
    for (const projectile of frame.projectiles ?? []) {
      const kind = habitProjectileKind(projectile.type);
      if (!kind || !enabledTypes[kind]) continue;
      const track = allTracks.get(projectile.id) ?? { type: projectile.type, thrower: projectile.thrower, samples: [] };
      track.samples.push({ t: frame.t, x: projectile.x, y: projectile.y, z: projectile.z });
      allTracks.set(projectile.id, track);
    }
  }

  const usableTracks = [...allTracks.entries()]
    .map(([projectileId, track]) => ({
      id: `${round.number}:${projectileId}`,
      roundNumber: round.number,
      projectileId,
      type: track.type,
      thrower: track.thrower,
      samples: track.samples,
    }))
    .filter((track) => track.samples.length >= 2);
  const projectiles = usableTracks.filter((track) => track.thrower === playerId);

  const effects: HabitReplayEffect[] = [];
  for (const effect of round.effects ?? []) {
    const kind = effectKind(effect);
    if (!kind || !enabledTypes[kind]) continue;
    const radius = habitEffectMatchRadius(kind);
    const radius2 = radius * radius;
    let bestDistance = Infinity;
    let bestThrower: number | undefined;
    for (const track of usableTracks) {
      if (habitProjectileKind(track.type) !== kind) continue;
      for (let i = track.samples.length - 1; i >= 0; i--) {
        const sample = track.samples[i];
        if (sample.t > effect.start + 0.25) continue;
        if (sample.t < effect.start - 1.65) break;
        const dx = sample.x - effect.x;
        const dy = sample.y - effect.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          bestThrower = track.thrower;
        }
      }
    }
    if (bestDistance <= radius2 && bestThrower === playerId) effects.push(effect);
  }

  const deathEvent = round.events.find((event) => event.type === "kill" && event.victim === playerId);
  const deathPosition = deathEvent ? playerAtOrBefore(round, playerId, deathEvent.t) : null;

  return {
    id: `${round.number}:${playerId}`,
    roundNumber: round.number,
    playerId,
    playerName,
    positions,
    death: deathEvent && deathPosition
      ? { t: deathEvent.t, x: deathPosition.x, y: deathPosition.y, z: deathPosition.z }
      : undefined,
    projectiles,
    effects,
  };
}

export default function MatchViewer({ id, visualTest = false }: { id: string; visualTest?: boolean }) {
  const setMatch = useReplay((s) => s.setMatch);
  const setRoundData = useReplay((s) => s.setRoundData);
  const storedMatch = useReplay((s) => s.match);
  const storedMatchId = useReplay((s) => s.matchId);
  const match = storedMatchId === id ? storedMatch : null;
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const setTime = useReplay((s) => s.setTime);
  const setPlaying = useReplay((s) => s.setPlaying);
  const setSpeed = useReplay((s) => s.setSpeed);
  const setDurationOverride = useReplay((s) => s.setDurationOverride);
  const togglePlay = useReplay((s) => s.togglePlay);
  const habitOverlay = useReplay((s) => s.habitOverlay);
  const setHabitOverlay = useReplay((s) => s.setHabitOverlay);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("classic");
  const [condensedPlayerValue, setCondensedPlayerValue] = useState("");
  const [habitLoading, setHabitLoading] = useState(false);
  const [habitStatus, setHabitStatus] = useState("");

  const [tool, setTool] = useState<DrawTool>("none");
  const [color, setColor] = useState("#ef4444");
  const mainRef = useRef<HTMLDivElement>(null);
  const matchRef = useRef<MatchData | null>(null);
  const roundLoadPromisesRef = useRef<Map<number, Promise<Round>>>(new Map());
  const habitRunRef = useRef(0);
  const [mapSize, setMapSize] = useState(600);
  const [mapZoom, setMapZoom] = useState(1);
  const [radarLayerMode, setRadarLayerMode] = useState<RadarLayerMode>("auto");
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 });
  const [mapDrag, setMapDrag] = useState<{ pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("overflow-hidden");
    document.body.classList.add("overflow-hidden");
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    onFullscreenChange();
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.documentElement.classList.remove("overflow-hidden");
      document.body.classList.remove("overflow-hidden");
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  useEffect(() => {
    if (loading) return;
    const el = mainRef.current;
    if (!el) return;
    let raf = 0;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const styles = window.getComputedStyle(el);
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      const usableWidth = Math.max(0, rect.width - horizontalPadding);
      const usableHeight = Math.max(0, rect.height - verticalPadding);
      const available = Math.min(usableWidth, usableHeight);
      const scaled = available * BASE_MAP_VIEW_SCALE;
      const size = Math.floor(available <= MIN_MAP ? available : Math.min(MAX_MAP, Math.max(MIN_MAP, scaled)));
      setMapSize(size);
      setMapPan((current) => clampMapPan(current, mapZoom, size));
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
  }, [loading, mapZoom]);

  const [strokesByRound, setStrokesByRound] = useState<Record<number, Stroke[]>>({});
  const strokes = strokesByRound[currentRoundIdx] ?? [];
  const setStrokes = (s: Stroke[]) =>
    setStrokesByRound((m) => ({ ...m, [currentRoundIdx]: s }));

  const setClampedZoom = useCallback((nextZoom: number) => {
    const next = clamp(nextZoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
    setMapZoom(next);
    setMapPan((current) => clampMapPan(current, next, mapSize));
  }, [mapSize]);

  const toggleFullscreen = useCallback(() => {
    const action = document.fullscreenElement ? exitMatchFullscreen : enterMatchFullscreen;
    void action()
      .catch(() => {
        /* Browser fullscreen can be denied if the browser blocks the gesture. */
      })
      .finally(() => setIsFullscreen(Boolean(document.fullscreenElement)));
  }, []);

  const startMapPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== "none" || mapZoom <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setMapDrag({
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: mapPan.x,
      startPanY: mapPan.y,
    });
  };

  const moveMapPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!mapDrag || mapDrag.pointerId !== event.pointerId) return;
    setMapPan(
      clampMapPan(
        {
          x: mapDrag.startPanX + event.clientX - mapDrag.startX,
          y: mapDrag.startPanY + event.clientY - mapDrag.startY,
        },
        mapZoom,
        mapSize,
      ),
    );
  };

  const endMapPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!mapDrag || mapDrag.pointerId !== event.pointerId) return;
    setMapDrag(null);
  };

  const fetchRoundData = useCallback(
    (roundNumber: number): Promise<Round> => {
      const existing = roundLoadPromisesRef.current.get(roundNumber);
      if (existing) return existing;
      const promise = (async () => {
        const debugProjectiles = projectileDebugEnabled();
        const data = assertRenderableRound(await getRound(id, roundNumber, debugProjectiles));
        logFrontendRoundReceived(id, data);
        startTransition(() => setRoundData(id, roundNumber, data));
        return data;
      })().finally(() => {
        roundLoadPromisesRef.current.delete(roundNumber);
      });
      roundLoadPromisesRef.current.set(roundNumber, promise);
      return promise;
    },
    [id, setRoundData],
  );

  const loadRoundData = useCallback(
    async (roundNumber: number) => {
      await fetchRoundData(roundNumber);
    },
    [fetchRoundData],
  );

  const loadRoundForHabits = useCallback(
    async (round: Round): Promise<Round> => {
      if (round.frames.length > 0) return round;
      // Condensed analysis visits the whole match, but only needs each full
      // round while its lightweight overlay is being built. Keeping those
      // payloads in Zustand made long matches permanently accumulate hundreds
      // of megabytes. Fetch them transiently and let them be collected after
      // each iteration instead.
      const debugProjectiles = projectileDebugEnabled();
      const data = assertRenderableRound(await getRound(id, round.number, debugProjectiles));
      logFrontendRoundReceived(id, data);
      return data;
    },
    [id],
  );

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const data = await getMatchMetadata(id);
        if (cancel) return;
        const visibleData = data;
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

  useEffect(() => {
    if (!visualTest || loading || !match) return;
    setTime(0);
    setSpeed(1);
    setPlaying(true);
    void writeDebugLog(
      "diagnostic",
      `ROUNDLAB_DIAGNOSTIC visual-test-started ${JSON.stringify({
        matchId: id,
        rounds: match.rounds.length,
        map: match.meta.map,
      })}`,
    ).catch(() => {});
  }, [id, loading, match, setPlaying, setSpeed, setTime, visualTest]);

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
      if (!round || round.frames.length === 0) return;
      const duration = st.durationOverride ?? round.duration;
      const drawingShortcutsEnabled = reviewMode !== "condensed";
      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if ((e.altKey && e.key === "j") || e.key === "ArrowLeft") {
        setTime(Math.max(0, (st.time ?? 0) - 5));
      } else if ((e.altKey && e.key === "l") || e.key === "ArrowRight") {
        setTime(Math.min(duration, (st.time ?? 0) + 5));
      } else if (e.altKey && e.key === "k") {
        togglePlay();
      } else if (drawingShortcutsEnabled && e.altKey && e.key === "v") setTool("none");
      else if (drawingShortcutsEnabled && e.altKey && e.key === "p") setTool("pen");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewMode, togglePlay, setTime]);

  const invalidateHabitRun = useCallback(() => {
    habitRunRef.current += 1;
    setHabitOverlay(null);
    setDurationOverride(null);
  }, [setDurationOverride, setHabitOverlay]);

  const clearHabitOverlay = useCallback(() => {
    invalidateHabitRun();
    setHabitStatus("");
    setHabitLoading(false);
  }, [invalidateHabitRun]);

  useEffect(() => () => invalidateHabitRun(), [invalidateHabitRun]);

  const runCondensedOverlay = useCallback(async (playerValue: string) => {
    const currentMatch = matchRef.current;
    if (!currentMatch) return;
    const [scopeKind, scopeId] = playerValue.split(":");
    const playerId = scopeKind === "player" ? Number(scopeId) : NaN;
    if (!Number.isFinite(playerId)) {
      invalidateHabitRun();
      setHabitLoading(false);
      setHabitStatus("Select a player");
      return;
    }
    const runId = habitRunRef.current + 1;
    habitRunRef.current = runId;
    setHabitOverlay(null);
    setDurationOverride(null);
    setHabitLoading(true);
    setHabitStatus("Loading rounds…");
    setPlaying(false);
    setTime(0);
    try {
      const label = currentMatch.players.find((player) => player.steamId === playerId)?.name ?? String(playerId);
      const replays: HabitReplayRound[] = [];
      for (let i = 0; i < currentMatch.rounds.length; i++) {
        if (habitRunRef.current !== runId) return;
        setHabitStatus(`Loading ${i + 1}/${currentMatch.rounds.length}`);
        const round = await loadRoundForHabits(currentMatch.rounds[i]);
        if (habitRunRef.current !== runId) return;
        const replay = buildHabitReplayRound(round, playerId, label, DEFAULT_HABIT_TYPES);
        if (replay) replays.push(replay);
      }
      if (habitRunRef.current === runId) {
        const overlay: HabitOverlay = { label, mode: "replay", trails: [], replays };
        const duration = Math.max(
          currentMatch.rounds.reduce((max, round) => Math.max(max, round.duration), 0),
          ...replays.map((replay) => {
            const samples = replay.positions.map((sample) => sample.t);
            const projectiles = replay.projectiles.flatMap((projectile) => projectile.samples.map((sample) => sample.t));
            const effects = replay.effects.flatMap((effect) => [effect.start, effect.end]);
            const death = replay.death ? [replay.death.t] : [];
            return Math.max(0, ...samples, ...projectiles, ...effects, ...death);
          }),
        );
        setHabitOverlay(overlay);
        setDurationOverride(duration || null);
        setHabitStatus(`${replays.length} rounds`);
      }
    } catch (error) {
      if (habitRunRef.current === runId) {
        setHabitStatus(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (habitRunRef.current === runId) {
        setHabitLoading(false);
      }
    }
  }, [invalidateHabitRun, loadRoundForHabits, setDurationOverride, setHabitOverlay, setPlaying, setTime]);

  if (loading || (!err && storedMatchId !== id)) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-neutral-950">
        <Image
          src={assetPath("/logo.png")}
          alt="RoundLab"
          width={72}
          height={74}
          loading="eager"
          className="object-contain opacity-90"
        />
        <Loader2 className="size-5 animate-spin text-neutral-400" />
      </div>
    );
  }
  if (err || !match) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-neutral-950 text-neutral-100">
        <Image
          src={assetPath("/logo.png")}
          alt="RoundLab"
          width={72}
          height={74}
          loading="eager"
          className="object-contain opacity-90"
        />
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
  const mapInset = Math.min(16, mapSize * 0.025);
  const contentMapSize = mapSize - mapInset * 2;
  const innerSize = contentMapSize * cropScale;
  const cropTx = -crop.x * (contentMapSize / crop.size);
  const cropTy = -crop.y * (contentMapSize / crop.size);
  const condensedMode = reviewMode === "condensed";
  const condensedPlayerOptions = match.players.map((player) => ({
    value: `player:${player.steamId}`,
    label: player.name || `#${String(player.steamId).slice(-4)}`,
  }));
  const displayMapPan = clampMapPan(mapPan, mapZoom, mapSize);
  const effectiveCondensedPlayerValue = condensedPlayerOptions.some((option) => option.value === condensedPlayerValue)
    ? condensedPlayerValue
    : condensedPlayerOptions[0]?.value ?? "";
  const hasRadarLayerControl = Boolean(MAP_VERTICAL_SECTIONS[match.meta.map]?.some((section) => section.layer === "lower"));

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#101212] text-neutral-100">
      <ReplayAccessibilitySummary />
      <header>
        {match.meta.partial && (
          <div role="status" className="bg-yellow-950/50 border-b border-yellow-700/30 px-4 py-2 text-sm text-yellow-200">
            Partial parse: This replay was truncated during parsing. Data may be incomplete.
            {match.meta.parseError && <span className="text-yellow-300 ml-2">({match.meta.parseError})</span>}
          </div>
        )}
        {visualTest && <VisualTestPanel match={match} currentRoundIdx={currentRoundIdx} />}
        <Link href="/" className="fixed left-4 top-4 z-50">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 border border-white/10 bg-black/40 px-2.5 text-[11px] font-semibold text-neutral-300 hover:bg-black/60 hover:text-neutral-100"
          >
            <Image
              src={assetPath("/logo.png")}
              alt=""
              width={20}
              height={21}
              loading="eager"
              className="object-contain"
            />
            Home
          </Button>
        </Link>
        <nav aria-label="Replay display controls" className="fixed left-4 right-4 top-14 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 overflow-x-auto rounded-md border border-white/10 bg-[#0b0d0d]/75 px-2 py-1.5 shadow-xl shadow-black/30 backdrop-blur-md sm:left-28 sm:right-auto sm:top-4 sm:max-w-[calc(100vw-8rem)]">
        <div className="flex rounded-[3px] border border-white/10 bg-[#151717] p-0.5">
          {([
            ["classic", "Classique"],
            ["condensed", "Condensé"],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={reviewMode === mode}
              onClick={() => {
                setReviewMode(mode);
                if (mode === "classic") clearHabitOverlay();
                else {
                  setTool("none");
                  setMapDrag(null);
                  if (effectiveCondensedPlayerValue) {
                    if (!condensedPlayerValue) setCondensedPlayerValue(effectiveCondensedPlayerValue);
                    void runCondensedOverlay(effectiveCondensedPlayerValue);
                  }
                }
              }}
              className={[
                // Switching both foreground and background colors used to
                // create a brief low-contrast state during the transition.
                "h-7 rounded-[2px] px-2.5 text-[11px] font-semibold",
                reviewMode === mode
                  ? "bg-white text-neutral-950"
                  : "text-neutral-100 hover:bg-white/[0.05] hover:text-white",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-[3px] border border-white/10 bg-[#151717] px-1 py-0.5">
          {hasRadarLayerControl && (
            <div className="flex rounded-[3px] border border-white/10 bg-black/20 p-0.5">
              {([
                ["auto", "Auto"],
                ["default", "Upper"],
                ["lower", "Lower"],
              ] as const).map(([layer, label]) => (
                <button
                  key={layer}
                  type="button"
                  aria-pressed={radarLayerMode === layer}
                  onClick={() => setRadarLayerMode(layer)}
                  className={[
                    "h-6 rounded-[2px] px-2 text-[10px] font-semibold transition-colors",
                    radarLayerMode === layer
                      ? "bg-emerald-300 text-[#06100b]"
                      : "text-neutral-300 hover:bg-white/[0.05] hover:text-white",
                  ].join(" ")}
                  title={`Radar layer: ${label}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setClampedZoom(mapZoom - MAP_ZOOM_STEP)}
            className="flex size-7 items-center justify-center rounded-[2px] text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-neutral-200"
            title="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <span className="w-9 text-center text-[11px] font-semibold tabular-nums text-neutral-400">
            {Math.round(mapZoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setClampedZoom(mapZoom + MAP_ZOOM_STEP)}
            className="flex size-7 items-center justify-center rounded-[2px] text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-neutral-200"
            title="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex size-8 items-center justify-center rounded-[3px] border border-white/10 bg-[#151717] text-neutral-400 transition-colors hover:bg-white/[0.05] hover:text-neutral-100"
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        </button>
        {condensedMode && (
          <select
            aria-label="Compared player"
            value={effectiveCondensedPlayerValue}
            onChange={(event) => {
              setCondensedPlayerValue(event.target.value);
              void runCondensedOverlay(event.target.value);
            }}
            className="h-7 max-w-40 rounded-[3px] border border-white/10 bg-[#171a1a] px-2 text-[11px] font-medium text-neutral-200 outline-none"
          >
            {condensedPlayerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        {condensedMode && (habitStatus || habitOverlay) && (
          <span
            className="whitespace-nowrap text-[11px] text-neutral-400"
            title={
              habitOverlay
                ? habitOverlay.mode === "replay"
                  ? `${habitOverlay.label}: ${habitOverlay.replays?.length ?? 0} rounds`
                  : `${habitOverlay.label}: ${habitOverlay.trails.length} trajectories`
                : habitStatus
            }
          >
            {habitOverlay
              ? habitOverlay.mode === "replay"
                ? `${habitOverlay.replays?.length ?? 0} rounds`
                : `${habitOverlay.trails.length} trajectories`
              : habitLoading
                ? habitStatus || "Loading rounds…"
                : habitStatus}
          </span>
        )}
        </nav>
      </header>
      <main id="main-content" tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <h1 className="sr-only">RoundLab match replay</h1>
        {!condensedMode && (
          <>
            <PlayerHUD side="CT" />
            <PlayerHUD side="T" />
          </>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {!condensedMode && <RoundClock />}
          {!condensedMode && <KillFeed />}
          <div
            ref={mainRef}
            data-testid="match-map-stage"
            className={[
              "relative flex min-h-0 flex-1 items-center justify-center pb-32 pt-12",
              condensedMode ? "px-6" : "px-0",
            ].join(" ")}
          >
            <div
              data-testid="match-map-viewport"
              className="relative overflow-hidden"
              style={{
                width: mapSize,
                height: mapSize,
                cursor: tool === "none" && mapZoom > 1 ? (mapDrag ? "grabbing" : "grab") : undefined,
              }}
              onPointerDown={startMapPan}
              onPointerMove={moveMapPan}
              onPointerUp={endMapPan}
              onPointerCancel={endMapPan}
            >
              <div
                data-testid="match-map-clip"
                style={{
                  width: mapSize,
                  height: mapSize,
                  overflow: "hidden",
                  contain: "layout style",
                }}
              >
                <div
                  data-testid="match-map-content"
                  className="relative"
                  style={{
                    width: innerSize,
                    height: innerSize,
                    transform: `translate(${mapInset + displayMapPan.x}px, ${mapInset + displayMapPan.y}px) scale(${mapZoom}) translate(${cropTx}px, ${cropTy}px)`,
                    transformOrigin: "center",
                  }}
                >
                  <MapRenderer
                    size={innerSize}
                    condensed={condensedMode}
                    radarLayerMode={radarLayerMode}
                    descriptionId="replay-text-alternative"
                  />
                  {!condensedMode && (
                    <DrawingLayer
                      size={innerSize}
                      tool={tool}
                      color={color}
                      width={DRAW_WIDTH}
                      strokes={strokes}
                      setStrokes={setStrokes}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          data-testid="match-controls-panel"
          className="absolute inset-x-2 bottom-2 z-40 shrink-0 rounded-md border border-white/10 bg-[#0b0d0d]/78 px-2 pb-2 pt-1 shadow-2xl shadow-black/35 backdrop-blur-md sm:inset-x-4 sm:bottom-4 sm:px-4 sm:pb-3"
        >
          {!condensedMode && <RoundList />}
          <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center md:gap-3">
            <div className="max-w-full overflow-x-auto">
              <Controls />
            </div>
            <div className="w-full min-w-0 flex-1">
              <Timeline />
            </div>
            {!condensedMode && (
              <div className="max-w-full overflow-x-auto">
                <DrawingToolbar
                  tool={tool}
                  setTool={setTool}
                  color={color}
                  setColor={setColor}
                  strokes={strokes}
                  setStrokes={setStrokes}
                />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function VisualTestPanel({
  match,
  currentRoundIdx,
}: {
  match: MatchData;
  currentRoundIdx: number;
}) {
  const round = match.rounds[currentRoundIdx];
  const checks = [
    ["Map", Boolean(MAP_CALIBRATION[match.meta.map])],
    ["Players", match.players.length === 10],
    ["Frames", (round?.frames.length ?? 0) > 0],
    ["Effects", (round?.effects?.length ?? 0) >= 4],
    ["Projectiles", (round?.projectileFrames?.length ?? 0) > 0],
    ["Killfeed", (round?.events ?? []).some((event) => event.type === "kill")],
    ["Shots", (round?.weaponFires?.length ?? 0) > 0],
    ["Bomb", (round?.events ?? []).some((event) => event.type === "bomb_planted")],
  ];

  return (
    <div className="fixed right-4 top-4 z-50 w-52 rounded-md border border-sky-300/20 bg-black/70 p-3 text-[11px] text-neutral-200 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold text-sky-100">Visual test</span>
        <span className="text-neutral-400">R{currentRoundIdx + 1}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {checks.map(([label, ok]) => (
          <div key={String(label)} className="flex items-center gap-1.5">
            <span className={ok ? "text-emerald-300" : "text-red-300"}>{ok ? "OK" : "FAIL"}</span>
            <span className="truncate text-neutral-400">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
