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
    if normalized in {"deserteagle"}:
        return "deagle"
    if normalized in {"m4a1silencer"}:
        return "m4a1"
    if normalized in {"incgrenade", "incendiarygrenade"}:
        return "incendiary"
    if normalized.startswith("knife") or normalized in {"bayonet", "karambit"}:
        return "knife"
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
                    "weapon": normalize_weapon(event.get("weapon")),
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
    for effect in round_obj.get("effects", []):
        kind = effect.get("type", "")
        effect_counts[kind] = effect_counts.get(kind, 0) + 1
        effect_signatures.append(
            {
                "t": bucket_time(effect.get("start"), 0.25),
                "type": kind,
                "variant": effect.get("variant"),
                "team": effect.get("team"),
                "x": round(float(effect.get("x", 0.0)) / 50.0) * 50,
                "y": round(float(effect.get("y", 0.0)) / 50.0) * 50,
            }
        )

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
        "effectCounts": effect_counts,
        "effectSignatures": sorted(effect_signatures, key=lambda item: (item["t"], item["type"], item["x"], item["y"])),
        "weaponFires": len(round_obj.get("weaponFires", [])),
        "fireCountsByWeapon": fire_counts_by_weapon,
        "fireSignatures": sorted(fire_signatures, key=lambda item: (item["t"], item["shooter"] or 0, item["weapon"])),
        "projectileFrames": len(projectile_frames),
        "projectileSamples": projectile_samples,
        "projectileTypeCounts": projectile_type_counts,
        "projectileSignatures": sorted(projectile_signatures, key=lambda item: (item["t"], item["thrower"] or 0, item["type"])),
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
                "weaponFires",
                "projectileFrames",
                "projectileSamples",
            ]
            map_fields = [
                "bombStateCounts",
                "eventCounts",
                "effectCounts",
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
                "bombSignatures",
                "effectSignatures",
                "fireSignatures",
                "projectileSignatures",
            ]:
                diff = signature_diff(go_summary[field], rust_summary[field])
                if diff["missingInRustCount"] or diff["extraInRustCount"]:
                    diffs.append({"field": field, **diff})
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
    if field == "projectileSamples":
        return "model_difference_possible_projectiles_split_vs_embedded"
    if field == "outputBytes":
        return "performance_size_difference"
    return "needs_review"


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
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_round_audit_markdown(report: dict[str, Any], path: Path) -> None:
    lines = [
        "# Parser Round Audit",
        "",
        f"- quality: `{report['quality']}`",
        f"- skipHeavy: `{report['skipHeavy']}`",
        f"- demos: {len(report['results'])}",
        "",
    ]
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
