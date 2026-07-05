#!/usr/bin/env python3
"""Audit match-review controls that are easy to regress visually."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MATCH_VIEWER = ROOT / "desktop" / "src" / "app" / "match" / "MatchViewer.tsx"
MATCH_PAGE = ROOT / "desktop" / "src" / "app" / "match" / "page.tsx"
BROWSER_API = ROOT / "desktop" / "src" / "lib" / "api.ts"
BROWSER_BACKEND = ROOT / "desktop" / "src" / "lib" / "backends" / "browser.ts"
BACKEND_TYPES = ROOT / "desktop" / "src" / "lib" / "backends" / "types.ts"
REPLAY_STORE = ROOT / "desktop" / "src" / "lib" / "replay-store.ts"


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
    api = read(BROWSER_API)
    backend = read(BROWSER_BACKEND)
    backend_types = read(BACKEND_TYPES)
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
        "fullscreen state sync",
        viewer,
        [
            "const [isFullscreen, setIsFullscreen] = useState(false)",
            "const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))",
            "onFullscreenChange();",
            'document.addEventListener("fullscreenchange", onFullscreenChange)',
            'document.removeEventListener("fullscreenchange", onFullscreenChange)',
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
    require(
        "fullscreen public API",
        api,
        [
            "export async function enterMatchFullscreen(): Promise<void>",
            "return getBackend().shell.enterMatchFullscreen();",
            "export async function exitMatchFullscreen(): Promise<void>",
            "return getBackend().shell.exitMatchFullscreen();",
        ],
        errors,
    )
    require(
        "fullscreen backend type",
        backend_types,
        [
            "enterMatchFullscreen(): Promise<void>;",
            "exitMatchFullscreen(): Promise<void>;",
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


def assert_review_modes(errors: list[str]) -> None:
    viewer = read(MATCH_VIEWER)
    run_condensed = balanced_block_after(viewer, "const runCondensedOverlay = useCallback")
    require(
        "review mode state",
        viewer,
        [
            'type ReviewMode = "classic" | "condensed"',
            'const [reviewMode, setReviewMode] = useState<ReviewMode>("classic")',
            'const condensedMode = reviewMode === "condensed"',
            '["classic", "Classique"]',
            '["condensed", "Condensé"]',
            "setReviewMode(mode)",
            'if (mode === "classic") clearHabitOverlay()',
            "void runCondensedOverlay(effectiveCondensedPlayerValue)",
        ],
        errors,
    )
    require(
        "condensed replay builder",
        run_condensed,
        [
            'const [scopeKind, scopeId] = playerValue.split(":")',
            'const playerId = scopeKind === "player" ? Number(scopeId) : NaN',
            "invalidateHabitRun()",
            "setHabitLoading(false)",
            'setHabitStatus("Loading rounds…")',
            "setHabitOverlay(null)",
            "setDurationOverride(null)",
            "setPlaying(false)",
            "setTime(0)",
            "for (let i = 0; i < currentMatch.rounds.length; i++)",
            "const round = await loadRoundForHabits(currentMatch.rounds[i])",
            "const replay = buildHabitReplayRound(round, playerId, label, DEFAULT_HABIT_TYPES)",
            "if (replay) replays.push(replay)",
            'const overlay: HabitOverlay = { label, mode: "replay", trails: [], replays }',
            "setDurationOverride(duration || null)",
            'setHabitStatus(`${replays.length} rounds`)',
        ],
        errors,
    )
    require(
        "condensed replay dependencies",
        viewer,
        [
            "}, [invalidateHabitRun, loadRoundForHabits, setDurationOverride, setHabitOverlay, setPlaying, setTime]);",
        ],
        errors,
    )
    require(
        "condensed player selector",
        viewer,
        [
            "const condensedPlayerOptions = match.players.map((player) => ({",
            "value: `player:${player.steamId}`",
            "const effectiveCondensedPlayerValue = condensedPlayerOptions.some",
            "{condensedMode && (",
            "<select",
            "value={effectiveCondensedPlayerValue}",
            "setCondensedPlayerValue(event.target.value)",
            "void runCondensedOverlay(event.target.value)",
            "condensedPlayerOptions.map((option)",
        ],
        errors,
    )
    require(
        "classic versus condensed surfaces",
        viewer,
        [
            "{!condensedMode && (",
            '<PlayerHUD side="CT" />',
            '<PlayerHUD side="T" />',
            "{!condensedMode && <RoundClock />}",
            "{!condensedMode && <KillFeed />}",
            "{!condensedMode && <RoundList />}",
            "<MapRenderer size={innerSize} condensed={condensedMode} />",
            "{!condensedMode && (",
            "<DrawingLayer",
            "<DrawingToolbar",
            "habitOverlay.mode === \"replay\"",
            '`${habitOverlay.replays?.length ?? 0} rounds`',
        ],
        errors,
    )


def assert_match_identity_resets(errors: list[str]) -> None:
    viewer = read(MATCH_VIEWER)
    page = read(MATCH_PAGE)
    replay_store = read(REPLAY_STORE)
    require(
        "match identity guard",
        viewer,
        [
            "const storedMatch = useReplay((s) => s.match)",
            "const storedMatchId = useReplay((s) => s.matchId)",
            "const match = storedMatchId === id ? storedMatch : null",
            "if (loading || (!err && storedMatchId !== id))",
        ],
        errors,
    )
    require(
        "match page remount",
        page,
        [
            "const id = params.get(\"id\") ?? \"\"",
            "<MatchViewer key={id} id={id} visualTest={visualTest} />",
        ],
        errors,
    )
    require(
        "replay store setMatch reset",
        replay_store,
        [
            "setMatch: (id, m) => set({ matchId: id, match: m, currentRoundIdx: 0, time: 0, playing: false, speed: 1, durationOverride: null, habitOverlay: null })",
        ],
        errors,
    )
    require(
        "replay store duration override clamp",
        replay_store,
        [
            "setDurationOverride: (duration) => set((s) => {",
            "const roundDuration = s.match?.rounds[s.currentRoundIdx]?.duration ?? s.time",
            "const maxTime = duration ?? roundDuration",
            "return { durationOverride: duration, time: Math.min(s.time, maxTime) }",
        ],
        errors,
    )


def main() -> None:
    errors: list[str] = []
    assert_fullscreen_is_user_initiated(errors)
    assert_zoom_controls(errors)
    assert_review_modes(errors)
    assert_match_identity_resets(errors)
    if errors:
        raise AssertionError("match controls audit failed: " + "; ".join(errors))
    print("match controls audit passed")


if __name__ == "__main__":
    main()
