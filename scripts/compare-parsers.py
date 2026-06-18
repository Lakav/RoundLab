#!/usr/bin/env python3
"""Compare the archived Go parser with the current Rust parser.

This is a local validation/profiling harness. It never wires Go back into the
product; the archived Go source and outputs live in ignored local directories.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
GO_COMMIT = "35c238c"
GO_DIR = ROOT / ".roundlab-go-parser"
GO_BIN = GO_DIR / "parser-go"
RUST_BIN = ROOT / "parser" / "target" / "release" / "roundlab-parser"
REPORT_DIR = ROOT / ".roundlab-compare"
BOMB_EVENTS = {
    "bomb_planted",
    "bomb_defuse_start",
    "bomb_defuse_abort",
    "bomb_defused",
    "bomb_exploded",
}
EVENT_TYPES_TO_AUDIT = {
    "kill",
    "bomb_planted",
    "bomb_defuse_start",
    "bomb_defuse_abort",
    "bomb_defused",
    "bomb_exploded",
    "round_end",
}
GRENADE_FIRE_WEAPONS = {"decoy", "flashbang", "hegrenade", "incendiary", "molotov", "smokegrenade"}


def run_checked(cmd: list[str], cwd: Path = ROOT) -> None:
    subprocess.run(cmd, cwd=cwd, check=True)


def ensure_local_excludes() -> None:
    exclude = ROOT / ".git" / "info" / "exclude"
    existing = exclude.read_text() if exclude.exists() else ""
    wanted = [".roundlab-go-parser/", ".roundlab-compare/"]
    missing = [line for line in wanted if line not in existing.splitlines()]
    if missing:
        with exclude.open("a", encoding="utf-8") as f:
            for line in missing:
                f.write(f"{line}\n")


def prepare_go_parser() -> None:
    ensure_local_excludes()
    if GO_DIR.exists():
        shutil.rmtree(GO_DIR)
    GO_DIR.mkdir(parents=True)
    archive = subprocess.Popen(
        ["git", "archive", GO_COMMIT, "parser"],
        cwd=ROOT,
        stdout=subprocess.PIPE,
    )
    assert archive.stdout is not None
    extract = subprocess.run(
        ["tar", "-x", "-C", str(GO_DIR), "--strip-components=1"],
        stdin=archive.stdout,
        cwd=ROOT,
        check=True,
    )
    archive.stdout.close()
    if archive.wait() != 0 or extract.returncode != 0:
        raise SystemExit("failed to extract archived Go parser")
    run_checked(["go", "build", "-mod=vendor", "-o", str(GO_BIN), "."], cwd=GO_DIR)


def build_rust_parser() -> None:
    run_checked(["cargo", "build", "--release"], cwd=ROOT / "parser")


def read_gzip_json(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def output_disk_bytes(path: Path) -> int:
    total = path.stat().st_size if path.exists() else 0
    rounds_dir = path.with_suffix("").with_suffix("")
    if rounds_dir.is_dir():
        total += sum(p.stat().st_size for p in rounds_dir.rglob("*") if p.is_file())
    return total


def iter_round_payloads(output_path: Path, manifest: dict[str, Any]):
    base = output_path.parent
    for round_obj in manifest.get("rounds", []):
        round_file = round_obj.get("roundFile")
        if round_file:
            yield read_gzip_json(base / round_file)
        else:
            yield round_obj


def collect_metrics(output_path: Path) -> dict[str, Any]:
    manifest = read_gzip_json(output_path)
    effect_counts: dict[str, int] = {}
    metrics: dict[str, Any] = {
        "map": manifest.get("meta", {}).get("map", ""),
        "scoreA": manifest.get("meta", {}).get("scoreA", 0),
        "scoreB": manifest.get("meta", {}).get("scoreB", 0),
        "rounds": len(manifest.get("rounds", [])),
        "players": len(manifest.get("players", [])),
        "frames": 0,
        "framePlayers": 0,
        "framesWithBombState": 0,
        "events": 0,
        "kills": 0,
        "bombEvents": 0,
        "effects": 0,
        "weaponFires": 0,
        "projectileFrames": 0,
        "projectileSamples": 0,
        "outputBytes": output_disk_bytes(output_path),
        "effectCounts": effect_counts,
    }
    for round_obj in iter_round_payloads(output_path, manifest):
        frames = round_obj.get("frames", [])
        events = round_obj.get("events", [])
        effects = round_obj.get("effects", [])
        weapon_fires = round_obj.get("weaponFires", [])
        projectile_frames = round_obj.get("projectileFrames", [])
        metrics["frames"] += len(frames)
        metrics["events"] += len(events)
        metrics["effects"] += len(effects)
        metrics["weaponFires"] += len(weapon_fires)
        metrics["projectileFrames"] += len(projectile_frames)
        for effect in effects:
            kind = effect.get("type", "")
            effect_counts[kind] = effect_counts.get(kind, 0) + 1
        for frame in frames:
            players = frame.get("players", [])
            metrics["framePlayers"] += len(players)
            if frame.get("bomb") is not None:
                metrics["framesWithBombState"] += 1
            for projectile in frame.get("projectiles", []) or []:
                metrics["projectileSamples"] += 1
        for projectile_frame in projectile_frames:
            metrics["projectileSamples"] += len(projectile_frame.get("projectiles", []))
        for event in events:
            kind = event.get("type", "")
            if kind == "kill":
                metrics["kills"] += 1
            elif kind in BOMB_EVENTS:
                metrics["bombEvents"] += 1
    return metrics


def load_round_payloads(output_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = read_gzip_json(output_path)
    return manifest, list(iter_round_payloads(output_path, manifest))


def bucket_time(value: Any, precision: float = 0.25) -> float:
    if not isinstance(value, (int, float)):
        return 0.0
    return round(round(float(value) / precision) * precision, 3)


def effect_signature(effect: dict[str, Any]) -> dict[str, Any]:
    kind = effect.get("type", "")
    return {
        "t": bucket_time(effect.get("start"), 0.25),
        "type": kind,
        "variant": None if kind == "fire" else effect.get("variant"),
        "team": None if kind == "bomb_planted" else effect.get("team"),
        "x": round(float(effect.get("x", 0.0)) / 50.0) * 50,
        "y": round(float(effect.get("y", 0.0)) / 50.0) * 50,
    }


def effect_summary(effect: dict[str, Any]) -> dict[str, Any]:
    kind = effect.get("type", "")
    return {
        "t": float(effect.get("start", 0.0) or 0.0),
        "type": kind,
        "variant": None if kind == "fire" else effect.get("variant"),
        "team": None if kind == "bomb_planted" else effect.get("team"),
        "x": float(effect.get("x", 0.0) or 0.0),
        "y": float(effect.get("y", 0.0) or 0.0),
        "z": float(effect.get("z", 0.0) or 0.0),
    }


def effect_sample(effect: dict[str, Any]) -> dict[str, Any]:
    return {
        **effect,
        "tRaw": round(effect["t"], 3),
        "t": bucket_time(effect["t"], 0.25),
        "x": round(effect["x"] / 50.0) * 50,
        "y": round(effect["y"] / 50.0) * 50,
    }


def bomb_event_summary(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for event in events:
        kind = event.get("type", "")
        if kind not in BOMB_EVENTS:
            continue
        out.append(
            {
                "t": float(event.get("t", 0.0) or 0.0),
                "type": kind,
                "player": event.get("player"),
            }
        )
    return sorted(out, key=lambda item: (item["type"], str(item["player"]), item["t"]))


def bomb_event_sample(event: dict[str, Any]) -> dict[str, Any]:
    return {
        **event,
        "tRaw": round(event["t"], 3),
        "t": bucket_time(event["t"], 0.25),
    }


def bucket_yaw(value: Any, precision: float = 15.0) -> float:
    if not isinstance(value, (int, float)):
        return 0.0
    yaw = float(value) % 360.0
    return round(round(yaw / precision) * precision, 3) % 360.0


def dedupe_flash_effect_signatures(signatures: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen_flash = set()
    out = []
    for signature in signatures:
        if signature.get("type") != "flash":
            out.append(signature)
            continue
        key = (
            signature.get("t"),
            signature.get("team"),
            signature.get("x"),
            signature.get("y"),
        )
        if key in seen_flash:
            continue
        seen_flash.add(key)
        out.append(signature)
    return out


def dedupe_near_duplicate_flash_effects(effects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for effect in effects:
        if effect.get("type") != "flash":
            out.append(effect)
            continue
        start = effect.get("start")
        team = effect.get("team")
        x = float(effect.get("x", 0.0))
        y = float(effect.get("y", 0.0))
        z = float(effect.get("z", 0.0))
        duplicate = False
        for existing in out:
            if existing.get("type") != "flash" or existing.get("team") != team:
                continue
            existing_start = existing.get("start")
            if not isinstance(start, (int, float)) or not isinstance(existing_start, (int, float)):
                continue
            if abs(float(start) - float(existing_start)) > 0.001:
                continue
            dx = x - float(existing.get("x", 0.0))
            dy = y - float(existing.get("y", 0.0))
            dz = z - float(existing.get("z", 0.0))
            if dx * dx + dy * dy + dz * dz <= 1.0:
                duplicate = True
                break
        if not duplicate:
            out.append(effect)
    return out


def normalize_weapon(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    raw = value.strip().lower()
    raw = raw.removeprefix("weapon_")
    normalized = re.sub(r"[^a-z0-9]+", "", raw)
    if normalized in {"glock18"}:
        return "glock"
    if normalized in {"usps", "uspsilencer"}:
        return "usp"
    if normalized in {"hkp2000"}:
        return "p2000"
    if normalized in {"deserteagle"}:
        return "deagle"
    if normalized in {"elite"}:
        return "dualberettas"
    if normalized in {"m4a1", "m4a1silencer", "m4a4"}:
        return "m4"
    if normalized in {"decoygrenade"}:
        return "decoy"
    if normalized in {"plantedc4"}:
        return "c4"
    if normalized in {"incgrenade", "incendiarygrenade"}:
        return "incendiary"
    if normalized.startswith("knife") or normalized in {"bayonet", "karambit"}:
        return "knife"
    return normalized


def normalize_kill_weapon(value: Any) -> str:
    normalized = normalize_weapon(value)
    if normalized in {"inferno", "incendiary", "molotov"}:
        return "fire"
    return normalized


def normalize_projectile_type(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    raw = value.strip().lower()
    if "smoke" in raw:
        return "smoke"
    if "flash" in raw:
        return "flash"
    if "molotov" in raw or "incendiary" in raw or "inferno" in raw:
        return "fire"
    if "hegrenade" in raw or raw in {"he", "he grenade"}:
        return "he"
    if "decoy" in raw:
        return "decoy"
    return re.sub(r"[^a-z0-9]+", "", raw)


def round_audit_summary(round_obj: dict[str, Any]) -> dict[str, Any]:
    event_counts: dict[str, int] = {}
    kill_signatures = []
    bomb_signatures = []
    for event in round_obj.get("events", []):
        kind = event.get("type", "")
        event_counts[kind] = event_counts.get(kind, 0) + 1
        if kind == "kill":
            kill_signatures.append(
                {
                    "t": bucket_time(event.get("t"), 0.25),
                    "killer": event.get("killer"),
                    "victim": event.get("victim"),
                    "assist": event.get("assist"),
                    "weapon": normalize_kill_weapon(event.get("weapon")),
                    "hs": bool(event.get("hs", False)),
                }
            )
        elif kind in BOMB_EVENTS:
            bomb_signatures.append(
                {
                    "t": bucket_time(event.get("t"), 0.25),
                    "type": kind,
                    "player": event.get("player"),
                }
            )

    effect_counts: dict[str, int] = {}
    effect_signatures = []
    effects = round_obj.get("effects", [])
    for effect in effects:
        kind = effect.get("type", "")
        effect_counts[kind] = effect_counts.get(kind, 0) + 1
        effect_signatures.append(effect_signature(effect))
    deduped_effect_signatures = [
        effect_signature(effect) for effect in dedupe_near_duplicate_flash_effects(effects)
    ]
    deduped_effect_signatures = dedupe_flash_effect_signatures(deduped_effect_signatures)
    deduped_effect_counts: dict[str, int] = {}
    for signature in deduped_effect_signatures:
        kind = signature.get("type", "")
        deduped_effect_counts[kind] = deduped_effect_counts.get(kind, 0) + 1

    fire_counts_by_weapon: dict[str, int] = {}
    fire_signatures = []
    for fire in round_obj.get("weaponFires", []):
        weapon = normalize_weapon(fire.get("weapon"))
        fire_counts_by_weapon[weapon] = fire_counts_by_weapon.get(weapon, 0) + 1
        fire_signatures.append(
            {
                "t": bucket_time(fire.get("t"), 0.25),
                "shooter": fire.get("shooter"),
                "weapon": weapon,
                "team": fire.get("team"),
            }
        )

    projectile_type_counts: dict[str, int] = {}
    projectile_samples = 0
    projectile_frames = round_obj.get("projectileFrames", [])
    projectile_signatures = []
    for projectile_frame in projectile_frames:
        frame_t = projectile_frame.get("t")
        for projectile in projectile_frame.get("projectiles", []):
            projectile_samples += 1
            kind = normalize_projectile_type(projectile.get("type"))
            projectile_type_counts[kind] = projectile_type_counts.get(kind, 0) + 1
            projectile_signatures.append(
                {
                    "t": bucket_time(frame_t, 0.25),
                    "type": kind,
                    "thrower": projectile.get("thrower"),
                }
            )

    bomb_state_counts: dict[str, int] = {}
    frames = round_obj.get("frames", [])
    frames_with_players = 0
    frames_with_bomb_state = 0
    players_with_weapons = 0
    embedded_projectile_frames = 0
    for frame in frames:
        players = frame.get("players", [])
        if players:
            frames_with_players += 1
        for player in players:
            if player.get("active") or player.get("weapons"):
                players_with_weapons += 1
        if frame.get("projectiles"):
            embedded_projectile_frames += 1
        bomb = frame.get("bomb")
        if bomb is not None:
            frames_with_bomb_state += 1
            status = bomb.get("status", "")
            bomb_state_counts[status] = bomb_state_counts.get(status, 0) + 1

    projectile_integrity_summary = projectile_integrity(round_obj)
    return {
        "number": round_obj.get("number"),
        "scoreA": round_obj.get("scoreA"),
        "scoreB": round_obj.get("scoreB"),
        "startTick": round_obj.get("startTick"),
        "endTick": round_obj.get("endTick"),
        "frames": len(frames),
        "framesWithPlayers": frames_with_players,
        "framesWithBombState": frames_with_bomb_state,
        "playersWithWeapons": players_with_weapons,
        "embeddedProjectileFrames": embedded_projectile_frames,
        "bombStateCounts": bomb_state_counts,
        "events": len(round_obj.get("events", [])),
        "eventCounts": event_counts,
        "killSignatures": sorted(kill_signatures, key=lambda item: (item["t"], item["victim"] or 0)),
        "bombSignatures": sorted(bomb_signatures, key=lambda item: (item["t"], item["type"])),
        "effects": len(round_obj.get("effects", [])),
        "dedupedEffects": len(deduped_effect_signatures),
        "effectCounts": effect_counts,
        "dedupedEffectCounts": deduped_effect_counts,
        "effectSignatures": sorted(effect_signatures, key=lambda item: (item["t"], item["type"], item["x"], item["y"])),
        "dedupedEffectSignatures": sorted(
            deduped_effect_signatures,
            key=lambda item: (item["t"], item["type"], item["x"], item["y"]),
        ),
        "weaponFires": len(round_obj.get("weaponFires", [])),
        "fireCountsByWeapon": fire_counts_by_weapon,
        "fireSignatures": sorted(fire_signatures, key=lambda item: (item["t"], item["shooter"] or 0, item["weapon"])),
        "projectileFrames": len(projectile_frames),
        "projectileSamples": projectile_samples,
        "projectileTypeCounts": projectile_type_counts,
        "projectileSignatures": sorted(projectile_signatures, key=lambda item: (item["t"], item["thrower"] or 0, item["type"])),
        **projectile_integrity_summary,
    }


def signature_diff(go_items: list[dict[str, Any]], rust_items: list[dict[str, Any]], limit: int = 10) -> dict[str, Any]:
    go_keys = [json.dumps(item, sort_keys=True, separators=(",", ":")) for item in go_items]
    rust_keys = [json.dumps(item, sort_keys=True, separators=(",", ":")) for item in rust_items]
    go_counts: dict[str, int] = {}
    rust_counts: dict[str, int] = {}
    for key in go_keys:
        go_counts[key] = go_counts.get(key, 0) + 1
    for key in rust_keys:
        rust_counts[key] = rust_counts.get(key, 0) + 1
    missing = []
    extra = []
    for key, count in go_counts.items():
        delta = count - rust_counts.get(key, 0)
        if delta > 0:
            missing.extend([json.loads(key)] * delta)
    for key, count in rust_counts.items():
        delta = count - go_counts.get(key, 0)
        if delta > 0:
            extra.extend([json.loads(key)] * delta)
    return {
        "missingInRustCount": len(missing),
        "extraInRustCount": len(extra),
        "missingInRustSample": missing[:limit],
        "extraInRustSample": extra[:limit],
    }


def fire_pose_summary(fires: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for fire in fires:
        out.append(
            {
                "t": float(fire.get("t", 0.0) or 0.0),
                "shooter": fire.get("shooter"),
                "weapon": normalize_weapon(fire.get("weapon")),
                "team": fire.get("team"),
                "x": float(fire.get("x", 0.0) or 0.0),
                "y": float(fire.get("y", 0.0) or 0.0),
                "z": float(fire.get("z", 0.0) or 0.0),
                "yaw": float(fire.get("yaw", 0.0) or 0.0),
            }
        )
    return out


def yaw_delta(left: float, right: float) -> float:
    delta = abs((left - right) % 360.0)
    return min(delta, 360.0 - delta)


def fire_pose_sample(item: dict[str, Any]) -> dict[str, Any]:
    return {
        **item,
        "tRaw": round(item["t"], 3),
        "t": bucket_time(item["t"], 0.25),
        "x": round(item["x"] / 50.0) * 50,
        "y": round(item["y"] / 50.0) * 50,
        "yaw": bucket_yaw(item["yaw"], 15.0),
    }


def actor_matches(left: Any, right: Any) -> bool:
    return str(left or "") == str(right or "")


def has_adjacent_same_shooter_fire(
    fire: dict[str, Any],
    counterpart_round: dict[str, Any] | None,
    tolerance: float = 0.12,
) -> bool:
    if not counterpart_round:
        return False
    weapon = normalize_weapon(fire.get("weapon"))
    if weapon in GRENADE_FIRE_WEAPONS:
        return False
    shooter = fire.get("shooter")
    fire_t = float(fire.get("t", 0.0) or 0.0)
    for other in fire_pose_summary(counterpart_round.get("weaponFires", [])):
        if other.get("shooter") != shooter or normalize_weapon(other.get("weapon")) != weapon:
            continue
        delta = abs(float(other.get("t", 0.0) or 0.0) - fire_t)
        if 0.0 < delta <= tolerance:
            return True
    return False


def classify_fire_mismatch(
    fire: dict[str, Any],
    round_obj: dict[str, Any],
    counterpart_round: dict[str, Any] | None = None,
) -> str:
    weapon = normalize_weapon(fire.get("weapon"))
    if weapon in GRENADE_FIRE_WEAPONS:
        return "grenade_weapon_fire"

    fire_t = float(fire.get("t", 0.0) or 0.0)
    shooter = fire.get("shooter")
    for event in round_obj.get("events", []):
        if event.get("type") != "kill":
            continue
        event_t = event.get("t")
        if not isinstance(event_t, (int, float)) or abs(float(event_t) - fire_t) > 0.75:
            continue
        if actor_matches(shooter, event.get("killer")) or actor_matches(shooter, event.get("victim")):
            return "near_related_kill"

    if has_adjacent_same_shooter_fire(fire, counterpart_round):
        return "adjacent_same_shooter_burst_gap"

    end_t = round_end_time(round_obj)
    if end_t and abs(fire_t - end_t) <= 0.75:
        return "near_round_end"

    return "unclassified"


def classify_fire_samples(
    items: list[dict[str, Any]],
    round_obj: dict[str, Any],
    limit: int,
    counterpart_round: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    counts: dict[str, int] = {}
    classified = []
    for idx, item in enumerate(items):
        classification = classify_fire_mismatch(item, round_obj, counterpart_round)
        counts[classification] = counts.get(classification, 0) + 1
        if idx < limit:
            classified.append({**fire_pose_sample(item), "classification": classification})
    return classified, counts


def effect_position_delta(left: dict[str, Any], right: dict[str, Any]) -> float:
    dx = left["x"] - right["x"]
    dy = left["y"] - right["y"]
    dz = left["z"] - right["z"]
    return (dx * dx + dy * dy + dz * dz) ** 0.5


def classify_effect_mismatch(go_effect: dict[str, Any], rust_effect: dict[str, Any]) -> str:
    if (
        go_effect["type"] == "decoy"
        and rust_effect["type"] == "decoy"
        and go_effect["team"] == rust_effect["team"]
        and effect_position_delta(go_effect, rust_effect) <= 50.0
        and abs(go_effect["t"] - rust_effect["t"]) <= 0.5
    ):
        return "decoy_stationary_vs_event_timing"
    return "unclassified"


def bomb_event_time_tolerance(kind: str) -> float:
    if kind == "bomb_defuse_abort":
        return 8.0
    if kind == "bomb_exploded":
        return 0.5
    return 0.25


def classify_bomb_event_mismatch(go_event: dict[str, Any], rust_event: dict[str, Any]) -> str:
    if go_event["type"] == "bomb_exploded" and abs(go_event["t"] - rust_event["t"]) <= 0.5:
        return "small_explosion_timing_offset"
    if go_event["type"] == "bomb_defuse_abort" and abs(go_event["t"] - rust_event["t"]) <= 8.0:
        return "synthesized_defuse_abort_timing"
    return "unclassified"


def compare_bomb_events(go_round: dict[str, Any], rust_round: dict[str, Any], limit: int = 10) -> dict[str, Any]:
    go_events = bomb_event_summary(go_round.get("events", []))
    rust_events = bomb_event_summary(rust_round.get("events", []))
    unmatched_go = set(range(len(go_events)))
    unmatched_rust = set(range(len(rust_events)))
    mismatched = []

    group_keys = sorted(
        {(item["type"], item["player"]) for item in go_events}
        | {(item["type"], item["player"]) for item in rust_events},
        key=lambda item: (item[0], str(item[1])),
    )
    go_groups: dict[tuple[str, Any], list[int]] = {}
    rust_groups: dict[tuple[str, Any], list[int]] = {}
    for idx, item in enumerate(go_events):
        go_groups.setdefault((item["type"], item["player"]), []).append(idx)
    for idx, item in enumerate(rust_events):
        rust_groups.setdefault((item["type"], item["player"]), []).append(idx)

    for key in group_keys:
        go_indexes = go_groups.get(key, [])
        rust_indexes = rust_groups.get(key, [])
        go_pos = 0
        rust_pos = 0
        tolerance = bomb_event_time_tolerance(key[0])
        while go_pos < len(go_indexes) and rust_pos < len(rust_indexes):
            go_idx = go_indexes[go_pos]
            rust_idx = rust_indexes[rust_pos]
            go_event = go_events[go_idx]
            rust_event = rust_events[rust_idx]
            time_delta = rust_event["t"] - go_event["t"]
            if abs(time_delta) <= tolerance:
                unmatched_go.remove(go_idx)
                unmatched_rust.remove(rust_idx)
                if abs(time_delta) > 0.125:
                    classification = classify_bomb_event_mismatch(go_event, rust_event)
                    mismatched.append(
                        {
                            "go": bomb_event_sample(go_event),
                            "rust": bomb_event_sample(rust_event),
                            "timeDelta": round(abs(time_delta), 3),
                            "classification": classification,
                        }
                    )
                go_pos += 1
                rust_pos += 1
            elif time_delta < 0:
                rust_pos += 1
            else:
                go_pos += 1

    missing = [go_events[idx] for idx in sorted(unmatched_go)]
    extra = [rust_events[idx] for idx in sorted(unmatched_rust)]
    classification_counts: dict[str, int] = {}
    for mismatch in mismatched:
        classification = mismatch["classification"]
        classification_counts[classification] = classification_counts.get(classification, 0) + 1
    return {
        "missingInRustCount": len(missing),
        "missingInRustSample": [bomb_event_sample(item) for item in missing[:limit]],
        "extraInRustCount": len(extra),
        "extraInRustSample": [bomb_event_sample(item) for item in extra[:limit]],
        "eventMismatchCount": len(mismatched),
        "eventMismatchClassifications": classification_counts,
        "unclassifiedMismatchCount": classification_counts.get("unclassified", 0),
        "eventMismatchSample": mismatched[:limit],
    }


def bomb_resolution_time(round_obj: dict[str, Any]) -> float:
    times = [
        float(event["t"])
        for event in round_obj.get("events", [])
        if event.get("type") in {"bomb_defused", "bomb_exploded"}
        and isinstance(event.get("t"), (int, float))
    ]
    return min(times) if times else 0.0


def bomb_state_windows(round_obj: dict[str, Any]) -> list[dict[str, Any]]:
    windows = []
    current_status = None
    current_start = None
    current_end = None
    for frame in round_obj.get("frames", []):
        t = frame.get("t")
        if not isinstance(t, (int, float)):
            continue
        bomb = frame.get("bomb")
        status = bomb.get("status") if isinstance(bomb, dict) else None
        if status != current_status:
            if current_status is not None:
                windows.append(
                    {
                        "status": current_status,
                        "start": float(current_start),
                        "end": float(current_end),
                    }
                )
            current_status = status
            current_start = t
        current_end = t
    if current_status is not None:
        windows.append(
            {
                "status": current_status,
                "start": float(current_start),
                "end": float(current_end),
            }
        )
    return windows


def bomb_window_sample(window: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": window["status"],
        "start": round(window["start"], 3),
        "end": round(window["end"], 3),
        "duration": round(window["end"] - window["start"], 3),
    }


def classify_bomb_state_window(
    window: dict[str, Any],
    side: str,
    other_windows: list[dict[str, Any]],
    go_resolution: float,
    rust_resolution: float,
    go_round_end: float,
    rust_round_end: float,
) -> str:
    resolution = go_resolution if side == "go" else rust_resolution
    round_end = go_round_end if side == "go" else rust_round_end
    if (
        side == "go"
        and window["status"] == "dropped"
        and resolution
        and window["start"] >= resolution - 0.25
    ):
        return "go_post_resolution_dropped_residue"
    if side == "go" and round_end and window["start"] >= round_end - 0.25:
        return "go_post_round_bomb_residue"
    if side == "go" and round_end and window["end"] > round_end + 0.25:
        for other in other_windows:
            if other["status"] != window["status"]:
                continue
            if abs(other["start"] - window["start"]) <= 0.05 and abs(other["end"] - rust_round_end) <= 0.05:
                return "go_post_round_bomb_residue"
    if window["end"] - window["start"] <= 0.05:
        return "single_frame_boundary_shift"
    for other in other_windows:
        if other["status"] != window["status"]:
            continue
        overlap = min(window["end"], other["end"]) - max(window["start"], other["start"])
        if overlap >= 0.0 and (
            abs(window["start"] - other["start"]) <= 0.05
            or abs(window["end"] - other["end"]) <= 0.05
        ):
            return "boundary_shift"
    return "unclassified"


def compare_bomb_state_windows(go_round: dict[str, Any], rust_round: dict[str, Any], limit: int = 10) -> dict[str, Any]:
    go_windows = bomb_state_windows(go_round)
    rust_windows = bomb_state_windows(rust_round)
    unmatched_go = set(range(len(go_windows)))
    unmatched_rust = set(range(len(rust_windows)))

    for go_idx, go_window in enumerate(go_windows):
        candidates = []
        for rust_idx in sorted(unmatched_rust):
            rust_window = rust_windows[rust_idx]
            if rust_window["status"] != go_window["status"]:
                continue
            overlap = min(go_window["end"], rust_window["end"]) - max(go_window["start"], rust_window["start"])
            start_delta = abs(go_window["start"] - rust_window["start"])
            end_delta = abs(go_window["end"] - rust_window["end"])
            if overlap >= -0.05 and start_delta <= 0.25 and end_delta <= 0.25:
                candidates.append((start_delta + end_delta, rust_idx))
        if candidates:
            _, rust_idx = min(candidates, key=lambda item: item[0])
            unmatched_go.remove(go_idx)
            unmatched_rust.remove(rust_idx)

    go_resolution = bomb_resolution_time(go_round)
    rust_resolution = bomb_resolution_time(rust_round)
    go_round_end = round_end_time(go_round)
    rust_round_end = round_end_time(rust_round)
    missing = [go_windows[idx] for idx in sorted(unmatched_go)]
    extra = [rust_windows[idx] for idx in sorted(unmatched_rust)]
    missing_samples = []
    extra_samples = []
    classification_counts: dict[str, int] = {}
    for window in missing:
        classification = classify_bomb_state_window(
            window,
            "go",
            rust_windows,
            go_resolution,
            rust_resolution,
            go_round_end,
            rust_round_end,
        )
        classification_counts[classification] = classification_counts.get(classification, 0) + 1
        if len(missing_samples) < limit:
            missing_samples.append({**bomb_window_sample(window), "classification": classification})
    for window in extra:
        classification = classify_bomb_state_window(
            window,
            "rust",
            go_windows,
            go_resolution,
            rust_resolution,
            go_round_end,
            rust_round_end,
        )
        classification_counts[classification] = classification_counts.get(classification, 0) + 1
        if len(extra_samples) < limit:
            extra_samples.append({**bomb_window_sample(window), "classification": classification})
    return {
        "missingInRustCount": len(missing),
        "missingInRustSample": missing_samples,
        "extraInRustCount": len(extra),
        "extraInRustSample": extra_samples,
        "windowMismatchClassifications": classification_counts,
        "unclassifiedMismatchCount": classification_counts.get("unclassified", 0),
    }


def compare_deduped_effects(go_round: dict[str, Any], rust_round: dict[str, Any], limit: int = 10) -> dict[str, Any]:
    go_effects = sorted(
        [effect_summary(effect) for effect in dedupe_near_duplicate_flash_effects(go_round.get("effects", []))],
        key=lambda item: (item["type"], str(item["team"]), item["t"], item["x"], item["y"]),
    )
    rust_effects = sorted(
        [effect_summary(effect) for effect in dedupe_near_duplicate_flash_effects(rust_round.get("effects", []))],
        key=lambda item: (item["type"], str(item["team"]), item["t"], item["x"], item["y"]),
    )
    unmatched_go = set(range(len(go_effects)))
    unmatched_rust = set(range(len(rust_effects)))
    mismatched = []

    for go_idx, go_effect in enumerate(go_effects):
        candidates = []
        for rust_idx in unmatched_rust:
            rust_effect = rust_effects[rust_idx]
            if (
                rust_effect["type"] != go_effect["type"]
                or rust_effect["variant"] != go_effect["variant"]
                or rust_effect["team"] != go_effect["team"]
            ):
                continue
            position_delta = effect_position_delta(go_effect, rust_effect)
            time_delta = abs(go_effect["t"] - rust_effect["t"])
            if position_delta > 100.0 or time_delta > 0.5:
                continue
            candidates.append(
                (time_delta + position_delta / 500.0, rust_idx, rust_effect, position_delta, time_delta)
            )
        if not candidates:
            continue
        _, rust_idx, rust_effect, position_delta, time_delta = min(candidates, key=lambda item: item[0])
        unmatched_go.remove(go_idx)
        unmatched_rust.remove(rust_idx)
        if time_delta > 0.125 or position_delta > 50.0:
            classification = classify_effect_mismatch(go_effect, rust_effect)
            mismatched.append(
                {
                    "go": effect_sample(go_effect),
                    "rust": effect_sample(rust_effect),
                    "timeDelta": round(time_delta, 3),
                    "positionDelta": round(position_delta, 1),
                    "classification": classification,
                }
            )

    missing = [go_effects[idx] for idx in sorted(unmatched_go)]
    extra = [rust_effects[idx] for idx in sorted(unmatched_rust)]
    classification_counts: dict[str, int] = {}
    for mismatch in mismatched:
        classification = mismatch["classification"]
        classification_counts[classification] = classification_counts.get(classification, 0) + 1
    return {
        "missingInRustCount": len(missing),
        "missingInRustSample": [effect_sample(item) for item in missing[:limit]],
        "extraInRustCount": len(extra),
        "extraInRustSample": [effect_sample(item) for item in extra[:limit]],
        "effectMismatchCount": len(mismatched),
        "effectMismatchClassifications": classification_counts,
        "unclassifiedMismatchCount": classification_counts.get("unclassified", 0),
        "effectMismatchSample": mismatched[:limit],
    }


def fire_time_tolerance(weapon: str) -> float:
    if weapon in GRENADE_FIRE_WEAPONS:
        return 0.35
    return 0.08


def match_time_ordered(
    go_indexes: list[int],
    rust_indexes: list[int],
    go_items: list[dict[str, Any]],
    rust_items: list[dict[str, Any]],
    tolerance: float,
) -> list[tuple[int, int]]:
    """Match ordered timestamp series while avoiding one missing item shifting a burst."""
    m = len(go_indexes)
    n = len(rust_indexes)
    dp: list[list[tuple[int, float]]] = [[(0, 0.0)] * (n + 1) for _ in range(m + 1)]
    action: list[list[str | None]] = [[None] * (n + 1) for _ in range(m + 1)]

    for i in range(m - 1, -1, -1):
        dp[i][n] = (dp[i + 1][n][0] + 1, dp[i + 1][n][1])
        action[i][n] = "skip_go"
    for j in range(n - 1, -1, -1):
        dp[m][j] = (dp[m][j + 1][0] + 1, dp[m][j + 1][1])
        action[m][j] = "skip_rust"

    for i in range(m - 1, -1, -1):
        for j in range(n - 1, -1, -1):
            best = (dp[i + 1][j][0] + 1, dp[i + 1][j][1])
            best_action = "skip_go"

            skip_rust = (dp[i][j + 1][0] + 1, dp[i][j + 1][1])
            if skip_rust < best:
                best = skip_rust
                best_action = "skip_rust"

            go_idx = go_indexes[i]
            rust_idx = rust_indexes[j]
            delta = abs(rust_items[rust_idx]["t"] - go_items[go_idx]["t"])
            if delta <= tolerance:
                matched = (dp[i + 1][j + 1][0], dp[i + 1][j + 1][1] + delta)
                if matched < best:
                    best = matched
                    best_action = "match"

            dp[i][j] = best
            action[i][j] = best_action

    pairs = []
    i = 0
    j = 0
    while i < m and j < n:
        step = action[i][j]
        if step == "match":
            pairs.append((go_indexes[i], rust_indexes[j]))
            i += 1
            j += 1
        elif step == "skip_go":
            i += 1
        else:
            j += 1
    return pairs


def compare_fire_poses(go_round: dict[str, Any], rust_round: dict[str, Any], limit: int = 10) -> dict[str, Any]:
    go_fires = sorted(fire_pose_summary(go_round.get("weaponFires", [])), key=lambda item: item["t"])
    rust_fires = sorted(fire_pose_summary(rust_round.get("weaponFires", [])), key=lambda item: item["t"])
    unmatched_go = set(range(len(go_fires)))
    unmatched_rust = set(range(len(rust_fires)))
    matched_pairs = []
    missing = []
    mismatched = []

    group_keys = sorted(
        {(item["shooter"], item["weapon"]) for item in go_fires}
        | {(item["shooter"], item["weapon"]) for item in rust_fires},
        key=lambda item: (str(item[0]), item[1]),
    )
    go_groups: dict[tuple[Any, str], list[int]] = {}
    rust_groups: dict[tuple[Any, str], list[int]] = {}
    for idx, item in enumerate(go_fires):
        go_groups.setdefault((item["shooter"], item["weapon"]), []).append(idx)
    for idx, item in enumerate(rust_fires):
        rust_groups.setdefault((item["shooter"], item["weapon"]), []).append(idx)

    for key in group_keys:
        go_indexes = go_groups.get(key, [])
        rust_indexes = rust_groups.get(key, [])
        for go_idx, rust_idx in match_time_ordered(
            go_indexes,
            rust_indexes,
            go_fires,
            rust_fires,
            fire_time_tolerance(key[1]),
        ):
            unmatched_go.remove(go_idx)
            unmatched_rust.remove(rust_idx)
            matched_pairs.append((go_idx, rust_idx))

    for go_idx, rust_idx in matched_pairs:
        go_fire = go_fires[go_idx]
        rust_fire = rust_fires[rust_idx]
        if go_fire["shooter"] != rust_fire["shooter"] or go_fire["weapon"] != rust_fire["weapon"]:
            continue
        position_delta = (
            (go_fire["x"] - rust_fire["x"]) ** 2
            + (go_fire["y"] - rust_fire["y"]) ** 2
            + (go_fire["z"] - rust_fire["z"]) ** 2
        ) ** 0.5
        yaw = yaw_delta(go_fire["yaw"], rust_fire["yaw"])
        if position_delta > 160.0 or yaw > 45.0 or go_fire["team"] != rust_fire["team"]:
            mismatched.append(
                {
                    "go": fire_pose_sample(go_fire),
                    "rust": fire_pose_sample(rust_fire),
                    "positionDelta": round(position_delta, 1),
                    "yawDelta": round(yaw, 1),
                }
            )
    missing = [go_fires[idx] for idx in sorted(unmatched_go)]
    extra = [rust_fires[idx] for idx in sorted(unmatched_rust)]
    missing_sample, missing_classifications = classify_fire_samples(
        missing, go_round, limit, rust_round
    )
    extra_sample, extra_classifications = classify_fire_samples(
        extra, rust_round, limit, go_round
    )
    return {
        "missingInRustCount": len(missing),
        "missingInRustClassifications": missing_classifications,
        "missingInRustSample": missing_sample,
        "extraInRustCount": len(extra),
        "extraInRustClassifications": extra_classifications,
        "extraInRustSample": extra_sample,
        "poseMismatchCount": len(mismatched),
        "poseMismatchSample": mismatched[:limit],
        "firearmTimeToleranceSec": fire_time_tolerance("ak47"),
        "grenadeTimeToleranceSec": fire_time_tolerance("smokegrenade"),
    }


def projectile_tracks(round_obj: dict[str, Any]) -> dict[tuple[Any, str, Any], list[dict[str, float]]]:
    tracks: dict[tuple[Any, str, Any], list[dict[str, float]]] = {}
    for frame in round_obj.get("projectileFrames", []):
        frame_t = float(frame.get("t", 0.0) or 0.0)
        for projectile in frame.get("projectiles", []):
            key = (
                projectile.get("id"),
                normalize_projectile_type(projectile.get("type")),
                projectile.get("thrower"),
            )
            tracks.setdefault(key, []).append(
                {
                    "t": frame_t,
                    "x": float(projectile.get("x", 0.0) or 0.0),
                    "y": float(projectile.get("y", 0.0) or 0.0),
                    "z": float(projectile.get("z", 0.0) or 0.0),
                }
            )
    return tracks


def projectile_integrity(round_obj: dict[str, Any]) -> dict[str, Any]:
    duplicate_projectiles = 0
    non_monotonic_frames = 0
    previous_t: float | None = None
    for frame in round_obj.get("projectileFrames", []):
        frame_t = float(frame.get("t", 0.0) or 0.0)
        if previous_t is not None and frame_t <= previous_t:
            non_monotonic_frames += 1
        previous_t = frame_t
        seen = set()
        for projectile in frame.get("projectiles", []):
            key = (
                projectile.get("id"),
                normalize_projectile_type(projectile.get("type")),
                projectile.get("thrower"),
            )
            if key in seen:
                duplicate_projectiles += 1
            seen.add(key)

    track_breaks = 0
    teleport_count = 0
    tracks = projectile_tracks(round_obj)
    for points in tracks.values():
        points.sort(key=lambda item: item["t"])
        for left, right in zip(points, points[1:]):
            dt = right["t"] - left["t"]
            if dt <= 0.0:
                track_breaks += 1
                continue
            if dt > 0.25:
                track_breaks += 1
            distance = (
                (right["x"] - left["x"]) ** 2
                + (right["y"] - left["y"]) ** 2
                + (right["z"] - left["z"]) ** 2
            ) ** 0.5
            if dt <= 0.1 and distance > 900.0:
                teleport_count += 1
    return {
        "projectileTrackCount": len(tracks),
        "duplicateProjectiles": duplicate_projectiles,
        "nonMonotonicProjectileFrames": non_monotonic_frames,
        "projectileTrackBreaks": track_breaks,
        "projectileTeleportCount": teleport_count,
    }


def projectile_track_signature(key: tuple[Any, str, Any], points: list[dict[str, float]]) -> dict[str, Any]:
    points = sorted(points, key=lambda item: item["t"])
    first = points[0]
    last = points[-1]
    return {
        "id": key[0],
        "type": key[1],
        "thrower": key[2],
        "start": bucket_time(first["t"], 0.25),
        "end": bucket_time(last["t"], 0.25),
        "samples": len(points),
        "startX": round(first["x"] / 100.0) * 100,
        "startY": round(first["y"] / 100.0) * 100,
        "endX": round(last["x"] / 100.0) * 100,
        "endY": round(last["y"] / 100.0) * 100,
    }


def projectile_position_delta(left: dict[str, Any], right: dict[str, Any], prefix: str) -> float:
    dx = float(left[f"{prefix}X"] or 0.0) - float(right[f"{prefix}X"] or 0.0)
    dy = float(left[f"{prefix}Y"] or 0.0) - float(right[f"{prefix}Y"] or 0.0)
    return (dx * dx + dy * dy) ** 0.5


def round_end_time(round_obj: dict[str, Any]) -> float:
    for event in round_obj.get("events", []):
        if event.get("type") == "round_end" and isinstance(event.get("t"), (int, float)):
            return float(event["t"])
    return 0.0


def classify_projectile_mismatch(
    mismatch: dict[str, Any],
    rust_round_end: float,
) -> str:
    go_sig = mismatch["go"]
    rust_sig = mismatch["rust"]
    if (
        go_sig["type"] == "smoke"
        and rust_sig["type"] == "smoke"
        and mismatch["startPositionDelta"] <= 1.0
        and mismatch["endPositionDelta"] <= 100.0
        and abs(float(rust_sig["end"]) - rust_round_end) <= 0.5
        and float(go_sig["end"]) > float(rust_sig["end"]) + 1.0
    ):
        return "post_round_smoke_duration"
    if (
        go_sig["type"] in {"he", "flash"}
        and go_sig["type"] == rust_sig["type"]
        and go_sig["thrower"] == rust_sig["thrower"]
        and mismatch["startPositionDelta"] <= 1.0
        and mismatch["endPositionDelta"] <= 150.0
    ):
        return "overlapping_same_thrower_projectile"
    return "unclassified"


def compare_projectile_tracks(go_round: dict[str, Any], rust_round: dict[str, Any], limit: int = 10) -> dict[str, Any]:
    go_tracks = projectile_tracks(go_round)
    rust_tracks = projectile_tracks(rust_round)
    unmatched_rust = set(range(len(rust_tracks)))
    rust_items = list(rust_tracks.items())
    missing = []
    mismatched = []
    for go_key, go_points in go_tracks.items():
        go_sig = projectile_track_signature(go_key, go_points)
        candidates = []
        for idx in unmatched_rust:
            rust_key, rust_points = rust_items[idx]
            if rust_key[1] != go_key[1] or rust_key[2] != go_key[2]:
                continue
            rust_sig = projectile_track_signature(rust_key, rust_points)
            if abs(rust_sig["start"] - go_sig["start"]) > 0.5:
                continue
            start_position_delta = projectile_position_delta(go_sig, rust_sig, "start")
            end_position_delta = projectile_position_delta(go_sig, rust_sig, "end")
            distance = (
                abs(rust_sig["end"] - go_sig["end"])
                + abs(rust_sig["samples"] - go_sig["samples"]) / 256.0
                + start_position_delta / 500.0
                + end_position_delta / 500.0
            )
            candidates.append((distance, idx, rust_sig))
        if not candidates:
            missing.append(go_sig)
            continue
        _, idx, rust_sig = min(candidates, key=lambda item: item[0])
        unmatched_rust.remove(idx)
        sample_delta = abs(rust_sig["samples"] - go_sig["samples"])
        end_delta = abs(rust_sig["end"] - go_sig["end"])
        start_position_delta = projectile_position_delta(go_sig, rust_sig, "start")
        end_position_delta = projectile_position_delta(go_sig, rust_sig, "end")
        if sample_delta > 128 or end_delta > 0.75 or start_position_delta > 250.0 or end_position_delta > 250.0:
            mismatched.append(
                {
                    "go": go_sig,
                    "rust": rust_sig,
                    "sampleDelta": sample_delta,
                    "endDelta": end_delta,
                    "startPositionDelta": round(start_position_delta, 1),
                    "endPositionDelta": round(end_position_delta, 1),
                }
            )
    extra = [projectile_track_signature(*rust_items[idx]) for idx in sorted(unmatched_rust)]
    rust_round_end = round_end_time(rust_round)
    classification_counts: dict[str, int] = {}
    for mismatch in mismatched:
        classification = classify_projectile_mismatch(mismatch, rust_round_end)
        mismatch["classification"] = classification
        classification_counts[classification] = classification_counts.get(classification, 0) + 1
    return {
        "missingInRustCount": len(missing),
        "missingInRustSample": missing[:limit],
        "extraInRustCount": len(extra),
        "extraInRustSample": extra[:limit],
        "trackMismatchCount": len(mismatched),
        "trackMismatchClassifications": classification_counts,
        "unclassifiedMismatchCount": classification_counts.get("unclassified", 0),
        "trackMismatchSample": mismatched[:limit],
    }


def round_audit(go_output: Path, rust_output: Path) -> dict[str, Any]:
    go_manifest, go_rounds = load_round_payloads(go_output)
    rust_manifest, rust_rounds = load_round_payloads(rust_output)
    round_count = max(len(go_rounds), len(rust_rounds))
    rounds = []
    for idx in range(round_count):
        go_summary = round_audit_summary(go_rounds[idx]) if idx < len(go_rounds) else None
        rust_summary = round_audit_summary(rust_rounds[idx]) if idx < len(rust_rounds) else None
        diffs = []
        if go_summary is None or rust_summary is None:
            diffs.append({"field": "roundPresent", "go": go_summary is not None, "rust": rust_summary is not None})
        else:
            scalar_fields = [
                "scoreA",
                "scoreB",
                "frames",
                "framesWithPlayers",
                "framesWithBombState",
                "playersWithWeapons",
                "embeddedProjectileFrames",
                "events",
                "effects",
                "dedupedEffects",
                "weaponFires",
                "projectileFrames",
                "projectileSamples",
                "projectileTrackCount",
                "duplicateProjectiles",
                "nonMonotonicProjectileFrames",
                "projectileTrackBreaks",
                "projectileTeleportCount",
            ]
            map_fields = [
                "bombStateCounts",
                "eventCounts",
                "effectCounts",
                "dedupedEffectCounts",
                "fireCountsByWeapon",
                "projectileTypeCounts",
            ]
            for field in scalar_fields + map_fields:
                if go_summary.get(field) != rust_summary.get(field):
                    diffs.append(
                        {
                            "field": field,
                            "go": go_summary.get(field),
                            "rust": rust_summary.get(field),
                            "delta": numeric_delta(go_summary.get(field), rust_summary.get(field)),
                        }
                    )
            for field in [
                "killSignatures",
                "effectSignatures",
                "fireSignatures",
                "projectileSignatures",
            ]:
                diff = signature_diff(go_summary[field], rust_summary[field])
                if diff["missingInRustCount"] or diff["extraInRustCount"]:
                    diffs.append({"field": field, **diff})
            bomb_event_diff = compare_bomb_events(go_rounds[idx], rust_rounds[idx])
            if (
                bomb_event_diff["missingInRustCount"]
                or bomb_event_diff["extraInRustCount"]
                or bomb_event_diff["eventMismatchCount"]
            ):
                diffs.append({"field": "bombEventTolerance", **bomb_event_diff})
            bomb_state_window_diff = compare_bomb_state_windows(go_rounds[idx], rust_rounds[idx])
            if (
                bomb_state_window_diff["missingInRustCount"]
                or bomb_state_window_diff["extraInRustCount"]
            ):
                diffs.append({"field": "bombStateWindows", **bomb_state_window_diff})
            deduped_effect_diff = compare_deduped_effects(go_rounds[idx], rust_rounds[idx])
            if (
                deduped_effect_diff["missingInRustCount"]
                or deduped_effect_diff["extraInRustCount"]
                or deduped_effect_diff["effectMismatchCount"]
            ):
                diffs.append({"field": "dedupedEffectTolerance", **deduped_effect_diff})
            fire_pose_diff = compare_fire_poses(go_rounds[idx], rust_rounds[idx])
            if (
                fire_pose_diff["missingInRustCount"]
                or fire_pose_diff["extraInRustCount"]
                or fire_pose_diff["poseMismatchCount"]
            ):
                diffs.append({"field": "firePoseTolerance", **fire_pose_diff})
            projectile_track_diff = compare_projectile_tracks(go_rounds[idx], rust_rounds[idx])
            if (
                projectile_track_diff["missingInRustCount"]
                or projectile_track_diff["extraInRustCount"]
                or projectile_track_diff["trackMismatchCount"]
            ):
                diffs.append({"field": "projectileTrackTolerance", **projectile_track_diff})
        rounds.append({"index": idx, "go": go_summary, "rust": rust_summary, "diffs": diffs})
    return {
        "goMeta": go_manifest.get("meta", {}),
        "rustMeta": rust_manifest.get("meta", {}),
        "rounds": rounds,
    }


def expected_score_from_name(path: Path) -> tuple[int, int] | None:
    match = re.search(r"(\d+)-(\d+)\.dem(?:\.zst)?$", path.name)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def parser_cmd(parser: str, demo: Path, output: Path, quality: str, skip_heavy: bool) -> list[str]:
    binary = GO_BIN if parser == "go" else RUST_BIN
    cmd = [
        str(binary),
        "-in",
        str(demo),
        "-out",
        str(output),
        "-quality",
        quality,
    ]
    if skip_heavy:
        cmd.extend(["-skipProjectiles", "-skipWeaponFires"])
    if parser == "rust":
        cmd.append("-stats")
    return cmd


def poll_rss_kb(pid: int) -> int:
    try:
        out = subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)], text=True)
        return int(out.strip() or "0")
    except Exception:
        return 0


def run_parser(
    parser: str,
    demo: Path,
    output: Path,
    quality: str,
    skip_heavy: bool,
    timeout_sec: int,
) -> dict[str, Any]:
    output.parent.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    timed_out = False
    with tempfile.TemporaryFile("w+t", encoding="utf-8") as stdout_file, tempfile.TemporaryFile(
        "w+t", encoding="utf-8"
    ) as stderr_file:
        proc = subprocess.Popen(
            parser_cmd(parser, demo, output, quality, skip_heavy),
            stdout=stdout_file,
            stderr=stderr_file,
            text=True,
        )
        max_rss_kb = 0
        while proc.poll() is None:
            max_rss_kb = max(max_rss_kb, poll_rss_kb(proc.pid))
            if time.perf_counter() - started > timeout_sec:
                timed_out = True
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
                break
            time.sleep(0.2)
        max_rss_kb = max(max_rss_kb, poll_rss_kb(proc.pid))
        stdout_file.seek(0)
        stderr_file.seek(0)
        stdout = stdout_file.read()
        stderr = stderr_file.read()
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    result: dict[str, Any] = {
        "parser": parser,
        "exitCode": proc.returncode,
        "timedOut": timed_out,
        "elapsedMs": elapsed_ms,
        "maxRssKb": max_rss_kb,
        "stdoutTail": stdout[-4000:],
        "stderrTail": stderr[-8000:],
    }
    if output.exists():
        result["metrics"] = collect_metrics(output)
        result["stats"] = parse_roundlab_stats(stderr)
        result["phaseSummary"] = phase_summary(result["stats"])
    return result


def parse_roundlab_stats(stderr: str) -> dict[str, int]:
    stats: dict[str, int] = {}
    for line in stderr.splitlines():
        if not line.startswith("ROUNDLAB_STATS "):
            continue
        for part in line.removeprefix("ROUNDLAB_STATS ").split():
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            if value.isdigit():
                stats[key] = int(value)
    return stats


def phase_summary(stats: dict[str, int]) -> dict[str, int]:
    vendor_parse_ms = sum(
        stats.get(key, 0)
        for key in [
            "create_huffman_ms",
            "parse_header_ms",
            "parse_players_ms",
            "parse_events_ms",
            "sample_ticks_ms",
            "parse_ticks_ms",
            "parse_teams_ms",
            "parse_projectiles_ms",
        ]
    )
    grouping_ms = stats.get("group_ticks_ms", 0) + stats.get("group_projectiles_ms", 0)
    return {
        "readMs": stats.get("read_demo_ms", 0),
        "vendorParseMs": vendor_parse_ms,
        "groupingMs": grouping_ms,
        "buildRoundsMs": stats.get("build_rounds_ms", 0),
        "writeOutputMs": stats.get("write_output_ms", 0),
        "serializeJsonMs": stats.get("serialize_json_ms", 0),
        "gzipFinishMs": stats.get("gzip_finish_ms", 0),
        "fsyncMs": stats.get("fsync_ms", 0),
    }


def sum_phase(results: list[dict[str, Any]], key: str) -> int:
    return sum(int(item.get("rust", {}).get("phaseSummary", {}).get(key, 0)) for item in results)


def format_seconds(ms: int | float) -> str:
    return f"{ms / 1000:.1f}s"


def compare_metrics(demo: Path, go: dict[str, Any], rust: dict[str, Any]) -> dict[str, Any]:
    expected = expected_score_from_name(demo)
    fields = [
        "map",
        "scoreA",
        "scoreB",
        "rounds",
        "players",
        "frames",
        "framesWithBombState",
        "kills",
        "bombEvents",
        "effects",
        "weaponFires",
        "projectileFrames",
        "projectileSamples",
        "outputBytes",
    ]
    diffs = []
    go_metrics = go.get("metrics", {})
    rust_metrics = rust.get("metrics", {})
    for field in fields:
        if go_metrics.get(field) != rust_metrics.get(field):
            diffs.append(
                {
                    "field": field,
                    "go": go_metrics.get(field),
                    "rust": rust_metrics.get(field),
                    "delta": numeric_delta(go_metrics.get(field), rust_metrics.get(field)),
                    "classification": classify_diff(field, expected, go_metrics, rust_metrics),
                }
            )
    score_truth = None
    if expected:
        score_truth = {"scoreA": expected[0], "scoreB": expected[1]}
    return {
        "demo": str(demo.relative_to(ROOT)),
        "expectedScore": score_truth,
        "go": go,
        "rust": rust,
        "diffs": diffs,
    }


def numeric_delta(left: Any, right: Any) -> Any:
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return right - left
    return None


def classify_diff(
    field: str,
    expected_score: tuple[int, int] | None,
    go_metrics: dict[str, Any],
    rust_metrics: dict[str, Any],
) -> str:
    if field in {"scoreA", "scoreB"} and expected_score:
        idx = 0 if field == "scoreA" else 1
        expected = expected_score[idx]
        go_ok = go_metrics.get(field) == expected
        rust_ok = rust_metrics.get(field) == expected
        if rust_ok and not go_ok:
            return "go_wrong_filename_truth"
        if go_ok and not rust_ok:
            return "rust_wrong_filename_truth"
        if not go_ok and not rust_ok:
            return "both_wrong_filename_truth"
    if field == "effects" and is_go_duplicate_flash_effect_difference(go_metrics, rust_metrics):
        return "mostly_go_duplicate_flash_effects_check_round_audit"
    if field == "projectileSamples":
        return "model_difference_possible_projectiles_split_vs_embedded"
    if field == "outputBytes":
        return "performance_size_difference"
    return "needs_review"


def is_go_duplicate_flash_effect_difference(
    go_metrics: dict[str, Any], rust_metrics: dict[str, Any]
) -> bool:
    go_counts = dict(go_metrics.get("effectCounts") or {})
    rust_counts = dict(rust_metrics.get("effectCounts") or {})
    go_flash = go_counts.pop("flash", 0)
    rust_flash = rust_counts.pop("flash", 0)
    if go_counts != rust_counts:
        return False
    return rust_flash > 0 and rust_flash < go_flash <= rust_flash * 2


def write_markdown(report: dict[str, Any], path: Path) -> None:
    lines = [
        "# Parser Comparison Report",
        "",
        f"- quality: `{report['quality']}`",
        f"- skipHeavy: `{report['skipHeavy']}`",
        f"- demos: {len(report['results'])}",
        "",
        "| demo | expected | Go score | Rust score | Go ms/RSS MB | Rust ms/RSS MB | notable diffs |",
        "| --- | --- | --- | --- | ---: | ---: | --- |",
    ]
    for item in report["results"]:
        go = item["go"]
        rust = item["rust"]
        go_m = go.get("metrics", {})
        rust_m = rust.get("metrics", {})
        expected = item.get("expectedScore") or {}
        notable = ", ".join(
            f"{d['field']}({d['classification']})" for d in item["diffs"][:6]
        )
        lines.append(
            "| {demo} | {expected_a}-{expected_b} | {go_a}-{go_b} | {rust_a}-{rust_b} | "
            "{go_ms}/{go_rss:.1f} | {rust_ms}/{rust_rss:.1f} | {notable} |".format(
                demo=item["demo"],
                expected_a=expected.get("scoreA", "?"),
                expected_b=expected.get("scoreB", "?"),
                go_a=go_m.get("scoreA", "?"),
                go_b=go_m.get("scoreB", "?"),
                rust_a=rust_m.get("scoreA", "?"),
                rust_b=rust_m.get("scoreB", "?"),
                go_ms=go.get("elapsedMs", "?"),
                go_rss=go.get("maxRssKb", 0) / 1024,
                rust_ms=rust.get("elapsedMs", "?"),
                rust_rss=rust.get("maxRssKb", 0) / 1024,
                notable=notable or "none",
            )
        )
    if any(item.get("rust", {}).get("phaseSummary") for item in report["results"]):
        lines.extend(
            [
                "",
                "## Rust Phase Timings",
                "",
                "| demo | read | vendor parse | grouping | build rounds | write output | serialize JSON | max RSS MB |",
                "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            ]
        )
        for item in report["results"]:
            rust = item["rust"]
            phases = rust.get("phaseSummary", {})
            lines.append(
                "| {demo} | {read} | {vendor} | {grouping} | {build} | {write} | {serialize} | {rss:.1f} |".format(
                    demo=item["demo"],
                    read=format_seconds(phases.get("readMs", 0)),
                    vendor=format_seconds(phases.get("vendorParseMs", 0)),
                    grouping=format_seconds(phases.get("groupingMs", 0)),
                    build=format_seconds(phases.get("buildRoundsMs", 0)),
                    write=format_seconds(phases.get("writeOutputMs", 0)),
                    serialize=format_seconds(phases.get("serializeJsonMs", 0)),
                    rss=rust.get("maxRssKb", 0) / 1024,
                )
            )
        lines.extend(
            [
                "",
                "| total read | total vendor parse | total grouping | total build rounds | total write output | total serialize JSON | peak RSS MB |",
                "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
                "| {read} | {vendor} | {grouping} | {build} | {write} | {serialize} | {rss:.1f} |".format(
                    read=format_seconds(sum_phase(report["results"], "readMs")),
                    vendor=format_seconds(sum_phase(report["results"], "vendorParseMs")),
                    grouping=format_seconds(sum_phase(report["results"], "groupingMs")),
                    build=format_seconds(sum_phase(report["results"], "buildRoundsMs")),
                    write=format_seconds(sum_phase(report["results"], "writeOutputMs")),
                    serialize=format_seconds(sum_phase(report["results"], "serializeJsonMs")),
                    rss=max((item.get("rust", {}).get("maxRssKb", 0) for item in report["results"]), default=0)
                    / 1024,
                ),
            ]
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def increment_counter(counter: dict[str, int], key: str, amount: int = 1) -> None:
    counter[key] = counter.get(key, 0) + amount


def aggregate_round_audit(report: dict[str, Any]) -> dict[str, Any]:
    field_counts: dict[str, int] = {}
    missing_counts: dict[str, int] = {}
    extra_counts: dict[str, int] = {}
    unclassified_counts: dict[str, int] = {}
    classification_counts: dict[str, dict[str, int]] = {}
    rounds_with_diffs = 0
    total_rounds = 0

    classification_keys = [
        "eventMismatchClassifications",
        "windowMismatchClassifications",
        "effectMismatchClassifications",
        "missingInRustClassifications",
        "extraInRustClassifications",
        "trackMismatchClassifications",
    ]
    for item in report.get("results", []):
        audit = item.get("roundAudit") or {}
        for round_item in audit.get("rounds", []):
            total_rounds += 1
            diffs = round_item.get("diffs", [])
            if diffs:
                rounds_with_diffs += 1
            for diff in diffs:
                field = diff.get("field", "unknown")
                increment_counter(field_counts, field)
                missing = int(diff.get("missingInRustCount") or 0)
                extra = int(diff.get("extraInRustCount") or 0)
                unclassified = int(diff.get("unclassifiedMismatchCount") or 0)
                if missing:
                    increment_counter(missing_counts, field, missing)
                if extra:
                    increment_counter(extra_counts, field, extra)
                if unclassified:
                    increment_counter(unclassified_counts, field, unclassified)
                for key in classification_keys:
                    values = diff.get(key) or {}
                    if not isinstance(values, dict) or not values:
                        continue
                    namespace = f"{field}.{key}"
                    bucket = classification_counts.setdefault(namespace, {})
                    for classification, count in values.items():
                        amount = int(count or 0)
                        increment_counter(bucket, str(classification), amount)
                        if classification == "unclassified" and amount:
                            increment_counter(unclassified_counts, namespace, amount)

    return {
        "totalRounds": total_rounds,
        "roundsWithDiffs": rounds_with_diffs,
        "fieldCounts": field_counts,
        "missingInRustCounts": missing_counts,
        "extraInRustCounts": extra_counts,
        "unclassifiedMismatchCounts": unclassified_counts,
        "classificationCounts": classification_counts,
    }


def format_counter(counter: dict[str, int]) -> str:
    if not counter:
        return "none"
    return ", ".join(f"{key}:{value}" for key, value in sorted(counter.items()))


def write_round_audit_markdown(report: dict[str, Any], path: Path) -> None:
    summary = report.get("roundAuditSummary") or aggregate_round_audit(report)
    lines = [
        "# Parser Round Audit",
        "",
        f"- quality: `{report['quality']}`",
        f"- skipHeavy: `{report['skipHeavy']}`",
        f"- demos: {len(report['results'])}",
        f"- rounds with diffs: {summary.get('roundsWithDiffs', 0)}/{summary.get('totalRounds', 0)}",
        f"- unclassified mismatches: {format_counter(summary.get('unclassifiedMismatchCounts', {}))}",
        "",
    ]
    lines.extend(
        [
            "## Audit Summary",
            "",
            f"- diff fields: {format_counter(summary.get('fieldCounts', {}))}",
            f"- missing in Rust: {format_counter(summary.get('missingInRustCounts', {}))}",
            f"- extra in Rust: {format_counter(summary.get('extraInRustCounts', {}))}",
            "",
        ]
    )
    classification_counts = summary.get("classificationCounts", {})
    if classification_counts:
        lines.extend(["| classifier | counts |", "| --- | --- |"])
        for classifier, counts in sorted(classification_counts.items()):
            lines.append(f"| `{classifier}` | {format_counter(counts)} |")
        lines.append("")

    for item in report["results"]:
        audit = item.get("roundAudit")
        if not audit:
            continue
        lines.extend([f"## {item['demo']}", ""])
        lines.append("| round | score | frames | kills | bomb | effects | fires | projectile frames/samples | notable |")
        lines.append("| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |")
        for round_item in audit["rounds"]:
            go = round_item.get("go") or {}
            rust = round_item.get("rust") or {}
            diffs = round_item.get("diffs", [])
            notable = ", ".join(diff["field"] for diff in diffs[:6]) or "none"
            lines.append(
                "| {idx} | {go_score}->{rust_score} | {go_frames}->{rust_frames} | "
                "{go_kills}->{rust_kills} | {go_bomb}->{rust_bomb} | {go_effects}->{rust_effects} | "
                "{go_fires}->{rust_fires} | {go_pf}/{go_ps}->{rust_pf}/{rust_ps} | {notable} |".format(
                    idx=round_item["index"],
                    go_score=f"{go.get('scoreA', '?')}-{go.get('scoreB', '?')}",
                    rust_score=f"{rust.get('scoreA', '?')}-{rust.get('scoreB', '?')}",
                    go_frames=go.get("frames", "?"),
                    rust_frames=rust.get("frames", "?"),
                    go_kills=go.get("eventCounts", {}).get("kill", 0),
                    rust_kills=rust.get("eventCounts", {}).get("kill", 0),
                    go_bomb=sum(go.get("eventCounts", {}).get(kind, 0) for kind in BOMB_EVENTS),
                    rust_bomb=sum(rust.get("eventCounts", {}).get(kind, 0) for kind in BOMB_EVENTS),
                    go_effects=go.get("effects", "?"),
                    rust_effects=rust.get("effects", "?"),
                    go_fires=go.get("weaponFires", "?"),
                    rust_fires=rust.get("weaponFires", "?"),
                    go_pf=go.get("projectileFrames", "?"),
                    go_ps=go.get("projectileSamples", "?"),
                    rust_pf=rust.get("projectileFrames", "?"),
                    rust_ps=rust.get("projectileSamples", "?"),
                    notable=notable,
                )
            )
        lines.append("")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-go", action="store_true")
    parser.add_argument("--build-rust", action="store_true")
    parser.add_argument("--quality", default="full", choices=["full", "high", "medium", "low"])
    parser.add_argument("--skip-heavy", action="store_true")
    parser.add_argument("--demo", action="append", type=Path)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--timeout-sec", type=int, default=600)
    parser.add_argument("--keep-outputs", action="store_true")
    parser.add_argument("--round-audit", action="store_true")
    parser.add_argument("--out", type=Path, default=REPORT_DIR / "report.json")
    args = parser.parse_args()

    if args.prepare_go:
        prepare_go_parser()
    if args.build_rust:
        build_rust_parser()
    if not GO_BIN.exists():
        raise SystemExit(f"missing {GO_BIN}; run with --prepare-go")
    if not RUST_BIN.exists():
        raise SystemExit(f"missing {RUST_BIN}; run with --build-rust")

    demos = args.demo or sorted((ROOT / "demos").glob("*.dem.zst"))
    demos = [demo if demo.is_absolute() else (ROOT / demo) for demo in demos]
    if args.limit:
        demos = demos[: args.limit]
    if not demos:
        raise SystemExit("no demos found")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    results = []
    output_root = REPORT_DIR / "outputs" if args.keep_outputs else None
    if output_root:
        if output_root.exists():
            shutil.rmtree(output_root)
        output_root.mkdir(parents=True)

    tmp_context = (
        tempfile.TemporaryDirectory(prefix="roundlab-compare-")
        if output_root is None
        else null_tempdir(output_root)
    )
    with tmp_context as tmp:
        tmp_dir = Path(tmp)
        for demo in demos:
            print(
                f"comparing {demo.name} quality={args.quality} skipHeavy={args.skip_heavy}",
                flush=True,
            )
            suffix = "skip" if args.skip_heavy else "full"
            go_output = tmp_dir / f"{demo.stem}.{args.quality}-{suffix}.go.json.gz"
            rust_output = tmp_dir / f"{demo.stem}.{args.quality}-{suffix}.rust.json.gz"
            go_result = run_parser(
                "go", demo, go_output, args.quality, args.skip_heavy, args.timeout_sec
            )
            rust_result = run_parser(
                "rust", demo, rust_output, args.quality, args.skip_heavy, args.timeout_sec
            )
            item = compare_metrics(demo, go_result, rust_result)
            if args.round_audit and go_output.exists() and rust_output.exists():
                item["roundAudit"] = round_audit(go_output, rust_output)
            results.append(item)

    report = {
        "quality": args.quality,
        "skipHeavy": args.skip_heavy,
        "goCommit": GO_COMMIT,
        "results": results,
    }
    if args.round_audit:
        report["roundAuditSummary"] = aggregate_round_audit(report)
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    write_markdown(report, args.out.with_suffix(".md"))
    if args.round_audit:
        write_round_audit_markdown(
            report, args.out.with_name(f"{args.out.stem}-round-audit.md")
        )
    print(f"wrote {args.out}")
    print(f"wrote {args.out.with_suffix('.md')}")
    if args.round_audit:
        print(f"wrote {args.out.with_name(f'{args.out.stem}-round-audit.md')}")
    return 0


class null_tempdir:
    def __init__(self, path: Path) -> None:
        self.path = path

    def __enter__(self) -> str:
        return str(self.path)

    def __exit__(self, *args: object) -> None:
        return None


if __name__ == "__main__":
    sys.exit(main())
