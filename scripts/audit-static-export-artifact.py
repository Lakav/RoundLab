#!/usr/bin/env python3
"""Audit the generated Next static export.

Run this after `cd web && pnpm build`. Source-level checks can prove config
intent, but this checks the actual `web/out` artifact that would be hosted.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "out"
MAPS_TS = ROOT / "web" / "src" / "lib" / "maps.ts"
PUBLIC_MAPS = ROOT / "web" / "public" / "cs2lens-maps"

REF_RE = re.compile(r"""(?:href|src)=["']([^"']+)["']""")
CALIB_RE = re.compile(r"(de_[a-z0-9_]+):\s*\{\s*posX:")


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def require_file(path: Path, errors: list[str]) -> None:
    if not path.exists():
        errors.append(f"missing static export file {rel(path)}")
    elif path.stat().st_size <= 0:
        errors.append(f"static export file {rel(path)} is empty")


def static_chunks() -> list[Path]:
    chunks_dir = OUT / "_next" / "static" / "chunks"
    if not chunks_dir.exists():
        return []
    return sorted(path for path in chunks_dir.glob("*.js") if path.is_file())


def any_chunk_contains(chunks: list[Path], snippet: str) -> bool:
    return any(snippet in read(chunk) for chunk in chunks)


def calibrated_maps() -> set[str]:
    text = read(MAPS_TS)
    maps = set(CALIB_RE.findall(text))
    if not maps:
        raise AssertionError(f"no calibrated maps parsed from {rel(MAPS_TS)}")
    return maps


def assert_required_output(errors: list[str]) -> None:
    if not OUT.exists():
        raise AssertionError("web/out is missing; run `cd web && pnpm build` before this audit")
    for path in [
        OUT / "index.html",
        OUT / "match" / "index.html",
        OUT / "404.html",
        OUT / "logo.png",
        OUT / "favicon.ico",
        OUT / "icons" / "p90.svg",
        OUT / "icons" / "sg556.svg",
    ]:
        require_file(path, errors)
    for map_name in sorted(calibrated_maps()):
        require_file(OUT / "cs2lens-maps" / f"{map_name}.png", errors)
        lower = PUBLIC_MAPS / f"{map_name}_lower.png"
        if lower.exists():
            require_file(OUT / "cs2lens-maps" / lower.name, errors)

    media = list((OUT / "_next" / "static" / "media").glob("*")) if (OUT / "_next" / "static" / "media").exists() else []
    if not any(path.name.endswith(".wasm") and "roundlab_parser_bg" in path.name for path in media):
        errors.append("static export is missing bundled roundlab_parser_bg WASM media")
    if not any("web-parser.worker" in path.name for path in media):
        errors.append("static export is missing bundled web-parser.worker media")
    if not any("zstd-decompress.worker" in path.name for path in media):
        errors.append("static export is missing bundled zstd decompression worker media")


def assert_parser_worker_bundle(errors: list[str]) -> None:
    chunks = static_chunks()
    if not chunks:
        errors.append("static export is missing Next static JS chunks")
        return

    if not any(path.name.startswith("turbopack-worker") for path in chunks):
        errors.append("static export is missing the Turbopack worker bootstrap chunk")
    if not any_chunk_contains(chunks, "TURBOPACK_NEXT_CHUNK_URLS"):
        errors.append("worker bootstrap chunk is missing the Turbopack worker chunk manifest")
    if not any_chunk_contains(chunks, "web-parser.worker"):
        errors.append("client chunks do not reference the parser worker entry asset")
    if not any_chunk_contains(chunks, "zstd-decompress.worker"):
        errors.append("parser chunks do not reference the zstd worker entry asset")

    for snippet in [
        "Loading local zstd decoder",
        "memory-safe high sampling",
        "Decompressed demo is larger",
        "parse_demo_bytes_to_json",
        "Parser output stored",
        "[parser-worker] parse failed",
        "roundlab_parser_bg",
        ".wasm",
    ]:
        if not any_chunk_contains(chunks, snippet):
            errors.append(f"parser worker bundle is missing runtime signature {snippet!r}")


def assert_html_content(errors: list[str]) -> None:
    index = OUT / "index.html"
    match = OUT / "match" / "index.html"
    if index.exists():
        text = read(index)
        for snippet in [
            "RoundLab",
            "Open a CS2 demo",
            "data-testid=\"demo-file-input\"",
            "Glisse un fichier ou clique pour le sélectionner",
            "/logo.png",
        ]:
            if snippet not in text:
                errors.append(f"web/out/index.html is missing {snippet!r}")
    if match.exists():
        text = read(match)
        for snippet in [
            "RoundLab",
            "BAILOUT_TO_CLIENT_SIDE_RENDERING",
            "/_next/static/chunks/",
        ]:
            if snippet not in text:
                errors.append(f"web/out/match/index.html is missing {snippet!r}")


def assert_internal_refs_resolve(errors: list[str]) -> None:
    html_files = [path for path in OUT.rglob("*.html") if path.is_file()]
    for html in html_files:
        text = read(html)
        for ref in REF_RE.findall(text):
            parsed = urlparse(ref)
            if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
                continue
            target = OUT / parsed.path.lstrip("/")
            if not target.exists():
                # GitHub Pages project sites expose the export below /<repository>.
                # The prefix is a hosting concern and is not part of web/out.
                parts = Path(parsed.path.lstrip("/")).parts
                if len(parts) > 1:
                    prefixed_target = OUT.joinpath(*parts[1:])
                    if prefixed_target.exists():
                        target = prefixed_target
                elif (
                    len(parts) == 1
                    and parsed.path.endswith("/")
                    and parts[0]
                    == os.environ.get("GITHUB_REPOSITORY", "").rsplit("/", 1)[-1]
                ):
                    target = OUT
            if not target.exists():
                errors.append(f"{rel(html)} references missing static asset {ref}")


def assert_no_server_routes(errors: list[str]) -> None:
    forbidden_parts = {"api", "server", "middleware"}
    for path in OUT.rglob("*"):
        if not path.is_file():
            continue
        parts = set(path.relative_to(OUT).parts)
        if parts & forbidden_parts:
            errors.append(f"static export contains server-looking file {rel(path)}")


def assert_no_legacy_or_os_artifacts(errors: list[str]) -> None:
    for path in OUT.rglob("*"):
        if not path.is_file():
            continue
        parts = path.relative_to(OUT).parts
        if path.name == ".DS_Store":
            errors.append(f"static export contains macOS metadata file {rel(path)}")
        if parts and parts[0] == "radars":
            errors.append(f"static export contains legacy radar asset {rel(path)}; replay maps must use cs2lens-maps")


def main() -> None:
    errors: list[str] = []
    assert_required_output(errors)
    assert_parser_worker_bundle(errors)
    assert_html_content(errors)
    assert_internal_refs_resolve(errors)
    assert_no_server_routes(errors)
    assert_no_legacy_or_os_artifacts(errors)
    if errors:
        raise AssertionError("static export output audit failed: " + "; ".join(errors))
    print("static export output audit passed")


if __name__ == "__main__":
    main()
