#!/usr/bin/env python3
"""Audit public asset references used by the browser replay UI.

Missing icons or radar assets do not necessarily break the build, but they make
weapons, utility, HUD equipment, or maps disappear at runtime. This check keeps
literal public paths and weapon icon mappings tied to actual files.
"""

from __future__ import annotations

import re
import struct
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "desktop" / "public"
ICONS_TS = ROOT / "desktop" / "src" / "lib" / "icons.ts"
MAPS_TS = ROOT / "desktop" / "src" / "lib" / "maps.ts"

PUBLIC_PATH_RE = re.compile(r"""["'`](/(?:icons|logo|app-icon|favicon|cs2lens-maps|radars)[^"'`$]*)["'`]""")
ICON_MAP_VALUE_RE = re.compile(r"""["'][^"']+["']\s*:\s*["']([^"']+)["']""")
CALIB_RE = re.compile(r"(de_[a-z0-9_]+):\s*\{\s*posX:")


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "desktop/src"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return [line for line in result.stdout.splitlines() if line]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as f:
        header = f.read(24)
    if len(header) < 24 or not header.startswith(b"\x89PNG\r\n\x1a\n"):
        raise AssertionError(f"{path.relative_to(ROOT)} is not a valid PNG")
    return struct.unpack(">II", header[16:24])


def source_public_paths() -> set[str]:
    paths: set[str] = set()
    for rel in tracked_files():
        if rel.startswith("desktop/src/wasm/") or not rel.endswith((".ts", ".tsx", ".js", ".jsx")):
            continue
        for match in PUBLIC_PATH_RE.finditer(read(ROOT / rel)):
            paths.add(match.group(1))
    return paths


def weapon_icon_paths() -> set[str]:
    icons = read(ICONS_TS)
    paths: set[str] = set()
    map_body_match = re.search(r"WEAPON_ICON_MAP:[^{]+=\s*\{(?P<body>.*?)\};", icons, re.S)
    if not map_body_match:
        raise AssertionError("could not parse WEAPON_ICON_MAP from desktop/src/lib/icons.ts")
    for value in ICON_MAP_VALUE_RE.findall(map_body_match.group("body")):
        paths.add(f"/icons/{value}.svg")
    return paths


def calibrated_map_paths() -> set[str]:
    maps = set(CALIB_RE.findall(read(MAPS_TS)))
    if not maps:
        raise AssertionError("could not parse calibrated maps from desktop/src/lib/maps.ts")
    return {f"/cs2lens-maps/{map_name}.png" for map_name in maps}


def assert_asset_exists(path: str) -> list[str]:
    errors: list[str] = []
    fs_path = PUBLIC / path.lstrip("/")
    if not fs_path.exists():
        return [f"missing public asset {path}"]
    if fs_path.stat().st_size <= 0:
        errors.append(f"public asset {path} is empty")
    if fs_path.suffix == ".svg":
        text = fs_path.read_text(encoding="utf-8", errors="replace")
        if "<svg" not in text or "</svg>" not in text:
            errors.append(f"public SVG {path} does not contain a complete <svg> document")
        prefix = text.lstrip()[:16].lower()
        if not (prefix.startswith("<?xml") or prefix.startswith("<svg")):
            errors.append(f"public SVG {path} has unexpected leading data")
    elif fs_path.suffix == ".png":
        width, height = png_size(fs_path)
        if width <= 0 or height <= 0:
            errors.append(f"public PNG {path} has invalid dimensions {width}x{height}")
    return errors


def main() -> None:
    paths = source_public_paths() | weapon_icon_paths() | calibrated_map_paths()
    errors: list[str] = []
    for path in sorted(paths):
        errors.extend(assert_asset_exists(path))
    if errors:
        raise AssertionError("public asset audit failed: " + "; ".join(errors))
    print(f"public asset audit passed: {len(paths)} referenced assets checked")


if __name__ == "__main__":
    main()
