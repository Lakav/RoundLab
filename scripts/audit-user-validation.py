#!/usr/bin/env python3
"""Validate real, anonymized user-validation session evidence."""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import date
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs" / "rncp-bloc2" / "evidence"
DEFAULT_PARTICIPANTS = EVIDENCE / "validation-utilisateur-participants.csv"
DEFAULT_TASKS = EVIDENCE / "validation-utilisateur-taches.csv"
PARTICIPANT_HEADERS = [
    "participant",
    "profil",
    "environnement",
    "consentement",
    "date",
    "taches_reussies",
    "duree_totale_secondes",
    "difficultes",
    "problemes_rencontres",
    "commentaire",
]
TASK_HEADERS = [
    "participant",
    "tache",
    "reussite",
    "duree_secondes",
    "aide_fournie",
    "difficulte",
    "probleme_rencontre",
    "observation",
]
EXPECTED_TASKS = {f"UT-{number:02d}" for number in range(1, 9)}
PARTICIPANT_ID = re.compile(r"P[0-9]{2,}")


def read_csv(path: Path, expected_headers: list[str]) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != expected_headers:
            raise AssertionError(
                f"{path} headers must be {expected_headers}, got {reader.fieldnames}"
            )
        return list(reader)


def require_text(row: dict[str, str], fields: list[str], label: str) -> None:
    for field in fields:
        if not row[field].strip():
            raise AssertionError(f"{label}: {field} is required")


def parse_int(value: str, *, label: str, minimum: int, maximum: int | None = None) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise AssertionError(f"{label} must be an integer, got {value!r}") from exc
    if parsed < minimum or (maximum is not None and parsed > maximum):
        bounds = f"{minimum}..{maximum}" if maximum is not None else f">= {minimum}"
        raise AssertionError(f"{label} must be {bounds}, got {parsed}")
    return parsed


def validate_participant(row: dict[str, str]) -> tuple[str, int, int]:
    require_text(row, PARTICIPANT_HEADERS, "participant row")
    participant = row["participant"].strip()
    if not PARTICIPANT_ID.fullmatch(participant):
        raise AssertionError(
            f"participant identifier {participant!r} must be anonymized as P01, P02, ..."
        )
    if row["consentement"].strip().lower() != "oui":
        raise AssertionError(f"{participant}: consentement must be 'oui'")
    try:
        date.fromisoformat(row["date"].strip())
    except ValueError as exc:
        raise AssertionError(f"{participant}: date must use ISO YYYY-MM-DD") from exc
    successes = parse_int(
        row["taches_reussies"].strip(),
        label=f"{participant}: taches_reussies",
        minimum=0,
        maximum=8,
    )
    total_seconds = parse_int(
        row["duree_totale_secondes"].strip(),
        label=f"{participant}: duree_totale_secondes",
        minimum=1,
    )
    return participant, successes, total_seconds


def validate_task(row: dict[str, str], *, line_number: int) -> tuple[str, str, bool, int]:
    require_text(row, TASK_HEADERS, f"task line {line_number}")
    participant = row["participant"].strip()
    task = row["tache"].strip()
    if not PARTICIPANT_ID.fullmatch(participant):
        raise AssertionError(f"task line {line_number}: invalid participant {participant!r}")
    if task not in EXPECTED_TASKS:
        raise AssertionError(f"task line {line_number}: unexpected task {task!r}")
    success_value = row["reussite"].strip().lower()
    if success_value not in {"oui", "non"}:
        raise AssertionError(f"{participant}/{task}: reussite must be 'oui' or 'non'")
    seconds = parse_int(
        row["duree_secondes"].strip(),
        label=f"{participant}/{task}: duree_secondes",
        minimum=1,
    )
    parse_int(
        row["difficulte"].strip(),
        label=f"{participant}/{task}: difficulte",
        minimum=1,
        maximum=5,
    )
    return participant, task, success_value == "oui", seconds


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--participants", type=Path, default=DEFAULT_PARTICIPANTS)
    parser.add_argument("--tasks", type=Path, default=DEFAULT_TASKS)
    parser.add_argument(
        "--require-complete",
        action="store_true",
        help="fail unless at least two real participants each have all eight tasks",
    )
    args = parser.parse_args()

    participant_rows = read_csv(args.participants, PARTICIPANT_HEADERS)
    task_rows = read_csv(args.tasks, TASK_HEADERS)

    if not participant_rows and task_rows:
        raise AssertionError("task evidence cannot exist without participant evidence")
    if args.require_complete and len(participant_rows) < 2:
        raise AssertionError(
            "user validation is incomplete: two real participants are required, "
            f"found {len(participant_rows)}"
        )

    participants: dict[str, tuple[int, int]] = {}
    for row in participant_rows:
        participant, successes, total_seconds = validate_participant(row)
        if participant in participants:
            raise AssertionError(f"duplicate participant {participant}")
        participants[participant] = (successes, total_seconds)

    tasks_by_participant: dict[str, dict[str, tuple[bool, int]]] = {
        participant: {} for participant in participants
    }
    for line_number, row in enumerate(task_rows, start=2):
        participant, task, success, seconds = validate_task(row, line_number=line_number)
        if participant not in participants:
            raise AssertionError(f"{participant}/{task}: participant is absent from summary file")
        if task in tasks_by_participant[participant]:
            raise AssertionError(f"duplicate task {participant}/{task}")
        tasks_by_participant[participant][task] = (success, seconds)

    total_successes = 0
    total_seconds = 0
    for participant, (expected_successes, expected_seconds) in participants.items():
        tasks = tasks_by_participant[participant]
        missing = sorted(EXPECTED_TASKS - set(tasks))
        if missing:
            raise AssertionError(f"{participant}: missing tasks {missing}")
        actual_successes = sum(success for success, _ in tasks.values())
        actual_seconds = sum(seconds for _, seconds in tasks.values())
        if actual_successes != expected_successes:
            raise AssertionError(
                f"{participant}: taches_reussies says {expected_successes}, tasks prove {actual_successes}"
            )
        if actual_seconds != expected_seconds:
            raise AssertionError(
                f"{participant}: duree_totale_secondes says {expected_seconds}, tasks prove {actual_seconds}"
            )
        total_successes += actual_successes
        total_seconds += actual_seconds

    participant_count = len(participants)
    task_count = len(task_rows)
    complete = participant_count >= 2 and task_count == participant_count * 8
    summary = {
        "participants": participant_count,
        "tasks": task_count,
        "successfulTasks": total_successes,
        "totalDurationSeconds": total_seconds,
        "complete": complete,
        "successRate": (
            round(total_successes * 100 / task_count, 2) if complete else None
        ),
    }
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
