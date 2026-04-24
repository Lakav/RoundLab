#!/usr/bin/env bash
#
# Build the Go parser and copy it into binaries/ using the Rust target-triple
# suffix that Tauri's `externalBin` expects.
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
    aarch64-apple-darwin)   GOOS=darwin GOARCH=arm64 ; SUFFIX="" ;;
    x86_64-apple-darwin)    GOOS=darwin GOARCH=amd64 ; SUFFIX="" ;;
    x86_64-unknown-linux-gnu) GOOS=linux  GOARCH=amd64 ; SUFFIX="" ;;
    aarch64-unknown-linux-gnu) GOOS=linux  GOARCH=arm64 ; SUFFIX="" ;;
    x86_64-pc-windows-msvc|x86_64-pc-windows-gnu) GOOS=windows GOARCH=amd64 ; SUFFIX=".exe" ;;
    aarch64-pc-windows-msvc) GOOS=windows GOARCH=arm64 ; SUFFIX=".exe" ;;
    *)
        echo "error: unsupported TARGET '$TARGET'" >&2
        exit 1
        ;;
esac

OUT="$SCRIPT_DIR/parser-${TARGET}${SUFFIX}"

echo "→ building parser for GOOS=$GOOS GOARCH=$GOARCH → $OUT"

cd "$PARSER_DIR"
# Match the Dockerfile flags so output size stays small.
env GOTOOLCHAIN=local GOOS="$GOOS" GOARCH="$GOARCH" CGO_ENABLED=0 \
    go build -trimpath -ldflags="-s -w" -o "$OUT" .

chmod +x "$OUT"
echo "✓ built $(basename "$OUT") ($(du -h "$OUT" | cut -f1))"
