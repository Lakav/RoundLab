import { Container, FillGradient, Graphics } from "pixi.js";
import { smokeBlastClearAlpha } from "@/lib/replay-logic";
import type { HabitReplayEffect } from "@/lib/replay-store";
import type { ProjectilePos, UtilityEffect } from "@/lib/types";
import {
  circleOverlapArea,
  fireIsSmoked,
  fireRadiusWorld,
} from "@/lib/utility-geometry";
import { teamColor } from "./map-renderer-player";
import { REPLAY_COLORS } from "./map-renderer-colors";
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

/** Radar-space position of a player blinded by a flash, for the victim links. */
export type FlashVictimPoint = { x: number; y: number; blind: number };

const SMOKE_RADIUS_PX_WORLD = 156;
const HE_RADIUS_WORLD = 165;
const FLASH_VEIL_RADIUS_WORLD = 420;
const DECOY_FOOTPRINT_WORLD = 70;
const DECOY_SHOT_CADENCE = [0, 0.11, 0.22, 0.9, 1.02, 1.7, 1.81, 1.92, 2.6] as const;
const DECOY_SHOT_LOOP = 3.2;

function radialFill(
  colorStops: Array<{ offset: number; color: number; alpha: number }>,
): FillGradient {
  return new FillGradient({
    type: "radial",
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    textureSpace: "local",
    colorStops: colorStops.map(({ offset, color, alpha }) => ({
      offset,
      color: { r: (color >> 16) & 0xff, g: (color >> 8) & 0xff, b: color & 0xff, a: alpha },
    })),
  });
}

/** A gradient-filled disc needs its own Graphics so `local` space is the disc itself. */
function gradientDisc(
  layer: Container,
  x: number,
  y: number,
  radius: number,
  colorStops: Array<{ offset: number; color: number; alpha: number }>,
): void {
  if (radius <= 0.5) return;
  const disc = new Graphics();
  disc.circle(x, y, radius).fill(radialFill(colorStops));
  layer.addChild(disc);
}

function dashedCircle(
  graphics: Graphics,
  x: number,
  y: number,
  radius: number,
  color: number,
  alpha: number,
  width: number,
  dashes = 40,
): void {
  if (alpha <= 0.005) return;
  const step = (Math.PI * 2) / dashes;
  for (let index = 0; index < dashes; index++) {
    const from = index * step;
    graphics.moveTo(x + Math.cos(from) * radius, y + Math.sin(from) * radius);
    graphics.arc(x, y, radius, from, from + step * 0.55);
  }
  graphics.stroke({ color, width, alpha, cap: "round" });
}

/** Sparks that arc and fall instead of flying straight: debris, not rays. */
function drawSparks(
  graphics: Graphics,
  effect: UtilityEffect,
  centerX: number,
  centerY: number,
  progress: number,
  radius: number,
  color: number,
  count: number,
  seedOffset = 0,
): void {
  const alpha = 1 - progress;
  if (alpha <= 0) return;
  for (let index = 0; index < count; index++) {
    const seed = index + seedOffset;
    const angle = effectRandom(effect, seed) * Math.PI * 2;
    const distance = radius * progress * (0.45 + effectRandom(effect, seed + 20) * 0.55);
    const length = 3 + effectRandom(effect, seed + 40) * 7;
    const x = centerX + Math.cos(angle) * distance;
    const y = centerY + Math.sin(angle) * distance;
    const fall = 4 * progress;
    graphics
      .moveTo(x, y)
      .quadraticCurveTo(
        x - Math.cos(angle) * length * 0.6,
        y - Math.sin(angle) * length * 0.6 + fall * 0.5,
        x - Math.cos(angle) * length,
        y - Math.sin(angle) * length + fall,
      )
      .stroke({ color, width: index % 3 === 0 ? 2 : 1.2, alpha: alpha * 0.85, cap: "round" });
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
  flashVictims: readonly FlashVictimPoint[] = [],
): void {
  const position = toRadar(effect.x, effect.y, 0);
  const age = Math.max(0, time - effect.start);
  const total = Math.max(0.1, effect.end - effect.start);
  const life = clamp01(age / total);
  const remaining = 1 - life;
  const graphics = new Graphics();

  if (effect.type === "smoke") {
    // The edge is what hides players, so the volume is densest at the edge and
    // the true boundary stays crisp until the very end. Lobes drift slowly so
    // the smoke breathes without crawling; there are no fragments because a
    // smoke does not shatter. The body dissipates over the last 2.5 s and the
    // countdown only appears for the final 5 s: the arc is enough before that.
    const radius = SMOKE_RADIUS_PX_WORLD * unitsToPx;
    const team = teamColor(effect.team);
    const clearAlpha = smokeBlastClearAlpha(effect, contextualEffects, time);
    const bloom = easeOutCubic(age / 0.9);
    const dissipation = clamp01((age - (total - 2.5)) / 2.5);
    const body = (1 - dissipation * 0.8) * clearAlpha;
    const bloomRadius = radius * bloom;

    gradientDisc(layer, position.x, position.y, bloomRadius, [
      { offset: 0, color: 0x8c929a, alpha: 0.22 * body },
      { offset: 0.75, color: 0x969ca4, alpha: 0.36 * body },
      { offset: 1, color: 0x969ca4, alpha: 0.42 * body },
    ]);
    for (let index = 0; index < 8; index++) {
      const phase = effectRandom(effect, index + 60) * Math.PI * 2;
      const angle = effectRandom(effect, index) * Math.PI * 2 + Math.sin(time * 0.35 + phase) * 0.25;
      const distance = radius * (0.25 + effectRandom(effect, index + 10) * 0.4) * bloom * (1 - dissipation * 0.5);
      const lobeRadius =
        radius * (0.22 + effectRandom(effect, index + 20) * 0.14) * bloom
        * (0.9 + Math.sin(time * 0.9 + phase) * 0.1) * (1 - dissipation * 0.6);
      graphics
        .circle(position.x + Math.cos(angle) * distance, position.y + Math.sin(angle) * distance, lobeRadius)
        .fill({ color: index % 2 ? 0xbec3ca : 0xa0a6ae, alpha: 0.13 * body });
    }
    graphics
      .circle(position.x, position.y, bloomRadius)
      .stroke({ color: REPLAY_COLORS.smoke, width: 1.6, alpha: 0.8 * (1 - dissipation * 0.6) * clearAlpha });
    if (age < 0.9) {
      graphics
        .circle(position.x, position.y, radius * (0.2 + bloom * 0.8))
        .stroke({ color: 0xd8dbe0, width: 3 - bloom * 1.5, alpha: (1 - bloom) * 0.8 * clearAlpha });
    }
    drawTimerArc(graphics, position.x, position.y, radius + 3, remaining, team, 1.5);
    layer.addChild(graphics);
    const secondsLeft = effect.end - time;
    if (secondsLeft <= 5) {
      drawCountdownLabel(layer, String(Math.max(0, Math.ceil(secondsLeft))), position.x, position.y, 0xf2f5f4);
    }
    return;
  }

  if (effect.type === "flash") {
    // The veil is bounded to the flash's own reach, not the whole radar, so it
    // reads as "this area got lit", and each player actually blinded by this
    // flash is linked to it while their blindness lasts. That is the honest
    // answer to "who got flashed": the data, not a guess.
    const burst = clamp01(age / 0.5);
    const eased = easeOutCubic(burst);
    const veilRadius = FLASH_VEIL_RADIUS_WORLD * unitsToPx * (0.45 + eased * 0.55);
    if (burst < 1) {
      gradientDisc(layer, position.x, position.y, veilRadius, [
        { offset: 0, color: 0xffffff, alpha: 0.55 * (1 - burst) },
        { offset: 0.35, color: REPLAY_COLORS.flash, alpha: 0.3 * (1 - burst) },
        { offset: 1, color: REPLAY_COLORS.flash, alpha: 0 },
      ]);
      gradientDisc(layer, position.x, position.y, 10 + eased * 44, [
        { offset: 0, color: 0xffffff, alpha: 0.95 * (1 - burst) },
        { offset: 0.35, color: REPLAY_COLORS.flash, alpha: 0.5 * (1 - burst) },
        { offset: 1, color: REPLAY_COLORS.flash, alpha: 0 },
      ]);
    }
    const rayFade = Math.max(0, 1 - burst * 1.6);
    if (rayFade > 0) {
      for (let index = 0; index < 8; index++) {
        const angle = (index * Math.PI) / 4 + 0.2;
        const length = (index % 2 ? 14 : 30) + eased * 16;
        graphics
          .moveTo(position.x + Math.cos(angle) * 6, position.y + Math.sin(angle) * 6)
          .lineTo(position.x + Math.cos(angle) * length, position.y + Math.sin(angle) * length)
          .stroke({ color: 0xffffff, width: index % 2 ? 0.8 : 1.4, alpha: rayFade * 0.6, cap: "round" });
      }
    }
    const linger = clamp01((age - 0.2) / 1.2);
    if (linger < 1) {
      graphics
        .circle(position.x, position.y, 9)
        .stroke({ color: REPLAY_COLORS.flash, width: 1.2, alpha: 0.5 * (1 - linger) });
    }
    for (const victim of flashVictims) {
      const linkFade = clamp01(1 - age / 0.6);
      if (linkFade > 0) {
        graphics
          .moveTo(position.x, position.y)
          .lineTo(victim.x, victim.y)
          .stroke({ color: 0xffffff, width: 1, alpha: 0.45 * linkFade });
      }
      if (victim.blind > 0) {
        graphics
          .circle(victim.x, victim.y, 11)
          .fill({ color: 0xffffff, alpha: 0.5 * victim.blind });
      }
    }
    layer.addChild(graphics);
    return;
  }

  if (effect.type === "he") {
    // One hard frame, a shockwave that fills the damage radius exactly once, a
    // dotted ring that keeps the true reach for a beat, debris that falls, and
    // three smoke puffs that give the blast the weight the ring alone lacks.
    const maximumRadius = HE_RADIUS_WORLD * unitsToPx;
    if (age < 0.06) {
      const frame = 1 - age / 0.06;
      gradientDisc(layer, position.x, position.y, maximumRadius * 1.6, [
        { offset: 0, color: 0xffdc96, alpha: 0.28 * frame },
        { offset: 1, color: 0xffdc96, alpha: 0 },
      ]);
      const points: number[] = [];
      for (let index = 0; index < 12; index++) {
        const angle = (index * Math.PI) / 6;
        const spike = index % 2 ? 9 : 24 + effectRandom(effect, index) * 8;
        points.push(position.x + Math.cos(angle) * spike, position.y + Math.sin(angle) * spike);
      }
      graphics.poly(points).fill({ color: 0xfff7e0, alpha: 1 });
    }
    const progress = clamp01(age / 0.34);
    const shock = easeOutCubic(progress);
    if (progress < 1) {
      gradientDisc(layer, position.x, position.y, maximumRadius * shock, [
        { offset: 0, color: REPLAY_COLORS.he, alpha: 0 },
        { offset: 0.7, color: REPLAY_COLORS.he, alpha: 0 },
        { offset: 1, color: REPLAY_COLORS.he, alpha: 0.28 * (1 - progress) },
      ]);
      graphics
        .circle(position.x, position.y, maximumRadius * shock)
        .stroke({ color: 0xffe4b5, width: 3.2 - shock * 2.4, alpha: (1 - progress) * 0.95 });
    }
    if (age < 0.7) {
      dashedCircle(
        graphics, position.x, position.y, maximumRadius, REPLAY_COLORS.he,
        0.55 * (1 - clamp01((age - 0.3) / 0.4)), 1.2,
      );
    }
    const core = Math.max(0, 11 - easeOutCubic(age / 0.5) * 11);
    if (core > 0) {
      gradientDisc(layer, position.x, position.y, core * 2.2, [
        { offset: 0, color: 0xffffff, alpha: 0.95 },
        { offset: 0.4, color: 0xfbbf24, alpha: 0.8 },
        { offset: 1, color: REPLAY_COLORS.he, alpha: 0 },
      ]);
    }
    drawSparks(graphics, effect, position.x, position.y, easeOutCubic(age / 0.55), maximumRadius * 0.8, 0xfbbf24, 10);
    const puff = clamp01((age - 0.12) / 1.4);
    if (puff > 0 && puff < 1) {
      for (let index = 0; index < 3; index++) {
        const angle = effectRandom(effect, 30 + index) * Math.PI * 2;
        const distance = 6 + easeOutCubic(puff) * (10 + effectRandom(effect, 40 + index) * 10);
        const puffRadius = 6 + easeOutCubic(puff) * (14 + effectRandom(effect, 50 + index) * 6);
        graphics
          .circle(position.x + Math.cos(angle) * distance, position.y + Math.sin(angle) * distance - puff * 8, puffRadius)
          .fill({ color: 0x786e64, alpha: 0.32 * (1 - puff) * (1 - puff) });
      }
    }
    layer.addChild(graphics);
    return;
  }

  if (effect.type === "fire") {
    // One warm disc that breathes slowly, the true damage edge in dashed
    // danger red, the timer arc and the flame glyph. Fire is danger, not team
    // identity, so nothing here takes the team colour except the timer.
    const radius = fireRadiusWorld(effect) * unitsToPx;
    const spread = easeOutCubic(age / 0.45);
    const fade = 1 - clamp01((age - (total - 1)) / 1);
    const breathe = 0.94 + 0.06 * Math.sin(time * 2.4);
    const color = teamColor(effect.team);
    gradientDisc(layer, position.x, position.y, radius * spread * breathe, [
      { offset: 0, color: 0xff963c, alpha: 0.5 * fade },
      { offset: 0.7, color: 0xdc4628, alpha: 0.3 * fade },
      { offset: 1, color: 0xc83228, alpha: 0.08 * fade },
    ]);
    dashedCircle(graphics, position.x, position.y, radius * spread, REPLAY_COLORS.danger, 0.8 * fade, 1.4, 36);
    drawTimerArc(graphics, position.x, position.y, radius + 4, remaining, color, 1.5);
    layer.addChild(graphics);
    drawFireMarker(layer, position.x, position.y, 0xf97316, 0x7c2d12);
    return;
  }

  if (effect.type === "decoy") {
    // A decoy is a grenade lying on the ground: it does not wobble. Each fake
    // shot is a muzzle tick in a random direction plus a sound ring, on an
    // irregular cadence like a real burst, inside a faint dotted footprint.
    const footprint = DECOY_FOOTPRINT_WORLD * unitsToPx;
    dashedCircle(graphics, position.x, position.y, footprint, REPLAY_COLORS.decoy, 0.3, 1, 28);
    const loopAge = age % DECOY_SHOT_LOOP;
    const loopIndex = Math.floor(age / DECOY_SHOT_LOOP);
    for (let index = 0; index < DECOY_SHOT_CADENCE.length; index++) {
      const shotAge = loopAge - DECOY_SHOT_CADENCE[index];
      if (shotAge < 0 || shotAge > 0.5) continue;
      const pulse = easeOutCubic(shotAge / 0.5);
      graphics
        .circle(position.x, position.y, 8 + pulse * 22)
        .stroke({ color: 0xc4b5fd, width: 1.6 - pulse, alpha: (1 - pulse) * 0.55 });
      const tick = clamp01(shotAge / 0.12);
      if (tick < 1) {
        const angle = effectRandom(effect, index + loopIndex * 9) * Math.PI * 2;
        graphics
          .moveTo(position.x + Math.cos(angle) * 7, position.y + Math.sin(angle) * 7)
          .lineTo(position.x + Math.cos(angle) * 15, position.y + Math.sin(angle) * 15)
          .stroke({ color: 0xfff0c8, width: 2, alpha: 1 - tick, cap: "round" });
      }
    }
    layer.addChild(graphics);
    drawIcon(layer, "decoy", position.x, position.y, REPLAY_COLORS.decoy);
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
