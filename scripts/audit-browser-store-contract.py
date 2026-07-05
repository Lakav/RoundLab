#!/usr/bin/env python3
"""Audit the browser IndexedDB match store contract.

RoundLab's web path must not keep full parsed matches in one browser object.
Metadata stays light, round payloads are stored separately, and match review
loads individual rounds on demand. This static check catches easy regressions in
that contract without pretending to replace browser quota/performance testing.
"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / "desktop" / "src" / "lib" / "backends" / "browser-store.ts"
BACKEND = ROOT / "desktop" / "src" / "lib" / "backends" / "browser.ts"
MATCH_VIEWER = ROOT / "desktop" / "src" / "app" / "match" / "MatchViewer.tsx"
REPLAY_STORE = ROOT / "desktop" / "src" / "lib" / "replay-store.ts"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def function_body(source: str, name: str) -> str:
    match = re.search(rf"(?:export\s+async\s+)?function\s+{re.escape(name)}(?:<[^>]+>)?\s*\(", source)
    if not match:
        raise AssertionError(f"missing function {name}")
    paren = source.find("(", match.end() - 1)
    depth = 0
    end_paren = -1
    for index in range(paren, len(source)):
        char = source[index]
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                end_paren = index
                break
    if end_paren < 0:
        raise AssertionError(f"unterminated parameter list for {name}")
    brace = source.find("{", end_paren)
    if brace < 0:
        raise AssertionError(f"missing function body for {name}")
    depth = 0
    for index in range(brace, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[brace + 1:index]
    raise AssertionError(f"unterminated function body for {name}")


def assert_contains(label: str, source: str, tokens: list[str]) -> list[str]:
    return [f"{label} is missing {token!r}" for token in tokens if token not in source]


def assert_store_schema(store: str) -> list[str]:
    errors: list[str] = []
    errors.extend(
        assert_contains(
            "browser-store schema",
            store,
            [
                'const DB_NAME = "roundlab-web"',
                "const DB_VERSION = 1",
                'const MATCH_STORE = "matches"',
                'const ROUND_STORE = "rounds"',
                "type StoredMatch = MatchSummary &",
                "metadata: MatchData",
                "type StoredRound =",
                "matchId: string",
                "number: number",
                "round: Round",
            ],
        )
    )
    open_body = function_body(store, "openDb")
    errors.extend(
        assert_contains(
            "openDb",
            open_body,
            [
                "indexedDB.open(DB_NAME, DB_VERSION)",
                "db.createObjectStore(MATCH_STORE, { keyPath: \"id\" })",
                "db.createObjectStore(ROUND_STORE, { keyPath: \"key\" })",
                "rounds.createIndex(\"matchId\", \"matchId\", { unique: false })",
            ],
        )
    )
    round_key_body = function_body(store, "roundKey")
    errors.extend(assert_contains("roundKey", round_key_body, ["`${matchId}:${number}`"]))
    return errors


def assert_metadata_is_light(store: str) -> list[str]:
    errors: list[str] = []
    strip_body = function_body(store, "stripRoundPayload")
    errors.extend(
        assert_contains(
            "stripRoundPayload",
            strip_body,
            [
                "frames: []",
                "events: []",
                "effects: []",
                "weaponFires: []",
                "projectileFrames: []",
            ],
        )
    )
    save_body = function_body(store, "saveParsedMatch")
    errors.extend(
        assert_contains(
            "saveParsedMatch",
            save_body,
            [
                "rounds: data.rounds.map(stripRoundPayload)",
                "db.transaction([MATCH_STORE, ROUND_STORE], \"readwrite\")",
                "const rounds = tx.objectStore(ROUND_STORE)",
                "const existingKeys = await requestResult<IDBValidKey[]>(rounds.index(\"matchId\").getAllKeys(id))",
                "for (const key of existingKeys) rounds.delete(key)",
                "tx.objectStore(MATCH_STORE).put({ ...summary, metadata })",
                "for (const round of data.rounds)",
                "key: roundKey(id, round.number)",
                "matchId: id",
                "number: round.number",
                "round,",
                "await txDone(tx)",
            ],
        )
    )
    if "tx.objectStore(MATCH_STORE).put({ ...summary, metadata: data" in save_body:
        errors.append("saveParsedMatch appears to store full match data in the metadata store")
    return errors


def assert_rounds_are_loaded_on_demand(store: str, backend: str, match_viewer: str, replay_store: str) -> list[str]:
    errors: list[str] = []
    read_metadata = function_body(store, "readStoredMetadata")
    errors.extend(
        assert_contains(
            "readStoredMetadata",
            read_metadata,
            [
                "tx.objectStore(MATCH_STORE).get(id)",
                "return item.metadata",
            ],
        )
    )
    read_round = function_body(store, "readStoredRound")
    errors.extend(
        assert_contains(
            "readStoredRound",
            read_round,
            [
                "tx.objectStore(ROUND_STORE).get(roundKey(matchId, number))",
                "return item.round",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "browser backend match store",
            backend,
            [
                "getMatchMetadata: readStoredMetadata",
                "getRound: readStoredRound",
                "deleteMatch: deleteStoredMatch",
                "renameMatch: renameStoredMatch",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "MatchViewer lazy round loading",
            match_viewer,
            [
                "getMatchMetadata(id)",
                "getRound(id, roundNumber, debugProjectiles)",
                "round.frames.length > 0",
                "setRoundData(id, roundNumber, data)",
                "match.rounds[currentRoundIdx]",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "replay store round replacement",
            replay_store,
            [
                "setRoundData: (matchId, roundNumber, round)",
                "s.match.rounds.map((r) => (r.number === roundNumber ? round : r))",
            ],
        )
    )
    return errors


def assert_transaction_errors_propagate(store: str) -> list[str]:
    errors: list[str] = []
    tx_done = function_body(store, "txDone")
    errors.extend(
        assert_contains(
            "txDone",
            tx_done,
            [
                "tx.oncomplete = () => resolve()",
                "tx.onerror = () => reject(tx.error ?? new Error(\"IndexedDB transaction failed\"))",
                "tx.onabort = () => reject(tx.error ?? new Error(\"IndexedDB transaction aborted\"))",
            ],
        )
    )
    request_result = function_body(store, "requestResult")
    errors.extend(
        assert_contains(
            "requestResult",
            request_result,
            [
                "req.onsuccess = () => resolve(req.result)",
                "req.onerror = () => reject(req.error ?? new Error(\"IndexedDB request failed\"))",
            ],
        )
    )
    open_db = function_body(store, "openDb")
    errors.extend(
        assert_contains(
            "openDb error propagation",
            open_db,
            [
                "req.onsuccess = () => resolve(req.result)",
                "req.onerror = () => reject(req.error ?? new Error(\"IndexedDB open failed\"))",
            ],
        )
    )
    for name in ["listStoredMatches", "readStoredMetadata", "readStoredRound", "deleteStoredMatch", "renameStoredMatch", "saveParsedMatch"]:
        body = function_body(store, name)
        errors.extend(assert_contains(f"{name} closes db", body, ["finally", "db.close()"]))
    for name in ["deleteStoredMatch", "renameStoredMatch", "saveParsedMatch"]:
        body = function_body(store, name)
        errors.extend(assert_contains(f"{name} awaits transaction completion", body, ["await txDone(tx)"]))
    return errors


def assert_match_lifecycle(store: str) -> list[str]:
    errors: list[str] = []
    list_body = function_body(store, "listStoredMatches")
    errors.extend(
        assert_contains(
            "listStoredMatches",
            list_body,
            [
                "tx.objectStore(MATCH_STORE).getAll()",
                "map(({ id, name, createdAt, size }) => ({ id, name, createdAt, size }))",
                "sort((a, b) => b.createdAt - a.createdAt)",
            ],
        )
    )
    delete_body = function_body(store, "deleteStoredMatch")
    errors.extend(
        assert_contains(
            "deleteStoredMatch",
            delete_body,
            [
                "db.transaction([MATCH_STORE, ROUND_STORE], \"readwrite\")",
                "tx.objectStore(MATCH_STORE).delete(id)",
                "const rounds = tx.objectStore(ROUND_STORE)",
                "const keys = await requestResult<IDBValidKey[]>(rounds.index(\"matchId\").getAllKeys(id))",
                "for (const key of keys) rounds.delete(key)",
                "await txDone(tx)",
            ],
        )
    )
    rename_body = function_body(store, "renameStoredMatch")
    errors.extend(
        assert_contains(
            "renameStoredMatch",
            rename_body,
            [
                "const updated = { ...item, name }",
                "store.put(updated)",
                "return { id: updated.id, name: updated.name, createdAt: updated.createdAt, size: updated.size }",
            ],
        )
    )
    return errors


def main() -> None:
    store = read(STORE)
    backend = read(BACKEND)
    match_viewer = read(MATCH_VIEWER)
    replay_store = read(REPLAY_STORE)
    errors: list[str] = []
    errors.extend(assert_store_schema(store))
    errors.extend(assert_metadata_is_light(store))
    errors.extend(assert_rounds_are_loaded_on_demand(store, backend, match_viewer, replay_store))
    errors.extend(assert_transaction_errors_propagate(store))
    errors.extend(assert_match_lifecycle(store))
    if errors:
        raise AssertionError("browser store contract audit failed: " + "; ".join(errors))
    print("browser store contract audit passed")


if __name__ == "__main__":
    main()
