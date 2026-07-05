#!/usr/bin/env python3
"""Audit that browser demo parsing stays local-only.

The web app must parse user-selected demos on the user's machine. This static
audit blocks easy regressions where import/parsing code starts using network
APIs or stops routing through the browser Worker/WASM/IndexedDB path.
"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "desktop" / "src" / "lib" / "backends"
API_TS = ROOT / "desktop" / "src" / "lib" / "api.ts"
WORKER_DIR = ROOT / "desktop" / "src" / "workers"

LOCALITY_FILES = [
    API_TS,
    BACKEND_DIR / "index.ts",
    BACKEND_DIR / "browser.ts",
    BACKEND_DIR / "browser-store.ts",
    BACKEND_DIR / "types.ts",
    WORKER_DIR / "web-parser.worker.ts",
]

FORBIDDEN_NETWORK_PATTERNS = {
    "fetch": re.compile(r"\bfetch\s*\("),
    "XMLHttpRequest": re.compile(r"\bXMLHttpRequest\b"),
    "sendBeacon": re.compile(r"\bsendBeacon\s*\("),
    "WebSocket": re.compile(r"\bWebSocket\b"),
    "EventSource": re.compile(r"\bEventSource\b"),
}

REQUIRED_SNIPPETS = {
    BACKEND_DIR / "index.ts": [
        "createBrowserBackend",
    ],
    BACKEND_DIR / "browser.ts": [
        "source.file.arrayBuffer()",
        "new Worker",
        "web-parser.worker.ts",
        "worker.postMessage",
        "[buffer]",
        "storage: \"indexeddb\"",
    ],
    WORKER_DIR / "web-parser.worker.ts": [
        "parse_demo_bytes_to_json",
        "await initParser()",
        "saveParsedMatch",
        "crypto.randomUUID()",
        "Parsing demo locally",
    ],
    BACKEND_DIR / "browser-store.ts": [
        "indexedDB.open",
        'const MATCH_STORE = "matches"',
        'const ROUND_STORE = "rounds"',
        "function stripRoundPayload",
        "frames: []",
        "projectileFrames: []",
    ],
}


def read(path: Path) -> str:
    if not path.exists():
        raise AssertionError(f"missing required browser parser file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def assert_no_network_apis() -> None:
    errors: list[str] = []
    for path in LOCALITY_FILES:
        text = read(path)
        for label, pattern in FORBIDDEN_NETWORK_PATTERNS.items():
            if pattern.search(text):
                errors.append(f"{path.relative_to(ROOT)} uses forbidden network API {label}")
    if errors:
        raise AssertionError("; ".join(errors))


def assert_required_local_path() -> None:
    errors: list[str] = []
    for path, snippets in REQUIRED_SNIPPETS.items():
        text = read(path)
        for snippet in snippets:
            if snippet not in text:
                errors.append(f"{path.relative_to(ROOT)} is missing local parser invariant {snippet!r}")
    index_text = read(BACKEND_DIR / "index.ts")
    if "tauri" in index_text.lower() or "native" in index_text.lower():
        errors.append("desktop/src/lib/backends/index.ts references non-browser backend routing")
    if errors:
        raise AssertionError("; ".join(errors))


def main() -> None:
    assert_no_network_apis()
    assert_required_local_path()
    print(f"browser parser locality audit passed: {len(LOCALITY_FILES)} files checked")


if __name__ == "__main__":
    main()
