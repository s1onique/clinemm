#!/usr/bin/env bash
# Build the clinemm-host-helper C binary.
#
# Output: ./helper (relative to this script)
# Run from anywhere; script resolves its own path.
#
# ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction01):
# The build_id is now COMPUTED AT BUILD TIME and embedded as a -D macro
# string. This removes the runtime dependency on the helper.c source
# being readable at startup (the production binary lives at
# ~/.clinemm/bin/clinemm-host-helper, not in the repo tree). The
# embedding is the load-bearing invariant for atomic-replace A->B:
# every health() response carries the embedded build_id, never the
# abi:*.fallback sentinel.
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

# Compute the build_id at build time:
#   sha256(CLINEMM_HELPER_ABI_VERSION || helper.c bytes) -> 64 lowercase hex
# This is the same algorithm that was previously in
# hex_sha256_of_self_source(); we just move it to build time so the
# production binary doesn't need to read its own source at startup.
ABI_VERSION="OWNED_PGID_TERMINATION_01"
if command -v shasum >/dev/null 2>&1; then
  # macOS ships shasum; prefer -a 256 explicitly.
  BUILD_ID="$(printf '%s' "$ABI_VERSION" | cat - "$SRC" | shasum -a 256 | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  BUILD_ID="$(printf '%s' "$ABI_VERSION" | cat - "$SRC" | sha256sum | awk '{print $1}')"
else
  echo "error: shasum or sha256sum required" >&2
  exit 1
fi
if [[ ! "$BUILD_ID" =~ ^[0-9a-f]{64}$ ]]; then
  echo "error: computed build_id is not 64 lowercase hex: $BUILD_ID" >&2
  exit 1
fi
echo "[build] embedded build_id=$BUILD_ID"

# -Wno-error=implicit-function-declaration + -Wno-implicit-function-declaration
# are removed (review-correction01). The helper source now uses proper
# forward declarations for every helper it calls.
"$CC" -O2 -Wall -Wextra $SDK_INC \
  -DCLINEMM_HELPER_ABI_VERSION="\"$ABI_VERSION\"" \
  -DCLINEMM_HELPER_BUILD_ID="\"$BUILD_ID\"" \
  -o "$OUT" "$SRC"
echo "[build] compiled $OUT"
