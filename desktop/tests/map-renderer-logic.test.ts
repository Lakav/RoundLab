import { describe, expect, it, vi } from "vitest";
import { Container, Graphics, Sprite } from "pixi.js";
import { mapRendererLogic as logic } from "@/components/replay/MapRenderer";
import type { HabitOverlayTrail, HabitReplayProjectile, HabitReplayRound } from "@/lib/replay-store";
import type { Frame, PlayerPos, ProjectileFrame, ProjectilePos, Round, UtilityEffect } from "@/lib/types";

const player = (overrides: Partial<PlayerPos> = {}): PlayerPos => ({
  id: 1,
  x: 0,
  y: 0,
  z: 0,
  yaw: 170,
  hp: 100,
  armor: 100,
  team: 2,
  ...overrides,
});

const projectile = (overrides: Partial<ProjectilePos> = {}): ProjectilePos => ({
  id: 10,
  type: "smokegrenade",
  x: 0,
  y: 0,
  z: 0,
  thrower: 1,
  ...overrides,
});

const effect = (overrides: Partial<UtilityEffect> = {}): UtilityEffect => ({
  type: "smoke",
  start: 1,
  end: 19,
  x: 100,
  y: 0,
  z: 0,
  team: 2,
  ...overrides,
});

const round = (overrides: Partial<Round> = {}): Round => ({
  number: 1,
  startTick: 0,
  endTick: 640,
  duration: 10,
  winner: "T",
  frames: [],
  events: [],
  effects: [],
  projectileFrames: [],
  weaponFires: [],
  ...overrides,
});

describe("MapRenderer deterministic frame logic", () => {
  it("handles empty, boundary and interpolated player frames", () => {
    expect(logic.sampleFrame([], 1)).toEqual([]);
    const frames: Frame[] = [
      {
        t: 0,
        players: [
          player({ flashLeft: 2, flashTotal: 3, activeAction: { type: "plant", item: "c4", elapsed: 0 } }),
        ],
      },
      {
        t: 2,
        players: [
          player({ x: 20, y: 10, yaw: -170, flashLeft: 1, flashTotal: 3, activeAction: { type: "plant", item: "c4", elapsed: 2 } }),
          player({ id: 2, x: 8 }),
        ],
      },
    ];
    expect(logic.sampleFrame(frames, -1)).toBe(frames[0].players);
    expect(logic.sampleFrame(frames, 3)).toBe(frames[1].players);
    const sampled = logic.sampleFrame(frames, 1);
    expect(sampled[0]).toMatchObject({ x: 10, y: 5, yaw: 180, flashLeft: 1.5 });
    expect(sampled[0].activeAction?.elapsed).toBe(1);
    expect(sampled[1].id).toBe(2);

    const mismatched: Frame[] = [
      { t: 0, players: [player({ yaw: -170, flashLeft: 1, activeAction: { type: "utility", item: "flashbang", elapsed: 0 } })] },
      { t: 1, players: [player({ yaw: 170, flashLeft: 0, activeAction: { type: "plant", item: "c4", elapsed: 1 } })] },
    ];
    expect(logic.sampleFrame(mismatched, 0.5)[0]).toMatchObject({ yaw: -180, flashLeft: 0.5 });
    expect(logic.sampleFrame(mismatched, 0.5)[0].activeAction?.type).toBe("plant");
  });

  it("finds historical player positions and nearest frame boundaries", () => {
    const frames: Frame[] = [
      { t: 0, players: [] },
      { t: 1, players: [player({ x: 1 })] },
      { t: 3, players: [player({ x: 3 })] },
    ];
    expect(logic.playerPositionAtOrBefore([], 1, 2)).toBeNull();
    expect(logic.playerPositionAtOrBefore(frames, 1, 0)).toBeNull();
    expect(logic.playerPositionAtOrBefore(frames, 1, 2)?.x).toBe(1);
    expect(logic.playerPositionAtOrBefore(frames, 1, 9)?.x).toBe(3);
    expect(logic.nearestFrame([], 2)).toBeNull();
    expect(logic.nearestFrame(frames, -1)?.t).toBe(0);
    expect(logic.nearestFrame(frames, 9)?.t).toBe(3);
    expect(logic.nearestFrame(frames, 1.9)?.t).toBe(1);
    expect(logic.nearestFrame(frames, 2.2)?.t).toBe(3);
    expect(logic.framePair([], 0)).toBeNull();
    expect(logic.framePair(frames, -1)).toMatchObject({ alpha: 0 });
    expect(logic.framePair(frames, 9)).toMatchObject({ alpha: 0 });
    expect(logic.framePair(frames, 2)).toMatchObject({ alpha: 0.5 });
  });
});

describe("MapRenderer projectile sampling and tracks", () => {
  const samples: ProjectileFrame[] = [
    { t: 0, projectiles: [projectile(), projectile({ id: 20, type: "flashbang", x: 20 })] },
    { t: 1, projectiles: [projectile({ x: 100, y: 50, z: 25 }), projectile({ id: 30, type: "decoy", x: 30 })] },
    { t: 2, projectiles: [projectile({ x: 200, y: 100, z: 0 })] },
  ];

  it("chooses dedicated projectile frames and interpolates stable identities", () => {
    const withDedicated = round({ frames: [{ t: 0, players: [], projectiles: [] }], projectileFrames: samples });
    expect(logic.projectileSamples(withDedicated)).toBe(samples);
    const fallback = round({ frames: [{ t: 0, players: [], projectiles: [projectile()] }], projectileFrames: [] });
    expect(logic.projectileSamples(fallback)).toBe(fallback.frames);
    expect(logic.sampleProjectiles(samples, -1)).toEqual([]);
    expect(logic.sampleProjectiles([], 0)).toEqual([]);
    expect(logic.sampleProjectiles(samples, 0.5)).toEqual([
      expect.objectContaining({ id: 10, x: 50, y: 25, z: 12.5 }),
      expect.objectContaining({ id: 20 }),
    ]);
    const reusedId: ProjectileFrame[] = [
      { t: 0, projectiles: [projectile()] },
      { t: 1, projectiles: [projectile({ type: "flashbang", x: 2000 })] },
    ];
    expect(logic.sampleProjectiles(reusedId, 0.5)[0]).toMatchObject({ type: "smokegrenade", x: 0 });
  });

  it("builds histories, resets stale trails and caches fixed samples", () => {
    const toRadar = (x: number, y: number) => ({ x, y });
    expect(logic.projectileHistory(samples, projectile({ x: 100, y: 50 }), 1, toRadar)).toEqual([
      { x: 100, y: 50 },
    ]);
    const tight: ProjectileFrame[] = [
      { t: 0, projectiles: [projectile()] },
      { t: 0.1, projectiles: [projectile({ x: 10 })] },
    ];
    expect(logic.projectileHistory(tight, projectile({ x: 20 }), 1, toRadar)).toHaveLength(3);
    const tracks = logic.buildProjectileTracks(samples);
    expect(tracks.get(10)).toMatchObject({ first: 0, last: 2, samplesCount: 3, moved: true });
    expect(tracks.get(20)).toMatchObject({ samplesCount: 1, moved: false });
    const cache = logic.getRoundRenderCache(round({ projectileFrames: samples }));
    const first = logic.sampleProjectilesFixed(cache, 0.5);
    expect(logic.sampleProjectilesFixed(cache, 0.5001)).toBe(first);
    expect(logic.projectileGroundZ(tracks.get(10), 99)).toBe(0);
    expect(logic.projectileGroundZ(undefined, 99)).toBe(99);
    expect(logic.projectileHeightAboveGround(projectile({ z: 30 }), tracks.get(10))).toBe(30);
  });

  it("keeps a projectile visible through missing intermediate frames", () => {
    const sparse: ProjectileFrame[] = [
      { t: 0, projectiles: [projectile({ x: 0 })] },
      { t: 0.25, projectiles: [] },
      { t: 0.5, projectiles: [projectile({ x: 500 })] },
    ];
    const tracks = logic.buildProjectileTracks(sparse);
    expect(logic.sampleProjectileTrack(tracks.get(10)!, 0.25)).toMatchObject({ id: 10, x: 250 });
    expect(logic.sampleProjectileTracks(tracks, 0.25)).toEqual([
      expect.objectContaining({ id: 10, x: 250 }),
    ]);
    expect(logic.visibleProjectiles(sparse, 0.25, [], new Set(), tracks)).toEqual([
      expect.objectContaining({ id: 10, x: 250 }),
    ]);
  });

  it("does not interpolate across a reused projectile identity", () => {
    const reused: ProjectileFrame[] = [
      { t: 0, projectiles: [projectile({ type: "smokegrenade", x: 0 })] },
      { t: 1, projectiles: [projectile({ type: "flashbang", x: 100 })] },
    ];
    const track = logic.buildProjectileTracks(reused).get(10)!;
    expect(logic.sampleProjectileTrack(track, 0.5)).toBeNull();
  });

  it("classifies utility projectiles and visual duplicates", () => {
    const cases: Array<[string, string | null]> = [
      ["smokegrenade", "smoke"], ["molotov", "fire"], ["incgrenade", "fire"],
      ["inferno", "fire"], ["decoy", "decoy"], ["flashbang", "flash"],
      ["hegrenade", "he"], ["he grenade", "he"], ["high explosive", "he"], ["ak47", null],
    ];
    for (const [name, expected] of cases) expect(logic.projectileTypeToEffect(name)).toBe(expected);
    expect(logic.effectSuppressionRadius("fire")).toBe(900);
    expect(logic.effectSuppressionRadius("smoke")).toBe(900);
    expect(logic.effectSuppressionRadius("decoy")).toBe(700);
    expect(logic.effectSuppressionRadius("flash")).toBe(520);
    expect(logic.isSameVisualProjectile(projectile(), projectile())).toBe(true);
    expect(logic.isSameVisualProjectile(projectile(), projectile({ id: 11, x: 79 }))).toBe(true);
    expect(logic.isSameVisualProjectile(projectile(), projectile({ id: 11, x: 81 }))).toBe(false);
    expect(logic.isSameVisualProjectile(projectile(), projectile({ id: 11, type: "ak47" }))).toBe(false);
  });
});

describe("MapRenderer projectile/effect hand-off", () => {
  const frames: ProjectileFrame[] = [
    { t: 0.4, projectiles: [projectile({ x: 0 })] },
    { t: 0.9, projectiles: [projectile({ x: 90 })] },
    { t: 1.1, projectiles: [] },
  ];
  const smoke = effect({ start: 1, x: 100 });

  it("uses type-specific hide delays and canonical projectile names", () => {
    expect(logic.projectileHideStart(effect({ type: "smoke", start: 1 }))).toBe(1.65);
    expect(logic.projectileHideStart(effect({ type: "fire", start: 1 }))).toBe(1.65);
    expect(logic.projectileHideStart(effect({ type: "decoy", start: 1 }))).toBe(1.5);
    expect(logic.projectileHideStart(effect({ type: "flash", start: 1 }))).toBe(1.32);
    expect(logic.projectileHideStart(effect({ type: "he", start: 1 }))).toBe(1.22);
    expect(logic.projectileHideStart(effect({ type: "bomb_planted", start: 1 }))).toBe(1.25);
    expect(logic.projectileTypeForEffect(effect({ type: "he" }))).toBe("hegrenade");
    expect(logic.projectileTypeForEffect(effect({ type: "flash" }))).toBe("flashbang");
    expect(logic.projectileTypeForEffect(effect({ type: "smoke" }))).toBe("smokegrenade");
    expect(logic.projectileTypeForEffect(effect({ type: "decoy" }))).toBe("decoy");
    expect(logic.projectileTypeForEffect(effect({ type: "fire", variant: "incendiary" }))).toBe("incgrenade");
    expect(logic.projectileTypeForEffect(effect({ type: "fire", variant: "molotov" }))).toBe("molotov");
  });

  it("matches tracks near effects without suppressing unrelated projectiles", () => {
    expect(logic.projectileTouchesEffect(projectile({ x: 90 }), smoke, frames, 1.1)).toBe(true);
    expect(logic.projectileTouchesEffect(projectile({ type: "flashbang" }), smoke, frames, 1.1)).toBe(false);
    expect(logic.projectileTouchesEffect(projectile({ id: 99, x: 90 }), smoke, frames, 2)).toBe(false);
    expect(logic.projectileSeenNearEffect(projectile({ x: 90 }), smoke, frames)).toBe(true);
    expect(logic.projectileSeenNearEffect(projectile({ x: 5000 }), smoke, frames)).toBe(false);
    expect(logic.projectileEffectHandoff(projectile({ x: 90 }), [smoke], frames, 0.95)).toMatchObject({ active: false });
    expect(logic.projectileEffectHandoff(projectile({ x: 90 }), [smoke], frames, 1.1)).toMatchObject({ active: true });
    expect(logic.projectileEffectHandoff(projectile({ type: "ak47" }), [smoke], frames, 1)).toBeNull();
  });

  it("selects live and terminal projectiles and synthesizes a short bridge", () => {
    expect(logic.liveProjectileForEffect(frames, smoke, 0.9)?.id).toBe(10);
    expect(logic.liveProjectileForEffect(frames, smoke, 0.9, new Set([10]))).toBeNull();
    expect(logic.lastProjectileBeforeEffect(frames, smoke)).toMatchObject({ time: 0.9 });
    expect(logic.lastProjectileBeforeEffect([], smoke)).toBeNull();
    expect(logic.effectHandoffProjectile(frames, smoke, 0.95, new Set([10]))).toMatchObject({ x: 95 });
    expect(logic.effectHandoffProjectile(frames, smoke, 2)).toBeNull();
    expect(logic.effectHandoffProjectile(frames, smoke, 0.9)).toBeNull();
  });

  it("does not lose a projectile between its last sample and its explosion", () => {
    const terminalFrames: ProjectileFrame[] = [
      { t: 0.9, projectiles: [projectile({ type: "flashbang", x: 90 })] },
      { t: 1, projectiles: [projectile({ type: "flashbang", x: 100 })] },
      { t: 1.02, projectiles: [] },
    ];
    const flash = effect({ type: "flash", start: 1.015, end: 1.815, x: 101 });
    const tracks = logic.buildProjectileTracks(terminalFrames);

    // The legacy frame sampler still holds the last projectile between the
    // terminal sample and the next empty frame. The track sampler correctly
    // reports that flight has ended, allowing a synthetic hand-off instead.
    expect(logic.liveProjectileForEffect(terminalFrames, flash, 1.01)).not.toBeNull();
    expect(logic.liveProjectileForEffect(terminalFrames, flash, 1.01, undefined, tracks)).toBeNull();
    const handoff = logic.effectHandoffProjectile(terminalFrames, flash, 1.01, undefined, tracks);
    expect(handoff).toMatchObject({ id: 10 });
    expect(handoff!.x).toBeGreaterThan(100);
    const visible = logic.visibleProjectiles(terminalFrames, 1.01, [flash], new Set(), tracks);
    expect(visible).toEqual([expect.objectContaining({ id: 10 })]);
    expect(visible[0].x).toBeGreaterThan(100);
  });

  it("filters detonated and duplicate visual projectiles", () => {
    const nearFuture: ProjectileFrame[] = [
      { t: 0.9, projectiles: [projectile({ x: 90 }), projectile({ id: 11, x: 95 })] },
      { t: 1.05, projectiles: [projectile({ id: 12, type: "flashbang", x: 30 })] },
    ];
    expect(logic.visibleProjectiles(nearFuture, 0.91, [], new Set([10]))).toEqual([
      expect.objectContaining({ id: 11 }),
      expect.objectContaining({ id: 12 }),
    ]);
    expect(logic.visibleProjectiles(frames, 1.7, [smoke], new Set([10]))).toEqual([]);
  });

  it("keeps a new flash visible beside another flash explosion", () => {
    const firstFlash = effect({ type: "flash", start: 1, end: 1.8, x: 100 });
    const secondFlash = effect({ type: "flash", start: 2, end: 2.8, x: 400 });
    const overlappingFrames: ProjectileFrame[] = [
      { t: 0.8, projectiles: [projectile({ id: 10, type: "flashbang", x: 60 })] },
      {
        t: 0.98,
        projectiles: [
          projectile({ id: 10, type: "flashbang", x: 100 }),
          projectile({ id: 11, type: "flashbang", x: 130, thrower: 2 }),
        ],
      },
      { t: 1.2, projectiles: [projectile({ id: 11, type: "flashbang", x: 210, thrower: 2 })] },
      { t: 1.6, projectiles: [projectile({ id: 11, type: "flashbang", x: 320, thrower: 2 })] },
      { t: 1.98, projectiles: [projectile({ id: 11, type: "flashbang", x: 400, thrower: 2 })] },
    ];
    const effects = [firstFlash, secondFlash];
    const associations = logic.associateProjectileEffects(overlappingFrames, effects);
    const effectProjectileIds = new Map(
      [...associations].map(([utilityEffect, association]) => [utilityEffect, association.projectileId]),
    );
    const tracks = logic.buildProjectileTracks(overlappingFrames);

    expect(effectProjectileIds.get(firstFlash)).toBe(10);
    expect(effectProjectileIds.get(secondFlash)).toBe(11);
    expect(
      logic.visibleProjectiles(overlappingFrames, 1.55, effects, new Set([10]), tracks, effectProjectileIds),
    ).toEqual([expect.objectContaining({ id: 11 })]);
    expect(
      logic.projectileEffectHandoff(
        logic.sampleProjectileTrack(tracks.get(11)!, 1.55)!,
        [secondFlash],
        overlappingFrames,
        1.55,
      ),
    ).toBeNull();
  });
});

describe("MapRenderer utility effect corrections", () => {
  it("infers fire variants, radii and smoke overlap", () => {
    const fire = effect({ type: "fire", start: 1, end: 20, x: 0, variant: undefined });
    const molotovFrames: ProjectileFrame[] = [{ t: 1, projectiles: [projectile({ type: "molotov", x: 10 })] }];
    expect(logic.fireVariantFromProjectiles(fire, molotovFrames)).toMatchObject({ variant: "molotov" });
    const incendiaryFrames: ProjectileFrame[] = [{ t: 1, projectiles: [projectile({ type: "incendiary", x: 10 })] }];
    expect(logic.fireVariantFromProjectiles(fire, incendiaryFrames)).toMatchObject({ variant: "incendiary" });
    expect(logic.fireVariantFromProjectiles(fire, [])).toBe(fire);
    expect(logic.fireVariantFromProjectiles(effect({ type: "smoke" }), [])).toMatchObject({ type: "smoke" });
    expect(logic.circleOverlapArea(10, 10, 30)).toBe(0);
    expect(logic.circleOverlapArea(10, 3, 2)).toBeCloseTo(Math.PI * 9);
    expect(logic.circleOverlapArea(10, 10, 10)).toBeGreaterThan(0);
    expect(logic.fireRadiusWorld(effect({ type: "fire", variant: "incendiary" }))).toBe(104);
    expect(logic.fireRadiusWorld(effect({ type: "fire", variant: "molotov" }))).toBe(116);
    expect(logic.fireRadiusWorld(effect({ type: "fire", variant: undefined, team: 3 }))).toBe(104);
    expect(logic.fireIsSmoked(fire, [effect({ type: "smoke", x: 0 })])).toBe(true);
    expect(logic.fireIsSmoked(fire, [effect({ type: "flash", x: 0 })])).toBe(false);
    expect(logic.fireIsSmoked(fire, [effect({ type: "smoke", x: 1000 })])).toBe(false);
  });

  it("corrects excessive fire and early decoy timings", () => {
    const decoyFrames: ProjectileFrame[] = [
      { t: 0, projectiles: [projectile({ id: 4, type: "decoy", x: 0 })] },
      { t: 0.2, projectiles: [projectile({ id: 4, type: "decoy", x: 1 })] },
      { t: 0.4, projectiles: [projectile({ id: 4, type: "decoy", x: 1 })] },
    ];
    expect(logic.decoyProjectileTracks(decoyFrames)[0]).toMatchObject({ id: 4, landedAt: 0.2, samples: 3 });
    const decoy = effect({ type: "decoy", start: 1, end: 16, x: 1 });
    expect(logic.decoyLandingStart(decoy, decoyFrames)).toBe(0.2);
    expect(logic.decoyLandingStart(effect({ type: "smoke" }), decoyFrames)).toBeNull();
    expect(logic.resolveDecoyEffect(decoy, decoyFrames)).toMatchObject({ start: 0.2, end: 15.2 });
    expect(logic.resolveDecoyEffect(effect({ type: "smoke" }), decoyFrames)).toMatchObject({ type: "smoke" });
    const longFire = effect({ type: "fire", start: 2, end: 20 });
    expect(logic.resolveFireEffect(longFire)).toMatchObject({ end: 9 });
    expect(logic.resolveFireEffect(effect({ type: "fire", start: 2, end: 8 }))).toMatchObject({ end: 8 });
    expect(logic.resolveFireEffect(effect({ type: "smoke" }))).toMatchObject({ type: "smoke" });
    expect(logic.resolveEffects([longFire, decoy], decoyFrames)).toEqual([
      expect.objectContaining({ end: 9 }),
      expect.objectContaining({ start: 0.2 }),
    ]);
  });
});

describe("MapRenderer bomb and player state", () => {
  it("recognises equipment categories and presentation helpers", () => {
    expect(logic.heldWeaponBox("c4")).toEqual({ width: 18, height: 18 });
    expect(logic.heldWeaponBox("flashbang")).toEqual({ width: 15, height: 15 });
    expect(logic.heldWeaponBox("karambit")).toEqual({ width: 24, height: 12 });
    expect(logic.heldWeaponBox("deagle")).toEqual({ width: 23, height: 11 });
    expect(logic.heldWeaponBox("awp")).toEqual({ width: 34, height: 10 });
    expect(logic.heldWeaponBox("nova")).toEqual({ width: 33, height: 11 });
    expect(logic.heldWeaponBox("ak47")).toEqual({ width: 31, height: 10 });
    expect(logic.isUtilityWeapon("molotov")).toBe(true);
    expect(logic.isUtilityWeapon("ak47")).toBe(false);
    expect(logic.isBombWeapon("weapon_c4")).toBe(true);
    expect(logic.playerCarriesBomb(player({ hasBomb: true }))).toBe(true);
    expect(logic.playerCarriesBomb(player({ active: "bomb" }))).toBe(true);
    expect(logic.playerCarriesBomb(player({ weapons: ["c4"] }))).toBe(true);
    expect(logic.playerCarriesBomb(player())).toBe(false);
    expect(logic.isKnifeWeapon("bayonet")).toBe(true);
    expect(logic.isPistolWeapon("usp_silencer")).toBe(true);
    expect(logic.teamColor(3)).toBe(0x5ab0ff);
    expect(logic.teamColor(2)).toBe(0xf5b042);
    expect(logic.teamColor()).toBe(0xe5e7eb);
    expect(logic.teamDarkColor(3)).toBe(0x195066);
    expect(logic.teamDarkColor(2)).toBe(0x795322);
    expect(logic.teamDarkColor()).toBe(0x303030);
    expect(logic.clamp01(-1)).toBe(0);
    expect(logic.clamp01(2)).toBe(1);
    expect(logic.easeOutCubic(0.5)).toBe(0.875);
    expect(logic.mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(logic.displayName("L999")).toBe("grosNoob");
    expect(logic.displayName()).toBe("");
    expect(logic.heightLift(-1000)).toBe(22);
  });

  it("reconstructs carried and planted bomb states when frame data is incomplete", () => {
    const frames: Frame[] = [
      { t: 0, players: [player({ hasBomb: true, x: 10, y: 20, z: 30 })] },
      { t: 1, players: [player({ hasBomb: true, x: 15, y: 25, z: 30 })] },
      { t: 2, players: [player({ hasBomb: false, x: 15, y: 25, z: 30 })] },
      { t: 3, players: [] },
    ];
    const source = round({
      frames,
      events: [
        { t: 1.5, type: "bomb_planted", player: 1 },
        { t: 2.5, type: "bomb_defused", player: 2 },
      ],
    });
    const reconstructed = logic.roundFramesWithBombFallback(source);
    expect(reconstructed[0].bomb).toMatchObject({ status: "carried", carrier: 1 });
    expect(reconstructed[2].bomb).toMatchObject({ status: "planted", x: 15 });
    expect(reconstructed[3].bomb).toBeUndefined();
    expect(logic.roundFramesWithBombFallback(source)).toBe(reconstructed);
    const native = round({ frames: [{ t: 0, players: [], bomb: { x: 1, y: 2, z: 3, status: "dropped" } }] });
    expect(logic.roundFramesWithBombFallback(native)).toBe(native.frames);
  });

  it("tracks planting, defusing and explosion windows", () => {
    const bomb = { x: 0, y: 0, z: 0, status: "planted" as const };
    const positions = [player({ id: 2, team: 3, use: true })];
    const events = [{ t: 1, type: "bomb_defuse_start" as const, player: 2, hasKit: true }];
    expect(logic.activeDefuse(events, positions, bomb, 2)).toMatchObject({ start: 1, duration: 5, player: 2 });
    expect(logic.activeDefuse(events, [player({ id: 2, team: 3, use: false })], bomb, 2)).toBeNull();
    expect(logic.activeDefuse([{ t: 1, type: "bomb_defuse_start" }, { t: 2, type: "bomb_defuse_abort" }], positions, bomb, 3)).toBeNull();
    expect(logic.activeDefuse([{ t: 1, type: "bomb_defuse_start" }], positions, bomb, 2)).toMatchObject({ duration: 10 });
    const frames: Frame[] = [
      { t: 1, players: positions, bomb },
      { t: 3, players: positions },
    ];
    const source = round({ events: [{ t: 1, type: "bomb_planted" }, { t: 2, type: "bomb_defused" }] });
    expect(logic.activeBombPlantTime(source, 1.5)).toBe(1);
    expect(logic.activeBombPlantTime(source, 3)).toBeNull();
    expect(logic.recentlyDefusedBomb(source, frames, 3)).toEqual(bomb);
    expect(logic.plantedBombAt(frames, 2)).toEqual(bomb);
    const exploded = round({ events: [{ t: 1, type: "bomb_exploded" }] });
    expect(logic.recentBombExplosion(exploded, frames, 1.5)).toMatchObject({ age: 0.5 });
    expect(logic.recentBombExplosion(exploded, frames, 3)).toBeNull();
    expect(logic.bombPulseProgress(0, 0)).toBe(0);
    expect(logic.bombPulseProgress(0, 40)).toBeCloseTo(0);
  });
});

describe("MapRenderer cache and cleanup", () => {
  it("builds death markers once and destroys detached display objects safely", () => {
    const source = round({
      frames: [{ t: 0, players: [player({ x: 12, y: 13, z: 14 })] }],
      events: [{ t: 1, type: "kill", victim: 1 }],
    });
    const cache = logic.getRoundRenderCache(source);
    expect(cache.deathMarkers).toEqual([
      { t: 1, victim: 1, x: 12, y: 13, z: 14, yaw: 170, team: 2 },
    ]);
    expect(logic.getRoundRenderCache(source)).toBe(cache);

    const child = { destroyed: false, destroy: vi.fn() };
    const destroyed = { destroyed: true, destroy: vi.fn() };
    const layer = { removeChildren: vi.fn(() => [child, destroyed]) };
    const queue: Array<typeof child> = [];
    logic.queueLayerChildrenForDestroy(layer as never, queue as never);
    expect(queue).toHaveLength(2);
    logic.drainDestroyQueue(queue as never, 2, 100);
    expect(child.destroy).toHaveBeenCalledWith({ children: true });
    expect(destroyed.destroy).not.toHaveBeenCalled();
    expect(queue).toHaveLength(0);
  });
});

describe("MapRenderer habit overlay calculations", () => {
  const toRadar = (x: number, y: number, z = 0) => ({ x: x + z, y });
  const positions = [
    { t: 0, x: 0, y: 0, z: 10, yaw: 170, hp: 100, team: 2 },
    { t: 1, x: 10, y: 20, z: 20, yaw: -170, hp: 80, team: 3 },
  ];
  const replay: HabitReplayRound = {
    id: "r1",
    roundNumber: 1,
    playerId: 1,
    playerName: "Player",
    positions,
    projectiles: [],
    effects: [],
  };

  it("interpolates players, projectiles and radar-layer positions", () => {
    expect(logic.sampleHabitPosition([], 0)).toBeNull();
    expect(logic.sampleHabitPosition(positions, 0.5)).toMatchObject({ x: 5, y: 10, z: 15, yaw: 180, hp: 90, team: 3 });
    expect(logic.habitRadarLayerPositions([replay], 0.5)).toEqual([expect.objectContaining({ z: 15 })]);
    expect(logic.habitRadarLayerPositions([{ ...replay, death: { t: 0.4, x: 1, y: 2, z: 99 } }], 0.5)).toEqual([{ z: 99 }]);
    expect(logic.habitRadarLayerPositions([{ ...replay, positions: positions.map((sample) => ({ ...sample, hp: 0 })) }], 0.5)).toEqual([]);
    expect(logic.habitTimedPoints(positions, 0, 1, toRadar)).toEqual([{ x: 10, y: 0 }, { x: 30, y: 20 }]);
    expect(logic.habitTimedPoints(positions, 0, 1, toRadar, 10)).toEqual([{ x: 0, y: 0 }, { x: 20, y: 20 }]);
    const replayProjectile: HabitReplayProjectile = {
      id: "p1", roundNumber: 1, projectileId: 1, type: "smokegrenade",
      samples: [{ t: 0, x: 0, y: 0, z: 20 }, { t: 1, x: 10, y: 20, z: 10 }],
    };
    expect(logic.sampleHabitProjectile(replayProjectile, 0.5)).toEqual({ x: 5, y: 10, z: 15 });
    expect(logic.sampleHabitProjectile({ ...replayProjectile, samples: [] }, 0.5)).toBeNull();
    expect(logic.habitProjectileGroundZ(replayProjectile)).toBe(10);
    expect(logic.habitProjectileGroundZ({ ...replayProjectile, samples: [] })).toBe(0);
  });

  it("draws trails, live ghosts and death ghosts with Pixi display objects", () => {
    const layer = new Container();
    const shortTrail: HabitOverlayTrail = { id: "short", roundNumber: 1, type: "smoke", points: [{ x: 0, y: 0, z: 0 }] };
    logic.drawHabitOverlayTrail(layer, shortTrail, toRadar);
    expect(layer.children).toHaveLength(0);
    const trail: HabitOverlayTrail = { ...shortTrail, points: [{ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 0 }] };
    logic.drawHabitOverlayTrail(layer, trail, toRadar);
    logic.drawHabitGhostPlayer(layer, replay, 0.5, toRadar);
    const beforeDeath = layer.children.length;
    logic.drawHabitGhostPlayer(layer, { ...replay, death: { t: 0.4, x: 4, y: 5, z: 0 } }, 0.5, toRadar);
    expect(layer.children.length).toBeGreaterThan(beforeDeath);
    logic.drawHabitGhostPlayer(layer, { ...replay, positions: [] }, 0.5, toRadar);
    expect(logic.habitTrailColor("smoke")).toBe(0x9ca3af);
    expect(logic.habitTrailColor("flashbang")).toBe(0xfef3c7);
    expect(logic.habitTrailColor("hegrenade")).toBe(0xf97316);
    expect(logic.habitTrailColor("molotov")).toBe(0xef4444);
    expect(logic.habitTrailColor("decoy")).toBe(0xa78bfa);
    expect(logic.habitTrailColor("unknown")).toBe(0x6fea76);
    layer.destroy({ children: true });
  });

  it("draws replay projectiles through their effect hand-off", () => {
    const layer = new Container();
    const replayProjectile: HabitReplayProjectile = {
      id: "p1", roundNumber: 1, projectileId: 10, type: "smokegrenade", thrower: 1,
      samples: [
        { t: 0, x: 0, y: 0, z: 20 },
        { t: 0.8, x: 80, y: 0, z: 10 },
      ],
    };
    const effects = [effect({ type: "smoke", start: 1, x: 100 })];
    logic.drawHabitProjectile(layer, replayProjectile, -1, toRadar, effects);
    expect(layer.children).toHaveLength(0);
    logic.drawHabitProjectile(layer, replayProjectile, 1.05, toRadar, effects);
    expect(layer.children.length).toBeGreaterThan(0);
    const replayWithVisuals = { ...replay, projectiles: [replayProjectile], effects };
    logic.drawHabitReplayOverlay(layer, [replayWithVisuals], 1.05, toRadar, 1);
    expect(layer.children.length).toBeGreaterThan(1);
    layer.destroy({ children: true });
  });
});

describe("MapRenderer Pixi drawing primitives", () => {
  const toRadar = (x: number, y: number) => ({ x, y });

  it("renders smoke, flash, HE, fire and bomb markers", () => {
    const layer = new Container();
    logic.drawEffect(layer, effect({ type: "smoke", start: 0, end: 10 }), 5, toRadar, 1);
    logic.drawEffect(layer, effect({ type: "flash", start: 0, end: 1 }), 0.1, toRadar, 1);
    logic.drawEffect(layer, effect({ type: "he", start: 0, end: 1 }), 0.05, toRadar, 1);
    logic.drawEffect(layer, effect({ type: "he", start: 0, end: 1 }), 0.5, toRadar, 1);
    logic.drawEffect(layer, effect({ type: "fire", start: 0, end: 7 }), 3, toRadar, 1);
    logic.drawEffect(layer, effect({ type: "bomb_planted", start: 0, end: 40 }), 3, toRadar, 1);
    expect(layer.children.length).toBeGreaterThanOrEqual(9);
    layer.destroy({ children: true });
  });

  it("draws smoothed paths, countdown digits and active handoff projectiles", () => {
    const layer = new Container();
    const graphics = new Graphics();
    logic.drawSmoothTrail(graphics, [{ x: 0, y: 0 }], 0xffffff);
    logic.drawSmoothTrail(graphics, [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 50, y: 20 }], 0xffffff);
    logic.drawTimerArc(graphics, 0, 0, 10, 0, 0xffffff, 1);
    logic.drawTimerArc(graphics, 0, 0, 10, 2, 0xffffff, 1);
    logic.drawCountdownLabel(layer, "not-a-number", 0, 0);
    logic.drawCountdownLabel(layer, "0123456789", 0, 0);
    logic.drawFireMarker(layer, 1, 2, logic.teamColor(2));
    expect(layer.children.at(-1)?.scale.x).toBeCloseTo(18 / 14);
    const death = logic.drawDeathMarker(layer, 1, 2, 90, 3, "Player");
    expect(death.alpha).toBe(0.18);
    expect(logic.playerArrowRotation(90)).toBeCloseTo(-Math.PI / 2);
    expect(logic.playerArrowRotation(-90)).toBeCloseTo(Math.PI / 2);
    const frames: ProjectileFrame[] = [
      { t: 0, projectiles: [projectile()] },
      { t: 1, projectiles: [projectile({ x: 100, z: 20 })] },
    ];
    const track = logic.buildProjectileTracks(frames).get(10);
    const childrenBeforeProjectile = layer.children.length;
    logic.drawProjectile(
      layer,
      projectile({ x: 100, z: 20 }),
      track,
      1.1,
      new Map([[1, 2]]),
      toRadar,
      { effect: effect({ type: "smoke", start: 1, x: 100 }), active: true },
    );
    expect(layer.children.length).toBeGreaterThan(3);
    expect(layer.children.slice(childrenBeforeProjectile).some((child) => child instanceof Sprite && child.alpha > 0)).toBe(true);
    layer.destroy({ children: true });
  });

  it("fits sprite-like objects to square and rectangular bounds", () => {
    const square = { texture: null, width: 0, height: 0 };
    logic.fitSprite(square as never, 10);
    expect(square).toMatchObject({ width: 10, height: 10 });
    const wide = { texture: { width: 20, height: 10 }, width: 0, height: 0 };
    logic.fitSprite(wide as never, 10);
    expect(wide).toMatchObject({ width: 10, height: 5 });
    const tall = { texture: { width: 10, height: 20 }, width: 0, height: 0 };
    logic.fitSpriteBox(tall as never, 20, 10);
    expect(tall).toMatchObject({ width: 5, height: 10 });
    logic.fitSpriteBox(wide as never, 20, 10);
    expect(wide).toMatchObject({ width: 20, height: 10 });
  });
});

describe("MapRenderer diagnostics", () => {
  it("summarises usable, short, invalid and static projectile tracks", () => {
    const frames: ProjectileFrame[] = [
      {
        t: 0,
        projectiles: [
          projectile({ id: 1, x: 0 }),
          projectile({ id: 2, type: "flashbang", x: Number.NaN }),
          projectile({ id: 3, type: "decoy", x: 5 }),
          projectile({ id: 4, type: "ak47", x: 1 }),
        ],
      },
      {
        t: 1,
        projectiles: [
          projectile({ id: 1, x: 10 }),
          projectile({ id: 2, type: "flashbang", x: Number.NaN }),
          projectile({ id: 3, type: "decoy", x: 5 }),
        ],
      },
    ];
    const source = round({ frames: [{ t: 0, players: [] }], projectileFrames: frames });
    const summary = logic.summarizeProjectileRound(source, frames, [effect(), effect({ type: "fire", variant: "molotov" })]);
    expect(summary).toMatchObject({ totalProjectileTracks: 4, usableTrajectories: 1, rejectedTrajectories: 3, effectCount: 2 });
    expect(summary.rejectedExamples.map((entry) => entry.reason)).toEqual(expect.arrayContaining(["path too short", "invalid coordinates", "static path"]));
  });

  it("explains projectile hiding and rendering failures", () => {
    const smoke = effect({ type: "smoke", start: 1, x: 0 });
    const frames: ProjectileFrame[] = [{ t: 1, projectiles: [projectile()] }];
    expect(logic.projectileEffectMatchDebug(projectile(), [smoke], frames, 2)).toMatchObject({ started: true });
    expect(logic.projectileEffectMatchDebug(projectile({ type: "ak47" }), [smoke], frames, 2)).toBeNull();
    expect(logic.projectileHiddenReasonDebug(projectile(), [], [smoke], new Set([10]), frames, 2)?.reason).toBe("hidden by detonatedIds");
    expect(logic.projectileHiddenReasonDebug(projectile(), [], [smoke], new Set(), frames, 2)).toBeNull();
    expect(logic.projectileHiddenReasonDebug(projectile({ id: 11 }), [projectile()], [], new Set(), frames, 0)?.reason).toBe("duplicate visual projectile");
    expect(logic.projectileHiddenReasonDebug(projectile({ id: 11, x: 1000 }), [], [], new Set(), frames, 0)).toBeNull();
    const layer = { visible: true, alpha: 1, destroyed: false };
    expect(logic.projectileRenderIssueDebug(projectile({ x: Number.NaN }), [], { x: 0, y: 0 }, layer as never, 100)).toBe("invalid coordinates");
    expect(logic.projectileRenderIssueDebug(projectile(), [{ x: Number.NaN, y: 0 }], { x: 0, y: 0 }, layer as never, 100)).toBe("invalid radar path");
    expect(logic.projectileRenderIssueDebug(projectile(), [{ x: 0, y: 0 }], { x: 0, y: 0 }, layer as never, 100)).toBe("path too short");
    expect(logic.projectileRenderIssueDebug(projectile(), [{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 200, y: 0 }, layer as never, 100)).toBe("outside map bounds");
    expect(logic.projectileRenderIssueDebug(projectile(), [{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0 }, { ...layer, visible: false } as never, 100)).toBe("layer invisible");
    expect(logic.projectileRenderIssueDebug(projectile(), [{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0 }, { ...layer, alpha: 0 } as never, 100)).toBe("alpha zero");
    expect(logic.projectileRenderIssueDebug(projectile(), [{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0 }, { ...layer, destroyed: true } as never, 100)).toBe("object destroyed");
    expect(logic.projectileRenderIssueDebug(projectile(), [{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0 }, layer as never, 100)).toBeNull();
  });

  it("keeps the projectile icon visible during the explosion handoff", () => {
    const he = effect({ type: "he", start: 10.984375, end: 11.884375 });
    const handoff = { effect: he, active: true };

    expect(logic.projectileHandoffIconAlpha(handoff, he.start)).toBe(1);
    expect(logic.projectileHandoffIconAlpha(handoff, 11)).toBeGreaterThan(0.8);
    expect(logic.projectileHandoffIconAlpha(handoff, he.start + 0.08)).toBeCloseTo(0.5);
    expect(logic.projectileHandoffIconAlpha(handoff, he.start + 0.16)).toBe(0);
    expect(logic.projectileHandoffIconAlpha(null, 11)).toBe(1);
  });
});
