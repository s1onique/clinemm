#!/bin/bash
# =============================================================================
# ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01
# Operator script — live qualification of the PERMANENT same-sandbox repair.
#
# Run this from an ORDINARY TERMINAL, NOT from inside the agent substrate.
# The agent substrate cannot launch a GUI (Electron SIGSEGV) and cannot nest
# `sandbox-exec` (rc=71), so the measurements below are impossible from
# there. See final-report.md §3.4.
#
# Usage:
#   bash .factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01/operator-script.sh
#
# The script is FAIL-CLOSED: every gate is checked and the script exits
# non-zero if any required result is missing.
# =============================================================================
set -u -o pipefail

REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
EVID="$REPO/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01"
RAW="$EVID/raw"
PROBE="$REPO/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01/probe-fixtures/same-sandbox-probe.mjs"
FOREIGN="$REPO/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02/probe-fixtures/foreign-signal-attempt.mjs"
VSC="/Volumes/UserData/Users/chistyakov/.vscodium-clinemm"
CODIUM="/Applications/VSCodium.app/Contents/Resources/app/bin/codium"
VSIX="$REPO/dist/clinemm-signal-repair01.vsix"
BUNDLE_SHA_EXPECTED="e35de822bec46b697fad7e651206d73124796b2179c2e6a25a083adced6a8a66"
NODE="/opt/homebrew/bin/node"

mkdir -p "$RAW"
FAILURES=0
note() { echo "[repair01] $*"; }
gate() { if [ "$1" = "0" ]; then note "PASS: $2"; else note "FAIL: $2"; FAILURES=$((FAILURES+1)); fi; }

note "=============================================================="
note "ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01"
note "live qualification of the permanent same-sandbox repair"
note "=============================================================="

# --- STEP 1: install the repaired VSIX -------------------------------------
note "STEP 1: install the repaired VSIX"
[ -f "$VSIX" ] || { note "ABORT: VSIX not found at $VSIX"; exit 2; }
"$CODIUM" --install-extension "$VSIX" --force \
  --user-data-dir "$VSC/user-data" --extensions-dir "$VSC/extensions"
gate $? "VSIX install"

INSTALLED=""
for d in "$VSC"/extensions/s1onique.clinemm-*/; do
  [ -f "$d/dist/extension.js" ] && INSTALLED="$d/dist/extension.js"
done
[ -n "$INSTALLED" ] || { note "ABORT: no installed clinemm bundle found"; exit 2; }
INSTALLED_SHA="$(shasum -a 256 "$INSTALLED" | awk '{print $1}')"
note "installed bundle: $INSTALLED"
note "installed sha256: $INSTALLED_SHA"
[ "$INSTALLED_SHA" = "$BUNDLE_SHA_EXPECTED" ]
gate $? "installed bundle sha256 == $BUNDLE_SHA_EXPECTED"

grep -q '(allow signal (target same-sandbox))' "$INSTALLED"
gate $? "installed bundle carries (allow signal (target same-sandbox))"
! grep -q '(allow signal (target self))' "$INSTALLED"
gate $? "installed bundle carries NO (allow signal (target self))"
! grep -q 'CLINEMM_DIAG_SAME_SANDBOX_SIGNAL' "$INSTALLED"
gate $? "installed bundle carries NO diagnostic env gate"

# --- STEP 2: FULLY quit the running dogfood instance -----------------------
note "STEP 2: fully quit VSCodium so no extension host survives"
osascript -e 'quit app "VSCodium"' >/dev/null 2>&1
for i in $(seq 1 30); do
  pgrep -f 'extensionHost|extension-host' >/dev/null 2>&1 || break
  sleep 1
done
pgrep -f 'extensionHost|extension-host' >/dev/null 2>&1
[ $? -ne 0 ]
gate $? "no extension-host process survives the quit"

# --- STEP 3: relaunch with the dogfood runtime profile ---------------------
note "STEP 3: relaunch VSCodium with CLINEMM_RUNTIME_PROFILE=dogfood"
nohup env CLINEMM_RUNTIME_PROFILE=dogfood \
  /Applications/VSCodium.app/Contents/MacOS/VSCodium \
  --user-data-dir "$VSC/user-data" \
  --extensions-dir "$VSC/extensions" \
  "$REPO" > "$RAW/vscodium-launch.log" 2>&1 &
sleep 25
pgrep -f 'extensionHost|extension-host' >/dev/null 2>&1
gate $? "an extension host is running"

EHOST="$(pgrep -f 'extensionHost|extension-host' | head -1)"
ps -Eww -p "$EHOST" 2>/dev/null | tr ' ' '\n' | grep -q 'CLINEMM_RUNTIME_PROFILE=dogfood'
gate $? "extension host carries CLINEMM_RUNTIME_PROFILE=dogfood"

# --- STEP 4: the GREEN child-directed SIGTERM ------------------------------
note "STEP 4: run the ONE production-seam fixture (child-directed SIGTERM)"
"$NODE" "$PROBE" > "$RAW/operator-green.stdout" 2>&1
grep -o 'SAME_SANDBOX_RESULT_JSON=.*' "$RAW/operator-green.stdout" \
  | sed 's/^SAME_SANDBOX_RESULT_JSON=//' > "$RAW/operator-green.result.json"
[ -s "$RAW/operator-green.result.json" ]
gate $? "the fixture produced an authoritative result"

"$NODE" -e '
const fs=require("fs");
const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const ok = r.signalAttempt && r.signalAttempt.ok===true
  && r.childReceivedSigterm===true
  && r.childExited===true
  && r.childStillAliveAfter===false
  && r.childAliveProbeErrno==="ESRCH";
console.log("GREEN_GATE:", ok ? "PASS" : "FAIL", JSON.stringify(r.signalAttempt));
process.exit(ok?0:1);
' "$RAW/operator-green.result.json"
gate $? "GREEN: child-directed SIGTERM delivered, child exited, no residual"

# --- STEP 5: profile identity ---------------------------------------------
note "STEP 5: profile identity"
PROF_AFTER="$(ls -td /private/var/folders/*/*/T/clinemm-sandbox-profile-* 2>/dev/null | head -1)"
{
  echo "PROFILE_DIR=$PROF_AFTER"
  for f in "$PROF_AFTER"/*.sb; do
    [ -f "$f" ] || continue
    echo "PROFILE=$(shasum -a 256 "$f" | awk '{print $1}')  $f"
    grep 'allow signal' "$f"
  done
} > "$RAW/operator-profile-identity.txt" 2>&1
cat "$RAW/operator-profile-identity.txt"
grep -q '(allow signal (target same-sandbox))' "$RAW/operator-profile-identity.txt"
gate $? "the observed profile carries (allow signal (target same-sandbox))"

# --- STEP 6: foreign-process denial under the REPAIRED profile -------------
note "STEP 6: foreign-process denial control under the repaired profile"
cat > /tmp/repair01-foreign-target.mjs <<'EOF'
import { appendFileSync } from "node:fs";
const log = process.argv[2];
appendFileSync(log, `FOREIGN_READY pid=${process.pid}\n`);
process.on("SIGTERM", () => { appendFileSync(log, `FOREIGN_GOT_SIGTERM pid=${process.pid}\n`); process.exit(0); });
setInterval(() => {}, 1000);
EOF
rm -f /tmp/repair01-foreign.log
"$NODE" /tmp/repair01-foreign-target.mjs /tmp/repair01-foreign.log &
FOREIGN_PID=$!
sleep 2
"$NODE" "$FOREIGN" "$FOREIGN_PID" /tmp/repair01-foreign.log \
  > "$RAW/operator-foreign.stdout" 2>&1
grep -o 'FOREIGN_SIGNAL_RESULT_JSON=.*' "$RAW/operator-foreign.stdout" \
  | sed 's/^FOREIGN_SIGNAL_RESULT_JSON=//' > "$RAW/operator-foreign.result.json"
cat "$RAW/operator-foreign.result.json"
"$NODE" -e '
const fs=require("fs");
const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const ok = r.signalAttempt && r.signalAttempt.ok===false
  && r.signalAttempt.errnoCode==="EPERM"
  && r.foreignAliveAfter===true
  && r.foreignReceivedSIGTERM===false;
console.log("FOREIGN_DENIAL_GATE:", ok ? "PASS" : "FAIL");
process.exit(ok?0:1);
' "$RAW/operator-foreign.result.json"
gate $? "foreign process was NOT signalled (EPERM, survived)"
kill -9 "$FOREIGN_PID" 2>/dev/null
rm -f /tmp/repair01-foreign.log /tmp/repair01-foreign-target.mjs

# --- STEP 7: Vitest fork-worker termination + residual processes -----------
note "STEP 7: Vitest fork-worker termination + residual-process counts"
BASELINE_PROCS="$(pgrep -f 'node' | wc -l | tr -d ' ')"
( cd "$REPO/sdk/packages/core" && "$NODE" \
    node_modules/.bin/vitest run --config vitest.config.ts \
    src/runtime/sandbox/macos/seatbelt-same-sandbox-signal-repair01.test.ts \
    > "$RAW/operator-vitest.stdout" 2>&1 )
VITEST_RC=$?
AFTER_PROCS="$(pgrep -f 'node' | wc -l | tr -d ' ')"
echo "vitest_rc=$VITEST_RC baseline_node_procs=$BASELINE_PROCS after_node_procs=$AFTER_PROCS" \
  > "$RAW/operator-vitest-summary.txt"
cat "$RAW/operator-vitest-summary.txt"
! grep -q 'Failed to terminate forks worker' "$RAW/operator-vitest.stdout"
gate $? "Vitest terminated its forks worker (no 'Failed to terminate forks worker')"
[ "$VITEST_RC" -eq 0 ]
gate $? "the Vitest run exited 0"
[ "$AFTER_PROCS" -le "$((BASELINE_PROCS + 2))" ]
gate $? "no residual node processes (after <= baseline + 2)"

# --- STEP 8: process-group cancellation -----------------------------------
note "STEP 8: process-group (kill -pgid) cancellation under the repaired profile"
cat > /tmp/repair01-pgid.mjs <<'EOF'
import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { detached: true, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 400));
let groupErrno = null;
try { process.kill(-child.pid, "SIGTERM"); } catch (e) { groupErrno = e.code; }
await new Promise((r) => setTimeout(r, 800));
let alive = true;
try { process.kill(-child.pid, 0); } catch { alive = false; }
console.log("PGID_RESULT_JSON=" + JSON.stringify({ pgid: child.pid, groupErrno, groupAliveAfter: alive }));
process.exit(0);
EOF
"$NODE" /tmp/repair01-pgid.mjs > "$RAW/operator-pgid.stdout" 2>&1
grep -o 'PGID_RESULT_JSON=.*' "$RAW/operator-pgid.stdout" | sed 's/^PGID_RESULT_JSON=//' \
  > "$RAW/operator-pgid.result.json"
cat "$RAW/operator-pgid.result.json"
"$NODE" -e '
const fs=require("fs");
const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const ok = r.groupErrno===null && r.groupAliveAfter===false;
console.log("PGID_GATE:", ok ? "PASS" : "FAIL");
process.exit(ok?0:1);
' "$RAW/operator-pgid.result.json"
gate $? "process-group cancellation succeeded (no EPERM, group gone)"
rm -f /tmp/repair01-pgid.mjs

# --- SUMMARY ---------------------------------------------------------------
note "=============================================================="
if [ "$FAILURES" -eq 0 ]; then
  note "ALL GATES PASSED — the permanent same-sandbox repair is qualified"
  note "at the real production seam."
else
  note "$FAILURES GATE(S) FAILED — see the per-step output above."
  note "Do NOT declare the repair fully qualified until they pass."
fi
note "=============================================================="
exit "$FAILURES"
