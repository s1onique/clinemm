#!/bin/bash
# ACT-CLINEMM-SEATBELT-POSIX-SEM-ANSIBLE01
# Run the focused core macOS sandbox test suites from an UNSANDBOXED
# executor so that the live kernel tests (which spawn /usr/bin/sandbox-exec)
# are not invalidated by an enclosing ClineMM sandbox.
set -u
OUT="${1:?output file required}"
REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
NODE_BIN_DIR="/nix/store/a5sxfwnzi3kzxrgj3zfngcqamdhnr161-nodejs-24.18.0/bin"
export PATH="/Volumes/UserData/Users/chistyakov/.bun/bin:$NODE_BIN_DIR:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
VITEST="$REPO/node_modules/.bin/vitest"

cd "$REPO/sdk/packages/core" || exit 1
{
  echo "=== CORE MACOS SANDBOX SUITE (unsandboxed executor) ==="
  echo "DATE_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "NODE=$(node --version)"
  echo "BUN=$(bun --version)"
  echo "COMMAND=vitest run --config vitest.config.ts src/runtime/sandbox/macos/"
  echo
  "$VITEST" run --config vitest.config.ts src/runtime/sandbox/macos/ 2>&1
  echo "SUITE_EXIT=$?"
  echo "=== END_CORE_MACOS_SANDBOX_SUITE ==="
} >"$OUT" 2>&1
