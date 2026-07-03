#!/usr/bin/env python3
import argparse
import json
import re
import sys
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True, help="Release tag, e.g. v0.1.27")
    parser.add_argument("--root", default=".", help="Repository root")
    args = parser.parse_args()

    tag = args.tag.strip()
    if not tag.startswith("v"):
        print(f"::error::release tag must start with v, got {tag}")
        return 1
    expected = tag[1:]
    if not re.fullmatch(r"\d+\.\d+\.\d+", expected):
        print(f"::error::tag {tag} does not look like vMAJOR.MINOR.PATCH")
        return 1

    return validate_manifests(Path(args.root).resolve(), expected)


if __name__ == "__main__":
    sys.exit(main())
