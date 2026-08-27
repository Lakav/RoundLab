"use client";

import "pixi.js/unsafe-eval";
import { useEffect, useRef, useState } from "react";
import { Container, Graphics, Sprite } from "pixi.js";
import { type HabitOverlay, type HabitOverlayTrail, type HabitReplayEffect, type HabitReplayProjectile, type HabitReplayRound, useReplay } from "@/lib/replay-store";
import { MAP_CALIBRATION, RADAR_SIZE, radarImagePath, radarLayerForPositions, type RadarLayer, worldToRadar } from "@/lib/maps";
import type { MatchData, PlayerId, ProjectilePos, Round, UtilityEffect, WeaponFireEvent } from "@/lib/types";
import { iconPathFor } from "@/lib/icons";
import { layoutPlayerLabels } from "./map-renderer-labels";
import {
  activeBombPlantTime,
  activeDefuse,
  bombPulseProgress,
  isBombWeapon,
  plantedBombAt,
  playerCarriesBomb,
  recentBombExplosion,
  recentlyDefusedBomb,
  roundFramesWithBombFallback,
  sampleBombState,
  updateBombRender,
  type BombSprite,
  type DefuseVisualState,
} from "./map-renderer-bomb";
import {
  createHabitGhostVisual,
  createPlayerSprite,
  destroyPlayerSprite,
  displayName,
  drawHabitGhostLabel,
  drawHabitGhostPlayer,
  drawDeathMarker,
  drawDirectionalPlayerArrow,
  drawPlayerIdentityMarker,
  drawWeaponFire,
  fitSprite,
  fitSpriteBox,
  framePair,
  habitRadarLayerPositions,
  habitTimedPoints,
  heldWeaponBox,
  isKnifeWeapon,
  isPistolWeapon,
  isUtilityWeapon,
  nearestFrame,
  playerArrowRotation,
  playerPositionAtOrBefore,
  sampleFrame,
  sampleHabitPosition,
  teamColor,
  teamDarkColor,
  type HabitGhostVisual,
  type PlayerSprite,
  updateHabitGhostVisual,
  updatePlayerSprite,
  PLAYER_LABEL_OFFSET_Y,
  PLAYER_MARKER_RADIUS,
} from "./map-renderer-player";
import {
  PROJECTILE_EFFECT_HANDOFF_LOOKBACK,
  PROJECTILE_DEBUG_KEY,
  associateProjectileEffects,
  buildProjectileTracks,
  drawHabitProjectileVisual,
  drawProjectileVisual,
  drawSmoothTrail,
  effectHandoffProjectile,
  effectSuppressionRadius,
  fireClampDebugPayload,
  fireEffectDebugPayload,
  formatProjectileDebugNumber,
  habitProjectileGroundZ,
  habitTrailColor,
  isSameVisualProjectile,
  lastProjectileBeforeEffect,
  liveProjectileForEffect,
  projectileGroundZ,
  projectileHeightAboveGround,
  projectileHandoffIconAlpha,
  projectileHideStart,
  projectileHistory,
  projectileHistoryFromTrack,
  projectileSamples,
  projectileEffectHandoff,
  projectileEffectMatchDebug,
  projectileHiddenReasonDebug,
  projectileDebugEnabled,
  projectileDebugLog,
  projectileDebugLogForced,
  projectileDebugTick,
  projectilePositionSuspicion,
  projectileRenderIssueDebug,
  projectileSampleSourceDebug,
  projectileSeenNearEffect,
  projectileTrackWindowFromCache,
  projectileTouchesEffect,
  projectileTypeForEffect,
  projectileTypeToEffect,
  sampleProjectileTrack,
  sampleProjectileTracks,
  sampleProjectiles,
  sampleHabitProjectile,
  summarizeProjectileRound,
  visibleProjectiles,
  type ProjectileEffectAssociation,
  type ProjectileEffectHandoff,
  type ProjectileSample,
  type ProjectileTrack,
} from "./map-renderer-projectile";
import {
  FIRE_EFFECT_MAX_DURATION,
  circleOverlapArea,
  decoyLandingStart,
  decoyProjectileTracks,
  drawCountdownLabel,
  drawEffectVisual,
  drawFireMarker,
  drawHabitEffectVisual,
  drawTimerArc,
  fireIsSmoked,
  fireRadiusWorld,
  fireVariantFromProjectiles,
  resolveDecoyEffect,
  resolveEffects,
  resolveFireEffect,
  sampleProjectilesFixed,
} from "./map-renderer-effect";
import {
  MAX_DEFERRED_DESTROY_OBJECTS,
  destroyMapRendererPixi,
  destroyPixiChild,
  destroyQueuedDisplayObjects,
  drainDestroyQueue,
  initializeMapRendererPixi,
  queueLayerChildrenForDestroy,
  resizeMapRendererPixi,
  startAnimationFrameLoop,
  type DisposableDisplayObject,
  type MapRendererPixiScene,
} from "./map-renderer-pixi";
import {
  clamp01,
  easeOutCubic,
  heightLift,
  lastKnownTeams,
  mixColor,
} from "./map-renderer-math";
import {
  cachedIconTexture,
  loadIconTexture,
  preloadRoundIconTextures,
} from "./map-renderer-icons";

type RadarLayerMode = RadarLayer | "auto";

type RoundRenderCache = {
  projectileFrames: ProjectileSample[];
  projectileTracks: Map<number, ProjectileTrack>;
  resolvedEffects: UtilityEffect[];
  projectileEffectAssociations: Map<UtilityEffect, ProjectileEffectAssociation>;
  deathMarkers: Array<{ t: number; victim: PlayerId; x: number; y: number; z: number; yaw: number; team?: number }>;
  fixedProjectileSamples: Map<number, ProjectilePos[]>;
};

const roundRenderCache = new WeakMap<Round, RoundRenderCache>();

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

function drawHabitProjectile(
  layer: Container,
  projectile: HabitReplayProjectile,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  effects: HabitReplayEffect[] = [],
  trailWindowSeconds = Number.POSITIVE_INFINITY,
): void {
  drawHabitProjectileVisual(
    layer,
    projectile,
    time,
    toRadar,
    effects,
    trailWindowSeconds,
    drawUtilityIcon,
  );
}

function drawHabitEffect(
  layer: Container,
  effect: HabitReplayEffect,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number,
  contextualEffects: HabitReplayEffect[],
): void {
  drawHabitEffectVisual(
    layer,
    effect,
    time,
    toRadar,
    unitsToPx,
    contextualEffects,
    drawUtilityIcon,
  );
}

function drawHabitReplayOverlay(
  layer: Container,
  replays: HabitReplayRound[],
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number,
) {
  const utilityGhosts = new Container();
  utilityGhosts.alpha = 0.45;
  const playerGhosts = new Container();
  layer.addChild(utilityGhosts);
  layer.addChild(playerGhosts);
  for (const replay of replays) {
    for (const projectile of replay.projectiles) drawHabitProjectile(utilityGhosts, projectile, time, toRadar, replay.effects);
    for (const effect of replay.effects) drawHabitEffect(utilityGhosts, effect, time, toRadar, unitsToPx, replay.effects);
  }
  for (const replay of replays) drawHabitGhostPlayer(playerGhosts, replay, time, toRadar);
}

type HabitReplayScene = {
  overlay: HabitOverlay;
  root: Container;
  utilities: Container;
  projectiles: Container;
  effects: Container;
  players: Container;
  ghosts: Map<string, HabitGhostVisual>;
  lastEffectTime: number;
};

function renderHabitReplayScene(
  layer: Container,
  existing: HabitReplayScene | null,
  overlay: HabitOverlay,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number,
  destroyQueue: DisposableDisplayObject[],
): HabitReplayScene {
  let scene = existing;
  if (!scene || scene.overlay !== overlay || scene.root.destroyed) {
    destroyPixiChild(layer, scene?.root ?? null);
    const root = new Container();
    const utilities = new Container();
    utilities.alpha = 0.45;
    const projectiles = new Container();
    const effects = new Container();
    utilities.addChild(effects);
    utilities.addChild(projectiles);
    const players = new Container();
    root.addChild(utilities);
    root.addChild(players);
    layer.addChild(root);
    scene = {
      overlay,
      root,
      utilities,
      projectiles,
      effects,
      players,
      ghosts: new Map(),
      lastEffectTime: Number.NEGATIVE_INFINITY,
    };
    for (const replay of overlay.replays ?? []) {
      const ghost = createHabitGhostVisual();
      ghost.marker.zIndex = 1;
      players.addChild(ghost.path);
      players.addChild(ghost.marker);
      scene.ghosts.set(replay.id, ghost);
    }
  }

  const replays = overlay.replays ?? [];
  const dense = replays.length > 10;
  scene.utilities.alpha = dense ? 0.3 : 0.45;
  // Moving projectiles follow replay time at the same cadence as players.
  // Their short trail window keeps this cheap even with many rounds.
  queueLayerChildrenForDestroy(scene.projectiles, destroyQueue);
  for (const replay of replays) {
    for (const projectile of replay.projectiles) {
      drawHabitProjectile(
        scene.projectiles,
        projectile,
        time,
        toRadar,
        replay.effects,
        dense ? 1.5 : 3,
      );
    }
  }
  const effectInterval = 1 / 20;
  const effectTimeDelta = time - scene.lastEffectTime;
  const refreshEffects =
    !Number.isFinite(scene.lastEffectTime) ||
    effectTimeDelta < 0 ||
    effectTimeDelta >= effectInterval;
  if (refreshEffects) {
    scene.lastEffectTime = time;
    queueLayerChildrenForDestroy(scene.effects, destroyQueue);
    for (const replay of replays) {
      for (const effect of replay.effects) {
        drawHabitEffect(scene.effects, effect, time, toRadar, unitsToPx, replay.effects);
      }
    }
  }
  for (const replay of replays) {
    const ghost = scene.ghosts.get(replay.id);
    if (ghost) updateHabitGhostVisual(ghost, replay, time, toRadar, dense ? 2 : 4);
  }
  return scene;
}

function getRoundRenderCache(round: Round): RoundRenderCache {
  const cached = roundRenderCache.get(round);
  if (cached) return cached;
  const projectileFrames = projectileSamples(round);
  const resolvedEffects = resolveEffects(round.effects ?? [], projectileFrames);
  const cache = {
    projectileFrames,
    projectileTracks: buildProjectileTracks(projectileFrames),
    resolvedEffects,
    projectileEffectAssociations: associateProjectileEffects(
      projectileFrames,
      resolvedEffects.filter((effect) => effect.type !== "bomb_planted"),
    ),
    deathMarkers: (round.events ?? [])
      .filter((event) => event.type === "kill" && Boolean(event.victim))
      .flatMap((event) => {
        const victimPos = playerPositionAtOrBefore(round.frames, event.victim ?? 0, event.t);
        return victimPos
          ? [{
              t: event.t,
              victim: event.victim ?? 0,
              x: victimPos.x,
              y: victimPos.y,
              z: victimPos.z,
              yaw: victimPos.yaw,
              team: victimPos.team,
            }]
          : [];
      }),
    fixedProjectileSamples: new Map(),
  };
  roundRenderCache.set(round, cache);
  return cache;
}

function drawUtilityIcon(
  layer: Container,
  name: string,
  x: number,
  y: number,
  color: number,
  max = 16,
  alpha = 1,
) {
  const path = iconPathFor(name);
  if (!path) return;
  const sprite = new Sprite();
  sprite.anchor.set(0.5);
  sprite.position.set(x, y);
  sprite.tint = color;
  sprite.alpha = alpha;
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

function drawEffect(
  layer: Container,
  effect: UtilityEffect,
  time: number,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  unitsToPx: number,
  contextualEffects: UtilityEffect[] = [],
): void {
  drawEffectVisual(
    layer,
    effect,
    time,
    toRadar,
    unitsToPx,
    contextualEffects,
    drawUtilityIcon,
  );
}

function drawProjectile(
  layer: Container,
  projectile: ProjectilePos,
  projectileTrack: ProjectileTrack | undefined,
  time: number,
  throwerTeams: Map<PlayerId, number>,
  toRadar: (x: number, y: number, z?: number) => { x: number; y: number },
  handoff: ProjectileEffectHandoff | null = null,
): void {
  drawProjectileVisual(
    layer,
    projectile,
    projectileTrack,
    time,
    throwerTeams,
    toRadar,
    handoff,
    drawUtilityIcon,
  );
}

/**
 * Stateless replay calculations shared by the Pixi renderer and its unit tests.
 *
 * Keeping this surface explicit prevents the canvas lifecycle from hiding core
 * replay behaviour (interpolation, projectile/effect hand-off, bomb state and
 * cleanup) behind a browser-only integration test.
 */
export const mapRendererLogic = Object.freeze({
  MAX_DEFERRED_DESTROY_OBJECTS,
  sampleFrame,
  playerPositionAtOrBefore,
  nearestFrame,
  framePair,
  projectileSamples,
  sampleProjectiles,
  projectileHistory,
  drawSmoothTrail,
  habitTrailColor,
  drawHabitOverlayTrail,
  sampleHabitPosition,
  habitRadarLayerPositions,
  habitTimedPoints,
  sampleHabitProjectile,
  habitProjectileGroundZ,
  drawHabitGhostLabel,
  drawHabitGhostPlayer,
  drawHabitProjectile,
  drawHabitEffect,
  drawHabitReplayOverlay,
  renderHabitReplayScene,
  fireVariantFromProjectiles,
  circleOverlapArea,
  fireRadiusWorld,
  fireIsSmoked,
  lastKnownTeams,
  projectileTypeToEffect,
  effectSuppressionRadius,
  projectileHideStart,
  projectileHandoffIconAlpha,
  projectileTypeForEffect,
  projectileTouchesEffect,
  projectileSeenNearEffect,
  projectileEffectHandoff,
  liveProjectileForEffect,
  lastProjectileBeforeEffect,
  associateProjectileEffects,
  effectHandoffProjectile,
  decoyProjectileTracks,
  decoyLandingStart,
  resolveDecoyEffect,
  resolveFireEffect,
  resolveEffects,
  buildProjectileTracks,
  sampleProjectileTrack,
  sampleProjectileTracks,
  getRoundRenderCache,
  sampleProjectilesFixed,
  isSameVisualProjectile,
  visibleProjectiles,
  summarizeProjectileRound,
  projectileEffectMatchDebug,
  projectileHiddenReasonDebug,
  projectileRenderIssueDebug,
  fitSprite,
  fitSpriteBox,
  heldWeaponBox,
  isUtilityWeapon,
  isBombWeapon,
  playerCarriesBomb,
  roundFramesWithBombFallback,
  sampleBombState,
  isKnifeWeapon,
  isPistolWeapon,
  teamColor,
  playerArrowRotation,
  drawDirectionalPlayerArrow,
  drawPlayerIdentityMarker,
  createPlayerSprite,
  destroyPlayerSprite,
  updatePlayerSprite,
  teamDarkColor,
  clamp01,
  easeOutCubic,
  mixColor,
  activeDefuse,
  recentlyDefusedBomb,
  activeBombPlantTime,
  plantedBombAt,
  recentBombExplosion,
  bombPulseProgress,
  displayName,
  queueLayerChildrenForDestroy,
  drainDestroyQueue,
  destroyQueuedDisplayObjects,
  heightLift,
  projectileGroundZ,
  projectileHeightAboveGround,
  drawFireMarker,
  drawTimerArc,
  drawCountdownLabel,
  drawEffect,
  drawProjectile,
  drawWeaponFire,
  drawDeathMarker,
});

export function MapRenderer({
  size = 800,
  condensed = false,
  radarLayerMode = "auto",
  descriptionId,
}: {
  size?: number;
  condensed?: boolean;
  radarLayerMode?: RadarLayerMode;
  descriptionId?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef(size);
  const initialCondensedRef = useRef(condensed);
  const condensedRef = useRef(condensed);
  const [radarLayer, setRadarLayer] = useState<RadarLayer>("default");
  const radarLayerRef = useRef<RadarLayer>("default");
  const pixiSceneRef = useRef<MapRendererPixiScene | null>(null);
  const bgLayerRef = useRef<Container | null>(null);
  const habitLayerRef = useRef<Container | null>(null);
  const utilityLayerRef = useRef<Container | null>(null);
  const bombLayerRef = useRef<Container | null>(null);
  const playerLayerRef = useRef<Container | null>(null);
  const labelLayerRef = useRef<Container | null>(null);
  const deathLayerRef = useRef<Container | null>(null);
  const spritesRef = useRef<Map<PlayerId, PlayerSprite>>(new Map());
  const bombSpriteRef = useRef<BombSprite | null>(null);
  const deathMarkerSpritesRef = useRef<Map<string, Container>>(new Map());
  const deathMarkerRoundRef = useRef<Round | null>(null);
  const loadedMapRef = useRef<string | null>(null);
  const defuseVisualRef = useRef<DefuseVisualState | null>(null);
  const deferredDestroyRef = useRef<DisposableDisplayObject[]>([]);
  const habitReplaySceneRef = useRef<HabitReplayScene | null>(null);
  const condensedLayersClearedRef = useRef(false);
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

  const syncRadarLayer = (nextLayer: RadarLayer) => {
    if (radarLayerRef.current === nextLayer) return;
    radarLayerRef.current = nextLayer;
    setRadarLayer(nextLayer);
  };

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
    const deathMarkerSprites = deathMarkerSpritesRef.current;
    const deferredDestroyQueue = deferredDestroyRef.current;
    if (!host) return;

    void initializeMapRendererPixi(
      host,
      sizeRef.current,
      initialCondensedRef.current,
      () => disposed,
    ).then((scene) => {
      if (!scene) return;
      pixiSceneRef.current = scene;
      resizeMapRendererPixi(scene, sizeRef.current, condensedRef.current);
      bgLayerRef.current = scene.layers.background;
      habitLayerRef.current = scene.layers.habits;
      utilityLayerRef.current = scene.layers.utilities;
      bombLayerRef.current = scene.layers.bomb;
      playerLayerRef.current = scene.layers.players;
      labelLayerRef.current = scene.layers.labels;
      deathLayerRef.current = scene.layers.deaths;
    });

    return () => {
      disposed = true;
      destroyQueuedDisplayObjects(deferredDestroyQueue);
      destroyMapRendererPixi(pixiSceneRef.current);
      pixiSceneRef.current = null;
      sprites.clear();
      deathMarkerSprites.clear();
      deathMarkerRoundRef.current = null;
      bombSpriteRef.current = null;
      loadedMapRef.current = null;
      bgLayerRef.current = null;
      habitLayerRef.current = null;
      utilityLayerRef.current = null;
      bombLayerRef.current = null;
      playerLayerRef.current = null;
      deathLayerRef.current = null;
      habitReplaySceneRef.current = null;
      condensedLayersClearedRef.current = false;
    };
  }, []);

  useEffect(() => {
    sizeRef.current = size;
    condensedRef.current = condensed;
    const scene = pixiSceneRef.current;
    if (scene) resizeMapRendererPixi(scene, size, condensed);
  }, [condensed, size]);

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
      if (habitOverlay?.mode === "replay") return;
      queueLayerChildrenForDestroy(layer, deferredDestroyRef.current);
      drainDestroyQueue(deferredDestroyRef.current, 24, 2);
      if (!habitOverlay || !map) return;
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
        queueLayerChildrenForDestroy(
          bgLayerRef.current,
          deferredDestroyRef.current,
        );
        drainDestroyQueue(deferredDestroyRef.current, 24, 2);
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
    let last = performance.now();
    let lastRenderedMatch: MatchData | null = null;
    let lastRenderedRound = -1;
    let lastRenderedTime = Number.NaN;
    let lastRenderedOverlay: HabitOverlay | null = null;
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const state = useReplay.getState();
      state.step(dt);
      const { match, currentRoundIdx, time, playing } = useReplay.getState();
      const overlay = habitOverlayRef.current;
      const unchanged =
        match === lastRenderedMatch &&
        currentRoundIdx === lastRenderedRound &&
        time === lastRenderedTime &&
        overlay === lastRenderedOverlay;
      const layer = playerLayerRef.current;
      const labelLayer = labelLayerRef.current ?? undefined;
      const utilityLayer = utilityLayerRef.current;
      const bombLayer = bombLayerRef.current;
      const deathLayer = deathLayerRef.current;
      const habitLayer = habitLayerRef.current;
      if (!match || !layer || !utilityLayer || !bombLayer || !deathLayer) return;
      const round = match.rounds[currentRoundIdx];
      if (!round) return;
      const calib = MAP_CALIBRATION[match.meta.map];
      if (!calib) return;
      // The old loop rebuilt every Pixi layer at display refresh rate even
      // while replay time was paused. Keep polling cheaply for store changes,
      // but skip the expensive render work until something actually changes.
      // Do not cache before Pixi and the round are ready or a paused replay
      // could remain blank after asynchronous renderer initialization.
      if (!playing && unchanged) {
        // Playback can stop with detached objects still buffered. Continue
        // draining while paused so memory returns to its steady state.
        drainDestroyQueue(deferredDestroyRef.current, 96, 4);
        return;
      }
      lastRenderedMatch = match;
      lastRenderedRound = currentRoundIdx;
      lastRenderedTime = time;
      lastRenderedOverlay = overlay;

      const positions = condensed ? [] : sampleFrame(round.frames, time);
      const replayRadarPositions =
        condensed && overlay?.mode === "replay" && overlay.replays?.length
          ? habitRadarLayerPositions(overlay.replays, time)
          : positions;
      const radarPositions = replayRadarPositions;
      const autoRadarLayer = radarLayerForPositions(match.meta.map, radarPositions, "default");
      syncRadarLayer(radarLayerMode === "auto" ? autoRadarLayer : radarLayerMode);
      const scale = size / RADAR_SIZE;
      const toRadar = (x: number, y: number, z = 0) => {
        const p = worldToRadar(x, y, calib);
        return { x: p.x * scale, y: p.y * scale - heightLift(z) };
      };
      const unitsToPx = scale / calib.scale;
      if (condensed) {
        if (!condensedLayersClearedRef.current) {
          queueLayerChildrenForDestroy(utilityLayer, deferredDestroyRef.current);
          queueLayerChildrenForDestroy(bombLayer, deferredDestroyRef.current);
          queueLayerChildrenForDestroy(deathLayer, deferredDestroyRef.current);
          deathMarkerSpritesRef.current.clear();
          deathMarkerRoundRef.current = null;
          for (const [, sprite] of spritesRef.current) {
            destroyPlayerSprite(layer, sprite);
          }
          spritesRef.current.clear();
          bombSpriteRef.current = null;
          condensedLayersClearedRef.current = true;
        }
        if (habitLayer && overlay?.mode === "replay" && overlay.replays?.length) {
          habitReplaySceneRef.current = renderHabitReplayScene(
            habitLayer,
            habitReplaySceneRef.current,
            overlay,
            time,
            toRadar,
            unitsToPx,
            deferredDestroyRef.current,
          );
        }
        drainDestroyQueue(deferredDestroyRef.current, 48, 3);
        return;
      }
      condensedLayersClearedRef.current = false;
      if (habitReplaySceneRef.current) {
        const scene = habitReplaySceneRef.current;
        destroyPixiChild(habitLayer, scene.root);
        habitReplaySceneRef.current = null;
      }
      const bombFrames = roundFramesWithBombFallback(round);
      const smoothBomb = sampleBombState(bombFrames, time);
      const defusedBomb = recentlyDefusedBomb(round, bombFrames, time);
      const displayBomb = defusedBomb ?? smoothBomb;
      const plantedAt = activeBombPlantTime(round, time);
      const bombExplosion = recentBombExplosion(round, bombFrames, time);
      const throwerTeams = lastKnownTeams(round.frames, time);
      const seen = new Set<PlayerId>();
      const laidOut: Array<{ sprite: PlayerSprite; alive: boolean }> = [];
      const utilityChildrenBeforeCleanup = utilityLayer.children.length;
      queueLayerChildrenForDestroy(utilityLayer, deferredDestroyRef.current);
      if (deathMarkerRoundRef.current !== round) {
        queueLayerChildrenForDestroy(deathLayer, deferredDestroyRef.current);
        deathMarkerSpritesRef.current.clear();
        deathMarkerRoundRef.current = round;
      }
      drainDestroyQueue(deferredDestroyRef.current);

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
      const activeEffects = roundEffects.filter((e) => time >= e.start && time <= e.end);
      const currentHabitOverlay = habitOverlayRef.current;
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

      for (const sprite of deathMarkerSpritesRef.current.values()) sprite.visible = false;
      for (const [markerIndex, marker] of renderCache.deathMarkers.entries()) {
        if (marker.t > time) continue;
        const p = toRadar(marker.x, marker.y, marker.z);
        const markerKey = `${markerIndex}:${marker.t}:${marker.victim}`;
        let sprite = deathMarkerSpritesRef.current.get(markerKey);
        if (!sprite || sprite.destroyed) {
          const playerName = match.players.find((player) => player.steamId === marker.victim)?.name;
          sprite = drawDeathMarker(deathLayer, p.x, p.y, marker.yaw, marker.team, playerName);
          deathMarkerSpritesRef.current.set(markerKey, sprite);
        }
        sprite.position.set(p.x, p.y);
        sprite.visible = true;
      }

      const visibleFires: WeaponFireEvent[] = (round.weaponFires ?? []).filter(
        (fire) => fire.t <= time && time - fire.t <= 0.24
      );
      const liveById = new Map(positions.map((p) => [p.id, p]));
      const recentFireByShooter = new Map<PlayerId, WeaponFireEvent>();
      for (const fire of visibleFires) {
        const live = fire.shooter ? liveById.get(fire.shooter) : undefined;
        drawWeaponFire(utilityLayer, fire, time, toRadar, live);
        if (fire.shooter) recentFireByShooter.set(fire.shooter, fire);
      }

      const bombRenderState = updateBombRender({
        bombLayer,
        utilityLayer,
        state: {
          sprite: bombSpriteRef.current,
          defuse: defuseVisualRef.current,
        },
        displayBomb,
        defusedBomb,
        explosion: bombExplosion,
        plantedAt,
        time,
        currentRoundIndex: currentRoundIdx,
        events: round.events,
        positions,
        toRadar,
        loadTexture: loadIconTexture,
      });
      bombSpriteRef.current = bombRenderState.sprite;
      defuseVisualRef.current = bombRenderState.defuse;
      // Associate every nearby effect with exactly one projectile before the
      // handoff begins. Only that projectile may be moved to or hidden by the
      // effect; another grenade launched beside the explosion stays untouched.
      const detonatedIds = new Set<number>();
      const detonatedEffectsById = new Map<number, { effect: UtilityEffect; distance: number; rule: string }>();
      const projectileEffects = roundEffects
        .filter((e) => e.type !== "bomb_planted" && time >= e.start - PROJECTILE_EFFECT_HANDOFF_LOOKBACK)
        .slice()
        .sort((a, b) => a.start - b.start);
      const startedEffects = projectileEffects
        .filter((e) => time >= e.start)
        .slice();
      const associatedEffectsByProjectileId = new Map<number, UtilityEffect>();
      const effectProjectileIds = new Map<UtilityEffect, number>();
      for (const e of projectileEffects) {
        const association = renderCache.projectileEffectAssociations.get(e);
        if (!association) continue;
        associatedEffectsByProjectileId.set(association.projectileId, e);
        effectProjectileIds.set(e, association.projectileId);
        if (time >= projectileHideStart(e)) {
          detonatedIds.add(association.projectileId);
          detonatedEffectsById.set(association.projectileId, {
            effect: e,
            distance: association.distance,
            rule: "one-to-one projectile/effect association",
          });
        }
        if (time >= e.start && debugProjectiles) {
          const bestId = association.projectileId;
          const bestDist = association.distance;
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
              distance: formatProjectileDebugNumber(bestDist),
              rule: "one-to-one projectile/effect association",
            })}`);
          }
        }
      }

      const sampledProjectiles = debugProjectiles ? sampleProjectiles(projectileFrames, time) : [];
      const projectiles = visibleProjectiles(
        projectileFrames,
        time,
        projectileEffects,
        detonatedIds,
        renderCache.projectileTracks,
        effectProjectileIds,
      );
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
          (() => {
            const associatedEffect = associatedEffectsByProjectileId.get(projectile.id);
            return associatedEffect
              ? projectileEffectHandoff(projectile, [associatedEffect], projectileFrames, time)
              : null;
          })(),
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

      const renderedDeathIds = new Set(
        renderCache.deathMarkers.filter((marker) => marker.t <= time).map((marker) => marker.victim),
      );
      for (const p of positions) {
        if (p.hp <= 0 && renderedDeathIds.has(p.id)) continue;
        seen.add(p.id);
        const { x, y } = worldToRadar(p.x, p.y, calib);
        const px = x * scale;
        const py = y * scale;

        let s = spritesRef.current.get(p.id);
        if (!s) {
          const playerInfo = match.players.find((pl) => pl.steamId === p.id);
          s = createPlayerSprite(layer, playerInfo?.name, labelLayer);
          spritesRef.current.set(p.id, s);
        }
        const carriesBomb =
          Boolean(p.hasBomb) ||
          (smoothBomb?.status === "carried" && smoothBomb.carrier === p.id) ||
          isBombWeapon(p.active) ||
          Boolean(p.weapons?.some(isBombWeapon));
        updatePlayerSprite({
          player: p,
          sprite: s,
          x: px,
          y: py,
          time,
          carriesBomb,
          recentFire: recentFireByShooter.get(p.id),
          loadTexture: loadIconTexture,
        });
        laidOut.push({ sprite: s, alive: p.hp > 0 });
      }

      // Names are placed once every marker has moved, so players stacked on the
      // same spot get a slot each instead of an unreadable pile.
      const placements = layoutPlayerLabels(
        laidOut.map(({ sprite, alive }) => ({
          x: sprite.container.x,
          y: sprite.container.y,
          width: sprite.labelEmpty.width,
          height: sprite.labelEmpty.height,
          // A living player's name matters more than a dead one's, so the
          // living keep their default slot when the two compete.
          priority: alive ? 1 : 0,
        })),
        PLAYER_LABEL_OFFSET_Y,
        PLAYER_MARKER_RADIUS,
      );
      for (const [labelIndex, placement] of placements.entries()) {
        const { sprite } = laidOut[labelIndex];
        sprite.labelBadge.position.set(
          sprite.container.x + placement.dx,
          sprite.container.y + placement.dy,
        );
      }

      for (const [id, s] of spritesRef.current) {
        if (!seen.has(id)) {
          destroyPlayerSprite(layer, s);
          spritesRef.current.delete(id);
        }
      }

    };
    return startAnimationFrameLoop(loop);
  }, [condensed, radarLayerMode, size]);

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label="Interactive replay radar"
      aria-describedby={descriptionId}
      style={{ width: size, height: size }}
      className="relative overflow-visible bg-transparent"
    >
      {map && (
        // The radar is kept in the DOM instead of only in Pixi: it is more
        // reliable across browsers/headless renderers while Pixi handles motion.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={radarImagePath(map, radarLayer)}
          alt=""
          className="absolute inset-0 z-0 size-full select-none object-cover"
          style={{ mixBlendMode: "lighten" }}
          draggable={false}
        />
      )}
    </div>
  );
}
