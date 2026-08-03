#!/usr/bin/env python3
"""Write the health manifest shipped with the static RoundLab deployment."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "web" / "out"
PACKAGE_JSON = ROOT / "web" / "package.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def current_commit() -> str:
    configured = os.environ.get("GITHUB_SHA", "").strip()
    if configured:
        return configured
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def deployment_base_path() -> str:
    configured = os.environ.get("ROUNDLAB_BASE_PATH")
    if configured is not None:
        value = configured.strip().strip("/")
        return f"/{value}" if value else ""
    repository = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if os.environ.get("GITHUB_ACTIONS") == "true" and "/" in repository:
        return f"/{repository.rsplit('/', 1)[-1]}"
    return ""


def create_manifest(out_dir: Path, *, commit: str, generated_at: str) -> dict[str, object]:
    if not out_dir.is_dir():
        raise AssertionError(f"static export is missing: {out_dir}")

    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    wasm_files = sorted((out_dir / "_next" / "static" / "media").glob("roundlab_parser_bg*.wasm"))
    if len(wasm_files) != 1:
        raise AssertionError(f"expected exactly one RoundLab WASM asset, found {len(wasm_files)}")

    wasm = wasm_files[0]
    return {
        "schemaVersion": 1,
        "application": "RoundLab",
        "version": package["version"],
        "commit": commit,
        "generatedAt": generated_at,
        "basePath": deployment_base_path(),
        "routes": {
            "home": "./",
            "feedback": "feedback/",
        },
        "wasm": {
            "path": wasm.relative_to(out_dir).as_posix(),
            "bytes": wasm.stat().st_size,
            "sha256": sha256_file(wasm),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--commit", default=current_commit())
    parser.add_argument(
        "--generated-at",
        default=datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    )
    args = parser.parse_args()

    out_dir = args.out_dir.resolve()
    output = args.output.resolve() if args.output else out_dir / "health.json"
    manifest = create_manifest(out_dir, commit=args.commit, generated_at=args.generated_at)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(
        f"deployment manifest written: {output} "
        f"({manifest['version']} @ {str(manifest['commit'])[:12]})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
