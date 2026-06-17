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
            results.append(compare_metrics(demo, go_result, rust_result))

    report = {
        "quality": args.quality,
        "skipHeavy": args.skip_heavy,
        "goCommit": GO_COMMIT,
        "results": results,
    }
    args.out.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    write_markdown(report, args.out.with_suffix(".md"))
    print(f"wrote {args.out}")
    print(f"wrote {args.out.with_suffix('.md')}")
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
