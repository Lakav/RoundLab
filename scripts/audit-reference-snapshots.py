#!/usr/bin/env python3
"""Validate Rust reference snapshots against a saved Go/Rust audit report.

This is intentionally read-only. It does not regenerate parser outputs or
snapshots; it checks that parser/reference_demos.json still matches the Rust
side of a recent scripts/compare-parsers.py --round-audit JSON report.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REFERENCE = ROOT / "parser" / "reference_demos.json"
DEFAULT_REPORT = ROOT / ".roundlab-compare" / "full-round-audit-current.json"

METRIC_FIELDS = [
    "rounds",
    "players",
    "frames",
    "framePlayers",
    "framesWithPlayers",
    "framesWithBombState",
    "playersWithWeapons",
    "events",
    "kills",
    "bombEvents",
    "effects",
    "weaponFires",
    "projectileFrames",
    "projectileSamples",
]

BOMB_EVENTS = {
    "bomb_planted",
    "bomb_defuse_start",
    "bomb_defuse_abort",
    "bomb_defused",
    "bomb_exploded",
}

SNAPSHOT_SIGNATURE_FIELDS = [
    "roundEventSignatures",
    "roundTerminalEventSignatures",
    "roundEffectSignatures",
    "roundWeaponFireSignatures",
    "roundBombStateSignatures",
    "roundActiveActionSignatures",
    "roundProjectileTrackSignatures",
]

REFERENCE_ROUND_LIST_FIELDS = [
    "roundMetrics",
    *SNAPSHOT_SIGNATURE_FIELDS,
    "roundWeaponFireToleranceSignatures",
    "roundClassifiedToleranceSignatures",
]

RUST_ZERO_INTEGRITY_FIELDS = [
    "duplicateProjectiles",
    "physicallyDuplicateProjectiles",
    "nonMonotonicProjectileFrames",
    "projectileTrackBreaks",
    "projectileTeleportCount",
]


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def result_key(result: dict[str, Any]) -> str:
    return Path(str(result.get("demo", ""))).name


def metric_value(metrics: dict[str, Any], field: str) -> int:
    value = metrics.get(field)
    if not isinstance(value, int):
        raise AssertionError(f"report metric {field} is missing or not an int: {value!r}")
    return value


def expect_equal(label: str, field: str, actual: Any, expected: Any) -> None:
    if actual != expected:
        raise AssertionError(
            f"{label} {field} mismatch: report={actual!r} reference={expected!r}"
        )


def expected_score_from_name(file_name: str) -> tuple[int, int] | None:
    match = re.search(r"(\d+)-(\d+)\.dem(?:\.zst)?$", file_name)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def reference_int(value: Any, label: str, field: str) -> int:
    if not isinstance(value, int):
        raise AssertionError(f"{label} reference {field} is missing or not an int: {value!r}")
    return value


def assert_reference_snapshot_shape(snapshot: dict[str, Any]) -> str:
    file_name = snapshot.get("fileName")
    if not isinstance(file_name, str):
        raise AssertionError(f"snapshot without fileName: {snapshot!r}")
    label = snapshot.get("label") or file_name

    expected_score = expected_score_from_name(file_name)
    if expected_score is None:
        raise AssertionError(f"{label} fileName does not contain score truth: {file_name}")
    expect_equal(label, "scoreA", snapshot.get("scoreA"), expected_score[0])
    expect_equal(label, "scoreB", snapshot.get("scoreB"), expected_score[1])

    metrics = snapshot.get("metrics")
    if not isinstance(metrics, dict):
        raise AssertionError(f"{label} reference metrics is missing or not an object")
    for field in METRIC_FIELDS:
        reference_int(metrics.get(field), label, f"metrics.{field}")

    round_metrics = snapshot.get("roundMetrics")
    if not isinstance(round_metrics, list):
        raise AssertionError(f"{label} roundMetrics is missing or not a list")
    expect_equal(label, "metrics.rounds", metrics.get("rounds"), len(round_metrics))

    for field in REFERENCE_ROUND_LIST_FIELDS:
        values = snapshot.get(field)
        if not isinstance(values, list):
            raise AssertionError(f"{label} {field} is missing or not a list")
        expect_equal(label, f"{field}.length", len(values), len(round_metrics))
        for idx, item in enumerate(values):
            if not isinstance(item, dict):
                raise AssertionError(f"{label} {field}[{idx}] is not an object")
            expected_number = round_metrics[idx].get("number")
            expect_equal(label, f"{field}[{idx}].number", item.get("number"), expected_number)

    sum_fields = [
        "frames",
        "events",
        "kills",
        "bombEvents",
        "effects",
        "weaponFires",
        "projectileFrames",
        "projectileSamples",
    ]
    for field in sum_fields:
        total = sum(
            reference_int(round_obj.get(field), label, f"roundMetrics.{field}")
            for round_obj in round_metrics
        )
        expect_equal(label, f"metrics.{field}", metrics.get(field), total)

    if round_metrics:
        final_round = round_metrics[-1]
        expect_equal(label, "final scoreA", final_round.get("scoreA"), snapshot.get("scoreA"))
        expect_equal(label, "final scoreB", final_round.get("scoreB"), snapshot.get("scoreB"))

    return file_name


def audit_reference_only(reference_path: Path) -> list[str]:
    snapshots = load_json(reference_path)
    if not isinstance(snapshots, list):
        raise AssertionError(f"{reference_path} must contain a list of snapshots")
    checked = [assert_reference_snapshot_shape(snapshot) for snapshot in snapshots]
    duplicates = sorted(name for name in set(checked) if checked.count(name) > 1)
    if duplicates:
        raise AssertionError(f"duplicate reference snapshots: {duplicates}")
    return checked


def aggregate_rust_metrics(report_metrics: dict[str, Any], report_rounds: list[dict[str, Any]]) -> dict[str, int]:
    aggregate = {
        field: metric_value(report_metrics, field)
        for field in METRIC_FIELDS
        if field not in {"framesWithPlayers", "playersWithWeapons"}
    }
    frames_with_players = 0
    players_with_weapons = 0
    for round_obj in report_rounds:
        rust = round_obj.get("rust")
        if not isinstance(rust, dict):
            continue
        frames_with_players += int(rust.get("framesWithPlayers", 0) or 0)
        players_with_weapons += int(rust.get("playersWithWeapons", 0) or 0)
    aggregate["framesWithPlayers"] = frames_with_players
    aggregate["playersWithWeapons"] = players_with_weapons
    return aggregate


def assert_metrics_match(label: str, actual: dict[str, int], reference: dict[str, Any]) -> None:
    for field in METRIC_FIELDS:
        expect_equal(label, field, actual.get(field), reference.get(field))


def round_kill_count(summary: dict[str, Any]) -> int:
    return int(summary.get("eventCounts", {}).get("kill", 0))


def round_bomb_event_count(summary: dict[str, Any]) -> int:
    event_counts = summary.get("eventCounts", {})
    return sum(int(event_counts.get(kind, 0)) for kind in BOMB_EVENTS)


def assert_round_metrics_match(
    label: str,
    report_rounds: list[dict[str, Any]],
    reference_rounds: list[dict[str, Any]],
) -> None:
    expect_equal(label, "roundMetrics.length", len(report_rounds), len(reference_rounds))
    for idx, (report_round, reference_round) in enumerate(zip(report_rounds, reference_rounds)):
        rust = report_round.get("rust")
        if not isinstance(rust, dict):
            raise AssertionError(f"{label} round {idx} is missing Rust round audit summary")
        round_label = f"{label} round {idx}"
        for field in ["number", "scoreA", "scoreB", "frames", "events", "effects", "weaponFires", "projectileFrames", "projectileSamples"]:
            expect_equal(round_label, field, rust.get(field), reference_round.get(field))
        expect_equal(round_label, "kills", round_kill_count(rust), reference_round.get("kills"))
        expect_equal(
            round_label,
            "bombEvents",
            round_bomb_event_count(rust),
            reference_round.get("bombEvents"),
        )


def assert_snapshot_signatures_match(
    label: str,
    round_audit: dict[str, Any],
    reference: dict[str, Any],
) -> None:
    rust_signatures = round_audit.get("rustSnapshotSignatures")
    if not isinstance(rust_signatures, dict):
        raise AssertionError(
            f"{label} report is missing rustSnapshotSignatures; rerun compare-parsers.py with --round-audit"
        )
    for field in SNAPSHOT_SIGNATURE_FIELDS:
        expect_equal(label, field, rust_signatures.get(field), reference.get(field))


def assert_weapon_fire_tolerances_match(
    label: str,
    round_audit: dict[str, Any],
    reference: dict[str, Any],
) -> None:
    actual = round_audit.get("roundWeaponFireToleranceSignatures")
    if not isinstance(actual, list):
        raise AssertionError(
            f"{label} report is missing roundWeaponFireToleranceSignatures; rerun compare-parsers.py with --round-audit"
        )
    expect_equal(
        label,
        "roundWeaponFireToleranceSignatures",
        actual,
        reference.get("roundWeaponFireToleranceSignatures"),
    )


def assert_classified_tolerances_match(
    label: str,
    round_audit: dict[str, Any],
    reference: dict[str, Any],
) -> None:
    actual = round_audit.get("roundClassifiedToleranceSignatures")
    if not isinstance(actual, list):
        raise AssertionError(
            f"{label} report is missing roundClassifiedToleranceSignatures; rerun compare-parsers.py with --round-audit"
        )
    expect_equal(
        label,
        "roundClassifiedToleranceSignatures",
        actual,
        reference.get("roundClassifiedToleranceSignatures"),
    )


def assert_no_unclassified_mismatches(report: dict[str, Any]) -> None:
    summary = report.get("roundAuditSummary")
    if not isinstance(summary, dict):
        raise AssertionError("report is missing roundAuditSummary; rerun compare-parsers.py with --round-audit")
    unclassified = summary.get("unclassifiedMismatchCounts", {})
    if unclassified:
        raise AssertionError(f"Go/Rust audit still has unclassified mismatches: {unclassified}")


def assert_no_critical_signature_diffs(report: dict[str, Any]) -> None:
    forbidden_fields = {"killSignatures", "bombSignatures"}
    offenders = []
    for result in report.get("results", []):
        audit = result.get("roundAudit") or {}
        for round_obj in audit.get("rounds", []):
            for diff in round_obj.get("diffs", []):
                if diff.get("field") in forbidden_fields:
                    offenders.append(
                        {
                            "demo": result_key(result),
                            "round": round_obj.get("index"),
                            "field": diff.get("field"),
                            "missingInRustCount": diff.get("missingInRustCount"),
                            "extraInRustCount": diff.get("extraInRustCount"),
                        }
                    )
    if offenders:
        raise AssertionError(f"critical Go/Rust signature diffs remain: {offenders[:10]}")


def assert_rust_replay_integrity(label: str, report_rounds: list[dict[str, Any]]) -> None:
    offenders = []
    pose_offenders = []
    for round_obj in report_rounds:
        round_index = round_obj.get("index")
        rust = round_obj.get("rust")
        if not isinstance(rust, dict):
            raise AssertionError(f"{label} round {round_index} is missing Rust round audit summary")
        for field in RUST_ZERO_INTEGRITY_FIELDS:
            value = rust.get(field)
            if value != 0:
                offenders.append({"round": round_index, "field": field, "rust": value})
        for diff in round_obj.get("diffs", []):
            if diff.get("field") != "firePoseTolerance":
                continue
            pose_mismatch_count = int(diff.get("poseMismatchCount") or 0)
            if pose_mismatch_count:
                pose_offenders.append(
                    {
                        "round": round_index,
                        "poseMismatchCount": pose_mismatch_count,
                        "sample": diff.get("poseMismatchSample", [])[:3],
                    }
                )
    if offenders:
        raise AssertionError(f"{label} Rust replay integrity regressions: {offenders[:10]}")
    if pose_offenders:
        raise AssertionError(f"{label} Rust weapon-fire pose mismatches: {pose_offenders[:10]}")


def audit(reference_path: Path, report_path: Path) -> list[str]:
    snapshots = load_json(reference_path)
    report = load_json(report_path)
    if not isinstance(snapshots, list):
        raise AssertionError(f"{reference_path} must contain a list of snapshots")
    for snapshot in snapshots:
        assert_reference_snapshot_shape(snapshot)
    if report.get("quality") != "full" or report.get("skipHeavy") is not False:
        raise AssertionError("snapshot audit expects a full-quality non-skip compare report")

    assert_no_unclassified_mismatches(report)
    assert_no_critical_signature_diffs(report)

    results = {result_key(result): result for result in report.get("results", [])}
    checked = []
    for snapshot in snapshots:
        file_name = snapshot.get("fileName")
        if not isinstance(file_name, str):
            raise AssertionError(f"snapshot without fileName: {snapshot!r}")
        result = results.get(file_name)
        if result is None:
            raise AssertionError(f"report is missing reference demo {file_name}")

        label = snapshot.get("label") or file_name
        expected_score = result.get("expectedScore") or {}
        expect_equal(label, "scoreA", expected_score.get("scoreA"), snapshot.get("scoreA"))
        expect_equal(label, "scoreB", expected_score.get("scoreB"), snapshot.get("scoreB"))

        go_metrics = result.get("go", {}).get("metrics", {})
        rust_metrics = result.get("rust", {}).get("metrics", {})
        expect_equal(label, "go.scoreA", go_metrics.get("scoreA"), snapshot.get("scoreA"))
        expect_equal(label, "go.scoreB", go_metrics.get("scoreB"), snapshot.get("scoreB"))
        expect_equal(label, "rust.scoreA", rust_metrics.get("scoreA"), snapshot.get("scoreA"))
        expect_equal(label, "rust.scoreB", rust_metrics.get("scoreB"), snapshot.get("scoreB"))
        round_audit = result.get("roundAudit")
        if not isinstance(round_audit, dict):
            raise AssertionError(f"{label} is missing roundAudit; rerun compare-parsers.py with --round-audit")
        report_rounds = round_audit.get("rounds", [])
        assert_metrics_match(
            label,
            aggregate_rust_metrics(rust_metrics, report_rounds),
            snapshot.get("metrics", {}),
        )
        assert_round_metrics_match(
            label,
            report_rounds,
            snapshot.get("roundMetrics", []),
        )
        assert_rust_replay_integrity(label, report_rounds)
        assert_snapshot_signatures_match(label, round_audit, snapshot)
        assert_weapon_fire_tolerances_match(label, round_audit, snapshot)
        assert_classified_tolerances_match(label, round_audit, snapshot)
        checked.append(file_name)

    extra = sorted(set(results) - set(checked))
    if extra:
        raise AssertionError(f"report contains demos that are not reference snapshots: {extra}")
    return checked


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument(
        "--reference-only",
        action="store_true",
        help="validate parser/reference_demos.json structure without a Go/Rust report",
    )
    args = parser.parse_args()

    checked = (
        audit_reference_only(args.reference)
        if args.reference_only
        else audit(args.reference, args.report)
    )
    mode = "reference snapshot shape audit" if args.reference_only else "reference snapshot audit"
    print(f"{mode} passed: {len(checked)} demos")
    for file_name in checked:
        print(f"- {file_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
