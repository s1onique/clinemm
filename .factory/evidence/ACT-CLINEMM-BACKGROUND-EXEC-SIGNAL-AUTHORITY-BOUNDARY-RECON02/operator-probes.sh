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
# P0 HARNESS CORRECTION (this revision):
#   R1  Probe D FAILS CLOSED. Successful foreign SIGTERM, ESRCH, missing
#       evidence, or any unexpected errno => NONZERO exit, and controlled
#       fixture cleanup is completed BEFORE exiting nonzero.
#   R2  Process identity is established by VERIFIED PID + EXACT argv
#       identity + START IDENTITY (ps lstart). Marker-based whole-table
#       scans are NOT used as a residual proof.
#   R3  Every probe runs under a REAL deadline enforced by a SIGKILL to the
#       probe's own process group. There is no unbounded `wait` anywhere.
#   R4  Ownership is compared NUMERICALLY (ps uid= vs id -u).
#   R5  kill(pid,0) => EPERM is UNVERIFIABLE, never "cleaned up".
#   R6  The decision table may NOT select an architecture from
#       Terminal-only measurements.
#   R7  The foreign pid is extracted from the FOREIGN_READY marker with an
#       ANCHORED expression and is proven to be the Node CHILD of the
#       deadline supervisor before any signal is attempted. The previous
#       greedy parse captured the "pid=" inside "ppid=" and therefore
#       signalled the SUPERVISOR: the resulting EPERM was real but said
#       nothing about the intended foreign process, so the measurement was
#       INVALID, not a qualified "denied". The argv check now requires
#       argv[0] to BE the Node executable running the fixture.
#
# P1 HARNESS CORRECTION (this revision):
#   The P0 run produced a D measurement that was INVALID for the reason
#   described in R7. A/B/C remain valid evidence. Only probe D is re-run.
#
# Usage:
#   bash operator-probes.sh
#
# Exit status:
#   0 = all four probes executed; probe D denied the foreign signal
#   2 = preflight / safety failure (HALT_*)
#   3 = probe execution failure / invalid measurement
#   4 = HALT_UNSAFE_SIGNAL_SCOPE (the candidate signaled the foreign proc)
#   5 = a probe exceeded its execution deadline
# =============================================================================
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RECON02_EVIDENCE_DIR="$HERE"
# shellcheck source=harness-lib.sh
source "$HERE/harness-lib.sh"

REPO="/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm"
EV="$HERE"
EV1="$REPO/.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01"
FIX="$EV/probe-fixtures"
TMP="/private/tmp/clinemm-recon01-tmp"
WS="/private/tmp/clinemm-recon01-ws"
OUT="$EV/raw"

CUR_SHA_EXPECTED="80b0caf181cd5d3ead4e0eb606e0e638f9b4f1d77aa34452a88d60ab0d1acb30"
CAND_SHA_EXPECTED="5a718c4c6228596fe7ca2affde833386327f393f98f8c61cbc0f728dc6bba276"

# REAL execution deadlines (R3). The probe fixture's own bounded lifetime
# is 4 s (child) / 9 s (foreign); these budgets are the hard outer bound.
DEADLINE_PROBE_A=30
DEADLINE_PROBE_BC=30
DEADLINE_PROBE_D=30
DEADLINE_FOREIGN_START=15
DEADLINE_REAP=15

mkdir -p "$OUT"

say() { printf '\n=== %s ===\n' "$*"; }

extract_probe_json() {
	grep -m1 '^PROBE_RESULT_JSON=' "$1" 2>/dev/null | sed 's/^PROBE_RESULT_JSON=//'
}

# R2: verify a controlled pid is gone, by PID + argv + start identity.
# Prints the classification; returns 0 only when GONE.
assert_controlled_gone() {
	local pid="$1" expect_argv="$2" expect_lstart="$3"
	local state
	if [ -z "$pid" ]; then
		echo "NO_PID"
		return 0
	fi
	state="$(verify_process_identity "$pid" "$expect_argv" "$expect_lstart")"
	echo "$state"
	[ "$state" = "GONE" ]
}

# ---------------------------------------------------------------- PREFLIGHT --
say "PREFLIGHT"

NODE="$(command -v node 2>/dev/null || true)"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
	echo "HALT_UNSAFE_FIXTURE: node not resolvable in this Terminal"
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi
echo "NODE=$NODE"
"$NODE" --version

if [ ! -r "$EV1/current-production-profile.sb" ] || [ ! -r "$EV1/candidate-profile-same-sandbox.sb" ]; then
	echo "HALT_UNSAFE_FIXTURE: profiles not readable"
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
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
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi

DIFF_OUT="$(diff -u "$EV1/current-production-profile.sb" "$EV1/candidate-profile-same-sandbox.sb" 2>&1)"
printf '%s\n' "$DIFF_OUT" | tee "$OUT/profile-diff.txt"
DIFF_LINES="$(printf '%s\n' "$DIFF_OUT" | grep -E '^[+-][^+-]' | sed 's/^[+-]//' | sort -u)"
EXPECTED_LINES="$(printf '%s\n' '(allow signal (target self))' '(allow signal (target same-sandbox))' | sort -u)"
if [ "$DIFF_LINES" != "$EXPECTED_LINES" ]; then
	echo "HALT_UNSAFE_FIXTURE: profile diff is not signal-only"
	printf 'observed:\n%s\nexpected:\n%s\n' "$DIFF_LINES" "$EXPECTED_LINES"
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi
echo "DIFF_ONLY_SIGNAL=true"

if /usr/bin/sandbox-exec -p "(version 1)(allow default)" /usr/bin/true 2>/dev/null; then
	echo "SANDBOX_EXEC_AVAILABLE=true"
else
	echo "HALT_UNSAFE_FIXTURE: sandbox-exec cannot apply in this context (nested sandbox)"
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi

# R3: the deadline mechanism requires the supervisor and a python3.
if [ ! -r "$RECON02_PY" ] || [ ! -f "$HERE/$RECON02_SUPERVISOR" ]; then
	echo "HALT_UNSAFE_FIXTURE: $RECON02_PY and $RECON02_SUPERVISOR are required for a real execution deadline"
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi
echo "DEADLINE_SUPERVISOR=$HERE/$RECON02_SUPERVISOR"
echo "DEADLINE_PYTHON=$RECON02_PY"

{
	echo "CONTEXT_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	echo "HOST_OS_VERSION=$(sw_vers -productVersion) ($(sw_vers -buildVersion))"
	echo "HOST_ARCH=$(uname -m)"
	echo "NODE_VERSION=$("$NODE" --version)"
	echo "NODE_PATH=$NODE"
	echo "HARNESS_PID=$$"
	echo "HARNESS_PPID=$PPID"
	echo "HARNESS_PWD=$PWD"
	echo "OPERATOR_UID=$(id -u)"
	echo "TERMINAL_TMPDIR_BEFORE=${TMPDIR:-<unset>}"
	echo "TERM_PROGRAM=${TERM_PROGRAM:-<unset>}"
} | tee "$OUT/execution-context.txt"

# Pre-existing orphan snapshot: INFORMATIONAL ONLY. It is never used as a
# residual proof (R2) and never cleaned (no machine-wide cleanup).
ps -Ao pid,ppid,pgid,user,lstart,command 2>/dev/null \
	| grep -E 'vitest|clinemm-sandbox-temp' | grep -v grep \
	> "$OUT/pre-orphans-snapshot.txt" || true
echo "PRE_EXISTING_ORPHAN_SNAPSHOT_LINES=$(wc -l < "$OUT/pre-orphans-snapshot.txt" | tr -d ' ')"

# ---------------------------------------------------------------------------
# Shared probe runner for A / B / C.
#
# Runs the fixture under a REAL deadline, then verifies by PID + argv +
# start identity that the controlled child is gone (R2/R5).
#
# run_child_probe <ID> <deadline> <outprefix> <cmd...>
# On success sets:
#   <ID>_JSON, <ID>_ERR, <ID>_OK, <ID>_READY, <ID>_ALIVE_AFTER,
#   <ID>_GOT_TERM, <ID>_CHILD_PID, <ID>_CHILD_PGID
# Returns 0 on a valid measurement, nonzero on failure.
# ---------------------------------------------------------------------------
run_child_probe() {
	local id="$1" deadline="$2" prefix="$3"; shift 3
	local outf="$OUT/$prefix.stdout" errf="$OUT/$prefix.stderr"
	local rc json

	run_with_deadline "$id" "$deadline" "$outf" "$errf" "$@"
	rc="$(cat "${outf%.stdout}.exit_code" 2>/dev/null || echo 1)"

	if [ "$rc" = "$EXIT_DEADLINE_EXCEEDED" ]; then
		echo "HALT_UNSAFE_FIXTURE: probe $id exceeded its ${deadline}s execution deadline"
		return "$EXIT_DEADLINE_EXCEEDED"
	fi

	json="$(extract_probe_json "$outf")"
	echo "$json" > "$OUT/$prefix.result.json"
	if [ -z "$json" ]; then
		echo "PROBE $id produced no PROBE_RESULT_JSON (exit=$rc)"
		cat "$errf" 2>/dev/null
		return "$EXIT_PROBE_INVALID"
	fi
	echo "$json"
	return 0
}

# Verify the controlled child is gone by PID + argv + start identity (R2).
# The child's argv is "<node> <probe.mjs> --child"; its PGID equals its PID.
verify_child_reaped() {
	local id="$1" child_pid="$2"
	local expect_argv="probe.mjs --child"
	local state

	if [ -z "$child_pid" ]; then
		echo "${id}_CHILD_REAP=NO_PID"
		return 1
	fi
	# R5: reap_bounded treats EPERM as UNVERIFIABLE, never as cleaned up.
	state="$(reap_bounded "$child_pid" "$DEADLINE_REAP" "$expect_argv" "")"
	echo "${id}_CHILD_REAP=$state"
	case "$state" in
		GONE) return 0 ;;
		*)    return 1 ;;
	esac
}

# ------------------------------------------------------------------ PROBE A --
say "PROBE A (independent Terminal, no Seatbelt)"
A_RC=0
run_child_probe A "$DEADLINE_PROBE_A" "probe-a" \
	env TMPDIR="$TMP" "$NODE" "$EV1/probe-fixtures/probe.mjs" || A_RC=$?
if [ "$A_RC" -ne 0 ]; then
	echo "HALT_BASELINE_INVALID: probe A did not produce a valid measurement (rc=$A_RC)"
	exit "$A_RC"
fi

A_JSON="$(cat "$OUT/probe-a.result.json")"
A_ERR="$(json_str "$A_JSON" signalErrno)"
A_OK="$(json_bool_nested "$A_JSON" signalAttempt ok)"
A_READY="$(json_bool "$A_JSON" childReady)"
A_ALIVE_AFTER="$(json_bool "$A_JSON" childStillAliveAfter)"
A_CHILD_PID="$(json_num "$A_JSON" childPid)"
A_PARENT_PID="$(json_num "$A_JSON" parentPid)"
A_GOT_TERM="$(grep -c 'CHILD_GOT_SIGTERM' <<< "$A_JSON" || true)"

if [ "$A_READY" != "true" ]; then
	echo "HALT_BASELINE_INVALID: child never became ready in probe A"
	exit "$EXIT_HALT_BASELINE_INVALID"
fi
if [ "$A_OK" != "true" ]; then
	echo "HALT_BASELINE_INVALID: probe A signal attempt failed (errno=$A_ERR)"
	exit "$EXIT_HALT_BASELINE_INVALID"
fi
if [ "$A_GOT_TERM" -eq 0 ]; then
	echo "HALT_BASELINE_INVALID: probe A child never observed SIGTERM"
	exit "$EXIT_HALT_BASELINE_INVALID"
fi
if [ "$A_ALIVE_AFTER" != "false" ]; then
	echo "HALT_BASELINE_INVALID: probe A child residual after exit"
	exit "$EXIT_HALT_BASELINE_INVALID"
fi
# R2/R5: PID-based, identity-verified reaping proof.
if ! verify_child_reaped A "$A_CHILD_PID"; then
	echo "HALT_UNSAFE_FIXTURE: probe A child was not verifiably reaped"
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi
echo "A_CLEANUP_VERIFIED=true"

# ------------------------------------------------------------------ PROBE B --
say "PROBE B (independent Terminal, current production profile)"
B_RC=0
run_child_probe B "$DEADLINE_PROBE_BC" "probe-b" \
	env TMPDIR="$TMP" /usr/bin/sandbox-exec \
	-f "$EV1/current-production-profile.sb" \
	"$NODE" "$EV1/probe-fixtures/probe.mjs" || B_RC=$?
if [ "$B_RC" -ne 0 ]; then
	B_RAW="$(cat "$OUT/probe-b.stdout" "$OUT/probe-b.stderr" 2>/dev/null)"
	if grep -q 'sandbox_apply' <<< "$B_RAW"; then
		echo "SUBSTRATE_FAILURE: sandbox_apply failed (NOT an EPERM reproduction)"
	else
		echo "PROBE B did not produce a valid measurement (rc=$B_RC)"
	fi
	printf '%s\n' "$B_RAW"
	exit "$B_RC"
fi

B_JSON="$(cat "$OUT/probe-b.result.json")"
B_ERR="$(json_str "$B_JSON" signalErrno)"
B_OK="$(json_bool_nested "$B_JSON" signalAttempt ok)"
B_READY="$(json_bool "$B_JSON" childReady)"
B_ALIVE_AFTER="$(json_bool "$B_JSON" childStillAliveAfter)"
B_CHILD_PID="$(json_num "$B_JSON" childPid)"
B_PARENT_PID="$(json_num "$B_JSON" parentPid)"
B_GOT_TERM="$(grep -c 'CHILD_GOT_SIGTERM' <<< "$B_JSON" || true)"
B_SELF_EXIT="$(grep -c 'CHILD_SELF_EXIT' <<< "$B_JSON" || true)"

if [ "$B_READY" != "true" ]; then
	echo "PROBE B: child never became ready — invalid signal measurement"
	exit "$EXIT_PROBE_INVALID"
fi
if ! verify_child_reaped B "$B_CHILD_PID"; then
	echo "HALT_UNSAFE_FIXTURE: probe B child was not verifiably reaped"
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi
echo "B_CLEANUP_VERIFIED=true"

# ------------------------------------------------------------------ PROBE C --
say "PROBE C (independent Terminal, candidate same-sandbox profile)"
C_RC=0
run_child_probe C "$DEADLINE_PROBE_BC" "probe-c" \
	env TMPDIR="$TMP" /usr/bin/sandbox-exec \
	-f "$EV1/candidate-profile-same-sandbox.sb" \
	"$NODE" "$EV1/probe-fixtures/probe.mjs" || C_RC=$?
if [ "$C_RC" -ne 0 ]; then
	C_RAW="$(cat "$OUT/probe-c.stdout" "$OUT/probe-c.stderr" 2>/dev/null)"
	if grep -q 'sandbox_apply' <<< "$C_RAW"; then
		echo "SUBSTRATE_FAILURE: candidate profile REJECTED by the kernel (sandbox_apply failed)"
	else
		echo "PROBE C did not produce a valid measurement (rc=$C_RC)"
	fi
	printf '%s\n' "$C_RAW"
	exit "$C_RC"
fi

C_JSON="$(cat "$OUT/probe-c.result.json")"
C_ERR="$(json_str "$C_JSON" signalErrno)"
C_OK="$(json_bool_nested "$C_JSON" signalAttempt ok)"
C_READY="$(json_bool "$C_JSON" childReady)"
C_ALIVE_AFTER="$(json_bool "$C_JSON" childStillAliveAfter)"
C_CHILD_PID="$(json_num "$C_JSON" childPid)"
C_PARENT_PID="$(json_num "$C_JSON" parentPid)"
C_GOT_TERM="$(grep -c 'CHILD_GOT_SIGTERM' <<< "$C_JSON" || true)"

if [ "$C_READY" != "true" ]; then
	echo "PROBE C: child never became ready — invalid signal measurement"
	exit "$EXIT_PROBE_INVALID"
fi
if ! verify_child_reaped C "$C_CHILD_PID"; then
	echo "HALT_UNSAFE_FIXTURE: probe C child was not verifiably reaped"
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi
echo "C_CLEANUP_VERIFIED=true"

# ------------------------------------------------------------------ PROBE D --
say "PROBE D (foreign-process negative control under candidate profile)"

FOREIGN_LOG="$TMP/recon02-foreign.log"
: > "$FOREIGN_LOG"

# The foreign fixture is started OUTSIDE any tested Seatbelt instance, in
# its OWN process group (so a deadline kill cannot touch the harness), and
# it self-exits after 9 s. Its pid and start identity are recorded BEFORE
# any signal is attempted.
# The foreign fixture is launched under the deadline supervisor so that it
# has a bounded lifetime AND remains in the harness's own session (so the
# harness may reap/verify it by pid). It is started OUTSIDE any tested
# Seatbelt instance.
"$RECON02_PY" "$HERE/$RECON02_SUPERVISOR" "$DEADLINE_FOREIGN_START" \
	env TMPDIR="$TMP" "$NODE" "$EV1/probe-fixtures/foreign.mjs" \
	> "$FOREIGN_LOG" 2>&1 &
FOREIGN_SUP_PID=$!
echo "FOREIGN_SUPERVISOR_PID=$FOREIGN_SUP_PID"

# The fixture's real pid is read from its own FOREIGN_READY marker, which
# the fixture prints as "FOREIGN_READY pid=<n> ppid=<m> marker=...".
# This is the pid the harness will verify and (from inside the sandbox)
# attempt to signal.
#
# R7: the extraction is ANCHORED. A greedy ".*pid=([0-9]+)" would match the
# "pid=" inside "ppid=" and yield the SUPERVISOR's pid, so the harness would
# signal the supervisor and record a legitimate-looking EPERM for a process
# that was never actually tested.
FOREIGN_PID=""
READY=0
for _ in $(seq 1 $(( DEADLINE_FOREIGN_START * 10 ))); do
	if grep -q 'FOREIGN_READY' "$FOREIGN_LOG" 2>/dev/null; then READY=1; break; fi
	if ! kill -0 "$FOREIGN_SUP_PID" 2>/dev/null; then break; fi
	sleep 0.1
done
if [ "$READY" -ne 1 ]; then
	echo "PROBE D: foreign fixture never became ready"
	reap_bounded "$FOREIGN_SUP_PID" 5 "foreign.mjs" "" || true
	exit "$EXIT_PROBE_INVALID"
fi
FOREIGN_PID="$(grep -m1 'FOREIGN_READY' "$FOREIGN_LOG" | extract_foreign_pid)"
if [ -z "$FOREIGN_PID" ]; then
	echo "PROBE D: could not determine the foreign fixture pid from its READY marker"
	reap_bounded "$FOREIGN_SUP_PID" 5 "foreign.mjs" "" || true
	exit "$EXIT_PROBE_INVALID"
fi
echo "FOREIGN_PID=$FOREIGN_PID"


# ---- R7 + R2 + R4: identity verification before ANY signal is attempted -----
FOREIGN_ARGV="$(ps_argv_of "$FOREIGN_PID")"
FOREIGN_LSTART="$(ps_lstart_of "$FOREIGN_PID")"
FOREIGN_UID_NUM="$(ps_uid_of "$FOREIGN_PID")"
FOREIGN_ACTUAL_PPID="$(ps_ppid_of "$FOREIGN_PID")"
OPERATOR_UID_NUM="$(id -u)"
{
	echo "FOREIGN_PID=$FOREIGN_PID"
	echo "FOREIGN_SUPERVISOR_PID=$FOREIGN_SUP_PID"
	echo "FOREIGN_ACTUAL_PPID=$FOREIGN_ACTUAL_PPID"
	echo "FOREIGN_ARGV=$FOREIGN_ARGV"
	echo "FOREIGN_LSTART=$FOREIGN_LSTART"
	echo "FOREIGN_UID_NUM=$FOREIGN_UID_NUM"
	echo "OPERATOR_UID_NUM=$OPERATOR_UID_NUM"
	echo "FOREIGN_LOG_HEAD:"; cat "$FOREIGN_LOG"
} > "$OUT/probe-d.identity.txt"

# R7: the target MUST be the Node child of the deadline supervisor — not the
# supervisor itself, and not an unrelated process. Signalling the supervisor
# would produce a plausible EPERM while the intended foreign process was
# never signalled at all.
FOREIGN_OWNERSHIP="$(classify_foreign_ownership "$FOREIGN_PID" "$FOREIGN_SUP_PID" "$FOREIGN_ACTUAL_PPID")"
echo "FOREIGN_OWNERSHIP=$FOREIGN_OWNERSHIP"
if [ "$FOREIGN_OWNERSHIP" != "OWNED" ]; then
	case "$FOREIGN_OWNERSHIP" in
		IS_SUPERVISOR)
			echo "HALT_UNSAFE_FIXTURE: the extracted foreign PID ($FOREIGN_PID) IS the deadline supervisor ($FOREIGN_SUP_PID) — the marker parse is wrong; refusing to signal"
			;;
		NOT_CHILD)
			echo "HALT_UNSAFE_FIXTURE: the extracted foreign PID ($FOREIGN_PID) is not a child of the deadline supervisor ($FOREIGN_SUP_PID) (observed ppid=$FOREIGN_ACTUAL_PPID) — refusing to signal"
			;;
		*)
			echo "HALT_UNSAFE_FIXTURE: could not establish ownership of the foreign PID ($FOREIGN_PID) — refusing to signal"
			;;
	esac
	reap_bounded "$FOREIGN_PID" "$DEADLINE_REAP" "foreign.mjs" "$FOREIGN_LSTART" || true
	reap_bounded "$FOREIGN_SUP_PID" "$DEADLINE_REAP" "foreign.mjs" "" || true
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi
echo "FOREIGN_OWNERSHIP_VERIFIED=true"

# R7: exact executable/argv identity. The target must BE the Node process
# that RUNS the foreign fixture — argv[0] is the Node executable and the
# fixture is a script argument. A plain substring test would also accept the
# deadline supervisor, whose command line merely mentions the fixture path.
FOREIGN_ARGV_CLASS="$(classify_foreign_argv "$FOREIGN_ARGV" "$NODE" "$EV1/probe-fixtures/foreign.mjs")"
echo "FOREIGN_ARGV_CLASS=$FOREIGN_ARGV_CLASS"
case "$FOREIGN_ARGV_CLASS" in
	FIXTURE_NODE) : ;;
	NOT_NODE)
		echo "HALT_UNSAFE_FIXTURE: foreign PID argv[0] is not the Node executable — refusing to signal"
		echo "  observed argv: $FOREIGN_ARGV"
		reap_bounded "$FOREIGN_PID" "$DEADLINE_REAP" "foreign.mjs" "$FOREIGN_LSTART" || true
		reap_bounded "$FOREIGN_SUP_PID" "$DEADLINE_REAP" "foreign.mjs" "" || true
		exit "$EXIT_HALT_UNSAFE_FIXTURE"
		;;
	*)
		echo "HALT_UNSAFE_FIXTURE: foreign PID argv does not run the foreign fixture under Node — refusing to signal"
		echo "  observed argv: $FOREIGN_ARGV"
		reap_bounded "$FOREIGN_PID" "$DEADLINE_REAP" "foreign.mjs" "$FOREIGN_LSTART" || true
		reap_bounded "$FOREIGN_SUP_PID" "$DEADLINE_REAP" "foreign.mjs" "" || true
		exit "$EXIT_HALT_UNSAFE_FIXTURE"
		;;
esac
echo "FOREIGN_ARGV_VERIFIED=true"

# R4: NUMERIC uid comparison. A username appearing anywhere in the command
# line is NOT evidence of ownership.
if [ -z "$FOREIGN_UID_NUM" ] || [ "$FOREIGN_UID_NUM" != "$OPERATOR_UID_NUM" ]; then
	echo "HALT_UNSAFE_FIXTURE: foreign PID numeric uid ($FOREIGN_UID_NUM) != operator uid ($OPERATOR_UID_NUM) — refusing to signal"
	reap_bounded "$FOREIGN_PID" "$DEADLINE_REAP" "foreign.mjs" "$FOREIGN_LSTART" || true
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi
echo "FOREIGN_UID_VERIFIED=true"

# Attempt exactly ONE signal from INSIDE the candidate Seatbelt instance.
D_OUTF="$OUT/probe-d.stdout"; D_ERRF="$OUT/probe-d.stderr"
run_with_deadline D "$DEADLINE_PROBE_D" "$D_OUTF" "$D_ERRF" \
	env TMPDIR="$TMP" /usr/bin/sandbox-exec \
	-f "$EV1/candidate-profile-same-sandbox.sb" \
	"$NODE" "$FIX/foreign-signal-attempt.mjs" "$FOREIGN_PID" "$FOREIGN_LOG"
D_RC="$(cat "${D_OUTF%.stdout}.exit_code" 2>/dev/null || echo 1)"

D_RAW="$(cat "$D_OUTF" "$D_ERRF" 2>/dev/null)"
D_JSON="$(grep -m1 '^FOREIGN_SIGNAL_RESULT_JSON=' "$D_OUTF" 2>/dev/null | sed 's/^FOREIGN_SIGNAL_RESULT_JSON=//')"
echo "$D_JSON" > "$OUT/probe-d.result.json"

# ---- R1: the foreign control is ALWAYS reaped, even on failure -----------
# Cleanup happens BEFORE any nonzero exit so no controlled fixture leaks.
FOREIGN_REAP_STATE="$(reap_bounded "$FOREIGN_PID" "$DEADLINE_REAP" "foreign.mjs" "$FOREIGN_LSTART" || true)"
echo "FOREIGN_REAP_STATE=$FOREIGN_REAP_STATE"
# The supervisor is a separate pid and must also be reaped.
FOREIGN_SUP_REAP_STATE="$(reap_bounded "$FOREIGN_SUP_PID" "$DEADLINE_REAP" "foreign.mjs" "" || true)"
echo "FOREIGN_SUP_REAP_STATE=$FOREIGN_SUP_REAP_STATE"
{
	echo "FOREIGN_PID=$FOREIGN_PID"
	echo "FOREIGN_ARGV=$FOREIGN_ARGV"
	echo "FOREIGN_LSTART=$FOREIGN_LSTART"
	echo "FOREIGN_REAP_STATE=$FOREIGN_REAP_STATE"
} > "$OUT/probe-d.cleanup.txt"

if [ "$FOREIGN_REAP_STATE" != "GONE" ] || [ "$FOREIGN_SUP_REAP_STATE" != "GONE" ]; then
	echo "HALT_UNSAFE_FIXTURE: the foreign control was not verifiably reaped (fixture=$FOREIGN_REAP_STATE supervisor=$FOREIGN_SUP_REAP_STATE)"
	exit "$EXIT_HALT_UNSAFE_FIXTURE"
fi
echo "FOREIGN_CONTROL_REAPED=true"

# ---- R1: classify the evidence; fail closed ------------------------------
# A nonzero probe execution status invalidates the measurement even when
# a complete-looking payload was printed before the failure.
D_EVIDENCE="absent"
D_OK=""; D_ERR=""; D_ALIVE_AFTER=""; D_GOT_TERM=""
if [ "$D_RC" != "0" ]; then
	echo "PROBE D INVALID: fixture execution failed (exit=$D_RC)"
	printf '%s\n' "$D_RAW"
	exit "$EXIT_PROBE_INVALID"
fi
if [ -n "$D_JSON" ]; then
	D_EVIDENCE="present"
	D_OK="$(json_bool_nested "$D_JSON" signalAttempt ok)"
	D_ERR="$(json_str "$D_JSON" signalErrno)"
	D_ALIVE_AFTER="$(json_bool "$D_JSON" foreignAliveAfter)"
	D_GOT_TERM="$(json_bool "$D_JSON" foreignReceivedSIGTERM)"
	echo "$D_JSON"
fi

D_CLASS="$(classify_probe_d "$D_OK" "$D_ERR" "$D_ALIVE_AFTER" "$D_GOT_TERM" "$D_EVIDENCE")"
echo "PROBE_D_CLASSIFICATION=$D_CLASS"
echo "$D_CLASS" > "$OUT/probe-d.classification"

case "$D_CLASS" in
	DENIED_EXPECTED)
		echo "PROBE D: foreign signal DENIED as required (EPERM, target survived)"
		;;
	UNSAFE_SIGNAL)
		echo "HALT_UNSAFE_SIGNAL_SCOPE: the candidate profile signaled the controlled foreign process"
		printf '%s\n' "$D_RAW"
		exit "$EXIT_HALT_UNSAFE_SIGNAL_SCOPE"
		;;
	INVALID_ESRCH)
		echo "PROBE D INVALID: ESRCH — the foreign target had already exited (race)."
		echo "              One fresh, bounded repetition is permitted; discard this attempt."
		printf '%s\n' "$D_RAW"
		exit "$EXIT_PROBE_INVALID"
		;;
	INVALID_ERRNO)
		echo "PROBE D INVALID: unexpected errno '$D_ERR' (expected EPERM)"
		printf '%s\n' "$D_RAW"
		exit "$EXIT_PROBE_INVALID"
		;;
	INVALID_ALIVE)
		echo "PROBE D INVALID: the signal was denied but the foreign target did not survive"
		printf '%s\n' "$D_RAW"
		exit "$EXIT_PROBE_INVALID"
		;;
	INVALID_RECEIVED)
		echo "PROBE D INVALID: the foreign target reported receiving SIGTERM"
		printf '%s\n' "$D_RAW"
		exit "$EXIT_HALT_UNSAFE_SIGNAL_SCOPE"
		;;
	*)
		echo "PROBE D INVALID: missing or incomplete evidence payload"
		printf '%s\n' "$D_RAW"
		exit "$EXIT_PROBE_INVALID"
		;;
esac

# ------------------------------------------------------------------ SUMMARY --
say "SUMMARY"

# Map the raw probe outcomes onto the decision vocabulary.
# signalAttempt.ok is the primary result: a successful process.kill() has
# signalErrno=null, so errno alone cannot distinguish success from invalid
# evidence. The errno is used only to classify a FAILED attempt.
case "$A_OK" in
	true) A_VERDICT="SUCCESS" ;;
	*)    A_VERDICT="INVALID" ;;
esac
case "$B_OK" in
	true) B_VERDICT="SUCCESS" ;;
	false)
		case "$B_ERR" in
			EPERM) B_VERDICT="EPERM" ;;
			ESRCH) B_VERDICT="ESRCH" ;;
			*)    B_VERDICT="INVALID" ;;
		esac
		;;
	*) B_VERDICT="INVALID" ;;
esac
case "$C_OK" in
	true) C_VERDICT="SUCCESS" ;;
	false)
		case "$C_ERR" in
			EPERM) C_VERDICT="EPERM" ;;
			ESRCH) C_VERDICT="ESRCH" ;;
			*)    C_VERDICT="INVALID" ;;
		esac
		;;
	*) C_VERDICT="INVALID" ;;
esac
case "$D_CLASS" in
	DENIED_EXPECTED) D_VERDICT="DENIED" ;;
	UNSAFE_SIGNAL)   D_VERDICT="UNSAFE" ;;
	*)               D_VERDICT="INVALID" ;;
esac

# R6: The A/B/C/D matrix is measured in an INDEPENDENT TERMINAL. It
# QUALIFIES the candidate Seatbelt signal rule. It does NOT, by itself,
# observe the inherited VSCodium/Chromium authority, so it cannot select
# a production-only repair or a composed architecture.
#
# PRODUCTION_CONTEXT_EVIDENCE is deliberately hard-coded to NO. This is a
# Terminal-only harness: the operator's environment MUST NOT be able to
# manufacture the second evidence gate. Architecture selection happens in
# a separate production-seam exercise with real production evidence.
PRODUCTION_CONTEXT_EVIDENCE="NO"

DECISION="$(classify_decision "$A_VERDICT" "$B_VERDICT" "$C_VERDICT" "$D_VERDICT" "$PRODUCTION_CONTEXT_EVIDENCE")"

{
	echo "A_SIGNAL_OK=$A_OK"
	echo "A_SIGNAL_ERRNO=${A_ERR:-null}"
	echo "A_CHILD_GOT_SIGTERM=$A_GOT_TERM"
	echo "A_CHILD_ALIVE_AFTER=$A_ALIVE_AFTER"
	echo "A_CHILD_PID=$A_CHILD_PID"
	echo "A_PARENT_PID=$A_PARENT_PID"
	echo "A_VERDICT=$A_VERDICT"
	echo ""
	echo "B_SIGNAL_OK=$B_OK"
	echo "B_SIGNAL_ERRNO=${B_ERR:-null}"
	echo "B_CHILD_GOT_SIGTERM=$B_GOT_TERM"
	echo "B_CHILD_SELF_EXIT=$B_SELF_EXIT"
	echo "B_CHILD_ALIVE_AFTER=$B_ALIVE_AFTER"
	echo "B_CHILD_PID=$B_CHILD_PID"
	echo "B_PARENT_PID=$B_PARENT_PID"
	echo "B_VERDICT=$B_VERDICT"
	echo ""
	echo "C_SIGNAL_OK=$C_OK"
	echo "C_SIGNAL_ERRNO=${C_ERR:-null}"
	echo "C_CHILD_GOT_SIGTERM=$C_GOT_TERM"
	echo "C_CHILD_ALIVE_AFTER=$C_ALIVE_AFTER"
	echo "C_CHILD_PID=$C_CHILD_PID"
	echo "C_PARENT_PID=$C_PARENT_PID"
	echo "C_VERDICT=$C_VERDICT"
	echo ""
	echo "D_FOREIGN_PID=$FOREIGN_PID"
	echo "D_FOREIGN_SUPERVISOR_PID=$FOREIGN_SUP_PID"
	echo "D_FOREIGN_ACTUAL_PPID=$FOREIGN_ACTUAL_PPID"
	echo "D_FOREIGN_OWNERSHIP=$FOREIGN_OWNERSHIP"
	echo "D_FOREIGN_ARGV_CLASS=$FOREIGN_ARGV_CLASS"
	echo "D_FOREIGN_ARGV=$FOREIGN_ARGV"
	echo "D_FOREIGN_LSTART=$FOREIGN_LSTART"
	echo "D_FOREIGN_UID_NUM=$FOREIGN_UID_NUM"
	echo "D_SIGNAL_OK=$D_OK"
	echo "D_SIGNAL_ERRNO=${D_ERR:-null}"
	echo "D_FOREIGN_ALIVE_AFTER=$D_ALIVE_AFTER"
	echo "D_FOREIGN_RECEIVED_SIGTERM=$D_GOT_TERM"
	echo "D_CLASSIFICATION=$D_CLASS"
	echo "D_FOREIGN_REAP_STATE=$FOREIGN_REAP_STATE"
	echo "D_VERDICT=$D_VERDICT"
	echo ""
	echo "PRODUCTION_CONTEXT_EVIDENCE=$PRODUCTION_CONTEXT_EVIDENCE"
	echo "DECISION=$DECISION"
	echo ""
	echo "NOTE: A/B/C/D are TERMINAL measurements. They QUALIFY the candidate"
	echo "      Seatbelt signal rule but do NOT observe the inherited"
	echo "      VSCodium/Chromium authority. Per R6 they may not select a"
	echo "      production-only or composed architecture on their own."
} | tee "$OUT/summary.txt"

echo "DECISION=$DECISION"
echo "PROBES_COMPLETED=A,B,C,D"
exit "$EXIT_OK"
