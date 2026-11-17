#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
#
# Baseline comparison for the apps/vscode focused suites:
# run them with the production profile change REVERTED (to separate
# pre-existing failures from ACT-introduced ones), then restore.
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
NODE_BIN_DIR="/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:$NODE_BIN_DIR:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
VITEST="$REPO/node_modules/.bin/vitest"

cd "$REPO" || exit 1
{
  echo "=== BASELINE: production profile change reverted ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  git stash push -- sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts
  echo "STASH_PUSH_EXIT=$?"
  echo
  cd "$REPO/apps/vscode" || exit 1
  echo "COMMAND=vitest run --config vitest.config.ts src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts"
  "$VITEST" run --config vitest.config.ts \
    src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts 2>&1
  echo "BASELINE_SUITE_EXIT=$?"
  echo
  cd "$REPO" || exit 1
  git stash pop
  echo "STASH_POP_EXIT=$?"
  echo "=== END_BASELINE ==="
} >"$OUT" 2>&1
