#!/usr/bin/env python3
"""Summarize and validate reproducible browser benchmark results."""

from __future__ import annotations

import argparse
import json
import statistics
from pathlib import Path


DEFAULT_INPUT = Path("web/benchmark-results/browser-benchmark-raw.json")
DEFAULT_OUTPUT = Path("web/benchmark-results/browser-benchmark-summary.json")
IMPORT_BUDGETS_MS = (
    (140_000_000, 20_000),
    (180_000_000, 30_000),
    (260_000_000, 55_000),
)
LIMITS = {
    "decompressionMs": 1_000,
    "wasmLoadMs": 250,
    "roundOpenMs": 2_000,
    "frameIntervalP95Ms": 25,
    "browserProcessRssPeakBytes": 4 * 1024**3,
}
SUMMARY_FIELDS = (
    "decompressionMs",
    "wasmLoadMs",
    "parsingMs",
    "storageMs",
    "totalImportMs",
    "roundOpenMs",
    "browserProcessRssPeakBytes",
    "rendererJsHeapPeakBytes",
    "frameIntervalP95Ms",
)


def import_budget(compressed_bytes: int) -> int:
    for maximum_bytes, budget_ms in IMPORT_BUDGETS_MS:
        if compressed_bytes <= maximum_bytes:
            return budget_ms
    raise ValueError(f"no import budget configured for {compressed_bytes} bytes")


def triplet(values: list[float]) -> dict[str, float]:
    return {
        "min": min(values),
        "median": statistics.median(values),
        "max": max(values),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    configured = payload.get("configuredDemos")
    runs = payload.get("runs")
    repetitions = payload.get("repetitions")
    if not isinstance(configured, list) or not isinstance(runs, list) or not isinstance(repetitions, int):
        raise SystemExit("invalid browser benchmark payload")
    if len(runs) != len(configured) * repetitions:
        raise SystemExit(
            f"incomplete benchmark: expected {len(configured) * repetitions} runs, found {len(runs)}"
        )

    failures: list[str] = []
    demos: list[dict[str, object]] = []
    for demo in configured:
        demo_runs = [run for run in runs if run.get("demo") == demo]
        if len(demo_runs) != repetitions:
            failures.append(f"{demo}: expected {repetitions} runs, found {len(demo_runs)}")
            continue
        compressed_bytes = int(demo_runs[0]["compressedBytes"])
        budget_ms = import_budget(compressed_bytes)
        for run in demo_runs:
            if float(run["totalImportMs"]) > budget_ms:
                failures.append(
                    f"{demo} run {run['repetition']}: totalImportMs {run['totalImportMs']} > {budget_ms}"
                )
            for field, limit in LIMITS.items():
                if float(run[field]) > limit:
                    failures.append(f"{demo} run {run['repetition']}: {field} {run[field]} > {limit}")
        demos.append(
            {
                "demo": demo,
                "compressedBytes": compressed_bytes,
                "repetitions": repetitions,
                "totalImportBudgetMs": budget_ms,
                "metrics": {
                    field: triplet([float(run[field]) for run in demo_runs])
                    for field in SUMMARY_FIELDS
                },
            }
        )

    summary = {
        "generatedAt": payload.get("generatedAt"),
        "source": str(args.input),
        "thresholds": {
            **LIMITS,
            "totalImportMsByCompressedBytes": [
                {"maximumCompressedBytes": maximum, "budgetMs": budget}
                for maximum, budget in IMPORT_BUDGETS_MS
            ],
        },
        "status": "PASS" if not failures else "FAIL",
        "failures": failures,
        "demos": demos,
    }
    args.output.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": summary["status"], "runs": len(runs), "failures": failures}, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
