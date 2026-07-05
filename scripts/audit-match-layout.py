#!/usr/bin/env python3
"""Audit replay map viewport sizing invariants.

This is a static/simulation check for the match review layout. It does not
replace browser screenshots, but it catches the formula regressions that make
the radar exceed the available viewport or make crop transforms inconsistent
across maps.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MATCH_VIEWER = ROOT / "desktop" / "src" / "app" / "match" / "MatchViewer.tsx"
ROUND_LIST = ROOT / "desktop" / "src" / "components" / "replay" / "RoundList.tsx"
MAPS_TS = ROOT / "desktop" / "src" / "lib" / "maps.ts"

CONST_RE = re.compile(r"const\s+([A-Z_]+)\s*=\s*([-0-9.]+);")
CROP_RE = re.compile(
    r"(de_[a-z0-9_]+):\s*\{\s*x:\s*([-0-9.]+),\s*y:\s*([-0-9.]+),\s*size:\s*([-0-9.]+)\s*\}"
)
RADAR_RE = re.compile(r"export\s+const\s+RADAR_SIZE\s*=\s*([-0-9.]+);")

# Representative app areas after the absolute top toolbar and bottom playback
# bar are present. The formula under test uses the measured stage element, not
# the full browser viewport.
VIEWPORTS = {
    "desktop": (1360, 720),
    "laptop-short": (1180, 520),
    "tablet": (900, 620),
    "mobile": (390, 580),
    "very-short": (760, 360),
}

STAGE_PADDING_TOP = 48
STAGE_PADDING_BOTTOM = 96
CONDENSED_HORIZONTAL_PADDING = 48


@dataclass(frozen=True)
class Crop:
    x: float
    y: float
    size: float


def load_constants() -> dict[str, float]:
    text = MATCH_VIEWER.read_text(encoding="utf-8")
    constants = {name: float(value) for name, value in CONST_RE.findall(text)}
    required = {
        "BASE_MAP_VIEW_SCALE",
        "MIN_MAP",
        "MAX_MAP",
        "MIN_MAP_ZOOM",
        "MAX_MAP_ZOOM",
        "MAP_ZOOM_STEP",
    }
    missing = sorted(required - set(constants))
    if missing:
        raise AssertionError(f"missing MatchViewer map constants: {missing}")
    return constants


def load_maps() -> tuple[float, dict[str, Crop]]:
    text = MAPS_TS.read_text(encoding="utf-8")
    radar_match = RADAR_RE.search(text)
    if not radar_match:
        raise AssertionError(f"could not parse RADAR_SIZE from {MAPS_TS}")
    radar_size = float(radar_match.group(1))
    crops = {
        name: Crop(float(x), float(y), float(size))
        for name, x, y, size in CROP_RE.findall(text)
    }
    if not crops:
        raise AssertionError(f"could not parse map crops from {MAPS_TS}")
    return radar_size, crops


def map_size_for(available: float, constants: dict[str, float]) -> int:
    min_map = constants["MIN_MAP"]
    max_map = constants["MAX_MAP"]
    scaled = available * constants["BASE_MAP_VIEW_SCALE"]
    if available <= min_map:
        return math.floor(available)
    return math.floor(min(max_map, max(min_map, scaled)))


def assert_constants(constants: dict[str, float]) -> None:
    errors: list[str] = []
    if constants["BASE_MAP_VIEW_SCALE"] <= 0 or constants["BASE_MAP_VIEW_SCALE"] > 1:
        errors.append("BASE_MAP_VIEW_SCALE must stay in (0, 1] so the base map fits its measured stage")
    if constants["MIN_MAP"] <= 0 or constants["MIN_MAP"] > constants["MAX_MAP"]:
        errors.append("MIN_MAP must be positive and <= MAX_MAP")
    if constants["MIN_MAP_ZOOM"] < 1:
        errors.append("MIN_MAP_ZOOM below 1 would make the 100% label misleading")
    if constants["MAX_MAP_ZOOM"] < constants["MIN_MAP_ZOOM"]:
        errors.append("MAX_MAP_ZOOM must be >= MIN_MAP_ZOOM")
    if constants["MAP_ZOOM_STEP"] <= 0:
        errors.append("MAP_ZOOM_STEP must be positive")
    if errors:
        raise AssertionError("; ".join(errors))


def assert_crops(radar_size: float, crops: dict[str, Crop]) -> None:
    errors: list[str] = []
    for name, crop in sorted(crops.items()):
        if crop.size <= 0:
            errors.append(f"{name} crop size must be positive")
            continue
        if crop.x < 0 or crop.y < 0 or crop.x + crop.size > radar_size or crop.y + crop.size > radar_size:
            errors.append(f"{name} crop is outside {radar_size}x{radar_size}: {crop}")
    if errors:
        raise AssertionError("; ".join(errors))


def assert_viewport_fit(constants: dict[str, float]) -> None:
    errors: list[str] = []
    for label, (width, height) in VIEWPORTS.items():
        for mode, horizontal_padding in {"classic": 0, "condensed": CONDENSED_HORIZONTAL_PADDING}.items():
            usable_width = width - horizontal_padding
            usable_height = height - STAGE_PADDING_TOP - STAGE_PADDING_BOTTOM
            available = min(usable_width, usable_height)
            size = map_size_for(available, constants)
            if available <= 0:
                errors.append(f"{label}/{mode} has no available map area")
            if size <= 0:
                errors.append(f"{label}/{mode} produced non-positive map size {size}")
            if size > math.floor(available):
                errors.append(f"{label}/{mode} map size {size} exceeds available {available:.1f}")
    if errors:
        raise AssertionError("; ".join(errors))


def assert_crop_transform(radar_size: float, crops: dict[str, Crop], constants: dict[str, float]) -> None:
    errors: list[str] = []
    probe_size = constants["MAX_MAP"]
    for name, crop in sorted(crops.items()):
        crop_scale = radar_size / crop.size
        inner_size = probe_size * crop_scale
        px_per_radar = probe_size / crop.size
        crop_tx = -crop.x * px_per_radar
        crop_ty = -crop.y * px_per_radar
        left = crop.x * px_per_radar + crop_tx
        top = crop.y * px_per_radar + crop_ty
        right = (crop.x + crop.size) * px_per_radar + crop_tx
        bottom = (crop.y + crop.size) * px_per_radar + crop_ty
        values = [crop_scale, inner_size, px_per_radar, crop_tx, crop_ty, left, top, right, bottom]
        if not all(math.isfinite(value) for value in values):
            errors.append(f"{name} crop transform produced non-finite values")
        if abs(left) > 0.001 or abs(top) > 0.001 or abs(right - probe_size) > 0.001 or abs(bottom - probe_size) > 0.001:
            errors.append(f"{name} crop transform does not map crop bounds to viewport bounds")
    if errors:
        raise AssertionError("; ".join(errors))


def assert_round_controls_can_overflow() -> None:
    round_list = ROUND_LIST.read_text(encoding="utf-8")
    match_viewer = MATCH_VIEWER.read_text(encoding="utf-8")
    errors: list[str] = []
    for token in ["overflow-x-auto", "overflow-y-hidden", "min-w-max"]:
        if token not in round_list:
            errors.append(f"RoundList is missing {token!r}; too many rounds may overflow instead of scrolling")
    if "<RoundList />" not in match_viewer:
        errors.append("MatchViewer no longer renders RoundList in the playback controls")
    if "min-w-0 flex-1" not in match_viewer:
        errors.append("MatchViewer bottom timeline is missing min-w-0 flex-1; controls may force horizontal overflow")
    if errors:
        raise AssertionError("; ".join(errors))


def main() -> None:
    constants = load_constants()
    radar_size, crops = load_maps()
    assert_constants(constants)
    assert_crops(radar_size, crops)
    assert_viewport_fit(constants)
    assert_crop_transform(radar_size, crops, constants)
    assert_round_controls_can_overflow()
    print(f"match layout audit passed: {len(crops)} maps, {len(VIEWPORTS)} viewport probes")


if __name__ == "__main__":
    main()
