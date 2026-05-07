#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


SEMVER_RE = re.compile(r"(?<!\d)(\d+\.\d+\.\d+)(?!\d)")


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        raise SystemExit(f"missing required file: {path}")


def cargo_toml_version(path: Path) -> str:
    in_package = False
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if line == "[package]":
            in_package = True
            continue
        if in_package and line.startswith("["):
            break
        if in_package:
            match = re.fullmatch(r'version\s*=\s*"([^"]+)"', line)
            if match:
                return match.group(1)
    raise SystemExit(f"could not find [package] version in {path}")


def cargo_lock_package_version(path: Path, package_name: str) -> str:
    current_name = None
    current_version = None

    def flush() -> str | None:
        if current_name == package_name:
            return current_version
        return None

    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if line == "[[package]]":
            found = flush()
            if found is not None:
                return found
            current_name = None
            current_version = None
            continue
        if line.startswith("name = "):
            current_name = line.split("=", 1)[1].strip().strip('"')
        elif line.startswith("version = "):
            current_version = line.split("=", 1)[1].strip().strip('"')

    found = flush()
    if found is not None:
        return found
    raise SystemExit(f"could not find package {package_name!r} in {path}")


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
        "desktop/src-tauri/tauri.conf.json": read_json(root / "desktop/src-tauri/tauri.conf.json").get("version"),
        "desktop/src-tauri/Cargo.toml": cargo_toml_version(root / "desktop/src-tauri/Cargo.toml"),
        "desktop/src-tauri/Cargo.lock roundlab": cargo_lock_package_version(
            root / "desktop/src-tauri/Cargo.lock", "roundlab"
        ),
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


def semvers_in_name(path: Path) -> list[str]:
    return SEMVER_RE.findall(path.name)


def basename_from_url(value: str) -> str:
    parsed = urlparse(value)
    return Path(parsed.path).name


def walk_latest_json(value: object) -> list[str]:
    urls = []
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "url" and isinstance(child, str):
                urls.append(child)
            else:
                urls.extend(walk_latest_json(child))
    elif isinstance(value, list):
        for child in value:
            urls.extend(walk_latest_json(child))
    return urls


def validate_latest_json(path: Path, expected: str) -> int:
    data = read_json(path)
    failed = 0
    actual_version = data.get("version")
    if actual_version != expected:
        print(f"::error file={path}::latest.json expected version {expected}, got {actual_version}")
        failed = 1

    for url in walk_latest_json(data):
        basename = basename_from_url(url)
        found_versions = SEMVER_RE.findall(basename)
        for found in found_versions:
            if found != expected:
                print(f"::error file={path}::latest.json URL points at {found} asset, expected {expected}: {url}")
                failed = 1
    return failed


def validate_artifacts(root: Path, expected: str) -> int:
    failed = 0
    bundle_files = [p for p in root.glob("**/release/bundle/**/*") if p.is_file()]
    bundle_files += [p for p in root.glob("**/release/bundle/*") if p.is_file()]
    bundle_files = sorted(set(bundle_files))

    if not bundle_files:
        print(f"::error::no bundle artifacts found under {root}")
        return 1

    latest_jsons = []
    for path in bundle_files:
        if path.name == "latest.json":
            latest_jsons.append(path)
        for found in semvers_in_name(path):
            if found != expected:
                print(f"::error file={path}::artifact name contains version {found}, expected {expected}")
                failed = 1

    if not latest_jsons:
        print(f"::error::no latest.json found under {root}")
        failed = 1
    for path in latest_jsons:
        failed |= validate_latest_json(path, expected)

    return failed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tag", required=True, help="Release tag, e.g. v0.1.27")
    parser.add_argument("--root", default=".", help="Repository root")
    parser.add_argument("--artifacts-root", help="Validate built Tauri bundle artifacts under this path")
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
    if args.artifacts_root:
        failed |= validate_artifacts((root / args.artifacts_root).resolve(), expected)
    return failed


if __name__ == "__main__":
    sys.exit(main())
