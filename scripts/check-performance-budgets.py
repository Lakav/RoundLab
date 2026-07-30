#!/usr/bin/env python3
"""Fail CI when stable production asset budgets regress."""

from __future__ import annotations

from pathlib import Path


# The 88bbf71 production baseline already emits 2,056,196 bytes. Keep less
# than 40 KiB of headroom over the current validated 2,110,158-byte build.
JS_BUDGET_BYTES = 2_150_000
WASM_BUDGET_BYTES = 3_500_000


def total_bytes(root: Path, suffix: str) -> tuple[int, int]:
    files = [path for path in root.rglob(f"*{suffix}") if path.is_file()]
    return len(files), sum(path.stat().st_size for path in files)


def main() -> int:
    output = Path("desktop/out")
    if not output.is_dir():
        raise SystemExit("desktop/out is missing; run the production build first")
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
    if failures:
        raise SystemExit("; ".join(failures))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
