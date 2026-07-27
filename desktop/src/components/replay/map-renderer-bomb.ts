import type {
  BombState,
  Frame,
  MatchEvent,
  PlayerId,
  PlayerPos,
  Round,
} from "@/lib/types";
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { drawCountdownLabel } from "./map-renderer-effect";
import { fitSprite } from "./map-renderer-player";

const BOMB_SECONDS = 40;
const bombFrameFallbackCache = new WeakMap<Round, Frame[]>();

export function isBombWeapon(name?: string): boolean {
  return /c4|bomb/i.test(name ?? "");
}

export function playerCarriesBomb(player: PlayerPos): boolean {
  return (
    Boolean(player.hasBomb) ||
    isBombWeapon(player.active) ||
    Boolean(player.weapons?.some(isBombWeapon))
  );
}

export function roundFramesWithBombFallback(round: Round): Frame[] {
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

export function sampleBombState(
  frames: Frame[],
  time: number,
): BombState | undefined {
  if (!frames.length) return undefined;
  if (time <= frames[0].t) return frames[0].bomb;
  if (time >= frames[frames.length - 1].t) {
    return frames[frames.length - 1].bomb;
  }
  let low = 0;
  let high = frames.length - 1;
  while (low < high - 1) {
    const middle = (low + high) >> 1;
    if (frames[middle].t <= time) low = middle;
    else high = middle;
  }
  const before = frames[low];
  const after = frames[high];
  const firstBomb = before.bomb;
  const secondBomb = after.bomb;
  if (!secondBomb) return firstBomb;
  if (
    !firstBomb ||
    firstBomb.status !== secondBomb.status ||
    firstBomb.carrier !== secondBomb.carrier
  ) {
    return secondBomb;
  }
  const alpha = (time - before.t) / (after.t - before.t || 1);
  return {
    ...secondBomb,
    x: firstBomb.x + (secondBomb.x - firstBomb.x) * alpha,
    y: firstBomb.y + (secondBomb.y - firstBomb.y) * alpha,
    z: firstBomb.z + (secondBomb.z - firstBomb.z) * alpha,
  };
}

export function activeDefuse(
  events: MatchEvent[],
  positions: PlayerPos[],
  bomb: BombState,
  time: number,
): { start: number; duration: number; player?: PlayerId } | null {
  let active: { start: number; duration: number; player?: PlayerId } | null = null;
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
  if (active.player) {
    const defuser = positions.find((player) => player.id === active!.player);
    if (!defuser || defuser.hp <= 0 || defuser.use !== true) return null;
  } else {
    const defusing = positions.some((player) => {
      if (player.hp <= 0 || player.team !== 3 || player.use !== true) return false;
      const dx = player.x - bomb.x;
      const dy = player.y - bomb.y;
      const dz = player.z - bomb.z;
      return dx * dx + dy * dy + dz * dz <= 140 * 140;
    });
    if (!defusing) return null;
  }
  return active;
}

export function recentlyDefusedBomb(
  round: Round,
  frames: Frame[],
  time: number,
): BombState | null {
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
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index];
    if (frame.t > defusedAt) continue;
    if (frame.bomb?.status === "planted") return frame.bomb;
  }
  return null;
}

export function activeBombPlantTime(round: Round, time: number): number | null {
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

export function plantedBombAt(frames: Frame[], time: number): BombState | null {
  for (let index = frames.length - 1; index >= 0; index--) {
    const frame = frames[index];
    if (frame.t > time) continue;
    if (frame.bomb?.status === "planted") return frame.bomb;
  }
  return null;
}

export function recentBombExplosion(
  round: Round,
  frames: Frame[],
  time: number,
): { bomb: BombState; age: number } | null {
  let explodedAt: number | null = null;
  for (const event of round.events) {
    if (event.t > time) break;
    if (event.type === "bomb_exploded") explodedAt = event.t;
  }
  if (explodedAt === null || time - explodedAt > 1.15) return null;
  const bomb = plantedBombAt(frames, explodedAt);
  return bomb ? { bomb, age: time - explodedAt } : null;
}

export function bombPulseProgress(plantedAt: number, time: number): number {
  const normalized = Math.max(0, Math.min(1, (time - plantedAt) / BOMB_SECONDS));
  const elapsed = normalized * BOMB_SECONDS;
  const startHz = 1;
  const endHz = 5;
  const cycles = startHz * elapsed +
    ((endHz - startHz) * elapsed * elapsed) / (2 * BOMB_SECONDS);
  return cycles % 1;
}

export type BombSprite = {
  container: Container;
  marker: Graphics;
  icon: Sprite;
};

export type DefuseVisualState = {
  key: string;
  start: number;
  lastTime: number;
};

export type BombRenderState = {
  sprite: BombSprite | null;
  defuse: DefuseVisualState | null;
};

export type BombRadarPoint = {
  x: number;
  y: number;
};

type BombTextureLoader = (path: string) => Promise<Texture>;

export function createBombSprite(
  layer: Container,
  loadTexture: BombTextureLoader,
): BombSprite {
  const container = new Container();
  const marker = new Graphics();
  const icon = new Sprite();
  icon.anchor.set(0.5);
  container.addChild(marker);
  container.addChild(icon);
  layer.addChild(container);
  const sprite = { container, marker, icon };
  void loadTexture("/icons/c4.svg")
    .then((texture) => {
      if (container.destroyed) return;
      icon.texture = texture;
      fitSprite(icon, 18);
    })
    .catch(() => {
      if (!container.destroyed) icon.visible = false;
    });
  return sprite;
}

export function drawBombExplosion(
  layer: Container,
  explosion: { bomb: BombState; age: number },
  toRadar: (x: number, y: number, z?: number) => BombRadarPoint,
): Graphics {
  const point = toRadar(
    explosion.bomb.x,
    explosion.bomb.y,
    explosion.bomb.z,
  );
  const life = Math.max(0, Math.min(1, explosion.age / 1.15));
  const flash = 1 - life;
  const visual = new Graphics();
  visual
    .circle(point.x, point.y, 12 + life * 46)
    .fill({ color: 0xff6b35, alpha: 0.18 * flash });
  visual
    .circle(point.x, point.y, 8 + life * 24)
    .stroke({ color: 0xffd166, width: 3.4, alpha: 0.9 * flash });
  visual
    .circle(point.x, point.y, 18 + life * 42)
    .stroke({ color: 0xef4444, width: 2.2, alpha: 0.65 * flash });
  for (let index = 0; index < 7; index++) {
    const angle = index * ((Math.PI * 2) / 7) + life * 0.45;
    const inner = 10 + life * 16;
    const outer = 18 + life * 48;
    visual.moveTo(
      point.x + Math.cos(angle) * inner,
      point.y + Math.sin(angle) * inner,
    );
    visual.lineTo(
      point.x + Math.cos(angle) * outer,
      point.y + Math.sin(angle) * outer,
    );
  }
  visual.stroke({ color: 0xffb703, width: 1.4, alpha: 0.75 * flash });
  layer.addChild(visual);
  return visual;
}

export type UpdateBombRenderOptions = {
  bombLayer: Container;
  utilityLayer: Container;
  state: BombRenderState;
  displayBomb: BombState | null | undefined;
  defusedBomb: BombState | null;
  explosion: { bomb: BombState; age: number } | null;
  plantedAt: number | null;
  time: number;
  currentRoundIndex: number;
  events: MatchEvent[];
  positions: PlayerPos[];
  toRadar: (x: number, y: number, z?: number) => BombRadarPoint;
  loadTexture: BombTextureLoader;
};

export function updateBombRender({
  bombLayer,
  utilityLayer,
  state,
  displayBomb,
  defusedBomb,
  explosion,
  plantedAt,
  time,
  currentRoundIndex,
  events,
  positions,
  toRadar,
  loadTexture,
}: UpdateBombRenderOptions): BombRenderState {
  if (explosion) drawBombExplosion(utilityLayer, explosion, toRadar);

  if (!displayBomb || displayBomb.status === "carried") {
    if (state.sprite) state.sprite.container.visible = false;
    return { sprite: state.sprite, defuse: null };
  }

  const point = toRadar(displayBomb.x, displayBomb.y, displayBomb.z);
  const bombIsDefused = Boolean(defusedBomb);
  let defuseState = state.defuse;
  if (displayBomb.status === "planted" && !bombIsDefused) {
    const pulse =
      plantedAt === null ? time % 1 : bombPulseProgress(plantedAt, time);
    const ring = new Graphics()
      .circle(point.x, point.y, 19 * pulse)
      .stroke({ color: 0xef4444, width: 2, alpha: 0.75 * (1 - pulse) });
    utilityLayer.addChild(ring);

    const defuse = activeDefuse(events, positions, displayBomb, time);
    if (!defuse) {
      defuseState = null;
    } else {
      const key = `${currentRoundIndex}:${defuse.start}:${defuse.duration}:${defuse.player ?? "near"}`;
      if (
        !defuseState ||
        defuseState.key !== key ||
        time < defuseState.lastTime ||
        time - defuseState.lastTime > 0.35
      ) {
        defuseState = { key, start: time, lastTime: time };
      } else {
        defuseState.lastTime = time;
      }
      const progress = Math.max(
        0,
        Math.min(1, (time - defuseState.start) / defuse.duration),
      );
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + Math.PI * 2 * progress;
      const radius = 25;
      const arc = new Graphics();
      arc
        .circle(point.x, point.y, radius)
        .stroke({ color: 0x93c5fd, width: 1.2, alpha: 0.22 });
      arc.moveTo(
        point.x + Math.cos(startAngle) * radius,
        point.y + Math.sin(startAngle) * radius,
      );
      arc.arc(point.x, point.y, radius, startAngle, endAngle);
      arc.stroke({ color: 0x60a5fa, width: 2.6, alpha: 0.9 });
      arc
        .circle(
          point.x + Math.cos(endAngle) * radius,
          point.y + Math.sin(endAngle) * radius,
          2.4,
        )
        .fill({ color: 0xbfdbfe, alpha: 0.95 });
      drawCountdownLabel(
        arc,
        String(
          Math.max(
            0,
            Math.ceil(defuse.duration - (time - defuseState.start)),
          ),
        ),
        point.x,
        point.y + 31,
        0xbfdbfe,
      );
      utilityLayer.addChild(arc);
    }
  } else {
    defuseState = null;
  }

  let sprite = state.sprite;
  if (!sprite || sprite.container.destroyed) {
    sprite = createBombSprite(bombLayer, loadTexture);
  }
  const bombColor = bombIsDefused
    ? 0x22c55e
    : displayBomb.status === "planted"
      ? 0xef4444
      : 0xf59e0b;
  sprite.container.visible = true;
  sprite.container.position.set(point.x, point.y);
  sprite.marker.clear();
  sprite.icon.tint = bombColor;
  sprite.icon.visible = true;
  return { sprite, defuse: defuseState };
}
