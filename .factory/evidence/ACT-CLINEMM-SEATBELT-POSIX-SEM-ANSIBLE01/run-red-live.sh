#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
#
# RED proof: revert ONLY the production profile change, run the live
# Darwin-kernel suite, and observe the semaphore failure. Then restore.
#
# MUST run from an UNSANDBOXED executor (the live kernel tests are
# skipped when a nested sandbox-exec is not possible).
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
NODE_BIN_DIR="/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:$NODE_BIN_DIR:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
VITEST="$REPO/node_modules/.bin/vitest"

cd "$REPO" || exit 1
{
  echo "=== RED PROOF: production profile change reverted ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "SUBJECT_HEAD=$(git rev-parse HEAD)"
  echo

  git stash push -- sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts
  echo "STASH_PUSH_EXIT=$?"
  echo "--- verify the production rule is absent from the working tree ---"
  grep -c 'ipc-posix-sem' sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts || echo "0 (rule absent, as expected for RED)"
  echo

  cd "$REPO/sdk/packages/core" || exit 1
  echo "COMMAND=vitest run --config vitest.config.ts src/runtime/sandbox/macos/"
  "$VITEST" run --config vitest.config.ts src/runtime/sandbox/macos/ 2>&1
  echo "RED_SUITE_EXIT=$?"
  echo

  cd "$REPO" || exit 1
  git stash pop
  echo "STASH_POP_EXIT=$?"
  echo "--- verify the production rule is restored ---"
  grep -c 'ipc-posix-sem' sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts
  echo "=== END_RED_PROOF ==="
} >"$OUT" 2>&1
