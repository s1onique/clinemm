#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
#
# Baseline check for the pre-existing "profile temp dir is cleaned up
# after deadline" test, to establish whether its failure is caused by
# THIS ACT or is a pre-existing test-isolation defect.
#
# Runs the C3 real-kernel file alone (no other profile-creating test
# file in the same run) with the production profile change REVERTED.
#
# MUST run from an UNSANDBOXED executor.
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
VITEST="$REPO/node_modules/.bin/vitest"

cd "$REPO" || exit 1
{
  echo "=== BASELINE: production change reverted, C3 file alone ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  git stash push -- sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts
  echo "STASH_PUSH_EXIT=$?"
  cd "$REPO/apps/vscode" || exit 1
  "$VITEST" run --config vitest.config.ts \
    src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts 2>&1
  echo "BASELINE_EXIT=$?"
  cd "$REPO" || exit 1
  git stash pop
  echo "STASH_POP_EXIT=$?"
  echo "=== END_BASELINE ==="
} >"$OUT" 2>&1
