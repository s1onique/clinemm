#!/usr/bin/env bash
# Build the clinemm-host-helper C binary.
#
# Output: ./helper (relative to this script)
# Run from anywhere; script resolves its own path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/helper.c"
OUT="$SCRIPT_DIR/helper"

if ! command -v cc >/dev/null 2>&1 && ! command -v clang >/dev/null 2>&1; then
  echo "error: cc or clang required (Xcode Command Line Tools)" >&2
  exit 1
fi

CC="${CC:-$(command -v cc || command -v clang)}"

# Compile. We require the SDK's <launch.h> for launch_activate_socket().
# If not on the default include path, fall back to SDK include dir.
SDK_INC=""
if ! echo '#include <launch.h>' | "$CC" -E - >/dev/null 2>&1; then
  SDK_PATH="$(xcrun --show-sdk-path --sdk macosx 2>/dev/null || true)"
  if [[ -n "$SDK_PATH" && -f "$SDK_PATH/usr/include/launch.h" ]]; then
    SDK_INC="-I$SDK_PATH/usr/include"
    echo "[build] using SDK include: $SDK_PATH/usr/include"
  else
    echo "error: <launch.h> not found; install Xcode Command Line Tools" >&2
    exit 1
  fi
fi

"$CC" -O2 -Wall -Wextra $SDK_INC -o "$OUT" "$SRC"
echo "[build] compiled $OUT"
