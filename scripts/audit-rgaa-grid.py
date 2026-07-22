#!/usr/bin/env python3
"""Validate the exhaustive RGAA 4.1.2 audit grid without inventing results."""

from __future__ import annotations

import argparse
import csv
import json
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GRID = ROOT / "docs" / "rncp-bloc2" / "evidence" / "rgaa-4.1.2-grille.csv"
HEADERS = [
    "critere",
    "description",
    "applicable",
    "methode",
    "resultat",
    "preuve",
    "correction",
    "auditeur",
    "date",
]
AUDIT_FIELDS = HEADERS[2:]
APPLICABLE_VALUES = {"oui", "non"}
APPLICABLE_RESULTS = {"CONFORME", "NON CONFORME", "NON DÉMONTRÉ"}
NOT_APPLICABLE_RESULT = "NON APPLICABLE"
EXPECTED_CRITERIA = """
1.1 1.2 1.3 1.4 1.5 1.6 1.7 1.8 1.9
2.1 2.2
3.1 3.2 3.3
4.1 4.2 4.3 4.4 4.5 4.6 4.7 4.8 4.9 4.10 4.11 4.12 4.13
5.1 5.2 5.3 5.4 5.5 5.6 5.7 5.8
6.1 6.2
7.1 7.2 7.3 7.4 7.5
8.1 8.2 8.3 8.4 8.5 8.6 8.7 8.8 8.9 8.10
9.1 9.2 9.3 9.4
10.1 10.2 10.3 10.4 10.5 10.6 10.7 10.8 10.9 10.10 10.11 10.12 10.13 10.14
11.1 11.2 11.3 11.4 11.5 11.6 11.7 11.8 11.9 11.10 11.11 11.12 11.13
12.1 12.2 12.3 12.4 12.5 12.6 12.7 12.8 12.9 12.10 12.11
13.1 13.2 13.3 13.4 13.5 13.6 13.7 13.8 13.9 13.10 13.11 13.12
""".split()
RELEASE_ALLOWED_NOT_DEMONSTRATED = {"7.1", "7.5"}


def nonempty(value: str | None) -> bool:
    return bool((value or "").strip())


def validate_date(value: str, criterion: str) -> None:
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise AssertionError(
            f"criterion {criterion}: date must use ISO YYYY-MM-DD, got {value!r}"
        ) from exc


def validate_filled_row(row: dict[str, str], *, line_number: int) -> None:
    criterion = row["critere"]
    applicable = row["applicable"].strip().lower()
    result = row["resultat"].strip().upper()

    if applicable not in APPLICABLE_VALUES:
        raise AssertionError(
            f"line {line_number}, criterion {criterion}: applicable must be 'oui' or 'non'"
        )
    for field in ("methode", "resultat", "preuve", "auditeur", "date"):
        if not nonempty(row[field]):
            raise AssertionError(
                f"line {line_number}, criterion {criterion}: {field} is required"
            )
    validate_date(row["date"].strip(), criterion)

    if applicable == "oui" and result not in APPLICABLE_RESULTS:
        raise AssertionError(
            f"line {line_number}, criterion {criterion}: an applicable criterion must be "
            "CONFORME, NON CONFORME or NON DÉMONTRÉ"
        )
    if applicable == "non" and result != NOT_APPLICABLE_RESULT:
        raise AssertionError(
            f"line {line_number}, criterion {criterion}: a non-applicable criterion must be "
            "NON APPLICABLE"
        )
    if result == "NON CONFORME" and not nonempty(row["correction"]):
        raise AssertionError(
            f"line {line_number}, criterion {criterion}: correction is required for NON CONFORME"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--grid", type=Path, default=DEFAULT_GRID)
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="fail unless all 106 criteria contain a coherent real audit result",
    )
    parser.add_argument(
        "--release-ready",
        action="store_true",
        help="require complete evidence, no nonconformity, and only the explicit screen-reader residual",
    )
    args = parser.parse_args()

    with args.grid.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != HEADERS:
            raise AssertionError(
                f"{args.grid} headers must be {HEADERS}, got {reader.fieldnames}"
            )
        rows = list(reader)

    if len(rows) != 106:
        raise AssertionError(f"{args.grid} must contain 106 criteria, found {len(rows)}")

    criteria = [row["critere"].strip() for row in rows]
    if any(not criterion for criterion in criteria):
        raise AssertionError("every RGAA row must have a criterion identifier")
    if criteria != EXPECTED_CRITERIA:
        missing = sorted(set(EXPECTED_CRITERIA) - set(criteria))
        unexpected = sorted(set(criteria) - set(EXPECTED_CRITERIA))
        raise AssertionError(
            "RGAA criterion identifiers or order differ from version 4.1.2: "
            f"missing={missing}, unexpected={unexpected}"
        )
    if any(not nonempty(row["description"]) for row in rows):
        raise AssertionError("every RGAA row must have a description")

    filled: list[dict[str, str]] = []
    for line_number, row in enumerate(rows, start=2):
        present = [field for field in AUDIT_FIELDS if nonempty(row[field])]
        if not present:
            continue
        validate_filled_row(row, line_number=line_number)
        filled.append(row)

    incomplete = len(rows) - len(filled)
    if (args.require_complete or args.release_ready) and incomplete:
        raise AssertionError(
            f"RGAA audit is incomplete: {len(filled)}/106 criteria filled, {incomplete} missing"
        )

    conforming = sum(row["resultat"].strip().upper() == "CONFORME" for row in filled)
    nonconforming = sum(
        row["resultat"].strip().upper() == "NON CONFORME" for row in filled
    )
    not_applicable = sum(
        row["resultat"].strip().upper() == NOT_APPLICABLE_RESULT for row in filled
    )
    not_demonstrated = sum(
        row["resultat"].strip().upper() == "NON DÉMONTRÉ" for row in filled
    )
    applicable = conforming + nonconforming + not_demonstrated
    complete = incomplete == 0
    compliance_rate = (
        round(conforming * 100 / applicable, 2)
        if complete and applicable and not_demonstrated == 0
        else None
    )
    summary = {
        "criteria": len(rows),
        "filled": len(filled),
        "incomplete": incomplete,
        "conforming": conforming,
        "nonconforming": nonconforming,
        "notDemonstrated": not_demonstrated,
        "notApplicable": not_applicable,
        "complete": complete,
        "complianceRate": compliance_rate,
    }
    if args.release_ready:
        if nonconforming:
            raise AssertionError(
                f"RGAA release gate has {nonconforming} non-conforming criteria"
            )
        residual = {
            row["critere"].strip()
            for row in filled
            if row["resultat"].strip().upper() == "NON DÉMONTRÉ"
        }
        unexpected = sorted(residual - RELEASE_ALLOWED_NOT_DEMONSTRATED)
        if unexpected:
            raise AssertionError(
                "RGAA release gate has non-demonstrated criteria outside the explicit "
                f"screen-reader residual: {unexpected}"
            )
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
