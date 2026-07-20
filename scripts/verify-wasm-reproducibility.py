#!/usr/bin/env python3
"""Build the browser parser twice from clean target state and compare outputs."""

from __future__ import annotations

import argparse
import hashlib
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PARSER = ROOT / "parser"
OUTPUT = ROOT / "desktop" / "src" / "wasm" / "roundlab_parser"
ARTIFACTS = (
    "roundlab_parser.d.ts",
    "roundlab_parser.js",
    "roundlab_parser_bg.wasm",
    "roundlab_parser_bg.wasm.d.ts",
)


def run(command: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True)


def hashes() -> dict[str, str]:
    result: dict[str, str] = {}
    for name in ARTIFACTS:
        path = OUTPUT / name
        if not path.is_file():
            raise FileNotFoundError(path)
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def build_once() -> dict[str, str]:
    run(["cargo", "clean", "--target", "wasm32-unknown-unknown", "--release"], PARSER)
    run(["cargo", "build", "--target", "wasm32-unknown-unknown", "--release", "--lib"], PARSER)
    run(
        [
            "wasm-bindgen",
            "target/wasm32-unknown-unknown/release/roundlab_parser.wasm",
            "--target",
            "web",
            "--out-dir",
            "../desktop/src/wasm/roundlab_parser",
            "--out-name",
            "roundlab_parser",
            "--remove-name-section",
            "--remove-producers-section",
        ],
        PARSER,
    )
    return hashes()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-git", action="store_true", help="also require the generated artifacts to match Git")
    args = parser.parse_args()

    version = subprocess.run(["wasm-bindgen", "--version"], text=True, capture_output=True, check=True).stdout.strip()
    if version != "wasm-bindgen 0.2.126":
        raise AssertionError(f"expected wasm-bindgen 0.2.126, got {version!r}")
    print(version)

    first = build_once()
    second = build_once()
    for name in ARTIFACTS:
        print(f"{name} {second[name]}")
    if first != second:
        raise AssertionError(f"WASM outputs differ between clean builds: first={first}, second={second}")
    print("two clean WASM builds produced byte-identical artifacts")

    if args.check_git:
        run(["git", "diff", "--exit-code", "--", str(OUTPUT.relative_to(ROOT))], ROOT)
        print("generated WASM artifacts match Git")


if __name__ == "__main__":
    main()
