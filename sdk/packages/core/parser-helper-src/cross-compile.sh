#!/usr/bin/env bash
#
# Cross-compile cline-parser-helper for the 5 shipped platforms from
# tracked source.
#
# ACT-CLINEMM-PARSER-HELPER-SOURCE-RECOVERY01 / Phase 1.D + 1.F.
#
# Permanent invariant (post Phase 4):
#
#   NO VENDORED PARSER BINARY WITHOUT TRACKED BUILDABLE SOURCE
#
# This script is the build surface that produces the 5 binaries the
# SDK runtime depends on. Without it, the parser-helper is a binary-
# only artifact with no provenance chain -- exactly the situation
# this ACT exists to close.
#
# Usage:
#   sdk/packages/core/parser-helper-src/cross-compile.sh                # default: build to ./dist/ (NOT the vendor layout)
#   sdk/packages/core/parser-helper-src/cross-compile.sh --install      # write to vendor layout
#   sdk/packages/core/parser-helper-src/cross-compile.sh --out=DIR      # write to DIR
#
# Default output (safe):
#   sdk/packages/core/parser-helper-src/dist/parser-helper/<platform>/cline-parser-helper[.exe]
#   sdk/packages/core/parser-helper-src/dist/parser-helper/SHA256SUMS.txt
#
# Production install output (--install):
#   sdk/packages/core/bin/parser-helper/<platform>/cline-parser-helper[.exe]
#   sdk/packages/core/bin/parser-helper/SHA256SUMS.txt
#
# Recorded alongside each build (logged at start):
#   - SOURCE_HEAD (the git commit SHA the build is run from)
#   - Go version
#   - mvdan.cc/sh/v3 version (pinned in go.mod)
#   - GOOS / GOARCH / CGO_ENABLED
#
# Scope guard (this ACT):
#   - Does NOT add shellStatic.
#   - Does NOT bump protocol version.
#   - Does NOT touch TS V2 echo authority.
#   - Does NOT overwrite vendored binaries unless --install is passed
#     explicitly (Phase 1 keeps the legacy binaries immutable as the
#     v2 oracle; Phase 4 is when we wire --install into CI).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE"
LEGACY_OUT_BASE="$HERE/../bin/parser-helper"
SAFE_OUT_BASE="$HERE/dist/parser-helper"

OUT_BASE="$SAFE_OUT_BASE"
INSTALL=0

for arg in "$@"; do
    case "$arg" in
        --install)
            OUT_BASE="$LEGACY_OUT_BASE"
            INSTALL=1
            ;;
        --out=*)
            OUT_BASE="${arg#--out=}"
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Usage: $0 [--install] [--out=DIR]" >&2
            exit 2
            ;;
    esac
done

cd "$SRC"

echo "=== cline-parser-helper cross-compile ==="
echo "SOURCE_HEAD : $(git -C "$HERE/../.." rev-parse HEAD 2>/dev/null || echo '<not in git repo>')"
echo "GO_VERSION  : $(go version | awk '{print $3}')"
echo "MVDAN_VERSION: $(grep 'mvdan.cc/sh/v3' go.mod | awk '{print $2}')"
# Note: every actual build below explicitly sets CGO_ENABLED=0 (no
# cgo dependencies in the helper). We record that here so the header
# is not misleading if the caller exports CGO_ENABLED=1 in their env.
echo "CGO_ENABLED : 0 (all builds below use CGO_ENABLED=0)"
echo "OUT_BASE    : $OUT_BASE"
if [ "$INSTALL" -eq 1 ]; then
    echo "INSTALL     : YES (will OVERWRITE vendored binaries at $LEGACY_OUT_BASE)"
else
    echo "INSTALL     : no  (safe build; outputs under $SAFE_OUT_BASE)"
fi
echo ""

declare -a TARGETS=(
    "darwin arm64  darwin-arm64"
    "darwin amd64  darwin-amd64"
    "linux  amd64  linux-amd64"
    "linux  arm64  linux-arm64"
    "windows amd64 win32-x64"
)

SHA_SUMS="$OUT_BASE/SHA256SUMS.txt"
mkdir -p "$OUT_BASE"
: > "$SHA_SUMS"

for entry in "${TARGETS[@]}"; do
    GOOS_=$(echo "$entry" | awk '{print $1}')
    GOARCH_=$(echo "$entry" | awk '{print $2}')
    PLAT_=$(echo "$entry" | awk '{print $3}')

    if [ "$GOOS_" = "windows" ]; then
        EXE="cline-parser-helper.exe"
    else
        EXE="cline-parser-helper"
    fi

    OUT_DIR="$OUT_BASE/$PLAT_"
    OUT_BIN="$OUT_DIR/$EXE"
    mkdir -p "$OUT_DIR"

    echo "--- $PLAT_ ($GOOS_/$GOARCH_) ---"
    echo "  GOOS=$GOOS_ GOARCH=$GOARCH_ CGO_ENABLED=0"
    GOOS="$GOOS_" GOARCH="$GOARCH_" CGO_ENABLED=0 \
        go build -trimpath -ldflags='-s -w' -o "$OUT_BIN" .

    SHA=$(shasum -a 256 "$OUT_BIN" | awk '{print $1}')
    SIZE=$(wc -c < "$OUT_BIN" | tr -d ' ')
    echo "  size: $SIZE"
    echo "  sha256: $SHA"
    echo "  path: $OUT_BIN"
    echo "$SHA  $PLAT_/$EXE" >> "$SHA_SUMS"
done

echo ""
echo "=== SHA256SUMS.txt regenerated ==="
cat "$SHA_SUMS"