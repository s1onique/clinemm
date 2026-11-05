#!/bin/bash
# =============================================================================
# ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02
# harness-lib.sh — pure, process-free helpers shared by operator-probes.sh
# and by the process-free regression tests.
#
# DESIGN RULES ENCODED HERE (P0 HARNESS CORRECTION):
#   R1  Probe D FAILS CLOSED. A successful foreign SIGTERM, an ESRCH, a
#       missing evidence payload, or ANY unexpected errno is a hard failure
#       with a NONZERO exit status — never a printed warning.
#   R2  Process identity is established by VERIFIED PID + EXACT executable /
#       argv identity + START IDENTITY (ps lstart). Marker/grep scans over
#       the whole process table are FORBIDDEN as a residual proof, because a
#       marker that never appears in argv cannot observe anything.
#   R3  Every probe has a REAL execution deadline enforced by the kernel
#       (a watchdog that actually kills the process group), not a logging
#       watchdog. There is no unbounded `wait` anywhere.
#   R4  Ownership is compared NUMERICALLY: the `uid=` column from ps must
#       equal `id -u`. A username appearing anywhere in the command line is
#       NOT evidence of ownership.
#   R5  `kill(pid, 0)` returning EPERM means "exists but UNVERIFIABLE" and
#       is NEVER treated as "cleaned up" / "gone".
#   R6  The decision table NEVER selects a production-only repair or a
#       composed architecture from Terminal-only measurements.
#   R7  The foreign pid is extracted from the FOREIGN_READY marker with an
#       ANCHORED expression, and it is proven to be the Node child of the
#       deadline supervisor BEFORE any signal is attempted. A greedy parse
#       that captures the "pid=" inside "ppid=" targets the SUPERVISOR and
#       produces a legitimate-looking EPERM for a process that was never
#       tested. The argv check must additionally prove that argv[0] IS the
#       Node executable running the fixture, not a process that merely
#       mentions the fixture path in a trailing argument.
#
# This file must be SOURCEABLE and must not have side effects when sourced.
# =============================================================================

# ---------------------------------------------------------------------------
# Exit-status vocabulary (single source of truth).
# ---------------------------------------------------------------------------
readonly EXIT_OK=0
readonly EXIT_HALT_BASELINE_INVALID=2
readonly EXIT_HALT_UNSAFE_FIXTURE=2
readonly EXIT_HALT_UNSAFE_SIGNAL_SCOPE=4
readonly EXIT_PROBE_INVALID=3
readonly EXIT_DEADLINE_EXCEEDED=5

# ---------------------------------------------------------------------------
# JSON field extraction (process-free; operates on a string).
# json_bool <json> <key>  -> "true" | "false" | "" (absent or not a JSON boolean)
# json_str  <json> <key>  -> string value, "" for JSON null, "" if absent
# json_num  <json> <key>  -> digits, "" if absent
#
# json_bool_nested <json> <object-key> <key>
#   -> "true" | "false" | "" (absent, null, or not a JSON boolean)
#
# The nested form is required for fixture fields such as
# signalAttempt.ok: the bare "ok" key would otherwise match an unrelated
# top-level field and could silently classify a failed signal attempt as
# successful.
# ---------------------------------------------------------------------------
json_bool() {
	printf '%s' "$1" | grep -o "\"$2\":\(true\|false\)" | head -1 | cut -d: -f2
}
json_bool_nested() {
	local json="$1" object_key="$2" key="$3"
	local object
	object="$(printf '%s' "$json" | grep -o "\"$object_key\":{[^}]*}" | head -1)"
	[ -n "$object" ] || return 0
	json_bool "$object" "$key"
}
json_str() {
	printf '%s' "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}
json_num() {
	printf '%s' "$1" | grep -o "\"$2\":[0-9]*" | head -1 | cut -d: -f2
}

# ---------------------------------------------------------------------------
# R4: numeric ownership comparison.
# ps_uid_of <pid> -> the numeric uid column, or "" if the pid is gone.
# ---------------------------------------------------------------------------
ps_uid_of() {
	[ -z "${1:-}" ] && return 0
	ps -o uid= -p "$1" 2>/dev/null | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# ps_ppid_of <pid> -> the numeric parent-pid column, or "" if the pid is gone.
#
# Used to prove that a controlled foreign target is DIRECTLY owned by the
# expected supervisor. Without this check a probe can signal the supervisor
# and believe it signalled the target.
# ---------------------------------------------------------------------------
ps_ppid_of() {
	[ -z "${1:-}" ] && return 0
	ps -o ppid= -p "$1" 2>/dev/null | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# R7: anchored foreign-pid extraction from the FOREIGN_READY marker.
#
# extract_foreign_pid [line] -> the pid, or "" if the line does not
# match the expected marker shape exactly.
#
# The marker line may be supplied as an ARGUMENT or on STDIN, so the helper
# can be used either as
#     extract_foreign_pid "$line"
# or as
#     grep -m1 FOREIGN_READY "$log" | extract_foreign_pid
# Both forms are used by the harness and by the regression suite.
#
# WHY THIS IS ANCHORED (P1 harness correction):
#   The fixture prints
#       FOREIGN_READY pid=<n> ppid=<m> marker=CLINEMM_RECON01_FOREIGN_CONTROL
#   A GREEDY sed such as
#       sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p'
#   matches the LAST "pid=" substring on the line, which is the "pid=" inside
#   "ppid=" — so it yields the SUPERVISOR's pid instead of the target's pid.
#   Signalling the supervisor then produces a legitimate-looking EPERM while
#   the real foreign process was never targeted. The measurement is invalid
#   and MUST NOT be reported as "foreign isolation proven".
#
#   The anchored form binds the pid to the field that actually carries it.
# ---------------------------------------------------------------------------
readonly RECON02_FOREIGN_MARKER="CLINEMM_RECON01_FOREIGN_CONTROL"

extract_foreign_pid() {
	local line="${1:-}"
	if [ -z "$line" ]; then
		# No argument: consume exactly one line from stdin.
		IFS= read -r line || true
	fi
	[ -n "$line" ] || return 0
	printf '%s\n' "$line" | sed -nE \
		"s/^FOREIGN_READY pid=([0-9]+) ppid=[0-9]+ marker=${RECON02_FOREIGN_MARKER}\$/\\1/p" |
		head -n1
}

# ---------------------------------------------------------------------------
# R7: the pid reported by the marker must be the CHILD of the supervisor.
#
# classify_foreign_ownership <foreign_pid> <supervisor_pid> <observed_ppid>
#
# Prints one of:
#   OWNED        foreign_pid != supervisor_pid AND observed_ppid == supervisor_pid
#   IS_SUPERVISOR foreign_pid == supervisor_pid (the parse regressed)
#   NOT_CHILD    observed_ppid != supervisor_pid
#   UNKNOWN      insufficient information
#
# The caller MUST refuse to signal on anything other than OWNED.
# ---------------------------------------------------------------------------
classify_foreign_ownership() {
	local foreign_pid="${1:-}" sup_pid="${2:-}" observed_ppid="${3:-}"

	if [ -z "$foreign_pid" ] || [ -z "$sup_pid" ]; then
		echo "UNKNOWN"
		return 0
	fi
	if [ "$foreign_pid" = "$sup_pid" ]; then
		echo "IS_SUPERVISOR"
		return 0
	fi
	if [ -z "$observed_ppid" ]; then
		echo "UNKNOWN"
		return 0
	fi
	if [ "$observed_ppid" = "$sup_pid" ]; then
		echo "OWNED"
		return 0
	fi
	echo "NOT_CHILD"
}

# ---------------------------------------------------------------------------
# R7: the foreign target must be the Node process that RUNS the fixture.
#
# classify_foreign_argv <argv> <node_executable> <fixture_path>
#
# The argv of the real foreign target begins with the Node executable and
# carries the fixture path as a script argument:
#
#     /opt/homebrew/bin/node /path/to/foreign.mjs
#
# The argv of the DEADLINE SUPERVISOR merely mentions both, as trailing
# arguments:
#
#     .../Python .../deadline-supervisor.py 15 env TMPDIR=... \
#         /opt/homebrew/bin/node /path/to/foreign.mjs
#
# A substring test ("the fixture path appears anywhere") therefore accepts
# the supervisor. This check requires the Node executable to be the argv[0]
# and the fixture to be a following argument.
#
# Prints one of:
#   FIXTURE_NODE  the argv is the expected "node <fixture>" shape
#   NOT_NODE      argv[0] is not the Node executable
#   NOT_FIXTURE   the fixture path is not an argument of that Node process
# ---------------------------------------------------------------------------
classify_foreign_argv() {
	local argv="${1:-}" node_exe="${2:-}" fixture="${3:-}"
	local first rest

	[ -n "$argv" ] || { echo "NOT_NODE"; return 0; }
	[ -n "$node_exe" ] || { echo "NOT_NODE"; return 0; }
	[ -n "$fixture" ] || { echo "NOT_FIXTURE"; return 0; }

	# argv[0] must be the node executable. ps renders the resolved path, so
	# compare the BASENAME as well as the full path.
	first="${argv%% *}"
	case "$first" in
		"$node_exe") : ;;
		*)
			local first_base="${first##*/}"
			local node_base="${node_exe##*/}"
			case "$node_base" in
				"") echo "NOT_NODE"; return 0 ;;
			esac
			case "$first_base" in
				"$node_base") : ;;
				*) echo "NOT_NODE"; return 0 ;;
			esac
			;;
	esac

	# The fixture must be a SCRIPT ARGUMENT of that node process, i.e. it
	# must appear after argv[0] as a standalone word.
	rest="${argv#* }"
	case " $rest " in
		*" $fixture "*) echo "FIXTURE_NODE"; return 0 ;;
	esac
	echo "NOT_FIXTURE"
}

# ---------------------------------------------------------------------------
# R5: liveness classification that never mistakes EPERM for "gone".
#
# classify_liveness <pid> -> one of:
#   "GONE"          the pid does not exist (kill(pid,0) -> ESRCH)
#   "ALIVE"         the pid exists and we may signal it
#   "UNVERIFIABLE"  the pid exists but we may NOT signal it (EPERM).
#                    This is NEVER reported as cleaned up.
#   "UNKNOWN"       kill(pid,0) failed for some other reason.
# ---------------------------------------------------------------------------
classify_liveness() {
	local pid="${1:-}" out rc lowered
	[ -z "$pid" ] && { echo "NO_PID"; return 0; }
	out="$(kill -0 "$pid" 2>&1)"
	rc=$?
	if [ "$rc" -eq 0 ]; then
		echo "ALIVE"
		return 0
	fi
	# Normalise the message: bash prints "No such process", zsh prints
	# "no such process", and the sandbox may print "Operation not permitted".
	lowered="$(printf '%s' "$out" | tr '[:upper:]' '[:lower:]')"
	case "$lowered" in
		*"no such process"*|*"not exist"*) echo "GONE"; return 0 ;;
		*"operation not permitted"*|*"not permitted"*) echo "UNVERIFIABLE"; return 0 ;;
	esac
	# Authoritative fallback: ask ps whether the pid exists at all. ps reads
	# the process table without requiring signal permission, so it correctly
	# distinguishes "gone" from "exists but unsignalable".
	if [ -n "$(ps_argv_of "$pid")" ]; then
		echo "UNVERIFIABLE"
		return 0
	fi
	echo "GONE"
}

# ---------------------------------------------------------------------------
# R2: start identity. Two observations of the SAME pid must agree on lstart
# before the pid may be treated as the same process (PID-reuse resistance).
# ---------------------------------------------------------------------------
ps_lstart_of() {
	[ -z "${1:-}" ] && return 0
	ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//'
}

# ps_argv_of <pid> -> the full command/argv string, or "" if gone.
ps_argv_of() {
	[ -z "${1:-}" ] && return 0
	ps -o command= -p "$1" 2>/dev/null | sed 's/^ *//'
}

# verify_process_identity <pid> <expected_argv_substring> <expected_lstart>
#
# Prints one of:
#   VERIFIED          pid exists, argv contains the expected substring AND
#                     lstart matches the recorded start identity
#   IDENTITY_MISMATCH pid exists but argv/lstart do not match
#   GONE              pid does not exist
#   UNVERIFIABLE      pid exists but we may not inspect it (EPERM)
#
# The caller must never treat anything other than VERIFIED or GONE as
# "the controlled process is gone".
verify_process_identity() {
	local pid="${1:-}" expect_argv="${2:-}" expect_lstart="${3:-}"
	local live argv lstart

	live="$(classify_liveness "$pid")"
	case "$live" in
		GONE)    echo "GONE"; return 0 ;;
		UNKNOWN) echo "UNKNOWN"; return 0 ;;
		UNVERIFIABLE)
			# R5: the pid EXISTS but we may not signal it. It is NOT gone.
			# We may still OBSERVE it through ps; if ps can read its argv
			# and lstart, the identity can still be established for
			# observation purposes. What we must not do is conclude
			# "cleaned up". We report UNVERIFIABLE unless ps can confirm
			# the identity, in which case we report the observation but
			# STILL do not report GONE.
			;;
	esac

	argv="$(ps_argv_of "$pid")"
	lstart="$(ps_lstart_of "$pid")"

	if [ -z "$argv" ] || [ -z "$lstart" ]; then
		echo "UNVERIFIABLE"
		return 0
	fi
	if [ -n "$expect_argv" ]; then
		case "$argv" in
			*"$expect_argv"*) : ;;
			*) echo "IDENTITY_MISMATCH"; return 0 ;;
		esac
	fi
	if [ -n "$expect_lstart" ] && [ "$lstart" != "$expect_lstart" ]; then
		echo "IDENTITY_MISMATCH"
		return 0
	fi
	if [ "$live" = "UNVERIFIABLE" ]; then
		# Identity confirmed, but the process is not signalable from here.
		echo "UNVERIFIABLE"
		return 0
	fi
	echo "VERIFIED"
}

# ---------------------------------------------------------------------------
# R2/R5: assert that a controlled pid is gone.
# assert_gone <pid> <expected_argv_substring> <expected_lstart>
# Returns 0 only when the pid is genuinely GONE.
# Prints the classification to stdout for the caller's evidence log.
# ---------------------------------------------------------------------------
assert_gone() {
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

# ---------------------------------------------------------------------------
# R1: probe-D verdict classification. Pure function over the parsed fields.
#
# classify_probe_d <signal_ok> <signal_errno> <foreign_alive_after>
#                  <foreign_received_sigterm> <evidence_present>
#
# Every input must be present and correctly typed. Only the exact JSON
# booleans "true"/"false" are accepted for signal_ok, foreign_alive_after,
# and foreign_received_sigterm. Empty or unknown values fail closed as
# INVALID_EVIDENCE.
#
# Prints one of:
#   DENIED_EXPECTED   signal denied, errno EPERM, target survived, no SIGTERM
#   UNSAFE_SIGNAL      the candidate signaled the foreign process
#   INVALID_ESRCH      ESRCH — the target had already exited (race)
#   INVALID_ERRNO      an errno other than EPERM was observed
#   INVALID_ALIVE      the signal was denied but the target did not survive
#   INVALID_EVIDENCE   the evidence payload is missing, incomplete, or invalid
#   INVALID_RECEIVED   the foreign target reported receiving SIGTERM
# ---------------------------------------------------------------------------
classify_probe_d() {
	local ok="$1" err="$2" alive_after="$3" received="$4" evidence="$5"

	if [ "$evidence" != "present" ]; then
		echo "INVALID_EVIDENCE"
		return 0
	fi
	case "$ok" in
		true|false) : ;;
		*) echo "INVALID_EVIDENCE"; return 0 ;;
	esac
	case "$alive_after" in
		true|false) : ;;
		*) echo "INVALID_EVIDENCE"; return 0 ;;
	esac
	case "$received" in
		true|false) : ;;
		*) echo "INVALID_EVIDENCE"; return 0 ;;
	esac
	if [ "$ok" = "true" ]; then
		echo "UNSAFE_SIGNAL"
		return 0
	fi
	if [ "$err" = "ESRCH" ]; then
		echo "INVALID_ESRCH"
		return 0
	fi
	if [ "$err" != "EPERM" ]; then
		echo "INVALID_ERRNO"
		return 0
	fi
	if [ "$received" = "true" ]; then
		echo "INVALID_RECEIVED"
		return 0
	fi
	if [ "$alive_after" != "true" ]; then
		echo "INVALID_ALIVE"
		return 0
	fi
	echo "DENIED_EXPECTED"
}

# ---------------------------------------------------------------------------
# R1: the probe-D verdict -> exit status mapping.
# probe_d_exit_status <classification>
#   DENIED_EXPECTED -> 0
#   UNSAFE_SIGNAL   -> EXIT_HALT_UNSAFE_SIGNAL_SCOPE
#   everything else -> EXIT_PROBE_INVALID
# ---------------------------------------------------------------------------
probe_d_exit_status() {
	case "$1" in
		DENIED_EXPECTED) echo "$EXIT_OK" ;;
		UNSAFE_SIGNAL)   echo "$EXIT_HALT_UNSAFE_SIGNAL_SCOPE" ;;
		*)               echo "$EXIT_PROBE_INVALID" ;;
	esac
}

# ---------------------------------------------------------------------------
# R6: the causal decision table.
#
# IMPORTANT (R6): the A/B/C/D matrix is measured in an INDEPENDENT TERMINAL.
# A Terminal-only result QUALIFIES the candidate Seatbelt signal rule. It
# CANNOT, by itself, select a production-only repair
# (SELECT_SEATBELT_SIGNAL_REPAIR) nor a composed architecture
# (SELECT_COMPOSED_BOUNDARY_REPAIR / SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY),
# because the inherited VSCodium/Chromium authority is a SEPARATE layer and
# is not exercised by a Terminal run.
#
# classify_decision <A> <B> <C> <D> <production_context_evidence>
#
#   A/B/C/D are one of: SUCCESS | EPERM | ESRCH | INVALID
#   D additionally: DENIED | UNSAFE
#   production_context_evidence is one of: YES | NO
#
# Prints exactly one verdict token.
# ---------------------------------------------------------------------------
classify_decision() {
	local a="$1" b="$2" c="$3" d="$4" prod="$5"

	# ---- Gate 0: the unsandboxed baseline must be valid, always. --------
	if [ "$a" != "SUCCESS" ]; then
		echo "HALT_BASELINE_INVALID"
		return 0
	fi

	# ---- Gate 1: probe D is the mandatory security gate. ---------------
	case "$d" in
		DENIED) : ;;
		UNSAFE) echo "HALT_UNSAFE_SIGNAL_SCOPE"; return 0 ;;
		*)      echo "CAPTURE_INSUFFICIENT"; return 0 ;;
	esac

	# ---- Gate 2: a Terminal-only result cannot select an architecture. --
	if [ "$prod" != "YES" ]; then
		# The candidate rule is QUALIFIED (or shown ineffective) in the
		# Terminal, but the inherited production authority is unobserved.
		echo "READY_FOR_OPERATOR_PROBES"
		return 0
	fi

	# ---- Gate 3: production-context evidence IS present. ---------------
	# Only here may an architecture be selected.
	if [ "$b" = "EPERM" ] && [ "$c" = "SUCCESS" ]; then
		echo "SELECT_SEATBELT_SIGNAL_REPAIR"
		return 0
	fi
	if [ "$b" = "EPERM" ] && [ "$c" = "EPERM" ]; then
		echo "SELECT_COMPOSED_BOUNDARY_REPAIR"
		return 0
	fi
	if [ "$b" = "SUCCESS" ] && [ "$c" = "SUCCESS" ]; then
		echo "SELECT_LAUNCHAGENT_EXECUTION_BOUNDARY"
		return 0
	fi
	echo "CAPTURE_INSUFFICIENT"
}

# ---------------------------------------------------------------------------
# R3: REAL execution deadline.
#
# run_with_deadline <id> <timeout_seconds> <stdout_file> <stderr_file> \
#                   <cmd> [args...]
#
# The command is run under deadline-supervisor.py, which FORKS the target and
# enforces the budget itself. The supervisor:
#   * does NOT exec and does NOT call setsid() — it stays in the harness's
#     own session, so in an unsandboxed Terminal it may signal the target
#     and the target's process group;
#   * exits 137 when the budget expires, so the deadline ALWAYS fires even
#     in a substrate where signalling is denied (the harness can never
#     hang on an unkillable target);
#   * attempts a best-effort SIGKILL of the target and its process group,
#     recording on stderr whether those were permitted.
#
# The harness reaps the supervisor with a BOUNDED poll followed by `wait`
# on an ALREADY-DEAD process (which returns immediately). There is no
# unbounded `wait` anywhere.
#
# Writes:
#   <stdout_file>        target stdout
#   <stderr_file>        target stderr (plus the supervisor's own lines)
#   <stdout_file_without_.stdout>.started_at / .finished_at / .exit_code
#
# The supervisor is resolved relative to this script so the harness works
# from any cwd.
# ---------------------------------------------------------------------------
readonly RECON02_SUPERVISOR="probe-fixtures/deadline-supervisor.py"
readonly RECON02_PY="/usr/bin/python3"

# The directory that CONTAINS this library. When the library is sourced from
# operator-probes.sh, BASH_SOURCE inside a function refers to the LIBRARY,
# not the caller, so the supervisor is resolved relative to the library's
# own directory. The harness also exports RECON02_EVIDENCE_DIR so both
# resolutions agree.
RECON02_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RECON02_LIB_DIR
readonly RECON02_LIB_DIR

run_with_deadline() {
	local id="$1" timeout_s="$2" outf="$3" errf="$4"
	shift 4
	local start end rc sup_pid waited grace_ticks supervisor

	start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

	local sup_dir="${RECON02_EVIDENCE_DIR:-$RECON02_LIB_DIR}"
	supervisor="$sup_dir/$RECON02_SUPERVISOR"
	if [ ! -f "$supervisor" ] || [ ! -r "$RECON02_PY" ]; then
		echo "HALT_UNSAFE_FIXTURE: deadline supervisor ($supervisor) or $RECON02_PY is unavailable"
		echo "$start" > "${outf%.stdout}.started_at"
		date -u +%Y-%m-%dT%H:%M:%SZ > "${outf%.stdout}.finished_at"
		echo "$EXIT_HALT_UNSAFE_FIXTURE" > "${outf%.stdout}.exit_code"
		return 0
	fi

	"$RECON02_PY" "$supervisor" "$timeout_s" "$@" > "$outf" 2> "$errf" &
	sup_pid=$!

	# BOUNDED reap loop: poll for the supervisor to disappear.
	waited=0
	grace_ticks=$(( timeout_s * 10 + 300 ))
	while kill -0 "$sup_pid" 2>/dev/null; do
		if [ "$waited" -ge "$grace_ticks" ]; then
			echo "REAP_GRACE_EXCEEDED supervisor=$sup_pid" >&2
			break
		fi
		sleep 0.1
		waited=$(( waited + 1 ))
	done

	# If the grace ceiling was reached the supervisor may still be alive
	# (it is blocked in a denied-kill reap). Do NOT call an unbounded
	# `wait` on it; record the condition and report it honestly.
	if kill -0 "$sup_pid" 2>/dev/null; then
		echo "SUPERVISOR_STILL_ALIVE pid=$sup_pid — signalling is denied in this substrate" >&2
		# Best effort: the exact pid only. Never a group sweep.
		kill -KILL "$sup_pid" 2>/dev/null || true
		waited=0
		while kill -0 "$sup_pid" 2>/dev/null && [ "$waited" -lt 50 ]; do
			sleep 0.1
			waited=$(( waited + 1 ))
		done
		rc="$EXIT_DEADLINE_EXCEEDED"
	else
		# The supervisor is dead; `wait` returns immediately and reaps it.
		wait "$sup_pid" 2>/dev/null
		rc=$?
	fi

	# 137 == the supervisor's deadline status.
	if [ "$rc" -eq 137 ]; then
		rc="$EXIT_DEADLINE_EXCEEDED"
		echo "[$id] DEADLINE_EXCEEDED after ${timeout_s}s"
	fi

	end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	echo "$start" > "${outf%.stdout}.started_at"
	echo "$end"   > "${outf%.stdout}.finished_at"
	echo "$rc"     > "${outf%.stdout}.exit_code"
	echo "[$id] exit=$rc"
	return 0
}

# ---------------------------------------------------------------------------
# R3/R5: bounded reap of a background pid that the harness owns.
#
# reap_bounded <pid> <timeout_seconds> <expected_argv_substring> <expected_lstart>
#
# Polls for the pid to reach a terminal liveness state within the budget.
# Prints the final classification. Returns 0 only when the pid is GONE.
#
# NOTE: `kill -0` returning EPERM classifies as UNVERIFIABLE, which is NOT
# "cleaned up" and makes this function return nonzero (R5).
# ---------------------------------------------------------------------------
reap_bounded() {
	local pid="${1:-}" timeout_s="${2:-10}" expect_argv="${3:-}" expect_lstart="${4:-}"
	local waited=0 ticks last="UNKNOWN"

	if [ -z "$pid" ]; then
		echo "NO_PID"
		return 0
	fi
	ticks=$(( timeout_s * 10 ))
	while [ "$waited" -lt "$ticks" ]; do
		last="$(verify_process_identity "$pid" "$expect_argv" "$expect_lstart")"
		case "$last" in
			GONE)
				echo "GONE"
				return 0
				;;
			UNVERIFIABLE)
				# Exists but unverifiable: NOT cleaned up. Stop early and
				# report; do not spin, do not treat as success.
				echo "UNVERIFIABLE"
				return 1
				;;
		esac
		sleep 0.1
		waited=$(( waited + 1 ))
	done
	echo "$last"
	return 1
}
