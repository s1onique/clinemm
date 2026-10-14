#!/usr/bin/env bash
# Helper test runner with the bounded per-test timeout required
# by ACT-CLINEMM-TART-HELPER-REAL-LIFECYCLE-CORRECTION01 (RL-06
# takes ~8.7s with CLINEMM_TBR_SSH_TIMEOUT_MS=8000; the default
# bun:test 5s timeout is too tight).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
exec bun test --timeout=30000 "$@"
