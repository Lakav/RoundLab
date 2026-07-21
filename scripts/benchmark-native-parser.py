#!/usr/bin/env python3
"""Reproducible RoundLab native parser benchmark using real local demos."""

from __future__ import annotations

import argparse
import csv
import json
import platform
import re
import subprocess
import tempfile
import time
from pathlib import Path


STAT_RE = re.compile(r"^ROUNDLAB_STATS\s+([a-z0-9_]+)=(.+)$")
RSS_RE = re.compile(r"^\s*(\d+)\s+maximum resident set size\s*$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("demos", nargs="+", type=Path)
    parser.add_argument("--binary", type=Path, default=Path("parser/target/release/roundlab-parser"))
    parser.add_argument("--repetitions", type=int, default=3)
    parser.add_argument("--output-dir", type=Path, default=Path("docs/rncp-bloc2/evidence/performance"))
    return parser.parse_args()


def run_once(binary: Path, demo: Path, repetition: int, raw_dir: Path) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="roundlab-benchmark-") as temp_dir:
        output = Path(temp_dir) / "parsed.json.gz"
        command = [
            "/usr/bin/time",
            "-l",
            str(binary),
            "-in",
            str(demo),
            "-out",
            str(output),
            "-quality",
            "full",
            "-stats",
        ]
        started = time.perf_counter()
        completed = subprocess.run(command, text=True, capture_output=True, check=False)
        wall_ms = round((time.perf_counter() - started) * 1000, 3)
        raw_log = completed.stdout + completed.stderr
        raw_name = f"{demo.stem}-run-{repetition}.txt"
        (raw_dir / raw_name).write_text(raw_log, encoding="utf-8")
        if completed.returncode != 0:
            raise RuntimeError(f"benchmark failed for {demo} run {repetition}; see {raw_name}")

        stats: dict[str, int | float | str | None] = {}
        maximum_rss_bytes: int | None = None
        for line in raw_log.splitlines():
            stat_match = STAT_RE.match(line)
            if stat_match:
                key, raw_value = stat_match.groups()
                try:
                    stats[key] = int(raw_value)
                except ValueError:
                    try:
                        stats[key] = float(raw_value)
                    except ValueError:
                        stats[key] = raw_value
            rss_match = RSS_RE.match(line)
            if rss_match:
                maximum_rss_bytes = int(rss_match.group(1))

        return {
            "demo": demo.name,
            "compressed_bytes": demo.stat().st_size,
            "repetition": repetition,
            "wall_ms": wall_ms,
            "maximum_rss_bytes": maximum_rss_bytes,
            **stats,
            "raw_log": f"native-raw/{raw_name}",
        }


def main() -> int:
    args = parse_args()
    if args.repetitions < 1:
        raise SystemExit("--repetitions must be positive")
    binary = args.binary.resolve()
    demos = [demo.resolve() for demo in args.demos]
    for required in [binary, *demos]:
        if not required.is_file():
            raise SystemExit(f"missing file: {required}")

    output_dir = args.output_dir.resolve()
    raw_dir = output_dir / "native-raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    runs = [
        run_once(binary, demo, repetition, raw_dir)
        for demo in demos
        for repetition in range(1, args.repetitions + 1)
    ]
    payload = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "machine": {
            "platform": platform.platform(),
            "processor": platform.processor(),
            "python": platform.python_version(),
        },
        "binary": str(binary),
        "repetitions": args.repetitions,
        "runs": runs,
    }
    (output_dir / "native-benchmark-raw.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    columns = list(dict.fromkeys(key for run in runs for key in run))
    with (output_dir / "native-benchmark-raw.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(runs)
    print(json.dumps({"runs": len(runs), "output_dir": str(output_dir)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
