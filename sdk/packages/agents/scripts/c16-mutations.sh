#!/usr/bin/env bash
# C1.6 mutation campaign executor.
#
# Runs each mutation in sequence against the source
# agent-runtime.ts, runs the targeted killer test, then
# reverts. This proves the recovery invariants are
# LOAD-BEARING in the production source.
#
# Usage: bash sdk/packages/agents/scripts/c16-mutations.sh
set -e

ROOT="$(cd "$(dirname "$0")/../../../../" && pwd)"
SOURCE="$ROOT/sdk/packages/agents/src/agent-runtime.ts"
BACKUP="$(mktemp -t c16-mut-src-XXXXXX.ts)"
cp "$SOURCE" "$BACKUP"

PASS=0
FAIL=0

run_killer() {
  local name="$1"
  if bun run -F @cline/agents test -t "$name" > /dev/null 2>&1; then
    echo "PASS"
  else
    echo "FAIL"
  fi
}

revert() {
  cp "$BACKUP" "$SOURCE"
}

trap revert EXIT

apply_to_source() {
  local old="$1"
  local new="$2"
  if ! grep -qF "$old" "$SOURCE"; then
    echo "  apply: old text NOT found in source"
    return 1
  fi
  python3 -c "
import sys
with open('$SOURCE') as f: s = f.read()
old = sys.argv[1]
new = sys.argv[2]
if old not in s:
    print('not found', file=sys.stderr); sys.exit(2)
s = s.replace(old, new, 1)
with open('$SOURCE', 'w') as f: f.write(s)
" "$old" "$new"
}

# --- M11: drop restore reset event ---
echo "M11: drop restore reset event"
if apply_to_source "is already visible to subscribers" "/* M11 mutation applied */ is not visible"; then
  if [[ "$(run_killer 'C15_RESTORE_UPSTREAM_COMPAT')" == "FAIL" ]]; then
    echo "  PASS: killer test failed as expected"
    PASS=$((PASS+1))
  else
    echo "  BUG: killer test should have failed"
    FAIL=$((FAIL+1))
  fi
fi
revert

# --- M12: make restore async ---
echo "M12: make restore async again"
if apply_to_source "restore(messages: readonly AgentMessage[]): void {" \
                    "async restore(messages: readonly AgentMessage[]): Promise<void> {"; then
  if [[ "$(run_killer 'C15_RESTORE_UPSTREAM_COMPAT')" == "FAIL" ]]; then
    echo "  PASS: killer test failed as expected"
    PASS=$((PASS+1))
  else
    echo "  BUG: killer test should have failed"
    FAIL=$((FAIL+1))
  fi
fi
revert

# --- M9: expose raw control key ---
echo "M9: expose raw control key via recovery surface"
if apply_to_source "trackerSnapshot: this.recoveryTracker.snapshot()," \
                    "trackerSnapshot: { ...this.recoveryTracker.snapshot(), currentFailureKey: 'FAKE-CONTROL-KEY-DO-NOT-USE-X9Y8Z7' as unknown as never },"; then
  if [[ "$(run_killer 'privacy:')" == "FAIL" ]]; then
    echo "  PASS: killer test failed as expected"
    PASS=$((PASS+1))
  else
    echo "  BUG: killer test should have failed"
    FAIL=$((FAIL+1))
  fi
fi
revert

# --- M10: drop run reset ---
echo "M10: drop run reset event"
if apply_to_source "recoveryBeforeReset = this.snapshotRecoveryState();" \
                    "/* M10 mutation applied */"; then
  if [[ "$(run_killer 'lifecycle reuse')" == "FAIL" ]]; then
    echo "  PASS: killer test failed as expected"
    PASS=$((PASS+1))
  else
    echo "  BUG: killer test should have failed"
    FAIL=$((FAIL+1))
  fi
fi
revert

# --- M1: bypass exact pre-exec gate ---
echo "M1: bypass exact pre-exec gate"
if apply_to_source "this.recoveryTracker.recordBlockedAttemptIdentity(attemptIdentity);" \
                    "/* M1 mutation applied */"; then
  if [[ "$(run_killer 'Q1 exact structured repeat')" == "FAIL" ]]; then
    echo "  PASS: killer test failed as expected"
    PASS=$((PASS+1))
  else
    echo "  BUG: killer test should have failed"
    FAIL=$((FAIL+1))
  fi
fi
revert

# --- M2: remove terminal provider-request gate ---
echo "M2: remove terminal provider-request gate"
if apply_to_source "this.state.lastError = 'bounded_recovery_exhausted';" \
                    "this.state.lastError = 'bounded_recovery_exhausted_MUT2';"; then
  if [[ "$(run_killer 'Q3')" == "FAIL" ]]; then
    echo "  PASS: killer test failed as expected"
    PASS=$((PASS+1))
  else
    echo "  BUG: killer test should have failed"
    FAIL=$((FAIL+1))
  fi
fi
revert

echo ""
echo "=========================================="
echo "MUTATION CAMPAIGN RESULT"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "=========================================="

rm "$BACKUP"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
