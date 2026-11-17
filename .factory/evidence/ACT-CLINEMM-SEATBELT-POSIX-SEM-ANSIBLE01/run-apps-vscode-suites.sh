#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
# Run the apps/vscode focused sandbox suites from an UNSANDBOXED executor
# (the real-kernel tests need /usr/bin/sandbox-exec to work).
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
NODE_BIN_DIR="/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:$NODE_BIN_DIR:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
VITEST="$REPO/node_modules/.bin/vitest"

cd "$REPO/apps/vscode" || exit 1
{
  echo "=== APPS/VSCODE FOCUSED SANDBOX SUITES (unsandboxed executor) ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "NODE=$(node --version)"
  echo "COMMAND=vitest run --config vitest.config.ts src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts src/sdk/command-job-manager.sandbox-integration.test.ts src/sdk/sandbox-policy-production-composition.test.ts"
  echo
  "$VITEST" run --config vitest.config.ts \
    src/sdk/command-job-manager.sandbox-c3-real-kernel.test.ts \
    src/sdk/command-job-manager.sandbox-integration.test.ts \
    src/sdk/sandbox-policy-production-composition.test.ts 2>&1
  echo "SUITE_EXIT=$?"
  echo "=== END_APPS_VSCODE_FOCUSED_SUITES ==="
} >"$OUT" 2>&1
