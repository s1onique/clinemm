#!/bin/bash
# =============================================================================
# ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02
# harness-regression-test.sh — PROCESS-FREE regression tests for the P0
# harness correction.
#
# These tests NEVER execute the live A/B/C/D probes. They exercise:
#   * harness JSON parsing (json_bool / json_str / json_num)
#   * exit-status propagation (probe_d_exit_status and the halt codes)
#   * decision classification (classify_decision, classify_probe_d)
#   * the R6 rule that a Terminal-only result may NOT select an architecture
#   * the R1 rule that probe D fails closed
#   * the R2/R4/R5 identity, ownership and liveness rules
#
# It is safe to run this from ANY substrate, including the sandboxed agent
# substrate, because it spawns no long-lived processes and signals nothing
# except a liveness probe of the test's own pid.
#
# Usage:  bash harness-regression-test.sh
# Exit:   0 = all tests passed, 1 = at least one test failed
# =============================================================================
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=harness-lib.sh
source "$HERE/harness-lib.sh"

PASS=0
FAIL=0

ok()  { PASS=$(( PASS + 1 )); printf '  PASS  %s\n' "$1"; }
bad() { FAIL=$(( FAIL + 1 )); printf '  FAIL  %s\n     expected: %s\n     actual:   %s\n' "$1" "$2" "$3"; }
is()  { if [ "$3" = "$2" ]; then ok "$1"; else bad "$1" "$2" "$3"; fi; }

echo "=== RECON02 harness regression tests (process-free) ==="

# ---------------------------------------------------------------------------
echo "--- JSON parsing ---"
J_EPERM='{"marker":"CLINEMM_RECON01_SIGNAL_PROBE","parentPid":15406,"childPid":15410,"signalAttempt":{"signal":"SIGTERM","target":"child-pid","ok":false,"errnoCode":"EPERM","errnoMessage":"kill EPERM","syscall":"kill"},"signalErrno":"EPERM","childExitedOnOwn":true,"childExitCode":0,"childStillAlive":false,"childStillAliveAfter":false,"cleanup":"child-exited-no-cleanup-needed","childReady":true,"childAliveProbeErrno":"ESRCH"}'
J_OK='{"parentPid":99,"childPid":100,"signalAttempt":{"signal":"SIGTERM","target":"child-pid","ok":true},"signalErrno":null,"childExitedOnOwn":true,"childExitCode":0,"childStillAlive":false,"childStillAliveAfter":false,"childReady":true}'

is "json_bool parses a true value"               "true"  "$(json_bool "$J_OK" childReady)"
is "json_bool parses a false value"              "false" "$(json_bool "$J_OK" childStillAliveAfter)"
is "json_bool_nested parses signalAttempt.ok=true"  "true"  "$(json_bool_nested "$J_OK" signalAttempt ok)"
is "json_bool_nested parses signalAttempt.ok=false" "false" "$(json_bool_nested "$J_EPERM" signalAttempt ok)"
is "json_bool_nested ignores an unrelated top-level ok" "false" "$(json_bool_nested '{"ok":true,"signalAttempt":{"ok":false}}' signalAttempt ok)"
is "json_bool_nested returns empty for absent object"   ""    "$(json_bool_nested "$J_OK" noSuchObject ok)"
is "json_str parses signalErrno=EPERM"           "EPERM" "$(json_str "$J_EPERM" signalErrno)"
is "json_str returns empty for JSON null"        ""      "$(json_str "$J_OK" signalErrno)"
is "json_num parses childPid"                    "100"   "$(json_num "$J_OK" childPid)"
is "json_num parses parentPid"                   "99"    "$(json_num "$J_OK" parentPid)"
is "json_bool returns empty for absent key"      ""      "$(json_bool "$J_OK" noSuchKey)"

# ---------------------------------------------------------------------------
echo "--- R1: probe D classification fails closed ---"
is "D: denied + EPERM + survived   => DENIED_EXPECTED" \
   "DENIED_EXPECTED"  "$(classify_probe_d false EPERM true false present)"
is "D: signal succeeded            => UNSAFE_SIGNAL" \
   "UNSAFE_SIGNAL"    "$(classify_probe_d true  EPERM true false present)"
is "D: signal succeeded (null err) => UNSAFE_SIGNAL" \
   "UNSAFE_SIGNAL"    "$(classify_probe_d true  ''    true false present)"
is "D: ESRCH                        => INVALID_ESRCH" \
   "INVALID_ESRCH"    "$(classify_probe_d false ESRCH true false present)"
is "D: unexpected errno (EINVAL)   => INVALID_ERRNO" \
   "INVALID_ERRNO"    "$(classify_probe_d false EINVAL true false present)"
is "D: missing errno               => INVALID_ERRNO" \
   "INVALID_ERRNO"    "$(classify_probe_d false ''    true false present)"
is "D: missing evidence            => INVALID_EVIDENCE" \
   "INVALID_EVIDENCE" "$(classify_probe_d false EPERM true false absent)"
is "D: target did not survive      => INVALID_ALIVE" \
   "INVALID_ALIVE"    "$(classify_probe_d false EPERM false false present)"
is "D: target received SIGTERM     => INVALID_RECEIVED" \
   "INVALID_RECEIVED" "$(classify_probe_d false EPERM true true present)"
is "D: missing signal ok           => INVALID_EVIDENCE" \
   "INVALID_EVIDENCE" "$(classify_probe_d '' EPERM true false present)"
is "D: unrecognized signal ok      => INVALID_EVIDENCE" \
   "INVALID_EVIDENCE" "$(classify_probe_d 1 EPERM true false present)"
is "D: missing alive-after         => INVALID_EVIDENCE" \
   "INVALID_EVIDENCE" "$(classify_probe_d false EPERM '' false present)"
is "D: missing received-SIGTERM    => INVALID_EVIDENCE" \
   "INVALID_EVIDENCE" "$(classify_probe_d false EPERM true '' present)"
is "D: unrecognized received value => INVALID_EVIDENCE" \
   "INVALID_EVIDENCE" "$(classify_probe_d false EPERM true 0 present)"

# ---------------------------------------------------------------------------
# Real shell-to-classifier wiring for probe D: the JSON booleans are parsed
# by the same helpers the operator harness uses, then passed to the same
# classifier. This catches the original "grep count 0/1" defect because the
# parser now yields the JSON boolean itself.
# ---------------------------------------------------------------------------
echo "--- R1: shell-to-classifier wiring for probe D ---"
J_D_DENIED='{"signalAttempt":{"signal":"SIGTERM","target":"foreign-pid","ok":false,"errnoCode":"EPERM"},"signalErrno":"EPERM","foreignAliveAfter":true,"foreignReceivedSIGTERM":false}'
J_D_RECEIVED='{"signalAttempt":{"signal":"SIGTERM","target":"foreign-pid","ok":false,"errnoCode":"EPERM"},"signalErrno":"EPERM","foreignAliveAfter":true,"foreignReceivedSIGTERM":true}'
J_D_SUCCEEDED='{"signalAttempt":{"signal":"SIGTERM","target":"foreign-pid","ok":true},"signalErrno":null,"foreignAliveAfter":true,"foreignReceivedSIGTERM":false}'
J_D_MISSING_RECEIVED='{"signalAttempt":{"signal":"SIGTERM","target":"foreign-pid","ok":false,"errnoCode":"EPERM"},"signalErrno":"EPERM","foreignAliveAfter":true,"foreignReceivedSIGTERM":null}'

D_WIRE_OK="$(json_bool_nested "$J_D_DENIED" signalAttempt ok)"
D_WIRE_ERR="$(json_str "$J_D_DENIED" signalErrno)"
D_WIRE_ALIVE="$(json_bool "$J_D_DENIED" foreignAliveAfter)"
D_WIRE_RECEIVED="$(json_bool "$J_D_DENIED" foreignReceivedSIGTERM)"
is "D wiring: denied payload parses to DENIED_EXPECTED" "DENIED_EXPECTED" \
   "$(classify_probe_d "$D_WIRE_OK" "$D_WIRE_ERR" "$D_WIRE_ALIVE" "$D_WIRE_RECEIVED" present)"
is "D wiring: received=true payload parses to INVALID_RECEIVED" "INVALID_RECEIVED" \
   "$(classify_probe_d "$(json_bool_nested "$J_D_RECEIVED" signalAttempt ok)" "$(json_str "$J_D_RECEIVED" signalErrno)" "$(json_bool "$J_D_RECEIVED" foreignAliveAfter)" "$(json_bool "$J_D_RECEIVED" foreignReceivedSIGTERM)" present)"
is "D wiring: signalAttempt.ok=true payload parses to UNSAFE_SIGNAL" "UNSAFE_SIGNAL" \
   "$(classify_probe_d "$(json_bool_nested "$J_D_SUCCEEDED" signalAttempt ok)" "$(json_str "$J_D_SUCCEEDED" signalErrno)" "$(json_bool "$J_D_SUCCEEDED" foreignAliveAfter)" "$(json_bool "$J_D_SUCCEEDED" foreignReceivedSIGTERM)" present)"
is "D wiring: null received field parses to INVALID_EVIDENCE" "INVALID_EVIDENCE" \
   "$(classify_probe_d "$(json_bool_nested "$J_D_MISSING_RECEIVED" signalAttempt ok)" "$(json_str "$J_D_MISSING_RECEIVED" signalErrno)" "$(json_bool "$J_D_MISSING_RECEIVED" foreignAliveAfter)" "$(json_bool "$J_D_MISSING_RECEIVED" foreignReceivedSIGTERM)" present)"

# ---------------------------------------------------------------------------
echo "--- R1: probe D exit-status propagation ---"
is "exit status: DENIED_EXPECTED -> 0"        "0" "$(probe_d_exit_status DENIED_EXPECTED)"
is "exit status: UNSAFE_SIGNAL   -> 4"        "4" "$(probe_d_exit_status UNSAFE_SIGNAL)"
is "exit status: INVALID_ESRCH   -> 3"        "3" "$(probe_d_exit_status INVALID_ESRCH)"
is "exit status: INVALID_ERRNO   -> 3"        "3" "$(probe_d_exit_status INVALID_ERRNO)"
is "exit status: INVALID_EVIDENCE-> 3"        "3" "$(probe_d_exit_status INVALID_EVIDENCE)"
is "exit status: INVALID_ALIVE   -> 3"        "3" "$(probe_d_exit_status INVALID_ALIVE)"
is "exit status: INVALID_RECEIVED-> 3"        "3" "$(probe_d_exit_status INVALID_RECEIVED)"
is "exit status: unknown class    -> 3"        "3" "$(probe_d_exit_status SOMETHING_ELSE)"
for c in UNSAFE_SIGNAL INVALID_ESRCH INVALID_ERRNO INVALID_EVIDENCE INVALID_ALIVE INVALID_RECEIVED; do
	st="$(probe_d_exit_status "$c")"
	if [ "$st" -ne 0 ]; then ok "exit status: $c is nonzero ($st)"; else bad "exit status: $c is nonzero" "nonzero" "0"; fi
done

# ---------------------------------------------------------------------------
echo "--- R6: decision classification ---"
is "A=EPERM                        => HALT_BASELINE_INVALID" \
   "HALT_BASELINE_INVALID" "$(classify_decision EPERM SUCCESS SUCCESS DENIED NO)"
is "A=ESRCH                        => HALT_BASELINE_INVALID" \
   "HALT_BASELINE_INVALID" "$(classify_decision ESRCH SUCCESS SUCCESS DENIED NO)"
is "A=INVALID                      => HALT_BASELINE_INVALID" \
   "HALT_BASELINE_INVALID" "$(classify_decision INVALID SUCCESS SUCCESS DENIED NO)"
is "D=UNSAFE                       => HALT_UNSAFE_SIGNAL_SCOPE" \
   "HALT_UNSAFE_SIGNAL_SCOPE" "$(classify_decision SUCCESS EPERM SUCCESS UNSAFE NO)"
is "D=ESRCH (invalid)              => CAPTURE_INSUFFICIENT" \
   "CAPTURE_INSUFFICIENT" "$(classify_decision SUCCESS EPERM SUCCESS ESRCH NO)"
is "D=INVALID                      => CAPTURE_INSUFFICIENT" \
   "CAPTURE_INSUFFICIENT" "$(classify_decision SUCCESS EPERM SUCCESS INVALID NO)"
is "Terminal-only ideal row        => READY_FOR_OPERATOR_PROBES" \
   "READY_FOR_OPERATOR_PROBES" "$(classify_decision SUCCESS EPERM SUCCESS DENIED NO)"
is "Terminal-only candidate fails  => READY_FOR_OPERATOR_PROBES" \
   "READY_FOR_OPERATOR_PROBES" "$(classify_decision SUCCESS EPERM EPERM DENIED NO)"
is "Terminal-only B succeeds       => READY_FOR_OPERATOR_PROBES" \
   "READY_FOR_OPERATOR_PROBES" "$(classify_decision SUCCESS SUCCESS SUCCESS DENIED NO)"
is "prod-evidence: B=EPERM C=OK    => SELECT_SEATBELT_SIGNAL_REPAIR" \
   "SELECT_SEATBELT_SIGNAL_REPAIR" "$(classify_decision SUCCESS EPERM SUCCESS DENIED YES)"
is "prod-evidence: B=EPERM C=EPERM => SELECT_COMPOSED_BOUNDARY_REPAIR" \
   "SELECT_COMPOSED_BOUNDARY_REPAIR" "$(classify_decision SUCCESS EPERM EPERM DENIED YES)"
is "prod-evidence: B=OK C=OK       => SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY" \
   "SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY" "$(classify_decision SUCCESS SUCCESS SUCCESS DENIED YES)"

echo "--- R6 invariant: prod=NO never selects an architecture ---"
ARCH_TOKENS="SELECT_SEATBELT_SIGNAL_REPAIR SELECT_COMPOSED_BOUNDARY_REPAIR SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY"
for a in SUCCESS EPERM; do
	for b in SUCCESS EPERM; do
		for c in SUCCESS EPERM; do
			for d in DENIED UNSAFE ESRCH INVALID; do
				v="$(classify_decision "$a" "$b" "$c" "$d" NO)"
				case " $ARCH_TOKENS " in
					*" $v "*) bad "prod=NO ($a/$b/$c/$d) yields no architecture" "no SELECT_* token" "$v" ;;
					*)        ok "prod=NO ($a/$b/$c/$d) yields '$v' (no architecture selected)" ;;
				esac
			done
		done
	done
done

# ---------------------------------------------------------------------------
echo "--- R5: EPERM is never treated as cleaned up ---"
is "classify_liveness on a dead pid => GONE" "GONE" "$(classify_liveness 999999)"
if assert_gone 999999 "anything" "" > /dev/null; then
	ok "assert_gone succeeds for a dead pid"
else
	bad "assert_gone succeeds for a dead pid" "success" "failure"
fi
SELF_PID=$$
if assert_gone "$SELF_PID" "" "" > /dev/null; then
	bad "assert_gone fails for a live pid" "failure" "success"
else
	ok "assert_gone fails for a live pid"
fi
if reap_bounded "$SELF_PID" 1 "" "" > /dev/null; then
	bad "reap_bounded fails for a live pid" "failure" "success"
else
	ok "reap_bounded fails for a live pid"
fi

# ---------------------------------------------------------------------------
echo "--- R2: identity verification uses argv + start identity ---"
SELF_ARGV="$(ps_argv_of "$SELF_PID")"
SELF_LSTART="$(ps_lstart_of "$SELF_PID")"
if [ -n "$SELF_ARGV" ] && [ -n "$SELF_LSTART" ]; then
	ok "ps_argv_of / ps_lstart_of return data for a live pid"
	SELF_LIVE="$(classify_liveness "$SELF_PID")"
	case "$SELF_LIVE" in
		ALIVE)
			st="$(verify_process_identity "$SELF_PID" "harness-regression-test" "$SELF_LSTART")"
			is "verify_process_identity => VERIFIED (signalable substrate)" "VERIFIED" "$st"
			;;
		UNVERIFIABLE)
			st="$(verify_process_identity "$SELF_PID" "harness-regression-test" "$SELF_LSTART")"
			is "verify_process_identity => UNVERIFIABLE (EPERM substrate, NOT GONE)" "UNVERIFIABLE" "$st"
			;;
		*)
			bad "classify_liveness on own pid" "ALIVE or UNVERIFIABLE" "$SELF_LIVE" ;;
	esac
	st2="$(verify_process_identity "$SELF_PID" "definitely-not-this-argv" "$SELF_LSTART")"
	is "verify_process_identity rejects a wrong argv" "IDENTITY_MISMATCH" "$st2"
	st3="$(verify_process_identity "$SELF_PID" "harness-regression-test" "Thu Jan  1 00:00:00 1970")"
	is "verify_process_identity rejects a wrong start identity" "IDENTITY_MISMATCH" "$st3"
else
	bad "ps_argv_of / ps_lstart_of return data for a live pid" "non-empty" "empty"
fi
is "verify_process_identity on a dead pid => GONE" "GONE" \
   "$(verify_process_identity 999999 "anything" "")"
# The GONE / UNVERIFIABLE distinction must hold regardless of the shell's
# error wording ("No such process" in bash vs "no such process" in zsh).
is "classify_liveness => GONE for a dead pid (shell-independent)" "GONE" \
   "$(classify_liveness 999999)"
# A pid that EXISTS but cannot be signalled must never be classified GONE.
# Use the test's OWN pid, which definitely exists. (A synthetic pid that does
# not exist would legitimately classify as GONE and would be a broken test.)
SPARE_PID="$SELF_PID"
LIVE_CLASS2="$(classify_liveness "$SPARE_PID")"
if [ "$LIVE_CLASS2" = "GONE" ]; then
	bad "a live pid is never classified GONE" "ALIVE or UNVERIFIABLE" "GONE"
else
	ok "a live pid is never classified GONE ($LIVE_CLASS2)"
fi
# A synthetic pid that does not exist MUST classify as GONE.
if [ "$(classify_liveness 999999)" = "GONE" ]; then
	ok "a non-existent pid classifies as GONE"
else
	bad "a non-existent pid classifies as GONE" "GONE" "$(classify_liveness 999999)"
fi

# ---------------------------------------------------------------------------
echo "--- R4: numeric ownership comparison ---"
SELF_UID_NUM="$(ps_uid_of "$SELF_PID")"
CURRENT_UID_NUM="$(id -u)"
is "ps uid column equals id -u" "$CURRENT_UID_NUM" "$SELF_UID_NUM"
if [ -n "$SELF_UID_NUM" ] && [ "$SELF_UID_NUM" -eq "$CURRENT_UID_NUM" ] 2>/dev/null; then
	ok "numeric uid comparison works (not a username substring match)"
else
	bad "numeric uid comparison works" "numeric equality" "mismatch ($SELF_UID_NUM vs $CURRENT_UID_NUM)"
fi

# ---------------------------------------------------------------------------
# R3 deadline contract is verified by the OPERATOR harness only.
#
# This default regression suite is PROCESS-FREE. The earlier live deadline
# test spawned `/bin/sleep 300`; in a sandbox that denies signalling, the
# target became an orphan (PPID=1), so the suite was not process-free and
# violated the zero ACT-owned residual requirement. The live deadline test is
# therefore an operator-only gate and is intentionally absent here.
#
# The process-free contract asserted here is that the supervisor source exists,
# is readable, and is invoked by the harness with a bounded deadline. It does
# not execute any target.
# ---------------------------------------------------------------------------
SUP_FILE="$HERE/$RECON02_SUPERVISOR"
if [ -r "$SUP_FILE" ] && [ -r "$RECON02_PY" ]; then
	ok "deadline supervisor and python3 are present"
else
	bad "deadline supervisor and python3 are present" "present" "missing"
fi
if grep -q 'run_with_deadline "\$id" "\$deadline"' "$HERE/operator-probes.sh"; then
	ok "operator harness invokes run_with_deadline for each probe"
else
	bad "operator harness invokes run_with_deadline for each probe" "run_with_deadline invocation" "not found"
fi
if grep -q 'DEADLINE_EXCEEDED' "$SUP_FILE"; then
	ok "deadline supervisor enforces the EXIT_DEADLINE_EXCEEDED contract"
else
	bad "deadline supervisor enforces the EXIT_DEADLINE_EXCEEDED contract" "EXIT_DEADLINE_EXCEEDED" "not found"
fi
if grep -qE '^[[:space:]]*run_with_deadline[^|;]*sleep[[:space:]]+300' "$HERE/harness-regression-test.sh"; then
	bad "default regression suite contains no live sleep 300 target" "absent" "present"
else
	ok "default regression suite contains no live sleep 300 target"
fi

# ---------------------------------------------------------------------------
# R7: anchored foreign-pid extraction (greedy-pid regression).
#
# The P0 run produced an INVALID probe-D measurement because the marker was
# parsed with a GREEDY sed that captured the "pid=" inside "ppid=" and
# therefore signalled the deadline SUPERVISOR instead of the foreign Node
# process. The EPERM was real but proved nothing about the intended target.
#
# These tests pin the anchored extraction and pin the two ownership gates
# that make that failure impossible to reproduce silently.
# ---------------------------------------------------------------------------
READY_LINE='FOREIGN_READY pid=7283 ppid=7264 marker=CLINEMM_RECON01_FOREIGN_CONTROL'
is "extract_foreign_pid returns the TARGET pid, not the supervisor pid" \
   "7283" "$(extract_foreign_pid "$READY_LINE")"

# The greedy form that caused the invalid measurement, asserted directly so
# the regression can never be reintroduced unnoticed.
GREEDY_PID="$(printf '%s\n' "$READY_LINE" | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p')"
if [ "$GREEDY_PID" = "7283" ]; then
	bad "the greedy parse is known to be wrong (it yields the supervisor pid)" \
	    "7264" "$GREEDY_PID"
else
	ok "the greedy parse is known to be wrong (it yields $GREEDY_PID, not 7283)"
fi

# A line that does not carry the marker shape must yield NOTHING, never a
# partially-matched number.
is "extract_foreign_pid ignores a line without the marker" \
   "" "$(extract_foreign_pid 'FOREIGN_READY pid=7283 ppid=7264 marker=SOMETHING_ELSE')"
is "extract_foreign_pid ignores an unrelated line" \
   "" "$(extract_foreign_pid 'deadline-supervisor.py: TARGET_EXITED pid=7283')"
is "extract_foreign_pid ignores an empty line" \
   "" "$(extract_foreign_pid '')"

# The harness pipes the marker line on STDIN. The helper MUST accept that
# form as well as the argument form, otherwise the anchored parse silently
# yields nothing and probe D would abort for the wrong reason.
is "extract_foreign_pid reads the marker from stdin" \
   "7283" "$(printf '%s\n' "$READY_LINE" | extract_foreign_pid)"
is "extract_foreign_pid reads the marker from stdin (grep pipeline form)" \
   "7283" "$(printf '%s\n' "$READY_LINE" | grep -m1 'FOREIGN_READY' | extract_foreign_pid)"

# Ownership: the extracted pid must be a CHILD of the supervisor.
is "ownership: a child of the supervisor is OWNED" \
   "OWNED" "$(classify_foreign_ownership 7283 7264 7264)"
is "ownership: the supervisor itself is rejected" \
   "IS_SUPERVISOR" "$(classify_foreign_ownership 7264 7264 7264)"
is "ownership: an unrelated process is rejected" \
   "NOT_CHILD" "$(classify_foreign_ownership 7283 7264 999)"
is "ownership: an unobservable ppid is UNKNOWN" \
   "UNKNOWN" "$(classify_foreign_ownership 7283 7264 '')"

# argv identity: the target must BE the Node process running the fixture.
# The supervisor's argv merely MENTIONS the fixture in a trailing argument.
FIXTURE="/path/to/foreign.mjs"
SUP_ARGV="/Library/Developer/CommandLineTools/Python3.framework/Python deadline-supervisor.py 15 env TMPDIR=/private/tmp/x /opt/homebrew/bin/node $FIXTURE"
NODE_ARGV="/opt/homebrew/bin/node $FIXTURE"
is "argv: the supervisor's argv is NOT the fixture node process" \
   "NOT_NODE" "$(classify_foreign_argv "$SUP_ARGV" "/opt/homebrew/bin/node" "$FIXTURE")"
is "argv: the real node fixture process is accepted" \
   "FIXTURE_NODE" "$(classify_foreign_argv "$NODE_ARGV" "/opt/homebrew/bin/node" "$FIXTURE")"
is "argv: a node process running another script is rejected" \
   "NOT_FIXTURE" "$(classify_foreign_argv "/opt/homebrew/bin/node /path/to/other.mjs" "/opt/homebrew/bin/node" "$FIXTURE")"
is "argv: an empty argv is rejected" \
   "NOT_NODE" "$(classify_foreign_argv "" "/opt/homebrew/bin/node" "$FIXTURE")"
# The node executable may be rendered by ps as the resolved Cellar path while
# the harness resolved the symlink; the basename comparison must accept it.
is "argv: a resolved node path is accepted against the symlink path" \
   "FIXTURE_NODE" "$(classify_foreign_argv "/opt/homebrew/Cellar/node/26.0.0/bin/node $FIXTURE" "/opt/homebrew/bin/node" "$FIXTURE")"

# The operator harness must not contain the greedy parse any more, and it
# must use the anchored helper plus the ownership gate.
if grep -q 's/\.\*pid=' "$HERE/operator-probes.sh"; then
	bad "operator harness contains no greedy pid parse" "absent" "present"
else
	ok "operator harness contains no greedy pid parse"
fi
if grep -q 'extract_foreign_pid' "$HERE/operator-probes.sh"; then
	ok "operator harness uses the anchored extract_foreign_pid helper"
else
	bad "operator harness uses the anchored extract_foreign_pid helper" "present" "absent"
fi
if grep -q 'classify_foreign_ownership' "$HERE/operator-probes.sh"; then
	ok "operator harness enforces the foreign-ownership gate"
else
	bad "operator harness enforces the foreign-ownership gate" "present" "absent"
fi
if grep -q 'classify_foreign_argv' "$HERE/operator-probes.sh"; then
	ok "operator harness enforces the node-argv gate"
else
	bad "operator harness enforces the node-argv gate" "present" "absent"
fi

# ---------------------------------------------------------------------------
# R6 wiring: the operator harness MUST NOT let the environment manufacture
# the production-context gate. The value is hard-coded in the harness.
# ---------------------------------------------------------------------------
if grep -q '^PRODUCTION_CONTEXT_EVIDENCE="NO"$' "$HERE/operator-probes.sh"; then
	ok "operator harness hard-codes PRODUCTION_CONTEXT_EVIDENCE=NO"
else
	bad "operator harness hard-codes PRODUCTION_CONTEXT_EVIDENCE=NO" "PRODUCTION_CONTEXT_EVIDENCE=\"NO\"" "not found"
fi
if grep -q 'RECON02_PRODUCTION_CONTEXT_EVIDENCE' "$HERE/operator-probes.sh"; then
	bad "operator harness has no production-evidence environment override" "absent" "present"
else
	ok "operator harness has no production-evidence environment override"
fi

# ---------------------------------------------------------------------------
echo
echo "=== RESULT: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -ne 0 ]; then
	echo "HARNESS_REGRESSION_TESTS_FAILED"
	exit 1
fi
echo "HARNESS_REGRESSION_TESTS_PASSED"
exit 0
