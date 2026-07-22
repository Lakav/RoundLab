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
HOME_TSX = ROOT / "desktop" / "src" / "app" / "page.tsx"
WORKER_DIR = ROOT / "desktop" / "src" / "workers"
WORKER_TS = WORKER_DIR / "web-parser.worker.ts"
ZSTD_WORKER_TS = WORKER_DIR / "zstd-decompress.worker.ts"

LOCALITY_FILES = [
    API_TS,
    BACKEND_DIR / "index.ts",
    BACKEND_DIR / "browser.ts",
    BACKEND_DIR / "browser-store.ts",
    BACKEND_DIR / "types.ts",
    WORKER_TS,
    ZSTD_WORKER_TS,
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
    WORKER_TS: [
        "parse_demo_bytes_to_json",
        "await initParser()",
        "zstd-decompress.worker.ts",
        "worker.terminate()",
        "saveParsedMatch",
        "crypto.randomUUID()",
        "Parsing demo locally",
    ],
    ZSTD_WORKER_TS: [
        "ZSTDDecoder",
        'event.data.type !== "decompress"',
        "decoder.decode",
        "[buffer]",
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


def assert_worker_returns_id_only() -> None:
    worker = read(WORKER_TS)
    backend = read(BACKEND_DIR / "browser.ts")
    backend_types = read(BACKEND_DIR / "types.ts")
    api = read(API_TS)
    home = read(HOME_TSX)
    errors: list[str] = []
    required = {
        "worker parse return type": (worker, "async function parseDemo(request: ParseRequest): Promise<string>"),
        "worker parses JSON inside worker": (worker, "const data = JSON.parse(json) as MatchData"),
        "worker stores parsed match before resolving": (
            worker,
            "await saveParsedMatch(id, displayName(request.name), request.size, data)",
        ),
        "worker returns the stored id": (worker, "return id;"),
        "worker done message is id-only": (worker, 'self.postMessage({ type: "done", id })'),
        "browser backend parse return type": (backend, "async parseDemo(source: DemoSource, options: ParseOptions = { mode: \"fast\" }): Promise<string>"),
        "browser backend done message type": (backend, '| { type: "done"; id: string }'),
        "browser backend resolves done id": (backend, 'else if (data.type === "done") resolve(data.id)'),
        "backend parser contract returns id": (backend_types, "parseDemo(source: DemoSource, options?: ParseOptions): Promise<string>"),
        "public parser api returns id": (api, "): Promise<string>"),
        "home import treats parse result as id": (home, "const id = await parseDemo(source, { mode });"),
        "home reloads summary from IndexedDB": (home, "const items = await listMatches().catch(() => [] as MatchSummary[]);"),
        "home finds parsed summary by id": (home, "items.find((m) => m.id === id)"),
    }
    for label, (source, snippet) in required.items():
        if snippet not in source:
            errors.append(f"{label} is missing {snippet!r}")

    done_messages = re.findall(r"postMessage\s*\(\s*\{[^)]*type:\s*[\"']done[\"'][^)]*\}\s*\)", worker, re.DOTALL)
    if done_messages != ['postMessage({ type: "done", id })']:
        errors.append("worker done postMessage must return only { type: \"done\", id }")
    forbidden_done_payload = re.search(
        r"postMessage\s*\(\s*\{[^)]*type:\s*[\"']done[\"'][^)]*\b(data|match|metadata|rounds|json|payload)\b",
        worker,
        re.DOTALL,
    )
    if forbidden_done_payload:
        errors.append("worker done postMessage appears to include parsed match payload data")

    if errors:
        raise AssertionError("; ".join(errors))


def main() -> None:
    assert_no_network_apis()
    assert_required_local_path()
    assert_worker_returns_id_only()
    print(f"browser parser locality audit passed: {len(LOCALITY_FILES)} files checked")


if __name__ == "__main__":
    main()
