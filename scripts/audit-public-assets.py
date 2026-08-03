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
PUBLIC = ROOT / "web" / "public"
ICONS_TS = ROOT / "web" / "src" / "lib" / "icons.ts"
MAPS_TS = ROOT / "web" / "src" / "lib" / "maps.ts"
MAP_RENDERER = ROOT / "web" / "src" / "components" / "replay" / "MapRenderer.tsx"
MAP_RENDERER_ICONS = ROOT / "web" / "src" / "components" / "replay" / "map-renderer-icons.ts"

PUBLIC_PATH_RE = re.compile(r"""["'`](/(?:icons|logo|app-icon|favicon|cs2lens-maps|radars)[^"'`$]*)["'`]""")
ICON_MAP_VALUE_RE = re.compile(r"""["'][^"']+["']\s*:\s*["']([^"']+)["']""")
ICON_LITERAL_RE = re.compile(r"""["'](/icons/[^"'`$]+\.svg)["']""")
PRELOADABLE_ICON_SET_RE = re.compile(r"const PRELOADABLE_ICON_PATHS = new Set\(\[(?P<body>.*?)\]\);", re.S)
CALIB_RE = re.compile(
    r"(de_[a-z0-9_]+):\s*\{\s*posX:\s*([-0-9.]+),\s*posY:\s*([-0-9.]+),\s*scale:\s*([-0-9.]+)\s*\}"
)
CROP_RE = re.compile(
    r"(de_[a-z0-9_]+):\s*\{\s*x:\s*([-0-9.]+),\s*y:\s*([-0-9.]+),\s*size:\s*([-0-9.]+)\s*\}"
)
VERTICAL_SECTION_RE = re.compile(
    r"(de_[a-z0-9_]+):\s*\[(?P<body>.*?)\]",
    re.S,
)


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "web/src"],
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
        if rel.startswith("web/src/wasm/") or not rel.endswith((".ts", ".tsx", ".js", ".jsx")):
            continue
        for match in PUBLIC_PATH_RE.finditer(read(ROOT / rel)):
            paths.add(match.group(1))
    return paths


def weapon_icon_paths() -> set[str]:
    icons = read(ICONS_TS)
    paths: set[str] = set()
    map_body_match = re.search(r"WEAPON_ICON_MAP:[^{]+=\s*\{(?P<body>.*?)\};", icons, re.S)
    if not map_body_match:
        raise AssertionError("could not parse WEAPON_ICON_MAP from web/src/lib/icons.ts")
    for value in ICON_MAP_VALUE_RE.findall(map_body_match.group("body")):
        paths.add(f"/icons/{value}.svg")
    paths.update(ICON_LITERAL_RE.findall(icons))
    return paths


def preloadable_icon_paths() -> set[str]:
    icon_loader = read(MAP_RENDERER_ICONS)
    match = PRELOADABLE_ICON_SET_RE.search(icon_loader)
    if not match:
        raise AssertionError(
            "could not parse PRELOADABLE_ICON_PATHS from map-renderer-icons.ts"
        )
    return set(ICON_LITERAL_RE.findall(match.group("body")))


def calibrated_map_paths() -> set[str]:
    maps = set(calibrated_maps())
    if not maps:
        raise AssertionError("could not parse calibrated maps from web/src/lib/maps.ts")
    paths = {f"/cs2lens-maps/{map_name}.png" for map_name in maps}
    paths.update(f"/cs2lens-maps/{map_name}_lower.png" for map_name in multi_level_maps())
    return paths


def calibrated_maps() -> dict[str, tuple[float, float, float]]:
    return {
        name: (float(pos_x), float(pos_y), float(scale))
        for name, pos_x, pos_y, scale in CALIB_RE.findall(read(MAPS_TS))
    }


def cropped_maps() -> dict[str, tuple[float, float, float]]:
    return {
        name: (float(x), float(y), float(size))
        for name, x, y, size in CROP_RE.findall(read(MAPS_TS))
    }


def multi_level_maps() -> set[str]:
    return {match.group(1) for match in VERTICAL_SECTION_RE.finditer(read(MAPS_TS))}


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


def assert_map_contract() -> list[str]:
    errors: list[str] = []
    maps_text = read(MAPS_TS)
    renderer = read(MAP_RENDERER)
    calibrations = calibrated_maps()
    crops = cropped_maps()
    if set(calibrations) != set(crops):
        errors.append(f"MAP_CALIBRATION and MAP_CROP map sets differ: calibration={sorted(calibrations)}, crop={sorted(crops)}")
    if 'src={`/cs2lens-maps/${map}.png`}' in renderer:
        errors.append("MapRenderer must not hard-code only the primary radar image for multi-level maps")
    for token in [
        "radarImagePath(map, radarLayer)",
        "radarLayerForPositions(match.meta.map, radarPositions, \"default\")",
    ]:
        if token not in renderer:
            errors.append(f"MapRenderer radar layer contract is missing {token!r}")
    for rel in tracked_files():
        if rel.startswith("web/src/wasm/") or not rel.endswith((".ts", ".tsx", ".js", ".jsx")):
            continue
        text = read(ROOT / rel)
        if "/radars/" in text:
            errors.append(f"{rel} references legacy /radars assets; replay maps must use /cs2lens-maps")
    legacy_radars = sorted((PUBLIC / "radars").glob("*.png")) if (PUBLIC / "radars").exists() else []
    for asset in legacy_radars:
        errors.append(f"{asset.relative_to(ROOT)} is a legacy radar asset; replay maps must use web/public/cs2lens-maps")
    for map_name, (pos_x, pos_y, scale) in sorted(calibrations.items()):
        if scale <= 0:
            errors.append(f"{map_name} calibration scale must be positive")
        if not all(abs(value) < 10_000 for value in [pos_x, pos_y, scale]):
            errors.append(f"{map_name} calibration values look implausible: posX={pos_x}, posY={pos_y}, scale={scale}")
        asset = PUBLIC / "cs2lens-maps" / f"{map_name}.png"
        if asset.exists():
            width, height = png_size(asset)
            if width != 1024 or height != 1024:
                errors.append(f"/cs2lens-maps/{map_name}.png is {width}x{height}, expected 1024x1024")
        lower_asset = PUBLIC / "cs2lens-maps" / f"{map_name}_lower.png"
        if lower_asset.exists():
            width, height = png_size(lower_asset)
            if width != 1024 or height != 1024:
                errors.append(f"/cs2lens-maps/{map_name}_lower.png is {width}x{height}, expected 1024x1024")
            if map_name not in multi_level_maps():
                errors.append(f"{map_name}_lower.png exists but MAP_VERTICAL_SECTIONS has no {map_name} entry")
    expected_sections = {
        "de_nuke": [
            '{ layer: "default", altitudeMin: -495, altitudeMax: 10000 }',
            '{ layer: "lower", altitudeMin: -10000, altitudeMax: -495 }',
        ],
        "de_vertigo": [
            '{ layer: "default", altitudeMin: 11700, altitudeMax: 20000 }',
            '{ layer: "lower", altitudeMin: -10000, altitudeMax: 11700 }',
        ],
        "de_train": [
            '{ layer: "default", altitudeMin: -50, altitudeMax: 20000 }',
            '{ layer: "lower", altitudeMin: -5000, altitudeMax: -50 }',
        ],
    }
    for map_name, snippets in expected_sections.items():
        for snippet in snippets:
            if snippet not in maps_text:
                errors.append(f"MAP_VERTICAL_SECTIONS missing official {map_name} snippet {snippet!r}")

    cache = calibrations.get("de_cache")
    if cache is None:
        errors.append("de_cache calibration is missing")
    else:
        pos_x, pos_y, scale = cache
        if (round(pos_x), round(pos_y)) != (-1964, 3250) or not (5.45 <= scale <= 5.47):
            errors.append(f"de_cache calibration drifted from the CS2Lens-aligned values: posX={pos_x}, posY={pos_y}, scale={scale}")
        if "CS2Lens stores Cache" not in maps_text:
            errors.append("de_cache calibration must keep the CS2Lens conversion note")
    return errors


def assert_icon_preload_contract() -> list[str]:
    expected = weapon_icon_paths()
    preloadable = preloadable_icon_paths()
    missing = sorted(expected - preloadable)
    if missing:
        return [
            "PRELOADABLE_ICON_PATHS is missing iconPathFor outputs: " + ", ".join(missing)
        ]
    return []


def main() -> None:
    paths = source_public_paths() | weapon_icon_paths() | calibrated_map_paths()
    errors: list[str] = []
    for path in sorted(paths):
        errors.extend(assert_asset_exists(path))
    errors.extend(assert_map_contract())
    errors.extend(assert_icon_preload_contract())
    if errors:
        raise AssertionError("public asset audit failed: " + "; ".join(errors))
    print(f"public asset audit passed: {len(paths)} referenced assets checked")


if __name__ == "__main__":
    main()
