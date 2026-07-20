#!/usr/bin/env python3
"""Audit that repo audit scripts are actually wired into CI and docs."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHECKS = ROOT / ".github" / "workflows" / "_checks.yml"
README = ROOT / "README.md"
PACKAGE = ROOT / "desktop" / "package.json"
SCRIPTS = ROOT / "scripts"
WASM_REPRODUCIBILITY = SCRIPTS / "verify-wasm-reproducibility.py"


def audit_scripts() -> list[str]:
    return sorted(path.name for path in SCRIPTS.glob("audit-*.py"))


def require_snippets(source: str, snippets: list[str], label: str, errors: list[str]) -> None:
    for snippet in snippets:
        if snippet not in source:
            errors.append(f"{label} is missing required snippet: {snippet}")


def main() -> None:
    checks = CHECKS.read_text(encoding="utf-8")
    readme = README.read_text(encoding="utf-8")
    package = PACKAGE.read_text(encoding="utf-8")
    wasm_reproducibility = WASM_REPRODUCIBILITY.read_text(encoding="utf-8")
    errors: list[str] = []

    for script in audit_scripts():
        script_path = f"scripts/{script}"
        if script_path not in checks:
            errors.append(f"{script_path} is not referenced in .github/workflows/_checks.yml")
        if f"python3 {script_path}" not in checks:
            errors.append(f"{script_path} is not executed by .github/workflows/_checks.yml")
        if script_path not in readme:
            errors.append(f"{script_path} is not documented in README.md")

    require_snippets(
        package,
        [
            '"parser:wasm"',
            "cargo build --target wasm32-unknown-unknown --release --lib",
            "wasm-bindgen target/wasm32-unknown-unknown/release/roundlab_parser.wasm",
            "--out-dir ../desktop/src/wasm/roundlab_parser",
            "--out-name roundlab_parser",
        ],
        "desktop/package.json parser:wasm",
        errors,
    )
    require_snippets(
        checks,
        [
            "cargo check --target wasm32-unknown-unknown --lib",
            "cargo install wasm-bindgen-cli --version",
            "python3 scripts/verify-wasm-reproducibility.py --check-git",
        ],
        ".github/workflows/_checks.yml WASM parser freshness gate",
        errors,
    )
    require_snippets(
        wasm_reproducibility,
        [
            '"cargo", "clean", "--target", "wasm32-unknown-unknown", "--release"',
            '"cargo", "build", "--target", "wasm32-unknown-unknown", "--release", "--lib"',
            '"wasm-bindgen"',
            '"--out-dir"',
            '"../desktop/src/wasm/roundlab_parser"',
            '"git", "diff", "--exit-code"',
        ],
        "scripts/verify-wasm-reproducibility.py",
        errors,
    )
    require_snippets(
        readme,
        [
            "cargo check --target wasm32-unknown-unknown --lib",
            "regenerates the committed browser WASM artifacts",
            "desktop/src/wasm/roundlab_parser",
            "stale",
        ],
        "README.md WASM parser freshness docs",
        errors,
    )

    if errors:
        raise AssertionError("CI audit coverage failed: " + "; ".join(errors))

    print(f"CI audit coverage passed: {len(audit_scripts())} audit scripts covered")


if __name__ == "__main__":
    main()
