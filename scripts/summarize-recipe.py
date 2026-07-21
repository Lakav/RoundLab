#!/usr/bin/env python3
"""Generate recipe counters from the canonical Markdown table."""

from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


SOURCE = Path("docs/rncp-bloc2/evidence/03-plan-tests-recette.md")
OUTPUT = Path("docs/rncp-bloc2/evidence/recipe-summary.json")
ALLOWED = {"OK", "NOK", "BLOQUÉ"}


def main() -> int:
    scenarios: list[dict[str, str]] = []
    for line in SOURCE.read_text(encoding="utf-8").splitlines():
        if not line.startswith("| REC-"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 9:
            raise SystemExit(f"invalid recipe row ({len(cells)} columns): {line}")
        status = cells[6]
        if status not in ALLOWED:
            raise SystemExit(f"invalid status for {cells[0]}: {status}")
        scenarios.append({"id": cells[0], "status": status, "date": cells[7]})
    if len(scenarios) != 16:
        raise SystemExit(f"expected 16 recipe scenarios, found {len(scenarios)}")
    counts = Counter(scenario["status"] for scenario in scenarios)
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": str(SOURCE),
        "counts": {status: counts[status] for status in ["OK", "NOK", "BLOQUÉ"]},
        "scenarios": scenarios,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload["counts"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
