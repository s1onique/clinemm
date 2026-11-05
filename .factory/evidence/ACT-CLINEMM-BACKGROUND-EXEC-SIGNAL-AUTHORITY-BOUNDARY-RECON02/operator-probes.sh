#!/bin/bash
# =============================================================================
# ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02
# Operator probe harness — run ONLY from an independent, unsandboxed macOS
# Terminal (NOT from VSCodium, NOT from ClineMM Background Exec).
#
# Purpose: obtain the four real-kernel measurements A / B / C / D that
# RECON01 could not produce because every agent-executed command was itself
# already sandboxed.
#
# Safety contract enforced by this script:
#   * every process it creates is identified by PID and recorded
#   * every process has an INDEPENDENT lifetime bound (fixtures self-exit)
#   * every probe is followed by a cleanup verification
#   * NO broad pkill / killall / process-group sweep is ever used
#   * the script NEVER signals a PID it did not create and verify
#   * it aborts on the first gate failure
#
# Usage:
#   bash operator-probes.sh
#
# Exit status:
#   0 = all four probes executed and recorded (inspect the JSON for verdicts)
#   2 = preflight / safety failure (HALT_*)
#   3 = probe execution failure (see probe-*.json)
# =============================================================================
set -u

REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
EV="$REPO/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02"
EV1="$REPO/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01"
FIX="$EV/probe-fixtures"
TMP="/private/tmp/clinemm-recon01-tmp"
WS="/private/tmp/clinemm-recon01-ws"
OUT="$EV/raw"

CUR_SHA_EXPECTED="80b0caf181cd5d3ead4e0eb606e0e638f9b4f1d77aa34452a88d60ab0d1acb30"
CAND_SHA_EXPECTED="5a718c4c6228596fe7ca2affde833386327f393f98f8c61cbc0f728dc6bba276"

mkdir -p "$OUT"

say() { printf '\n=== %s ===\n' "$*"; }

run_probe() {
	local id="$1"; shift
	local outf="$1"; shift
	local errf="$1"; shift
	local start end rc
	start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	"$@" > "$outf" 2> "$errf"
	rc=$?
	end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	echo "$start" > "${outf%.out}.started_at"
	echo "$end"   > "${outf%.out}.finished_at"
	echo "$rc"     > "${outf%.out}.exit_code"
	echo "[$id] exit=$rc"
	return 0
}

extract_probe_json() {
	grep -m1 '^PROBE_RESULT_JSON=' "$1" 2>/dev/null | sed 's/^PROBE_RESULT_JSON=//'
}

residual_for() {
	ps -Ao pid,ppid,pgid,command 2>/dev/null \
		| grep -F "$1" | grep -v grep | grep -v "grep -F" || true
}

json_bool() { printf '%s' "$1" | grep -o "\"$2\":\(true\|false\)" | head -1 | cut -d: -f2; }
json_str()  { printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
json_num()  { printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | head -1 | cut -d: -f2; }

# ---------------------------------------------------------------- PREFLIGHT --
say "PREFLIGHT"

NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
	echo "HALT_UNSAFE_FIXTURE: node not resolvable in this Terminal"
	exit 2
fi
echo "NODE=$NODE"
"$NODE" --version

if [ ! -r "$EV1/current-production-profile.sb" ] || [ ! -r "$EV1/candidate-profile-same-sandbox.sb" ]; then
	echo "HALT_UNSAFE_FIXTURE: profiles not readable"
	exit 2
fi

mkdir -p "$TMP" "$WS"
chmod 700 "$TMP" "$WS"
echo "TMPDIR=$TMP"
ls -lad "$TMP" "$WS"

CAND_SHA_ACTUAL="$(shasum -a 256 "$EV1/candidate-profile-same-sandbox.sb" | awk '{print $1}')"
CUR_SHA_ACTUAL="$(shasum -a 256 "$EV1/current-production-profile.sb" | awk '{print $1}')"
echo "CURRENT_PROFILE_SHA256=$CUR_SHA_ACTUAL"
echo "CANDIDATE_PROFILE_SHA256=$CAND_SHA_ACTUAL"
if [ "$CAND_SHA_ACTUAL" != "$CAND_SHA_EXPECTED" ]; then
	echo "HALT_UNSAFE_FIXTURE: candidate profile hash drift"
	exit 2
fi

DIFF_OUT="$(diff -u "$EV1/current-production-profile.sb" "$EV1/candidate-profile-same-sandbox.sb" 2>&1)"
printf '%s\n' "$DIFF_OUT" | tee "$OUT/profile-diff.txt"
DIFF_LINES="$(printf '%s\n' "$DIFF_OUT" | grep -E '^[+-][^+-]' | sed 's/^[+-]//' | sort -u)"
EXPECTED_LINES="$(printf '%s\n' '(allow signal (target self))' '(allow signal (target same-sandbox))' | sort -u)"
if [ "$DIFF_LINES" != "$EXPECTED_LINES" ]; then
	echo "HALT_UNSAFE_FIXTURE: profile diff is not signal-only"
	printf 'observed:\n%s\nexpected:\n%s\n' "$DIFF_LINES" "$EXPECTED_LINES"
	exit 2
fi
echo "DIFF_ONLY_SIGNAL=true"

if /usr/bin/sandbox-exec -p "(version 1)(allow default)" /usr/bin/true 2>/dev/null; then
	echo "SANDBOX_EXEC_AVAILABLE=true"
else
	echo "HALT_UNSAFE_FIXTURE: sandbox-exec cannot apply in this context (nested sandbox)"
	exit 2
fi

{
	echo "CONTEXT_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	echo "HOST_OS_VERSION=$(sw_vers -productVersion) ($(sw_vers -buildVersion))"
	echo "HOST_ARCH=$(uname -m)"
	echo "NODE_VERSION=$("$NODE" --version)"
	echo "NODE_PATH=$NODE"
	echo "HARNESS_PID=$$"
	echo "HARNESS_PPID=$PPID"
	echo "HARNESS_PWD=$PWD"
	echo "TERMINAL_TMPDIR_BEFORE=${TMPDIR:-<unset>}"
	echo "TERM_PROGRAM=${TERM_PROGRAM:-<unset>}"
} | tee "$OUT/execution-context.txt"

ps -Ao pid,ppid,pgid,user,lstart,command 2>/dev/null \
	| grep -E 'CLINEMM_RECON0[12]|clinemm-recon0[12]|vitest' | grep -v grep \
	> "$OUT/pre-orphans-snapshot.txt" || true
echo "PRE_EXISTING_ORPHAN_SNAPSHOT_LINES=$(wc -l < "$OUT/pre-orphans-snapshot.txt" | tr -d ' ')"

# ------------------------------------------------------------------ PROBE A --
say "PROBE A (independent Terminal, no Seatbelt)"
run_probe A "$OUT/probe-a.stdout" "$OUT/probe-a.stderr" \
	env TMPDIR="$TMP" "$NODE" "$EV1/probe-fixtures/probe.mjs"

A_JSON="$(extract_probe_json "$OUT/probe-a.stdout")"
echo "$A_JSON" > "$OUT/probe-a.result.json"
if [ -z "$A_JSON" ]; then
	echo "HALT_BASELINE_INVALID: probe A produced no PROBE_RESULT_JSON"
	cat "$OUT/probe-a.stderr"
	exit 2
fi
echo "$A_JSON"

A_ERR="$(json_str "$A_JSON" signalErrno)"
A_OK="$(json_bool "$A_JSON" ok)"
A_READY="$(json_bool "$A_JSON" childReady)"
A_ALIVE_AFTER="$(json_bool "$A_JSON" childStillAliveAfter)"
A_CHILD_PID="$(json_num "$A_JSON" childPid)"
A_GOT_TERM="$(grep -c 'CHILD_GOT_SIGTERM' <<< "$A_JSON" || true)"

if [ "$A_READY" != "true" ]; then
	echo "HALT_BASELINE_INVALID: child never became ready in probe A"
	exit 2
fi
if [ "$A_OK" != "true" ]; then
	echo "HALT_BASELINE_INVALID: probe A signal attempt failed (errno=$A_ERR)"
	exit 2
fi
if [ "$A_GOT_TERM" -eq 0 ]; then
	echo "HALT_BASELINE_INVALID: probe A child never observed SIGTERM"
	exit 2
fi
if [ "$A_ALIVE_AFTER" != "false" ]; then
	echo "HALT_BASELINE_INVALID: probe A child residual after exit"
	exit 2
fi

sleep 0.5
A_RESIDUAL="$(residual_for 'CLINEMM_RECON01_SIGNAL_PROBE')"
echo "A_RESIDUAL=[$A_RESIDUAL]"
if [ -n "$A_RESIDUAL" ]; then
	echo "HALT_UNSAFE_FIXTURE: probe A left a residual controlled process"
	exit 2
fi
echo "A_CLEANUP_VERIFIED=true"

# ------------------------------------------------------------------ PROBE B --
say "PROBE B (independent Terminal, current production profile)"
run_probe B "$OUT/probe-b.stdout" "$OUT/probe-b.stderr" \
	env TMPDIR="$TMP" /usr/bin/sandbox-exec \
	-f "$EV1/current-production-profile.sb" \
	"$NODE" "$EV1/probe-fixtures/probe.mjs"

B_RAW="$(cat "$OUT/probe-b.stdout" "$OUT/probe-b.stderr")"
B_JSON="$(extract_probe_json "$OUT/probe-b.stdout")"
echo "$B_JSON" > "$OUT/probe-b.result.json"
if [ -z "$B_JSON" ]; then
	if grep -q 'sandbox_apply' <<< "$B_RAW"; then
		echo "SUBSTRATE_FAILURE: sandbox_apply failed (NOT an EPERM reproduction)"
	else
		echo "PROBE B produced no PROBE_RESULT_JSON"
	fi
	printf '%s\n' "$B_RAW"
	exit 3
fi
echo "$B_JSON"

B_ERR="$(json_str "$B_JSON" signalErrno)"
B_OK="$(json_bool "$B_JSON" ok)"
B_READY="$(json_bool "$B_JSON" childReady)"
B_ALIVE_AFTER="$(json_bool "$B_JSON" childStillAliveAfter)"
B_GOT_TERM="$(grep -c 'CHILD_GOT_SIGTERM' <<< "$B_JSON" || true)"
B_SELF_EXIT="$(grep -c 'CHILD_SELF_EXIT' <<< "$B_JSON" || true)"

if [ "$B_READY" != "true" ]; then
	echo "PROBE B: child never became ready — invalid signal measurement"
	exit 3
fi

sleep 0.5
B_RESIDUAL="$(residual_for 'CLINEMM_RECON01_SIGNAL_PROBE')"
echo "B_RESIDUAL=[$B_RESIDUAL]"
if [ -n "$B_RESIDUAL" ]; then
	echo "HALT_UNSAFE_FIXTURE: probe B left a residual controlled process"
	exit 2
fi
echo "B_CLEANUP_VERIFIED=true"

# ------------------------------------------------------------------ PROBE C --
say "PROBE C (independent Terminal, candidate same-sandbox profile)"
run_probe C "$OUT/probe-c.stdout" "$OUT/probe-c.stderr" \
	env TMPDIR="$TMP" /usr/bin/sandbox-exec \
	-f "$EV1/candidate-profile-same-sandbox.sb" \
	"$NODE" "$EV1/probe-fixtures/probe.mjs"

C_RAW="$(cat "$OUT/probe-c.stdout" "$OUT/probe-c.stderr")"
C_JSON="$(extract_probe_json "$OUT/probe-c.stdout")"
echo "$C_JSON" > "$OUT/probe-c.result.json"
if [ -z "$C_JSON" ]; then
	if grep -q 'sandbox_apply' <<< "$C_RAW"; then
		echo "SUBSTRATE_FAILURE: candidate profile REJECTED by the kernel (sandbox_apply failed)"
	else
		echo "PROBE C produced no PROBE_RESULT_JSON"
	fi
	printf '%s\n' "$C_RAW"
	exit 3
fi
echo "$C_JSON"

C_ERR="$(json_str "$C_JSON" signalErrno)"
C_OK="$(json_bool "$C_JSON" ok)"
C_READY="$(json_bool "$C_JSON" childReady)"
C_ALIVE_AFTER="$(json_bool "$C_JSON" childStillAliveAfter)"
C_GOT_TERM="$(grep -c 'CHILD_GOT_SIGTERM' <<< "$C_JSON" || true)"

if [ "$C_READY" != "true" ]; then
	echo "PROBE C: child never became ready — invalid signal measurement"
	exit 3
fi
if [ "$C_ALIVE_AFTER" != "false" ]; then
	echo "PROBE C: child residual after exit"
	exit 3
fi

sleep 0.5
C_RESIDUAL="$(residual_for 'CLINEMM_RECON01_SIGNAL_PROBE')"
echo "C_RESIDUAL=[$C_RESIDUAL]"
if [ -n "$C_RESIDUAL" ]; then
	echo "HALT_UNSAFE_FIXTURE: probe C left a residual controlled process"
	exit 2
fi
echo "C_CLEANUP_VERIFIED=true"

# ------------------------------------------------------------------ PROBE D --
say "PROBE D (foreign-process negative control under candidate profile)"

FOREIGN_LOG="$TMP/recon02-foreign.log"
: > "$FOREIGN_LOG"

# The foreign fixture starts OUTSIDE any tested Seatbelt instance and
# self-exits after 9 s. It is a child of THIS harness shell.
env TMPDIR="$TMP" "$NODE" "$EV1/probe-fixtures/foreign.mjs" \
	> "$FOREIGN_LOG" 2>&1 &
FOREIGN_PID=$!
echo "FOREIGN_PID=$FOREIGN_PID"

# Independent watchdog: it only OBSERVES and never signals the foreign
# process. The fixture's own 9 s self-exit is the lifetime bound.
(
	sleep 30
	echo "WATCHDOG_ELAPSED foreign=$FOREIGN_PID" >> "$OUT/probe-d.watchdog.txt"
) &
WATCHDOG_PID=$!

READY=0
for _ in $(seq 1 60); do
	if grep -q 'FOREIGN_READY' "$FOREIGN_LOG" 2>/dev/null; then READY=1; break; fi
	sleep 0.1
done
if [ "$READY" -ne 1 ]; then
	echo "PROBE D: foreign fixture never became ready"
	kill "$WATCHDOG_PID" 2>/dev/null || true
	exit 3
fi

# Identity verification — never signal an unverified PID.
PS_LINE="$(ps -o pid=,ppid=,pgid=,uid=,lstart=,command= -p "$FOREIGN_PID" 2>/dev/null || true)"
echo "FOREIGN_PS_LINE=$PS_LINE"
{
	echo "FOREIGN_PID=$FOREIGN_PID"
	echo "FOREIGN_PS_LINE=$PS_LINE"
	echo "FOREIGN_LOG_HEAD:"; cat "$FOREIGN_LOG"
} > "$OUT/probe-d.identity.txt"

if ! grep -q 'foreign\.mjs' <<< "$PS_LINE"; then
	echo "HALT_UNSAFE_FIXTURE: foreign PID identity does not match foreign.mjs — refusing to signal"
	kill "$WATCHDOG_PID" 2>/dev/null || true
	exit 2
fi
if ! grep -q "$(id -un)" <<< "$PS_LINE"; then
	echo "HALT_UNSAFE_FIXTURE: foreign PID is not owned by the current operator UID"
	kill "$WATCHDOG_PID" 2>/dev/null || true
	exit 2
fi
echo "FOREIGN_IDENTITY_VERIFIED=true"

# Attempt exactly ONE signal from INSIDE the candidate Seatbelt instance.
run_probe D "$OUT/probe-d.stdout" "$OUT/probe-d.stderr" \
	env TMPDIR="$TMP" /usr/bin/sandbox-exec \
	-f "$EV1/candidate-profile-same-sandbox.sb" \
	"$NODE" "$FIX/foreign-signal-attempt.mjs" "$FOREIGN_PID" "$FOREIGN_LOG"

D_RAW="$(cat "$OUT/probe-d.stdout" "$OUT/probe-d.stderr")"
D_JSON="$(grep -m1 '^FOREIGN_SIGNAL_RESULT_JSON=' "$OUT/probe-d.stdout" | sed 's/^FOREIGN_SIGNAL_RESULT_JSON=//')"
echo "$D_JSON" > "$OUT/probe-d.result.json"
if [ -z "$D_JSON" ]; then
	echo "PROBE D produced no FOREIGN_SIGNAL_RESULT_JSON"
	printf '%s\n' "$D_RAW"
	kill "$WATCHDOG_PID" 2>/dev/null || true
	exit 3
fi
echo "$D_JSON"

D_OK="$(json_bool "$D_JSON" ok)"
D_ERR="$(json_str "$D_JSON" signalErrno)"
D_ALIVE_AFTER="$(json_bool "$D_JSON" foreignAliveAfter)"
D_GOT_TERM="$(grep -c 'FOREIGN_GOT_SIGTERM' <<< "$D_JSON" || true)"

if [ "$D_OK" = "true" ]; then
	echo "HALT_UNSAFE_SIGNAL_SCOPE: candidate profile signaled the controlled foreign process"
elif [ "$D_ERR" = "ESRCH" ]; then
	echo "PROBE D INVALID: ESRCH — foreign target had already exited (race); one fresh bounded repetition permitted"
fi

# Let the foreign fixture self-exit through its own bounded mechanism.
# BOUNDED wait: poll for exit, never block indefinitely on `wait`.
FOREIGN_EXITED=0
for _ in $(seq 1 150); do   # up to ~15 s at 0.1 s per tick
	if ! kill -0 "$FOREIGN_PID" 2>/dev/null; then
		FOREIGN_EXITED=1
		break
	fi
	sleep 0.1
done
wait "$FOREIGN_PID" 2>/dev/null || true
kill "$WATCHDOG_PID" 2>/dev/null || true

if [ "$FOREIGN_EXITED" -ne 1 ]; then
	echo "HALT_UNSAFE_FIXTURE: foreign control did not exit within the bounded window"
	exit 2
fi
echo "FOREIGN_EXIT_OBSERVED=true"

D_RESIDUAL="$(residual_for 'CLINEMM_RECON01_FOREIGN_CONTROL')"
echo "D_RESIDUAL=[$D_RESIDUAL]"
if [ -n "$D_RESIDUAL" ]; then
	echo "HALT_UNSAFE_FIXTURE: probe D left the foreign control residual"
	exit 2
fi
echo "D_CLEANUP_VERIFIED=true"

# ------------------------------------------------------------------ SUMMARY --
say "SUMMARY"
{
	echo "A_SIGNAL_OK=$A_OK"
	echo "A_SIGNAL_ERRNO=${A_ERR:-null}"
	echo "A_CHILD_GOT_SIGTERM=$A_GOT_TERM"
	echo "A_CHILD_ALIVE_AFTER=$A_ALIVE_AFTER"
	echo "A_CHILD_PID=$A_CHILD_PID"
	echo ""
	echo "B_SIGNAL_OK=$B_OK"
	echo "B_SIGNAL_ERRNO=${B_ERR:-null}"
	echo "B_CHILD_GOT_SIGTERM=$B_GOT_TERM"
	echo "B_CHILD_SELF_EXIT=$B_SELF_EXIT"
	echo "B_CHILD_ALIVE_AFTER=$B_ALIVE_AFTER"
	echo ""
	echo "C_SIGNAL_OK=$C_OK"
	echo "C_SIGNAL_ERRNO=${C_ERR:-null}"
	echo "C_CHILD_GOT_SIGTERM=$C_GOT_TERM"
	echo "C_CHILD_ALIVE_AFTER=$C_ALIVE_AFTER"
	echo ""
	echo "D_FOREIGN_PID=$FOREIGN_PID"
	echo "D_SIGNAL_OK=$D_OK"
	echo "D_SIGNAL_ERRNO=${D_ERR:-null}"
	echo "D_FOREIGN_ALIVE_AFTER=$D_ALIVE_AFTER"
	echo "D_FOREIGN_RECEIVED_SIGTERM=$D_GOT_TERM"
} | tee "$OUT/summary.txt"

FINAL_RESIDUAL="$(residual_for 'CLINEMM_RECON0')"
echo "FINAL_RESIDUAL=[$FINAL_RESIDUAL]"
if [ -n "$FINAL_RESIDUAL" ]; then
	echo "HALT_UNSAFE_FIXTURE: ACT-owned processes remain after the run"
	exit 2
fi

echo "PROBES_COMPLETED=A,B,C,D"
exit 0
