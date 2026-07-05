"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { type HabitOverlayTrail, type HabitReplayEffect, type HabitReplayPlayerSample, type HabitReplayProjectile, type HabitReplayRound, useReplay } from "@/lib/replay-store";
import { MAP_CALIBRATION, RADAR_SIZE, worldToRadar } from "@/lib/maps";
import type { BombState, Frame, MatchEvent, PlayerPos, ProjectileFrame, ProjectilePos, Round, UtilityEffect, WeaponFireEvent } from "@/lib/types";
import { iconPathFor } from "@/lib/icons";
import { writeDebugLog } from "@/lib/api";
import { smokeBlastClearAlpha } from "@/lib/replay-logic";

const iconTextureCache = new Map<string, Promise<Texture>>();
const iconTextureReadyCache = new Map<string, Texture>();
const roundIconPreloadCache = new WeakMap<Round, string[]>();
const BOMB_CARRIER_COLOR = 0xef4444;
const BOMB_SECONDS = 40;
const FIRE_EFFECT_MAX_DURATION = 7;
const bombFrameFallbackCache = new WeakMap<Round, Frame[]>();
const PROJECTILE_DEBUG_KEY = "roundlab.debugProjectiles";
let projectileDebugCache = { checkedAt: 0, enabled: false };

const PRELOADABLE_ICON_PATHS = new Set([
  "/icons/ak47.svg",
  "/icons/armor_helmet.svg",
  "/icons/aug.svg",
  "/icons/awp.svg",
  "/icons/bayonet.svg",
  "/icons/bizon.svg",
  "/icons/burningFlammes.svg",
  "/icons/c4.svg",
  "/icons/cz75a.svg",
  "/icons/deagle.svg",
  "/icons/decoy.svg",
  "/icons/defuser.svg",
  "/icons/elite.svg",
  "/icons/famas.svg",
  "/icons/fiveseven.svg",
  "/icons/flashbang.svg",
  "/icons/g3sg1.svg",
  "/icons/galilar.svg",
  "/icons/glock.svg",
  "/icons/hegrenade.svg",
  "/icons/hkp2000.svg",
  "/icons/incgrenade.svg",
  "/icons/kevlar.svg",
  "/icons/knife.svg",
  "/icons/knife_bowie.svg",
  "/icons/knife_butterfly.svg",
  "/icons/knife_canis.svg",
  "/icons/knife_cord.svg",
  "/icons/knife_css.svg",
  "/icons/knife_flip.svg",
  "/icons/knife_gut.svg",
  "/icons/knife_gypsy_jackknife.svg",
  "/icons/knife_karambit.svg",
  "/icons/knife_kukri.svg",
  "/icons/knife_m9_bayonet.svg",
  "/icons/knife_outdoor.svg",
  "/icons/knife_push.svg",
  "/icons/knife_skeleton.svg",
  "/icons/knife_slash.svg",
  "/icons/knife_stiletto.svg",
  "/icons/knife_survival_bowie.svg",
  "/icons/knife_t.svg",
  "/icons/knife_tactical.svg",
  "/icons/knife_twinblade.svg",
  "/icons/knife_ursus.svg",
  "/icons/knife_widowmaker.svg",
  "/icons/m249.svg",
  "/icons/m4a1.svg",
  "/icons/m4a1_silencer.svg",
  "/icons/mac10.svg",
  "/icons/mag7.svg",
  "/icons/molotov.svg",
  "/icons/mp5sd.svg",
  "/icons/mp7.svg",
  "/icons/mp9.svg",
  "/icons/negev.svg",
  "/icons/nova.svg",
  "/icons/p2000.svg",
  "/icons/p250.svg",
  "/icons/p90.svg",
  "/icons/quick-slash.svg",
  "/icons/revolver.svg",
  "/icons/sawedoff.svg",
  "/icons/scar20.svg",
  "/icons/shoot.svg",
  "/icons/sg556.svg",
  "/icons/smokegrenade.svg",
  "/icons/ssg08.svg",
  "/icons/taser.svg",
  "/icons/tec9.svg",
  "/icons/ump45.svg",
  "/icons/usp_silencer.svg",
  "/icons/xm1014.svg",
]);

// Pixi's SVG asset pipeline has been brittle across runtimes. Loading the bytes
// ourselves and feeding a blob URL into a vanilla HTMLImageElement keeps utility
// icons rendering consistently in the browser.
async function loadSvgTextureDirect(path: string): Promise<Texture> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch ${path}: ${res.status}`);
  const text = await res.text();
  const blob = new Blob([text], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width || 64;
    canvas.height = image.naturalHeight || image.height || 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error(`canvas context unavailable for ${path}`);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return Texture.from(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadIconTexture(path: string): Promise<Texture> {
  const ready = iconTextureReadyCache.get(path);
  if (ready) return Promise.resolve(ready);
  let p = iconTextureCache.get(path);
  if (!p) {
    const loader = path.toLowerCase().endsWith(".svg")
      ? loadSvgTextureDirect(path)
      : (Assets.load(path) as Promise<Texture>);
    // Don't poison the cache with a rejected promise — drop it so the next
    // call gets a fresh attempt instead of replaying the failure forever.
    p = loader
      .then((tex) => {
        iconTextureReadyCache.set(path, tex);
        return tex;
      })
      .catch((err) => {
        iconTextureCache.delete(path);
        iconTextureReadyCache.delete(path);
        console.error(`[icons] failed to load ${path}`, err);
        throw err;
      });
    iconTextureCache.set(path, p);
  }
  return p;
}

function cachedIconTexture(path: string): Texture | undefined {
  return iconTextureReadyCache.get(path);
}

function addPreloadPath(out: Set<string>, path: string | null): void {
  if (path && PRELOADABLE_ICON_PATHS.has(path)) out.add(path);
}

function preloadIconPathSet(paths: Set<string>): void {
  for (const path of paths) {
    if (!cachedIconTexture(path)) void loadIconTexture(path).catch(() => {});
  }
}

function yieldToMainThread(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function collectRoundIconPreloadPaths(round: Round, shouldCancel: () => boolean): Promise<string[]> {
  const cached = roundIconPreloadCache.get(round);
  if (cached) return cached;
  const paths = new Set<string>([
    "/icons/c4.svg",
    "/icons/quick-slash.svg",
    "/icons/shoot.svg",
    "/icons/smokegrenade.svg",
    "/icons/flashbang.svg",
    "/icons/hegrenade.svg",
    "/icons/molotov.svg",
    "/icons/incgrenade.svg",
    "/icons/decoy.svg",
  ]);

  for (let index = 0; index < round.frames.length; index++) {
    if (shouldCancel()) return [];
    const frame = round.frames[index];
    for (const player of frame.players) {
      addPreloadPath(paths, iconPathFor(player.active));
      for (const weapon of player.weapons ?? []) addPreloadPath(paths, iconPathFor(weapon));
      if (player.activeAction) {
        addPreloadPath(paths, iconPathFor(player.activeAction.type === "plant" ? "c4" : player.activeAction.item));
      }
    }
    for (const projectile of frame.projectiles ?? []) {
      addPreloadPath(paths, iconPathFor(projectile.type));
    }
    if (index % 160 === 159) await yieldToMainThread();
  }

  const projectileFrames = round.projectileFrames ?? [];
  for (let index = 0; index < projectileFrames.length; index++) {
    if (shouldCancel()) return [];
    const frame = projectileFrames[index];
    for (const projectile of frame.projectiles) {
      addPreloadPath(paths, iconPathFor(projectile.type));
    }
    if (index % 240 === 239) await yieldToMainThread();
  }

  for (const fire of round.weaponFires ?? []) {
    if (isKnifeWeapon(fire.weapon)) addPreloadPath(paths, "/icons/quick-slash.svg");
    else if (!isUtilityWeapon(fire.weapon)) addPreloadPath(paths, "/icons/shoot.svg");
    addPreloadPath(paths, iconPathFor(fire.weapon));
  }

  for (const effect of round.effects ?? []) {
    if (effect.type === "fire") addPreloadPath(paths, iconPathFor(effect.variant === "incendiary" ? "incgrenade" : "molotov"));
    else addPreloadPath(paths, iconPathFor(effect.type));
  }

  const result = [...paths];
  roundIconPreloadCache.set(round, result);
  return result;
}

async function preloadRoundIconTextures(rounds: Round[], shouldCancel: () => boolean): Promise<void> {
  const paths = new Set<string>();
  for (const round of rounds) {
    if (shouldCancel()) return;
    for (const path of await collectRoundIconPreloadPaths(round, shouldCancel)) paths.add(path);
    preloadIconPathSet(paths);
  }
}

function sampleFrame(frames: Frame[], t: number): PlayerPos[] {
  if (!frames || frames.length === 0) return [];
  if (t <= frames[0].t) return frames[0].players;
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1].players;
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = b.t - a.t || 1;
  const alpha = (t - a.t) / span;
  const byId = new Map<number, PlayerPos>();
  for (const p of a.players) byId.set(p.id, p);
  const out: PlayerPos[] = [];
  for (const pb of b.players) {
    const pa = byId.get(pb.id);
    if (!pa) {
      out.push(pb);
      continue;
    }
    // Shortest angular path so turning across the 180/-180 seam doesn't
    // produce a ~360° spin backwards.
    let dyaw = pb.yaw - pa.yaw;
    while (dyaw > 180) dyaw -= 360;
    while (dyaw < -180) dyaw += 360;
    // Interpolate flash time so the arc ticks smoothly between 8 Hz samples.
    const flashA = pa.flashLeft ?? 0;
    const flashB = pb.flashLeft ?? 0;
    const flashLeft = flashA > 0 && flashB > 0
      ? flashA + (flashB - flashA) * alpha
      : flashA > 0
      ? Math.max(0, flashA - (b.t - a.t) * alpha)
      : flashB;
    const actionA = pa.activeAction;
    const actionB = pb.activeAction;
    const activeAction = actionA && actionB && actionA.type === actionB.type && actionA.item === actionB.item
      ? {
          ...actionB,
          elapsed: actionA.elapsed + (actionB.elapsed - actionA.elapsed) * alpha,
        }
      : actionB;
    out.push({
      ...pb,
      x: pa.x + (pb.x - pa.x) * alpha,
      y: pa.y + (pb.y - pa.y) * alpha,
      yaw: pa.yaw + dyaw * alpha,
      flashLeft,
      activeAction,
    });
  }
  return out;
}

function playerPositionAtOrBefore(frames: Frame[], playerId: number, t: number): PlayerPos | null {
  if (!frames || frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  for (let i = lo; i >= 0; i--) {
    const player = frames[i].players.find((candidate) => candidate.id === playerId);
    if (player) return player;
  }
  return null;
}

function nearestFrame(frames: Frame[], t: number): Frame | null {
  if (!frames || frames.length === 0) return null;
  if (t <= frames[0].t) return frames[0];
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1];
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return Math.abs(frames[lo].t - t) <= Math.abs(frames[hi].t - t) ? frames[lo] : frames[hi];
}

function framePair<T extends { t: number }>(frames: T[], t: number): { a: T; b: T; alpha: number } | null {
  if (!frames || frames.length === 0) return null;
  if (t <= frames[0].t) return { a: frames[0], b: frames[0], alpha: 0 };
  if (t >= frames[frames.length - 1].t) {
    const last = frames[frames.length - 1];
    return { a: last, b: last, alpha: 0 };
  }
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  return { a, b, alpha: (t - a.t) / (b.t - a.t || 1) };
}

type ProjectileSample = Frame | ProjectileFrame;

function projectileSamples(round: Round): ProjectileSample[] {
  return round.projectileFrames?.length ? round.projectileFrames : round.frames;
}

type ProjectileTrack = {
  samples: Array<{ t: number; projectile: ProjectilePos }>;
  first: number | null;
  last: number | null;
  samplesCount: number;
  moved: boolean;
};

type RoundRenderCache = {
  projectileFrames: ProjectileSample[];
  projectileTracks: Map<number, ProjectileTrack>;
  resolvedEffects: UtilityEffect[];
  deathMarkers: Array<{ t: number; x: number; y: number; z: number }>;
  fixedProjectileSamples: Map<number, ProjectilePos[]>;
};

const roundRenderCache = new WeakMap<Round, RoundRenderCache>();

function projectileDebugEnabled() {
  if (typeof window === "undefined") return false;
  const now = performance.now();
  if (now - projectileDebugCache.checkedAt < 500) return projectileDebugCache.enabled;
  projectileDebugCache = {
    checkedAt: now,
    enabled:
      window.localStorage.getItem(PROJECTILE_DEBUG_KEY) === "1" ||
      String((window as Window & { ROUNDLAB_DEBUG_PROJECTILES?: unknown }).ROUNDLAB_DEBUG_PROJECTILES ?? "") === "1",
  };
  return projectileDebugCache.enabled;
}

function projectileDebugLog(message: string) {
  if (!projectileDebugEnabled()) return;
  const line = `ROUNDLAB_DEBUG_PROJECTILES ${message}`;
  console.info(line);
  writeDebugLog("projectiles", line).catch(() => {});
}

function projectileDebugLogForced(message: string) {
  const line = `ROUNDLAB_DEBUG_PROJECTILES ${message}`;
  console.info(line);
  writeDebugLog("projectiles", line).catch(() => {});
}

function formatProjectileDebugNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function projectileDebugDistance(projectile: ProjectilePos, effect: UtilityEffect) {
  return Math.hypot(projectile.x - effect.x, projectile.y - effect.y, projectile.z - effect.z);
}

function projectileDebugTick(round: Round, tickRate: number, time: number) {
  return Math.round(round.startTick + time * tickRate);
}

function fireEffectDebugPayload(effect: UtilityEffect, round: Round, tickRate: number) {
  const duration = effect.end - effect.start;
  return {
    roundNumber: round.number,
    id: effect.id ?? null,
    type: effect.type,
    variant: effect.variant ?? null,
    startTime: formatProjectileDebugNumber(effect.start),
    endTime: formatProjectileDebugNumber(effect.end),
    startTick: projectileDebugTick(round, tickRate, effect.start),
    endTick: projectileDebugTick(round, tickRate, effect.end),
    duration: formatProjectileDebugNumber(duration),
    source: "parser-effect",
    overExpectedDuration: duration > 9,
    x: formatProjectileDebugNumber(effect.x),
    y: formatProjectileDebugNumber(effect.y),
    z: formatProjectileDebugNumber(effect.z),
    team: effect.team ?? null,
  };
}

function fireClampDebugPayload(effect: UtilityEffect, round: Round, tickRate: number, source: string) {
  const clampedEnd = Math.min(effect.end, effect.start + FIRE_EFFECT_MAX_DURATION);
  return {
    roundNumber: round.number,
    id: effect.id ?? null,
    type: effect.type,
    variant: effect.variant ?? null,
    source,
    maxDuration: FIRE_EFFECT_MAX_DURATION,
    rawStartTime: formatProjectileDebugNumber(effect.start),
    rawEndTime: formatProjectileDebugNumber(effect.end),
    rawDuration: formatProjectileDebugNumber(effect.end - effect.start),
    clampedEndTime: formatProjectileDebugNumber(clampedEnd),
    clampedDuration: formatProjectileDebugNumber(clampedEnd - effect.start),
    rawStartTick: projectileDebugTick(round, tickRate, effect.start),
    rawEndTick: projectileDebugTick(round, tickRate, effect.end),
    clampedEndTick: projectileDebugTick(round, tickRate, clampedEnd),
  };
}

type ProjectileTrackWindow = { first: number | null; last: number | null; samples: number; moved: boolean };

function projectileTrackWindowFromCache(cache: RoundRenderCache, id: number): ProjectileTrackWindow {
  const track = cache.projectileTracks.get(id);
  return {
    first: track?.first ?? null,
    last: track?.last ?? null,
    samples: track?.samplesCount ?? 0,
    moved: track?.moved ?? false,
  };
}

function projectileSampleSourceDebug(frames: ProjectileSample[], id: number, time: number) {
  const pair = framePair(frames, time);
  const inA = Boolean(pair?.a.projectiles?.some((projectile) => projectile.id === id));
  const inB = Boolean(pair?.b.projectiles?.some((projectile) => projectile.id === id));
  return {
    frameA: pair ? formatProjectileDebugNumber(pair.a.t) : null,
    frameB: pair ? formatProjectileDebugNumber(pair.b.t) : null,
    alpha: pair ? formatProjectileDebugNumber(pair.alpha) : null,
    inFrameA: inA,
    inFrameB: inB,
    selectedBy: inA ? "current-or-interpolated-from-current-frame" : inB ? "future-frame-only" : "none",
  };
}

function projectilePositionSuspicion(
  projectile: ProjectilePos,
  radar: { x: number; y: number },
  size: number,
  track: ProjectileTrackWindow,
): string[] {
  const reasons: string[] = [];
  if ([projectile.x, projectile.y, projectile.z].some((value) => !Number.isFinite(value))) reasons.push("invalid-world-coordinates");
  if (!Number.isFinite(radar.x) || !Number.isFinite(radar.y)) reasons.push("invalid-radar-coordinates");
  if (Math.abs(projectile.x) < 0.001 && Math.abs(projectile.y) < 0.001 && Math.abs(projectile.z) < 0.001) reasons.push("zero-world-position");
  if (Math.hypot(radar.x - size / 2, radar.y - size / 2) <= 8 && track.samples <= 2) reasons.push("near-map-center-with-short-history");
  if (track.first === null || track.samples <= 1) reasons.push("missing-history");
  if (!track.moved && track.samples >= 2) reasons.push("static-track");
  return reasons;
}

function sampleProjectiles(frames: ProjectileSample[], t: number): ProjectilePos[] {
  if (frames.length > 0 && t < frames[0].t) return [];
  const pair = framePair(frames, t);
  if (!pair) return [];
  const { a, b, alpha } = pair;
  const future = new Map((b.projectiles ?? []).map((p) => [p.id, p]));
  const out = new Map<number, ProjectilePos>();
  for (const pa of a.projectiles ?? []) {
    const pb = future.get(pa.id);
    if (!pb) {
      out.set(pa.id, pa);
      continue;
    }
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const dz = pb.z - pa.z;
    const sameProjectile =
      projectileTypeToEffect(pa.type) === projectileTypeToEffect(pb.type) &&
      (pa.thrower ?? 0) === (pb.thrower ?? 0) &&
      dx * dx + dy * dy + dz * dz <= 850 * 850;
    if (!sameProjectile) {
      out.set(pa.id, pa);
      continue;
    }
    out.set(pb.id, {
      ...pb,
      x: pa.x + (pb.x - pa.x) * alpha,
      y: pa.y + (pb.y - pa.y) * alpha,
      z: pa.z + (pb.z - pa.z) * alpha,
    });
  }
  return [...out.values()];
}

function projectileHistory(
  frames: ProjectileSample[],
  projectile: ProjectilePos,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number }
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let lastSampleTime: number | null = null;

  for (const frame of frames) {
    if (frame.t > time) break;
    const p = frame.projectiles?.find((candidate) => candidate.id === projectile.id);
    if (!p) continue;
    const pt = toRadar(p.x, p.y, p.z);
    const last = points[points.length - 1];
    const staleGap = lastSampleTime !== null && frame.t - lastSampleTime > 0.9;
    if (staleGap) {
      points.length = 0;
      points.push(pt);
      lastSampleTime = frame.t;
      continue;
    }
    if (!last || Math.hypot(last.x - pt.x, last.y - pt.y) > 0.5) points.push(pt);
    lastSampleTime = frame.t;
  }

  const current = toRadar(projectile.x, projectile.y, projectile.z);
  const last = points[points.length - 1];
  if (!last || Math.hypot(last.x - current.x, last.y - current.y) > 0.5) points.push(current);
  return points;
}

function projectileHistoryFromTrack(
  track: ProjectileTrack | undefined,
  projectile: ProjectilePos,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number }
): { x: number; y: number }[] {
  if (!track) return projectileHistory([], projectile, time, toRadar);
  const points: { x: number; y: number }[] = [];
  let lastSampleTime: number | null = null;
  const groundZ = projectileGroundZ(track, projectile.z);

  for (const sample of track.samples) {
    if (sample.t > time) break;
    const p = sample.projectile;
    const pt = toRadar(p.x, p.y, Math.max(0, p.z - groundZ));
    const last = points[points.length - 1];
    const staleGap = lastSampleTime !== null && sample.t - lastSampleTime > 0.9;
    if (staleGap) {
      points.length = 0;
      points.push(pt);
      lastSampleTime = sample.t;
      continue;
    }
    if (!last || Math.hypot(last.x - pt.x, last.y - pt.y) > 0.5) points.push(pt);
    lastSampleTime = sample.t;
  }

  const current = toRadar(projectile.x, projectile.y, Math.max(0, projectile.z - groundZ));
  const last = points[points.length - 1];
  if (!last || Math.hypot(last.x - current.x, last.y - current.y) > 0.5) points.push(current);
  return points;
}

function drawSmoothTrail(g: Graphics, points: { x: number; y: number }[], color: number) {
  if (points.length < 2) return;
  const smooth: { x: number; y: number }[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let step = 1; step <= 8; step++) {
      const t = step / 8;
      const tt = t * t;
      const ttt = tt * t;
      const x =
        0.5 *
        ((2 * p1.x) +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt);
      const y =
        0.5 *
        ((2 * p1.y) +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * ttt);
      smooth.push({ x, y });
    }
  }

  let dashRemaining = 3.5;
  let gapRemaining = 4.5;
  let drawing = true;
  for (let i = 1; i < smooth.length; i++) {
    let from = smooth[i - 1];
    const to = smooth[i];
    let distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance <= 0.01) continue;
    const ux = (to.x - from.x) / distance;
    const uy = (to.y - from.y) / distance;

    while (distance > 0.01) {
      const step = Math.min(distance, drawing ? dashRemaining : gapRemaining);
      const next = { x: from.x + ux * step, y: from.y + uy * step };
      if (drawing) {
        const progress = i / Math.max(1, smooth.length - 1);
        g.moveTo(from.x, from.y);
        g.lineTo(next.x, next.y);
        g.stroke({ color, width: 1.35, alpha: 0.2 + progress * 0.35 });
        dashRemaining -= step;
        if (dashRemaining <= 0.01) {
          drawing = false;
          dashRemaining = 3.5;
        }
      } else {
        gapRemaining -= step;
        if (gapRemaining <= 0.01) {
          drawing = true;
          gapRemaining = 4.5;
        }
      }
      from = next;
      distance -= step;
    }
  }
}

function habitTrailColor(type: string): number {
  const effect = projectileTypeToEffect(type);
  if (effect === "smoke") return 0x9ca3af;
  if (effect === "flash") return 0xfef3c7;
  if (effect === "he") return 0xf97316;
  if (effect === "fire") return 0xef4444;
  if (effect === "decoy") return 0xa78bfa;
  return 0x6fea76;
}

function drawHabitOverlayTrail(
  layer: Container,
  trail: HabitOverlayTrail,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
) {
  if (trail.points.length < 2) return;
  const points = trail.points.map((point) => toRadar(point.x, point.y, point.z));
  const color = habitTrailColor(trail.type);
  const g = new Graphics();
  drawSmoothTrail(g, points, color);
  const start = points[0];
  const end = points[points.length - 1];
  g.circle(start.x, start.y, 2.4).fill({ color, alpha: 0.65 });
  g.circle(end.x, end.y, 3.4).fill({ color, alpha: 0.9 });
  layer.addChild(g);
}

function sampleHabitPosition(samples: HabitReplayPlayerSample[], time: number): HabitReplayPlayerSample | null {
  const pair = framePair(samples, time);
  if (!pair) return null;
  const { a, b, alpha } = pair;
  let dyaw = b.yaw - a.yaw;
  while (dyaw > 180) dyaw -= 360;
  while (dyaw < -180) dyaw += 360;
  return {
    ...b,
    t: time,
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
    yaw: a.yaw + dyaw * alpha,
    hp: a.hp + (b.hp - a.hp) * alpha,
    team: b.team,
  };
}

function habitTimedPoints<T extends { t: number; x: number; y: number; z: number }>(
  samples: T[],
  start: number,
  end: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  groundZ?: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (const sample of samples) {
    if (sample.t < start || sample.t > end) continue;
    const z = groundZ === undefined ? sample.z : Math.max(0, sample.z - groundZ);
    const p = toRadar(sample.x, sample.y, z);
    const last = points[points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= 2.5) points.push(p);
  }
  return points;
}

function sampleHabitProjectile(projectile: HabitReplayProjectile, time: number): { x: number; y: number; z: number } | null {
  const pair = framePair(projectile.samples, time);
  if (!pair) return null;
  const { a, b, alpha } = pair;
  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
  };
}

function habitProjectileGroundZ(projectile: HabitReplayProjectile) {
  if (!projectile.samples.length) return 0;
  return projectile.samples.reduce((lowest, sample) => Math.min(lowest, sample.z), projectile.samples[0].z);
}

function drawHabitGhostLabel(layer: Container, text: string, x: number, y: number, color: number) {
  const label = new Text({
    text,
    style: {
      fontFamily: "ui-sans-serif, system-ui",
      fontSize: 34,
      fontWeight: "700",
      fill: 0xffffff,
      stroke: { color: 0x111111, width: 5 },
    },
    resolution: Math.max(2, window.devicePixelRatio || 1),
  });
  label.anchor.set(0.5, 0.5);
  label.scale.set(0.22);
  label.alpha = 0.72;
  label.position.set(x, y - 14);
  const bg = new Graphics();
  const width = Math.max(17, label.width + 5);
  bg.roundRect(x - width / 2, y - 20, width, 10, 3).fill({ color, alpha: 0.34 });
  layer.addChild(bg);
  layer.addChild(label);
}

function drawHabitGhostPlayer(
  layer: Container,
  replay: HabitReplayRound,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
) {
  const position = sampleHabitPosition(replay.positions, time);
  const died = replay.death && time >= replay.death.t;
  if (died && replay.death) {
    const p = toRadar(replay.death.x, replay.death.y, replay.death.z);
    drawDeathMarker(layer, p.x, p.y, time - replay.death.t);
    drawHabitGhostLabel(layer, `R${replay.roundNumber}`, p.x, p.y, 0xef4444);
    return;
  }
  if (!position || position.hp <= 0) return;

  const color = teamColor(position.team);
  const recentPath = habitTimedPoints(replay.positions, Math.max(0, time - 7), time, toRadar);
  const path = new Graphics();
  if (recentPath.length >= 2) {
    path.moveTo(recentPath[0].x, recentPath[0].y);
    for (const point of recentPath.slice(1)) path.lineTo(point.x, point.y);
    path.stroke({ color, width: 1.6, alpha: 0.2 });
  }
  const p = toRadar(position.x, position.y, position.z);
  path.circle(p.x, p.y, 8).stroke({ color, width: 1.4, alpha: 0.28 });
  layer.addChild(path);

  const marker = new Graphics();
  marker.position.set(p.x, p.y);
  marker.rotation = (position.yaw * Math.PI) / 180;
  marker
    .moveTo(8, 0)
    .lineTo(-6, -4.5)
    .lineTo(-3.5, 0)
    .lineTo(-6, 4.5)
    .lineTo(8, 0)
    .fill({ color, alpha: 0.38 })
    .stroke({ color: 0xffffff, width: 1, alpha: 0.42 });
  layer.addChild(marker);
  drawHabitGhostLabel(layer, `R${replay.roundNumber}`, p.x, p.y, color);
}

function drawHabitProjectile(
  layer: Container,
  projectile: HabitReplayProjectile,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  effects: HabitReplayEffect[] = [],
) {
  const first = projectile.samples[0];
  const last = projectile.samples[projectile.samples.length - 1];
  if (!first || !last || time < first.t || time > last.t + 1.05) return;
  const color = habitTrailColor(projectile.type);
  const kind = projectileTypeToEffect(projectile.type);
  const handoff = kind
    ? effects
        .filter((effect) => effect.type === kind && time >= effect.start - 0.12 && time <= effect.start + 0.12)
        .map((effect) => {
          const distances = projectile.samples
            .filter((sample) => sample.t >= effect.start - 0.45 && sample.t <= effect.start + 0.12)
            .map((sample) => Math.hypot(sample.x - effect.x, sample.y - effect.y));
          return { effect, distance: distances.length ? Math.min(...distances) : Infinity };
        })
        .filter((match) => match.distance <= effectSuppressionRadius(kind))
        .sort((a, b) => a.distance - b.distance)[0]?.effect
    : undefined;
  const activeHandoff = Boolean(handoff && time >= handoff.start);
  const fade = activeHandoff && handoff
    ? Math.max(0, 1 - (time - handoff.start) / 0.12)
    : time > last.t
      ? Math.max(0, 1 - (time - last.t) / 1.05)
      : 1;
  const visibleTime = Math.min(time, last.t);
  const groundZ = habitProjectileGroundZ(projectile);
  const points = habitTimedPoints(projectile.samples, first.t, visibleTime, toRadar, groundZ);
  const sampled = sampleHabitProjectile(projectile, visibleTime);
  if (sampled) {
    const sampledPoint = toRadar(sampled.x, sampled.y, Math.max(0, sampled.z - groundZ));
    const tail = points[points.length - 1];
    if (!tail || Math.hypot(sampledPoint.x - tail.x, sampledPoint.y - tail.y) > 0.5) points.push(sampledPoint);
  }
  if (activeHandoff && handoff) {
    const impact = toRadar(handoff.x, handoff.y, 0);
    const tail = points[points.length - 1];
    if (!tail || Math.hypot(impact.x - tail.x, impact.y - tail.y) > 0.5) points.push(impact);
  }
  if (points.length < 2) return;
  const g = new Graphics();
  drawSmoothTrail(g, points, color);
  g.alpha = 0.45 * fade;
  const current = points[points.length - 1];
  if (sampled && !activeHandoff) {
    const shadow = toRadar(sampled.x, sampled.y, 0);
    const shadowDistance = Math.hypot(current.x - shadow.x, current.y - shadow.y);
    const shadowAlpha = 0.11 + Math.min(0.12, shadowDistance / 160);
    const shadowRadius = 3.8 - Math.min(1, shadowDistance / 24);
    g.circle(shadow.x, shadow.y, shadowRadius).fill({ color: 0x000000, alpha: shadowAlpha * fade });
  }
  g.circle(current.x, current.y, 3.4).fill({ color, alpha: 0.8 * fade });
  layer.addChild(g);
  if (!activeHandoff && time <= last.t + 0.08) drawUtilityIcon(layer, projectile.type, current.x, current.y, color, 13);
}

function drawHabitEffect(
  layer: Container,
  effect: HabitReplayEffect,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number,
  contextualEffects: HabitReplayEffect[],
) {
  if (time < effect.start || time > effect.end) return;
  drawEffect(layer, effect as UtilityEffect, time, toRadar, unitsToPx, contextualEffects as UtilityEffect[]);
}

function drawHabitReplayOverlay(
  layer: Container,
  replays: HabitReplayRound[],
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number,
) {
  for (const replay of replays) {
    for (const projectile of replay.projectiles) drawHabitProjectile(layer, projectile, time, toRadar, replay.effects);
    for (const effect of replay.effects) drawHabitEffect(layer, effect, time, toRadar, unitsToPx, replay.effects);
  }
  for (const replay of replays) drawHabitGhostPlayer(layer, replay, time, toRadar);
}

function fireVariantFromProjectiles(effect: UtilityEffect, frames: ProjectileSample[], cache?: RoundRenderCache): UtilityEffect {
  if (effect.type !== "fire" || effect.variant) return effect;
  const candidates = cache
    ? [
        ...sampleProjectilesFixed(cache, effect.start),
        ...sampleProjectilesFixed(cache, Math.max(0, effect.start - 0.12)),
      ]
    : [
        ...sampleProjectiles(frames, effect.start),
        ...sampleProjectiles(frames, Math.max(0, effect.start - 0.12)),
      ];
  let best: ProjectilePos | null = null;
  let bestDist = Infinity;
  for (const p of candidates) {
    const kind = p.type.toLowerCase();
    if (!kind.includes("molotov") && !kind.includes("incendiary")) continue;
    const dx = p.x - effect.x;
    const dy = p.y - effect.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  if (!best || bestDist > 500 * 500) return effect;
  return {
    ...effect,
    variant: best.type.toLowerCase().includes("incendiary") ? "incendiary" : "molotov",
  };
}

function circleOverlapArea(r1: number, r2: number, distance: number): number {
  if (distance >= r1 + r2) return 0;
  if (distance <= Math.abs(r1 - r2)) {
    const r = Math.min(r1, r2);
    return Math.PI * r * r;
  }
  const a =
    r1 * r1 * Math.acos((distance * distance + r1 * r1 - r2 * r2) / (2 * distance * r1));
  const b =
    r2 * r2 * Math.acos((distance * distance + r2 * r2 - r1 * r1) / (2 * distance * r2));
  const c = 0.5 * Math.sqrt(
    Math.max(0, (-distance + r1 + r2) * (distance + r1 - r2) * (distance - r1 + r2) * (distance + r1 + r2))
  );
  return a + b - c;
}

function fireRadiusWorld(effect: UtilityEffect): number {
  const isIncendiary = effect.variant === "incendiary" || (!effect.variant && effect.team === 3);
  return isIncendiary ? 104 : 116;
}

function fireIsSmoked(fire: UtilityEffect, activeEffects: UtilityEffect[]): boolean {
  const fireRadius = fireRadiusWorld(fire);
  const fireArea = Math.PI * fireRadius * fireRadius;
  return activeEffects.some((effect) => {
    if (effect.type !== "smoke") return false;
    const dx = fire.x - effect.x;
    const dy = fire.y - effect.y;
    const overlap = circleOverlapArea(fireRadius, 144, Math.hypot(dx, dy));
    return overlap / fireArea > 0.25;
  });
}

function lastKnownTeams(frames: Frame[], time: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const frame of frames) {
    if (frame.t > time) break;
    for (const player of frame.players) out.set(player.id, player.team);
  }
  return out;
}

function projectileTypeToEffect(type: string): string | null {
  const t = type.toLowerCase();
  if (t.includes("smoke")) return "smoke";
  if (t.includes("molotov") || t.includes("incendiary") || t.includes("incgrenade") || t.includes("inferno")) return "fire";
  if (t.includes("decoy")) return "decoy";
  if (t.includes("flash")) return "flash";
  if (t.startsWith("he") || t.includes("hegrenade") || t.includes("he grenade") || t.includes("high explosive")) return "he";
  return null;
}

function effectSuppressionRadius(type: string): number {
  if (type === "fire" || type === "smoke") return 900;
  if (type === "decoy") return 700;
  return 520;
}

function projectileHideStart(effect: UtilityEffect): number {
  // Keep the terminal trajectory visible briefly after the effect starts.
  // Some demos stop emitting projectile samples before the detonation event,
  // so without this handoff the viewer can show only the final smoke/fire/etc.
  if (effect.type === "smoke" || effect.type === "fire") return effect.start + 0.65;
  if (effect.type === "decoy") return effect.start + 0.5;
  if (effect.type === "flash") return effect.start + 0.32;
  if (effect.type === "he") return effect.start + 0.22;
  return effect.start + 0.25;
}

type ProjectileEffectHandoff = {
  effect: UtilityEffect;
  active: boolean;
};

function projectileTypeForEffect(effect: UtilityEffect): string {
  if (effect.type === "he") return "hegrenade";
  if (effect.type === "flash") return "flashbang";
  if (effect.type === "smoke") return "smokegrenade";
  if (effect.type === "decoy") return "decoy";
  if (effect.type === "fire") return effect.variant === "incendiary" ? "incgrenade" : "molotov";
  return effect.type;
}

function projectileTouchesEffect(
  projectile: ProjectilePos,
  effect: UtilityEffect,
  frames: ProjectileSample[],
  time: number,
): boolean {
  const type = projectileTypeToEffect(projectile.type);
  if (!type || effect.type !== type) return false;
  const threshold = effectSuppressionRadius(type);
  const threshold2 = threshold * threshold;
  let matchedOwnTrack = false;

  for (const frame of frames) {
    if (frame.t < effect.start - 0.45) continue;
    if (frame.t > effect.start + 0.18) break;
    const p = frame.projectiles?.find((candidate) => candidate.id === projectile.id);
    if (!p) continue;
    matchedOwnTrack = true;
    const dx = p.x - effect.x;
    const dy = p.y - effect.y;
    if (dx * dx + dy * dy <= threshold2) return true;
  }

  // If this projectile was not present when an older effect started, do not let
  // that effect suppress it only because the current X/Y passes nearby. This is
  // common on Cache where later smokes fly through existing smoke radii.
  if (!matchedOwnTrack && time - effect.start > 0.25) return false;

  const dx = projectile.x - effect.x;
  const dy = projectile.y - effect.y;
  return dx * dx + dy * dy <= threshold2;
}

function projectileSeenNearEffect(
  projectile: ProjectilePos,
  effect: UtilityEffect,
  frames: ProjectileSample[],
): boolean {
  const type = projectileTypeToEffect(projectile.type);
  if (!type || effect.type !== type) return false;
  const threshold = effectSuppressionRadius(type);
  const threshold2 = threshold * threshold;
  const thrower = projectile.thrower ?? 0;
  const currentDx = projectile.x - effect.x;
  const currentDy = projectile.y - effect.y;
  if (currentDx * currentDx + currentDy * currentDy > threshold2) return false;

  for (const frame of frames) {
    if (frame.t < effect.start - 0.55) continue;
    if (frame.t > effect.start + 0.2) break;
    for (const candidate of frame.projectiles ?? []) {
      if (projectileTypeToEffect(candidate.type) !== type) continue;
      if ((candidate.thrower ?? 0) !== thrower) continue;
      const dx = candidate.x - effect.x;
      const dy = candidate.y - effect.y;
      if (dx * dx + dy * dy <= threshold2) return true;
    }
  }

  return false;
}

function projectileResolvedByEffect(
  projectile: ProjectilePos,
  startedEffects: UtilityEffect[],
  time: number,
  frames: ProjectileSample[],
): boolean {
  const type = projectileTypeToEffect(projectile.type);
  if (!type) return false;
  return startedEffects.some((effect) => {
    if (effect.type !== type || time < projectileHideStart(effect)) return false;
    return projectileTouchesEffect(projectile, effect, frames, time) || projectileSeenNearEffect(projectile, effect, frames);
  });
}

function projectileEffectHandoff(
  projectile: ProjectilePos,
  effects: UtilityEffect[],
  frames: ProjectileSample[],
  time: number,
): ProjectileEffectHandoff | null {
  const type = projectileTypeToEffect(projectile.type);
  if (!type) return null;
  let best: { effect: UtilityEffect; distance: number } | null = null;

  for (const effect of effects) {
    if (effect.type !== type) continue;
    if (time < effect.start - 0.12 || time > projectileHideStart(effect)) continue;
    if (!projectileTouchesEffect(projectile, effect, frames, time) && !projectileSeenNearEffect(projectile, effect, frames)) {
      continue;
    }
    const distance = Math.hypot(projectile.x - effect.x, projectile.y - effect.y);
    if (!best || distance < best.distance) best = { effect, distance };
  }

  return best ? { effect: best.effect, active: time >= best.effect.start } : null;
}

function liveProjectileForEffect(
  frames: ProjectileSample[],
  effect: UtilityEffect,
  time: number,
  ignoredProjectileIds?: Set<number>,
): ProjectilePos | null {
  const samples = sampleProjectiles(frames, time);
  const threshold = effect.type === "he" ? 900 : effectSuppressionRadius(effect.type);
  const threshold2 = threshold * threshold;
  let best: ProjectilePos | null = null;
  let bestDist = Infinity;

  for (const projectile of samples) {
    if (ignoredProjectileIds?.has(projectile.id)) continue;
    if (projectileTypeToEffect(projectile.type) !== effect.type) continue;
    const dx = projectile.x - effect.x;
    const dy = projectile.y - effect.y;
    const d = dx * dx + dy * dy;
    if (d > threshold2 || d >= bestDist) continue;
    best = projectile;
    bestDist = d;
  }

  return best;
}

function lastProjectileBeforeEffect(
  frames: ProjectileSample[],
  effect: UtilityEffect,
): { projectile: ProjectilePos; time: number } | null {
  const threshold = effect.type === "he" ? 1400 : effectSuppressionRadius(effect.type);
  const threshold2 = threshold * threshold;
  let best: ProjectilePos | null = null;
  let bestTime = -Infinity;
  let bestDist = Infinity;

  for (const frame of frames) {
    if (frame.t > effect.start) break;
    if (frame.t < effect.start - 1.25) continue;
    for (const projectile of frame.projectiles ?? []) {
      if (projectileTypeToEffect(projectile.type) !== effect.type) continue;
      const dx = projectile.x - effect.x;
      const dy = projectile.y - effect.y;
      const d = dx * dx + dy * dy;
      if (d > threshold2) continue;
      if (frame.t > bestTime || (frame.t === bestTime && d < bestDist)) {
        best = projectile;
        bestTime = frame.t;
        bestDist = d;
      }
    }
  }

  return best ? { projectile: best, time: bestTime } : null;
}

function effectHandoffProjectile(
  frames: ProjectileSample[],
  effect: UtilityEffect,
  time: number,
  ignoredProjectileIds?: Set<number>,
): ProjectilePos | null {
  if (time >= projectileHideStart(effect)) return null;
  if (liveProjectileForEffect(frames, effect, time, ignoredProjectileIds)) return null;
  const last = lastProjectileBeforeEffect(frames, effect);
  if (!last || time < last.time || effect.start - last.time > 1.25) return null;
  const span = Math.max(0.08, effect.start - last.time);
  const progress = Math.max(0, Math.min(1, (time - last.time) / span));
  return {
    id: last.projectile.id,
    type: last.projectile.type ?? projectileTypeForEffect(effect),
    x: last.projectile.x + (effect.x - last.projectile.x) * progress,
    y: last.projectile.y + (effect.y - last.projectile.y) * progress,
    z: last.projectile.z + (effect.z - last.projectile.z) * progress,
    thrower: last.projectile.thrower,
  };
}

function decoyProjectileTracks(frames: ProjectileSample[]) {
  const tracks = new Map<number, { projectile: ProjectilePos; first: number; last: number; samples: number; landedAt: number | null }>();

  for (const frame of frames) {
    for (const projectile of frame.projectiles ?? []) {
      if (projectileTypeToEffect(projectile.type) !== "decoy") continue;
      const track = tracks.get(projectile.id);
      if (!track) {
        tracks.set(projectile.id, { projectile, first: frame.t, last: frame.t, samples: 1, landedAt: null });
        continue;
      }
      const dt = Math.max(0.001, frame.t - track.last);
      const speed = Math.hypot(projectile.x - track.projectile.x, projectile.y - track.projectile.y, projectile.z - track.projectile.z) / dt;
      if (track.landedAt === null && speed < 40 && frame.t - track.first > 0.15) track.landedAt = frame.t;
      track.projectile = projectile;
      track.last = frame.t;
      track.samples += 1;
    }
  }

  return [...tracks.entries()].map(([id, track]) => ({
    id,
    type: track.projectile.type,
    thrower: track.projectile.thrower ?? null,
    first: Number(track.first.toFixed(3)),
    last: Number(track.last.toFixed(3)),
    landedAt: track.landedAt === null ? null : Number(track.landedAt.toFixed(3)),
    samples: track.samples,
    x: Math.round(track.projectile.x),
    y: Math.round(track.projectile.y),
    z: Math.round(track.projectile.z),
  }));
}

function decoyLandingStart(effect: UtilityEffect, frames: ProjectileSample[]): number | null {
  if (effect.type !== "decoy") return null;
  const tracks = decoyProjectileTracks(frames);
  let best: (typeof tracks)[number] | null = null;
  let bestDist = Infinity;

  for (const track of tracks) {
    if (track.landedAt === null) continue;
    const dx = track.x - effect.x;
    const dy = track.y - effect.y;
    const dz = track.z - effect.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 120 || d >= bestDist) continue;
    best = track;
    bestDist = d;
  }

  return best?.landedAt ?? null;
}

function resolveDecoyEffect(effect: UtilityEffect, frames: ProjectileSample[]): UtilityEffect {
  if (effect.type !== "decoy") return effect;
  const landedAt = decoyLandingStart(effect, frames);
  if (landedAt === null || landedAt >= effect.start) return effect;
  return {
    ...effect,
    start: landedAt,
    end: landedAt + 15,
  };
}

function resolveFireEffect(effect: UtilityEffect): UtilityEffect {
  if (effect.type !== "fire") return effect;
  const maxEnd = effect.start + FIRE_EFFECT_MAX_DURATION;
  if (effect.end <= maxEnd) return effect;
  return {
    ...effect,
    end: maxEnd,
  };
}

function resolveEffects(effects: UtilityEffect[], frames: ProjectileSample[]): UtilityEffect[] {
  return effects.map((effect) => resolveFireEffect(resolveDecoyEffect(effect, frames)));
}

function buildProjectileTracks(frames: ProjectileSample[]): Map<number, ProjectileTrack> {
  const tracks = new Map<number, ProjectileTrack>();
  for (const frame of frames) {
    for (const projectile of frame.projectiles ?? []) {
      let track = tracks.get(projectile.id);
      if (!track) {
        track = {
          samples: [],
          first: frame.t,
          last: frame.t,
          samplesCount: 0,
          moved: false,
        };
        tracks.set(projectile.id, track);
      }
      const previous = track.samples[track.samples.length - 1]?.projectile;
      if (previous) {
        const distance = Math.hypot(projectile.x - previous.x, projectile.y - previous.y, projectile.z - previous.z);
        if (distance > 2) track.moved = true;
      }
      track.samples.push({ t: frame.t, projectile });
      track.first = track.first ?? frame.t;
      track.last = frame.t;
      track.samplesCount++;
    }
  }
  return tracks;
}

function getRoundRenderCache(round: Round): RoundRenderCache {
  const cached = roundRenderCache.get(round);
  if (cached) return cached;
  const projectileFrames = projectileSamples(round);
  const cache = {
    projectileFrames,
    projectileTracks: buildProjectileTracks(projectileFrames),
    resolvedEffects: resolveEffects(round.effects ?? [], projectileFrames),
    deathMarkers: (round.events ?? [])
      .filter((event) => event.type === "kill" && Boolean(event.victim))
      .flatMap((event) => {
        const victimPos = playerPositionAtOrBefore(round.frames, event.victim ?? 0, event.t);
        return victimPos ? [{ t: event.t, x: victimPos.x, y: victimPos.y, z: victimPos.z }] : [];
      }),
    fixedProjectileSamples: new Map(),
  };
  roundRenderCache.set(round, cache);
  return cache;
}

function sampleProjectilesFixed(cache: RoundRenderCache, t: number): ProjectilePos[] {
  const key = Math.round(t * 1000);
  const cached = cache.fixedProjectileSamples.get(key);
  if (cached) return cached;
  const samples = sampleProjectiles(cache.projectileFrames, t);
  cache.fixedProjectileSamples.set(key, samples);
  return samples;
}

function isSameVisualProjectile(a: ProjectilePos, b: ProjectilePos): boolean {
  if (a.id === b.id) return true;
  const type = projectileTypeToEffect(a.type);
  if (!type || projectileTypeToEffect(b.type) !== type) return false;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz <= 80 * 80;
}

function visibleProjectiles(
  frames: ProjectileSample[],
  time: number,
  startedEffects: UtilityEffect[],
  detonatedIds: Set<number>
): ProjectilePos[] {
  const out = new Map<number, ProjectilePos>();
  for (const projectile of sampleProjectiles(frames, time)) {
    if (detonatedIds.has(projectile.id)) continue;
    if (projectileResolvedByEffect(projectile, startedEffects, time, frames)) continue;
    if ([...out.values()].some((current) => isSameVisualProjectile(current, projectile))) continue;
    out.set(projectile.id, projectile);
  }

  const pair = framePair(frames, time);
  if (pair && pair.a !== pair.b && pair.b.t - time <= 0.16) {
    for (const projectile of pair.b.projectiles ?? []) {
      if (out.has(projectile.id) || detonatedIds.has(projectile.id)) continue;
      if (projectileResolvedByEffect(projectile, startedEffects, time, frames)) continue;

      if ([...out.values()].some((current) => isSameVisualProjectile(current, projectile))) continue;
      out.set(projectile.id, projectile);
    }
  }

  for (const effect of startedEffects) {
    const handoff = effectHandoffProjectile(frames, effect, time, detonatedIds);
    if (!handoff) continue;
    if ([...out.values()].some((current) => isSameVisualProjectile(current, handoff))) continue;
    out.set(handoff.id, handoff);
  }

  return [...out.values()];
}

function summarizeProjectileRound(round: Round, projectileFrames: ProjectileSample[], effects: UtilityEffect[]) {
  const tracks = new Map<
    number,
    {
      id: number;
      type: string;
      thrower: number | null;
      samples: number;
      first: number;
      last: number;
      valid: number;
      invalid: number;
      moved: boolean;
      firstPos?: ProjectilePos;
      lastPos?: ProjectilePos;
    }
  >();
  const frameCounts = {
    frames: round.frames.length,
    projectileFrames: round.projectileFrames?.length ?? 0,
    samplesSource: round.projectileFrames?.length ? "projectileFrames" : "frames",
    samplesWithProjectiles: 0,
  };

  for (const frame of projectileFrames) {
    const projectiles = frame.projectiles ?? [];
    if (projectiles.length) frameCounts.samplesWithProjectiles++;
    for (const projectile of projectiles) {
      const valid = [projectile.x, projectile.y, projectile.z].every(Number.isFinite);
      const track = tracks.get(projectile.id);
      if (!track) {
        tracks.set(projectile.id, {
          id: projectile.id,
          type: projectile.type,
          thrower: projectile.thrower ?? null,
          samples: 1,
          first: frame.t,
          last: frame.t,
          valid: valid ? 1 : 0,
          invalid: valid ? 0 : 1,
          moved: false,
          firstPos: valid ? projectile : undefined,
          lastPos: valid ? projectile : undefined,
        });
        continue;
      }
      track.samples++;
      track.last = frame.t;
      if (valid) {
        track.valid++;
        if (track.lastPos) {
          const dist = Math.hypot(projectile.x - track.lastPos.x, projectile.y - track.lastPos.y, projectile.z - track.lastPos.z);
          if (dist > 1) track.moved = true;
        }
        track.lastPos = projectile;
      } else {
        track.invalid++;
      }
    }
  }

  const typeCounts = new Map<string, number>();
  const rejected: Array<{ id: number; type: string; reason: string; samples: number; first: number; last: number }> = [];
  let usableTrajectories = 0;
  for (const track of tracks.values()) {
    const effectType = projectileTypeToEffect(track.type) ?? "unknown";
    typeCounts.set(effectType, (typeCounts.get(effectType) ?? 0) + 1);
    let reason: string | null = null;
    if (track.samples < 2) reason = "path too short";
    else if (track.valid < 2) reason = "invalid coordinates";
    else if (!track.moved) reason = "static path";
    if (reason) {
      rejected.push({
        id: track.id,
        type: track.type,
        reason,
        samples: track.samples,
        first: formatProjectileDebugNumber(track.first) ?? track.first,
        last: formatProjectileDebugNumber(track.last) ?? track.last,
      });
    } else {
      usableTrajectories++;
    }
  }

  const effectCounts = new Map<string, number>();
  for (const effect of effects) {
    const key = effect.type === "fire" && effect.variant ? `${effect.type}:${effect.variant}` : effect.type;
    effectCounts.set(key, (effectCounts.get(key) ?? 0) + 1);
  }

  return {
    roundNumber: round.number,
    startTick: round.startTick,
    endTick: round.endTick,
    frameCounts,
    totalProjectileTracks: tracks.size,
    usableTrajectories,
    rejectedTrajectories: rejected.length,
    projectileTypes: Object.fromEntries([...typeCounts.entries()].sort()),
    effects: Object.fromEntries([...effectCounts.entries()].sort()),
    effectCount: effects.length,
    rejectedExamples: rejected.slice(0, 30),
  };
}

function projectileEffectMatchDebug(
  projectile: ProjectilePos,
  effects: UtilityEffect[],
  frames: ProjectileSample[],
  time: number,
) {
  const type = projectileTypeToEffect(projectile.type);
  if (!type) return null;
  let best: {
    effect: UtilityEffect;
    distance: number;
    hideStart: number;
    touches: boolean;
    seenNear: boolean;
    started: boolean;
  } | null = null;

  for (const effect of effects) {
    if (effect.type !== type) continue;
    const distance = projectileDebugDistance(projectile, effect);
    if (best && distance >= best.distance) continue;
    best = {
      effect,
      distance,
      hideStart: projectileHideStart(effect),
      touches: projectileTouchesEffect(projectile, effect, frames, time),
      seenNear: projectileSeenNearEffect(projectile, effect, frames),
      started: time >= projectileHideStart(effect),
    };
  }

  return best;
}

function projectileHiddenReasonDebug(
  projectile: ProjectilePos,
  existing: ProjectilePos[],
  effects: UtilityEffect[],
  detonatedIds: Set<number>,
  frames: ProjectileSample[],
  time: number,
) {
  if (detonatedIds.has(projectile.id)) {
    return { reason: "hidden by detonatedIds", match: projectileEffectMatchDebug(projectile, effects, frames, time) };
  }
  const match = projectileEffectMatchDebug(projectile, effects, frames, time);
  if (match && match.started && (match.touches || match.seenNear)) {
    return { reason: "hidden by effect resolution", match };
  }
  if (existing.some((current) => isSameVisualProjectile(current, projectile))) {
    return { reason: "duplicate visual projectile", match };
  }
  return null;
}

function projectileRenderIssueDebug(
  projectile: ProjectilePos,
  raw: { x: number; y: number }[],
  current: { x: number; y: number },
  layer: Container,
  size: number,
) {
  if ([projectile.x, projectile.y, projectile.z].some((value) => !Number.isFinite(value))) return "invalid coordinates";
  if (raw.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return "invalid radar path";
  if (raw.length < 2) return "path too short";
  if (current.x < -64 || current.y < -64 || current.x > size + 64 || current.y > size + 64) return "outside map bounds";
  if (!layer.visible) return "layer invisible";
  if (layer.alpha === 0) return "alpha zero";
  if (layer.destroyed) return "object destroyed";
  return null;
}

function fitSprite(sprite: Sprite, max: number) {
  const tex = sprite.texture;
  if (!tex || !tex.width || !tex.height) {
    sprite.width = max;
    sprite.height = max;
    return;
  }
  const ratio = tex.width / tex.height;
  if (ratio >= 1) {
    sprite.width = max;
    sprite.height = max / ratio;
  } else {
    sprite.height = max;
    sprite.width = max * ratio;
  }
}

function fitSpriteBox(sprite: Sprite, maxWidth: number, maxHeight: number) {
  const tex = sprite.texture;
  if (!tex || !tex.width || !tex.height) {
    sprite.width = maxWidth;
    sprite.height = maxHeight;
    return;
  }
  const ratio = tex.width / tex.height;
  if (ratio >= maxWidth / maxHeight) {
    sprite.width = maxWidth;
    sprite.height = maxWidth / ratio;
  } else {
    sprite.height = maxHeight;
    sprite.width = maxHeight * ratio;
  }
}

function heldWeaponBox(name?: string): { width: number; height: number } {
  const n = name?.toLowerCase() ?? "";
  if (/c4|bomb/.test(n)) {
    return { width: 18, height: 18 };
  }
  if (/grenade|flashbang|molotov|incendiary|decoy|c4|bomb/.test(n)) {
    return { width: 15, height: 15 };
  }
  if (/knife|bayonet|karambit/.test(n)) {
    return { width: 24, height: 12 };
  }
  if (/deagle|revolver|usp|glock|p2000|p250|five|tec|cz|elite|dual/.test(n)) {
    return { width: 23, height: 11 };
  }
  if (/awp|ssg|scout|scar|g3sg/.test(n)) {
    return { width: 34, height: 10 };
  }
  if (/nova|xm1014|sawed|mag-7|mag7|m249|negev/.test(n)) {
    return { width: 33, height: 11 };
  }
  return { width: 31, height: 10 };
}

function isUtilityWeapon(name?: string) {
  const n = name?.toLowerCase() ?? "";
  return /grenade|flashbang|molotov|incendiary|decoy|c4|bomb/.test(n);
}

function isBombWeapon(name?: string) {
  return /c4|bomb/i.test(name ?? "");
}

function playerCarriesBomb(player: PlayerPos) {
  return (
    Boolean(player.hasBomb) ||
    isBombWeapon(player.active) ||
    Boolean(player.weapons?.some(isBombWeapon))
  );
}

function roundFramesWithBombFallback(round: Round): Frame[] {
  if (round.frames.some((frame) => frame.bomb)) return round.frames;
  const cached = bombFrameFallbackCache.get(round);
  if (cached) return cached;

  const bombEvents = (round.events ?? [])
    .filter((event) => event.type.startsWith("bomb_"))
    .slice()
    .sort((a, b) => a.t - b.t);
  let eventIdx = 0;
  let lastBomb: BombState | null = null;
  let planted = false;

  const frames = round.frames.map((frame) => {
    while (eventIdx < bombEvents.length && bombEvents[eventIdx].t <= frame.t) {
      const event = bombEvents[eventIdx];
      if (event.type === "bomb_planted") {
        planted = true;
        const carrier = frame.players.find(playerCarriesBomb);
        const x = lastBomb?.x ?? carrier?.x ?? 0;
        const y = lastBomb?.y ?? carrier?.y ?? 0;
        const z = lastBomb?.z ?? carrier?.z ?? 0;
        if (x !== 0 || y !== 0 || z !== 0) {
          lastBomb = { x, y, z, status: "planted" };
        }
      } else if (event.type === "bomb_defused" || event.type === "bomb_exploded") {
        planted = false;
        lastBomb = null;
      }
      eventIdx++;
    }

    let bomb: BombState | undefined;
    if (planted && lastBomb?.status === "planted") {
      bomb = lastBomb;
    } else {
      const carrier = frame.players.find(playerCarriesBomb);
      if (carrier) {
        bomb = {
          x: carrier.x,
          y: carrier.y,
          z: carrier.z,
          status: "carried",
          carrier: carrier.id,
        };
        lastBomb = bomb;
      } else if (lastBomb?.status === "dropped") {
        bomb = {
          x: lastBomb.x,
          y: lastBomb.y,
          z: lastBomb.z,
          status: "dropped",
        };
        lastBomb = bomb;
      }
    }

    return bomb ? { ...frame, bomb } : frame;
  });

  bombFrameFallbackCache.set(round, frames);
  return frames;
}

function isKnifeWeapon(name?: string) {
  const n = name?.toLowerCase() ?? "";
  return /knife|bayonet|karambit/.test(n);
}

function isPistolWeapon(name?: string) {
  const n = name?.toLowerCase() ?? "";
  return /deagle|revolver|usp|glock|p2000|p250|five|tec|cz|elite|dual/.test(n);
}

const SHOOT_ROTATION_OFFSET = 0;
const PLAYER_ARROW_TIP_OFFSET = 9;
const WEAPON_FIRE_SCALE = 0.64;

function teamColor(team?: number) {
  if (team === 3) return 0x5ab0ff;
  if (team === 2) return 0xf5b042;
  return 0xe5e7eb;
}

function teamDarkColor(team?: number) {
  if (team === 3) return 0x195066;
  if (team === 2) return 0x795322;
  return 0x303030;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number) {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 3);
}

function mixColor(from: number, to: number, amount: number) {
  const t = clamp01(amount);
  const fr = (from >> 16) & 0xff;
  const fg = (from >> 8) & 0xff;
  const fb = from & 0xff;
  const tr = (to >> 16) & 0xff;
  const tg = (to >> 8) & 0xff;
  const tb = to & 0xff;
  return (
    (Math.round(fr + (tr - fr) * t) << 16) |
    (Math.round(fg + (tg - fg) * t) << 8) |
    Math.round(fb + (tb - fb) * t)
  );
}

function activeDefuse(
  events: MatchEvent[],
  positions: PlayerPos[],
  bomb: BombState,
  time: number
): { start: number; duration: number; player?: number } | null {
  let active: { start: number; duration: number; player?: number } | null = null;
  for (const event of events) {
    if (event.t > time) break;
    if (event.type === "bomb_defuse_start") {
      active = { start: event.t, duration: event.hasKit ? 5 : 10, player: event.player };
    } else if (
      event.type === "bomb_defuse_abort" ||
      event.type === "bomb_defused" ||
      event.type === "bomb_exploded" ||
      event.type === "round_end"
    ) {
      active = null;
    }
  }
  if (!active) return null;
  const isDefusingFrame = (players: PlayerPos[]) => {
    if (active.player) {
      const defuser = players.find((player) => player.id === active!.player);
      return Boolean(defuser && defuser.hp > 0 && defuser.use === true);
    }
    return players.some((player) => {
      if (player.hp <= 0 || player.team !== 3 || player.use !== true) return false;
      const dx = player.x - bomb.x;
      const dy = player.y - bomb.y;
      const dz = player.z - bomb.z;
      return dx * dx + dy * dy + dz * dz <= 140 * 140;
    });
  };
  if (active?.player) {
    const defuser = positions.find((player) => player.id === active!.player);
    if (!defuser || defuser.hp <= 0 || defuser.use !== true) return null;
  } else if (!isDefusingFrame(positions)) {
    return null;
  }
  return active;
}

function recentlyDefusedBomb(round: Round, frames: Frame[], time: number): BombState | null {
  let defusedAt: number | null = null;
  for (const event of round.events) {
    if (event.t > time) break;
    if (event.type === "bomb_defused") {
      defusedAt = event.t;
    } else if (event.type === "bomb_planted" || event.type === "bomb_exploded") {
      defusedAt = null;
    }
  }
  if (defusedAt === null) return null;
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    if (frame.t > defusedAt) continue;
    if (frame.bomb?.status === "planted") return frame.bomb;
  }
  return null;
}

function activeBombPlantTime(round: Round, time: number): number | null {
  let plantedAt: number | null = null;
  for (const event of round.events) {
    if (event.t > time) break;
    if (event.type === "bomb_planted") {
      plantedAt = event.t;
    } else if (event.type === "bomb_defused" || event.type === "bomb_exploded") {
      plantedAt = null;
    }
  }
  return plantedAt;
}

function plantedBombAt(frames: Frame[], time: number): BombState | null {
  for (let i = frames.length - 1; i >= 0; i--) {
    const frame = frames[i];
    if (frame.t > time) continue;
    if (frame.bomb?.status === "planted") return frame.bomb;
  }
  return null;
}

function recentBombExplosion(round: Round, frames: Frame[], time: number): { bomb: BombState; age: number } | null {
  let explodedAt: number | null = null;
  for (const event of round.events) {
    if (event.t > time) break;
    if (event.type === "bomb_exploded") explodedAt = event.t;
  }
  if (explodedAt === null || time - explodedAt > 1.15) return null;
  const bomb = plantedBombAt(frames, explodedAt);
  return bomb ? { bomb, age: time - explodedAt } : null;
}

function bombPulseProgress(plantedAt: number, time: number) {
  const elapsed = clamp01((time - plantedAt) / BOMB_SECONDS) * BOMB_SECONDS;
  const startHz = 1;
  const endHz = 5;
  const cycles = startHz * elapsed + ((endHz - startHz) * elapsed * elapsed) / (2 * BOMB_SECONDS);
  return cycles % 1;
}

function displayName(name?: string) {
  return name === "L999" ? "grosNoob" : name ?? "";
}

type PlayerSprite = {
  container: Container;
  dot: Graphics;
  hpRing: Graphics;
  arrow: Graphics;
  arrowRotator: Container;
  muzzleFlash: Graphics;
  labelBadge: Container;
  labelFill: Text;
  labelEmpty: Text;
  labelFillMask: Graphics;
  labelEmptyMask: Graphics;
  held: Sprite;
  heldPath: string | null;
  actionGroup: Container;
  action: Sprite;
  actionFill: Sprite;
  actionFillMask: Graphics;
  actionPath: string | null;
  flashArc: Graphics;
};

type BombSprite = {
  container: Container;
  marker: Graphics;
  icon: Sprite;
};

type DisposableDisplayObject = Container | Graphics | Sprite | Text;

function queueLayerChildrenForDestroy(layer: Container, queue: DisposableDisplayObject[]): void {
  queue.push(...(layer.removeChildren() as DisposableDisplayObject[]));
}

function drainDestroyQueue(queue: DisposableDisplayObject[], maxItems = 16, maxMs = 1.2): void {
  const started = performance.now();
  for (let i = 0; i < maxItems && queue.length > 0; i++) {
    if (performance.now() - started > maxMs) break;
    const child = queue.shift();
    if (child && !child.destroyed) child.destroy({ children: true });
  }
}

function heightLift(z: number) {
  return Math.max(0, Math.min(22, Math.abs(z) / 35));
}

function projectileGroundZ(track: ProjectileTrack | undefined, fallbackZ: number): number {
  if (!track || track.samples.length === 0) return fallbackZ;
  return track.samples.reduce((lowest, sample) => Math.min(lowest, sample.projectile.z), track.samples[0].projectile.z);
}

function projectileHeightAboveGround(projectile: ProjectilePos, track: ProjectileTrack | undefined): number {
  return Math.max(0, projectile.z - projectileGroundZ(track, projectile.z));
}

function drawUtilityIcon(
  layer: Container,
  name: string,
  x: number,
  y: number,
  color: number,
  max = 16
) {
  const path = iconPathFor(name);
  if (!path) return;
  const sprite = new Sprite();
  sprite.anchor.set(0.5);
  sprite.position.set(x, y);
  sprite.tint = color;
  layer.addChild(sprite);
  const ready = cachedIconTexture(path);
  if (ready) {
    sprite.texture = ready;
    fitSprite(sprite, max);
    return;
  }
  loadIconTexture(path)
    .then((tex) => {
      if (sprite.destroyed) return;
      sprite.texture = tex;
      fitSprite(sprite, max);
    })
    .catch(() => {});
}

function drawFireMarker(layer: Container, x: number, y: number) {
  const g = new Graphics();
  g.position.set(x, y);
  g.moveTo(0, -11)
    .bezierCurveTo(8, -3, 9, 5, 2, 11)
    .bezierCurveTo(-8, 6, -7, -2, -2, -8)
    .bezierCurveTo(-1, -4, 2, -2, 0, -11)
    .fill({ color: 0xf97316, alpha: 0.88 });
  g.moveTo(1, -5)
    .bezierCurveTo(5, 1, 4, 6, 0, 9)
    .bezierCurveTo(-4, 5, -3, 0, 1, -5)
    .fill({ color: 0xfde047, alpha: 0.88 });
  g.circle(0, 2, 9).stroke({ color: 0xfffbeb, width: 1.2, alpha: 0.55 });
  layer.addChild(g);
}

function drawTimerArc(
  g: Graphics,
  cx: number,
  cy: number,
  radius: number,
  lifeRemaining: number, // 0..1 where 1 = full
  color: number,
  width: number
) {
  if (lifeRemaining <= 0) return;
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * Math.min(1, lifeRemaining);
  g.moveTo(cx + Math.cos(start) * radius, cy + Math.sin(start) * radius);
  g.arc(cx, cy, radius, start, end);
  g.stroke({ color, width, alpha: 0.95 });
}

function drawCountdownLabel(layer: Container, text: string, x: number, y: number, color = 0xc8c8c8) {
  const segments: Record<string, Array<"a" | "b" | "c" | "d" | "e" | "f" | "g">> = {
    "0": ["a", "b", "c", "d", "e", "f"],
    "1": ["b", "c"],
    "2": ["a", "b", "d", "e", "g"],
    "3": ["a", "b", "c", "d", "g"],
    "4": ["b", "c", "f", "g"],
    "5": ["a", "c", "d", "f", "g"],
    "6": ["a", "c", "d", "e", "f", "g"],
    "7": ["a", "b", "c"],
    "8": ["a", "b", "c", "d", "e", "f", "g"],
    "9": ["a", "b", "c", "d", "f", "g"],
  };
  const chars = text.split("").filter((char) => segments[char]);
  if (!chars.length) return;
  const digitW = 7;
  const digitH = 12;
  const gap = 2;
  const thickness = 1.6;
  const totalW = chars.length * digitW + (chars.length - 1) * gap;
  const g = new Graphics();
  g.position.set(x - totalW / 2, y - digitH / 2);
  const rect = (rx: number, ry: number, rw: number, rh: number) => {
    g.roundRect(rx, ry, rw, rh, thickness / 2).fill({ color, alpha: 0.95 });
  };
  chars.forEach((char, index) => {
    const ox = index * (digitW + gap);
    for (const segment of segments[char]) {
      if (segment === "a") rect(ox + thickness, 0, digitW - thickness * 2, thickness);
      else if (segment === "b") rect(ox + digitW - thickness, thickness, thickness, digitH / 2 - thickness);
      else if (segment === "c") rect(ox + digitW - thickness, digitH / 2, thickness, digitH / 2 - thickness);
      else if (segment === "d") rect(ox + thickness, digitH - thickness, digitW - thickness * 2, thickness);
      else if (segment === "e") rect(ox, digitH / 2, thickness, digitH / 2 - thickness);
      else if (segment === "f") rect(ox, thickness, thickness, digitH / 2 - thickness);
      else if (segment === "g") rect(ox + thickness, digitH / 2 - thickness / 2, digitW - thickness * 2, thickness);
    }
  });
  layer.addChild(g);
}

function drawEffect(
  layer: Container,
  effect: UtilityEffect,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number,
  contextualEffects: UtilityEffect[] = [],
) {
  const p = toRadar(effect.x, effect.y, 0);
  const age = Math.max(0, time - effect.start);
  const total = Math.max(0.1, effect.end - effect.start);
  const life = Math.max(0, Math.min(1, age / total));
  const remaining = 1 - life;
  const g = new Graphics();

  if (effect.type === "smoke") {
    const fadeIn = Math.min(1, age / 0.6);
    const fadeOut = life > 0.92 ? 1 - (life - 0.92) / 0.08 : 1;
    const alpha = Math.max(0, fadeIn * fadeOut);
    const radius = 156 * unitsToPx;
    const teamCol = teamColor(effect.team);
    g.circle(p.x, p.y, radius).fill({
      color: 0x9ca3af,
      alpha: 0.42 * alpha * smokeBlastClearAlpha(effect, contextualEffects, time),
    });
    drawTimerArc(g, p.x, p.y, radius, remaining, teamCol, 1.7);
    const secsLeft = Math.max(0, Math.ceil(effect.end - time));
    layer.addChild(g);
    drawCountdownLabel(layer, String(secsLeft), p.x, p.y, 0xb8b8b8);
    return;
  }

  if (effect.type === "flash") {
    const pulseR = 8 + life * 36;
    g.circle(p.x, p.y, pulseR)
      .stroke({ color: 0xfffbeb, width: 3, alpha: 1 - life });
    if (life < 0.25) {
      g.circle(p.x, p.y, 14)
        .fill({ color: 0xffffff, alpha: 0.95 * (1 - life * 4) });
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const inner = 16;
        const outer = 16 + (1 - life * 4) * 18;
        g.moveTo(p.x + Math.cos(ang) * inner, p.y + Math.sin(ang) * inner)
          .lineTo(p.x + Math.cos(ang) * outer, p.y + Math.sin(ang) * outer)
          .stroke({ color: 0xffffff, width: 2.5, alpha: 0.9 * (1 - life * 4) });
      }
    }
    layer.addChild(g);
    return;
  }

  if (effect.type === "he") {
    // HE damage radius ≈ 350 world units.
    const maxR = 200 * unitsToPx;
    const t01 = Math.min(1, age / 0.9);
    // White-hot flash in the first 120ms
    if (age < 0.12) {
      const flashA = 1 - age / 0.12;
      const flashR = maxR * 0.35;
      g.circle(p.x, p.y, flashR).fill({ color: 0xfffbeb, alpha: 0.95 * flashA });
    }
    // Expanding shockwave
    const r = maxR * t01;
    const alpha = 1 - t01;
    g.circle(p.x, p.y, r * 0.75).fill({ color: 0xf97316, alpha: 0.35 * alpha });
    g.circle(p.x, p.y, r).stroke({ color: 0xfbbf24, width: 4, alpha });
    g.circle(p.x, p.y, r + 4).stroke({ color: 0xfffbeb, width: 1.5, alpha: 0.7 * alpha });
    // Bright core that fades
    const coreR = 10 * unitsToPx + t01 * 8;
    g.circle(p.x, p.y, coreR).fill({ color: 0xfde047, alpha: 0.9 * alpha });
    layer.addChild(g);
    return;
  }

  if (effect.type === "fire") {
    const radius = fireRadiusWorld(effect) * unitsToPx;
    const alpha = Math.min(1, age / 0.25) * (life > 0.92 ? 1 - (life - 0.92) / 0.08 : 1);
    g.circle(p.x, p.y, radius).fill({ color: teamDarkColor(effect.team), alpha: 0.32 * alpha });
    drawTimerArc(g, p.x, p.y, radius, remaining, teamColor(effect.team), 1.7);
    layer.addChild(g);
    drawFireMarker(layer, p.x, p.y);
    const secsLeft = Math.max(0, Math.ceil(effect.end - time));
    drawCountdownLabel(layer, String(secsLeft), p.x, p.y + 2, 0x3a3a3a);
    return;
  }

  if (effect.type === "decoy") {
    const wobbleX = Math.sin(time * 17) * 2.2;
    const wobbleY = Math.cos(time * 13) * 1.6;
    const rot = Math.sin(time * 20) * 0.22;
    drawUtilityIcon(layer, "decoy", p.x + wobbleX + Math.cos(rot) * 1.5, p.y + wobbleY + Math.sin(rot) * 1.5, 0xa78bfa);
    return;
  }

  if (effect.type === "bomb_planted") {
    const pulse = (time * 1.5) % 1;
    const radius = 19 * pulse;
    const alpha = 0.75 * (1 - pulse);
    g.circle(p.x, p.y, radius).stroke({ color: 0xef4444, width: 2, alpha });
    layer.addChild(g);
    drawUtilityIcon(layer, "c4", p.x, p.y, 0xef4444, 18);
  }
}

function drawProjectile(
  layer: Container,
  projectile: ProjectilePos,
  projectileTrack: ProjectileTrack | undefined,
  time: number,
  throwerTeams: Map<number, number>,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  handoff: ProjectileEffectHandoff | null = null,
) {
  const throwerTeam = projectile.thrower ? throwerTeams.get(projectile.thrower) : undefined;
  const color = teamColor(throwerTeam);
  const raw = projectileHistoryFromTrack(projectileTrack, projectile, time, toRadar);
  if (handoff?.active) {
    const impact = toRadar(handoff.effect.x, handoff.effect.y, 0);
    const tail = raw[raw.length - 1];
    if (!tail || Math.hypot(impact.x - tail.x, impact.y - tail.y) > 0.5) raw.push(impact);
  }

  const trail = new Graphics();
  drawSmoothTrail(trail, raw, color);
  if (handoff?.active) {
    trail.alpha = Math.max(
      0,
      1 - (time - handoff.effect.start) / Math.max(0.04, projectileHideStart(handoff.effect) - handoff.effect.start),
    );
  }

  const heightAboveGround = projectileHeightAboveGround(projectile, projectileTrack);
  const p = handoff?.active
    ? toRadar(handoff.effect.x, handoff.effect.y, 0)
    : toRadar(projectile.x, projectile.y, heightAboveGround);
  const shadow = toRadar(projectile.x, projectile.y, 0);
  const shadowDistance = Math.hypot(p.x - shadow.x, p.y - shadow.y);
  const shadowAlpha = 0.14 + Math.min(0.16, shadowDistance / 140);
  const shadowRadius = 4.6 - Math.min(1.4, shadowDistance / 18);
  if (!handoff?.active) {
    trail.circle(shadow.x, shadow.y, shadowRadius).fill({ color: 0x000000, alpha: shadowAlpha });
  }
  layer.addChild(trail);
  if (handoff?.active) return;
  const iconName =
    projectileTypeToEffect(projectile.type) === "fire" && throwerTeam === 3
      ? "incgrenade"
      : projectile.type;
  drawUtilityIcon(layer, iconName, p.x, p.y, color);
}

function drawWeaponFire(
  layer: Container,
  fire: WeaponFireEvent,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  shooterLive?: PlayerPos
) {
  if (isUtilityWeapon(fire.weapon)) return;
  const age = time - fire.t;
  const duration = isKnifeWeapon(fire.weapon) ? 0.18 : 0.14;
  if (age < 0 || age > duration) return;
  const alpha = 1 - age / duration;
  // Anchor the shot to the live interpolated player (same source as the
  // rendered arrow) so position and facing always agree visually.
  // Important: pass z=0 because the player marker itself is rendered
  // without heightLift, so we must not offset the shot either.
  const start = shooterLive
    ? toRadar(shooterLive.x, shooterLive.y, 0)
    : toRadar(fire.x, fire.y, 0);
  const yaw = shooterLive ? shooterLive.yaw : fire.yaw;
  const angle = (-yaw * Math.PI) / 180;
  // shoot.svg naturally points to the right (angle 0). quick-slash too.
  // We rotate in-place from the sprite center and then push it forward so
  // the sprite's back edge sits exactly at the arrow tip.
  const isKnife = isKnifeWeapon(fire.weapon);
  const spriteAngle = angle + SHOOT_ROTATION_OFFSET;

  // Target box for this weapon.
  const pistol = !isKnife && isPistolWeapon(fire.weapon);
  const maxW = (isKnife ? 26 : pistol ? 22 : 30) * WEAPON_FIRE_SCALE;
  const maxH = (isKnife ? 18 : pistol ? 13 : 16) * WEAPON_FIRE_SCALE;

  // Compute the final forward offset synchronously so the sprite is
  // correctly placed on the very first frame, even before the texture
  // resolves. We approximate width by maxW (exact for shoot.svg, near
  // exact for quick-slash once loaded).
  const forward = PLAYER_ARROW_TIP_OFFSET + maxW / 2;
  const px = start.x + Math.cos(angle) * forward;
  const py = start.y + Math.sin(angle) * forward;
  const texturePath = isKnife ? "/icons/quick-slash.svg" : "/icons/shoot.svg";
  const readyTexture = cachedIconTexture(texturePath);

  if (!readyTexture) {
    const fallback = new Graphics();
    fallback.position.set(start.x, start.y);
    fallback.rotation = angle;
    if (isKnife) {
      fallback
        .moveTo(PLAYER_ARROW_TIP_OFFSET + 2, -6 * WEAPON_FIRE_SCALE)
        .lineTo(PLAYER_ARROW_TIP_OFFSET + maxW + 4, 0)
        .lineTo(PLAYER_ARROW_TIP_OFFSET + 2, 6 * WEAPON_FIRE_SCALE)
        .stroke({ color: 0xf8fafc, width: 1.7, alpha: 0.85 * alpha });
    } else {
      const tip = PLAYER_ARROW_TIP_OFFSET + maxW + 7;
      fallback
        .moveTo(PLAYER_ARROW_TIP_OFFSET, 0)
        .lineTo(tip, -maxH * 0.32)
        .lineTo(tip - 5, 0)
        .lineTo(tip, maxH * 0.32)
        .fill({ color: 0xfff2a6, alpha: 0.55 * alpha });
      fallback.circle(PLAYER_ARROW_TIP_OFFSET + 3, 0, 1.5).fill({ color: 0xffffff, alpha: 0.75 * alpha });
    }
    layer.addChild(fallback);
  }

  const sprite = new Sprite();
  sprite.anchor.set(0.5, 0.5);
  sprite.position.set(px, py);
  sprite.rotation = spriteAngle;
  sprite.alpha = 0.95 * alpha;
  layer.addChild(sprite);

  const applyTexture = (tex: Texture) => {
    if (sprite.destroyed) return;
    sprite.texture = tex;
    fitSpriteBox(sprite, maxW, maxH);
    // Refine using the true rendered width (matters for quick-slash whose
    // aspect is narrower than its max box).
    const trueForward = PLAYER_ARROW_TIP_OFFSET + sprite.width / 2;
    sprite.position.set(
      start.x + Math.cos(angle) * trueForward,
      start.y + Math.sin(angle) * trueForward
    );
  };
  if (readyTexture) {
    applyTexture(readyTexture);
    return;
  }
  loadIconTexture(texturePath)
    .then(applyTexture)
    .catch(() => {
      sprite.destroy();
    });
}

function drawDeathMarker(layer: Container, x: number, y: number, age: number) {
  const alpha = Math.max(0.45, 1 - age / 18);
  const g = new Graphics();
  g.circle(x, y, 7.2).fill({ color: 0x1d1f1f, alpha: 0.78 * alpha });
  g.circle(x, y, 7.2).stroke({ color: 0xef4444, width: 1.8, alpha: 0.95 * alpha });
  g.moveTo(x - 4, y - 4)
    .lineTo(x + 4, y + 4)
    .moveTo(x + 4, y - 4)
    .lineTo(x - 4, y + 4)
    .stroke({ color: 0xffffff, width: 1.5, alpha: 0.9 * alpha });
  layer.addChild(g);
}

export function MapRenderer({ size = 800, condensed = false }: { size?: number; condensed?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(size);
  const appRef = useRef<Application | null>(null);
  const bgLayerRef = useRef<Container | null>(null);
  const habitLayerRef = useRef<Container | null>(null);
  const utilityLayerRef = useRef<Container | null>(null);
  const bombLayerRef = useRef<Container | null>(null);
  const playerLayerRef = useRef<Container | null>(null);
  const deathLayerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Map<number, PlayerSprite>>(new Map());
  const bombSpriteRef = useRef<BombSprite | null>(null);
  const loadedMapRef = useRef<string | null>(null);
  const defuseVisualRef = useRef<{ key: string; start: number; lastTime: number } | null>(null);
  const deferredDestroyRef = useRef<DisposableDisplayObject[]>([]);
  const projectileDebugRoundRef = useRef<string | null>(null);
  const projectileDebugLastFrameLogRef = useRef(0);
  const projectileDebugHiddenRef = useRef<Set<string>>(new Set());
  const projectileDebugAssociationRef = useRef<Set<string>>(new Set());
  const projectileDebugFireSummaryRef = useRef<Set<string>>(new Set());
  const projectileDebugFireVisibleRef = useRef<Set<string>>(new Set());
  const projectileDebugEarlyRef = useRef<Set<string>>(new Set());
  const projectileDebugSuspiciousRef = useRef<Set<string>>(new Set());
  const projectileDebugVisibleReasonRef = useRef<Set<string>>(new Set());
  const projectileDebugDetectedRef = useRef(false);
  const habitOverlay = useReplay((s) => s.habitOverlay);
  const habitOverlayRef = useRef(habitOverlay);
  const preloadMatch = useReplay((s) => s.match);
  const preloadRoundIdx = useReplay((s) => s.currentRoundIdx);

  useEffect(() => {
    habitOverlayRef.current = habitOverlay;
  }, [habitOverlay]);

  // init pixi once
  useEffect(() => {
    const storedDebug = typeof window !== "undefined" ? window.localStorage.getItem(PROJECTILE_DEBUG_KEY) : null;
    if (storedDebug === "1") {
      projectileDebugLogForced(`enabled mapRendererMounted localStorage=${storedDebug}`);
    }
    let disposed = false;
    const host = hostRef.current;
    const sprites = spritesRef.current;
    if (!host) return;

      const app = new Application();
    (async () => {
      await app.init({
        width: 1,
        height: 1,
        antialias: true,
        backgroundAlpha: 0,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      if (disposed) {
        app.destroy(true);
        return;
      }
      const bgLayer = new Container();
      const habitLayer = new Container();
      const utilityLayer = new Container();
      const bombLayer = new Container();
      const playerLayer = new Container();
      const deathLayer = new Container();
      app.stage.addChild(bgLayer);
      app.stage.addChild(habitLayer);
      app.stage.addChild(utilityLayer);
      app.stage.addChild(bombLayer);
      app.stage.addChild(playerLayer);
      app.stage.addChild(deathLayer);
      app.canvas.style.position = "absolute";
      app.canvas.style.inset = "0";
      app.canvas.style.zIndex = "1";
      host.appendChild(app.canvas);
      appRef.current = app;
      bgLayerRef.current = bgLayer;
      habitLayerRef.current = habitLayer;
      utilityLayerRef.current = utilityLayer;
      bombLayerRef.current = bombLayer;
      playerLayerRef.current = playerLayer;
      deathLayerRef.current = deathLayer;
      app.renderer.resize(sizeRef.current, sizeRef.current);
    })();

    return () => {
      disposed = true;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      sprites.clear();
      bombSpriteRef.current = null;
      loadedMapRef.current = null;
      habitLayerRef.current = null;
      deathLayerRef.current = null;
      deferredDestroyRef.current = [];
    };
  }, []);

  useEffect(() => {
    sizeRef.current = size;
    const app = appRef.current;
    if (!app) return;
    app.renderer.resize(size, size);
  }, [size]);

  useEffect(() => {
    if (!preloadMatch) return;
    let cancelled = false;
    const rounds = [
      preloadMatch.rounds[preloadRoundIdx],
      preloadMatch.rounds[preloadRoundIdx + 1],
      preloadMatch.rounds[preloadRoundIdx - 1],
    ].filter((round): round is Round => Boolean(round?.frames.length));
    if (!rounds.length) return;
    const id = window.setTimeout(() => {
      void preloadRoundIconTextures(rounds, () => cancelled);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [preloadMatch, preloadRoundIdx]);

  // load radar when map changes
  const map = useReplay((s) => s.match?.meta.map);

  useEffect(() => {
    let cancel = false;
    const render = async () => {
      for (let i = 0; i < 50 && !habitLayerRef.current; i++) {
        await new Promise((r) => setTimeout(r, 30));
      }
      const layer = habitLayerRef.current;
      if (cancel || !layer) return;
      queueLayerChildrenForDestroy(layer, deferredDestroyRef.current);
      drainDestroyQueue(deferredDestroyRef.current, 24, 2);
      if (!habitOverlay || !map) return;
      if (habitOverlay.mode === "replay") return;
      const calib = MAP_CALIBRATION[map];
      if (!calib) return;
      const scale = size / RADAR_SIZE;
      const toRadar = (x: number, y: number, z = 0) => {
        const p = worldToRadar(x, y, calib);
        return { x: p.x * scale, y: p.y * scale - heightLift(z) };
      };
      for (const trail of habitOverlay.trails) {
        drawHabitOverlayTrail(layer, trail, toRadar);
      }
    };
    void render();
    return () => {
      cancel = true;
    };
  }, [habitOverlay, map, size]);

  useEffect(() => {
    if (!map) return;
    let cancel = false;
    const install = async () => {
      // wait until pixi is initialized
      for (let i = 0; i < 50 && !bgLayerRef.current; i++) {
        await new Promise((r) => setTimeout(r, 30));
      }
      if (cancel || !bgLayerRef.current) return;
      if (loadedMapRef.current === map) return;
      try {
        if (cancel || !bgLayerRef.current) return;
        bgLayerRef.current.removeChildren();
        loadedMapRef.current = map;
      } catch (e) {
        console.warn("radar load failed", map, e);
      }
    };
    install();
    return () => {
      cancel = true;
    };
  }, [map, size]);

  // render loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000;
      last = now;
      const state = useReplay.getState();
      state.step(dt);
      const { match, currentRoundIdx, time } = useReplay.getState();
      const layer = playerLayerRef.current;
      const utilityLayer = utilityLayerRef.current;
      const bombLayer = bombLayerRef.current;
      const deathLayer = deathLayerRef.current;
      const habitLayer = habitLayerRef.current;
      if (!match || !layer || !utilityLayer || !bombLayer || !deathLayer) return;
      const round = match.rounds[currentRoundIdx];
      if (!round) return;
      const calib = MAP_CALIBRATION[match.meta.map];
      if (!calib) return;

      const bombFrames = roundFramesWithBombFallback(round);
      const positions = sampleFrame(round.frames, time);
      const frame = nearestFrame(bombFrames, time);
      const bombPair = framePair(bombFrames, time);
      const smoothBomb = (() => {
        if (!bombPair) return frame?.bomb;
        const ba = bombPair.a.bomb;
        const bb = bombPair.b.bomb;
        if (!bb) return ba;
        if (!ba || ba.status !== bb.status || ba.carrier !== bb.carrier) return bb;
        return {
          ...bb,
          x: ba.x + (bb.x - ba.x) * bombPair.alpha,
          y: ba.y + (bb.y - ba.y) * bombPair.alpha,
          z: ba.z + (bb.z - ba.z) * bombPair.alpha,
        };
      })();
      const defusedBomb = recentlyDefusedBomb(round, bombFrames, time);
      const displayBomb = defusedBomb ?? smoothBomb;
      const plantedAt = activeBombPlantTime(round, time);
      const bombExplosion = recentBombExplosion(round, bombFrames, time);
      const throwerTeams = lastKnownTeams(round.frames, time);
      const scale = size / RADAR_SIZE;
      const seen = new Set<number>();
      const utilityChildrenBeforeCleanup = utilityLayer.children.length;
      queueLayerChildrenForDestroy(utilityLayer, deferredDestroyRef.current);
      queueLayerChildrenForDestroy(deathLayer, deferredDestroyRef.current);
      drainDestroyQueue(deferredDestroyRef.current);

      const toRadar = (x: number, y: number, z = 0) => {
        const p = worldToRadar(x, y, calib);
        return { x: p.x * scale, y: p.y * scale - heightLift(z) };
      };

      const renderCache = getRoundRenderCache(round);
      const projectileFrames = renderCache.projectileFrames;
      const roundEffects = renderCache.resolvedEffects;
      const debugProjectiles = projectileDebugEnabled();
      if (debugProjectiles) {
        if (!projectileDebugDetectedRef.current) {
          projectileDebugDetectedRef.current = true;
          projectileDebugLogForced(`enabled mapRendererDetected map=${match.meta.map} roundNumber=${round.number} time=${formatProjectileDebugNumber(time)}`);
        }
        const roundKey = `${match.meta.map}:${currentRoundIdx}:${round.number}:${round.startTick}:${round.endTick}`;
        if (projectileDebugRoundRef.current !== roundKey) {
          projectileDebugRoundRef.current = roundKey;
          projectileDebugHiddenRef.current.clear();
          projectileDebugAssociationRef.current.clear();
          projectileDebugFireSummaryRef.current.clear();
          projectileDebugFireVisibleRef.current.clear();
          projectileDebugEarlyRef.current.clear();
          projectileDebugSuspiciousRef.current.clear();
          projectileDebugVisibleReasonRef.current.clear();
          projectileDebugLastFrameLogRef.current = 0;
          projectileDebugLog(`round-summary-start ${JSON.stringify({
            roundNumber: round.number,
            map: match.meta.map,
            currentRoundIdx,
            time: formatProjectileDebugNumber(time),
            localStorage: window.localStorage.getItem(PROJECTILE_DEBUG_KEY),
          })}`);
          projectileDebugLog(`round-summary ${JSON.stringify(summarizeProjectileRound(round, projectileFrames, roundEffects))}`);
          for (const effect of round.effects ?? []) {
            if (effect.type !== "fire" || effect.end - effect.start <= FIRE_EFFECT_MAX_DURATION) continue;
            const key = `${round.number}:${effect.id ?? "no-id"}:${effect.start}:${effect.end}:clamped`;
            if (projectileDebugFireSummaryRef.current.has(key)) continue;
            projectileDebugFireSummaryRef.current.add(key);
            projectileDebugLog(`fire-effect-clamped ${JSON.stringify(fireClampDebugPayload(effect, round, match.meta.tickRate, "renderer-resolveEffects"))}`);
          }
          for (const effect of roundEffects) {
            if (effect.type !== "fire") continue;
            const key = `${round.number}:${effect.id ?? "no-id"}:${effect.start}:${effect.end}`;
            if (projectileDebugFireSummaryRef.current.has(key)) continue;
            projectileDebugFireSummaryRef.current.add(key);
            projectileDebugLog(`fire-effect-summary ${JSON.stringify(fireEffectDebugPayload(effect, round, match.meta.tickRate))}`);
          }
        }
      } else {
        projectileDebugDetectedRef.current = false;
      }
      const unitsToPx = scale / calib.scale;
      const activeEffects = roundEffects.filter((e) => time >= e.start && time <= e.end);
      const currentHabitOverlay = habitOverlayRef.current;
      if (condensed) {
        queueLayerChildrenForDestroy(bombLayer, deferredDestroyRef.current);
        for (const [, sprite] of spritesRef.current) {
          layer.removeChild(sprite.container);
          sprite.container.destroy({ children: true });
        }
        spritesRef.current.clear();
        bombSpriteRef.current = null;
        if (habitLayer) {
          queueLayerChildrenForDestroy(habitLayer, deferredDestroyRef.current);
          if (currentHabitOverlay?.mode === "replay" && currentHabitOverlay.replays?.length) {
            drawHabitReplayOverlay(habitLayer, currentHabitOverlay.replays, time, toRadar, unitsToPx);
          }
        }
        drainDestroyQueue(deferredDestroyRef.current);
        return;
      }
      if (habitLayer && currentHabitOverlay?.mode === "replay" && currentHabitOverlay.replays?.length) {
        queueLayerChildrenForDestroy(habitLayer, deferredDestroyRef.current);
        drawHabitReplayOverlay(habitLayer, currentHabitOverlay.replays, time, toRadar, unitsToPx);
      }
      for (const effect of activeEffects) {
        const resolved = fireVariantFromProjectiles(effect, projectileFrames, renderCache);
        if (resolved.type === "bomb_planted" && displayBomb) continue;
        if (resolved.type === "fire") {
          const smoked = fireIsSmoked(resolved, activeEffects);
          if (debugProjectiles) {
            const visibleBucket = Math.floor(time * 2) / 2;
            const key = `${round.number}:${resolved.id ?? "no-id"}:${visibleBucket}:${smoked ? "smoked" : "visible"}`;
            if (!projectileDebugFireVisibleRef.current.has(key)) {
              projectileDebugFireVisibleRef.current.add(key);
              projectileDebugLog(`fire-effect-visible ${JSON.stringify({
                ...fireEffectDebugPayload(resolved, round, match.meta.tickRate),
                currentTime: formatProjectileDebugNumber(time),
                currentTick: projectileDebugTick(round, match.meta.tickRate, time),
                rendererAction: smoked ? "hidden" : "drawn",
                disappearanceReason: smoked ? "smoked-by-active-smoke" : time >= resolved.end ? "expired" : "active",
                secondsVisibleSoFar: formatProjectileDebugNumber(time - resolved.start),
                secondsLeft: formatProjectileDebugNumber(resolved.end - time),
              })}`);
            }
          }
          if (smoked) continue;
        }
        drawEffect(utilityLayer, resolved, time, toRadar, unitsToPx, roundEffects);
      }

      for (const marker of renderCache.deathMarkers) {
        if (marker.t > time) continue;
        const p = toRadar(marker.x, marker.y, marker.z);
        drawDeathMarker(deathLayer, p.x, p.y, time - marker.t);
      }

      const visibleFires: WeaponFireEvent[] = (round.weaponFires ?? []).filter(
        (fire) => fire.t <= time && time - fire.t <= 0.24
      );
      const liveById = new Map(positions.map((p) => [p.id, p]));
      const recentFireByShooter = new Map<number, WeaponFireEvent>();
      for (const fire of visibleFires) {
        const live = fire.shooter ? liveById.get(fire.shooter) : undefined;
        drawWeaponFire(utilityLayer, fire, time, toRadar, live);
        if (fire.shooter) recentFireByShooter.set(fire.shooter, fire);
      }

      if (bombExplosion) {
        const p = toRadar(bombExplosion.bomb.x, bombExplosion.bomb.y, bombExplosion.bomb.z);
        const life = clamp01(bombExplosion.age / 1.15);
        const flash = 1 - life;
        const explosion = new Graphics();
        explosion.circle(p.x, p.y, 12 + life * 46)
          .fill({ color: 0xff6b35, alpha: 0.18 * flash });
        explosion.circle(p.x, p.y, 8 + life * 24)
          .stroke({ color: 0xffd166, width: 3.4, alpha: 0.9 * flash });
        explosion.circle(p.x, p.y, 18 + life * 42)
          .stroke({ color: 0xef4444, width: 2.2, alpha: 0.65 * flash });
        for (let i = 0; i < 7; i++) {
          const a = i * ((Math.PI * 2) / 7) + life * 0.45;
          const inner = 10 + life * 16;
          const outer = 18 + life * 48;
          explosion.moveTo(p.x + Math.cos(a) * inner, p.y + Math.sin(a) * inner);
          explosion.lineTo(p.x + Math.cos(a) * outer, p.y + Math.sin(a) * outer);
        }
        explosion.stroke({ color: 0xffb703, width: 1.4, alpha: 0.75 * flash });
        utilityLayer.addChild(explosion);
      }

      if (displayBomb && displayBomb.status !== "carried") {
        const p = toRadar(displayBomb.x, displayBomb.y, displayBomb.z);
        const bombIsDefused = Boolean(defusedBomb);
        if (displayBomb.status === "planted" && !bombIsDefused) {
          const pulse = plantedAt === null ? (time % 1) : bombPulseProgress(plantedAt, time);
          const radius = 19 * pulse;
          const alpha = 0.75 * (1 - pulse);
          const ring = new Graphics()
            .circle(p.x, p.y, radius)
            .stroke({ color: 0xef4444, width: 2, alpha });
          utilityLayer.addChild(ring);
          const defuse = activeDefuse(round.events, positions, displayBomb, time);
          if (!defuse) {
            defuseVisualRef.current = null;
          }
          if (defuse) {
            const key = `${currentRoundIdx}:${defuse.start}:${defuse.duration}:${defuse.player ?? "near"}`;
            const previous = defuseVisualRef.current;
            if (!previous || previous.key !== key || time < previous.lastTime || time - previous.lastTime > 0.35) {
              defuseVisualRef.current = { key, start: time, lastTime: time };
            } else {
              previous.lastTime = time;
            }
            const visualState = defuseVisualRef.current;
            if (!visualState) return;
            const visualStart = visualState.start;
            const progress = clamp01((time - visualStart) / defuse.duration);
            const startAngle = -Math.PI / 2;
            const endAngle = startAngle + Math.PI * 2 * progress;
            const radius = 25;
            const arc = new Graphics();
            arc.circle(p.x, p.y, radius).stroke({ color: 0x93c5fd, width: 1.2, alpha: 0.22 });
            arc.moveTo(p.x + Math.cos(startAngle) * radius, p.y + Math.sin(startAngle) * radius);
            arc.arc(p.x, p.y, radius, startAngle, endAngle);
            arc.stroke({ color: 0x60a5fa, width: 2.6, alpha: 0.9 });
            arc.circle(p.x + Math.cos(endAngle) * radius, p.y + Math.sin(endAngle) * radius, 2.4)
              .fill({ color: 0xbfdbfe, alpha: 0.95 });
            drawCountdownLabel(arc, String(Math.max(0, Math.ceil(defuse.duration - (time - visualStart)))), p.x, p.y + 31, 0xbfdbfe);
            utilityLayer.addChild(arc);
          }
        }
        let bombSprite = bombSpriteRef.current;
        if (!bombSprite || bombSprite.container.destroyed) {
          const container = new Container();
          const marker = new Graphics();
          const icon = new Sprite();
          icon.anchor.set(0.5);
          container.addChild(marker);
          container.addChild(icon);
          bombLayer.addChild(container);
          bombSprite = { container, marker, icon };
          bombSpriteRef.current = bombSprite;
          loadIconTexture("/icons/c4.svg")
            .then((tex) => {
              if (!bombSprite || bombSprite.container.destroyed) return;
              bombSprite.icon.texture = tex;
              fitSprite(bombSprite.icon, 18);
            })
            .catch(() => {
              if (bombSprite && !bombSprite.container.destroyed) bombSprite.icon.visible = false;
            });
        }
        const bombColor = bombIsDefused ? 0x22c55e : displayBomb.status === "planted" ? 0xef4444 : 0xf59e0b;
        bombSprite.container.visible = true;
        bombSprite.container.position.set(p.x, p.y);
        bombSprite.marker.clear();
        bombSprite.icon.tint = bombColor;
        bombSprite.icon.visible = true;
      } else if (bombSpriteRef.current) {
        bombSpriteRef.current.container.visible = false;
      }
      // Match each started effect to ONE projectile (1-to-1). We sort
      // effects by start time and greedily assign the closest unclaimed
      // projectile of the same type at that instant. This prevents a
      // second flash/HE in the same spot from being swallowed by the first
      // detonation's suppression.
      const detonatedIds = new Set<number>();
      const detonatedEffectsById = new Map<number, { effect: UtilityEffect; distance: number; rule: string }>();
      const projectileEffects = roundEffects
        .filter((e) => time >= e.start - (e.type === "he" ? 1.25 : 0.12))
        .slice()
        .sort((a, b) => a.start - b.start);
      const startedEffects = projectileEffects
        .filter((e) => time >= e.start)
        .slice();
      for (const e of startedEffects) {
        if (time < projectileHideStart(e)) continue;
        const sampled = [
          ...sampleProjectilesFixed(renderCache, e.start + 0.08),
          ...sampleProjectilesFixed(renderCache, e.start),
          ...sampleProjectilesFixed(renderCache, Math.max(0, e.start - 0.08)),
          ...sampleProjectilesFixed(renderCache, Math.max(0, e.start - 0.16)),
          ...sampleProjectilesFixed(renderCache, Math.max(0, e.start - 0.32)),
        ];
        const sampledById = new Map(sampled.map((projectile) => [projectile.id, projectile]));
        let bestId: number | null = null;
        let bestDist = Infinity;
        for (const sp of sampledById.values()) {
          if (projectileTypeToEffect(sp.type) !== e.type) continue;
          if (detonatedIds.has(sp.id)) continue;
          const dx = sp.x - e.x;
          const dy = sp.y - e.y;
          const d = dx * dx + dy * dy;
          const threshold = effectSuppressionRadius(e.type);
          if (d > threshold * threshold) continue;
          if (d < bestDist) {
            bestDist = d;
            bestId = sp.id;
          }
        }
        if (bestId !== null) {
          detonatedIds.add(bestId);
          detonatedEffectsById.set(bestId, { effect: e, distance: Math.sqrt(bestDist), rule: "closest sampled projectile near effect" });
          if (debugProjectiles) {
            const key = `${round.number}:${bestId}:${e.type}:${e.start}`;
            if (!projectileDebugAssociationRef.current.has(key)) {
              projectileDebugAssociationRef.current.add(key);
              projectileDebugLog(`effect-associated ${JSON.stringify({
                roundNumber: round.number,
                projectileId: bestId,
                effectType: e.type,
                effectVariant: e.variant ?? null,
                projectileTime: formatProjectileDebugNumber(time),
                effectTime: formatProjectileDebugNumber(e.start),
                distance: formatProjectileDebugNumber(Math.sqrt(bestDist)),
                rule: "closest sampled projectile near effect",
              })}`);
            }
          }
        }
      }

      const sampledProjectiles = debugProjectiles ? sampleProjectiles(projectileFrames, time) : [];
      const projectiles = visibleProjectiles(projectileFrames, time, projectileEffects, detonatedIds);
      if (debugProjectiles) {
        const visibleById = new Set(projectiles.map((projectile) => projectile.id));
        const accepted: ProjectilePos[] = [];
        for (const projectile of sampledProjectiles) {
          if (visibleById.has(projectile.id)) {
            accepted.push(projectile);
            continue;
          }
          const hidden = projectileHiddenReasonDebug(projectile, accepted, projectileEffects, detonatedIds, projectileFrames, time);
          const key = `${round.number}:${projectile.id}:${hidden?.reason ?? "hidden unknown"}`;
          if (!projectileDebugHiddenRef.current.has(key)) {
            projectileDebugHiddenRef.current.add(key);
            const detonated = detonatedEffectsById.get(projectile.id);
            projectileDebugLog(`projectile-hidden ${JSON.stringify({
              roundNumber: round.number,
              projectileId: projectile.id,
              type: projectile.type,
              reason: hidden?.reason ?? "hidden unknown",
              currentTime: formatProjectileDebugNumber(time),
              currentTick: Math.round(round.startTick + time * match.meta.tickRate),
              detonationTime: hidden?.match ? formatProjectileDebugNumber(hidden.match.effect.start) : null,
              effect: hidden?.match
                ? {
                    type: hidden.match.effect.type,
                    variant: hidden.match.effect.variant ?? null,
                    start: formatProjectileDebugNumber(hidden.match.effect.start),
                    distance: formatProjectileDebugNumber(hidden.match.distance),
                    hideStart: formatProjectileDebugNumber(hidden.match.hideStart),
                    touches: hidden.match.touches,
                    seenNear: hidden.match.seenNear,
                  }
                : detonated
                ? {
                    type: detonated.effect.type,
                    variant: detonated.effect.variant ?? null,
                    start: formatProjectileDebugNumber(detonated.effect.start),
                    distance: formatProjectileDebugNumber(detonated.distance),
                    rule: detonated.rule,
                  }
                : null,
            })}`);
          }
        }
      }
      let debugTrailsDrawn = 0;
      let debugTrailsNotDrawn = 0;
      for (const projectile of projectiles) {
        if (debugProjectiles) {
          const current = toRadar(
            projectile.x,
            projectile.y,
            projectileHeightAboveGround(projectile, renderCache.projectileTracks.get(projectile.id)),
          );
          const track = projectileTrackWindowFromCache(renderCache, projectile.id);
          const earlyRound = time <= 5 || (track.first !== null && track.first <= 5);
          const beforeRound = track.first !== null && track.first < -0.001;
          const afterRound = track.last !== null && track.last > round.duration + 0.001;
          const suspicionReasons = [
            ...projectilePositionSuspicion(projectile, current, size, track),
            ...(beforeRound ? ["frame-before-round-start"] : []),
            ...(afterRound ? ["frame-after-round-end"] : []),
          ];
          if (earlyRound) {
            const key = `${round.number}:${projectile.id}:${Math.floor(time * 2) / 2}:early`;
            if (!projectileDebugEarlyRef.current.has(key)) {
              projectileDebugEarlyRef.current.add(key);
              projectileDebugLog(`projectile-early-round ${JSON.stringify({
                roundNumber: round.number,
                projectileId: projectile.id,
                type: projectile.type,
                currentTime: formatProjectileDebugNumber(time),
                currentTick: projectileDebugTick(round, match.meta.tickRate, time),
                roundStartTick: round.startTick,
                roundEndTick: round.endTick,
                x: formatProjectileDebugNumber(projectile.x),
                y: formatProjectileDebugNumber(projectile.y),
                z: formatProjectileDebugNumber(projectile.z),
                mapX: formatProjectileDebugNumber(current.x),
                mapY: formatProjectileDebugNumber(current.y),
                owner: projectile.thrower ?? null,
                trackFirstTime: track.first === null ? null : formatProjectileDebugNumber(track.first),
                trackLastTime: track.last === null ? null : formatProjectileDebugNumber(track.last),
                trackSamples: track.samples,
                trackMoved: track.moved,
                sampleSource: projectileSampleSourceDebug(projectileFrames, projectile.id, time),
                visibleReason: "sampled-projectile-not-suppressed-by-effect",
              })}`);
            }
          }
          if (suspicionReasons.length > 0) {
            const key = `${round.number}:${projectile.id}:${suspicionReasons.join("|")}`;
            if (!projectileDebugSuspiciousRef.current.has(key)) {
              projectileDebugSuspiciousRef.current.add(key);
              projectileDebugLog(`projectile-suspicious-position ${JSON.stringify({
                roundNumber: round.number,
                projectileId: projectile.id,
                type: projectile.type,
                currentTime: formatProjectileDebugNumber(time),
                currentTick: projectileDebugTick(round, match.meta.tickRate, time),
                x: formatProjectileDebugNumber(projectile.x),
                y: formatProjectileDebugNumber(projectile.y),
                z: formatProjectileDebugNumber(projectile.z),
                mapX: formatProjectileDebugNumber(current.x),
                mapY: formatProjectileDebugNumber(current.y),
                owner: projectile.thrower ?? null,
                reasons: suspicionReasons,
                trackFirstTime: track.first === null ? null : formatProjectileDebugNumber(track.first),
                trackLastTime: track.last === null ? null : formatProjectileDebugNumber(track.last),
                trackSamples: track.samples,
                trackMoved: track.moved,
                sampleSource: projectileSampleSourceDebug(projectileFrames, projectile.id, time),
              })}`);
            }
          }
          if (earlyRound || suspicionReasons.length > 0) {
            const key = `${round.number}:${projectile.id}:${Math.floor(time * 2) / 2}:visible-reason`;
            if (!projectileDebugVisibleReasonRef.current.has(key)) {
              projectileDebugVisibleReasonRef.current.add(key);
              projectileDebugLog(`projectile-visible-reason ${JSON.stringify({
                roundNumber: round.number,
                projectileId: projectile.id,
                type: projectile.type,
                currentTime: formatProjectileDebugNumber(time),
                currentTick: projectileDebugTick(round, match.meta.tickRate, time),
                reason: "present in projectile sample and not hidden by detonatedIds/effect/duplicate filter",
                detonated: detonatedIds.has(projectile.id),
                sampleSource: projectileSampleSourceDebug(projectileFrames, projectile.id, time),
                matchingEffect: projectileEffectMatchDebug(projectile, projectileEffects, projectileFrames, time)
                  ? {
                      type: projectileEffectMatchDebug(projectile, projectileEffects, projectileFrames, time)?.effect.type,
                      start: formatProjectileDebugNumber(projectileEffectMatchDebug(projectile, projectileEffects, projectileFrames, time)?.effect.start ?? NaN),
                      distance: formatProjectileDebugNumber(projectileEffectMatchDebug(projectile, projectileEffects, projectileFrames, time)?.distance ?? NaN),
                    }
                  : null,
              })}`);
            }
          }
        }
        if (debugProjectiles) {
          const projectileTrack = renderCache.projectileTracks.get(projectile.id);
          const raw = projectileHistoryFromTrack(projectileTrack, projectile, time, toRadar);
          const current = toRadar(projectile.x, projectile.y, projectileHeightAboveGround(projectile, projectileTrack));
          const issue = projectileRenderIssueDebug(projectile, raw, current, utilityLayer, size);
          if (issue) {
            debugTrailsNotDrawn++;
            const key = `${round.number}:${projectile.id}:${issue}`;
            if (!projectileDebugHiddenRef.current.has(key)) {
              projectileDebugHiddenRef.current.add(key);
              projectileDebugLog(`trajectory-not-drawn ${JSON.stringify({
                roundNumber: round.number,
                projectileId: projectile.id,
                type: projectile.type,
                reason: issue,
                currentTime: formatProjectileDebugNumber(time),
                currentTick: Math.round(round.startTick + time * match.meta.tickRate),
                pathPoints: raw.length,
                currentRadar: {
                  x: formatProjectileDebugNumber(current.x),
                  y: formatProjectileDebugNumber(current.y),
                },
              })}`);
            }
          } else {
            debugTrailsDrawn++;
          }
        }
        drawProjectile(
          utilityLayer,
          projectile,
          renderCache.projectileTracks.get(projectile.id),
          time,
          throwerTeams,
          toRadar,
          projectileEffectHandoff(projectile, projectileEffects, projectileFrames, time),
        );
      }
      if (debugProjectiles && now - projectileDebugLastFrameLogRef.current >= 1000) {
        projectileDebugLastFrameLogRef.current = now;
        projectileDebugLog(`frame-summary ${JSON.stringify({
          roundNumber: round.number,
          time: formatProjectileDebugNumber(time),
          tick: Math.round(round.startTick + time * match.meta.tickRate),
          sampledProjectiles: sampledProjectiles.length,
          visibleProjectiles: projectiles.length,
          visibleTrajectories: debugTrailsDrawn,
          trajectoriesCreatedThisFrame: debugTrailsDrawn,
          trajectoriesNotDrawn: debugTrailsNotDrawn,
          utilityChildrenRemovedAtFrameStart: utilityChildrenBeforeCleanup,
          deferredDestroyQueue: deferredDestroyRef.current.length,
          projectileEffectsInWindow: projectileEffects.length,
          startedEffects: startedEffects.length,
          detonatedIds: detonatedIds.size,
          activeEffects: activeEffects.length,
          utilityLayerVisible: utilityLayer.visible,
          utilityLayerAlpha: utilityLayer.alpha,
        })}`);
      }

      for (const p of positions) {
        seen.add(p.id);
        const { x, y } = worldToRadar(p.x, p.y, calib);
        const px = x * scale;
        const py = y * scale;

        let s = spritesRef.current.get(p.id);
        if (!s) {
          const container = new Container();
          const playerInfo = match.players.find((pl) => pl.steamId === p.id);

          // The held weapon sprite sits above the name badge.
          const held = new Sprite();
          held.anchor.set(0.5, 1);
          held.position.set(0, -22);
          held.visible = false;

          // Name badge (rounded rect + text) above the dot.
          const labelBadge = new Container();
          const badgeBg = new Graphics();
          labelBadge.addChild(badgeBg);
          const labelFill = new Text({
            text: displayName(playerInfo?.name),
            style: {
              fontFamily: "ui-sans-serif, system-ui",
              fontSize: 44,
              fontWeight: "600",
              fill: 0x121212,
            },
            resolution: Math.max(2, window.devicePixelRatio || 1),
          });
          labelFill.anchor.set(0.5, 0.5);
          labelFill.scale.set(0.24);

          const labelEmpty = new Text({
            text: labelFill.text,
            style: {
              fontFamily: "ui-sans-serif, system-ui",
              fontSize: 44,
              fontWeight: "600",
              fill: 0xffffff,
            },
            resolution: Math.max(2, window.devicePixelRatio || 1),
          });
          labelEmpty.anchor.set(0.5, 0.5);
          labelEmpty.scale.set(0.24);

          const labelFillMask = new Graphics();
          const labelEmptyMask = new Graphics();
          labelFill.mask = labelFillMask;
          labelEmpty.mask = labelEmptyMask;

          labelBadge.addChild(labelFillMask);
          labelBadge.addChild(labelEmptyMask);
          labelBadge.addChild(labelEmpty);
          labelBadge.addChild(labelFill);
          labelBadge.position.set(0, -13);

          // Player arrow wrapped in a rotator.
          const dot = new Graphics();
          const hpRing = new Graphics();
          const arrowRotator = new Container();
          const arrow = new Graphics();
          const muzzleFlash = new Graphics();
          arrowRotator.addChild(arrow);
          arrowRotator.addChild(muzzleFlash);
          const actionGroup = new Container();
          const action = new Sprite();
          action.anchor.set(0.5);
          action.visible = false;
          const actionFill = new Sprite();
          actionFill.anchor.set(0.5);
          actionFill.tint = 0xef4444;
          actionFill.visible = false;
          const actionFillMask = new Graphics();
          actionFill.mask = actionFillMask;
          actionGroup.visible = false;
          actionGroup.addChild(action);
          actionGroup.addChild(actionFillMask);
          actionGroup.addChild(actionFill);
          arrowRotator.addChild(actionGroup);
          const flashArc = new Graphics();

          container.addChild(held);
          container.addChild(labelBadge);
          container.addChild(dot);
          container.addChild(arrowRotator);
          container.addChild(hpRing);
          container.addChild(flashArc);
          layer.addChild(container);
          s = {
            container,
            dot,
            hpRing,
            arrow,
            arrowRotator,
            muzzleFlash,
            labelBadge,
            labelFill,
            labelEmpty,
            labelFillMask,
            labelEmptyMask,
            held,
            heldPath: null,
            actionGroup,
            action,
            actionFill,
            actionFillMask,
            actionPath: null,
            flashArc,
          };
          spritesRef.current.set(p.id, s);
        }
        const carriesBomb =
          Boolean(p.hasBomb) ||
          (smoothBomb?.status === "carried" && smoothBomb.carrier === p.id) ||
          isBombWeapon(p.active) ||
          Boolean(p.weapons?.some(isBombWeapon));
        const baseColor = carriesBomb ? BOMB_CARRIER_COLOR : teamColor(p.team);
        const alive = p.hp > 0;
        const hpPct = Math.max(0, Math.min(100, p.hp)) / 100;
        const MARKER_R = 8;

        // CS2Lens-style player marker: just a directional arrow, no round dot.
        s.dot.clear();
        s.arrow
          .clear()
          .moveTo(MARKER_R + 1, 0)
          .lineTo(-MARKER_R + 1, -5.2)
          .lineTo(-MARKER_R + 4, 0)
          .lineTo(-MARKER_R + 1, 5.2)
          .lineTo(MARKER_R + 1, 0)
          .fill({ color: baseColor, alpha: alive ? 0.98 : 0.35 })
          .stroke({ color: 0xffffff, width: 1.7, alpha: alive ? 0.96 : 0.35 });

        const shot = recentFireByShooter.get(p.id);
        s.muzzleFlash.clear();
        if (alive && shot && !isUtilityWeapon(shot.weapon)) {
          const shotAge = Math.max(0, time - shot.t);
          const shotDuration = isKnifeWeapon(shot.weapon) ? 0.18 : 0.14;
          const shotAlpha = Math.max(0, 1 - shotAge / shotDuration);
          s.arrowRotator.scale.set(1 + shotAlpha * (isKnifeWeapon(shot.weapon) ? 0.025 : 0.015));
          if (isKnifeWeapon(shot.weapon)) {
            s.muzzleFlash
              .moveTo(PLAYER_ARROW_TIP_OFFSET + 1, -4.5)
              .lineTo(PLAYER_ARROW_TIP_OFFSET + 21, 0)
              .lineTo(PLAYER_ARROW_TIP_OFFSET + 1, 4.5)
              .stroke({ color: 0xf8fafc, width: 1.6, alpha: 0.86 * shotAlpha });
          } else {
            const tip = PLAYER_ARROW_TIP_OFFSET + 22;
            s.muzzleFlash
              .moveTo(PLAYER_ARROW_TIP_OFFSET + 1, 0)
              .lineTo(tip, -3.8)
              .lineTo(tip - 4.5, 0)
              .lineTo(tip, 3.8)
              .fill({ color: 0xffd166, alpha: 0.62 * shotAlpha });
            s.muzzleFlash
              .moveTo(PLAYER_ARROW_TIP_OFFSET + 3, 0)
              .lineTo(tip + 2.5, 0)
              .stroke({ color: 0xffffff, width: 1.1, alpha: 0.82 * shotAlpha });
          }
        } else {
          s.arrowRotator.scale.set(1);
        }

        s.hpRing.clear();

        // Name badge background in team color.
        const badgeBg = s.labelBadge.getChildAt(0) as Graphics;
        const labelWidth = s.labelFill.width;
        const padX = 4;
        const padY = 1.5;
        const bw = labelWidth + padX * 2;
        const bh = 8;
        const bx = -bw / 2;
        const by = -bh / 2 - padY + 1;
        const badgeHeight = bh + padY;
        const filledWidth = bw * hpPct;
        const emptyWidth = bw - filledWidth;
        badgeBg.clear();
        badgeBg.roundRect(bx, by, bw, badgeHeight, 3)
          .fill({ color: 0x1d1f1f, alpha: alive ? 0.88 : 0.45 });
        badgeBg.roundRect(bx, by, filledWidth, badgeHeight, 3)
          .fill({ color: baseColor, alpha: alive ? 0.95 : 0.35 });
        badgeBg.roundRect(bx, by, bw, badgeHeight, 3)
          .stroke({ color: 0x000000, width: 1, alpha: alive ? 0.55 : 0.3 });
        s.labelFill.position.set(0, 0);
        s.labelEmpty.position.set(0, 0);
        s.labelFill.alpha = alive ? 1 : 0.45;
        s.labelEmpty.alpha = alive ? 1 : 0.45;
        s.labelEmpty.style.fill = baseColor;

        s.labelFillMask.clear();
        s.labelEmptyMask.clear();
        if (filledWidth > 0) {
          s.labelFillMask.rect(bx, by, filledWidth, badgeHeight).fill({ color: 0xffffff });
        }
        if (emptyWidth > 0) {
          s.labelEmptyMask.rect(bx + filledWidth, by, emptyWidth, badgeHeight).fill({ color: 0xffffff });
        }

        s.flashArc.clear();
        if (alive && p.flashLeft && p.flashLeft > 0 && p.flashTotal && p.flashTotal > 0) {
          const fracRemaining = Math.max(0, Math.min(1, p.flashLeft / p.flashTotal));
          const startA = -Math.PI / 2;
          const endA = startA + Math.PI * 2 * fracRemaining;
          s.flashArc.moveTo(Math.cos(startA) * (MARKER_R + 4), Math.sin(startA) * (MARKER_R + 4));
          s.flashArc.arc(0, 0, MARKER_R + 4, startA, endA);
          s.flashArc.stroke({ color: 0xfffbeb, width: 1.8, alpha: 0.95 });
        }

        const heldPath = alive ? iconPathFor(p.active) : null;
        const heldBox = heldWeaponBox(p.active);
        if (heldPath !== s.heldPath) {
          s.heldPath = heldPath;
          if (!heldPath) {
            s.held.visible = false;
          } else {
            const sprite = s.held;
            loadIconTexture(heldPath)
              .then((tex) => {
                if (sprite.destroyed || s!.heldPath !== heldPath) return;
                sprite.texture = tex;
                fitSpriteBox(sprite, heldBox.width, heldBox.height);
                sprite.visible = true;
              })
              .catch(() => {});
          }
        } else if (heldPath) {
          fitSpriteBox(s.held, heldBox.width, heldBox.height);
        }
        s.held.tint = 0xffffff;
        s.held.alpha = alive ? 0.46 : 0.16;
        const arrowRotation = (-p.yaw * Math.PI) / 180;
        const activeAction = alive ? p.activeAction : undefined;
        const actionPath = activeAction ? iconPathFor(activeAction.type === "plant" ? "c4" : activeAction.item) : null;
        const hideHeldForAction = Boolean(activeAction && actionPath && heldPath === actionPath);
        if (actionPath !== s.actionPath) {
          s.actionPath = actionPath;
          if (!actionPath) {
            s.actionGroup.visible = false;
          } else {
            const sprite = s.action;
            const fillSprite = s.actionFill;
            loadIconTexture(actionPath)
              .then((tex) => {
                if (sprite.destroyed || s!.actionPath !== actionPath) return;
                sprite.texture = tex;
                fillSprite.texture = tex;
                fitSprite(sprite, activeAction?.type === "plant" ? 14 : 13);
                fillSprite.scale.copyFrom(sprite.scale);
                sprite.visible = true;
                fillSprite.visible = activeAction?.type === "plant";
              })
              .catch(() => {});
          }
        } else if (actionPath) {
          fitSprite(s.action, activeAction?.type === "plant" ? 14 : 13);
          s.actionFill.scale.copyFrom(s.action.scale);
        }
        if (activeAction && actionPath) {
          const heldCenterX = s.held.position.x;
          const heldCenterY = s.held.position.y - heldBox.height / 2;
          const invCos = Math.cos(-arrowRotation);
          const invSin = Math.sin(-arrowRotation);
          const startX = heldCenterX * invCos - heldCenterY * invSin;
          const startY = heldCenterX * invSin + heldCenterY * invCos;
          if (activeAction.type === "utility") {
            const slide = easeOutCubic(activeAction.elapsed / 0.22);
            const targetX = 4;
            const targetY = 10;
            const wobble = Math.sin(time * 18) * 2.2 * slide;
            s.actionGroup.position.set(
              startX + (targetX - startX) * slide,
              startY + (targetY - startY) * slide + wobble
            );
            s.actionGroup.rotation = Math.PI / 2 + Math.sin(time * 20) * 0.16 * slide;
            s.action.alpha = 0.78 + slide * 0.18;
            s.action.tint = mixColor(0xd8dde5, teamColor(p.team), slide * 0.7);
            s.actionFill.visible = false;
            s.actionFillMask.clear();
          } else {
            const progress = clamp01(activeAction.elapsed / (activeAction.duration ?? 3.2));
            const slide = easeOutCubic(activeAction.elapsed / 0.22);
            const targetX = 4;
            const targetY = 10;
            s.actionGroup.position.set(startX + (targetX - startX) * slide, startY + (targetY - startY) * slide);
            s.actionGroup.rotation = Math.PI / 2;
            s.action.alpha = 0.9;
            s.action.tint = 0xd8dde5;
            s.actionFill.alpha = 0.9;
            s.actionFill.tint = 0xef4444;
            s.actionFill.visible = true;
            const fillHeight = 14 * progress;
            s.actionFillMask.clear();
            s.actionFillMask.rect(-7, 7 - fillHeight, 14, fillHeight).fill({ color: 0xffffff, alpha: 1 });
          }
          s.actionGroup.visible = true;
          s.action.visible = true;
        } else {
          s.actionGroup.visible = false;
          s.actionGroup.rotation = 0;
          s.actionFill.visible = false;
          s.actionFillMask.clear();
        }
        if (heldPath) {
          s.held.visible = alive && !hideHeldForAction;
        }
        s.container.position.set(px, py);
        s.arrowRotator.rotation = arrowRotation;
        s.container.alpha = alive ? 1 : 0.4;
      }

      for (const [id, s] of spritesRef.current) {
        if (!seen.has(id)) {
          layer.removeChild(s.container);
          s.container.destroy({ children: true });
          spritesRef.current.delete(id);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [condensed, size]);

  return (
    <div
      ref={hostRef}
      style={{ width: size, height: size }}
      className="relative overflow-visible bg-transparent"
    >
      {map && (
        // The radar is kept in the DOM instead of only in Pixi: it is more
        // reliable across browsers/headless renderers while Pixi handles motion.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/cs2lens-maps/${map}.png`}
          alt=""
          className="absolute inset-0 z-0 size-full select-none object-cover"
          style={{ mixBlendMode: "lighten" }}
          draggable={false}
        />
      )}
    </div>
  );
}
