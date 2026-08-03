#!/usr/bin/env python3
"""Compare one normalized event stream with demoparser2.

This is an optional development tool. demoparser2 must be installed in the
invoking Python environment; it is never a RoundLab production dependency.
One stream is parsed per process because current demoparser2 releases can keep
large native state alive between event queries.
"""

from __future__ import annotations

import argparse
from collections import Counter
import gzip
import json
import math
from pathlib import Path
from typing import Any, Iterable

MAX_PLAUSIBLE_PLAYER_VELOCITY = 5_000.0


def read_gzip_json(path: Path) -> Any:
    with gzip.open(path, "rt", encoding="utf-8") as source:
        return json.load(source)


def load_roundlab(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = read_gzip_json(path)
    rounds = []
    for round_meta in manifest.get("rounds", []):
        round_file = round_meta.get("roundFile")
        rounds.append(
            read_gzip_json(path.parent / round_file)
            if round_file
            else round_meta
        )
    return manifest, rounds


def normalized_id(value: Any) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def normalized_weapon(value: Any) -> str:
    weapon = str(value or "").lower().removeprefix("weapon_").replace("-", "_")
    aliases = {
        "m4a1_silencer": "m4a1_s",
        "m4a1": "m4a4",
        "hkp2000": "p2000",
        "elite": "dual_berettas",
        "incgrenade": "incendiary",
    }
    return aliases.get(weapon, weapon)


def in_round_spans(tick: int, rounds: list[dict[str, Any]]) -> bool:
    return any(
        int(round_data.get("startTick", 0)) <= tick <=
        int(round_data.get("endTick", 0))
        for round_data in rounds
    )


def roundlab_signatures(
    stream: str,
    rounds: list[dict[str, Any]],
) -> Iterable[tuple[Any, ...]]:
    for round_data in rounds:
        if stream == "player_death":
            for event in round_data.get("events", []):
                if event.get("type") != "kill":
                    continue
                yield (
                    int(event.get("tick", -1)),
                    normalized_id(event.get("killer")),
                    normalized_id(event.get("victim")),
                    normalized_id(event.get("assist")),
                    normalized_weapon(event.get("weapon")),
                    bool(event.get("hs", False)),
                )
        elif stream == "player_hurt":
            for event in round_data.get("damages", []):
                yield (
                    int(event.get("tick", -1)),
                    normalized_id(event.get("attacker")),
                    normalized_id(event.get("victim")),
                    normalized_weapon(event.get("weapon")),
                    int(event.get("damageHealth", 0)),
                    int(event.get("damageArmor", 0)),
                    str(event.get("hitgroup") or "").lower(),
                )
        elif stream == "weapon_fire":
            for event in round_data.get("weaponFires", []):
                yield (
                    int(event.get("tick", -1)),
                    normalized_id(event.get("shooter")),
                    normalized_weapon(event.get("weapon")),
                )
        elif stream == "bullet_impact":
            for event in round_data.get("bulletImpacts", []):
                yield (
                    int(event.get("tick", -1)),
                    normalized_id(event.get("shooter")),
                    round(float(event.get("x", 0)), 3),
                    round(float(event.get("y", 0)), 3),
                    round(float(event.get("z", 0)), 3),
                )


def external_signatures(
    stream: str,
    rows: Any,
    rounds: list[dict[str, Any]],
) -> Iterable[tuple[Any, ...]]:
    if not hasattr(rows, "iterrows"):
        return
    for _, event in rows.iterrows():
        tick = int(event.get("tick", -1))
        if not in_round_spans(tick, rounds):
            continue
        if stream == "player_death":
            yield (
                tick,
                normalized_id(event.get("attacker_steamid")),
                normalized_id(event.get("user_steamid")),
                normalized_id(event.get("assister_steamid")),
                normalized_weapon(event.get("weapon")),
                bool(event.get("headshot", False)),
            )
        elif stream == "player_hurt":
            yield (
                tick,
                normalized_id(event.get("attacker_steamid")),
                normalized_id(event.get("user_steamid")),
                normalized_weapon(event.get("weapon")),
                int(event.get("dmg_health", 0)),
                int(event.get("dmg_armor", 0)),
                str(event.get("hitgroup") or "").lower(),
            )
        elif stream == "weapon_fire":
            yield (
                tick,
                normalized_id(event.get("user_steamid")),
                normalized_weapon(event.get("weapon")),
            )
        elif stream == "bullet_impact":
            yield (
                tick,
                normalized_id(event.get("user_steamid")),
                round(float(event.get("x", 0)), 3),
                round(float(event.get("y", 0)), 3),
                round(float(event.get("z", 0)), 3),
            )


def expanded_difference(
    left: Counter[tuple[Any, ...]],
    right: Counter[tuple[Any, ...]],
) -> list[tuple[Any, ...]]:
    return list((left - right).elements())


def compare_player_state(
    parser: Any,
    manifest: dict[str, Any],
    rounds: list[dict[str, Any]],
    max_ticks: int,
) -> dict[str, Any]:
    tick_rate = float(manifest.get("meta", {}).get("tickRate", 64))
    all_roundlab_ticks = sorted({
        round(int(round_data.get("startTick", 0)) +
              float(frame.get("t", 0)) * tick_rate)
        for round_data in rounds
        for frame in round_data.get("frames", [])
    })
    if max_ticks > 0 and len(all_roundlab_ticks) > max_ticks:
        requested_ticks = sorted({
            all_roundlab_ticks[
                round(index * (len(all_roundlab_ticks) - 1) / (max_ticks - 1))
            ]
            for index in range(max_ticks)
        })
    else:
        requested_ticks = all_roundlab_ticks
    exhaustive = len(requested_ticks) == len(all_roundlab_ticks)
    columns = ["X", "Y", "Z", "yaw", "pitch"]
    if exhaustive:
        columns.extend(["velocity_X", "velocity_Y"])
    requested_tick_set = set(requested_ticks)
    tick_indexes = {
        tick: index for index, tick in enumerate(all_roundlab_ticks)
    }
    query_tick_set = set(requested_ticks)
    for tick in requested_ticks:
        index = tick_indexes[tick]
        if index > 0:
            query_tick_set.add(all_roundlab_ticks[index - 1])
    query_ticks = sorted(query_tick_set)
    requested_players = sorted({
        int(normalized_id(player.get("id")))
        for round_data in rounds
        for frame in round_data.get("frames", [])
        for player in frame.get("players", [])
        if normalized_id(player.get("id")).isdigit()
    })
    external_rows = parser.parse_ticks(
        columns,
        players=requested_players,
        ticks=query_ticks,
    )
    external: dict[tuple[int, str], tuple[float, ...]] = {}
    selected_columns = ["tick", "steamid", *columns]
    selected = external_rows[selected_columns]
    for row in selected.itertuples(index=False, name=None):
        tick = int(row[0])
        if in_round_spans(tick, rounds):
            external[(tick, normalized_id(row[1]))] = tuple(
                float(value) for value in row[2:]
            )
    compared = 0
    missing = 0
    position_mismatches = 0
    yaw_mismatches = 0
    pitch_mismatches = 0
    velocity_mismatches = 0
    external_invalid_velocity = 0
    roundlab_pitch_samples = 0
    roundlab_velocity_samples = 0
    velocity_mismatch_sample: list[dict[str, Any]] = []
    for round_data in rounds:
        start_tick = int(round_data.get("startTick", 0))
        for frame in round_data.get("frames", []):
            tick = round(start_tick + float(frame.get("t", 0)) * tick_rate)
            if tick not in requested_tick_set:
                continue
            for player in frame.get("players", []):
                row = external.get((tick, normalized_id(player.get("id"))))
                if row is None:
                    missing += 1
                    continue
                compared += 1
                if any(
                    abs(float(player.get(key, 0)) - row[index]) > 1e-3
                    for key, index in (("x", 0), ("y", 1), ("z", 2))
                ):
                    position_mismatches += 1
                if abs(float(player.get("yaw", 0)) - row[3]) > 1e-3:
                    yaw_mismatches += 1
                pitch = player.get("pitch")
                if pitch is not None:
                    roundlab_pitch_samples += 1
                    external_pitch = row[4]
                    if (
                        math.isnan(float(external_pitch))
                        or abs(float(pitch) - float(external_pitch)) > 1e-3
                    ):
                        pitch_mismatches += 1
                velocity_x = player.get("velocityX")
                velocity_y = player.get("velocityY")
                if (
                    exhaustive
                    and velocity_x is not None
                    and velocity_y is not None
                ):
                    roundlab_velocity_samples += 1
                    external_x = row[5]
                    external_y = row[6]
                    if (
                        math.isnan(external_x)
                        or math.isnan(external_y)
                        or abs(external_x) > MAX_PLAUSIBLE_PLAYER_VELOCITY
                        or abs(external_y) > MAX_PLAUSIBLE_PLAYER_VELOCITY
                    ):
                        external_invalid_velocity += 1
                    elif (
                        abs(float(velocity_x) - external_x) > 1e-3
                        or abs(float(velocity_y) - external_y) > 1e-3
                    ):
                        velocity_mismatches += 1
                        if len(velocity_mismatch_sample) < 20:
                            velocity_mismatch_sample.append({
                                "tick": tick,
                                "playerId": normalized_id(player.get("id")),
                                "roundlab": [velocity_x, velocity_y],
                                "demoparser2": [external_x, external_y],
                            })
    mismatches = (
        missing +
        position_mismatches +
        yaw_mismatches +
        pitch_mismatches +
        velocity_mismatches
    )
    return {
        "schemaVersion": "roundlab.demoparser2-comparison.v1",
        "map": manifest.get("meta", {}).get("map"),
        "parserVersion": manifest.get("parserVersion"),
        "stream": "player_state",
        "roundlabSampleCount": compared + missing,
        "requestedTickCount": len(requested_ticks),
        "queriedTickCount": len(query_ticks),
        "availableRoundLabTickCount": len(all_roundlab_ticks),
        "stateSampling": (
            "exhaustive"
            if exhaustive
            else "deterministic_even"
        ),
        "velocityComparison": (
            "exhaustive"
            if exhaustive
            else "not_compared_sparse_query_artifact"
        ),
        "requestedPlayerCount": len(requested_players),
        "matchingKeyCount": compared,
        "missingExternalKeyCount": missing,
        "roundlabPitchSamples": roundlab_pitch_samples,
        "roundlabVelocitySamples": (
            roundlab_velocity_samples if exhaustive else None
        ),
        "positionMismatchCount": position_mismatches,
        "yawMismatchCount": yaw_mismatches,
        "pitchMismatchCount": pitch_mismatches,
        "velocityMismatchCount": velocity_mismatches if exhaustive else None,
        "externalInvalidVelocityCount": (
            external_invalid_velocity if exhaustive else None
        ),
        "velocityMismatchSample": velocity_mismatch_sample,
        "classification": (
            "external_sparse_tick_velocity_artifact"
            if mismatches == 0 and external_invalid_velocity > 0
            else "exact"
            if mismatches == 0
            else "unclassified"
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", required=True, type=Path)
    parser.add_argument("--roundlab", required=True, type=Path)
    parser.add_argument("--stream", required=True, choices=[
        "player_death",
        "player_hurt",
        "weapon_fire",
        "bullet_impact",
        "player_state",
    ])
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--max-state-ticks",
        type=int,
        default=4096,
        help=(
            "Maximum evenly distributed RoundLab ticks for player_state; "
            "use 0 for exhaustive comparison."
        ),
    )
    args = parser.parse_args()
    if args.max_state_ticks < 0 or args.max_state_ticks == 1:
        parser.error("--max-state-ticks must be 0 or at least 2")

    try:
        from demoparser2 import DemoParser
    except ImportError as error:
        raise SystemExit(
            "demoparser2 is optional; install it in a development environment."
        ) from error

    manifest, rounds = load_roundlab(args.roundlab)
    demo_parser = DemoParser(str(args.demo))
    if args.stream == "player_state":
        report = compare_player_state(
            demo_parser,
            manifest,
            rounds,
            args.max_state_ticks,
        )
        args.output.write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return
    external_rows = demo_parser.parse_event(args.stream)
    roundlab = Counter(roundlab_signatures(args.stream, rounds))
    external = Counter(external_signatures(args.stream, external_rows, rounds))
    missing = expanded_difference(external, roundlab)
    extra = expanded_difference(roundlab, external)
    external_available = hasattr(external_rows, "iterrows")
    only_external_missing_world_self_kills = (
        args.stream == "player_death"
        and not missing
        and len(extra) > 0
        and all(
            signature[1] == signature[2] and signature[4] == "world"
            for signature in extra
        )
    )
    report = {
        "schemaVersion": "roundlab.demoparser2-comparison.v1",
        "map": manifest.get("meta", {}).get("map"),
        "parserVersion": manifest.get("parserVersion"),
        "stream": args.stream,
        "roundlabCount": sum(roundlab.values()),
        "demoparser2Count": sum(external.values()) if external_available else None,
        "matchingCount": sum((roundlab & external).values()),
        "missingRoundLabCount": len(missing) if external_available else None,
        "extraRoundLabCount": len(extra) if external_available else None,
        "classification": (
            "external_stream_unavailable"
            if not external_available
            else "external_missing_post_round_world_kills"
            if only_external_missing_world_self_kills
            else "exact"
            if not missing and not extra
            else "unclassified"
        ),
        "missingRoundLabSample": missing[:20],
        "extraRoundLabSample": extra[:20],
    }
    args.output.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
