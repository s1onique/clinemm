#!/usr/bin/env node
/**
 * Foreign-signal attempt for the permanent same-sandbox repair.
 * Marker: CLINEMM_REPAIR01_FOREIGN_SIGNAL_ATTEMPT
 *
 * This program MUST be executed through the installed ClineMM Background Exec
 * path so that it inherits the exact production Seatbelt profile.  It attempts
 * exactly one SIGTERM against the verified foreign pid and reports the result.
 * It never signals a descendant and never sweeps a process group.
 *
 * SAFETY CORRECTION (2026-11-05, bounded P0 follow-up)
 * -----------------------------------------------------
 * The previous revision accepted a bare numeric PID and immediately called
 * `process.kill(foreignPid, "SIGTERM")`.  The foreign target has a finite
 * 12-second lifetime, so between the operator recording the PID and this
 * fixture running, the target may have EXITED and its PID may have been
 * REUSED by an unrelated process.  A stale PID would then signal an
 * unrelated process.
 *
 * This revision therefore:
 *
 *   1. REQUIRES the expected target identity (argv, uid, process start
 *      identity) to be supplied by the operator.  Missing identity is a
 *      hard block, not a default.
 *   2. RE-VERIFIES that identity IMMEDIATELY before the signaling attempt
 *      via the shared fail-closed `target-identity.mjs` gate.
 *   3. Performs a NON-MUTATING signal-zero authorization check first
 *      (`kill(pid, 0)`).  Signal zero delivers no signal; it only reports
 *      whether the signal would be permitted.  This is labelled
 *      `authorizationCheck` in the result so it is never confused with a
 *      delivery attempt.
 *   4. Emits `HALT_UNSAFE_FIXTURE` and signals NOTHING when any identity
 *      field is missing, unreadable, or changed.
 *
 * Usage:
 *   node foreign-signal-attempt.mjs <foreignPid> <foreignLogPath> <expectedArgvFile> <expectedUid> <expectedStartIdentityFile>
 *
 * The two "File" arguments are files containing the single expected value.
 * Using files avoids shell-quoting ambiguity in the exact Background Exec
 * command line and keeps the expectation anchored to what the supervisor
 * actually observed at target-start time.
 *
 * ANTI-CONTROL MODE (process-free)
 * ---------------------------------
 * `--anti-control <scenario>` runs this fixture against a SYNTHETIC process
 * table.  It never observes or signals a real process: the observation is
 * injected and the signal sink is a recorder.  This is how the
 * stale-PID / missing-identity / expired-target / changed-argv /
 * unreadable-metadata scenarios are asserted without risk.  The production
 * path (no `--anti-control`) is unaffected.
 *
 * Output:
 *   FOREIGN_SIGNAL_RESULT_JSON=<json>   (authoritative)
 */
import { readFileSync } from "node:fs"
import {
	authorizeDestructiveSignal,
	probeSignalZero,
	IDENTITY_MARKER,
} from "./target-identity.mjs"
import { ANTI_CONTROL_SCENARIOS, buildAntiControl } from "./anti-control-scenarios.mjs"

const MARKER = "CLINEMM_REPAIR01_FOREIGN_SIGNAL_ATTEMPT"

function safeRead(path) {
	try {
		return readFileSync(path, "utf8")
	} catch {
		return null
	}
}

function readSingleLine(path) {
	const raw = safeRead(path)
	if (raw === null) return null
	const trimmed = raw.trim()
	return trimmed.length > 0 ? trimmed : null
}

const foreignPid = Number.parseInt(process.argv[2] ?? "", 10)
const logPath = process.argv[3]
const expectedArgvPath = process.argv[4]
const expectedUid = process.argv[5]
const expectedStartIdentityPath = process.argv[6]
const antiControlName = (() => {
	const index = process.argv.indexOf("--anti-control")
	return index >= 0 ? process.argv[index + 1] : null
})()
const isAntiControl = antiControlName !== null

const result = {
	marker: MARKER,
	identityModule: IDENTITY_MARKER,
	mode: isAntiControl ? "anti-control" : "production",
	antiControlScenario: antiControlName,
	parentPid: process.pid,
	parentPpid: process.ppid,
	foreignPid: Number.isInteger(foreignPid) ? foreignPid : null,
	foreignPidSource: "operator-supplied + identity re-verified at signal time",
	expectedIdentity: { argv: null, uid: null, startIdentity: null },
	identityObservation: null,
	authorizationCheck: null,
	// P1 CONTRACT ADJUSTMENT: a separately labelled NON-DELIVERY authorization
	// denial.  Null unless the signal-zero probe was denied with EPERM, in
	// which case NO signal was attempted at all.
	authorizationDenial: null,
	signalAttempt: null,
	signalErrno: null,
	signalDelivered: false,
	destructiveSignalsIssued: [],
	halt: null,
	haltReason: null,
	foreignAliveBefore: null,
	foreignAliveAfter: null,
	foreignReceivedSIGTERM: null,
	foreignSignalLogTail: null,
}

function emitAndExit(code) {
	console.log(`FOREIGN_SIGNAL_RESULT_JSON=${JSON.stringify(result)}`)
	process.exit(code)
}

/**
 * P1 CONTRACT ADJUSTMENT (bounded, 2026-11-05).
 *
 * The runbook previously required `signalAttempt.ok == false` with errno
 * `EPERM`.  That contract misrepresented what the fixture does: when the
 * preliminary signal-zero probe returns EPERM, the gate REFUSES to attempt
 * SIGTERM at all.  No SIGTERM is ever issued, so there is no "attempted
 * SIGTERM that returned EPERM" to report.
 *
 * The authorization denial is therefore reported under its OWN, separately
 * labelled field, which is explicitly a NON-DELIVERY result:
 *
 *   authorizationDenial = {
 *     outcome:         "AUTHORIZATION_DENIED_EPERM",
 *     source:          "kill(pid, 0) — non-delivery authorization probe",
 *     deliversSignal:  false,
 *     signalAttempted: false,
 *     errnoCode:       "EPERM",
 *   }
 *
 * `signalAttempt` remains `ok:false, skipped:true` and carries NO errno,
 * because no signal was attempted.  The adjudication contract accepts EITHER
 * of two mutually exclusive shapes, and requires that the reported shape
 * matches what actually happened:
 *
 *   (a) an ATTEMPTED delivery  -> signalAttempt.ok == false AND
 *                                   signalAttempt.errnoCode == "EPERM" AND
 *                                   signalAttempt.skipped == false
 *   (b) a NON-DELIVERY denial  -> authorizationDenial.outcome ==
 *                                   "AUTHORIZATION_DENIED_EPERM" AND
 *                                   authorizationDenial.deliversSignal ==
 *                                   false AND
 *                                   signalAttempt.skipped == true AND
 *                                   signalAttempt.errnoCode == null
 *
 * Shape (b) is the SAFE behaviour and is the expected result whenever the
 * signal-zero probe is denied before the attempt.  Shape (a) is only
 * legitimate if the SIGTERM was really issued and really returned EPERM.
 * Reporting (b) as (a) is a misrepresentation and is a FAILURE.
 */
function applyAuthorizationDenial(target, reason) {
	if (reason === "target-unsignalable:EPERM") {
		target.authorizationDenial = {
			outcome: "AUTHORIZATION_DENIED_EPERM",
			source: "kill(pid, 0) — non-delivery authorization probe",
			deliversSignal: false,
			signalAttempted: false,
			errnoCode: "EPERM",
			reason,
		}
	}
}

// ---------------------------------------------------------------------------
// ANTI-CONTROL MODE — process-free.  No real process is observed or signalled.
// ---------------------------------------------------------------------------
if (isAntiControl) {
	let control
	try {
		control = buildAntiControl(antiControlName)
	} catch (error) {
		result.error = error?.message ?? "unknown anti-control scenario"
		emitAndExit(2)
	}
	result.antiControlDescription = control.scenario.description
	result.expectedIdentity = { ...control.expected }
	result.foreignPid = control.observe().pid

	// The gate under test, with the synthetic observation injected.
	const authorization = authorizeDestructiveSignal(result.foreignPid, control.expected, {
		observe: control.observe,
	})
	result.identityObservation = authorization.observed
	result.authorizationCheck = {
		method: "synthetic kill(pid, 0) — non-delivery authorization probe",
		deliversSignal: false,
		state: authorization.observed.liveness.state,
		errnoCode: authorization.observed.liveness.errnoCode,
	}
	result.signalAllowed = authorization.allowed
	result.haltReason = authorization.reason

	if (!authorization.allowed) {
		result.halt = "HALT_UNSAFE_FIXTURE"
		result.signalAttempt = { signal: "SIGTERM", target: "foreign-pid", ok: false, skipped: true }
		// P1 CONTRACT ADJUSTMENT: label the non-delivery authorization denial
		// with the same shape the production path emits.
		applyAuthorizationDenial(result, authorization.reason)
	} else {
		// The sink RECORDS the attempt; it never delivers a real signal.
		control.signalRecorder.deliver(result.foreignPid, "SIGTERM")
		result.signalAttempt = { signal: "SIGTERM", target: "foreign-pid", ok: true, skipped: false }
		result.signalDelivered = true
	}
	result.destructiveSignalsIssued = control.signalRecorder.calls
	result.antiControlExpectation = control.scenario.expect
	emitAndExit(0)
}

// ---------------------------------------------------------------------------
// PRODUCTION MODE
// ---------------------------------------------------------------------------
if (!Number.isInteger(foreignPid) || foreignPid <= 1) {
	result.error = "invalid-foreign-pid"
	emitAndExit(2)
}

if (!logPath || !expectedArgvPath || !expectedUid || !expectedStartIdentityPath) {
	result.error = "invalid-foreign-pid-or-identity-arguments"
	emitAndExit(2)
}

const expectedArgv = readSingleLine(expectedArgvPath)
const expectedStartIdentity = readSingleLine(expectedStartIdentityPath)
const expectedUidValue = /^\d+$/.test(expectedUid) ? expectedUid : null

result.expectedIdentity = {
	argv: expectedArgv,
	uid: expectedUidValue,
	startIdentity: expectedStartIdentity,
}

// The expected identity is MANDATORY.  Without it we cannot distinguish the
// intended target from a reused PID, so we refuse before touching any signal.
if (!expectedArgv || !expectedUidValue || !expectedStartIdentity) {
	result.halt = "HALT_UNSAFE_FIXTURE"
	result.haltReason = "expected-identity-missing"
	result.signalAttempt = { signal: "SIGTERM", target: "foreign-pid", ok: false, skipped: true }
	emitAndExit(2)
}

const before = safeRead(logPath)
result.foreignAliveBefore = probeSignalZero(foreignPid).state === "alive"

// The single fail-closed gate.  Identity is re-verified immediately before
// any signaling attempt; a mismatch or unreadable field blocks the signal.
const authorization = authorizeDestructiveSignal(foreignPid, {
	argv: expectedArgv,
	uid: expectedUidValue,
	startIdentity: expectedStartIdentity,
})
result.identityObservation = authorization.observed

// Non-mutating authorization probe.  `kill(pid, 0)` delivers NO signal; it
// reports whether signaling would be permitted.  Labelled explicitly so it
// is never read as a delivery attempt.
const zeroProbe = probeSignalZero(foreignPid)
result.authorizationCheck = {
	method: "kill(pid, 0) — non-delivery authorization probe",
	deliversSignal: false,
	state: zeroProbe.state,
	errnoCode: zeroProbe.errnoCode,
}

if (!authorization.allowed) {
	result.halt = "HALT_UNSAFE_FIXTURE"
	result.haltReason = authorization.reason
	result.identityMismatchReasons = authorization.mismatchReasons
	// NOTHING is signalled on the halt path.
	result.signalAttempt = { signal: "SIGTERM", target: "foreign-pid", ok: false, skipped: true }
	// P1 CONTRACT ADJUSTMENT: the non-delivery authorization denial is
	// labelled separately, so it is never misread as an attempted SIGTERM
	// that returned EPERM.  See `applyAuthorizationDenial`.
	applyAuthorizationDenial(result, authorization.reason)
	emitAndExit(3)
}

try {
	process.kill(foreignPid, "SIGTERM")
	result.signalAttempt = { signal: "SIGTERM", target: "foreign-pid", ok: true, skipped: false }
	result.signalDelivered = true
	result.destructiveSignalsIssued = [{ pid: foreignPid, signal: "SIGTERM" }]
} catch (error) {
	result.signalAttempt = {
		signal: "SIGTERM",
		target: "foreign-pid",
		ok: false,
		skipped: false,
		errnoCode: error?.code ?? null,
		errnoMessage: error?.message ?? null,
		syscall: error?.syscall ?? null,
	}
	result.signalErrno = error?.code ?? null
}

await new Promise((resolve) => setTimeout(resolve, 500))
result.foreignAliveAfter = probeSignalZero(foreignPid).state === "alive"
const after = safeRead(logPath)
result.foreignReceivedSIGTERM =
	after !== null &&
	before !== null &&
	after.includes("FOREIGN_GOT_SIGTERM") &&
	!before.includes("FOREIGN_GOT_SIGTERM")
result.foreignSignalLogTail = after?.slice(-400) ?? null
emitAndExit(0)
