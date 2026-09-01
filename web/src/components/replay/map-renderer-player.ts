import { Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { iconPathFor } from "@/lib/icons";
import {
  REPLAY_ALPHA,
  REPLAY_COLORS,
  teamColor,
  teamDarkColor,
} from "./map-renderer-colors";
import type {
  Frame,
  PlayerId,
  PlayerPos,
  WeaponFireEvent,
} from "@/lib/types";
import type {
  HabitReplayPlayerSample,
  HabitReplayRound,
} from "@/lib/replay-store";

const BOMB_MARKER_COLOR = REPLAY_COLORS.danger;
const HP_RING_RADIUS = 11;
const SHOOT_ROTATION_OFFSET = 0;
const PLAYER_ARROW_TIP_OFFSET = 9;

const PLAYER_DESTROY_OPTIONS = { children: true, context: true, style: true } as const;

export type PlayerSprite = {
  container: Container;
  dot: Graphics;
  hpRing: Graphics;
  deadMark: Graphics;
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

export function fitSprite(sprite: Sprite, max: number): void {
  const texture = sprite.texture;
  if (!texture || !texture.width || !texture.height) {
    sprite.width = max;
    sprite.height = max;
    return;
  }
  const ratio = texture.width / texture.height;
  if (ratio >= 1) {
    sprite.width = max;
    sprite.height = max / ratio;
  } else {
    sprite.height = max;
    sprite.width = max * ratio;
  }
}

export function fitSpriteBox(sprite: Sprite, maxWidth: number, maxHeight: number): void {
  const texture = sprite.texture;
  if (!texture || !texture.width || !texture.height) {
    sprite.width = maxWidth;
    sprite.height = maxHeight;
    return;
  }
  const ratio = texture.width / texture.height;
  if (ratio >= maxWidth / maxHeight) {
    sprite.width = maxWidth;
    sprite.height = maxWidth / ratio;
  } else {
    sprite.height = maxHeight;
    sprite.width = maxHeight * ratio;
  }
}

export function heldWeaponBox(name?: string): { width: number; height: number } {
  const normalized = name?.toLowerCase() ?? "";
  if (/c4|bomb/.test(normalized)) return { width: 18, height: 18 };
  if (/grenade|flashbang|molotov|incendiary|decoy|c4|bomb/.test(normalized)) {
    return { width: 15, height: 15 };
  }
  if (/knife|bayonet|karambit/.test(normalized)) return { width: 24, height: 12 };
  if (/deagle|revolver|usp|glock|p2000|p250|five|tec|cz|elite|dual/.test(normalized)) {
    return { width: 23, height: 11 };
  }
  if (/awp|ssg|scout|scar|g3sg/.test(normalized)) return { width: 34, height: 10 };
  if (/nova|xm1014|sawed|mag-7|mag7|m249|negev/.test(normalized)) {
    return { width: 33, height: 11 };
  }
  return { width: 31, height: 10 };
}

export function isUtilityWeapon(name?: string): boolean {
  return /grenade|flashbang|molotov|incendiary|decoy|c4|bomb/.test(
    name?.toLowerCase() ?? "",
  );
}

export function isKnifeWeapon(name?: string): boolean {
  return /knife|bayonet|karambit/.test(name?.toLowerCase() ?? "");
}

export function isPistolWeapon(name?: string): boolean {
  return /deagle|revolver|usp|glock|p2000|p250|five|tec|cz|elite|dual/.test(
    name?.toLowerCase() ?? "",
  );
}

export { teamColor, teamDarkColor };

export function playerArrowRotation(yaw: number): number {
  return (-yaw * Math.PI) / 180;
}

export function drawDirectionalPlayerArrow(
  graphics: Graphics,
  color: number,
  alpha = 1,
): void {
  const markerRadius = 8;
  graphics
    .clear()
    .moveTo(markerRadius + 1, 0)
    .lineTo(-markerRadius + 1, -5.2)
    .lineTo(-markerRadius + 4, 0)
    .lineTo(-markerRadius + 1, 5.2)
    .lineTo(markerRadius + 1, 0)
    .fill({ color, alpha: 0.98 * alpha })
    .stroke({ color: 0xffffff, width: 1.7, alpha: 0.96 * alpha });
}

export function displayName(name?: string): string {
  return name === "L999" ? "grosNoob" : name ?? "";
}

function playerLabel(text: string, fill: number, halo = false): Text {
  const label = new Text({
    text,
    style: {
      fontFamily: "ui-sans-serif, system-ui",
      fontSize: 44,
      fontWeight: "600",
      fill,
      ...(halo
        ? { stroke: { color: REPLAY_COLORS.ink, width: 5, join: "round" as const } }
        : {}),
    },
    resolution: Math.max(2, window.devicePixelRatio || 1),
  });
  label.anchor.set(0.5, 0.5);
  // 44 * 0.273 ≈ 12px on screen — the readability floor for the radar.
  label.scale.set(0.273);
  return label;
}

export function createPlayerSprite(layer: Container, name?: string): PlayerSprite {
  const container = new Container();
  const held = new Sprite();
  held.anchor.set(0.5, 1);
  held.position.set(0, -22);
  held.visible = false;

  const labelBadge = new Container();
  labelBadge.addChild(new Graphics());
  // `labelFill` is the dark outline drawn behind `labelEmpty`, which carries the
  // readable text. The halo keeps names legible over any radar artwork without
  // a badge rectangle competing with the marker.
  const labelFill = playerLabel(displayName(name), REPLAY_COLORS.ink, true);
  const labelEmpty = playerLabel(labelFill.text, REPLAY_COLORS.label);
  const labelFillMask = new Graphics();
  const labelEmptyMask = new Graphics();
  labelBadge.addChild(labelFillMask);
  labelBadge.addChild(labelEmptyMask);
  labelBadge.addChild(labelFill);
  labelBadge.addChild(labelEmpty);
  labelBadge.position.set(0, -22);

  const dot = new Graphics();
  const hpRing = new Graphics();
  const deadMark = new Graphics();
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
  container.addChild(hpRing);
  container.addChild(arrowRotator);
  container.addChild(deadMark);
  container.addChild(flashArc);
  layer.addChild(container);

  return {
    container,
    dot,
    hpRing,
    deadMark,
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
}

export function destroyPlayerSprite(layer: Container, sprite: PlayerSprite): void {
  layer.removeChild(sprite.container);
  if (!sprite.container.destroyed) sprite.container.destroy(PLAYER_DESTROY_OPTIONS);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(value: number): number {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 3);
}

function mixColor(from: number, to: number, amount: number): number {
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

export type UpdatePlayerSpriteOptions = {
  player: PlayerPos;
  sprite: PlayerSprite;
  x: number;
  y: number;
  time: number;
  carriesBomb: boolean;
  recentFire?: WeaponFireEvent;
  loadTexture: (path: string) => Promise<Texture>;
};

export function updatePlayerSprite({
  player,
  sprite,
  x,
  y,
  time,
  carriesBomb,
  recentFire,
  loadTexture,
}: UpdatePlayerSpriteOptions): void {
  const baseColor = teamColor(player.team);
  const alive = player.hp > 0;
  const hpPct = clamp01(player.hp / 100);
  const markerRadius = 8;

  sprite.dot.clear();
  drawDirectionalPlayerArrow(sprite.arrow, baseColor);
  // The cross replaces the arrow on death, rather than stacking on top of it.
  sprite.arrowRotator.visible = alive;

  sprite.muzzleFlash.clear();
  if (alive && recentFire && !isUtilityWeapon(recentFire.weapon)) {
    const shotAge = Math.max(0, time - recentFire.t);
    const shotDuration = isKnifeWeapon(recentFire.weapon) ? 0.26 : 0.12;
    const shotPulse = Math.sin(Math.PI * clamp01(shotAge / shotDuration));
    sprite.arrowRotator.scale.set(
      1 + shotPulse * (isKnifeWeapon(recentFire.weapon) ? 0.03 : 0.018),
    );
  } else {
    sprite.arrowRotator.scale.set(1);
  }

  // Health rides its own ring so the name stays a name at every HP value, and
  // the bomb gets a dashed ring instead of overwriting the player's team colour.
  sprite.hpRing.clear();
  if (alive) {
    sprite.hpRing
      .circle(0, 0, HP_RING_RADIUS)
      .stroke({ color: REPLAY_COLORS.ink, width: 2.6, alpha: REPLAY_ALPHA.outline })
      .circle(0, 0, HP_RING_RADIUS)
      .stroke({ color: baseColor, width: 1.6, alpha: REPLAY_ALPHA.ringTrack });
    if (hpPct > 0) {
      sprite.hpRing
        .arc(0, 0, HP_RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpPct)
        .stroke({ color: baseColor, width: 1.6, alpha: REPLAY_ALPHA.ring, cap: "round" });
    }
  }
  if (carriesBomb) {
    sprite.hpRing
      .circle(0, 0, HP_RING_RADIUS + 4)
      .stroke({
        color: BOMB_MARKER_COLOR,
        width: 1.4,
        alpha: alive ? 0.55 : REPLAY_ALPHA.faint,
      });
  }

  // A dead player reads as a different shape, not merely a fainter one.
  sprite.deadMark.clear();
  if (!alive) {
    sprite.deadMark
      .moveTo(-7, -7).lineTo(7, 7)
      .moveTo(7, -7).lineTo(-7, 7)
      .stroke({
        color: baseColor,
        width: 2.4,
        alpha: REPLAY_ALPHA.dead,
        cap: "round",
      });
  }

  const badgeBg = sprite.labelBadge.getChildAt(0) as Graphics;
  badgeBg.clear();
  sprite.labelFill.position.set(0, 0);
  sprite.labelEmpty.position.set(0, 0);
  sprite.labelFill.alpha = alive ? REPLAY_ALPHA.full : REPLAY_ALPHA.dead;
  sprite.labelEmpty.alpha = alive ? REPLAY_ALPHA.full : REPLAY_ALPHA.dead;
  sprite.labelEmpty.style.fill = alive
    ? REPLAY_COLORS.label
    : REPLAY_COLORS.labelDim;

  sprite.labelFillMask.clear();
  sprite.labelEmptyMask.clear();

  sprite.flashArc.clear();
  if (
    alive &&
    player.flashLeft &&
    player.flashLeft > 0 &&
    player.flashTotal &&
    player.flashTotal > 0
  ) {
    const fracRemaining = clamp01(player.flashLeft / player.flashTotal);
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * fracRemaining;
    sprite.flashArc.moveTo(
      Math.cos(startAngle) * (markerRadius + 4),
      Math.sin(startAngle) * (markerRadius + 4),
    );
    sprite.flashArc.arc(0, 0, markerRadius + 4, startAngle, endAngle);
    sprite.flashArc.stroke({ color: 0xfffbeb, width: 1.8, alpha: 0.95 });
  }

  const heldPath = alive ? iconPathFor(player.active) : null;
  const heldBox = heldWeaponBox(player.active);
  if (heldPath !== sprite.heldPath) {
    sprite.heldPath = heldPath;
    if (!heldPath) {
      sprite.held.visible = false;
    } else {
      const heldSprite = sprite.held;
      void loadTexture(heldPath)
        .then((texture) => {
          if (heldSprite.destroyed || sprite.heldPath !== heldPath) return;
          heldSprite.texture = texture;
          fitSpriteBox(heldSprite, heldBox.width, heldBox.height);
          heldSprite.visible = true;
        })
        .catch(() => {});
    }
  } else if (heldPath) {
    fitSpriteBox(sprite.held, heldBox.width, heldBox.height);
  }
  sprite.held.tint = 0xffffff;
  sprite.held.alpha = alive ? 0.46 : 0.16;

  const arrowRotation = playerArrowRotation(player.yaw);
  const activeAction = alive ? player.activeAction : undefined;
  const actionPath = activeAction
    ? iconPathFor(activeAction.type === "plant" ? "c4" : activeAction.item)
    : null;
  const hideHeldForAction = Boolean(activeAction && actionPath && heldPath === actionPath);
  if (actionPath !== sprite.actionPath) {
    sprite.actionPath = actionPath;
    if (!actionPath) {
      sprite.actionGroup.visible = false;
    } else {
      const actionSprite = sprite.action;
      const fillSprite = sprite.actionFill;
      void loadTexture(actionPath)
        .then((texture) => {
          if (actionSprite.destroyed || sprite.actionPath !== actionPath) return;
          actionSprite.texture = texture;
          fillSprite.texture = texture;
          fitSprite(actionSprite, activeAction?.type === "plant" ? 14 : 13);
          fillSprite.scale.copyFrom(actionSprite.scale);
          actionSprite.visible = true;
          fillSprite.visible = activeAction?.type === "plant";
        })
        .catch(() => {});
    }
  } else if (actionPath) {
    fitSprite(sprite.action, activeAction?.type === "plant" ? 14 : 13);
    sprite.actionFill.scale.copyFrom(sprite.action.scale);
  }

  if (activeAction && actionPath) {
    const heldCenterX = sprite.held.position.x;
    const heldCenterY = sprite.held.position.y - heldBox.height / 2;
    const inverseCos = Math.cos(-arrowRotation);
    const inverseSin = Math.sin(-arrowRotation);
    const startX = heldCenterX * inverseCos - heldCenterY * inverseSin;
    const startY = heldCenterX * inverseSin + heldCenterY * inverseCos;
    if (activeAction.type === "utility") {
      const slide = easeOutCubic(activeAction.elapsed / 0.22);
      const targetX = 4;
      const targetY = 10;
      const wobble = Math.sin(time * 18) * 2.2 * slide;
      sprite.actionGroup.position.set(
        startX + (targetX - startX) * slide,
        startY + (targetY - startY) * slide + wobble,
      );
      sprite.actionGroup.rotation = Math.PI / 2 + Math.sin(time * 20) * 0.16 * slide;
      sprite.action.alpha = 0.78 + slide * 0.18;
      sprite.action.tint = mixColor(0xd8dde5, teamColor(player.team), slide * 0.7);
      sprite.actionFill.visible = false;
      sprite.actionFillMask.clear();
    } else {
      const progress = clamp01(activeAction.elapsed / (activeAction.duration ?? 3.2));
      const slide = easeOutCubic(activeAction.elapsed / 0.22);
      const targetX = 4;
      const targetY = 10;
      sprite.actionGroup.position.set(
        startX + (targetX - startX) * slide,
        startY + (targetY - startY) * slide,
      );
      sprite.actionGroup.rotation = Math.PI / 2;
      sprite.action.alpha = 0.9;
      sprite.action.tint = 0xd8dde5;
      sprite.actionFill.alpha = 0.9;
      sprite.actionFill.tint = 0xef4444;
      sprite.actionFill.visible = true;
      const fillHeight = 14 * progress;
      sprite.actionFillMask.clear();
      sprite.actionFillMask.rect(-7, 7 - fillHeight, 14, fillHeight)
        .fill({ color: 0xffffff, alpha: 1 });
    }
    sprite.actionGroup.visible = true;
    sprite.action.visible = true;
  } else {
    sprite.actionGroup.visible = false;
    sprite.actionGroup.rotation = 0;
    sprite.actionFill.visible = false;
    sprite.actionFillMask.clear();
  }
  if (heldPath) sprite.held.visible = alive && !hideHeldForAction;
  sprite.container.position.set(x, y);
  sprite.arrowRotator.rotation = arrowRotation;
  sprite.container.alpha = alive ? 1 : 0.18;
}

export function drawPlayerIdentityMarker(
  layer: Container,
  x: number,
  y: number,
  yaw: number,
  team: number | undefined,
  labelText: string,
  alpha: number,
): Container {
  const container = new Container();
  container.position.set(x, y);
  container.alpha = alpha;
  const arrowRotator = new Container();
  arrowRotator.rotation = playerArrowRotation(yaw);
  const arrow = new Graphics();
  drawDirectionalPlayerArrow(arrow, teamColor(team));
  arrowRotator.addChild(arrow);
  container.addChild(arrowRotator);

  const label = playerLabel(labelText, 0x121212);
  label.position.set(0, -13);
  const badge = new Graphics();
  const width = Math.max(18, label.width + 8);
  badge.roundRect(-width / 2, -18.25, width, 9.5, 3)
    .fill({ color: teamColor(team), alpha: 0.95 })
    .stroke({ color: 0x000000, width: 1, alpha: 0.55 });
  container.addChild(badge);
  container.addChild(label);
  layer.addChild(container);
  return container;
}

export function drawDeathMarker(
  layer: Container,
  x: number,
  y: number,
  yaw = 0,
  team?: number,
  name = "",
): Container {
  return drawPlayerIdentityMarker(layer, x, y, yaw, team, displayName(name), 0.18);
}

export function framePair<T extends { t: number }>(
  frames: T[],
  time: number,
): { a: T; b: T; alpha: number } | null {
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

export function sampleFrame(frames: Frame[], time: number): PlayerPos[] {
  const pair = framePair(frames, time);
  if (!pair) return [];
  if (pair.a === pair.b) return pair.a.players;
  const { a, b, alpha } = pair;
  const playersById = new Map<PlayerId, PlayerPos>();
  for (const player of a.players) playersById.set(player.id, player);
  const sampled: PlayerPos[] = [];
  for (const next of b.players) {
    const previous = playersById.get(next.id);
    if (!previous) {
      sampled.push(next);
      continue;
    }
    let yawDelta = next.yaw - previous.yaw;
    while (yawDelta > 180) yawDelta -= 360;
    while (yawDelta < -180) yawDelta += 360;
    const flashBefore = previous.flashLeft ?? 0;
    const flashAfter = next.flashLeft ?? 0;
    const flashLeft =
      flashBefore > 0 && flashAfter > 0
        ? flashBefore + (flashAfter - flashBefore) * alpha
        : flashBefore > 0
          ? Math.max(0, flashBefore - (b.t - a.t) * alpha)
          : flashAfter;
    const actionBefore = previous.activeAction;
    const actionAfter = next.activeAction;
    const activeAction =
      actionBefore &&
      actionAfter &&
      actionBefore.type === actionAfter.type &&
      actionBefore.item === actionAfter.item
        ? {
            ...actionAfter,
            elapsed:
              actionBefore.elapsed +
              (actionAfter.elapsed - actionBefore.elapsed) * alpha,
          }
        : actionAfter;
    sampled.push({
      ...next,
      x: previous.x + (next.x - previous.x) * alpha,
      y: previous.y + (next.y - previous.y) * alpha,
      yaw: previous.yaw + yawDelta * alpha,
      flashLeft,
      activeAction,
    });
  }
  return sampled;
}

export function playerPositionAtOrBefore(
  frames: Frame[],
  playerId: PlayerId,
  time: number,
): PlayerPos | null {
  if (!frames.length) return null;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle].t <= time) low = middle;
    else high = middle - 1;
  }
  for (let index = low; index >= 0; index--) {
    const player = frames[index].players.find(
      (candidate) => candidate.id === playerId,
    );
    if (player) return player;
  }
  return null;
}

export function nearestFrame(frames: Frame[], time: number): Frame | null {
  const pair = framePair(frames, time);
  if (!pair) return null;
  if (pair.a === pair.b) return pair.a;
  return Math.abs(pair.a.t - time) <= Math.abs(pair.b.t - time)
    ? pair.a
    : pair.b;
}

export function sampleHabitPosition(
  samples: HabitReplayPlayerSample[],
  time: number,
): HabitReplayPlayerSample | null {
  const pair = framePair(samples, time);
  if (!pair) return null;
  const { a, b, alpha } = pair;
  let yawDelta = b.yaw - a.yaw;
  while (yawDelta > 180) yawDelta -= 360;
  while (yawDelta < -180) yawDelta += 360;
  return {
    ...b,
    t: time,
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    z: a.z + (b.z - a.z) * alpha,
    yaw: a.yaw + yawDelta * alpha,
    hp: a.hp + (b.hp - a.hp) * alpha,
    team: b.team,
  };
}

export function habitRadarLayerPositions(
  replays: HabitReplayRound[],
  time: number,
): Array<{ z: number }> {
  const positions: Array<{ z: number }> = [];
  for (const replay of replays) {
    if (replay.death && time >= replay.death.t) {
      positions.push({ z: replay.death.z });
      continue;
    }
    const position = sampleHabitPosition(replay.positions, time);
    if (position && position.hp > 0) positions.push(position);
  }
  return positions;
}

export function habitTimedPoints<
  T extends { t: number; x: number; y: number; z: number },
>(
  samples: T[],
  start: number,
  end: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  groundZ?: number,
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
    const z =
      groundZ === undefined ? sample.z : Math.max(0, sample.z - groundZ);
    const point = toRadar(sample.x, sample.y, z);
    const last = points[points.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 2.5) {
      points.push(point);
    }
  }
  return points;
}

export function drawHabitGhostLabel(
  layer: Container,
  text: string,
  x: number,
  y: number,
  color: number,
): void {
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
  const background = new Graphics();
  const width = Math.max(17, label.width + 5);
  background
    .roundRect(x - width / 2, y - 20, width, 10, 3)
    .fill({ color, alpha: 0.34 });
  layer.addChild(background);
  layer.addChild(label);
}

export function drawHabitGhostPlayer(
  layer: Container,
  replay: HabitReplayRound,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
): void {
  const position = sampleHabitPosition(replay.positions, time);
  const died = Boolean(replay.death && time >= replay.death.t);
  if (died && replay.death) {
    const point = toRadar(replay.death.x, replay.death.y, replay.death.z);
    const lastPose =
      sampleHabitPosition(replay.positions, replay.death.t) ?? position;
    drawPlayerIdentityMarker(
      layer,
      point.x,
      point.y,
      lastPose?.yaw ?? 0,
      lastPose?.team,
      `R${replay.roundNumber} · ${displayName(replay.playerName)}`,
      0.18,
    );
    return;
  }
  if (!position || position.hp <= 0) return;

  const color = teamColor(position.team);
  const recentPath = habitTimedPoints(
    replay.positions,
    Math.max(0, time - 4),
    time,
    toRadar,
  );
  const path = new Graphics();
  if (recentPath.length >= 2) {
    path.moveTo(recentPath[0].x, recentPath[0].y);
    for (const point of recentPath.slice(1)) path.lineTo(point.x, point.y);
    path.stroke({ color, width: 1.6, alpha: 0.2 });
  }
  const point = toRadar(position.x, position.y, position.z);
  path
    .circle(point.x, point.y, 8)
    .stroke({ color, width: 1.4, alpha: 0.28 });
  layer.addChild(path);
  drawPlayerIdentityMarker(
    layer,
    point.x,
    point.y,
    position.yaw,
    position.team,
    `R${replay.roundNumber} · ${displayName(replay.playerName)}`,
    0.48,
  );
}

export type HabitGhostVisual = {
  path: Graphics;
  marker: Container;
  arrowRotator: Container;
};

export function createHabitGhostVisual(): HabitGhostVisual {
  const path = new Graphics();
  const marker = new Container();
  const arrowRotator = new Container();
  const arrow = new Graphics();
  arrowRotator.addChild(arrow);
  marker.addChild(arrowRotator);
  return { path, marker, arrowRotator };
}

export function updateHabitGhostVisual(
  visual: HabitGhostVisual,
  replay: HabitReplayRound,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  trailSeconds = 4,
): void {
  const position = sampleHabitPosition(replay.positions, time);
  const died = Boolean(replay.death && time >= replay.death.t);
  const pose =
    died && replay.death
      ? sampleHabitPosition(replay.positions, replay.death.t) ?? position
      : position;
  if (!pose || (!died && pose.hp <= 0)) {
    visual.path.visible = false;
    visual.marker.visible = false;
    return;
  }

  const world = died && replay.death ? replay.death : pose;
  const point = toRadar(world.x, world.y, world.z);
  const color = teamColor(pose.team);
  visual.path.visible = !died;
  visual.path.clear();
  if (!died) {
    const recentPath = habitTimedPoints(
      replay.positions,
      Math.max(0, time - trailSeconds),
      time,
      toRadar,
    );
    const tail = recentPath[recentPath.length - 1];
    if (!tail || Math.hypot(point.x - tail.x, point.y - tail.y) > 0.25) {
      recentPath.push(point);
    }
    if (recentPath.length >= 2) {
      visual.path.moveTo(recentPath[0].x, recentPath[0].y);
      for (let index = 1; index < recentPath.length; index++) {
        visual.path.lineTo(recentPath[index].x, recentPath[index].y);
      }
      visual.path.stroke({ color, width: 1.4, alpha: 0.16 });
    }
    visual.path
      .circle(point.x, point.y, 8)
      .stroke({ color, width: 1.2, alpha: 0.22 });
  }
  visual.marker.visible = true;
  visual.marker.position.set(point.x, point.y);
  visual.marker.alpha = died ? 0.18 : 0.58;
  visual.arrowRotator.rotation = playerArrowRotation(pose.yaw);
  drawDirectionalPlayerArrow(
    visual.arrowRotator.getChildAt(0) as Graphics,
    color,
  );
}

export function drawWeaponFire(
  layer: Container,
  fire: WeaponFireEvent,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  shooterLive?: PlayerPos,
): Graphics | null {
  if (isUtilityWeapon(fire.weapon)) return null;
  const age = time - fire.t;
  const knife = isKnifeWeapon(fire.weapon);
  const duration = knife ? 0.26 : 0.12;
  if (age < 0 || age > duration) return null;
  const progress = clamp01(age / duration);
  const alpha = Math.pow(1 - progress, 1.35);
  const start = shooterLive
    ? toRadar(shooterLive.x, shooterLive.y, 0)
    : toRadar(fire.x, fire.y, 0);
  const yaw = shooterLive ? shooterLive.yaw : fire.yaw;
  const visual = new Graphics();
  visual.position.set(start.x, start.y);
  visual.rotation = (-yaw * Math.PI) / 180 + SHOOT_ROTATION_OFFSET;

  if (knife) {
    const eased = 1 - Math.pow(1 - progress, 3);
    const sweepStart = -1.02;
    const sweepHead = sweepStart + eased * 2.04;
    const sweepTail = Math.max(sweepStart, sweepHead - 0.84);
    const radius = 23;
    visual
      .moveTo(Math.cos(sweepTail) * radius, Math.sin(sweepTail) * radius)
      .arc(0, 0, radius, sweepTail, sweepHead)
      .stroke({ color: 0x93c5fd, width: 5.6, alpha: 0.24 * alpha });
    visual
      .moveTo(Math.cos(sweepTail) * radius, Math.sin(sweepTail) * radius)
      .arc(0, 0, radius, sweepTail, sweepHead)
      .stroke({ color: 0xf8fafc, width: 2.2, alpha: 0.96 * alpha });
    visual
      .circle(
        Math.cos(sweepHead) * radius,
        Math.sin(sweepHead) * radius,
        1.8,
      )
      .fill({ color: 0xffffff, alpha: 0.9 * alpha });
  } else {
    const pistol = isPistolWeapon(fire.weapon);
    const tip = PLAYER_ARROW_TIP_OFFSET + 1;
    const length = (pistol ? 12 : 16) + progress * 7;
    const flare = (pistol ? 3.4 : 4.4) * (1 - progress * 0.45);
    visual
      .moveTo(tip, 0)
      .lineTo(tip + length * 0.48, -flare)
      .lineTo(tip + length, 0)
      .lineTo(tip + length * 0.48, flare)
      .closePath()
      .fill({ color: 0xffc857, alpha: 0.7 * alpha });
    visual
      .moveTo(tip + 1, 0)
      .lineTo(tip + length + 7, 0)
      .stroke({ color: 0xffffff, width: 1.25, alpha: 0.9 * alpha });
    for (const sparkAngle of [-0.38, 0.38]) {
      const sparkStart = tip + length * 0.52;
      const sparkLength = (pistol ? 5 : 7) * (1 - progress * 0.35);
      visual
        .moveTo(sparkStart, 0)
        .lineTo(
          sparkStart + Math.cos(sparkAngle) * sparkLength,
          Math.sin(sparkAngle) * sparkLength,
        )
        .stroke({
          color: 0xffe8a3,
          width: 0.9,
          alpha: 0.72 * alpha,
        });
    }
    visual
      .circle(tip + 1.5, 0, 1.6)
      .fill({ color: 0xffffff, alpha: 0.92 * alpha });
  }
  layer.addChild(visual);
  return visual;
}
