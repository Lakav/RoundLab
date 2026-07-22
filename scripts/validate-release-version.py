#!/usr/bin/env python3
"""Validate that a release tag matches the web package and is still unused."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True, help="Release tag, e.g. v0.2.0")
    parser.add_argument("--root", default=".", help="Repository root")
    args = parser.parse_args()

    tag = args.tag.strip()
    if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
        print(f"::error::tag {tag!r} must use vMAJOR.MINOR.PATCH")
        return 1

    root = Path(args.root).resolve()
    package_path = root / "desktop/package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    expected = tag[1:]
    actual = package.get("version")
    print(f"release tag version: {expected}")
    print(f"desktop/package.json: {actual}")
    if actual != expected:
        print(f"::error file=desktop/package.json::expected {expected}, got {actual}")
        return 1

    result = subprocess.run(
        ["git", "show-ref", "--verify", "--quiet", f"refs/tags/{tag}"],
        cwd=root,
        check=False,
    )
    if result.returncode == 0:
        print(f"::error::release tag {tag} already exists and must not be reused")
        return 1
    if result.returncode != 1:
        print(f"::error::could not determine whether release tag {tag} exists")
        return 1
    print(f"release tag availability: {tag} is absent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
