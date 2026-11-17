#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
# Run the LIVE Darwin-kernel suites (including this ACT's new
# seatbelt-posix-sem01.live.test.ts) from an UNSANDBOXED executor.
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
NODE_BIN_DIR="/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:$NODE_BIN_DIR:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
VITEST="$REPO/node_modules/.bin/vitest"

cd "$REPO/sdk/packages/core" || exit 1
{
  echo "=== LIVE DARWIN KERNEL SUITE (unsandboxed executor) ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "NODE=$(node --version)"
  echo "COMMAND=vitest run --config vitest.config.ts src/runtime/sandbox/macos/"
  echo
  "$VITEST" run --config vitest.config.ts src/runtime/sandbox/macos/ 2>&1
  echo "SUITE_EXIT=$?"
  echo "=== END_LIVE_DARWIN_KERNEL_SUITE ==="
} >"$OUT" 2>&1
