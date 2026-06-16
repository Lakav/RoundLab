#!/usr/bin/env bash
#
# Build the Rust parser sidecar and copy it into binaries/ using the Rust
# target-triple suffix that Tauri's `externalBin` expects.
#
# Usage:
#   ./build-sidecar.sh              # builds for the host triple
#   TARGET=x86_64-apple-darwin ...  # cross-compile
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PARSER_DIR="$REPO_ROOT/parser"

if [[ -z "${TARGET:-}" ]]; then
    if ! command -v rustc >/dev/null 2>&1; then
        echo "error: rustc not found. Install Rust or set TARGET manually." >&2
        exit 1
    fi
    TARGET="$(rustc -Vv | awk '/^host:/ {print $2}')"
fi

case "$TARGET" in
    aarch64-apple-darwin)   SUFFIX="" ;;
    x86_64-apple-darwin)    SUFFIX="" ;;
    x86_64-unknown-linux-gnu) SUFFIX="" ;;
    aarch64-unknown-linux-gnu) SUFFIX="" ;;
    x86_64-pc-windows-msvc|x86_64-pc-windows-gnu) SUFFIX=".exe" ;;
    aarch64-pc-windows-msvc) SUFFIX=".exe" ;;
    *)
        echo "error: unsupported TARGET '$TARGET'" >&2
        exit 1
        ;;
esac

OUT="$SCRIPT_DIR/parser-${TARGET}${SUFFIX}"

echo "→ building Rust parser for TARGET=$TARGET → $OUT"

cd "$PARSER_DIR"
CARGO_NET_GIT_FETCH_WITH_CLI=true cargo build --release --target "$TARGET"
cp "$PARSER_DIR/target/$TARGET/release/roundlab-parser${SUFFIX}" "$OUT"
chmod +x "$OUT"
echo "✓ built $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
