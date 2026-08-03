#!/usr/bin/env python3
"""Probe the deployed RoundLab pages and parser artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


DEFAULT_URL = "https://lakav.github.io/RoundLab/"
USER_AGENT = "RoundLab-production-monitor/1.0"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def fetch(url: str, *, timeout: float, max_bytes: int) -> tuple[bytes, dict[str, Any]]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Cache-Control": "no-cache"})
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read(max_bytes + 1)
            duration_ms = round((time.perf_counter() - started) * 1000)
            if len(body) > max_bytes:
                raise AssertionError(f"response exceeds safety limit of {max_bytes} bytes")
            return body, {
                "url": response.geturl(),
                "httpStatus": response.status,
                "contentType": response.headers.get_content_type(),
                "contentLength": len(body),
                "durationMs": duration_ms,
            }
    except HTTPError as exc:
        try:
            raise AssertionError(f"HTTP {exc.code} for {url}") from exc
        finally:
            exc.close()
    except URLError as exc:
        raise AssertionError(f"network error for {url}: {exc.reason}") from exc


def timing_status(duration_ms: int, warning_ms: int, critical_ms: int) -> str:
    if duration_ms > critical_ms:
        return "failed"
    if duration_ms > warning_ms:
        return "warning"
    return "passed"


def check_page(
    name: str,
    url: str,
    expected_text: str,
    *,
    timeout: float,
    warning_ms: int,
    critical_ms: int,
) -> dict[str, Any]:
    body, details = fetch(url, timeout=timeout, max_bytes=2 * 1024 * 1024)
    text = body.decode("utf-8", errors="replace")
    if expected_text not in text:
        raise AssertionError(f"{name} does not contain expected text {expected_text!r}")
    status = timing_status(details["durationMs"], warning_ms, critical_ms)
    details.update({"name": name, "status": status, "expectedText": expected_text})
    if status == "failed":
        details["error"] = f"response exceeded critical threshold of {critical_ms} ms"
    elif status == "warning":
        details["warning"] = f"response exceeded warning threshold of {warning_ms} ms"
    return details


def safe_asset_url(base_url: str, relative_path: str) -> str:
    parsed = urlparse(relative_path)
    path = Path(parsed.path)
    if parsed.scheme or parsed.netloc or relative_path.startswith("/") or ".." in path.parts:
        raise AssertionError(f"unsafe asset path in deployment manifest: {relative_path!r}")
    return urljoin(base_url, relative_path)


def failed_check(name: str, url: str, error: Exception) -> dict[str, Any]:
    return {"name": name, "url": url, "status": "failed", "error": str(error)}


def run_monitor(
    base_url: str,
    *,
    timeout: float = 15,
    warning_ms: int = 2_000,
    critical_ms: int = 5_000,
) -> dict[str, Any]:
    normalized_base = base_url.rstrip("/") + "/"
    checks: list[dict[str, Any]] = []

    page_specs = [
        ("home", normalized_base, "RoundLab"),
        ("feedback", urljoin(normalized_base, "feedback/"), "Signaler un problème"),
    ]
    for name, url, expected_text in page_specs:
        try:
            checks.append(
                check_page(
                    name,
                    url,
                    expected_text,
                    timeout=timeout,
                    warning_ms=warning_ms,
                    critical_ms=critical_ms,
                )
            )
        except Exception as exc:  # report every failed probe in one artifact
            checks.append(failed_check(name, url, exc))

    manifest_url = urljoin(normalized_base, "health.json")
    manifest: dict[str, Any] | None = None
    try:
        body, details = fetch(manifest_url, timeout=timeout, max_bytes=64 * 1024)
        manifest = json.loads(body)
        required = {
            "schemaVersion": 1,
            "application": "RoundLab",
        }
        for key, expected in required.items():
            if manifest.get(key) != expected:
                raise AssertionError(f"health manifest field {key!r} must equal {expected!r}")
        for key in ["version", "commit", "generatedAt", "routes", "wasm"]:
            if not manifest.get(key):
                raise AssertionError(f"health manifest is missing {key!r}")
        details.update(
            {
                "name": "health-manifest",
                "status": timing_status(details["durationMs"], warning_ms, critical_ms),
                "version": manifest["version"],
                "commit": manifest["commit"],
                "generatedAt": manifest["generatedAt"],
            }
        )
        checks.append(details)
    except Exception as exc:
        checks.append(failed_check("health-manifest", manifest_url, exc))

    if manifest is not None:
        wasm_url = manifest_url
        try:
            wasm = manifest["wasm"]
            wasm_url = safe_asset_url(normalized_base, str(wasm["path"]))
            body, details = fetch(wasm_url, timeout=timeout, max_bytes=4 * 1024 * 1024)
            actual_hash = hashlib.sha256(body).hexdigest()
            if len(body) != int(wasm["bytes"]):
                raise AssertionError(f"WASM size mismatch: expected {wasm['bytes']}, got {len(body)}")
            if actual_hash != wasm["sha256"]:
                raise AssertionError("WASM SHA-256 does not match the deployment manifest")
            if not body.startswith(b"\x00asm"):
                raise AssertionError("deployed parser asset does not have a WebAssembly header")
            details.update(
                {
                    "name": "parser-wasm",
                    "status": timing_status(details["durationMs"], warning_ms, critical_ms),
                    "sha256": actual_hash,
                }
            )
            checks.append(details)
        except Exception as exc:
            checks.append(failed_check("parser-wasm", wasm_url, exc))

    statuses = {check["status"] for check in checks}
    overall = "failed" if "failed" in statuses else "warning" if "warning" in statuses else "passed"
    return {
        "schemaVersion": 1,
        "application": "RoundLab",
        "checkedAt": utc_now(),
        "baseUrl": normalized_base,
        "status": overall,
        "thresholds": {"warningMs": warning_ms, "criticalMs": critical_ms},
        "checks": checks,
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = [
        f"## Supervision RoundLab - {report['checkedAt']}",
        "",
        f"- Statut global : **{str(report['status']).upper()}**",
        f"- URL : {report['baseUrl']}",
        "",
        "| Contrôle | Statut | HTTP | Durée | Détail |",
        "| --- | --- | ---: | ---: | --- |",
    ]
    for check in report["checks"]:
        detail = check.get("error") or check.get("warning") or check.get("version") or "OK"
        detail = str(detail).replace("|", "\\|").replace("\n", " ")
        lines.append(
            f"| {check['name']} | {str(check['status']).upper()} | "
            f"{check.get('httpStatus', '-')} | {check.get('durationMs', '-')} ms | {detail} |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--warning-ms", type=int, default=2_000)
    parser.add_argument("--critical-ms", type=int, default=5_000)
    parser.add_argument("--output", type=Path, default=Path("monitor-report.json"))
    parser.add_argument("--markdown-output", type=Path, default=Path("monitor-report.md"))
    args = parser.parse_args()
    if args.warning_ms >= args.critical_ms:
        parser.error("--warning-ms must be lower than --critical-ms")

    report = run_monitor(
        args.url,
        timeout=args.timeout,
        warning_ms=args.warning_ms,
        critical_ms=args.critical_ms,
    )
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    markdown = render_markdown(report)
    args.markdown_output.write_text(markdown, encoding="utf-8")
    print(markdown)
    return 1 if report["status"] == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
