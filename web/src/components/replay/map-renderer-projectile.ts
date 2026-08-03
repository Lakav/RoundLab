import { Container, Graphics } from "pixi.js";
import type {
  Frame,
  PlayerId,
  ProjectileFrame,
  ProjectilePos,
  Round,
  UtilityEffect,
} from "@/lib/types";
import type {
  HabitReplayEffect,
  HabitReplayProjectile,
} from "@/lib/replay-store";
import { writeDebugLog } from "@/lib/api";
import { teamColor } from "./map-renderer-player";

export const PROJECTILE_EFFECT_HANDOFF_LOOKBACK = 1.75;

export type ProjectileSample = Frame | ProjectileFrame;

export type ProjectileTrack = {
  samples: Array<{ t: number; projectile: ProjectilePos }>;
  first: number | null;
  last: number | null;
  samplesCount: number;
  moved: boolean;
};

type TimedPair<T> = { a: T; b: T; alpha: number };

function framePair<T extends { t: number }>(frames: T[], time: number): TimedPair<T> | null {
  if (!frames.length) return null;
  if (time <= frames[0].t) return { a: frames[0], b: frames[0], alpha: 0 };
  if (time >= frames[frames.length - 1].t) {
    const last = frames[frames.length - 1];
    return { a: last, b: last, alpha: 0 };
  }
  let low = 0;
  let high = frames.length - 1;
  while (low < high - 1) {
    const middle = (low + high) >> 1;
    if (frames[middle].t <= time) low = middle;
    else high = middle;
  }
  const a = frames[low];
  const b = frames[high];
  return { a, b, alpha: (time - a.t) / (b.t - a.t || 1) };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function projectileTypeToEffect(type: string): string | null {
  const normalized = type.toLowerCase();
  if (normalized.includes("smoke")) return "smoke";
  if (
    normalized.includes("molotov") ||
    normalized.includes("incendiary") ||
    normalized.includes("incgrenade") ||
    normalized.includes("inferno")
  ) {
    return "fire";
  }
  if (normalized.includes("decoy")) return "decoy";
  if (normalized.includes("flash")) return "flash";
  if (
    normalized.startsWith("he") ||
    normalized.includes("hegrenade") ||
    normalized.includes("he grenade") ||
    normalized.includes("high explosive")
  ) {
    return "he";
  }
  return null;
}

export function projectileSamples(round: Round): ProjectileSample[] {
  return round.projectileFrames?.length ? round.projectileFrames : round.frames;
}

export function sampleProjectiles(
  frames: ProjectileSample[],
  time: number,
): ProjectilePos[] {
  if (frames.length > 0 && time < frames[0].t) return [];
  const pair = framePair(frames, time);
  if (!pair) return [];
  const { a, b, alpha } = pair;
  const future = new Map((b.projectiles ?? []).map((projectile) => [projectile.id, projectile]));
  const sampled = new Map<number, ProjectilePos>();
  for (const current of a.projectiles ?? []) {
    const next = future.get(current.id);
    if (!next) {
      sampled.set(current.id, current);
      continue;
    }
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const dz = next.z - current.z;
    const sameProjectile =
      projectileTypeToEffect(current.type) === projectileTypeToEffect(next.type) &&
      (current.thrower ?? 0) === (next.thrower ?? 0) &&
      dx * dx + dy * dy + dz * dz <= 850 * 850;
    if (!sameProjectile) {
      sampled.set(current.id, current);
      continue;
    }
    sampled.set(next.id, {
      ...next,
      x: current.x + (next.x - current.x) * alpha,
      y: current.y + (next.y - current.y) * alpha,
      z: current.z + (next.z - current.z) * alpha,
    });
  }
  return [...sampled.values()];
}

export function projectileHistory(
  frames: ProjectileSample[],
  projectile: ProjectilePos,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let lastSampleTime: number | null = null;

  for (const frame of frames) {
    if (frame.t > time) break;
    const sample = frame.projectiles?.find((candidate) => candidate.id === projectile.id);
    if (!sample) continue;
    const point = toRadar(sample.x, sample.y, sample.z);
    const last = points[points.length - 1];
    const staleGap = lastSampleTime !== null && frame.t - lastSampleTime > 0.9;
    if (staleGap) {
      points.length = 0;
      points.push(point);
      lastSampleTime = frame.t;
      continue;
    }
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 0.5) points.push(point);
    lastSampleTime = frame.t;
  }

  const current = toRadar(projectile.x, projectile.y, projectile.z);
  const last = points[points.length - 1];
  if (!last || Math.hypot(last.x - current.x, last.y - current.y) > 0.5) {
    points.push(current);
  }
  return points;
}

export function projectileGroundZ(
  track: ProjectileTrack | undefined,
  fallbackZ: number,
): number {
  if (!track || track.samples.length === 0) return fallbackZ;
  return track.samples.reduce(
    (lowest, sample) => Math.min(lowest, sample.projectile.z),
    track.samples[0].projectile.z,
  );
}

export function projectileHeightAboveGround(
  projectile: ProjectilePos,
  track: ProjectileTrack | undefined,
): number {
  return Math.max(0, projectile.z - projectileGroundZ(track, projectile.z));
}

export function projectileHistoryFromTrack(
  track: ProjectileTrack | undefined,
  projectile: ProjectilePos,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
): { x: number; y: number }[] {
  if (!track) return projectileHistory([], projectile, time, toRadar);
  const points: { x: number; y: number }[] = [];
  let lastSampleTime: number | null = null;
  const groundZ = projectileGroundZ(track, projectile.z);

  for (const sample of track.samples) {
    if (sample.t > time) break;
    const projectileSample = sample.projectile;
    const point = toRadar(
      projectileSample.x,
      projectileSample.y,
      Math.max(0, projectileSample.z - groundZ),
    );
    const last = points[points.length - 1];
    const staleGap = lastSampleTime !== null && sample.t - lastSampleTime > 0.9;
    if (staleGap) {
      points.length = 0;
      points.push(point);
      lastSampleTime = sample.t;
      continue;
    }
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) > 0.5) points.push(point);
    lastSampleTime = sample.t;
  }

  const current = toRadar(
    projectile.x,
    projectile.y,
    Math.max(0, projectile.z - groundZ),
  );
  const last = points[points.length - 1];
  if (!last || Math.hypot(last.x - current.x, last.y - current.y) > 0.5) {
    points.push(current);
  }
  return points;
}

export function drawSmoothTrail(
  graphics: Graphics,
  points: { x: number; y: number }[],
  color: number,
): void {
  if (points.length < 2) return;
  const smooth: { x: number; y: number }[] = [points[0]];
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    for (let step = 1; step <= 8; step++) {
      const t = step / 8;
      const squared = t * t;
      const cubed = squared * t;
      smooth.push({
        x:
          0.5 *
          ((2 * p1.x) +
            (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * squared +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * cubed),
        y:
          0.5 *
          ((2 * p1.y) +
            (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * squared +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * cubed),
      });
    }
  }

  let dashRemaining = 3.5;
  let gapRemaining = 4.5;
  let drawing = true;
  for (let index = 1; index < smooth.length; index++) {
    let from = smooth[index - 1];
    const to = smooth[index];
    let distance = Math.hypot(to.x - from.x, to.y - from.y);
    if (distance <= 0.01) continue;
    const directionX = (to.x - from.x) / distance;
    const directionY = (to.y - from.y) / distance;

    while (distance > 0.01) {
      const step = Math.min(distance, drawing ? dashRemaining : gapRemaining);
      const next = {
        x: from.x + directionX * step,
        y: from.y + directionY * step,
      };
      if (drawing) {
        const progress = index / Math.max(1, smooth.length - 1);
        graphics.moveTo(from.x, from.y);
        graphics.lineTo(next.x, next.y);
        graphics.stroke({ color, width: 1.35, alpha: 0.2 + progress * 0.35 });
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

export function buildProjectileTracks(
  frames: ProjectileSample[],
): Map<number, ProjectileTrack> {
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
      if (
        previous &&
        Math.hypot(
          projectile.x - previous.x,
          projectile.y - previous.y,
          projectile.z - previous.z,
        ) > 2
      ) {
        track.moved = true;
      }
      track.samples.push({ t: frame.t, projectile });
      track.first = track.first ?? frame.t;
      track.last = frame.t;
      track.samplesCount++;
    }
  }
  return tracks;
}

export function sampleProjectileTrack(
  track: ProjectileTrack,
  time: number,
): ProjectilePos | null {
  const samples = track.samples;
  if (!samples.length || time < samples[0].t || time > samples[samples.length - 1].t) {
    return null;
  }
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (samples[middle].t <= time) low = middle;
    else high = middle - 1;
  }
  const a = samples[low];
  const b = samples[Math.min(low + 1, samples.length - 1)];
  if (a === b || Math.abs(time - a.t) < 0.0001) return { ...a.projectile };

  const deltaTime = b.t - a.t;
  const distance = Math.hypot(
    b.projectile.x - a.projectile.x,
    b.projectile.y - a.projectile.y,
    b.projectile.z - a.projectile.z,
  );
  const sameIdentity =
    projectileTypeToEffect(a.projectile.type) === projectileTypeToEffect(b.projectile.type) &&
    (a.projectile.thrower ?? 0) === (b.projectile.thrower ?? 0);
  const continuous =
    sameIdentity && deltaTime > 0 && deltaTime <= 2 && distance / deltaTime <= 2200;
  if (!continuous) return time - a.t <= 0.16 ? { ...a.projectile } : null;

  const alpha = clamp01((time - a.t) / deltaTime);
  return {
    ...b.projectile,
    x: a.projectile.x + (b.projectile.x - a.projectile.x) * alpha,
    y: a.projectile.y + (b.projectile.y - a.projectile.y) * alpha,
    z: a.projectile.z + (b.projectile.z - a.projectile.z) * alpha,
  };
}

export function sampleProjectileTracks(
  tracks: Map<number, ProjectileTrack>,
  time: number,
): ProjectilePos[] {
  const projectiles: ProjectilePos[] = [];
  for (const track of tracks.values()) {
    const projectile = sampleProjectileTrack(track, time);
    if (projectile) projectiles.push(projectile);
  }
  return projectiles;
}

export function isSameVisualProjectile(a: ProjectilePos, b: ProjectilePos): boolean {
  if (a.id === b.id) return true;
  const type = projectileTypeToEffect(a.type);
  if (!type || projectileTypeToEffect(b.type) !== type) return false;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz <= 80 * 80;
}

export function effectSuppressionRadius(type: string): number {
  if (type === "fire" || type === "smoke") return 900;
  if (type === "decoy") return 700;
  return 520;
}

export function projectileHideStart(effect: UtilityEffect): number {
  if (effect.type === "smoke" || effect.type === "fire") return effect.start + 0.65;
  if (effect.type === "decoy") return effect.start + 0.5;
  if (effect.type === "flash") return effect.start + 0.32;
  if (effect.type === "he") return effect.start + 0.22;
  return effect.start + 0.25;
}

export type ProjectileEffectHandoff = {
  effect: UtilityEffect;
  active: boolean;
};

export function projectileHandoffIconAlpha(
  handoff: ProjectileEffectHandoff | null,
  time: number,
): number {
  if (!handoff?.active) return 1;
  const fadeDuration = Math.min(
    0.16,
    projectileHideStart(handoff.effect) - handoff.effect.start,
  );
  return Math.max(
    0,
    1 - (time - handoff.effect.start) / Math.max(0.04, fadeDuration),
  );
}

export function projectileTypeForEffect(effect: UtilityEffect): string {
  if (effect.type === "he") return "hegrenade";
  if (effect.type === "flash") return "flashbang";
  if (effect.type === "smoke") return "smokegrenade";
  if (effect.type === "decoy") return "decoy";
  if (effect.type === "fire") {
    return effect.variant === "incendiary" ? "incgrenade" : "molotov";
  }
  return effect.type;
}

export function projectileTouchesEffect(
  projectile: ProjectilePos,
  effect: UtilityEffect,
  frames: ProjectileSample[],
  time: number,
): boolean {
  const type = projectileTypeToEffect(projectile.type);
  if (!type || effect.type !== type) return false;
  const threshold = effectSuppressionRadius(type);
  const thresholdSquared = threshold * threshold;
  let matchedOwnTrack = false;

  for (const frame of frames) {
    if (frame.t < effect.start - 0.45) continue;
    if (frame.t > effect.start + 0.18) break;
    const sample = frame.projectiles?.find(
      (candidate) => candidate.id === projectile.id,
    );
    if (!sample) continue;
    matchedOwnTrack = true;
    const dx = sample.x - effect.x;
    const dy = sample.y - effect.y;
    if (dx * dx + dy * dy <= thresholdSquared) return true;
  }

  if (!matchedOwnTrack && time - effect.start > 0.25) return false;
  const dx = projectile.x - effect.x;
  const dy = projectile.y - effect.y;
  return dx * dx + dy * dy <= thresholdSquared;
}

export function projectileSeenNearEffect(
  projectile: ProjectilePos,
  effect: UtilityEffect,
  frames: ProjectileSample[],
): boolean {
  const type = projectileTypeToEffect(projectile.type);
  if (!type || effect.type !== type) return false;
  const threshold = effectSuppressionRadius(type);
  const thresholdSquared = threshold * threshold;
  const thrower = projectile.thrower ?? 0;
  const currentDx = projectile.x - effect.x;
  const currentDy = projectile.y - effect.y;
  if (currentDx * currentDx + currentDy * currentDy > thresholdSquared) return false;

  for (const frame of frames) {
    if (frame.t < effect.start - 0.55) continue;
    if (frame.t > effect.start + 0.2) break;
    for (const candidate of frame.projectiles ?? []) {
      if (projectileTypeToEffect(candidate.type) !== type) continue;
      if ((candidate.thrower ?? 0) !== thrower) continue;
      const dx = candidate.x - effect.x;
      const dy = candidate.y - effect.y;
      if (dx * dx + dy * dy <= thresholdSquared) return true;
    }
  }
  return false;
}

export function projectileEffectHandoff(
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
    if (
      !projectileTouchesEffect(projectile, effect, frames, time) &&
      !projectileSeenNearEffect(projectile, effect, frames)
    ) {
      continue;
    }
    const distance = Math.hypot(projectile.x - effect.x, projectile.y - effect.y);
    if (!best || distance < best.distance) best = { effect, distance };
  }

  return best ? { effect: best.effect, active: time >= best.effect.start } : null;
}

export function liveProjectileForEffect(
  frames: ProjectileSample[],
  effect: UtilityEffect,
  time: number,
  ignoredProjectileIds?: Set<number>,
  tracks?: Map<number, ProjectileTrack>,
): ProjectilePos | null {
  const samples = tracks
    ? sampleProjectileTracks(tracks, time)
    : sampleProjectiles(frames, time);
  const threshold =
    effect.type === "he" ? 900 : effectSuppressionRadius(effect.type);
  const thresholdSquared = threshold * threshold;
  let best: ProjectilePos | null = null;
  let bestDistance = Infinity;

  for (const projectile of samples) {
    if (ignoredProjectileIds?.has(projectile.id)) continue;
    if (projectileTypeToEffect(projectile.type) !== effect.type) continue;
    const dx = projectile.x - effect.x;
    const dy = projectile.y - effect.y;
    const distance = dx * dx + dy * dy;
    if (distance > thresholdSquared || distance >= bestDistance) continue;
    best = projectile;
    bestDistance = distance;
  }
  return best;
}

export function lastProjectileBeforeEffect(
  frames: ProjectileSample[],
  effect: UtilityEffect,
  projectileId?: number,
): { projectile: ProjectilePos; time: number } | null {
  const threshold =
    effect.type === "he" ? 1400 : effectSuppressionRadius(effect.type);
  const thresholdSquared = threshold * threshold;
  let best: ProjectilePos | null = null;
  let bestTime = -Infinity;
  let bestDistance = Infinity;

  for (const frame of frames) {
    if (frame.t > effect.start) break;
    if (frame.t < effect.start - PROJECTILE_EFFECT_HANDOFF_LOOKBACK) continue;
    for (const projectile of frame.projectiles ?? []) {
      if (projectileId !== undefined && projectile.id !== projectileId) continue;
      if (projectileTypeToEffect(projectile.type) !== effect.type) continue;
      const dx = projectile.x - effect.x;
      const dy = projectile.y - effect.y;
      const distance = dx * dx + dy * dy;
      if (distance > thresholdSquared) continue;
      if (
        frame.t > bestTime ||
        (frame.t === bestTime && distance < bestDistance)
      ) {
        best = projectile;
        bestTime = frame.t;
        bestDistance = distance;
      }
    }
  }
  return best ? { projectile: best, time: bestTime } : null;
}

export type ProjectileEffectAssociation = {
  projectileId: number;
  distance: number;
};

export function associateProjectileEffects(
  frames: ProjectileSample[],
  effects: UtilityEffect[],
): Map<UtilityEffect, ProjectileEffectAssociation> {
  const associations = new Map<UtilityEffect, ProjectileEffectAssociation>();
  const claimedProjectileIds = new Set<number>();

  for (const effect of effects.slice().sort((a, b) => a.start - b.start)) {
    const sampled = [
      ...sampleProjectiles(frames, effect.start + 0.08),
      ...sampleProjectiles(frames, effect.start),
      ...sampleProjectiles(frames, Math.max(0, effect.start - 0.08)),
      ...sampleProjectiles(frames, Math.max(0, effect.start - 0.16)),
      ...sampleProjectiles(frames, Math.max(0, effect.start - 0.32)),
    ];
    const sampledById = new Map(
      sampled.map((projectile) => [projectile.id, projectile]),
    );
    const delayed = lastProjectileBeforeEffect(frames, effect);
    if (delayed && !sampledById.has(delayed.projectile.id)) {
      sampledById.set(delayed.projectile.id, delayed.projectile);
    }

    let best: ProjectileEffectAssociation | null = null;
    for (const projectile of sampledById.values()) {
      if (claimedProjectileIds.has(projectile.id)) continue;
      if (projectileTypeToEffect(projectile.type) !== effect.type) continue;
      const distance = Math.hypot(projectile.x - effect.x, projectile.y - effect.y);
      if (distance > effectSuppressionRadius(effect.type)) continue;
      if (!best || distance < best.distance) {
        best = { projectileId: projectile.id, distance };
      }
    }
    if (!best) continue;
    associations.set(effect, best);
    claimedProjectileIds.add(best.projectileId);
  }
  return associations;
}

export function effectHandoffProjectile(
  frames: ProjectileSample[],
  effect: UtilityEffect,
  time: number,
  ignoredProjectileIds?: Set<number>,
  tracks?: Map<number, ProjectileTrack>,
  associatedProjectileId?: number,
): ProjectilePos | null {
  if (time >= projectileHideStart(effect)) return null;
  if (associatedProjectileId !== undefined) {
    if (ignoredProjectileIds?.has(associatedProjectileId)) return null;
    const associatedTrack = tracks?.get(associatedProjectileId);
    const live = tracks
      ? associatedTrack
        ? sampleProjectileTrack(associatedTrack, time)
        : null
      : sampleProjectiles(frames, time).find(
          (projectile) => projectile.id === associatedProjectileId,
        ) ?? null;
    if (live) return null;
  } else if (
    liveProjectileForEffect(frames, effect, time, ignoredProjectileIds, tracks)
  ) {
    return null;
  }
  const last = lastProjectileBeforeEffect(frames, effect, associatedProjectileId);
  if (
    !last ||
    time < last.time ||
    effect.start - last.time > PROJECTILE_EFFECT_HANDOFF_LOOKBACK
  ) {
    return null;
  }
  const span = Math.max(0.08, effect.start - last.time);
  const progress = clamp01((time - last.time) / span);
  return {
    id: last.projectile.id,
    type: last.projectile.type ?? projectileTypeForEffect(effect),
    x: last.projectile.x + (effect.x - last.projectile.x) * progress,
    y: last.projectile.y + (effect.y - last.projectile.y) * progress,
    z: last.projectile.z + (effect.z - last.projectile.z) * progress,
    thrower: last.projectile.thrower,
  };
}

export function visibleProjectiles(
  frames: ProjectileSample[],
  time: number,
  startedEffects: UtilityEffect[],
  detonatedIds: Set<number>,
  tracks?: Map<number, ProjectileTrack>,
  effectProjectileIds?: Map<UtilityEffect, number>,
): ProjectilePos[] {
  const visible = new Map<number, ProjectilePos>();
  const sampled = tracks
    ? sampleProjectileTracks(tracks, time)
    : sampleProjectiles(frames, time);
  for (const projectile of sampled) {
    if (detonatedIds.has(projectile.id)) continue;
    if (
      [...visible.values()].some((current) =>
        isSameVisualProjectile(current, projectile),
      )
    ) {
      continue;
    }
    visible.set(projectile.id, projectile);
  }

  const pair = framePair(frames, time);
  if (pair && pair.a !== pair.b && pair.b.t - time <= 0.16) {
    for (const projectile of pair.b.projectiles ?? []) {
      if (visible.has(projectile.id) || detonatedIds.has(projectile.id)) continue;
      if (
        [...visible.values()].some((current) =>
          isSameVisualProjectile(current, projectile),
        )
      ) {
        continue;
      }
      visible.set(projectile.id, projectile);
    }
  }

  for (const effect of startedEffects) {
    const handoff = effectHandoffProjectile(
      frames,
      effect,
      time,
      detonatedIds,
      tracks,
      effectProjectileIds?.get(effect),
    );
    if (!handoff) continue;
    if (
      [...visible.values()].some((current) =>
        isSameVisualProjectile(current, handoff),
      )
    ) {
      continue;
    }
    visible.set(handoff.id, handoff);
  }
  return [...visible.values()];
}

export type DrawProjectileIcon = (
  layer: Container,
  name: string,
  x: number,
  y: number,
  color: number,
  max?: number,
  alpha?: number,
) => void;

export function drawProjectileVisual(
  layer: Container,
  projectile: ProjectilePos,
  projectileTrack: ProjectileTrack | undefined,
  time: number,
  throwerTeams: Map<PlayerId, number>,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  handoff: ProjectileEffectHandoff | null,
  drawIcon: DrawProjectileIcon,
): void {
  const throwerTeam = projectile.thrower
    ? throwerTeams.get(projectile.thrower)
    : undefined;
  const color = teamColor(throwerTeam);
  const trajectory = projectileHistoryFromTrack(
    projectileTrack,
    projectile,
    time,
    toRadar,
  );
  if (handoff?.active) {
    const impact = toRadar(handoff.effect.x, handoff.effect.y, 0);
    const tail = trajectory[trajectory.length - 1];
    if (!tail || Math.hypot(impact.x - tail.x, impact.y - tail.y) > 0.5) {
      trajectory.push(impact);
    }
  }

  const trail = new Graphics();
  drawSmoothTrail(trail, trajectory, color);
  if (handoff?.active) {
    trail.alpha = Math.max(
      0,
      1 -
        (time - handoff.effect.start) /
          Math.max(
            0.04,
            projectileHideStart(handoff.effect) - handoff.effect.start,
          ),
    );
  }

  const height = projectileHeightAboveGround(projectile, projectileTrack);
  const position = handoff?.active
    ? toRadar(handoff.effect.x, handoff.effect.y, 0)
    : toRadar(projectile.x, projectile.y, height);
  const shadow = toRadar(projectile.x, projectile.y, 0);
  const shadowDistance = Math.hypot(position.x - shadow.x, position.y - shadow.y);
  const shadowAlpha = 0.14 + Math.min(0.16, shadowDistance / 140);
  const shadowRadius = 4.6 - Math.min(1.4, shadowDistance / 18);
  if (!handoff?.active) {
    trail
      .circle(shadow.x, shadow.y, shadowRadius)
      .fill({ color: 0x000000, alpha: shadowAlpha });
  }
  layer.addChild(trail);

  const iconName =
    projectileTypeToEffect(projectile.type) === "fire" && throwerTeam === 3
      ? "incgrenade"
      : projectile.type;
  const iconAlpha = projectileHandoffIconAlpha(handoff, time);
  if (iconAlpha > 0) {
    drawIcon(layer, iconName, position.x, position.y, color, 16, iconAlpha);
  }
}

export function habitTrailColor(type: string): number {
  const effect = projectileTypeToEffect(type);
  if (effect === "smoke") return 0x9ca3af;
  if (effect === "flash") return 0xfef3c7;
  if (effect === "he") return 0xf97316;
  if (effect === "fire") return 0xef4444;
  if (effect === "decoy") return 0xa78bfa;
  return 0x6fea76;
}

export function sampleHabitProjectile(
  projectile: HabitReplayProjectile,
  time: number,
): { x: number; y: number; z: number } | null {
  const pair = framePair(projectile.samples, time);
  if (!pair) return null;
  const { a, b, alpha } = pair;
  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
  };
}

export function habitProjectileGroundZ(projectile: HabitReplayProjectile): number {
  if (!projectile.samples.length) return 0;
  return projectile.samples.reduce(
    (lowest, sample) => Math.min(lowest, sample.z),
    projectile.samples[0].z,
  );
}

function habitProjectileTimedPoints(
  samples: HabitReplayProjectile["samples"],
  start: number,
  end: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  groundZ: number,
): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (samples[middle].t < start) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < samples.length; index++) {
    const sample = samples[index];
    if (sample.t > end) break;
    const point = toRadar(
      sample.x,
      sample.y,
      Math.max(0, sample.z - groundZ),
    );
    const last = points[points.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 2.5) {
      points.push(point);
    }
  }
  return points;
}

export function drawHabitProjectileVisual(
  layer: Container,
  projectile: HabitReplayProjectile,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  effects: HabitReplayEffect[],
  trailWindowSeconds: number,
  drawIcon: DrawProjectileIcon,
): void {
  const first = projectile.samples[0];
  const last = projectile.samples[projectile.samples.length - 1];
  if (!first || !last || time < first.t) return;
  const color = habitTrailColor(projectile.type);
  const kind = projectileTypeToEffect(projectile.type);
  const handoff = kind
    ? effects
        .filter(
          (effect) =>
            effect.type === kind &&
            time >= effect.start - PROJECTILE_EFFECT_HANDOFF_LOOKBACK &&
            time <= projectileHideStart(effect as UtilityEffect),
        )
        .map((effect) => {
          const distances = projectile.samples
            .filter(
              (sample) =>
                sample.t >= effect.start - PROJECTILE_EFFECT_HANDOFF_LOOKBACK &&
                sample.t <= effect.start + 0.12,
            )
            .map((sample) => Math.hypot(sample.x - effect.x, sample.y - effect.y));
          return {
            effect,
            distance: distances.length ? Math.min(...distances) : Infinity,
          };
        })
        .filter((match) => match.distance <= effectSuppressionRadius(kind))
        .sort((a, b) => a.distance - b.distance)[0]?.effect
    : undefined;
  const handoffEnd = handoff
    ? projectileHideStart(handoff as UtilityEffect)
    : null;
  if (time > Math.max(last.t + 1.05, handoffEnd ?? -Infinity)) return;

  const activeHandoff = Boolean(handoff && time >= handoff.start);
  const bridgingHandoff = Boolean(handoff && time > last.t && !activeHandoff);
  const fade =
    activeHandoff && handoff
      ? Math.max(0, 1 - (time - handoff.start) / 0.12)
      : handoff
        ? 1
        : time > last.t
          ? Math.max(0, 1 - (time - last.t) / 1.05)
          : 1;
  const visibleTime = handoff && time > last.t ? last.t : Math.min(time, last.t);
  const groundZ = habitProjectileGroundZ(projectile);
  const points = habitProjectileTimedPoints(
    projectile.samples,
    Math.max(first.t, visibleTime - trailWindowSeconds),
    visibleTime,
    toRadar,
    groundZ,
  );
  const sampled = sampleHabitProjectile(projectile, visibleTime);
  if (sampled) {
    const sampledPoint = toRadar(
      sampled.x,
      sampled.y,
      Math.max(0, sampled.z - groundZ),
    );
    const tail = points[points.length - 1];
    if (
      !tail ||
      Math.hypot(sampledPoint.x - tail.x, sampledPoint.y - tail.y) > 0.5
    ) {
      points.push(sampledPoint);
    }
  }
  if (activeHandoff && handoff) {
    const impact = toRadar(handoff.x, handoff.y, 0);
    const tail = points[points.length - 1];
    if (!tail || Math.hypot(impact.x - tail.x, impact.y - tail.y) > 0.5) {
      points.push(impact);
    }
  } else if (bridgingHandoff && handoff) {
    const impact = toRadar(handoff.x, handoff.y, 0);
    const tail = points[points.length - 1];
    if (tail) {
      const progress = clamp01(
        (time - last.t) / Math.max(0.08, handoff.start - last.t),
      );
      const bridge = {
        x: tail.x + (impact.x - tail.x) * progress,
        y: tail.y + (impact.y - tail.y) * progress,
      };
      if (Math.hypot(bridge.x - tail.x, bridge.y - tail.y) > 0.5) {
        points.push(bridge);
      }
    }
  }
  if (points.length < 2) return;

  const trail = new Graphics();
  drawSmoothTrail(trail, points, color);
  trail.alpha = 0.45 * fade;
  const current = points[points.length - 1];
  if (sampled && !activeHandoff) {
    const shadow = toRadar(sampled.x, sampled.y, 0);
    const shadowDistance = Math.hypot(current.x - shadow.x, current.y - shadow.y);
    const shadowAlpha = 0.11 + Math.min(0.12, shadowDistance / 160);
    const shadowRadius = 3.8 - Math.min(1, shadowDistance / 24);
    trail
      .circle(shadow.x, shadow.y, shadowRadius)
      .fill({ color: 0x000000, alpha: shadowAlpha * fade });
  }
  trail
    .circle(current.x, current.y, 3.4)
    .fill({ color, alpha: 0.8 * fade });
  layer.addChild(trail);
  if (!activeHandoff && (time <= last.t + 0.08 || bridgingHandoff)) {
    drawIcon(layer, projectile.type, current.x, current.y, color, 13);
  }
}

export const PROJECTILE_DEBUG_KEY = "roundlab.debugProjectiles";
let projectileDebugCache = { checkedAt: 0, enabled: false };

export function projectileDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const now = performance.now();
  if (now - projectileDebugCache.checkedAt < 500) {
    return projectileDebugCache.enabled;
  }
  projectileDebugCache = {
    checkedAt: now,
    enabled:
      window.localStorage.getItem(PROJECTILE_DEBUG_KEY) === "1" ||
      String(
        (window as Window & { ROUNDLAB_DEBUG_PROJECTILES?: unknown })
          .ROUNDLAB_DEBUG_PROJECTILES ?? "",
      ) === "1",
  };
  return projectileDebugCache.enabled;
}

export function projectileDebugLog(message: string): void {
  if (!projectileDebugEnabled()) return;
  const line = `ROUNDLAB_DEBUG_PROJECTILES ${message}`;
  console.info(line);
  void writeDebugLog("projectiles", line).catch(() => {});
}

export function projectileDebugLogForced(message: string): void {
  const line = `ROUNDLAB_DEBUG_PROJECTILES ${message}`;
  console.info(line);
  void writeDebugLog("projectiles", line).catch(() => {});
}

export function formatProjectileDebugNumber(value: number): number | null {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

export function projectileDebugDistance(
  projectile: ProjectilePos,
  effect: UtilityEffect,
): number {
  return Math.hypot(
    projectile.x - effect.x,
    projectile.y - effect.y,
    projectile.z - effect.z,
  );
}

export function projectileDebugTick(
  round: Round,
  tickRate: number,
  time: number,
): number {
  return Math.round(round.startTick + time * tickRate);
}

export function fireEffectDebugPayload(
  effect: UtilityEffect,
  round: Round,
  tickRate: number,
): Record<string, unknown> {
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

export function fireClampDebugPayload(
  effect: UtilityEffect,
  round: Round,
  tickRate: number,
  source: string,
  maxDuration = 7,
): Record<string, unknown> {
  const clampedEnd = Math.min(effect.end, effect.start + maxDuration);
  return {
    roundNumber: round.number,
    id: effect.id ?? null,
    type: effect.type,
    variant: effect.variant ?? null,
    source,
    maxDuration,
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

export type ProjectileTrackWindow = {
  first: number | null;
  last: number | null;
  samples: number;
  moved: boolean;
};

export function projectileTrackWindowFromCache(
  cache: { projectileTracks: Map<number, ProjectileTrack> },
  id: number,
): ProjectileTrackWindow {
  const track = cache.projectileTracks.get(id);
  return {
    first: track?.first ?? null,
    last: track?.last ?? null,
    samples: track?.samplesCount ?? 0,
    moved: track?.moved ?? false,
  };
}

export function projectileSampleSourceDebug(
  frames: ProjectileSample[],
  id: number,
  time: number,
): Record<string, unknown> {
  const pair = framePair(frames, time);
  const inA = Boolean(
    pair?.a.projectiles?.some((projectile) => projectile.id === id),
  );
  const inB = Boolean(
    pair?.b.projectiles?.some((projectile) => projectile.id === id),
  );
  return {
    frameA: pair ? formatProjectileDebugNumber(pair.a.t) : null,
    frameB: pair ? formatProjectileDebugNumber(pair.b.t) : null,
    alpha: pair ? formatProjectileDebugNumber(pair.alpha) : null,
    inFrameA: inA,
    inFrameB: inB,
    selectedBy: inA
      ? "current-or-interpolated-from-current-frame"
      : inB
        ? "future-frame-only"
        : "none",
  };
}

export function projectilePositionSuspicion(
  projectile: ProjectilePos,
  radar: { x: number; y: number },
  size: number,
  track: ProjectileTrackWindow,
): string[] {
  const reasons: string[] = [];
  if (
    [projectile.x, projectile.y, projectile.z].some(
      (value) => !Number.isFinite(value),
    )
  ) {
    reasons.push("invalid-world-coordinates");
  }
  if (!Number.isFinite(radar.x) || !Number.isFinite(radar.y)) {
    reasons.push("invalid-radar-coordinates");
  }
  if (
    Math.abs(projectile.x) < 0.001 &&
    Math.abs(projectile.y) < 0.001 &&
    Math.abs(projectile.z) < 0.001
  ) {
    reasons.push("zero-world-position");
  }
  if (
    Math.hypot(radar.x - size / 2, radar.y - size / 2) <= 8 &&
    track.samples <= 2
  ) {
    reasons.push("near-map-center-with-short-history");
  }
  if (track.first === null || track.samples <= 1) reasons.push("missing-history");
  if (!track.moved && track.samples >= 2) reasons.push("static-track");
  return reasons;
}

export function summarizeProjectileRound(
  round: Round,
  projectileFrames: ProjectileSample[],
  effects: UtilityEffect[],
) {
  const tracks = new Map<
    number,
    {
      id: number;
      type: string;
      thrower: PlayerId | null;
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
      const valid = [projectile.x, projectile.y, projectile.z].every(
        Number.isFinite,
      );
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
        if (
          track.lastPos &&
          Math.hypot(
            projectile.x - track.lastPos.x,
            projectile.y - track.lastPos.y,
            projectile.z - track.lastPos.z,
          ) > 1
        ) {
          track.moved = true;
        }
        track.lastPos = projectile;
      } else {
        track.invalid++;
      }
    }
  }

  const typeCounts = new Map<string, number>();
  const rejected: Array<{
    id: number;
    type: string;
    reason: string;
    samples: number;
    first: number;
    last: number;
  }> = [];
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
    const key =
      effect.type === "fire" && effect.variant
        ? `${effect.type}:${effect.variant}`
        : effect.type;
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

export function projectileEffectMatchDebug(
  projectile: ProjectilePos,
  effects: UtilityEffect[],
  frames: ProjectileSample[],
  time: number,
): {
  effect: UtilityEffect;
  distance: number;
  hideStart: number;
  touches: boolean;
  seenNear: boolean;
  started: boolean;
} | null {
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

export function projectileHiddenReasonDebug(
  projectile: ProjectilePos,
  existing: ProjectilePos[],
  effects: UtilityEffect[],
  detonatedIds: Set<number>,
  frames: ProjectileSample[],
  time: number,
): { reason: string; match: ReturnType<typeof projectileEffectMatchDebug> } | null {
  if (detonatedIds.has(projectile.id)) {
    return {
      reason: "hidden by detonatedIds",
      match: projectileEffectMatchDebug(projectile, effects, frames, time),
    };
  }
  if (
    existing.some((current) => isSameVisualProjectile(current, projectile))
  ) {
    return {
      reason: "duplicate visual projectile",
      match: projectileEffectMatchDebug(projectile, effects, frames, time),
    };
  }
  return null;
}

export function projectileRenderIssueDebug(
  projectile: ProjectilePos,
  trajectory: { x: number; y: number }[],
  current: { x: number; y: number },
  layer: Container,
  size: number,
): string | null {
  if (
    [projectile.x, projectile.y, projectile.z].some(
      (value) => !Number.isFinite(value),
    )
  ) {
    return "invalid coordinates";
  }
  if (
    trajectory.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
    )
  ) {
    return "invalid radar path";
  }
  if (trajectory.length < 2) return "path too short";
  if (
    current.x < -64 ||
    current.y < -64 ||
    current.x > size + 64 ||
    current.y > size + 64
  ) {
    return "outside map bounds";
  }
  if (!layer.visible) return "layer invisible";
  if (layer.alpha === 0) return "alpha zero";
  if (layer.destroyed) return "object destroyed";
  return null;
}
