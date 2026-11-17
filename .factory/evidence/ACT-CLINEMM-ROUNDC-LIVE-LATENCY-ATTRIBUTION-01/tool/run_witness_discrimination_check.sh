#!/usr/bin/env bash
# CORRECTION01 — prove the failing-control witness has DISCRIMINATING POWER.
#
# The witness must FAIL against the PRE-CORRECTION code (which has no verdict
# derivation and marks C6/C7/C8 PASS unconditionally) and PASS against the
# CORRECTED code. Without this, a witness that always passes would be
# indistinguishable from a correct one.
#
# Read-only: it checks out the pre-correction blob from git history into a
# temp dir and runs the witness there. It writes nothing to the repository.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EV="$(dirname "$HERE")"
REPO="$(cd "$EV/../../.." && pwd)"
BASE_COMMIT="${1:-ab5ee16ecd11ce4ae08e39f7d8a1870bdaec11b0}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== 1. witness against the CORRECTED code (must PASS, exit 0) =="
if python3 "$HERE/test_failing_control_witness.py" > "$TMP/corrected.log" 2>&1; then
  echo "   PASS (exit 0)"
else
  echo "   FAIL (exit $?)"
  tail -20 "$TMP/corrected.log"
  exit 1
fi
tail -3 "$TMP/corrected.log"

echo
echo "== 2. witness against the PRE-CORRECTION code at $BASE_COMMIT (must FAIL) =="
mkdir -p "$TMP/pre/tool" "$TMP/pre/analysis"
for f in attribute_latency.py emit_evidence.py; do
  git -C "$REPO" show "$BASE_COMMIT:.factory/evidence/ACT-CLINEMM-ROUNDC-LIVE-LATENCY-ATTRIBUTION-01/tool/$f" \
    > "$TMP/pre/tool/$f" || { echo "   could not read $f from $BASE_COMMIT"; exit 1; }
done
cp "$HERE/test_failing_control_witness.py" "$TMP/pre/tool/"
cp "$EV/analysis/attribution.json" "$TMP/pre/analysis/"

if python3 "$TMP/pre/tool/test_failing_control_witness.py" > "$TMP/pre.log" 2>&1; then
  echo "   FAIL — the witness PASSED against the defective code (no discriminating power)"
  cat "$TMP/pre.log"
  exit 1
else
  echo "   PASS (exit $?) — the witness FAILS against the defective code"
  grep -E 'AttributeError|FAIL ' "$TMP/pre.log" | head -3
fi

echo
echo "== 3. structural check: pre-correction generator hardcodes the verdict =="
if grep -q '"verdict": "NOT_REPRODUCED"' "$TMP/pre/tool/emit_evidence.py"; then
  echo "   CONFIRMED: pre-correction generator hardcodes the verdict"
else
  echo "   UNEXPECTED: pre-correction generator does not hardcode the verdict"
  exit 1
fi
if grep -qE 'add\("C[678]", .*$' "$TMP/pre/tool/emit_evidence.py" && \
   python3 - "$TMP/pre/tool/emit_evidence.py" <<'PYEOF'
import re, sys
src = open(sys.argv[1]).read()
uncond = []
for cid in ("C6", "C7", "C8"):
    # Split the add("C<n>", <requirement>, <passed>, <evidence>) argument list
    # at TOP-LEVEL commas only (the requirement text may contain commas and
    # parentheses, and the evidence mapping is a nested literal).
    start = src.find('add("%s"' % cid)
    if start < 0:
        continue
    depth = 0
    args = []
    current = ""
    for ch in src[start + len("add("):]:
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                args.append(current)
                break
            depth -= 1
        if ch == "," and depth == 0:
            args.append(current)
            current = ""
            continue
        current += ch
    # args[0]=control id, args[1]=requirement, args[2]=the PASS/FAIL flag
    if len(args) >= 3 and args[2].strip() == "True":
        uncond.append(cid)
print("   pre-correction unconditionally-PASS controls:", uncond)
raise SystemExit(0 if uncond == ["C6", "C7", "C8"] else 1)
PYEOF
then
  echo "   CONFIRMED: C6, C7 and C8 were all marked PASS unconditionally"
else
  echo "   UNEXPECTED: could not confirm the unconditional-PASS defect"
  exit 1
fi

echo
echo "WITNESS DISCRIMINATION CHECK: PASS"
