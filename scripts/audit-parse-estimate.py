#!/usr/bin/env python3
"""Audit browser parse-time estimate invariants."""

from __future__ import annotations

import math
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "desktop" / "src" / "app" / "page.tsx"

CONST_RE = re.compile(r"const\s+([A-Z0-9_]+)\s*=\s*([0-9_]+(?:\.[0-9_]+)?);")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def load_constants() -> dict[str, float]:
    text = read(PAGE)
    constants = {
        name: float(value.replace("_", ""))
        for name, value in CONST_RE.findall(text)
    }
    required = {
        "FALLBACK_PARSE_ESTIMATE_MS",
        "FALLBACK_WEB_MS_PER_MB",
        "FALLBACK_ZSTD_EXPANSION_RATIO",
        "MIN_ZSTD_WEB_MS_PER_MB",
        "MIN_WEB_PARSE_ESTIMATE_MS",
    }
    missing = sorted(required - set(constants))
    if missing:
        raise AssertionError(f"missing parse estimate constants: {missing}")
    return constants


def web_estimate_for_bytes(bytes_count: float, constants: dict[str, float], min_ms_per_mb = 0.0) -> float:
    ms_per_mb = max(constants["FALLBACK_WEB_MS_PER_MB"], min_ms_per_mb)
    return max(constants["MIN_WEB_PARSE_ESTIMATE_MS"], (bytes_count / 1024 / 1024) * ms_per_mb)


def estimate_for_source(size: float, is_zstd: bool, constants: dict[str, float]) -> float:
    expansion = constants["FALLBACK_ZSTD_EXPANSION_RATIO"] if is_zstd else 1
    min_ms = constants["MIN_ZSTD_WEB_MS_PER_MB"] if is_zstd else 0
    return web_estimate_for_bytes(size * expansion, constants, min_ms)


def shown_progress(elapsed_ms: float, estimate_ms: float, backend_pct: float, uploading = True) -> float:
    time_pct = min(0.95, elapsed_ms / estimate_ms)
    blended = backend_pct if backend_pct > 0.95 else max(backend_pct, time_pct)
    return max(0.03, min(0.99, blended)) if uploading else 0


def remaining_ms(elapsed_ms: float, parse_estimate_ms: float, backend_pct: float) -> float:
    backend_estimated_total_ms = max(elapsed_ms, elapsed_ms / backend_pct) if backend_pct >= 0.35 else None
    effective_estimate_ms = backend_estimated_total_ms if backend_estimated_total_ms is not None else parse_estimate_ms
    return max(0, effective_estimate_ms - elapsed_ms)


def assert_constants_are_sane(constants: dict[str, float], errors: list[str]) -> None:
    if constants["MIN_WEB_PARSE_ESTIMATE_MS"] <= 0:
        errors.append("MIN_WEB_PARSE_ESTIMATE_MS must be positive")
    if constants["FALLBACK_PARSE_ESTIMATE_MS"] < constants["MIN_WEB_PARSE_ESTIMATE_MS"]:
        errors.append("fallback parse estimate must not be shorter than the minimum web estimate")
    if constants["FALLBACK_WEB_MS_PER_MB"] <= 0:
        errors.append("FALLBACK_WEB_MS_PER_MB must be positive")
    if constants["FALLBACK_ZSTD_EXPANSION_RATIO"] <= 1:
        errors.append("zstd fallback expansion ratio must stay > 1")
    if constants["MIN_ZSTD_WEB_MS_PER_MB"] <= 0:
        errors.append("MIN_ZSTD_WEB_MS_PER_MB must be positive")
    if constants["MIN_ZSTD_WEB_MS_PER_MB"] > constants["FALLBACK_WEB_MS_PER_MB"]:
        errors.append("zstd minimum ms/MB must not exceed the fallback web ms/MB")


def assert_source_contract(errors: list[str]) -> None:
    page = read(PAGE)
    required = [
        "sourceIsZstd(source)",
        "FALLBACK_ZSTD_EXPANSION_RATIO",
        "const parsed = JSON.parse(window.localStorage.getItem(PARSE_ESTIMATE_KEY) ?? \"{}\") as unknown",
        "if (!parsed || typeof parsed !== \"object\" || Array.isArray(parsed)) return {}",
        "return webEstimateForBytes(size * expansionRatio",
        "effectiveBytes && effectiveBytes > 0 ? effectiveBytes : rawSize",
        "effectiveBytes && effectiveBytes > rawSize",
        "effectiveBytes / rawSize",
        "previousRatio * 0.65 + ratioObserved * 0.35",
        "parseEffectiveBytesRef.current = parseSourceSize(source)",
        "parseMinMsPerMbRef.current = sourceIsZstd(source) ? MIN_ZSTD_WEB_MS_PER_MB : 0",
        "progress.effectiveBytes && progress.effectiveBytes > 0",
        "parseEffectiveBytesRef.current = progress.effectiveBytes",
        "Math.max(current, webEstimateForBytes(progress.effectiveBytes ?? 0, parseMinMsPerMbRef.current))",
        "backendPct >= 0.35",
        "elapsedMs / backendPct",
        "backendPct > 0.95 ? backendPct : Math.max(backendPct, timePct)",
        "estimateExceeded ? \"Still parsing\"",
    ]
    for snippet in required:
        if snippet not in page:
            errors.append(f"desktop/src/app/page.tsx is missing parse estimate contract {snippet!r}")


def assert_simulated_estimates(constants: dict[str, float], errors: list[str]) -> None:
    one_mb = 1024 * 1024
    dem_100mb = estimate_for_source(100 * one_mb, False, constants)
    zstd_100mb = estimate_for_source(100 * one_mb, True, constants)
    tiny = estimate_for_source(1, False, constants)
    if not math.isclose(dem_100mb, 100 * constants["FALLBACK_WEB_MS_PER_MB"]):
        errors.append("plain .dem estimate no longer scales linearly by fallback ms/MB")
    if zstd_100mb <= dem_100mb:
        errors.append(".zst estimate must be larger than an equal compressed-byte .dem estimate")
    if tiny != constants["MIN_WEB_PARSE_ESTIMATE_MS"]:
        errors.append("tiny demos must use the minimum web parse estimate instead of an instant ETA")

    early = shown_progress(30_000, 120_000, 0.02)
    late = shown_progress(300_000, 120_000, 0.20)
    backend_late = shown_progress(300_000, 120_000, 0.96)
    if early <= 0.02:
        errors.append("time-based progress must move the bar before useful backend progress arrives")
    if late > 0.99:
        errors.append("shown progress must stay capped below completion while still parsing")
    if backend_late < 0.96:
        errors.append("late backend progress must not be hidden by the time-based cap")

    before_backend_eta = remaining_ms(40_000, 120_000, 0.20)
    after_backend_eta = remaining_ms(40_000, 120_000, 0.50)
    if before_backend_eta != 80_000:
        errors.append("ETA before reliable backend progress should use the source-size estimate")
    if after_backend_eta != 40_000:
        errors.append("ETA after reliable backend progress should use elapsed/backend progress")


def main() -> None:
    constants = load_constants()
    errors: list[str] = []
    assert_constants_are_sane(constants, errors)
    assert_source_contract(errors)
    assert_simulated_estimates(constants, errors)
    if errors:
        raise AssertionError("parse estimate audit failed: " + "; ".join(errors))
    print("parse estimate audit passed")


if __name__ == "__main__":
    main()
