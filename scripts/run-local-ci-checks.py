#!/usr/bin/env python3
"""Run the portable product checks used by CI."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_APP = ROOT / "web"

PY_COMPILE_TARGETS = [
    "scripts/audit-browser-parser-locality.py",
    "scripts/audit-public-assets.py",
    "scripts/audit-reference-snapshots.py",
    "scripts/audit-replay-fixture-coverage.py",
    "scripts/audit-replay-rendering.py",
    "scripts/audit-security-baseline.py",
    "scripts/audit-static-export-source.py",
    "scripts/audit-static-export-artifact.py",
    "scripts/audit-web-portability.py",
    "scripts/benchmark-native-parser.py",
    "scripts/build-bloc4-pdf.py",
    "scripts/check-performance-budgets.py",
    "scripts/monitor-production.py",
    "scripts/run-local-ci-checks.py",
    "scripts/summarize-browser-benchmark.py",
    "scripts/write-deployment-manifest.py",
    "scripts/tests/test_monitor_production.py",
]

CI_SAFE_AUDITS = [
    ["python3", "scripts/audit-web-portability.py"],
    ["python3", "scripts/audit-static-export-source.py"],
    ["python3", "scripts/audit-browser-parser-locality.py"],
    ["python3", "scripts/audit-public-assets.py"],
    ["python3", "scripts/audit-reference-snapshots.py", "--reference-only"],
    ["python3", "scripts/audit-replay-fixture-coverage.py"],
    ["python3", "scripts/audit-replay-rendering.py", "--assets-only"],
    ["python3", "scripts/audit-security-baseline.py"],
    ["python3", "scripts/audit-static-export-artifact.py"],
]


def run(cmd: list[str], cwd: Path = ROOT) -> None:
    print(f"$ {' '.join(cmd)}", flush=True)
    subprocess.run(cmd, cwd=cwd, check=True)


def run_quiet(cmd: list[str], cwd: Path = ROOT) -> None:
    print(f"$ {' '.join(cmd)} >/dev/null", flush=True)
    subprocess.run(cmd, cwd=cwd, check=True, stdout=subprocess.DEVNULL)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--skip-frontend",
        action="store_true",
        help="skip pnpm lint/typecheck/build; web/out must already be current",
    )
    args = parser.parse_args()

    if not args.skip_frontend:
        run(["pnpm", "audit", "--audit-level", "high"], WEB_APP)
        run(["pnpm", "lint"], WEB_APP)
        run(["pnpm", "exec", "tsc", "--noEmit"], WEB_APP)
        run(["pnpm", "test:coverage"], WEB_APP)
        run(["pnpm", "build"], WEB_APP)
        run(["pnpm", "test:e2e:a11y"], WEB_APP)

    run(["python3", "-m", "py_compile", *PY_COMPILE_TARGETS])
    run_quiet(["python3", "-m", "json.tool", "docs/replay-fixture-coverage.json"])
    run_quiet(["python3", "-m", "json.tool", "parser/reference-demos.json"])
    run(["python3", "-m", "unittest", "discover", "-s", "scripts/tests", "-p", "test_*.py", "-v"])
    run(["python3", "scripts/write-deployment-manifest.py"])
    for cmd in CI_SAFE_AUDITS:
        run(cmd)

    print("local CI-safe checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
