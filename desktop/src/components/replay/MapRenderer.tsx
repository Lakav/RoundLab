"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { useReplay } from "@/lib/replay-store";
import { MAP_CALIBRATION, RADAR_SIZE, worldToRadar } from "@/lib/maps";
import type { BombState, Frame, MatchEvent, PlayerPos, ProjectileFrame, ProjectilePos, Round, UtilityEffect, WeaponFireEvent } from "@/lib/types";
import { iconPathFor } from "@/lib/icons";

const iconTextureCache = new Map<string, Promise<Texture>>();
const BOMB_CARRIER_COLOR = 0xef4444;
const bombFrameFallbackCache = new WeakMap<Round, Frame[]>();

function loadIconTexture(path: string): Promise<Texture> {
  let p = iconTextureCache.get(path);
  if (!p) {
    p = Assets.load(path) as Promise<Texture>;
    iconTextureCache.set(path, p);
  }
  return p;
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

function sampleProjectiles(frames: ProjectileSample[], t: number): ProjectilePos[] {
  const pair = framePair(frames, t);
  if (!pair) return [];
  const { a, b, alpha } = pair;
  const from = new Map((a.projectiles ?? []).map((p) => [p.id, p]));
  const out = new Map<number, ProjectilePos>();
  for (const pb of b.projectiles ?? []) {
    const pa = from.get(pb.id);
    if (!pa) {
      out.set(pb.id, pb);
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
      out.set(pb.id, pb);
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
    const staleGap = lastSampleTime !== null && frame.t - lastSampleTime > 0.55;
    const visualJump = last && Math.hypot(last.x - pt.x, last.y - pt.y) > 65;
    if (staleGap || visualJump) {
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
  if (last && Math.hypot(last.x - current.x, last.y - current.y) > 65) return [current];
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

function fireVariantFromProjectiles(effect: UtilityEffect, frames: ProjectileSample[]): UtilityEffect {
  if (effect.type !== "fire" || effect.variant) return effect;
  const candidates = [
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
  // HE explosions need a short visual handoff. Without it, the projectile can
  // disappear one frame before the blast animation is readable.
  if (effect.type === "he") return effect.start + 0.08;
  return effect.start;
}

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

  // HE projectiles can land near an older HE explosion. If the same projectile
  // was not present around that older effect's timestamp, do not let the older
  // effect suppress it only because the current X/Y happens to be nearby.
  if (type === "he" && !matchedOwnTrack && time - effect.start > 0.25) return false;

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

function liveProjectileForEffect(frames: ProjectileSample[], effect: UtilityEffect, time: number): ProjectilePos | null {
  const samples = sampleProjectiles(frames, time);
  const threshold = effect.type === "he" ? 900 : effectSuppressionRadius(effect.type);
  const threshold2 = threshold * threshold;
  let best: ProjectilePos | null = null;
  let bestDist = Infinity;

  for (const projectile of samples) {
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

function effectHandoffProjectile(frames: ProjectileSample[], effect: UtilityEffect, time: number): ProjectilePos | null {
  if (effect.type !== "he") return null;
  if (time >= projectileHideStart(effect)) return null;
  if (liveProjectileForEffect(frames, effect, time)) return null;
  const last = lastProjectileBeforeEffect(frames, effect);
  if (!last || time < last.time || effect.start - last.time > 1.25) return null;
  const span = Math.max(0.08, effect.start - last.time);
  const progress = Math.max(0, Math.min(1, (time - last.time) / span));
  return {
    id: -10_000_000 - Math.round(effect.start * 1000),
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

function resolveEffects(effects: UtilityEffect[], frames: ProjectileSample[]): UtilityEffect[] {
  return effects.map((effect) => resolveDecoyEffect(effect, frames));
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
    for (const projectile of pair.a.projectiles ?? []) {
      if (out.has(projectile.id) || detonatedIds.has(projectile.id)) continue;
      if (projectileResolvedByEffect(projectile, startedEffects, time, frames)) continue;

      if ([...out.values()].some((current) => isSameVisualProjectile(current, projectile))) continue;
      out.set(projectile.id, projectile);
    }
  }

  for (const effect of startedEffects) {
    const handoff = effectHandoffProjectile(frames, effect, time);
    if (!handoff) continue;
    if ([...out.values()].some((current) => isSameVisualProjectile(current, handoff))) continue;
    out.set(handoff.id, handoff);
  }

  return [...out.values()];
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

function displayName(name?: string) {
  return name === "L999" ? "grosNoob" : name ?? "";
}

type PlayerSprite = {
  container: Container;
  dot: Graphics;
  hpRing: Graphics;
  arrow: Graphics;
  arrowRotator: Container;
  labelBadge: Container;
  label: Text;
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

function heightLift(z: number) {
  return Math.max(0, Math.min(22, Math.abs(z) / 35));
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
  loadIconTexture(path)
    .then((tex) => {
      if (sprite.destroyed) return;
      sprite.texture = tex;
      fitSprite(sprite, max);
    })
    .catch(() => {});
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
  // active arc as its own path so it doesn't connect to previous graphics
  const path = new Graphics();
  path.moveTo(cx + Math.cos(start) * radius, cy + Math.sin(start) * radius);
  path.arc(cx, cy, radius, start, end);
  path.stroke({ color, width, alpha: 0.95 });
  g.addChild(path);
}

function drawCountdownLabel(layer: Graphics, text: string, x: number, y: number, color = 0xc8c8c8) {
  const label = new Text({
    text,
    style: {
      fontFamily: "ui-sans-serif, system-ui",
      fontSize: 24,
      fontWeight: "700",
      fill: color,
    },
    resolution: Math.max(2, window.devicePixelRatio || 1),
  });
  label.anchor.set(0.5);
  label.scale.set(0.5);
  label.position.set(x, y);
  layer.addChild(label);
}

function drawEffect(
  layer: Container,
  effect: UtilityEffect,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number
) {
  const p = toRadar(effect.x, effect.y, effect.z);
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
    g.circle(p.x, p.y, radius).fill({ color: 0x9ca3af, alpha: 0.42 * alpha });
    drawTimerArc(g, p.x, p.y, radius, remaining, teamCol, 1.7);
    const secsLeft = Math.max(0, Math.ceil(effect.end - time));
    drawCountdownLabel(g, String(secsLeft), p.x, p.y, 0xb8b8b8);
    layer.addChild(g);
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
    drawUtilityIcon(layer, "burningFlammes", p.x, p.y, 0xffffff, 20);
    const labelLayer = new Graphics();
    const secsLeft = Math.max(0, Math.ceil(effect.end - time));
    drawCountdownLabel(labelLayer, String(secsLeft), p.x, p.y + 2, 0x3a3a3a);
    layer.addChild(labelLayer);
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
  projectileFrames: ProjectileSample[],
  time: number,
  throwerTeams: Map<number, number>,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number }
) {
  const throwerTeam = projectile.thrower ? throwerTeams.get(projectile.thrower) : undefined;
  const color = teamColor(throwerTeam);
  const raw = projectileHistory(projectileFrames, projectile, time, toRadar);

  const trail = new Graphics();
  drawSmoothTrail(trail, raw, color);

  const p = toRadar(projectile.x, projectile.y, projectile.z);
  const shadow = toRadar(projectile.x, projectile.y, 0);
  trail.circle(shadow.x, shadow.y, 4).fill({ color: 0x000000, alpha: 0.25 });
  layer.addChild(trail);
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
  const maxW = isKnife ? 26 : pistol ? 22 : 30;
  const maxH = isKnife ? 18 : pistol ? 13 : 16;

  // Compute the final forward offset synchronously so the sprite is
  // correctly placed on the very first frame, even before the texture
  // resolves. We approximate width by maxW (exact for shoot.svg, near
  // exact for quick-slash once loaded).
  const forward = PLAYER_ARROW_TIP_OFFSET + maxW / 2;
  const px = start.x + Math.cos(angle) * forward;
  const py = start.y + Math.sin(angle) * forward;

  const sprite = new Sprite();
  sprite.anchor.set(0.5, 0.5);
  sprite.position.set(px, py);
  sprite.rotation = spriteAngle;
  sprite.alpha = 0.95 * alpha;
  layer.addChild(sprite);

  const texturePath = isKnife ? "/icons/quick-slash.svg" : "/icons/shoot.svg";
  loadIconTexture(texturePath)
    .then((tex) => {
      if (sprite.destroyed) return;
      sprite.texture = tex;
      fitSpriteBox(sprite, maxW, maxH);
      // Refine using the true rendered width (matters for quick-slash
      // whose aspect is narrower than its max box).
      const trueForward = PLAYER_ARROW_TIP_OFFSET + sprite.width / 2;
      sprite.position.set(
        start.x + Math.cos(angle) * trueForward,
        start.y + Math.sin(angle) * trueForward
      );
    })
    .catch(() => {
      sprite.destroy();
    });
}

export function MapRenderer({ size = 800 }: { size?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(size);
  const appRef = useRef<Application | null>(null);
  const bgLayerRef = useRef<Container | null>(null);
  const utilityLayerRef = useRef<Container | null>(null);
  const bombLayerRef = useRef<Container | null>(null);
  const playerLayerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Map<number, PlayerSprite>>(new Map());
  const bombSpriteRef = useRef<BombSprite | null>(null);
  const loadedMapRef = useRef<string | null>(null);
  const defuseVisualRef = useRef<{ key: string; start: number; lastTime: number } | null>(null);

  // init pixi once
  useEffect(() => {
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
      const utilityLayer = new Container();
      const bombLayer = new Container();
      const playerLayer = new Container();
      app.stage.addChild(bgLayer);
      app.stage.addChild(utilityLayer);
      app.stage.addChild(bombLayer);
      app.stage.addChild(playerLayer);
      app.canvas.style.position = "absolute";
      app.canvas.style.inset = "0";
      app.canvas.style.zIndex = "1";
      host.appendChild(app.canvas);
      appRef.current = app;
      bgLayerRef.current = bgLayer;
      utilityLayerRef.current = utilityLayer;
      bombLayerRef.current = bombLayer;
      playerLayerRef.current = playerLayer;
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
    };
  }, []);

  useEffect(() => {
    sizeRef.current = size;
    const app = appRef.current;
    if (!app) return;
    app.renderer.resize(size, size);
  }, [size]);

  // load radar when map changes
  const map = useReplay((s) => s.match?.meta.map);
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
      if (!match || !layer || !utilityLayer || !bombLayer) return;
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
      const throwerTeams = lastKnownTeams(round.frames, time);
      const scale = size / RADAR_SIZE;
      const seen = new Set<number>();
      for (const child of utilityLayer.removeChildren()) {
        child.destroy({ children: true });
      }

      const toRadar = (x: number, y: number, z = 0) => {
        const p = worldToRadar(x, y, calib);
        return { x: p.x * scale, y: p.y * scale - heightLift(z) };
      };

      const projectileFrames = projectileSamples(round);
      const roundEffects = resolveEffects(round.effects ?? [], projectileFrames);
      const unitsToPx = scale / calib.scale;
      const activeEffects = roundEffects.filter((e) => time >= e.start && time <= e.end);
      for (const effect of activeEffects) {
        const resolved = fireVariantFromProjectiles(effect, projectileFrames);
        if (resolved.type === "bomb_planted" && displayBomb) continue;
        if (resolved.type === "fire" && fireIsSmoked(resolved, activeEffects)) continue;
        drawEffect(utilityLayer, resolved, time, toRadar, unitsToPx);
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

      if (displayBomb && displayBomb.status !== "carried") {
        const p = toRadar(displayBomb.x, displayBomb.y, displayBomb.z);
        const bombIsDefused = Boolean(defusedBomb);
        if (displayBomb.status === "planted" && !bombIsDefused) {
          const pulse = (time * 1.5) % 1;
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
          ...sampleProjectiles(projectileFrames, e.start + 0.08),
          ...sampleProjectiles(projectileFrames, e.start),
          ...sampleProjectiles(projectileFrames, Math.max(0, e.start - 0.08)),
          ...sampleProjectiles(projectileFrames, Math.max(0, e.start - 0.16)),
          ...sampleProjectiles(projectileFrames, Math.max(0, e.start - 0.32)),
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
        if (bestId !== null) detonatedIds.add(bestId);
      }

      const projectiles = visibleProjectiles(projectileFrames, time, projectileEffects, detonatedIds);
      for (const projectile of projectiles) {
        drawProjectile(utilityLayer, projectile, projectileFrames, time, throwerTeams, toRadar);
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
          const label = new Text({
            text: displayName(playerInfo?.name),
            style: {
              fontFamily: "ui-sans-serif, system-ui",
              fontSize: 44,
              fontWeight: "600",
              fill: 0x121212,
            },
            resolution: Math.max(2, window.devicePixelRatio || 1),
          });
          label.anchor.set(0.5, 0.5);
          label.scale.set(0.24);
          labelBadge.addChild(label);
          labelBadge.position.set(0, -13);

          // Player arrow wrapped in a rotator.
          const dot = new Graphics();
          const hpRing = new Graphics();
          const arrowRotator = new Container();
          const arrow = new Graphics();
          arrowRotator.addChild(arrow);
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
            labelBadge,
            label,
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
        if (alive && shot && !isUtilityWeapon(shot.weapon)) {
          const shotAge = Math.max(0, time - shot.t);
          const shotDuration = isKnifeWeapon(shot.weapon) ? 0.18 : 0.14;
          const shotAlpha = Math.max(0, 1 - shotAge / shotDuration);
          s.arrowRotator.scale.set(1 + shotAlpha * (isKnifeWeapon(shot.weapon) ? 0.05 : 0.03));
        } else {
          s.arrowRotator.scale.set(1);
        }

        s.hpRing.clear();

        // Name badge background in team color.
        const badgeBg = s.labelBadge.getChildAt(0) as Graphics;
        const labelText = s.labelBadge.getChildAt(1) as Text;
        const labelWidth = labelText.width;
        const padX = 4;
        const padY = 1.5;
        const bw = labelWidth + padX * 2;
        const bh = 8;
        badgeBg.clear();
        badgeBg.roundRect(-bw / 2, -bh / 2 - padY + 1, bw, bh + padY, 3)
          .fill({ color: 0x1d1f1f, alpha: alive ? 0.88 : 0.45 });
        badgeBg.roundRect(-bw / 2, -bh / 2 - padY + 1, bw * hpPct, bh + padY, 3)
          .fill({ color: baseColor, alpha: alive ? 0.95 : 0.35 });
        badgeBg.roundRect(-bw / 2, -bh / 2 - padY + 1, bw, bh + padY, 3)
          .stroke({ color: 0x000000, width: 1, alpha: alive ? 0.55 : 0.3 });
        labelText.position.set(0, 0);
        labelText.alpha = alive ? 1 : 0.45;

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
  }, [size]);

  return (
    <div
      ref={hostRef}
      style={{ width: size, height: size }}
      className="relative overflow-hidden bg-[#1d1f1f]"
    >
      {map && (
        // The radar is kept in the DOM instead of only in Pixi: it is more
        // reliable across browsers/headless renderers while Pixi handles motion.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/cs2lens-maps/${map}.png`}
          alt=""
          className="absolute inset-0 z-0 size-full select-none object-cover opacity-95"
          style={{ mixBlendMode: "lighten" }}
          draggable={false}
        />
      )}
    </div>
  );
}
