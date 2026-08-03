#!/usr/bin/env python3
"""Audit RoundLab's static/local web security invariants.

This is a source-level baseline, not a penetration test. Dependency advisories
are checked separately by pnpm audit and cargo audit in CI.
"""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_SRC = ROOT / "web" / "src"
LAYOUT = WEB_SRC / "app" / "layout.tsx"
WORKFLOW = ROOT / ".github" / "workflows" / "_checks.yml"

DANGEROUS_RUNTIME_PATTERNS = {
    "dangerouslySetInnerHTML": "React raw HTML injection",
    ".innerHTML =": "DOM raw HTML injection",
    "eval(": "dynamic code execution",
    "new Function(": "dynamic Function execution",
}


def source_files() -> list[Path]:
    return sorted(
        path
        for path in WEB_SRC.rglob("*")
        if path.suffix in {".ts", ".tsx"} and "wasm" not in path.parts
    )


def main() -> None:
    errors: list[str] = []
    layout = LAYOUT.read_text(encoding="utf-8")
    required_csp = [
        'httpEquiv="Content-Security-Policy"',
        "default-src 'self'",
        "base-uri 'none'",
        "object-src 'none'",
        "form-action 'none'",
        "connect-src 'self'",
        "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
        "worker-src 'self' blob:",
        '<meta name="referrer" content="no-referrer" />',
    ]
    for snippet in required_csp:
        if snippet not in layout:
            errors.append(f"web/src/app/layout.tsx is missing CSP/referrer control {snippet!r}")

    for path in source_files():
        text = path.read_text(encoding="utf-8")
        for pattern, label in DANGEROUS_RUNTIME_PATTERNS.items():
            if pattern in text:
                errors.append(f"{path.relative_to(ROOT)} uses {label}: {pattern!r}")

    workflow = WORKFLOW.read_text(encoding="utf-8")
    if "permissions:\n  contents: read" not in workflow:
        errors.append("reusable CI workflow must keep read-only repository permissions")
    for required in ["pnpm audit --audit-level high", "cargo audit"]:
        if required not in workflow:
            errors.append(f"CI security checks are missing {required!r}")

    if errors:
        raise AssertionError("security baseline audit failed: " + "; ".join(errors))
    print(f"security baseline audit passed: {len(source_files())} application source files checked")


if __name__ == "__main__":
    main()
