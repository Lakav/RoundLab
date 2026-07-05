#!/usr/bin/env python3
"""Audit baseline accessibility contracts for the browser home screen."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SETTINGS_PANEL = ROOT / "desktop" / "src" / "components" / "SettingsPanel.tsx"
HOME_PAGE = ROOT / "desktop" / "src" / "app" / "page.tsx"


def require(text: str, snippet: str, path: Path, errors: list[str]) -> None:
    if snippet not in text:
        errors.append(f"{path.relative_to(ROOT)} is missing {snippet!r}")


def main() -> None:
    errors: list[str] = []
    settings = SETTINGS_PANEL.read_text(encoding="utf-8")
    home = HOME_PAGE.read_text(encoding="utf-8")

    for snippet in [
        'aria-label="Settings"',
        "aria-controls={panelId}",
        "aria-expanded={open}",
        'role="dialog"',
        'aria-modal="false"',
        "aria-labelledby={titleId}",
        'aria-label="Close"',
        "const panelId = useId()",
        "const titleId = useId()",
    ]:
        require(settings, snippet, SETTINGS_PANEL, errors)

    for snippet in [
        'data-testid="demo-file-input"',
        'accept=".dem,.zst,.dem.zst"',
        "Open a CS2 demo",
        "Drop a .dem or .dem.zst",
    ]:
        require(home, snippet, HOME_PAGE, errors)

    if errors:
        raise AssertionError("home accessibility audit failed: " + "; ".join(errors))

    print("home accessibility audit passed")


if __name__ == "__main__":
    main()
