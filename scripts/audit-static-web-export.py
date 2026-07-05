#!/usr/bin/env python3
"""Audit that the web app stays hostable as a static browser app.

The browser parser can be local-only and still become non-portable if a Next.js
API route, middleware, server action, image optimizer, or Node-only import
creeps back into the app surface. This check keeps the deployable app as plain
static HTML/JS/CSS plus local browser APIs.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESKTOP = ROOT / "desktop"
NEXT_CONFIG = DESKTOP / "next.config.ts"
PACKAGE = DESKTOP / "package.json"

SERVER_FILE_NAMES = {
    "route.ts",
    "route.tsx",
    "route.js",
    "route.jsx",
    "middleware.ts",
    "middleware.js",
    "proxy.ts",
    "proxy.js",
}

FORBIDDEN_SRC_IMPORTS = {
    "node:fs",
    "fs",
    "node:path",
    "path",
    "node:child_process",
    "child_process",
    "node:os",
    "os",
    "node:http",
    "http",
    "node:https",
    "https",
    "node:net",
    "net",
    "node:tls",
    "tls",
    "next/server",
    "next/headers",
    "next/cache",
}

FORBIDDEN_SRC_SNIPPETS = [
    '"use server"',
    "'use server'",
    "export const runtime",
    "export const dynamic",
    "headers()",
    "cookies()",
    "NextRequest",
    "NextResponse",
    "revalidatePath(",
    "revalidateTag(",
]

IMPORT_RE = re.compile(r"(?:import\s+(?:[^'\"]+\s+from\s+)?|import\s*\(|require\s*\()\s*['\"]([^'\"]+)['\"]")


def tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return [line for line in result.stdout.splitlines() if line]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def assert_next_static_export() -> list[str]:
    text = read(NEXT_CONFIG)
    errors: list[str] = []
    required = [
        'output: "export"',
        "unoptimized: true",
        "trailingSlash: true",
    ]
    for snippet in required:
        if snippet not in text:
            errors.append(f"desktop/next.config.ts is missing {snippet!r}")
    forbidden = [
        "rewrites(",
        "redirects(",
        "headers(",
        "serverExternalPackages",
    ]
    for snippet in forbidden:
        if snippet in text:
            errors.append(f"desktop/next.config.ts contains server-oriented config {snippet!r}")
    return errors


def assert_package_build_is_static() -> list[str]:
    data = json.loads(read(PACKAGE))
    scripts = data.get("scripts") or {}
    errors: list[str] = []
    if scripts.get("build") != "next build":
        errors.append("desktop/package.json build script must stay `next build`; static export is controlled by next.config.ts")
    for name, command in scripts.items():
        lowered = str(command).lower()
        if "next start" in lowered:
            errors.append(f"desktop/package.json script {name!r} uses next start, which requires a server")
    return errors


def assert_no_server_files(files: list[str]) -> list[str]:
    errors: list[str] = []
    for path in files:
        parts = Path(path).parts
        if not path.startswith("desktop/src/"):
            continue
        if Path(path).name in SERVER_FILE_NAMES:
            errors.append(f"{path} is a server route/middleware surface, not static-export portable")
        if len(parts) >= 4 and parts[:3] == ("desktop", "src", "app") and parts[3] == "api":
            errors.append(f"{path} is under desktop/src/app/api, which requires a server route")
    return errors


def assert_src_has_no_node_or_server_apis(files: list[str]) -> list[str]:
    errors: list[str] = []
    for path in files:
        if not path.startswith("desktop/src/") or not path.endswith((".ts", ".tsx", ".js", ".jsx")):
            continue
        if path.startswith("desktop/src/wasm/"):
            continue
        text = read(ROOT / path)
        for match in IMPORT_RE.finditer(text):
            target = match.group(1)
            if target in FORBIDDEN_SRC_IMPORTS:
                errors.append(f"{path} imports server/Node-only module {target!r}")
        for snippet in FORBIDDEN_SRC_SNIPPETS:
            if snippet in text:
                errors.append(f"{path} contains server-only snippet {snippet!r}")
    return errors


def main() -> None:
    files = tracked_files()
    errors: list[str] = []
    errors.extend(assert_next_static_export())
    errors.extend(assert_package_build_is_static())
    errors.extend(assert_no_server_files(files))
    errors.extend(assert_src_has_no_node_or_server_apis(files))
    if errors:
        raise AssertionError("static web export audit failed: " + "; ".join(errors))
    print("static web export audit passed")


if __name__ == "__main__":
    main()
