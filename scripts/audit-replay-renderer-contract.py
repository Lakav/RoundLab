#!/usr/bin/env python3
"""Audit replay renderer safeguards that are easy to regress silently.

The data-level replay audit proves that parsed effects can be matched to
projectile tracks. This source-level audit checks that the React/Pixi renderer
still contains the handoff, future-frame, and condensed-replay paths needed to
show those trajectories instead of only showing the final utility effect.
"""

from __future__ import annotations

import math
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAP_RENDERER = ROOT / "desktop" / "src" / "components" / "replay" / "MapRenderer.tsx"
MATCH_VIEWER = ROOT / "desktop" / "src" / "app" / "match" / "MatchViewer.tsx"
REPLAY_STORE = ROOT / "desktop" / "src" / "lib" / "replay-store.ts"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def function_body(source: str, name: str) -> str:
    match = re.search(rf"function\s+{re.escape(name)}\s*\(", source)
    if not match:
        raise AssertionError(f"missing function {name}")
    paren = source.find("(", match.end() - 1)
    if paren < 0:
        raise AssertionError(f"missing parameter list for {name}")
    depth = 0
    end_paren = -1
    for index in range(paren, len(source)):
        char = source[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                end_paren = index
                break
    if end_paren < 0:
        raise AssertionError(f"unterminated parameter list for {name}")
    brace = source.find("{", end_paren)
    if brace < 0:
        raise AssertionError(f"missing function body for {name}")
    depth = 0
    for index in range(brace, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[brace + 1:index]
    raise AssertionError(f"unterminated function body for {name}")


def assert_contains(label: str, source: str, tokens: list[str]) -> list[str]:
    return [f"{label} is missing {token!r}" for token in tokens if token not in source]


def source_between(source: str, start_marker: str, end_marker: str) -> str:
    start = source.find(start_marker)
    if start < 0:
        raise AssertionError(f"missing marker {start_marker!r}")
    end = source.find(end_marker, start + len(start_marker))
    if end < 0:
        raise AssertionError(f"missing marker {end_marker!r}")
    return source[start:end]


def assert_projectile_source_selection(map_renderer: str) -> list[str]:
    body = function_body(map_renderer, "projectileSamples")
    return assert_contains(
        "projectileSamples",
        body,
        [
            "round.projectileFrames?.length ? round.projectileFrames : round.frames",
        ],
    )


def assert_classic_projectile_handoff(map_renderer: str) -> list[str]:
    errors: list[str] = []
    hide_body = function_body(map_renderer, "projectileHideStart")
    errors.extend(
        assert_contains(
            "projectileHideStart",
            hide_body,
            [
                'effect.type === "smoke"',
                "effect.start + 0.65",
                'effect.type === "fire"',
                'effect.type === "flash"',
                'effect.type === "he"',
            ],
        )
    )

    handoff_body = function_body(map_renderer, "projectileEffectHandoff")
    errors.extend(
        assert_contains(
            "projectileEffectHandoff",
            handoff_body,
            [
                "projectileTouchesEffect(projectile, effect, frames, time)",
                "projectileSeenNearEffect(projectile, effect, frames)",
                "time < effect.start - 0.12",
                "time > projectileHideStart(effect)",
                "active: time >= best.effect.start",
            ],
        )
    )

    visible_body = function_body(map_renderer, "visibleProjectiles")
    errors.extend(
        assert_contains(
            "visibleProjectiles",
            visible_body,
            [
                "detonatedIds.has(projectile.id)",
                "projectileResolvedByEffect(projectile, startedEffects, time, frames)",
                "pair.b.t - time <= 0.16",
                "effectHandoffProjectile(frames, effect, time)",
                "isSameVisualProjectile(current, handoff)",
            ],
        )
    )

    draw_body = function_body(map_renderer, "drawProjectile")
    errors.extend(
        assert_contains(
            "drawProjectile",
            draw_body,
            [
                "projectileHistoryFromTrack(projectileTrack, projectile, time, toRadar)",
                "handoff?.active",
                "raw.push(impact)",
                "toRadar(handoff.effect.x, handoff.effect.y, 0)",
                "if (handoff?.active) return;",
            ],
        )
    )
    return errors


def assert_condensed_projectile_handoff(map_renderer: str, match_viewer: str, replay_store: str) -> list[str]:
    errors: list[str] = []
    replay_types = ["HabitReplayProjectile", "HabitReplayEffect", "HabitReplayRound"]
    errors.extend(assert_contains("replay-store condensed types", replay_store, replay_types))

    builder_body = function_body(match_viewer, "buildHabitReplayRound")
    errors.extend(
        assert_contains(
            "buildHabitReplayRound",
            builder_body,
            [
                "const allTracks = new Map",
                "const usableTracks = [...allTracks.entries()]",
                ".filter((track) => track.samples.length >= 2)",
                "const projectiles = usableTracks.filter((track) => track.thrower === playerId)",
                "let bestDistance = Infinity",
                "let bestThrower: number | undefined",
                "if (bestDistance <= radius2 && bestThrower === playerId) effects.push(effect)",
            ],
        )
    )

    habit_body = function_body(map_renderer, "drawHabitProjectile")
    errors.extend(
        assert_contains(
            "drawHabitProjectile",
            habit_body,
            [
                "effectSuppressionRadius(kind)",
                "activeHandoff",
                "time >= handoff.start",
                "points.push(impact)",
                "drawSmoothTrail(g, points, color)",
                "if (points.length < 2) return",
            ],
        )
    )

    overlay_body = function_body(map_renderer, "drawHabitReplayOverlay")
    errors.extend(
        assert_contains(
            "drawHabitReplayOverlay",
            overlay_body,
            [
                "drawHabitProjectile(layer, projectile, time, toRadar, replay.effects)",
                "drawHabitEffect(layer, effect, time, toRadar, unitsToPx, replay.effects)",
                "drawHabitGhostPlayer(layer, replay, time, toRadar)",
            ],
        )
    )

    match_viewer_body = function_body(match_viewer, "MatchViewer")
    errors.extend(
        assert_contains(
            "MatchViewer condensed playback",
            match_viewer_body,
            [
                'reviewMode === "condensed"',
                "runCondensedOverlay",
                "setDurationOverride(duration || null)",
                "<MapRenderer size={innerSize} condensed={condensedMode} />",
            ],
        )
    )

    renderer_body = function_body(map_renderer, "MapRenderer")
    errors.extend(
        assert_contains(
            "MapRenderer condensed branch",
            renderer_body,
            [
                "if (condensed)",
                "drawHabitReplayOverlay(habitLayer, currentHabitOverlay.replays, time, toRadar, unitsToPx)",
                "return;",
            ],
        )
    )
    return errors


def assert_projectile_diagnostics(map_renderer: str) -> list[str]:
    renderer_body = function_body(map_renderer, "MapRenderer")
    return assert_contains(
        "MapRenderer projectile diagnostics",
        renderer_body,
        [
            "trajectory-not-drawn",
            "projectileRenderIssueDebug(projectile, raw, current, utilityLayer, size)",
            "trajectoriesNotDrawn",
            "projectile-hidden",
            "projectile-visible-reason",
        ],
    )


def assert_projectile_shadow_depth(map_renderer: str) -> list[str]:
    errors: list[str] = []
    errors.extend(
        assert_contains(
            "heightLift",
            function_body(map_renderer, "heightLift"),
            [
                "Math.max(0, Math.min(22, Math.abs(z) / 35))",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "projectileHeightAboveGround",
            function_body(map_renderer, "projectileHeightAboveGround"),
            [
                "projectile.z - projectileGroundZ(track, projectile.z)",
                "Math.max(0,",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "projectileHistoryFromTrack",
            source_between(map_renderer, "function projectileHistoryFromTrack", "function drawSmoothTrail"),
            [
                "const groundZ = projectileGroundZ(track, projectile.z)",
                "Math.max(0, p.z - groundZ)",
                "Math.max(0, projectile.z - groundZ)",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "drawProjectile shadow",
            function_body(map_renderer, "drawProjectile"),
            [
                "const heightAboveGround = projectileHeightAboveGround(projectile, projectileTrack)",
                "toRadar(projectile.x, projectile.y, heightAboveGround)",
                "const shadow = toRadar(projectile.x, projectile.y, 0)",
                "const shadowDistance = Math.hypot(p.x - shadow.x, p.y - shadow.y)",
                "shadowRadius = 4.6 - Math.min(1.4, shadowDistance / 18)",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "condensed projectile shadow",
            function_body(map_renderer, "drawHabitProjectile"),
            [
                "const groundZ = habitProjectileGroundZ(projectile)",
                "Math.max(0, sampled.z - groundZ)",
                "const shadow = toRadar(sampled.x, sampled.y, 0)",
                "const shadowDistance = Math.hypot(current.x - shadow.x, current.y - shadow.y)",
                "shadowRadius = 3.8 - Math.min(1, shadowDistance / 24)",
            ],
        )
    )

    def height_lift(z: float) -> float:
        return max(0.0, min(22.0, abs(z) / 35.0))

    near_ground = height_lift(8)
    high_arc = height_lift(600)
    if not (0 < near_ground < high_arc <= 22):
        errors.append("heightLift simulation no longer increases with projectile altitude and caps at 22px")
    if not math.isclose(height_lift(0), 0):
        errors.append("heightLift(0) must keep landed utility icons on their shadow")
    return errors


def assert_weapon_fire_rendering(map_renderer: str) -> list[str]:
    errors: list[str] = []
    fire_body = function_body(map_renderer, "drawWeaponFire")
    errors.extend(
        assert_contains(
            "drawWeaponFire",
            fire_body,
            [
                "if (isUtilityWeapon(fire.weapon)) return",
                "const duration = isKnifeWeapon(fire.weapon) ? 0.18 : 0.14",
                "if (age < 0 || age > duration) return",
                "const alpha = 1 - age / duration",
                "const start = shooterLive",
                "? toRadar(shooterLive.x, shooterLive.y, 0)",
                ": toRadar(fire.x, fire.y, 0)",
                "const yaw = shooterLive ? shooterLive.yaw : fire.yaw",
                "const angle = (-yaw * Math.PI) / 180",
                "const forward = PLAYER_ARROW_TIP_OFFSET + maxW / 2",
                'const texturePath = isKnife ? "/icons/quick-slash.svg" : "/icons/shoot.svg"',
                "if (!readyTexture)",
                "fallback.position.set(start.x, start.y)",
                "fallback.rotation = angle",
                "sprite.position.set(px, py)",
                "sprite.rotation = spriteAngle",
                "fitSpriteBox(sprite, maxW, maxH)",
                "const trueForward = PLAYER_ARROW_TIP_OFFSET + sprite.width / 2",
                "loadIconTexture(texturePath)",
            ],
        )
    )
    renderer_body = function_body(map_renderer, "MapRenderer")
    errors.extend(
        assert_contains(
            "MapRenderer weapon fire loop",
            renderer_body,
            [
                "const visibleFires: WeaponFireEvent[] = (round.weaponFires ?? []).filter",
                "fire.t <= time && time - fire.t <= 0.24",
                "const liveById = new Map(positions.map((p) => [p.id, p]))",
                "const live = fire.shooter ? liveById.get(fire.shooter) : undefined",
                "drawWeaponFire(utilityLayer, fire, time, toRadar, live)",
                "recentFireByShooter.set(fire.shooter, fire)",
                "const shot = recentFireByShooter.get(p.id)",
                "s.muzzleFlash.clear()",
                "if (alive && shot && !isUtilityWeapon(shot.weapon))",
                "s.arrowRotator.scale.set(1 + shotAlpha *",
                "s.arrowRotator.scale.set(1)",
            ],
        )
    )

    def alpha(age: float, duration: float) -> float:
        return 1 - age / duration

    if not (0 < alpha(0.07, 0.14) < 1):
        errors.append("weapon fire alpha simulation no longer fades during rifle/pistol shot duration")
    if not math.isclose(alpha(0.18, 0.18), 0):
        errors.append("knife shot alpha should reach zero at the end of its duration")
    return errors


def main() -> None:
    map_renderer = read(MAP_RENDERER)
    match_viewer = read(MATCH_VIEWER)
    replay_store = read(REPLAY_STORE)

    errors: list[str] = []
    errors.extend(assert_projectile_source_selection(map_renderer))
    errors.extend(assert_classic_projectile_handoff(map_renderer))
    errors.extend(assert_condensed_projectile_handoff(map_renderer, match_viewer, replay_store))
    errors.extend(assert_projectile_diagnostics(map_renderer))
    errors.extend(assert_projectile_shadow_depth(map_renderer))
    errors.extend(assert_weapon_fire_rendering(map_renderer))

    if errors:
        raise AssertionError("replay renderer contract audit failed: " + "; ".join(errors))
    print("replay renderer contract audit passed")


if __name__ == "__main__":
    main()
