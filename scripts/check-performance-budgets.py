#!/usr/bin/env python3
"""Fail CI when stable production asset budgets regress."""

from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path


# The total includes deferred chunks, so it is a coarse guardrail rather than
# a proxy for first render. Route budgets below protect what users initially
# download and keep the total build below 91% at the 2026-08-03 baseline.
JS_BUDGET_BYTES = 2_400_000
WASM_BUDGET_BYTES = 3_500_000
INITIAL_ROUTE_JS_BUDGETS = {
    "/": (Path("index.html"), 1_000_000),
    "/feedback/": (Path("feedback/index.html"), 850_000),
    "/match/": (Path("match/index.html"), 1_500_000),
}


class ScriptSourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag != "script":
            return
        source = dict(attrs).get("src")
        if source and source.endswith(".js"):
            self.sources.append(source)


def total_bytes(root: Path, suffix: str) -> tuple[int, int]:
    files = [path for path in root.rglob(f"*{suffix}") if path.is_file()]
    return len(files), sum(path.stat().st_size for path in files)


def initial_route_javascript_bytes(output: Path, html_path: Path) -> int:
    document = output / html_path
    if not document.is_file():
        raise SystemExit(f"static route output is missing: {document}")
    parser = ScriptSourceParser()
    parser.feed(document.read_text(encoding="utf-8"))
    assets: set[Path] = set()
    for source in parser.sources:
        marker = "/_next/"
        if marker not in source:
            continue
        relative = Path("_next") / source.split(marker, maxsplit=1)[1]
        asset = output / relative
        if not asset.is_file():
            raise SystemExit(f"initial route asset is missing: {asset}")
        assets.add(asset)
    return sum(path.stat().st_size for path in assets)


def main() -> int:
    output = Path("web/out")
    if not output.is_dir():
        raise SystemExit("web/out is missing; run the production build first")
    js_files, js_bytes = total_bytes(output, ".js")
    wasm_files, wasm_bytes = total_bytes(output, ".wasm")
    print(f"production JavaScript: {js_bytes} bytes across {js_files} files (budget {JS_BUDGET_BYTES})")
    print(f"production WASM: {wasm_bytes} bytes across {wasm_files} files (budget {WASM_BUDGET_BYTES})")
    failures: list[str] = []
    if js_bytes > JS_BUDGET_BYTES:
        failures.append(f"JavaScript budget exceeded by {js_bytes - JS_BUDGET_BYTES} bytes")
    if wasm_files != 1:
        failures.append(f"expected exactly one WASM parser asset, found {wasm_files}")
    if wasm_bytes > WASM_BUDGET_BYTES:
        failures.append(f"WASM budget exceeded by {wasm_bytes - WASM_BUDGET_BYTES} bytes")
    for route, (html_path, budget) in INITIAL_ROUTE_JS_BUDGETS.items():
        initial_bytes = initial_route_javascript_bytes(output, html_path)
        print(
            f"initial JavaScript for {route}: {initial_bytes} bytes "
            f"(budget {budget})"
        )
        if initial_bytes > budget:
            failures.append(
                f"initial JavaScript budget for {route} exceeded by "
                f"{initial_bytes - budget} bytes"
            )
    if failures:
        raise SystemExit("; ".join(failures))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
