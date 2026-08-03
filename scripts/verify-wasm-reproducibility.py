#!/usr/bin/env python3
"""Build the browser parser twice from clean target state and compare outputs."""

from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PARSER = ROOT / "parser"
OUTPUT = ROOT / "web" / "src" / "wasm" / "roundlab_parser"
ARTIFACTS = (
    "roundlab_parser.d.ts",
    "roundlab_parser.js",
    "roundlab_parser_bg.wasm",
    "roundlab_parser_bg.wasm.d.ts",
)


def run(command: list[str], cwd: Path) -> None:
    print(f"$ {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True)


def hashes(output: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for name in ARTIFACTS:
        path = output / name
        if not path.is_file():
            raise FileNotFoundError(path)
        result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def build_once(output: Path) -> dict[str, str]:
    run(["cargo", "clean", "--target", "wasm32-unknown-unknown", "--release"], PARSER)
    run(["cargo", "build", "--target", "wasm32-unknown-unknown", "--release", "--lib"], PARSER)
    run(
        [
            "wasm-bindgen",
            "target/wasm32-unknown-unknown/release/roundlab_parser.wasm",
            "--target",
            "web",
            "--out-dir",
            str(output),
            "--out-name",
            "roundlab_parser",
            "--remove-name-section",
            "--remove-producers-section",
        ],
        PARSER,
    )
    return hashes(output)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-git", action="store_true", help="also require the generated artifacts to match Git")
    parser.add_argument(
        "--artifact-dir",
        type=Path,
        help="copy the deterministic generated artifacts to this directory",
    )
    args = parser.parse_args()

    version = subprocess.run(["wasm-bindgen", "--version"], text=True, capture_output=True, check=True).stdout.strip()
    if version != "wasm-bindgen 0.2.126":
        raise AssertionError(f"expected wasm-bindgen 0.2.126, got {version!r}")
    print(version)

    with tempfile.TemporaryDirectory(prefix="roundlab-wasm-repro-") as temporary:
        temporary_root = Path(temporary)
        first_output = temporary_root / "first"
        second_output = temporary_root / "second"
        first_output.mkdir()
        second_output.mkdir()
        first = build_once(first_output)
        second = build_once(second_output)
        for name in ARTIFACTS:
            print(f"{name} {second[name]}")
        if first != second:
            raise AssertionError(f"WASM outputs differ between clean builds: first={first}, second={second}")
        print("two clean WASM builds produced byte-identical artifacts")

        if args.artifact_dir is not None:
            artifact_dir = args.artifact_dir.resolve()
            artifact_dir.mkdir(parents=True, exist_ok=True)
            for name in ARTIFACTS:
                shutil.copy2(second_output / name, artifact_dir / name)
            print(f"generated WASM artifacts copied to {artifact_dir}")

        if args.check_git:
            mismatches = [name for name in ARTIFACTS if (second_output / name).read_bytes() != (OUTPUT / name).read_bytes()]
            if mismatches:
                raise AssertionError(f"generated WASM artifacts differ from Git: {', '.join(mismatches)}")
            print("generated WASM artifacts match Git")


if __name__ == "__main__":
    main()
