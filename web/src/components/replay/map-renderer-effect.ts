import { Container, Graphics } from "pixi.js";
import { smokeBlastClearAlpha } from "@/lib/replay-logic";
import type { HabitReplayEffect } from "@/lib/replay-store";
import type { ProjectilePos, UtilityEffect } from "@/lib/types";
import {
  circleOverlapArea,
  fireIsSmoked,
  fireRadiusWorld,
} from "@/lib/utility-geometry";
import { teamColor, teamDarkColor } from "./map-renderer-player";
import {
  projectileTypeToEffect,
  sampleProjectiles,
  type DrawProjectileIcon,
  type ProjectileSample,
} from "./map-renderer-projectile";

export const FIRE_EFFECT_MAX_DURATION = 7;

export type EffectProjectileCache = {
  projectileFrames: ProjectileSample[];
  fixedProjectileSamples: Map<number, ProjectilePos[]>;
};

export function sampleProjectilesFixed(
  cache: EffectProjectileCache,
  time: number,
): ProjectilePos[] {
  const key = Math.round(time * 1000);
  const cached = cache.fixedProjectileSamples.get(key);
  if (cached) return cached;
  const samples = sampleProjectiles(cache.projectileFrames, time);
  cache.fixedProjectileSamples.set(key, samples);
  return samples;
}

export function fireVariantFromProjectiles(
  effect: UtilityEffect,
  frames: ProjectileSample[],
  cache?: EffectProjectileCache,
): UtilityEffect {
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
  let bestDistance = Infinity;
  for (const projectile of candidates) {
    const kind = projectile.type.toLowerCase();
    if (!kind.includes("molotov") && !kind.includes("incendiary")) continue;
    const dx = projectile.x - effect.x;
    const dy = projectile.y - effect.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = projectile;
    }
  }
  if (!best || bestDistance > 500 * 500) return effect;
  return {
    ...effect,
    variant: best.type.toLowerCase().includes("incendiary")
      ? "incendiary"
      : "molotov",
  };
}

export { circleOverlapArea, fireIsSmoked, fireRadiusWorld };

export function decoyProjectileTracks(frames: ProjectileSample[]) {
  const tracks = new Map<
    number,
    {
      projectile: ProjectilePos;
      first: number;
      last: number;
      samples: number;
      landedAt: number | null;
    }
  >();

  for (const frame of frames) {
    for (const projectile of frame.projectiles ?? []) {
      if (projectileTypeToEffect(projectile.type) !== "decoy") continue;
      const track = tracks.get(projectile.id);
      if (!track) {
        tracks.set(projectile.id, {
          projectile,
          first: frame.t,
          last: frame.t,
          samples: 1,
          landedAt: null,
        });
        continue;
      }
      const deltaTime = Math.max(0.001, frame.t - track.last);
      const speed =
        Math.hypot(
          projectile.x - track.projectile.x,
          projectile.y - track.projectile.y,
          projectile.z - track.projectile.z,
        ) / deltaTime;
      if (
        track.landedAt === null &&
        speed < 40 &&
        frame.t - track.first > 0.15
      ) {
        track.landedAt = frame.t;
      }
      track.projectile = projectile;
      track.last = frame.t;
      track.samples++;
    }
  }

  return [...tracks.entries()].map(([id, track]) => ({
    id,
    type: track.projectile.type,
    thrower: track.projectile.thrower ?? null,
    first: Number(track.first.toFixed(3)),
    last: Number(track.last.toFixed(3)),
    landedAt:
      track.landedAt === null ? null : Number(track.landedAt.toFixed(3)),
    samples: track.samples,
    x: Math.round(track.projectile.x),
    y: Math.round(track.projectile.y),
    z: Math.round(track.projectile.z),
  }));
}

export function decoyLandingStart(
  effect: UtilityEffect,
  frames: ProjectileSample[],
): number | null {
  if (effect.type !== "decoy") return null;
  const tracks = decoyProjectileTracks(frames);
  let best: (typeof tracks)[number] | null = null;
  let bestDistance = Infinity;

  for (const track of tracks) {
    if (track.landedAt === null) continue;
    const distance = Math.hypot(
      track.x - effect.x,
      track.y - effect.y,
      track.z - effect.z,
    );
    if (distance > 120 || distance >= bestDistance) continue;
    best = track;
    bestDistance = distance;
  }
  return best?.landedAt ?? null;
}

export function resolveDecoyEffect(
  effect: UtilityEffect,
  frames: ProjectileSample[],
): UtilityEffect {
  if (effect.type !== "decoy") return effect;
  const landedAt = decoyLandingStart(effect, frames);
  if (landedAt === null || landedAt >= effect.start) return effect;
  return {
    ...effect,
    start: landedAt,
    end: landedAt + 15,
  };
}

export function resolveFireEffect(effect: UtilityEffect): UtilityEffect {
  if (effect.type !== "fire") return effect;
  const maximumEnd = effect.start + FIRE_EFFECT_MAX_DURATION;
  if (effect.end <= maximumEnd) return effect;
  return { ...effect, end: maximumEnd };
}

export function resolveEffects(
  effects: UtilityEffect[],
  frames: ProjectileSample[],
): UtilityEffect[] {
  return effects.map((effect) =>
    resolveFireEffect(resolveDecoyEffect(effect, frames)),
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  const time = clamp01(value);
  return 1 - Math.pow(1 - time, 3);
}

export function drawFireMarker(
  layer: Container,
  x: number,
  y: number,
  color = 0xf97316,
  innerColor = 0x7c2d12,
): void {
  const graphics = new Graphics();
  graphics.position.set(x, y);
  graphics.scale.set(18 / 16);
  graphics
    .moveTo(0, -8)
    .bezierCurveTo(1.4, -5.4, 5.1, -3.8, 5.4, 0.1)
    .bezierCurveTo(6.1, 4.8, 3.3, 8, 0, 8)
    .bezierCurveTo(-4.1, 8, -6.2, 4.8, -5.3, 0.5)
    .bezierCurveTo(-4.8, -2, -2.8, -3.8, -2, -6.1)
    .bezierCurveTo(-0.7, -4.7, 0.1, -3.2, 0.4, -1.7)
    .bezierCurveTo(2.2, -3.8, 1.4, -6.1, 0, -8)
    .fill({ color, alpha: 1 })
    .stroke({ color: 0x111111, width: 1, alpha: 0.58 });
  graphics
    .moveTo(0.2, -2.6)
    .bezierCurveTo(2, -0.7, 2.8, 1.4, 2.1, 3.5)
    .bezierCurveTo(1.4, 5.2, -1.3, 5.4, -2.2, 3.4)
    .bezierCurveTo(-3, 1.5, -1.5, -0.7, 0.2, -2.6)
    .fill({ color: innerColor, alpha: 0.82 });
  layer.addChild(graphics);
}

export function drawTimerArc(
  graphics: Graphics,
  centerX: number,
  centerY: number,
  radius: number,
  lifeRemaining: number,
  color: number,
  width: number,
): void {
  if (lifeRemaining <= 0) return;
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * Math.min(1, lifeRemaining);
  graphics.moveTo(
    centerX + Math.cos(start) * radius,
    centerY + Math.sin(start) * radius,
  );
  graphics.arc(centerX, centerY, radius, start, end);
  graphics.stroke({ color, width, alpha: 0.95 });
}

export function drawCountdownLabel(
  layer: Container,
  text: string,
  x: number,
  y: number,
  color = 0xc8c8c8,
): void {
  type Segment = "a" | "b" | "c" | "d" | "e" | "f" | "g";
  const segments: Record<string, Segment[]> = {
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
  const characters = text.split("").filter((character) => segments[character]);
  if (!characters.length) return;
  const digitWidth = 7;
  const digitHeight = 12;
  const gap = 2;
  const thickness = 1.6;
  const totalWidth =
    characters.length * digitWidth + (characters.length - 1) * gap;
  const graphics = new Graphics();
  graphics.position.set(x - totalWidth / 2, y - digitHeight / 2);
  const rectangle = (rx: number, ry: number, width: number, height: number) => {
    graphics
      .roundRect(rx, ry, width, height, thickness / 2)
      .fill({ color, alpha: 0.95 });
  };
  characters.forEach((character, index) => {
    const offsetX = index * (digitWidth + gap);
    for (const segment of segments[character]) {
      if (segment === "a") {
        rectangle(offsetX + thickness, 0, digitWidth - thickness * 2, thickness);
      } else if (segment === "b") {
        rectangle(
          offsetX + digitWidth - thickness,
          thickness,
          thickness,
          digitHeight / 2 - thickness,
        );
      } else if (segment === "c") {
        rectangle(
          offsetX + digitWidth - thickness,
          digitHeight / 2,
          thickness,
          digitHeight / 2 - thickness,
        );
      } else if (segment === "d") {
        rectangle(
          offsetX + thickness,
          digitHeight - thickness,
          digitWidth - thickness * 2,
          thickness,
        );
      } else if (segment === "e") {
        rectangle(
          offsetX,
          digitHeight / 2,
          thickness,
          digitHeight / 2 - thickness,
        );
      } else if (segment === "f") {
        rectangle(
          offsetX,
          thickness,
          thickness,
          digitHeight / 2 - thickness,
        );
      } else {
        rectangle(
          offsetX + thickness,
          digitHeight / 2 - thickness / 2,
          digitWidth - thickness * 2,
          thickness,
        );
      }
    }
  });
  layer.addChild(graphics);
}

function effectRandom(effect: UtilityEffect, index: number): number {
  const typeSeed = effect.type
    .split("")
    .reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const value =
    Math.sin(
      effect.x * 0.0137 +
        effect.y * 0.0191 +
        effect.start * 7.31 +
        typeSeed * 0.17 +
        index * 91.73,
    ) * 43758.5453;
  return value - Math.floor(value);
}

function drawImpactFragments(
  graphics: Graphics,
  effect: UtilityEffect,
  centerX: number,
  centerY: number,
  progress: number,
  radius: number,
  color: number,
  count: number,
): void {
  const alpha = 1 - progress;
  for (let index = 0; index < count; index++) {
    const angle = effectRandom(effect, index) * Math.PI * 2;
    const distance =
      radius *
      progress *
      (0.45 + effectRandom(effect, index + 20) * 0.55);
    const length = 3 + effectRandom(effect, index + 40) * 7;
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;
    graphics
      .moveTo(x, y)
      .lineTo(x - Math.cos(angle) * length, y - Math.sin(angle) * length)
      .stroke({
        color,
        width: index % 3 === 0 ? 2 : 1.2,
        alpha: alpha * 0.85,
      });
  }
}

export function drawEffectVisual(
  layer: Container,
  effect: UtilityEffect,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number,
  contextualEffects: UtilityEffect[],
  drawIcon: DrawProjectileIcon,
): void {
  const position = toRadar(effect.x, effect.y, 0);
  const age = Math.max(0, time - effect.start);
  const total = Math.max(0.1, effect.end - effect.start);
  const life = clamp01(age / total);
  const remaining = 1 - life;
  const graphics = new Graphics();

  if (effect.type === "smoke") {
    const fadeIn = Math.min(1, age / 0.6);
    const fadeOut = life > 0.92 ? 1 - (life - 0.92) / 0.08 : 1;
    const alpha = Math.max(0, fadeIn * fadeOut);
    const radius = 156 * unitsToPx;
    const team = teamColor(effect.team);
    const clearAlpha = smokeBlastClearAlpha(effect, contextualEffects, time);
    graphics
      .circle(position.x, position.y, radius)
      .fill({ color: 0x737983, alpha: 0.31 * alpha * clearAlpha });
    for (let index = 0; index < 9; index++) {
      const angle = effectRandom(effect, index) * Math.PI * 2;
      const distance =
        radius * (0.18 + effectRandom(effect, index + 10) * 0.46) * fadeIn;
      const lobeRadius =
        radius * (0.23 + effectRandom(effect, index + 20) * 0.16) * fadeIn;
      graphics
        .circle(
          position.x + Math.cos(angle) * distance,
          position.y + Math.sin(angle) * distance,
          lobeRadius,
        )
        .fill({
          color: index % 2 ? 0xaeb3ba : 0x8d939c,
          alpha: 0.16 * alpha * clearAlpha,
        });
    }
    if (age < 0.75) {
      const burst = easeOutCubic(age / 0.75);
      graphics
        .circle(position.x, position.y, radius * (0.2 + burst * 0.8))
        .stroke({
          color: 0xd8dbe0,
          width: 3 - burst * 1.5,
          alpha: (1 - burst) * 0.8 * clearAlpha,
        });
      drawImpactFragments(
        graphics,
        effect,
        position.x,
        position.y,
        burst,
        radius * 0.82,
        0xc7cbd1,
        7,
      );
    }
    drawTimerArc(graphics, position.x, position.y, radius, remaining, team, 1.7);
    layer.addChild(graphics);
    drawCountdownLabel(
      layer,
      String(Math.max(0, Math.ceil(effect.end - time))),
      position.x,
      position.y,
      0xb8b8b8,
    );
    return;
  }

  if (effect.type === "flash") {
    const burst = clamp01(age / 0.26);
    const eased = easeOutCubic(burst);
    const alpha = 1 - burst;
    const outer = 5 + eased * 8;
    const inner = 2.2 + eased * 1.2;
    for (let index = 0; index < 8; index++) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 4;
      const radius = index % 2 === 0 ? outer : inner;
      const x = position.x + Math.cos(angle) * radius;
      const y = position.y + Math.sin(angle) * radius;
      if (index === 0) graphics.moveTo(x, y);
      else graphics.lineTo(x, y);
    }
    graphics
      .closePath()
      .fill({ color: 0xffffff, alpha: alpha * 0.92 })
      .stroke({ color: 0xfff7d6, width: 1, alpha: alpha * 0.8 });
    layer.addChild(graphics);
    return;
  }

  if (effect.type === "he") {
    const maximumRadius = 165 * unitsToPx;
    const progress = clamp01(age / 0.38);
    const shock = easeOutCubic(progress);
    const alpha = 1 - progress;
    graphics
      .circle(position.x, position.y, maximumRadius * shock)
      .stroke({
        color: 0xf97316,
        width: 3 - shock * 1.4,
        alpha: alpha * 0.9,
      });
    graphics
      .circle(position.x, position.y, Math.max(2.5, 7 - shock * 4))
      .fill({ color: 0xfbbf24, alpha: alpha * 0.9 });
    layer.addChild(graphics);
    return;
  }

  if (effect.type === "fire") {
    const radius = fireRadiusWorld(effect) * unitsToPx;
    const alpha =
      Math.min(1, age / 0.25) *
      (life > 0.92 ? 1 - (life - 0.92) / 0.08 : 1);
    const color = teamColor(effect.team);
    graphics
      .circle(position.x, position.y, radius)
      .fill({ color: teamDarkColor(effect.team), alpha: 0.32 * alpha });
    if (age < 0.7) {
      const ignition = easeOutCubic(age / 0.7);
      graphics
        .circle(position.x, position.y, radius * (0.18 + ignition * 0.82))
        .stroke({
          color,
          width: 3.5 - ignition * 1.8,
          alpha: (1 - ignition) * 0.9,
        });
      drawImpactFragments(
        graphics,
        effect,
        position.x,
        position.y,
        ignition,
        radius * 1.15,
        color,
        9,
      );
    }
    drawTimerArc(
      graphics,
      position.x,
      position.y,
      radius,
      remaining,
      color,
      1.7,
    );
    layer.addChild(graphics);
    drawFireMarker(
      layer,
      position.x,
      position.y,
      color,
      teamDarkColor(effect.team),
    );
    return;
  }

  if (effect.type === "decoy") {
    const shotPhase = (age % 0.72) / 0.72;
    if (shotPhase < 0.42) {
      const pulse = easeOutCubic(shotPhase / 0.42);
      graphics
        .circle(position.x, position.y, 6 + pulse * 16)
        .stroke({
          color: 0xc4b5fd,
          width: 2.2 - pulse,
          alpha: (1 - pulse) * 0.72,
        });
      const angle = effectRandom(effect, Math.floor(age / 0.72)) * Math.PI * 2;
      graphics
        .moveTo(
          position.x + Math.cos(angle) * 7,
          position.y + Math.sin(angle) * 7,
        )
        .lineTo(
          position.x + Math.cos(angle) * (13 + pulse * 5),
          position.y + Math.sin(angle) * (13 + pulse * 5),
        )
        .stroke({
          color: 0xede9fe,
          width: 1.8,
          alpha: (1 - pulse) * 0.85,
        });
      layer.addChild(graphics);
    }
    const wobbleX = Math.sin(time * 17) * 2.2;
    const wobbleY = Math.cos(time * 13) * 1.6;
    const rotation = Math.sin(time * 20) * 0.22;
    drawIcon(
      layer,
      "decoy",
      position.x + wobbleX + Math.cos(rotation) * 1.5,
      position.y + wobbleY + Math.sin(rotation) * 1.5,
      0xa78bfa,
    );
    return;
  }

  if (effect.type === "bomb_planted") {
    const pulse = (time * 1.5) % 1;
    graphics
      .circle(position.x, position.y, 19 * pulse)
      .stroke({
        color: 0xef4444,
        width: 2,
        alpha: 0.75 * (1 - pulse),
      });
    layer.addChild(graphics);
    drawIcon(layer, "c4", position.x, position.y, 0xef4444, 18);
  }
}

export function drawHabitEffectVisual(
  layer: Container,
  effect: HabitReplayEffect,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number,
  contextualEffects: HabitReplayEffect[],
  drawIcon: DrawProjectileIcon,
): void {
  if (time < effect.start || time > effect.end) return;
  drawEffectVisual(
    layer,
    effect as UtilityEffect,
    time,
    toRadar,
    unitsToPx,
    contextualEffects as UtilityEffect[],
    drawIcon,
  );
}
