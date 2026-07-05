#!/usr/bin/env python3
"""Audit match-review controls that are easy to regress visually."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MATCH_VIEWER = ROOT / "desktop" / "src" / "app" / "match" / "MatchViewer.tsx"
BROWSER_API = ROOT / "desktop" / "src" / "lib" / "api.ts"
BROWSER_BACKEND = ROOT / "desktop" / "src" / "lib" / "backends" / "browser.ts"
BACKEND_TYPES = ROOT / "desktop" / "src" / "lib" / "backends" / "types.ts"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def tracked_source_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "desktop/src"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return [ROOT / line for line in result.stdout.splitlines() if line.endswith((".ts", ".tsx"))]


def balanced_block_after(source: str, marker: str) -> str:
    start = source.find(marker)
    if start < 0:
        raise AssertionError(f"missing marker {marker!r}")
    open_at = source.find("{", start + len(marker))
    if open_at < 0:
        raise AssertionError(f"missing opener after marker {marker!r}")
    depth = 0
    for index in range(open_at, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[open_at + 1:index]
    raise AssertionError(f"unterminated block after marker {marker!r}")


def require(label: str, text: str, snippets: list[str], errors: list[str]) -> None:
    for snippet in snippets:
        if snippet not in text:
            errors.append(f"{label} is missing {snippet!r}")


def assert_fullscreen_is_user_initiated(errors: list[str]) -> None:
    viewer = read(MATCH_VIEWER)
    backend = read(BROWSER_BACKEND)
    toggle = balanced_block_after(viewer, "const toggleFullscreen = useCallback")

    require(
        "toggleFullscreen",
        toggle,
        [
            "document.fullscreenElement ? exitMatchFullscreen : enterMatchFullscreen",
            "void action().catch(() =>",
        ],
        errors,
    )
    require(
        "fullscreen button",
        viewer,
        [
            "onClick={toggleFullscreen}",
            'title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}',
            "isFullscreen ? <Minimize2",
            ": <Maximize2",
        ],
        errors,
    )
    require(
        "browser fullscreen backend",
        backend,
        [
            "document.documentElement.requestFullscreen?.()",
            "document.exitFullscreen?.()",
            "if (document.fullscreenElement) return",
            "if (!document.fullscreenElement) return",
        ],
        errors,
    )

    for path in tracked_source_files():
        text = read(path)
        rel = path.relative_to(ROOT)
        if path == MATCH_VIEWER:
            if text.count("enterMatchFullscreen") != 2:
                errors.append(f"{rel} must reference enterMatchFullscreen only in the import and toggle handler")
            if text.count("exitMatchFullscreen") != 2:
                errors.append(f"{rel} must reference exitMatchFullscreen only in the import and toggle handler")
            if "requestFullscreen" in text or "exitFullscreen" in text:
                errors.append(f"{rel} must use the backend fullscreen abstraction, not browser fullscreen directly")
            continue
        if path in {BROWSER_API, BROWSER_BACKEND, BACKEND_TYPES}:
            continue
        if re.search(r"\b(?:enterMatchFullscreen|requestFullscreen|exitMatchFullscreen|exitFullscreen)\b", text):
            errors.append(f"{rel} contains fullscreen control outside the explicit match-review button path")


def assert_zoom_controls(errors: list[str]) -> None:
    viewer = read(MATCH_VIEWER)
    require(
        "map zoom controls",
        viewer,
        [
            "const [mapZoom, setMapZoom] = useState(1)",
            "const [mapPan, setMapPan] = useState({ x: 0, y: 0 })",
            "const setClampedZoom = useCallback",
            "clamp(nextZoom, MIN_MAP_ZOOM, MAX_MAP_ZOOM)",
            "onClick={() => setClampedZoom(mapZoom - MAP_ZOOM_STEP)}",
            "onClick={() => setClampedZoom(mapZoom + MAP_ZOOM_STEP)}",
            "{Math.round(mapZoom * 100)}%",
            'title="Zoom out"',
            'title="Zoom in"',
            "if (tool !== \"none\" || mapZoom <= 1) return",
            "clampMapPan(",
        ],
        errors,
    )


def main() -> None:
    errors: list[str] = []
    assert_fullscreen_is_user_initiated(errors)
    assert_zoom_controls(errors)
    if errors:
        raise AssertionError("match controls audit failed: " + "; ".join(errors))
    print("match controls audit passed")


if __name__ == "__main__":
    main()
