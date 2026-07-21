#!/usr/bin/env python3
import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise SystemExit(f"missing required file: {path}")


def package_lock_version(path: Path) -> str:
    data = read_json(path)
    version = data.get("version")
    if isinstance(version, str):
        return version
    packages = data.get("packages")
    if isinstance(packages, dict):
        root = packages.get("")
        if isinstance(root, dict) and isinstance(root.get("version"), str):
            return root["version"]
    raise SystemExit(f"could not find root version in {path}")


def validate_manifests(root: Path, expected: str) -> int:
    checks = {
        "desktop/package.json": read_json(root / "desktop/package.json").get("version"),
    }

    package_lock = root / "desktop/package-lock.json"
    if package_lock.exists():
        checks["desktop/package-lock.json"] = package_lock_version(package_lock)

    failed = 0
    print(f"release tag version: {expected}")
    for name, actual in checks.items():
        print(f"{name}: {actual}")
        if actual != expected:
            print(f"::error file={name}::expected {expected}, got {actual}")
            failed = 1
    return failed


def validate_recipe(root: Path) -> int:
    source_name = "docs/rncp-bloc2/evidence/03-plan-tests-recette.md"
    source = root / source_name
    scenarios: list[tuple[str, str]] = []
    for line in source.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| REC-"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 9:
            print(f"::error file={source_name}::invalid recipe row with {len(cells)} columns")
            return 1
        scenarios.append((cells[0], cells[6]))

    counts = Counter(status for _, status in scenarios)
    print(
        "release recipe: "
        f"OK={counts['OK']} NOK={counts['NOK']} BLOQUÉ={counts['BLOQUÉ']}"
    )
    if len(scenarios) != 16 or counts != Counter({"OK": 16}):
        print(
            f"::error file={source_name}::release requires 16 OK scenarios and no NOK/BLOQUÉ"
        )
        return 1
    return 0


def validate_human_evidence(root: Path) -> int:
    commands = [
        [sys.executable, "scripts/audit-rgaa-grid.py", "--require-complete"],
        [sys.executable, "scripts/audit-user-validation.py", "--require-complete"],
    ]
    failed = 0
    for command in commands:
        print(f"$ {' '.join(command)}")
        result = subprocess.run(command, cwd=root, check=False, text=True, capture_output=True)
        if result.stdout:
            print(result.stdout.rstrip())
        if result.stderr:
            error_lines = [line for line in result.stderr.splitlines() if line.strip()]
            if error_lines:
                print(error_lines[-1])
        if result.returncode != 0:
            failed = 1
    if failed:
        print("::error::release requires complete RGAA and real user-session evidence")
    return failed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True, help="Release tag, e.g. v0.1.27")
    parser.add_argument("--root", default=".", help="Repository root")
    parser.add_argument(
        "--manifest-only",
        action="store_true",
        help="only compare tag and package versions; this does not authorize a release",
    )
    args = parser.parse_args()

    tag = args.tag.strip()
    if not tag.startswith("v"):
        print(f"::error::release tag must start with v, got {tag}")
        return 1
    expected = tag[1:]
    if not re.fullmatch(r"\d+\.\d+\.\d+", expected):
        print(f"::error::tag {tag} does not look like vMAJOR.MINOR.PATCH")
        return 1

    root = Path(args.root).resolve()
    failed = validate_manifests(root, expected)
    if not args.manifest_only:
        failed |= validate_recipe(root)
        failed |= validate_human_evidence(root)
    return failed


if __name__ == "__main__":
    sys.exit(main())
