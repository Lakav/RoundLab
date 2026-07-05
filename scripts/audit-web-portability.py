#!/usr/bin/env python3
"""Fail when desktop/Tauri-only artifacts are reintroduced.

RoundLab is now a browser app with local Web Worker/WASM parsing. This audit is
deliberately narrow: it checks tracked files and runtime/config surfaces where a
Tauri sidecar path would make the app non-portable again.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_PATH_PARTS = {
    ".tauri-keys",
    "src-tauri",
}

FORBIDDEN_TEXT_PATTERNS = {
    "@tauri",
    "__tauri__",
    "src-tauri",
    "sidecar",
    "tauri.conf",
    "tauri ",
}

FORBIDDEN_BROWSER_DIAGNOSTIC_PATTERNS = {
    "getLogFilePath",
    "readLogTail",
    "readProjectileDebugLogs",
    "getProjectileLogInfo",
    "openLogsFolder",
    "openProjectileLogsFolder",
    "openProjectileLogFile",
    "Persistent log file",
    "Open logs folder",
    "Open projectile log file",
    "Open projectile logs folder",
    "Copy log path",
    "Copy last 500 app logs",
}

SCAN_PATHS = {
    ".github/workflows/_checks.yml",
    ".github/workflows/ci.yml",
    ".gitignore",
    "desktop/.gitignore",
    "desktop/package.json",
    "desktop/pnpm-lock.yaml",
    "desktop/pnpm-workspace.yaml",
    "desktop/src",
}

IGNORED_TEXT_PATHS = {
    "desktop/src/wasm",
}

DEPENDENCY_MANIFEST_NAMES = {
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
}


def tracked_files() -> list[str]:
    try:
        result = subprocess.run(
            ["git", "ls-files"],
            cwd=ROOT,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return [str(path.relative_to(ROOT)) for path in ROOT.rglob("*") if path.is_file()]
    return [line for line in result.stdout.splitlines() if line]


def is_scan_target(path: str) -> bool:
    if any(path == ignored or path.startswith(f"{ignored}/") for ignored in IGNORED_TEXT_PATHS):
        return False
    if Path(path).name in DEPENDENCY_MANIFEST_NAMES:
        return True
    return any(path == target or path.startswith(f"{target}/") for target in SCAN_PATHS)


def read_text(path: str) -> str | None:
    try:
        return (ROOT / path).read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None


def assert_package_scripts_are_portable() -> None:
    package_path = ROOT / "desktop" / "package.json"
    data = json.loads(package_path.read_text(encoding="utf-8"))
    scripts = data.get("scripts") or {}
    failures = [
        f"desktop/package.json script {name!r} contains {pattern!r}"
        for name, command in scripts.items()
        for pattern in FORBIDDEN_TEXT_PATTERNS
        if pattern in str(command).lower()
    ]
    if failures:
        raise AssertionError("; ".join(failures))


def main() -> None:
    files = tracked_files()
    errors: list[str] = []

    for path in files:
        parts = set(Path(path).parts)
        forbidden_parts = sorted(parts & FORBIDDEN_PATH_PARTS)
        if forbidden_parts:
            errors.append(f"tracked desktop-only path {path!r} contains {forbidden_parts}")
            continue

        if not is_scan_target(path):
            continue
        text = read_text(path)
        if text is None:
            continue
        lower_text = text.lower()
        for pattern in sorted(FORBIDDEN_TEXT_PATTERNS):
            if pattern in lower_text:
                errors.append(f"{path} contains forbidden desktop-only pattern {pattern!r}")
        if path.startswith("desktop/src/"):
            for pattern in sorted(FORBIDDEN_BROWSER_DIAGNOSTIC_PATTERNS):
                if pattern in text:
                    errors.append(f"{path} contains forbidden desktop diagnostics pattern {pattern!r}")

    try:
        assert_package_scripts_are_portable()
    except AssertionError as error:
        errors.append(str(error))

    if errors:
        raise AssertionError("web portability audit failed: " + "; ".join(errors))

    print(f"web portability audit passed: {len(files)} tracked files checked")


if __name__ == "__main__":
    main()
