#!/usr/bin/env python3
"""Audit the replay fixture coverage manifest against maps and local fixtures.

The replay fixtures are intentionally local-only because they can be large.
This check prevents the coverage gap from becoming invisible: CI validates that
every calibrated map is classified as covered or missing, while local runs also
verify that the manifest matches the ignored `.roundlab-compare` fixtures.
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_COMPARE_DIR = ROOT / ".roundlab-compare"
DEFAULT_MANIFEST = ROOT / "docs" / "replay-fixture-coverage.json"
MAPS_TS = ROOT / "desktop" / "src" / "lib" / "maps.ts"

CALIB_RE = re.compile(r"(de_[a-z0-9_]+):\s*\{\s*posX:")


Fixture = dict[str, int | str]


def calibrated_maps() -> set[str]:
    text = MAPS_TS.read_text(encoding="utf-8")
    maps = set(CALIB_RE.findall(text))
    if not maps:
        raise AssertionError(f"no calibrated maps parsed from {MAPS_TS}")
    return maps


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        manifest = json.load(f)
    if manifest.get("version") != 1:
        raise AssertionError(f"{path} must declare version 1")
    if not isinstance(manifest.get("covered"), dict):
        raise AssertionError(f"{path} covered must be an object")
    if not isinstance(manifest.get("missing"), list):
        raise AssertionError(f"{path} missing must be a list")
    return manifest


def normalize_fixture(value: Any, *, map_name: str) -> Fixture:
    if not isinstance(value, dict):
        raise AssertionError(f"{map_name} fixture entries must be objects")
    manifest = value.get("manifest")
    rounds = value.get("rounds")
    if not isinstance(manifest, str) or not manifest.endswith(".json.gz"):
        raise AssertionError(f"{map_name} fixture has invalid manifest {manifest!r}")
    if "/" in manifest or "\\" in manifest:
        raise AssertionError(f"{map_name} fixture manifest must be a basename: {manifest!r}")
    if isinstance(rounds, bool) or not isinstance(rounds, int) or rounds <= 0:
        raise AssertionError(f"{map_name} fixture {manifest} has invalid rounds {rounds!r}")
    return {"manifest": manifest, "rounds": rounds}


def normalize_covered(value: Any) -> dict[str, list[Fixture]]:
    if not isinstance(value, dict):
        raise AssertionError("covered must be an object")
    covered: dict[str, list[Fixture]] = {}
    seen_manifests: set[str] = set()
    for map_name, fixtures in value.items():
        if not isinstance(map_name, str):
            raise AssertionError("covered map names must be strings")
        if not isinstance(fixtures, list) or not fixtures:
            raise AssertionError(f"{map_name} must list at least one fixture")
        normalized = sorted(
            [normalize_fixture(fixture, map_name=map_name) for fixture in fixtures],
            key=lambda fixture: str(fixture["manifest"]),
        )
        for fixture in normalized:
            manifest = str(fixture["manifest"])
            if manifest in seen_manifests:
                raise AssertionError(f"duplicate fixture manifest {manifest}")
            seen_manifests.add(manifest)
        covered[map_name] = normalized
    return covered


def normalize_missing(value: Any) -> set[str]:
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise AssertionError("missing must be a list of map names")
    missing = set(value)
    if len(missing) != len(value):
        raise AssertionError("missing contains duplicate map names")
    return missing


def read_json_gz(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def discover_local_fixtures(compare_dir: Path) -> dict[str, list[Fixture]]:
    discovered: dict[str, list[Fixture]] = {}
    if not compare_dir.exists():
        return discovered
    for manifest_path in sorted(compare_dir.glob("*.json.gz")):
        round_dir = manifest_path.with_suffix("").with_suffix("")
        round_count = len(list(round_dir.glob("round-*.json.gz"))) if round_dir.is_dir() else 0
        if round_count == 0:
            continue
        manifest = read_json_gz(manifest_path)
        map_name = str(manifest.get("meta", {}).get("map") or "")
        if not map_name:
            raise AssertionError(f"{manifest_path} has no meta.map")
        discovered.setdefault(map_name, []).append(
            {"manifest": manifest_path.name, "rounds": round_count}
        )
    for fixtures in discovered.values():
        fixtures.sort(key=lambda fixture: str(fixture["manifest"]))
    return discovered


def format_map_list(values: set[str]) -> str:
    return ", ".join(sorted(values)) or "(none)"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--compare-dir", type=Path, default=DEFAULT_COMPARE_DIR)
    parser.add_argument(
        "--require-local-fixtures",
        action="store_true",
        help="Fail if the local .roundlab-compare fixtures are absent.",
    )
    args = parser.parse_args()

    maps = calibrated_maps()
    manifest = load_manifest(args.manifest)
    covered = normalize_covered(manifest["covered"])
    missing = normalize_missing(manifest["missing"])

    covered_maps = set(covered)
    unknown = (covered_maps | missing) - maps
    unclassified = maps - covered_maps - missing
    overlap = covered_maps & missing
    errors: list[str] = []
    if unknown:
        errors.append(f"manifest references unknown maps: {format_map_list(unknown)}")
    if unclassified:
        errors.append(f"calibrated maps are neither covered nor missing: {format_map_list(unclassified)}")
    if overlap:
        errors.append(f"maps cannot be both covered and missing: {format_map_list(overlap)}")
    if errors:
        raise AssertionError("; ".join(errors))

    local = discover_local_fixtures(args.compare_dir)
    if args.require_local_fixtures and not local:
        raise AssertionError(f"no local replay fixtures found in {args.compare_dir}")
    if local:
        if local != covered:
            raise AssertionError(
                "local replay fixture coverage differs from docs/replay-fixture-coverage.json: "
                f"local={json.dumps(local, sort_keys=True)} "
                f"manifest={json.dumps(covered, sort_keys=True)}"
            )
        proof = "with local fixture proof"
    else:
        proof = "manifest-only; local fixtures absent"

    covered_rounds = sum(int(fixture["rounds"]) for fixtures in covered.values() for fixture in fixtures)
    print(
        "Replay fixture coverage passed: "
        f"{len(covered_maps)}/{len(maps)} maps covered, "
        f"{covered_rounds} local fixture rounds documented, "
        f"missing={format_map_list(missing)} ({proof})"
    )


if __name__ == "__main__":
    main()
