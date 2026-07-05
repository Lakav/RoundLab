#!/usr/bin/env python3
"""Audit browser import/progress invariants.

This catches regressions where the UI, browser backend, and parser worker drift
apart: mismatched file limits, unsupported browser capability checks, broken
extension filters, or non-monotonic worker progress updates.
"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "desktop" / "src" / "app" / "page.tsx"
BACKEND = ROOT / "desktop" / "src" / "lib" / "backends" / "browser.ts"
WORKER = ROOT / "desktop" / "src" / "workers" / "web-parser.worker.ts"
RUST_PARSER = ROOT / "parser" / "src" / "main.rs"

FILE_LIMIT_RE = re.compile(r"(?:const\s+MAX_DEMO_SIZE\s*=\s*)?([0-9]+)\s*\*\s*([0-9]+)\s*\*\s*([0-9]+)")
PROGRESS_RE = re.compile(r"postProgress\(\s*([0-9.]+)\s*,\s*([\"`])([^\"`]+)")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def demo_size_limits() -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    for path in [PAGE, BACKEND, WORKER, RUST_PARSER]:
        text = read(path)
        for match in FILE_LIMIT_RE.finditer(text):
            value = int(match.group(1)) * int(match.group(2)) * int(match.group(3))
            if value >= 1024 * 1024:
                out.append((str(path.relative_to(ROOT)), value))
    return out


def assert_file_limit_consistency() -> None:
    limits = demo_size_limits()
    sources = {source for source, _ in limits}
    required_sources = {
        str(PAGE.relative_to(ROOT)),
        str(BACKEND.relative_to(ROOT)),
        str(WORKER.relative_to(ROOT)),
        str(RUST_PARSER.relative_to(ROOT)),
    }
    missing_sources = sorted(required_sources - sources)
    if missing_sources:
        raise AssertionError(f"browser/parser file size limit missing from: {missing_sources}; found={limits}")
    values = {value for _, value in limits}
    if len(values) != 1:
        raise AssertionError(f"browser parser file size limits diverged: {limits}")
    only = next(iter(values), None)
    if only != 1024 * 1024 * 1024:
        raise AssertionError(f"browser parser file size limit is {only}, expected 1 GiB")


def assert_browser_capability_checks() -> None:
    page = read(PAGE)
    required = [
        "typeof Worker",
        "typeof WebAssembly",
        '"indexedDB" in window',
        "typeof File",
        "typeof Blob",
        "crypto?.randomUUID",
    ]
    missing = [snippet for snippet in required if snippet not in page]
    if missing:
        raise AssertionError(f"browser support check is missing: {missing}")


def assert_demo_extension_filters() -> None:
    page = read(PAGE)
    backend = read(BACKEND)
    required = ['endsWith(".dem")', 'endsWith(".dem.zst")', 'endsWith(".zst")']
    errors: list[str] = []
    for label, text in [("page", page), ("backend", backend)]:
        for snippet in required:
            if snippet not in text:
                errors.append(f"{label} demo filter is missing {snippet}")
    if 'accept=".dem,.zst,.dem.zst"' not in page:
        errors.append("file input accept list no longer exposes .dem/.zst/.dem.zst")
    if errors:
        raise AssertionError("; ".join(errors))


def assert_page_blocks_oversized_demo_before_parse() -> None:
    page = read(PAGE)
    required = [
        "const MAX_DEMO_SIZE = 1024 * 1024 * 1024",
        "function demoFileSizeError(file: File): string | null",
        "if (file.size <= MAX_DEMO_SIZE) return null",
        '"Demo file is larger than the 1 GB browser parser limit."',
        "const sizeError = demoFileSizeError(source.file)",
        "setError(sizeError)",
        "return;",
        "setUploading(true)",
    ]
    missing = [snippet for snippet in required if snippet not in page]
    if missing:
        raise AssertionError(f"page oversized-demo guard is missing: {missing}")


def assert_worker_blocks_oversized_decompressed_demo() -> None:
    worker = read(WORKER)
    required = [
        "bytes = await decompressZstd(bytes)",
        "if (bytes.byteLength > MAX_DEMO_SIZE)",
        '"Decompressed demo is larger than the 1 GB browser parser limit."',
        "postProgress(0.13, `Decompressed to ${mb} MB locally...`, \"decompressing\", bytes.byteLength)",
    ]
    missing = [snippet for snippet in required if snippet not in worker]
    if missing:
        raise AssertionError(f"worker decompressed-size guard is missing: {missing}")
    if worker.find("if (bytes.byteLength > MAX_DEMO_SIZE)") > worker.find("postProgress(0.13"):
        raise AssertionError("worker must reject oversized decompressed demos before reporting decompression success")


def assert_worker_errors_are_user_safe() -> None:
    worker = read(WORKER)
    required = [
        'console.error("[parser-worker] parse failed", error)',
        "const message = error instanceof Error ? error.message : String(error)",
        'type: "error"',
        "message,",
    ]
    missing = [snippet for snippet in required if snippet not in worker]
    errors = [f"worker user-safe error contract is missing: {missing}"] if missing else []
    forbidden = [
        "error.stack",
        ".filter(Boolean).join(\"\\n\")",
        "[error.message, error.stack]",
    ]
    for snippet in forbidden:
        if snippet in worker:
            errors.append(f"worker error payload must not include stack detail {snippet!r}")
    if errors:
        raise AssertionError("; ".join(errors))


def assert_worker_rejects_unplayable_output() -> None:
    worker = read(WORKER)
    required = [
        "function validatePlayableMatch(data: MatchData): void",
        "if (!Array.isArray(data.rounds) || data.rounds.length === 0)",
        '"This demo parsed successfully, but no playable rounds were found."',
        "const seenRoundNumbers = new Set<number>()",
        "if (seenRoundNumbers.has(round.number))",
        "Parser output has duplicate round number",
        "if (!Array.isArray(round.frames) || round.frames.length === 0)",
        "has no frame data.",
        "validatePlayableMatch(data)",
    ]
    missing = [snippet for snippet in required if snippet not in worker]
    errors = [f"worker playable-match validation is missing: {missing}"] if missing else []
    if worker.find("validatePlayableMatch(data)") > worker.find("const id = crypto.randomUUID()"):
        errors.append("worker must validate parsed match before allocating a stored match id")
    if worker.find("validatePlayableMatch(data)") > worker.find("await saveParsedMatch"):
        errors.append("worker must validate parsed match before writing to IndexedDB")
    if errors:
        raise AssertionError("; ".join(errors))


def assert_worker_progress_is_monotonic() -> None:
    worker = read(WORKER)
    updates = [(float(value), message) for value, _, message in PROGRESS_RE.findall(worker)]
    if len(updates) < 5:
        raise AssertionError(f"expected several worker progress updates, found {updates}")
    errors: list[str] = []
    previous = -1.0
    for value, message in updates:
        if value < previous:
            errors.append(f"worker progress regressed from {previous} to {value}: {message}")
        if value <= 0 or value >= 1:
            errors.append(f"worker progress {value} must stay in (0, 1): {message}")
        previous = value
    messages = " ".join(message.lower() for _, message in updates)
    for required in ["local", "wasm", "storing"]:
        if required not in messages:
            errors.append(f"worker progress messages no longer mention {required!r}")
    if errors:
        raise AssertionError("; ".join(errors))


def assert_ui_estimate_uses_backend_progress() -> None:
    page = read(PAGE)
    required = [
        "backendPct >= 0.35",
        "elapsedMs / backendPct",
        "effectiveEstimateMs",
        "estimateExceeded",
        "progress.effectiveBytes",
        "webEstimateForBytes(progress.effectiveBytes",
    ]
    missing = [snippet for snippet in required if snippet not in page]
    if missing:
        raise AssertionError(f"parse estimate/progress UI invariant missing: {missing}")


def main() -> None:
    assert_file_limit_consistency()
    assert_browser_capability_checks()
    assert_demo_extension_filters()
    assert_page_blocks_oversized_demo_before_parse()
    assert_worker_blocks_oversized_decompressed_demo()
    assert_worker_errors_are_user_safe()
    assert_worker_rejects_unplayable_output()
    assert_worker_progress_is_monotonic()
    assert_ui_estimate_uses_backend_progress()
    print("browser import flow audit passed")


if __name__ == "__main__":
    main()
