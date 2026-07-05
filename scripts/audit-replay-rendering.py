#!/usr/bin/env python3
"""Audit replay rendering invariants from local parsed round fixtures.

This does not replace visual QA. It catches the data/rendering contract bugs
that caused recent issues: bad map calibration/crop, effects without a nearby
projectile track, invalid projectile samples, and timing patterns that require
the renderer's future-frame/handoff fallbacks.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import re
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMPARE_DIR = ROOT / ".roundlab-compare"
DEFAULT_PARSED_DIR = ROOT / "desktop" / "data" / "parsed"
DEFAULT_PUBLIC_DIR = ROOT / "desktop" / "public"
MAPS_TS = ROOT / "desktop" / "src" / "lib" / "maps.ts"
RADAR_SIZE = 1024

CALIB_RE = re.compile(
    r"(de_[a-z0-9_]+):\s*\{\s*posX:\s*([-0-9.]+),\s*posY:\s*([-0-9.]+),\s*scale:\s*([-0-9.]+)\s*\}"
)
CROP_RE = re.compile(
    r"(de_[a-z0-9_]+):\s*\{\s*x:\s*([-0-9.]+),\s*y:\s*([-0-9.]+),\s*size:\s*([-0-9.]+)\s*\}"
)
VERTICAL_SECTION_RE = re.compile(r"(de_[a-z0-9_]+):\s*\[(?P<body>.*?)\]", re.S)
VERTICAL_LAYER_RE = re.compile(
    r"\{\s*layer:\s*\"([a-z]+)\",\s*altitudeMin:\s*([-0-9.]+),\s*altitudeMax:\s*([-0-9.]+)\s*\}"
)


@dataclass(frozen=True)
class Calibration:
    pos_x: float
    pos_y: float
    scale: float


@dataclass(frozen=True)
class Crop:
    x: float
    y: float
    size: float


@dataclass(frozen=True)
class VerticalSection:
    layer: str
    altitude_min: float
    altitude_max: float


@dataclass
class Track:
    projectile_id: int
    projectile_type: str
    thrower: int | None
    thrower_conflict: bool = False
    samples: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class AuditStats:
    label: str
    map_name: str
    source: str
    rounds: int = 0
    rounds_without_start_players: int = 0
    players: int = 0
    players_out: int = 0
    start_players: int = 0
    start_players_out: int = 0
    effects: int = 0
    effects_out: int = 0
    matched_effects: int = 0
    unmatched_effects: int = 0
    projectiles: int = 0
    projectiles_out: int = 0
    invalid_projectiles: int = 0
    utility_tracks: int = 0
    utility_tracks_missing_thrower: int = 0
    projectile_thrower_conflicts: int = 0
    matched_effects_without_thrower: int = 0
    condensed_effects_unique_thrower: int = 0
    condensed_effects_unassigned: int = 0
    condensed_effects_ambiguous: int = 0
    short_tracks: int = 0
    future_only_windows: int = 0
    large_effect_gaps: int = 0
    active_effect_suppression_risks: int = 0
    max_effect_gap: float = 0.0
    min_x: float = math.inf
    min_y: float = math.inf
    max_x: float = -math.inf
    max_y: float = -math.inf
    radar_layers: dict[str, int] = field(default_factory=dict)
    start_radar_layers: dict[str, int] = field(default_factory=dict)
    examples: list[dict[str, Any]] = field(default_factory=list)

    def pct(self, value: int, total: int) -> float:
        return round((100 * value / total), 3) if total else 0.0

    def as_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "map": self.map_name,
            "source": self.source,
            "rounds": self.rounds,
            "roundsWithoutStartPlayers": self.rounds_without_start_players,
            "players": self.players,
            "playersOutPct": self.pct(self.players_out, self.players),
            "startPlayers": self.start_players,
            "startPlayersOut": self.start_players_out,
            "startPlayersOutPct": self.pct(self.start_players_out, self.start_players),
            "effects": self.effects,
            "effectsOutPct": self.pct(self.effects_out, self.effects),
            "matchedEffects": self.matched_effects,
            "unmatchedEffects": self.unmatched_effects,
            "projectiles": self.projectiles,
            "projectilesOutPct": self.pct(self.projectiles_out, self.projectiles),
            "invalidProjectiles": self.invalid_projectiles,
            "utilityTracks": self.utility_tracks,
            "utilityTracksMissingThrower": self.utility_tracks_missing_thrower,
            "projectileThrowerConflicts": self.projectile_thrower_conflicts,
            "matchedEffectsWithoutThrower": self.matched_effects_without_thrower,
            "condensedEffectsUniqueThrower": self.condensed_effects_unique_thrower,
            "condensedEffectsUnassigned": self.condensed_effects_unassigned,
            "condensedEffectsAmbiguous": self.condensed_effects_ambiguous,
            "shortTracks": self.short_tracks,
            "futureOnlyWindows": self.future_only_windows,
            "largeEffectGaps": self.large_effect_gaps,
            "activeEffectSuppressionRisks": self.active_effect_suppression_risks,
            "hasUtilitySignal": self.effects > 0 and self.utility_tracks > 0,
            "maxEffectGap": round(self.max_effect_gap, 3),
            "radarBounds": {
                "minX": None if math.isinf(self.min_x) else math.floor(self.min_x),
                "minY": None if math.isinf(self.min_y) else math.floor(self.min_y),
                "maxX": None if math.isinf(self.max_x) else math.ceil(self.max_x),
                "maxY": None if math.isinf(self.max_y) else math.ceil(self.max_y),
            },
            "radarLayers": dict(sorted(self.radar_layers.items())),
            "startRadarLayers": dict(sorted(self.start_radar_layers.items())),
            "examples": self.examples[:8],
        }


def load_json_gz(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def load_maps() -> tuple[dict[str, Calibration], dict[str, Crop]]:
    text = MAPS_TS.read_text(encoding="utf-8")
    calibrations = {
        name: Calibration(float(pos_x), float(pos_y), float(scale))
        for name, pos_x, pos_y, scale in CALIB_RE.findall(text)
    }
    crops = {
        name: Crop(float(x), float(y), float(size))
        for name, x, y, size in CROP_RE.findall(text)
    }
    if not calibrations:
        raise AssertionError(f"no map calibrations parsed from {MAPS_TS}")
    return calibrations, crops


def load_vertical_sections() -> dict[str, list[VerticalSection]]:
    text = MAPS_TS.read_text(encoding="utf-8")
    sections: dict[str, list[VerticalSection]] = {}
    for match in VERTICAL_SECTION_RE.finditer(text):
        map_name = match.group(1)
        body = match.group("body")
        parsed = [
            VerticalSection(layer, float(altitude_min), float(altitude_max))
            for layer, altitude_min, altitude_max in VERTICAL_LAYER_RE.findall(body)
        ]
        if parsed:
            sections[map_name] = parsed
    return sections


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as f:
        header = f.read(24)
    if len(header) < 24 or not header.startswith(b"\x89PNG\r\n\x1a\n"):
        raise AssertionError(f"{path} is not a valid PNG")
    return struct.unpack(">II", header[16:24])


def assert_map_assets(calibrations: dict[str, Calibration], public_dir: Path) -> None:
    missing: list[str] = []
    invalid: list[str] = []
    for map_name in sorted(calibrations):
        path = public_dir / "cs2lens-maps" / f"{map_name}.png"
        if not path.exists():
            missing.append(str(path.relative_to(ROOT)))
            continue
        width, height = png_size(path)
        if width != RADAR_SIZE or height != RADAR_SIZE:
            invalid.append(f"{path.relative_to(ROOT)} is {width}x{height}, expected {RADAR_SIZE}x{RADAR_SIZE}")
        lower_path = public_dir / "cs2lens-maps" / f"{map_name}_lower.png"
        if lower_path.exists():
            lower_width, lower_height = png_size(lower_path)
            if lower_width != RADAR_SIZE or lower_height != RADAR_SIZE:
                invalid.append(
                    f"{lower_path.relative_to(ROOT)} is {lower_width}x{lower_height}, expected {RADAR_SIZE}x{RADAR_SIZE}"
                )
    if missing or invalid:
        detail = []
        if missing:
            detail.append(f"missing map assets: {missing}")
        if invalid:
            detail.append(f"invalid map asset dimensions: {invalid}")
        raise AssertionError("; ".join(detail))


def world_to_radar(x: float, y: float, calibration: Calibration) -> tuple[float, float]:
    return ((x - calibration.pos_x) / calibration.scale, (calibration.pos_y - y) / calibration.scale)


def radar_layer_for_z(z: float, sections: list[VerticalSection] | None) -> str | None:
    if not sections or not math.isfinite(z):
        return None
    for section in sections:
        if z >= section.altitude_min and z < section.altitude_max:
            return section.layer
    return "default"


def record_radar_layer(target: dict[str, int], z: float, sections: list[VerticalSection] | None) -> None:
    layer = radar_layer_for_z(z, sections)
    if layer is not None:
        target[layer] = target.get(layer, 0) + 1


def in_crop(point: tuple[float, float], crop: Crop, margin: float) -> bool:
    x, y = point
    return (
        crop.x - margin <= x <= crop.x + crop.size + margin
        and crop.y - margin <= y <= crop.y + crop.size + margin
    )


def projectile_effect_type(projectile_type: str) -> str | None:
    value = projectile_type.lower()
    if "smoke" in value:
        return "smoke"
    if "molotov" in value or "incendiary" in value or "incgrenade" in value or "inferno" in value:
        return "fire"
    if "decoy" in value:
        return "decoy"
    if "flash" in value:
        return "flash"
    if value.startswith("he") or "hegrenade" in value or "he grenade" in value or "high explosive" in value:
        return "he"
    return None


def normalize_thrower(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, float):
        return int(value) if math.isfinite(value) and value > 0 and value.is_integer() else None
    if isinstance(value, str) and value.isdigit():
        parsed = int(value)
        return parsed if parsed > 0 else None
    return None


def effect_radius(effect_type: str) -> float:
    if effect_type in {"fire", "smoke"}:
        return 900
    if effect_type == "decoy":
        return 700
    return 520


def condensed_effect_radius(effect_type: str) -> float:
    if effect_type == "he":
        return 1500
    if effect_type == "flash":
        return 1100
    return 950


def projectile_frames(round_obj: dict[str, Any]) -> list[dict[str, Any]]:
    frames = round_obj.get("projectileFrames") or []
    if frames:
        return frames
    return round_obj.get("frames") or []


def build_tracks(round_obj: dict[str, Any], stats: AuditStats, calibration: Calibration, crop: Crop) -> dict[int, Track]:
    tracks: dict[int, Track] = {}
    frames = projectile_frames(round_obj)
    for index, frame in enumerate(frames):
        for projectile in frame.get("projectiles") or []:
            stats.projectiles += 1
            values = [projectile.get("x"), projectile.get("y"), projectile.get("z")]
            if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in values):
                stats.invalid_projectiles += 1
                continue
            radar = world_to_radar(float(projectile["x"]), float(projectile["y"]), calibration)
            if not in_crop(radar, crop, 90):
                stats.projectiles_out += 1
            projectile_id = int(projectile["id"])
            thrower = normalize_thrower(projectile.get("thrower"))
            track = tracks.get(projectile_id)
            if track is None:
                track = Track(
                    projectile_id=projectile_id,
                    projectile_type=str(projectile.get("type") or ""),
                    thrower=thrower,
                )
                tracks[projectile_id] = track
            elif thrower is not None:
                if track.thrower is None:
                    track.thrower = thrower
                elif track.thrower != thrower:
                    track.thrower_conflict = True
            track.samples.append(projectile | {"t": frame.get("t", 0)})

        if index + 1 < len(frames):
            current_ids = {projectile.get("id") for projectile in frame.get("projectiles") or []}
            next_frame = frames[index + 1]
            if float(next_frame.get("t", 0)) - float(frame.get("t", 0)) <= 0.2:
                for projectile in next_frame.get("projectiles") or []:
                    if projectile.get("id") not in current_ids:
                        stats.future_only_windows += 1

    for track in tracks.values():
        if projectile_effect_type(track.projectile_type) is not None:
            stats.utility_tracks += 1
            if track.thrower is None:
                stats.utility_tracks_missing_thrower += 1
                if len(stats.examples) < 20:
                    stats.examples.append(
                        {
                            "round": round_obj.get("number"),
                            "kind": "utility-track-missing-thrower",
                            "projectileId": track.projectile_id,
                            "type": track.projectile_type,
                            "samples": len(track.samples),
                        }
                    )
            if track.thrower_conflict:
                stats.projectile_thrower_conflicts += 1
                if len(stats.examples) < 20:
                    stats.examples.append(
                        {
                            "round": round_obj.get("number"),
                            "kind": "projectile-thrower-conflict",
                            "projectileId": track.projectile_id,
                            "type": track.projectile_type,
                        }
                    )
        if len(track.samples) < 2:
            stats.short_tracks += 1
    return tracks


def audit_positions(
    round_obj: dict[str, Any],
    stats: AuditStats,
    calibration: Calibration,
    crop: Crop,
    vertical_sections: list[VerticalSection] | None,
) -> None:
    saw_start_players = False
    for frame in round_obj.get("frames") or []:
        players = frame.get("players") or []
        if players and not saw_start_players:
            saw_start_players = True
            for player in players:
                stats.start_players += 1
                record_radar_layer(stats.start_radar_layers, float(player["z"]), vertical_sections)
                radar = world_to_radar(float(player["x"]), float(player["y"]), calibration)
                if not in_crop(radar, crop, 40):
                    stats.start_players_out += 1
                    if len(stats.examples) < 20:
                        stats.examples.append(
                            {
                                "round": round_obj.get("number"),
                                "kind": "start-player-outside-crop",
                                "steam64": player.get("steam64"),
                                "side": player.get("side") or player.get("team"),
                                "x": round(float(player["x"])),
                                "y": round(float(player["y"])),
                                "radarX": round(radar[0], 1),
                                "radarY": round(radar[1], 1),
                            }
                        )
        for player in players:
            stats.players += 1
            record_radar_layer(stats.radar_layers, float(player["z"]), vertical_sections)
            radar = world_to_radar(float(player["x"]), float(player["y"]), calibration)
            if not in_crop(radar, crop, 40):
                stats.players_out += 1
            stats.min_x = min(stats.min_x, radar[0])
            stats.min_y = min(stats.min_y, radar[1])
            stats.max_x = max(stats.max_x, radar[0])
            stats.max_y = max(stats.max_y, radar[1])
    if not saw_start_players:
        stats.rounds_without_start_players += 1


def audit_effects(
    round_obj: dict[str, Any],
    stats: AuditStats,
    tracks: dict[int, Track],
    calibration: Calibration,
    crop: Crop,
) -> None:
    for effect in round_obj.get("effects") or []:
        effect_type = effect.get("type")
        if effect_type not in {"smoke", "flash", "he", "fire", "decoy"}:
            continue
        stats.effects += 1
        radar = world_to_radar(float(effect["x"]), float(effect["y"]), calibration)
        if not in_crop(radar, crop, 40):
            stats.effects_out += 1
        stats.min_x = min(stats.min_x, radar[0])
        stats.min_y = min(stats.min_y, radar[1])
        stats.max_x = max(stats.max_x, radar[0])
        stats.max_y = max(stats.max_y, radar[1])

        threshold2 = effect_radius(effect_type) ** 2
        condensed_threshold2 = condensed_effect_radius(effect_type) ** 2
        best_distance2 = math.inf
        best_gap = math.inf
        best_track: Track | None = None
        matched_with_thrower = False
        condensed_best_distance2 = math.inf
        condensed_throwers: set[int] = set()
        effect_start = float(effect["start"])
        for track in tracks.values():
            if projectile_effect_type(track.projectile_type) != effect_type:
                continue
            for sample in track.samples:
                sample_t = float(sample["t"])
                if sample_t < effect_start - 1.65 or sample_t > effect_start + 0.25:
                    continue
                dx = float(sample["x"]) - float(effect["x"])
                dy = float(sample["y"]) - float(effect["y"])
                distance2 = dx * dx + dy * dy
                if distance2 < best_distance2:
                    best_distance2 = distance2
                    best_gap = abs(sample_t - effect_start)
                    best_track = track
                if distance2 <= threshold2 and track.thrower is not None and not track.thrower_conflict:
                    matched_with_thrower = True
                if (
                    len(track.samples) >= 2
                    and distance2 <= condensed_threshold2
                    and track.thrower is not None
                    and not track.thrower_conflict
                ):
                    if distance2 < condensed_best_distance2:
                        condensed_best_distance2 = distance2
                        condensed_throwers = {track.thrower}
                    elif distance2 == condensed_best_distance2:
                        condensed_throwers.add(track.thrower)

        if best_distance2 <= threshold2:
            stats.matched_effects += 1
            if len(condensed_throwers) == 1:
                stats.condensed_effects_unique_thrower += 1
            elif not condensed_throwers:
                stats.condensed_effects_unassigned += 1
                if len(stats.examples) < 20:
                    stats.examples.append(
                        {
                            "round": round_obj.get("number"),
                            "kind": "condensed-effect-unassigned",
                            "type": effect_type,
                            "start": round(effect_start, 3),
                            "x": round(float(effect["x"])),
                            "y": round(float(effect["y"])),
                            "nearestDistance": round(math.sqrt(best_distance2)),
                            "nearestGap": None if math.isinf(best_gap) else round(best_gap, 3),
                        }
                    )
            else:
                stats.condensed_effects_ambiguous += 1
                if len(stats.examples) < 20:
                    stats.examples.append(
                        {
                            "round": round_obj.get("number"),
                            "kind": "condensed-effect-ambiguous",
                            "type": effect_type,
                            "start": round(effect_start, 3),
                            "throwers": sorted(condensed_throwers),
                            "distance": round(math.sqrt(condensed_best_distance2)),
                            "x": round(float(effect["x"])),
                            "y": round(float(effect["y"])),
                        }
                    )
            if not matched_with_thrower:
                stats.matched_effects_without_thrower += 1
                if len(stats.examples) < 20:
                    stats.examples.append(
                        {
                            "round": round_obj.get("number"),
                            "kind": "matched-effect-without-thrower",
                            "type": effect_type,
                            "start": round(effect_start, 3),
                            "x": round(float(effect["x"])),
                            "y": round(float(effect["y"])),
                            "nearestDistance": round(math.sqrt(best_distance2)),
                            "nearestGap": None if math.isinf(best_gap) else round(best_gap, 3),
                        }
                    )
        else:
            stats.unmatched_effects += 1
            if len(stats.examples) < 20:
                stats.examples.append(
                    {
                        "round": round_obj.get("number"),
                        "kind": "unmatched-effect",
                        "type": effect_type,
                        "start": round(effect_start, 3),
                        "x": round(float(effect["x"])),
                        "y": round(float(effect["y"])),
                        "nearestDistance": None if math.isinf(best_distance2) else round(math.sqrt(best_distance2)),
                        "nearestGap": None if math.isinf(best_gap) else round(best_gap, 3),
                    }
                )

        if not math.isinf(best_gap):
            stats.max_effect_gap = max(stats.max_effect_gap, best_gap)
            if best_gap > 0.8:
                stats.large_effect_gaps += 1

        if best_track is not None:
            for track in tracks.values():
                if track is best_track or projectile_effect_type(track.projectile_type) != effect_type:
                    continue
                later = any(
                    effect_start + 0.25 < float(sample["t"]) < float(effect["end"])
                    and (float(sample["x"]) - float(effect["x"])) ** 2
                    + (float(sample["y"]) - float(effect["y"])) ** 2
                    <= threshold2
                    for sample in track.samples
                )
                near_start = any(
                    effect_start - 0.45 <= float(sample["t"]) <= effect_start + 0.18
                    for sample in track.samples
                )
                if later and not near_start:
                    stats.active_effect_suppression_risks += 1
                    break


def audit_match_rounds(
    label: str,
    map_name: str,
    rounds: list[dict[str, Any]],
    calibrations: dict[str, Calibration],
    crops: dict[str, Crop],
    vertical_sections: dict[str, list[VerticalSection]],
    source: str,
) -> AuditStats:
    calibration = calibrations.get(map_name)
    if calibration is None:
        raise AssertionError(f"{label} references unsupported map {map_name!r}")
    crop = crops.get(map_name, Crop(0, 0, RADAR_SIZE))
    stats = AuditStats(label=label, map_name=map_name, source=source)
    if not rounds:
        raise AssertionError(f"{label} has no rounds")
    for round_obj in rounds:
        stats.rounds += 1
        audit_positions(round_obj, stats, calibration, crop, vertical_sections.get(map_name))
        tracks = build_tracks(round_obj, stats, calibration, crop)
        audit_effects(round_obj, stats, tracks, calibration, crop)
    return stats


def audit_split_fixture(
    manifest_path: Path,
    round_dir: Path,
    calibrations: dict[str, Calibration],
    crops: dict[str, Crop],
    vertical_sections: dict[str, list[VerticalSection]],
) -> AuditStats:
    manifest = load_json_gz(manifest_path)
    map_name = str(manifest.get("meta", {}).get("map") or "")
    round_paths = sorted(round_dir.glob("round-*.json.gz"))
    if not round_paths:
        raise AssertionError(f"{round_dir} has no round-*.json.gz files")
    rounds = [load_json_gz(path) for path in round_paths]
    return audit_match_rounds(round_dir.name, map_name, rounds, calibrations, crops, vertical_sections, source="fixture")


def audit_full_match(
    match_path: Path,
    calibrations: dict[str, Calibration],
    crops: dict[str, Crop],
    vertical_sections: dict[str, list[VerticalSection]],
) -> AuditStats:
    data = load_json_gz(match_path)
    map_name = str(data.get("meta", {}).get("map") or "")
    rounds = data.get("rounds") or []
    if not isinstance(rounds, list):
        raise AssertionError(f"{match_path} rounds is not a list")
    return audit_match_rounds(match_path.name, map_name, rounds, calibrations, crops, vertical_sections, source="parsed")


def discover_split_fixtures(compare_dir: Path) -> list[tuple[Path, Path]]:
    fixtures: list[tuple[Path, Path]] = []
    if not compare_dir.exists():
        return fixtures
    for manifest_path in sorted(compare_dir.glob("*.json.gz")):
        round_dir = manifest_path.with_suffix("").with_suffix("")
        if round_dir.is_dir() and any(round_dir.glob("round-*.json.gz")):
            fixtures.append((manifest_path, round_dir))
    return fixtures


def discover_full_matches(parsed_dir: Path) -> list[Path]:
    if not parsed_dir.exists():
        return []
    return sorted(parsed_dir.glob("*.json.gz"))


def audit_all(
    compare_dir: Path,
    parsed_dir: Path | None,
    calibrations: dict[str, Calibration],
    crops: dict[str, Crop],
    vertical_sections: dict[str, list[VerticalSection]],
) -> list[AuditStats]:
    all_stats = [
        audit_split_fixture(manifest_path, round_dir, calibrations, crops, vertical_sections)
        for manifest_path, round_dir in discover_split_fixtures(compare_dir)
    ]
    if parsed_dir is not None:
        all_stats.extend(
            audit_full_match(match_path, calibrations, crops, vertical_sections)
            for match_path in discover_full_matches(parsed_dir)
        )
    return all_stats


def assert_stats(
    stats: AuditStats,
    *,
    max_out_pct: float,
    vertical_sections: dict[str, list[VerticalSection]],
) -> None:
    errors: list[str] = []
    if stats.source == "fixture" and (stats.effects == 0 or stats.utility_tracks == 0):
        errors.append("fixture has no utility effect/projectile signal, so it does not prove replay utility rendering")
    if stats.rounds_without_start_players:
        errors.append(f"{stats.rounds_without_start_players} rounds have no player positions in their first populated frame")
    if stats.start_players_out:
        errors.append(f"{stats.start_players_out} start-frame player positions are outside map crop")
    if stats.invalid_projectiles:
        errors.append(f"{stats.invalid_projectiles} projectile samples have invalid coordinates")
    if stats.utility_tracks_missing_thrower:
        errors.append(f"{stats.utility_tracks_missing_thrower} utility projectile tracks have no thrower")
    if stats.projectile_thrower_conflicts:
        errors.append(f"{stats.projectile_thrower_conflicts} projectile tracks have conflicting throwers")
    if stats.matched_effects_without_thrower:
        errors.append(f"{stats.matched_effects_without_thrower} matched effects have no player-owned projectile track")
    if stats.condensed_effects_unassigned:
        errors.append(f"{stats.condensed_effects_unassigned} matched effects cannot be assigned to a condensed player replay")
    if stats.condensed_effects_ambiguous:
        errors.append(f"{stats.condensed_effects_ambiguous} matched effects have tied best condensed player tracks")
    if stats.unmatched_effects:
        errors.append(f"{stats.unmatched_effects} effects have no matching projectile track")
    if stats.pct(stats.players_out, stats.players) > max_out_pct:
        errors.append(f"{stats.pct(stats.players_out, stats.players)}% players outside map crop")
    if stats.pct(stats.effects_out, stats.effects) > max_out_pct:
        errors.append(f"{stats.pct(stats.effects_out, stats.effects)}% effects outside map crop")
    if stats.pct(stats.projectiles_out, stats.projectiles) > max_out_pct:
        errors.append(f"{stats.pct(stats.projectiles_out, stats.projectiles)}% projectiles outside map crop")
    sections = vertical_sections.get(stats.map_name)
    if stats.source == "fixture" and sections:
        missing_layers = sorted({section.layer for section in sections} - set(stats.radar_layers))
        if missing_layers:
            errors.append(
                f"multi-level fixture does not prove radar layers {missing_layers}; "
                f"observed={dict(sorted(stats.radar_layers.items()))}"
            )
    if errors:
        raise AssertionError(f"{stats.label} failed replay rendering audit: {'; '.join(errors)}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--compare-dir", type=Path, default=DEFAULT_COMPARE_DIR)
    parser.add_argument("--parsed-dir", type=Path, default=DEFAULT_PARSED_DIR)
    parser.add_argument("--public-dir", type=Path, default=DEFAULT_PUBLIC_DIR)
    parser.add_argument("--skip-parsed", action="store_true", help="Only audit .roundlab-compare split fixtures")
    parser.add_argument("--assets-only", action="store_true", help="Only validate map calibrations and committed radar assets")
    parser.add_argument("--require-all-map-fixtures", action="store_true", help="Fail if any calibrated map has no local replay fixture")
    parser.add_argument("--max-out-pct", type=float, default=0.1)
    parser.add_argument("--json", action="store_true", help="Print newline-delimited JSON summaries")
    args = parser.parse_args()

    calibrations, crops = load_maps()
    vertical_sections = load_vertical_sections()
    assert_map_assets(calibrations, args.public_dir)
    if args.assets_only:
        if not args.json:
            print(f"OK map assets and calibrations for {len(calibrations)} maps")
        return
    parsed_dir = None if args.skip_parsed else args.parsed_dir
    all_stats = audit_all(args.compare_dir, parsed_dir, calibrations, crops, vertical_sections)
    if not all_stats:
        locations = [str(args.compare_dir)]
        if parsed_dir is not None:
            locations.append(str(parsed_dir))
        raise AssertionError(f"no replay audit fixtures found in {', '.join(locations)}")

    fixture_maps = {stats.map_name for stats in all_stats if stats.source == "fixture"}
    missing_fixture_maps = sorted(set(calibrations) - fixture_maps)
    if args.require_all_map_fixtures and missing_fixture_maps:
        raise AssertionError(f"missing replay fixtures for calibrated maps: {missing_fixture_maps}")

    for stats in all_stats:
        assert_stats(stats, max_out_pct=args.max_out_pct, vertical_sections=vertical_sections)
        if args.json:
            print(json.dumps(stats.as_dict(), sort_keys=True))
        else:
            has_utility_signal = stats.effects > 0 and stats.utility_tracks > 0
            status = "OK" if has_utility_signal else "WEAK"
            print(
                f"{status} {stats.label} source={stats.source} map={stats.map_name} rounds={stats.rounds} "
                f"startOut={stats.start_players_out}/{stats.start_players} "
                f"effects={stats.effects} matched={stats.matched_effects} "
                f"condensedUnique={stats.condensed_effects_unique_thrower} "
                f"condensedAmbiguous={stats.condensed_effects_ambiguous} "
                f"utilityTracks={stats.utility_tracks} unownedUtilityTracks={stats.utility_tracks_missing_thrower} "
                f"futureOnly={stats.future_only_windows} suppressionRisks={stats.active_effect_suppression_risks} "
                f"layers={dict(sorted(stats.radar_layers.items())) or '{}'} "
                f"bounds={stats.as_dict()['radarBounds']}"
            )
    if missing_fixture_maps and not args.json:
        print(f"WARN missing replay fixtures for maps: {', '.join(missing_fixture_maps)}")


if __name__ == "__main__":
    main()
