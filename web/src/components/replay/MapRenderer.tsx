"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { useReplay } from "@/lib/replay-store";
import { MAP_CALIBRATION, RADAR_SIZE, worldToRadar } from "@/lib/maps";
import type { Frame, MatchEvent, PlayerPos, ProjectilePos, UtilityEffect, WeaponFireEvent } from "@/lib/types";
import { iconPathFor } from "@/lib/icons";

const iconTextureCache = new Map<string, Promise<Texture>>();
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
    out.push({
      ...pb,
      x: pa.x + (pb.x - pa.x) * alpha,
      y: pa.y + (pb.y - pa.y) * alpha,
      yaw: pa.yaw + dyaw * alpha,
      flashLeft,
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

function framePair(frames: Frame[], t: number): { a: Frame; b: Frame; alpha: number } | null {
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

function sampleProjectiles(frames: Frame[], t: number): ProjectilePos[] {
  const pair = framePair(frames, t);
  if (!pair) return [];
  const { a, b, alpha } = pair;
  const from = new Map((a.projectiles ?? []).map((p) => [p.id, p]));
  return (b.projectiles ?? []).map((pb) => {
    const pa = from.get(pb.id);
    if (!pa) return pb;
    return {
      ...pb,
      x: pa.x + (pb.x - pa.x) * alpha,
      y: pa.y + (pb.y - pa.y) * alpha,
      z: pa.z + (pb.z - pa.z) * alpha,
    };
  });
}

function fireVariantFromProjectiles(effect: UtilityEffect, frames: Frame[]): UtilityEffect {
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

function activeDefuse(events: MatchEvent[], time: number): { start: number; duration: number } | null {
  let active: { start: number; duration: number } | null = null;
  for (const event of events) {
    if (event.t > time) break;
    if (event.type === "bomb_defuse_start") {
      active = { start: event.t, duration: event.hasKit ? 5 : 10 };
    } else if (
      event.type === "bomb_defuse_abort" ||
      event.type === "bomb_defused" ||
      event.type === "bomb_exploded" ||
      event.type === "round_end"
    ) {
      active = null;
    }
  }
  return active;
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
  flashArc: Graphics;
};

function heightLift(z: number) {
  return Math.max(0, Math.min(22, Math.abs(z) / 35));
}

function drawUtilityIcon(
  layer: Container,
  name: string,
  x: number,
  y: number,
  color: number
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
      fitSprite(sprite, 16);
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
  // bg ring so we can read remaining at a glance
  g.circle(cx, cy, radius).stroke({ color: 0x000000, width, alpha: 0.35 });
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
    resolution: 2,
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
    // CS2 smoke radius ≈ 144 world units
    const radius = 144 * unitsToPx;
    const teamCol = teamColor(effect.team);
    g.circle(p.x, p.y, radius).fill({ color: 0x9ca3af, alpha: 0.42 * alpha });
    g.circle(p.x, p.y, radius).stroke({ color: 0x1d1f1f, width: 3.5, alpha: 0.7 * alpha });
    drawTimerArc(g, p.x, p.y, radius, remaining, teamCol, 2.2);
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
    const isIncendiary = effect.variant === "incendiary" || (!effect.variant && effect.team === 3);
    const radius = (isIncendiary ? 132 : 150) * unitsToPx;
    const alpha = Math.min(1, age / 0.25) * (life > 0.92 ? 1 - (life - 0.92) / 0.08 : 1);
    g.circle(p.x, p.y, radius).fill({ color: teamDarkColor(effect.team), alpha: 0.32 * alpha });
    g.circle(p.x, p.y, radius).stroke({ color: 0x1d1f1f, width: 3.5, alpha: 0.65 * alpha });
    drawTimerArc(g, p.x, p.y, radius, remaining, teamColor(effect.team), 2.2);
    const secsLeft = Math.max(0, Math.ceil(effect.end - time));
    drawCountdownLabel(g, String(secsLeft), p.x, p.y, 0xb8b8b8);
    layer.addChild(g);
    return;
  }

  if (effect.type === "decoy") {
    g.circle(p.x, p.y, 18)
      .stroke({ color: 0xa78bfa, width: 1.5, alpha: 0.35 + Math.sin(time * 8) * 0.15 });
    layer.addChild(g);
  }
}

function drawProjectile(
  layer: Container,
  projectile: ProjectilePos,
  frames: Frame[],
  time: number,
  throwerTeams: Map<number, number>,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number }
) {
  const color = teamColor(projectile.thrower ? throwerTeams.get(projectile.thrower) : undefined);
  const raw: { x: number; y: number }[] = [];
  for (const frame of frames) {
    if (frame.t > time || frame.t < time - 2.2) continue;
    const fp = frame.projectiles?.find((c) => c.id === projectile.id);
    if (!fp) continue;
    raw.push(toRadar(fp.x, fp.y, fp.z));
  }
  raw.push(toRadar(projectile.x, projectile.y, projectile.z));

  const trail = new Graphics();
  if (raw.length > 1) {
    trail.moveTo(raw[0].x, raw[0].y);
    for (let i = 1; i < raw.length - 1; i++) {
      const cx = raw[i].x;
      const cy = raw[i].y;
      const nx = (raw[i].x + raw[i + 1].x) / 2;
      const ny = (raw[i].y + raw[i + 1].y) / 2;
      trail.quadraticCurveTo(cx, cy, nx, ny);
    }
    trail.lineTo(raw[raw.length - 1].x, raw[raw.length - 1].y);
    trail.stroke({ color, width: 2, alpha: 0.55 });
  }

  const p = toRadar(projectile.x, projectile.y, projectile.z);
  const shadow = toRadar(projectile.x, projectile.y, 0);
  trail.circle(shadow.x, shadow.y, 4).fill({ color: 0x000000, alpha: 0.25 });
  layer.addChild(trail);
  drawUtilityIcon(layer, projectile.type, p.x, p.y, color);
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
  const appRef = useRef<Application | null>(null);
  const bgLayerRef = useRef<Container | null>(null);
  const utilityLayerRef = useRef<Container | null>(null);
  const playerLayerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Map<number, PlayerSprite>>(new Map());
  const loadedMapRef = useRef<string | null>(null);

  // init pixi once
  useEffect(() => {
    let disposed = false;
    const host = hostRef.current;
    const sprites = spritesRef.current;
    if (!host) return;

    const app = new Application();
    (async () => {
      await app.init({
        width: size,
        height: size,
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
      const playerLayer = new Container();
      app.stage.addChild(bgLayer);
      app.stage.addChild(utilityLayer);
      app.stage.addChild(playerLayer);
      app.canvas.style.position = "absolute";
      app.canvas.style.inset = "0";
      app.canvas.style.zIndex = "1";
      host.appendChild(app.canvas);
      appRef.current = app;
      bgLayerRef.current = bgLayer;
      utilityLayerRef.current = utilityLayer;
      playerLayerRef.current = playerLayer;
    })();

    return () => {
      disposed = true;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
      sprites.clear();
      loadedMapRef.current = null;
    };
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
      if (!match || !layer || !utilityLayer) return;
      const round = match.rounds[currentRoundIdx];
      if (!round) return;
      const calib = MAP_CALIBRATION[match.meta.map];
      if (!calib) return;

      const positions = sampleFrame(round.frames, time);
      const frame = nearestFrame(round.frames, time);
      const bombPair = framePair(round.frames, time);
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
      const projectiles = sampleProjectiles(round.frames, time);
      const throwerTeams = new Map(positions.map((p) => [p.id, p.team]));
      const scale = size / RADAR_SIZE;
      const seen = new Set<number>();
      for (const child of utilityLayer.removeChildren()) {
        child.destroy({ children: true });
      }

      const toRadar = (x: number, y: number, z = 0) => {
        const p = worldToRadar(x, y, calib);
        return { x: p.x * scale, y: p.y * scale - heightLift(z) };
      };

      const unitsToPx = scale / calib.scale;
      const activeEffects = (round.effects ?? []).filter(
        (e) => time >= e.start && time <= e.end
      );
      for (const effect of activeEffects) {
        drawEffect(utilityLayer, fireVariantFromProjectiles(effect, round.frames), time, toRadar, unitsToPx);
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

      if (smoothBomb && smoothBomb.status !== "carried") {
        const p = toRadar(smoothBomb.x, smoothBomb.y, smoothBomb.z);
        if (smoothBomb.status === "planted") {
          const pulse = 0.65 + Math.sin(time * 7) * 0.25;
          const ring = new Graphics()
            .circle(p.x, p.y, 15 + pulse * 4)
            .stroke({ color: 0xef4444, width: 2, alpha: 0.45 + pulse * 0.35 });
          utilityLayer.addChild(ring);
          const defuse = activeDefuse(round.events, time);
          if (defuse && time >= defuse.start) {
            const progress = Math.max(0, Math.min(1, (time - defuse.start) / defuse.duration));
            const arc = new Graphics();
            arc.circle(p.x, p.y, 23).stroke({ color: 0x0b1220, width: 4, alpha: 0.7 });
            arc.moveTo(p.x, p.y - 23);
            arc.arc(p.x, p.y, 23, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
            arc.stroke({ color: 0x60a5fa, width: 4, alpha: 0.95 });
            drawCountdownLabel(arc, String(Math.max(0, Math.ceil(defuse.duration - (time - defuse.start)))), p.x, p.y - 32, 0x93c5fd);
            utilityLayer.addChild(arc);
          }
        }
        const bombSprite = new Sprite();
        bombSprite.anchor.set(0.5);
        bombSprite.position.set(p.x, p.y);
        bombSprite.tint = smoothBomb.status === "planted" ? 0xef4444 : 0xfbbf24;
        utilityLayer.addChild(bombSprite);
        loadIconTexture("/icons/c4.svg")
          .then((tex) => {
            if (bombSprite.destroyed) return;
            bombSprite.texture = tex;
            fitSprite(bombSprite, 18);
          })
          .catch(() => {});
      }

      const projectileTypeToEffect = (type: string): string | null => {
        const t = type.toLowerCase();
        if (t.includes("smoke")) return "smoke";
        if (t.includes("molotov") || t.includes("incendiary") || t.includes("inferno")) return "fire";
        if (t.includes("decoy")) return "decoy";
        if (t.includes("flash")) return "flash";
        if (t.startsWith("he") || t.includes("high explosive")) return "he";
        return null;
      };

      // Match each started effect to ONE projectile (1-to-1). We sort
      // effects by start time and greedily assign the closest unclaimed
      // projectile of the same type at that instant. This prevents a
      // second flash/HE in the same spot from being swallowed by the first
      // detonation's suppression.
      const detonatedIds = new Set<number>();
      const startedEffects = (round.effects ?? [])
        .filter((e) => time >= e.start)
        .slice()
        .sort((a, b) => a.start - b.start);
      for (const e of startedEffects) {
        const sampled = sampleProjectiles(round.frames, e.start);
        let bestId: number | null = null;
        let bestDist = Infinity;
        for (const sp of sampled) {
          if (projectileTypeToEffect(sp.type) !== e.type) continue;
          if (detonatedIds.has(sp.id)) continue;
          const dx = sp.x - e.x;
          const dy = sp.y - e.y;
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            bestId = sp.id;
          }
        }
        if (bestId !== null) detonatedIds.add(bestId);
      }

      for (const projectile of projectiles) {
        if (detonatedIds.has(projectile.id)) continue;
        const pType = projectileTypeToEffect(projectile.type);
        const hiddenByNearbyEffect = pType
          ? startedEffects.some((e) => {
              if (e.type !== pType || time < e.start) return false;
              const dx = projectile.x - e.x;
              const dy = projectile.y - e.y;
              return dx * dx + dy * dy <= 350 * 350;
            })
          : false;
        if (hiddenByNearbyEffect) continue;
        drawProjectile(utilityLayer, projectile, round.frames, time, throwerTeams, toRadar);
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
            resolution: 2,
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
            flashArc,
          };
          spritesRef.current.set(p.id, s);
        }
        const baseColor = p.hasBomb ? 0xef4444 : teamColor(p.team);
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
        s.container.position.set(px, py);
        s.arrowRotator.rotation = (-p.yaw * Math.PI) / 180;
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
