"use client";

import { useEffect, useRef } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text } from "pixi.js";
import { useReplay } from "@/lib/replay-store";
import { MAP_CALIBRATION, RADAR_SIZE, worldToRadar } from "@/lib/maps";
import type { Frame, PlayerPos } from "@/lib/types";

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

type PlayerSprite = {
  container: Container;
  dot: Graphics;
  arrow: Graphics;
  label: Text;
};

export function MapRenderer({ size = 800 }: { size?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const bgLayerRef = useRef<Container | null>(null);
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
      const playerLayer = new Container();
      app.stage.addChild(bgLayer);
      app.stage.addChild(playerLayer);
      host.appendChild(app.canvas);
      appRef.current = app;
      bgLayerRef.current = bgLayer;
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
      if (!match || !layer) return;
      const round = match.rounds[currentRoundIdx];
      if (!round) return;
      const calib = MAP_CALIBRATION[match.meta.map];
      if (!calib) return;

      const positions = sampleFrame(round.frames, time);
      const scale = size / RADAR_SIZE;
      const seen = new Set<number>();

      for (const p of positions) {
        seen.add(p.id);
        const { x, y } = worldToRadar(p.x, p.y, calib);
        const px = x * scale;
        const py = y * scale;

        let s = spritesRef.current.get(p.id);
        if (!s) {
          const color = p.team === 3 ? 0x5ab0ff : 0xf5b042;
          const container = new Container();
          const arrow = new Graphics()
            .moveTo(0, -4)
            .lineTo(14, 0)
            .lineTo(0, 4)
            .lineTo(0, -4)
            .fill({ color, alpha: 0.95 });
          const dot = new Graphics()
            .circle(0, 0, 8)
            .fill(color)
            .stroke({ color: 0x0a0a0a, width: 1.5 });
          const playerInfo = match.players.find((pl) => pl.steamId === p.id);
          const label = new Text({
            text: playerInfo?.name ?? "",
            style: {
              fontFamily: "ui-sans-serif, system-ui",
              fontSize: 11,
              fontWeight: "600",
              fill: 0xffffff,
              stroke: { color: 0x000000, width: 3 },
            },
          });
          label.anchor.set(0.5, 1);
          label.position.set(0, -13);
          container.addChild(arrow);
          container.addChild(dot);
          container.addChild(label);
          layer.addChild(container);
          s = { container, dot, arrow, label };
          spritesRef.current.set(p.id, s);
        }
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
      className="relative rounded-xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-black/50 bg-neutral-950"
    />
  );
}
