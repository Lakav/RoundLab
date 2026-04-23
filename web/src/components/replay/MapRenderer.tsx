"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { useReplay } from "@/lib/replay-store";
import { MAP_CALIBRATION, RADAR_SIZE, worldToRadar } from "@/lib/maps";
import type { Frame, PlayerPos, ProjectilePos, UtilityEffect } from "@/lib/types";
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
    out.push({
      ...pb,
      x: pa.x + (pb.x - pa.x) * alpha,
      y: pa.y + (pb.y - pa.y) * alpha,
      yaw: pa.yaw + (pb.yaw - pa.yaw) * alpha,
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

function teamColor(team?: number) {
  if (team === 3) return 0x5ab0ff;
  if (team === 2) return 0xf5b042;
  return 0xe5e7eb;
}

function displayName(name?: string) {
  return name === "L999" ? "grosNoob" : name ?? "";
}

type PlayerSprite = {
  container: Container;
  dot: Graphics;
  hpRing: Graphics;
  arrow: Graphics;
  label: Text;
  held: Sprite;
  heldPath: string | null;
  armor: Graphics;
  flashArc: Graphics;
};

function drawLabel(layer: Container, text: string, x: number, y: number, color = 0xfbbf24) {
  const label = new Text({
    text,
    style: {
      fontFamily: "ui-sans-serif, system-ui",
      fontSize: 9,
      fontWeight: "800",
      fill: 0x0f0a00,
    },
  });
  label.anchor.set(0.5);
  label.position.set(x, y);
  const bg = new Graphics()
    .roundRect(-9, -6, 18, 12, 3)
    .fill({ color, alpha: 1 });
  label.addChildAt(bg, 0);
  layer.addChild(label);
}

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

function drawArmorBadge(g: Graphics, armor: number, helmet?: boolean) {
  g.clear();
  if (armor <= 0 && !helmet) return;

  const color = 0x050706;
  g.moveTo(0, -5.4)
    .lineTo(5, -3.6)
    .lineTo(5, 0.6)
    .bezierCurveTo(5, 3.7, 3.1, 6, 0, 7)
    .bezierCurveTo(-3.1, 6, -5, 3.7, -5, 0.6)
    .lineTo(-5, -3.6)
    .lineTo(0, -5.4)
    .stroke({ color, width: 1.35, alpha: 0.96 });

  if (helmet) {
    g.moveTo(-3.3, 1.2)
      .bezierCurveTo(-3.2, -1.9, 3.2, -1.9, 3.3, 1.2)
      .lineTo(2.1, 1.2)
      .bezierCurveTo(2, -0.6, -2, -0.6, -2.1, 1.2)
      .lineTo(-3.3, 1.2)
      .stroke({ color, width: 1.2, alpha: 0.96 });
  }
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

function drawEffect(
  layer: Container,
  effect: UtilityEffect,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number }
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
    const radius = 30;
    g.circle(p.x, p.y, radius)
      .fill({ color: 0xe5e7eb, alpha: 0.78 * alpha });
    g.circle(p.x, p.y, radius)
      .stroke({ color: 0xf3f4f6, width: 1.5, alpha: 0.9 * alpha });
    drawTimerArc(g, p.x, p.y, radius + 4, remaining, 0xffffff, 2);
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
    if (life < 0.35) {
      const burst = life / 0.35;
      const coreR = 6 + burst * 18;
      const shockR = 10 + burst * 42;
      g.circle(p.x, p.y, coreR)
        .fill({ color: 0xfef3c7, alpha: 1 - burst })
        .circle(p.x, p.y, coreR * 0.7)
        .fill({ color: 0xfbbf24, alpha: 0.9 * (1 - burst) })
        .circle(p.x, p.y, coreR * 0.4)
        .fill({ color: 0xf97316, alpha: 0.9 * (1 - burst) });
      g.circle(p.x, p.y, shockR)
        .stroke({ color: 0xfbbf24, width: 3, alpha: 0.9 * (1 - burst) });
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2 + effect.x;
        const inner = 8 + burst * 10;
        const outer = inner + 12 + burst * 20;
        g.moveTo(p.x + Math.cos(ang) * inner, p.y + Math.sin(ang) * inner)
          .lineTo(p.x + Math.cos(ang) * outer, p.y + Math.sin(ang) * outer)
          .stroke({ color: 0xfacc15, width: 2, alpha: (1 - burst) * 0.85 });
      }
      g.circle(p.x, p.y, shockR + 4)
        .stroke({ color: 0xffffff, width: 1.5, alpha: 0.6 * (1 - burst) });
    } else {
      const smokeFade = 1 - (life - 0.35) / 0.65;
      g.circle(p.x, p.y, 14)
        .fill({ color: 0x4b5563, alpha: 0.35 * smokeFade })
        .circle(p.x + 4, p.y - 3, 10)
        .fill({ color: 0x6b7280, alpha: 0.25 * smokeFade });
    }
    layer.addChild(g);
    return;
  }

  if (effect.type === "fire") {
    const radius = 26;
    const flicker = 0.9 + Math.sin(time * 14 + effect.x) * 0.1;
    g.circle(p.x, p.y, radius * flicker).fill({ color: 0xf97316, alpha: 0.28 });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + time * 0.8;
      const dist = radius * 0.55;
      const flameR = 10 + Math.sin(time * 10 + i) * 3;
      const fx = p.x + Math.cos(ang) * dist;
      const fy = p.y + Math.sin(ang) * dist;
      g.circle(fx, fy, flameR).fill({ color: 0xfbbf24, alpha: 0.45 });
      g.circle(fx, fy, flameR * 0.6).fill({ color: 0xef4444, alpha: 0.5 });
    }
    g.circle(p.x, p.y, 8 + Math.sin(time * 20) * 2).fill({ color: 0xfacc15, alpha: 0.8 });
    drawTimerArc(g, p.x, p.y, radius + 5, remaining, 0xfb923c, 2);
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
        const tex = await Assets.load(`/radars/${map}.png`);
        if (cancel || !bgLayerRef.current) return;
        bgLayerRef.current.removeChildren();
        const bg = new Sprite(tex);
        bg.width = size;
        bg.height = size;
        bgLayerRef.current.addChild(bg);
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

      const activeEffects = (round.effects ?? []).filter(
        (e) => time >= e.start && time <= e.end
      );
      for (const effect of activeEffects) {
        drawEffect(utilityLayer, effect, time, toRadar);
      }

      if (smoothBomb && smoothBomb.status !== "carried") {
        const p = toRadar(smoothBomb.x, smoothBomb.y, smoothBomb.z);
        if (smoothBomb.status === "planted") {
          const pulse = 0.65 + Math.sin(time * 7) * 0.25;
          const ring = new Graphics()
            .circle(p.x, p.y, 15 + pulse * 4)
            .stroke({ color: 0xef4444, width: 2, alpha: 0.45 + pulse * 0.35 });
          utilityLayer.addChild(ring);
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

      // For each started effect, match it to the projectile whose trajectory
      // passes closest to the effect origin at time == effect.start. That
      // projectile's id is then considered detonated → suppressed from now on.
      const detonatedIds = new Set<number>();
      for (const e of round.effects ?? []) {
        if (time < e.start) continue;
        // sample projectiles at the instant the effect started
        const sampled = sampleProjectiles(round.frames, e.start);
        let bestId: number | null = null;
        let bestDist = Infinity;
        for (const sp of sampled) {
          if (projectileTypeToEffect(sp.type) !== e.type) continue;
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
          const arrow = new Graphics();
          const dot = new Graphics();
          const hpRing = new Graphics();
          const playerInfo = match.players.find((pl) => pl.steamId === p.id);
          const label = new Text({
            text: displayName(playerInfo?.name),
            style: {
              fontFamily: "ui-sans-serif, system-ui",
              fontSize: 44,
              fontWeight: "700",
              fill: 0xffffff,
              dropShadow: {
                color: 0x000000,
                alpha: 0.95,
                blur: 4,
                distance: 0,
              },
            },
            resolution: 2,
          });
          label.anchor.set(0.5, 1);
          label.scale.set(0.25);
          label.position.set(0, -13);
          const held = new Sprite();
          held.anchor.set(0.5, 0);
          held.position.set(0, 8);
          held.visible = false;
          const armor = new Graphics();
          armor.position.set(0, 0);
          const flashArc = new Graphics();
          container.addChild(arrow);
          container.addChild(dot);
          container.addChild(hpRing);
          container.addChild(armor);
          container.addChild(flashArc);
          container.addChild(label);
          container.addChild(held);
          layer.addChild(container);
          s = { container, dot, hpRing, arrow, label, held, heldPath: null, armor, flashArc };
          spritesRef.current.set(p.id, s);
        }
        const baseColor = p.hasBomb ? 0xef4444 : teamColor(p.team);
        const hpPct = Math.max(0, Math.min(100, p.hp)) / 100;
        s.dot.clear();
        s.hpRing.clear();
        if (p.hp > 0) {
          const barW = 12;
          const armorPct = Math.max(0, Math.min(100, p.armor)) / 100;
          s.hpRing
            .rect(-barW / 2, -10, barW, 1.6)
            .fill({ color: 0x000000, alpha: 0.55 })
            .rect(-barW / 2, -10, barW * hpPct, 1.6)
            .fill({ color: baseColor, alpha: 1 });
          if (p.armor > 0 || p.helmet) {
            s.hpRing
              .rect(-barW / 2, -8, barW, 1.2)
              .fill({ color: 0x000000, alpha: 0.55 })
              .rect(-barW / 2, -8, barW * armorPct, 1.2)
              .fill({ color: p.helmet ? 0x6ee7b7 : 0xd4d4d8, alpha: 1 });
          }
        }
        s.arrow.clear()
          .moveTo(9, 0)
          .lineTo(-5, -6)
          .lineTo(-2.5, 0)
          .lineTo(-5, 6)
          .lineTo(9, 0)
          .fill({ color: baseColor, alpha: p.hp > 0 ? 0.95 : 0.35 })
          .stroke({ color: 0x050706, width: 1, alpha: 1 });
        s.armor.clear();
        s.flashArc.clear();
        if (p.hp > 0 && p.flashLeft && p.flashLeft > 0 && p.flashTotal && p.flashTotal > 0) {
          const fracRemaining = Math.max(0, Math.min(1, p.flashLeft / p.flashTotal));
          const start = -Math.PI / 2;
          const end = start + Math.PI * 2 * fracRemaining;
          s.flashArc
            .circle(0, 0, 10)
            .stroke({ color: 0x1f2937, width: 1.5, alpha: 0.5 })
            .arc(0, 0, 10, start, end)
            .stroke({ color: 0xfffbeb, width: 2, alpha: 0.95 });
        }
        const heldPath = p.hp > 0 ? iconPathFor(p.active) : null;
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
                fitSprite(sprite, 11);
                sprite.visible = true;
              })
              .catch(() => {});
          }
        }
        s.held.tint = baseColor;
        s.container.position.set(px, py);
        s.arrow.rotation = (-p.yaw * Math.PI) / 180;
        s.container.alpha = p.hp > 0 ? 1 : 0.35;
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
      className="relative overflow-hidden rounded-xl bg-[#050706] ring-1 ring-white/[0.08]"
    >
      {map && (
        // The radar is kept in the DOM instead of only in Pixi: it is more
        // reliable across browsers/headless renderers while Pixi handles motion.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/radars/${map}.png`}
          alt=""
          className="absolute inset-0 z-0 size-full select-none object-cover opacity-95"
          draggable={false}
        />
      )}
    </div>
  );
}
