#!/usr/bin/env bash
# Build the clinemm-host-helper C binary.
#
# ACT-CLINEMM-TART-P4.1-C1-GO-NATIVE-HELPER-ATOMIC-BUILD01:
# Atomic build: compile into a unique temp file on the destination
# filesystem, codesign-verify it, then atomically rename it to the
# destination. This prevents the in-place-overwrite hazard Apple
# warns about (macOS caches code-signature metadata per inode; an
# in-place write to the same inode can produce "Code Signature
# Invalid" kernel kills even when the new file verifies).
#
# Output: ./helper (relative to this script) by default.
# Run from anywhere; script resolves its own path.
#
# Build variant selection (mutually exclusive):
#   (default)                -> ./helper
#   CLINEMM_HELPER_BUILD_VARIANT=ablated
#                            -> ./helper.ablated (separate path; the
#                               canonical ./helper is NEVER replaced)
#
# ACT-CLINEMM-HOST-HELPER-OWNED-PGID-TERMINATION01 (review-correction01):
# The build_id is COMPUTED AT BUILD TIME and embedded as a -D macro
# string. This removes the runtime dependency on the helper.c source
# being readable at startup (the production binary lives at
# ~/.clinemm/bin/clinemm-host-helper, not in the repo tree). The
# embedding is the load-bearing invariant for atomic-replace A->B:
# every health() response carries the embedded build_id, never the
# abi:*.fallback sentinel.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SCRIPT_DIR/helper.c"

# Variant selection: a separate path for ablation, NEVER the canonical.
BUILD_VARIANT="${CLINEMM_HELPER_BUILD_VARIANT:-canonical}"
case "$BUILD_VARIANT" in
  canonical)
    OUT="$SCRIPT_DIR/helper"
    LD_IDENT="helper"
    ;;
  ablated)
    OUT="$SCRIPT_DIR/helper.ablated"
    LD_IDENT="helper.ablated"
    ;;
  *)
    echo "error: unknown CLINEMM_HELPER_BUILD_VARIANT='$BUILD_VARIANT' (expected: canonical|ablated)" >&2
    exit 1
    ;;
esac

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
ABI_VERSION="TART_TESTBED_RUN_P0_DOGFOOD01_CORRECTION01_REAL_LIFECYCLE_INTEGRITY"
if command -v shasum >/dev/null 2>&1; then
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
echo "[build] variant=$BUILD_VARIANT ident=$LD_IDENT"

# Atomic build: compile into a unique temp file in the SAME DIRECTORY
# as the destination (so the final mv is a same-filesystem rename, not
# a cross-fs copy). The temp file is NEVER named `helper` to avoid
# even briefly producing a destination-named artifact with a stale
# signature.
#
# Why two temp files (unsigned + signed): the linker's LC_IDENT
# load command is set to the basename of the -o path at link time.
# If we compile directly to a name like .helper.tmp.22068, the
# resulting Identifier will be ".helper.tmp.22068" — useless for
# the canonical path. We therefore:
#   1. Compile to .${OUT_BASE}.unsigned.tmp.PID.RAND (any basename
#      is fine; we will overwrite it).
#   2. Re-sign with `codesign -s - --identifier=<variant_ident>
#      --force` which rewrites LC_IDENT to the variant ident and
#      embeds a fresh ad-hoc signature.
#   3. codesign --verify --strict the re-signed file.
#   4. Atomic mv to the destination.
#   5. codesign --verify --strict the destination.
#
# This achieves two invariants simultaneously:
#   (a) The destination file is created by rename(2) with a fresh
#       inode, never by an in-place write to the previous inode
#       (Apple's in-place modification warning does not apply).
#   (b) The destination file's LC_IDENT matches the variant
#       ("helper" for canonical, "helper.ablated" for ablation),
#       so codesign -dvv on the destination is a stable witness
#       for the variant. An ablation build can never masquerade
#       as the canonical build because the Identifier strings
#       differ.
TMP_BASE=".${OUT##*/}.unsigned.tmp.$$.$RANDOM"
TMP_OUT="$SCRIPT_DIR/$TMP_BASE"

# -Wno-error=implicit-function-declaration + -Wno-implicit-function-declaration
# are removed (review-correction01). The helper source now uses proper
# forward declarations for every helper it calls.
#
# Note: the linker's LC_IDENT will be $TMP_BASE (some random
# basename). We will overwrite it in the codesign step below.
"$CC" -O2 -Wall -Wextra $SDK_INC \
  -DCLINEMM_HELPER_ABI_VERSION="\"$ABI_VERSION\"" \
  -DCLINEMM_HELPER_BUILD_ID="\"$BUILD_ID\"" \
  -o "$TMP_OUT" "$SRC"

# Re-sign with the variant identifier. `codesign -s -` uses an
# ad-hoc signature (matches the original linker-signed behavior);
# `--identifier` rewrites LC_IDENT; `--force` overwrites the
# existing signature (mandatory, the linker already signed).
SIGN_RC=0
codesign -s - --identifier="$LD_IDENT" --force "$TMP_OUT" 2>&1 || SIGN_RC=$?
if [[ $SIGN_RC -ne 0 ]]; then
  echo "[build] FAILED: codesign re-sign rc=$SIGN_RC for $TMP_OUT" >&2
  rm -f "$TMP_OUT"
  exit $SIGN_RC
fi

# Code-signature verification. codesign --verify --strict asserts
# the signature is present, well-formed, and matches the file
# contents. A non-zero rc here is a hard build failure — do not
# silently proceed to rename.
VERIFY_RC=0
codesign --verify --strict "$TMP_OUT" 2>&1 || VERIFY_RC=$?
if [[ $VERIFY_RC -ne 0 ]]; then
  echo "[build] FAILED: codesign --verify --strict rc=$VERIFY_RC for $TMP_OUT" >&2
  rm -f "$TMP_OUT"
  exit $VERIFY_RC
fi
echo "[build] codesign --verify --strict PASS for $TMP_OUT"

# Cross-fs safety: confirm both paths are on the same filesystem. If
# they are not, refuse to rename (would silently fall back to cp+unlink
# which is exactly the in-place hazard we are trying to avoid).
TMP_DIR="$(cd "$(dirname "$TMP_OUT")" && pwd -P)"
OUT_DIR="$(cd "$(dirname "$OUT")" && pwd -P)"
if [[ "$TMP_DIR" != "$OUT_DIR" ]]; then
  echo "[build] FAILED: temp $TMP_OUT and destination $OUT are on different filesystems" >&2
  rm -f "$TMP_OUT"
  exit 1
fi

# Atomic rename. mv(1) within a single filesystem is rename(2) which
# is atomic: the destination path either refers to the old inode or
# the new inode, never an in-between state. The kernel will not
# execute the old code-signature metadata against the new inode
# because the inode changed.
mv -f "$TMP_OUT" "$OUT"

# Final post-rename check: a fresh codesign-verify on the destination
# path. This is a defense-in-depth check — the verifier above proved
# the temp file, and rename() doesn't change file content, but we
# run this so a corruption between rename and verify would be loud.
codesign --verify --strict "$OUT" 2>&1 || {
  RC=$?
  echo "[build] FAILED: post-rename codesign --verify --strict rc=$RC for $OUT" >&2
  exit $RC
}
echo "[build] post-rename codesign --verify --strict PASS for $OUT"

# Print the embedded build_id and final inode so the caller (test
# harness or operator) can record the artifact identity.
FINAL_INODE="$(stat -f '%i' "$OUT" 2>/dev/null || echo '?')"
echo "[build] compiled $OUT inode=$FINAL_INODE build_id=$BUILD_ID ident=$LD_IDENT"
