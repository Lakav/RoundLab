#!/usr/bin/env python3
"""Audit parser fidelity defaults across web UI, worker, and Rust WASM.

RoundLab can only replay trajectories, shots, bomb state, and utility effects if
the browser path keeps full parser fidelity by default. This check catches
silent downgrades such as changing default quality, skipping projectiles, or
exposing lossy capture toggles in the current import UI.
"""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "desktop" / "src" / "lib" / "api.ts"
PAGE = ROOT / "desktop" / "src" / "app" / "page.tsx"
SETTINGS = ROOT / "desktop" / "src" / "components" / "SettingsPanel.tsx"
WORKER = ROOT / "desktop" / "src" / "workers" / "web-parser.worker.ts"
RUST_MAIN = ROOT / "parser" / "src" / "main.rs"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def balanced_block_after(source: str, marker: str, opener: str = "{", closer: str = "}") -> str:
    start = source.find(marker)
    if start < 0:
        raise AssertionError(f"missing marker {marker!r}")
    open_at = source.find(opener, start + len(marker))
    if open_at < 0:
        raise AssertionError(f"missing opener after marker {marker!r}")
    depth = 0
    for index in range(open_at, len(source)):
        char = source[index]
        if char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return source[open_at + 1:index]
    raise AssertionError(f"unterminated block after marker {marker!r}")


def function_body(source: str, name: str) -> str:
    match = re.search(rf"(?:export\s+async\s+|export\s+)?(?:function|const|fn)\s+{re.escape(name)}\b", source)
    if not match:
        raise AssertionError(f"missing function/const {name}")
    if "function" in match.group(0) or match.group(0).startswith("fn "):
        paren = source.find("(", match.end())
        if paren < 0:
            raise AssertionError(f"missing parameter list for {name}")
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
        return balanced_block_after(source[end_paren:], "", "{", "}")
    return balanced_block_after(source, match.group(0))


def assert_contains(label: str, source: str, tokens: list[str]) -> list[str]:
    return [f"{label} is missing {token!r}" for token in tokens if token not in source]


def assert_not_contains(label: str, source: str, tokens: list[str]) -> list[str]:
    return [f"{label} must not contain {token!r}" for token in tokens if token in source]


def assert_api_defaults(api: str) -> list[str]:
    errors: list[str] = []
    parse_demo = function_body(api, "parseDemo")
    errors.extend(
        assert_contains(
            "api parseDemo",
            parse_demo,
            [
                "return getBackend().parser.parseDemo(source)",
            ],
        )
    )
    errors.extend(
        assert_not_contains(
            "browser parser public API downgrade surface",
            api,
            [
                "DEFAULT_PARSE_OPTIONS",
                "loadParseOptions",
                "saveParseOptions",
                "PARSE_OPTIONS_KEY",
                "options?:",
                "...options",
                "skipProjectiles",
                "skipWeaponFires",
            ],
        )
    )
    return errors


def assert_ui_does_not_downgrade(page: str, settings: str) -> list[str]:
    errors: list[str] = []
    parse_source = function_body(page, "parseSource")
    errors.extend(
        assert_contains(
            "Home parseSource full-fidelity call",
            parse_source,
            [
                "const id = await parseDemo(source)",
                "saveParseEstimate(source, duration, parseEffectiveBytesRef.current)",
            ],
        )
    )
    errors.extend(
        assert_not_contains(
            "Home import page",
            page,
            [
                "loadParseOptions",
                "saveParseOptions",
                "skipProjectiles",
                "skipWeaponFires",
                "parseDemo(source, {",
            ],
        )
    )
    errors.extend(
        assert_contains(
            "SettingsPanel fidelity copy",
            settings,
            [
                "Full tick capture",
                "Locked to every tick",
                "Projectiles, shots, bomb state, player state and parsed events are kept",
            ],
        )
    )
    errors.extend(
        assert_not_contains(
            "SettingsPanel lossy controls",
            settings,
            [
                "loadParseOptions",
                "saveParseOptions",
                'type="checkbox"',
                "<select",
                "skipProjectiles",
                "skipWeaponFires",
            ],
        )
    )
    return errors


def assert_worker_wasm_defaults(worker: str) -> list[str]:
    errors: list[str] = []
    parse_demo = function_body(worker, "parseDemo")
    errors.extend(
        assert_contains(
            "worker parseDemo WASM call",
            parse_demo,
            [
                "parse_demo_bytes_to_json(",
                'bytes, "full", false, false',
                "JSON.parse(json) as MatchData",
                "await saveParsedMatch(id, displayName(request.name), request.size, data)",
            ],
        )
    )
    errors.extend(assert_not_contains("worker parser downgrade surface", worker, ["ParseOptions", "request.options"]))
    errors.extend(
        assert_contains(
            "worker progress fidelity path",
            parse_demo,
            [
                "Decompressed to",
                "Loading WASM parser",
                "Parsing demo locally",
                "Storing parsed match locally",
            ],
        )
    )
    return errors


def assert_rust_wasm_defaults(rust: str) -> list[str]:
    errors: list[str] = []
    sample_step = function_body(rust, "sample_step")
    errors.extend(
        assert_contains(
            "Rust sample_step",
            sample_step,
            [
                '"low" => 64',
                '"medium" | "med" => 32',
                '"high" => 16',
                "_ => 1",
            ],
        )
    )
    wasm = function_body(rust, "parse_demo_bytes_to_json")
    errors.extend(
        assert_contains(
            "Rust WASM parser defaults",
            wasm,
            [
                'quality: quality.unwrap_or_else(|| "full".to_string())',
                "skip_projectiles",
                "skip_weapon_fires",
                "parse_demo_data_from_bytes",
            ],
        )
    )
    tests = assert_contains(
        "Rust fidelity tests",
        rust,
        [
            "fn sample_step_matches_cli_quality_contract()",
            'assert_eq!(sample_step("full"), 1)',
            'assert_eq!(sample_step("high"), 16)',
            'assert_eq!(sample_step("medium"), 32)',
            'assert_eq!(sample_step("low"), 64)',
            "roundlab_test_demo_honors_quality_and_skip_options_when_configured",
        ],
    )
    errors.extend(tests)
    return errors


def main() -> None:
    errors: list[str] = []
    errors.extend(assert_api_defaults(read(API)))
    errors.extend(assert_ui_does_not_downgrade(read(PAGE), read(SETTINGS)))
    errors.extend(assert_worker_wasm_defaults(read(WORKER)))
    errors.extend(assert_rust_wasm_defaults(read(RUST_MAIN)))
    if errors:
        raise AssertionError("parser fidelity audit failed: " + "; ".join(errors))
    print("parser fidelity audit passed")


if __name__ == "__main__":
    main()
