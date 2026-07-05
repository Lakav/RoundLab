#!/usr/bin/env python3
"""Audit that repo audit scripts are actually wired into CI and docs."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CHECKS = ROOT / ".github" / "workflows" / "_checks.yml"
README = ROOT / "README.md"
SCRIPTS = ROOT / "scripts"


def audit_scripts() -> list[str]:
    return sorted(path.name for path in SCRIPTS.glob("audit-*.py"))


def main() -> None:
    checks = CHECKS.read_text(encoding="utf-8")
    readme = README.read_text(encoding="utf-8")
    errors: list[str] = []

    for script in audit_scripts():
        script_path = f"scripts/{script}"
        if script_path not in checks:
            errors.append(f"{script_path} is not referenced in .github/workflows/_checks.yml")
        if f"python3 {script_path}" not in checks:
            errors.append(f"{script_path} is not executed by .github/workflows/_checks.yml")
        if script_path not in readme:
            errors.append(f"{script_path} is not documented in README.md")

    if errors:
        raise AssertionError("CI audit coverage failed: " + "; ".join(errors))

    print(f"CI audit coverage passed: {len(audit_scripts())} audit scripts covered")


if __name__ == "__main__":
    main()
