#!/usr/bin/env python3
"""Run the local browser/static audit suite with the same safe modes as CI.

Do not replace deep local replay/parser validation with this script. It is the
portable check suite: it avoids audit modes that require private demo outputs
such as `.roundlab-compare/full-round-audit-current.json`.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"

PY_COMPILE_TARGETS = [
    "scripts/collect-rncp-bloc2-evidence.py",
    "scripts/audit-browser-import-flow.py",
    "scripts/audit-browser-import-workflow.py",
    "scripts/audit-browser-parser-locality.py",
    "scripts/audit-browser-store-contract.py",
    "scripts/audit-ci-coverage.py",
    "scripts/audit-home-accessibility.py",
    "scripts/audit-match-controls.py",
    "scripts/audit-match-layout.py",
    "scripts/audit-parse-estimate.py",
    "scripts/audit-parser-fidelity.py",
    "scripts/audit-public-assets.py",
    "scripts/audit-reference-snapshots.py",
    "scripts/audit-replay-fixture-coverage.py",
    "scripts/audit-replay-renderer-contract.py",
    "scripts/audit-replay-rendering.py",
    "scripts/audit-security-baseline.py",
    "scripts/audit-static-web-export.py",
    "scripts/audit-static-export-output.py",
    "scripts/audit-web-portability.py",
    "scripts/run-local-ci-checks.py",
    "scripts/validate-release-version.py",
]

CI_SAFE_AUDITS = [
    ["python3", "scripts/audit-web-portability.py"],
    ["python3", "scripts/audit-static-web-export.py"],
    ["python3", "scripts/audit-ci-coverage.py"],
    ["python3", "scripts/audit-browser-parser-locality.py"],
    ["python3", "scripts/audit-browser-import-flow.py"],
    ["python3", "scripts/audit-browser-import-workflow.py"],
    ["python3", "scripts/audit-browser-store-contract.py"],
    ["python3", "scripts/audit-home-accessibility.py"],
    ["python3", "scripts/audit-match-controls.py"],
    ["python3", "scripts/audit-match-layout.py"],
    ["python3", "scripts/audit-parse-estimate.py"],
    ["python3", "scripts/audit-parser-fidelity.py"],
    ["python3", "scripts/audit-public-assets.py"],
    ["python3", "scripts/audit-reference-snapshots.py", "--reference-only"],
    ["python3", "scripts/audit-replay-fixture-coverage.py"],
    ["python3", "scripts/audit-replay-renderer-contract.py"],
    ["python3", "scripts/audit-replay-rendering.py", "--assets-only"],
    ["python3", "scripts/audit-security-baseline.py"],
    ["python3", "scripts/audit-static-export-output.py"],
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
        help="skip pnpm lint/typecheck/build; desktop/out must already be current",
    )
    args = parser.parse_args()

    if not args.skip_frontend:
        run(["pnpm", "audit", "--audit-level", "high"], DESKTOP)
        run(["pnpm", "lint"], DESKTOP)
        run(["pnpm", "exec", "tsc", "--noEmit"], DESKTOP)
        run(["pnpm", "test:coverage"], DESKTOP)
        run(["pnpm", "build"], DESKTOP)
        run(["pnpm", "test:e2e:a11y"], DESKTOP)

    run(["python3", "-m", "py_compile", *PY_COMPILE_TARGETS])
    run_quiet(["python3", "-m", "json.tool", "docs/replay-fixture-coverage.json"])
    run_quiet(["python3", "-m", "json.tool", "parser/reference_demos.json"])
    for cmd in CI_SAFE_AUDITS:
        run(cmd)

    print("local CI-safe checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
