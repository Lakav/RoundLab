#!/usr/bin/env python3
"""Validate the dated manual accessibility controls required by REC-15."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTROLS = ROOT / "docs/rncp-bloc2/evidence/accessibilite-controles-manuels.csv"
HEADERS = [
    "controle", "pages_etats", "methode", "resultat", "preuve",
    "anomalie", "correction", "date", "auditeur",
]
EXPECTED = {
    "clavier_accueil", "focus_visible", "dialogues_retour_focus",
    "commandes_replay_clavier", "zoom_200", "zoom_400",
    "defilement_horizontal", "contraste_canvas", "coherence_canvas_dom",
}
RESULTS = {"CONFORME", "NON CONFORME", "NON DÉMONTRÉ"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--controls", type=Path, default=DEFAULT_CONTROLS)
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()

    with args.controls.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != HEADERS:
            raise AssertionError(f"{args.controls} headers must be {HEADERS}")
        rows = list(reader)

    ids = [row["controle"].strip() for row in rows]
    if len(ids) != len(set(ids)):
        raise AssertionError("manual accessibility control identifiers must be unique")
    if set(ids) != EXPECTED:
        raise AssertionError(
            f"manual accessibility controls differ: missing={sorted(EXPECTED-set(ids))}, "
            f"unexpected={sorted(set(ids)-EXPECTED)}"
        )

    counts = {result: 0 for result in RESULTS}
    for line, row in enumerate(rows, start=2):
        label = row["controle"].strip()
        for field in ("pages_etats", "methode", "resultat", "preuve", "date", "auditeur"):
            if not row[field].strip():
                raise AssertionError(f"line {line}, {label}: {field} is required")
        result = row["resultat"].strip().upper()
        if result not in RESULTS:
            raise AssertionError(f"line {line}, {label}: invalid result {result!r}")
        try:
            date.fromisoformat(row["date"].strip())
        except ValueError as exc:
            raise AssertionError(f"line {line}, {label}: date must use YYYY-MM-DD") from exc
        if result == "NON CONFORME" and not row["anomalie"].strip():
            raise AssertionError(f"line {line}, {label}: anomaly is required")
        counts[result] += 1

    if args.require_complete and counts != {"CONFORME": 9, "NON CONFORME": 0, "NON DÉMONTRÉ": 0}:
        raise AssertionError(f"REC-15 controls are not all demonstrated and conforming: {counts}")
    print(json.dumps({"controls": len(rows), "counts": counts}, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
