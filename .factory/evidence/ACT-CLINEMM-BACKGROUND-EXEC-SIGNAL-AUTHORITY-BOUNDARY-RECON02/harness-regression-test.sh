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

is "json_bool parses a true value"               "true"  "$(json_bool "$J_OK" ok)"
is "json_bool parses a false value"              "false" "$(json_bool "$J_EPERM" ok)"
is "json_bool parses childReady=true"            "true"  "$(json_bool "$J_OK" childReady)"
is "json_bool parses childStillAliveAfter=false" "false" "$(json_bool "$J_OK" childStillAliveAfter)"
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
echo "--- R3: the deadline mechanism is real and bounded ---"
# The supervisor must exist and be runnable, and a hanging target must hit
# the deadline instead of hanging the harness. This test spawns only the
# supervisor and a short-lived sleep; it signals nothing and waits with a
# hard outer timeout so the regression suite itself can never hang.
SUP_DIR="$HERE"
if [ -r "$SUP_DIR/probe-fixtures/deadline-supervisor.py" ] && [ -r "$RECON02_PY" ]; then
	ok "deadline supervisor and python3 are present"
	DL_OUT="$(mktemp -d)"
	if command -v timeout >/dev/null 2>&1; then
		timeout 30 bash -c "
			HERE='$SUP_DIR'; export RECON02_EVIDENCE_DIR=\"\$HERE\"
			source \"\$HERE/harness-lib.sh\"
			run_with_deadline T 2 '$DL_OUT/t.stdout' '$DL_OUT/t.stderr' /bin/sleep 300
		" > "$DL_OUT/run.log" 2>&1
		RC=$?
		if [ "$RC" -eq 124 ]; then
			bad "a hanging target hits the deadline (no hang)" "timeout before 30s" "TIMED OUT"
		else
			ok "a hanging target hits the deadline (no hang)"
		fi
		DL_CODE="$(cat "$DL_OUT/t.exit_code" 2>/dev/null || echo none)"
		is "hanging target records EXIT_DEADLINE_EXCEEDED" "$EXIT_DEADLINE_EXCEEDED" "$DL_CODE"
	else
		bad "timeout(1) is available for the bounded deadline test" "present" "missing"
	fi
	rm -rf "$DL_OUT"
else
	bad "deadline supervisor and python3 are present" "present" "missing"
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
