#!/usr/bin/env node
/**
 * Bounded PGID-cancellation fixture for the permanent Seatbelt signal repair.
 * Marker: CLINEMM_REPAIR01_PGID_CANCELLATION
 *
 * This fixture is intentionally finite.  Its child has an independent 6-second
 * self-exit deadline, so even a denied group signal cannot create an immortal
 * orphan.  The parent records the exact signal result and distinguishes the
 * three kernel outcomes for `kill(-pgid, 0)`:
 *
 *   - ESRCH: the group is absent;
 *   - EPERM: the group exists but is not signalable (NOT "absent");
 *   - rc=0: the group exists and is signalable.
 *
 * SAFETY CORRECTION (2026-11-05, bounded P0 follow-up)
 * -----------------------------------------------------
 * The previous revision captured the child's start identity and argv at
 * spawn time, then called `process.kill(-pgid, "SIGTERM")` WITHOUT
 * re-verifying that the recorded child still owned that process group.  If
 * the child had already exited unexpectedly, the group id could have been
 * reused and the group-directed signal would have hit an unrelated group.
 *
 * This revision therefore:
 *
 *   1. Re-verifies the child's PID, PROCESS-GROUP id, argv, UID and process
 *      start identity IMMEDIATELY before the group-directed SIGTERM.
 *   2. Emits `HALT_UNSAFE_FIXTURE` and signals NOTHING when any of those
 *      fields is missing, unreadable, or changed.
 *   3. Gives every `ps` observation a FINITE timeout (see
 *      `target-identity.mjs`) so a slow process-table read cannot consume
 *      the child's whole finite lifetime before the measurement.
 *   4. Keeps the identity-checked direct cleanup signal, now routed through
 *      the same shared fail-closed gate.
 *
 * ANTI-CONTROL MODE (process-free)
 * ---------------------------------
 * `--anti-control <scenario>` runs the group-signal decision against a
 * SYNTHETIC process table.  It never spawns, observes, or signals a real
 * process: the observation is injected and the signal sink is a recorder.
 */
import { spawn } from "node:child_process"
import {
	authorizeDestructiveSignal,
	observeIdentity,
	probeSignalZero,
	IDENTITY_MARKER,
	PS_TIMEOUT_MS,
} from "./target-identity.mjs"
import { buildAntiControl } from "./anti-control-scenarios.mjs"

const MARKER = "CLINEMM_REPAIR01_PGID_CANCELLATION"
const CHILD_LIFETIME_MS = 6_000
const SIGNAL_WAIT_MS = 1_500
const EXIT_WAIT_MS = 3_000
const CHILD_SCRIPT = process.argv[1]

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function groupState(pgid) {
	try {
		process.kill(-pgid, 0)
		return { state: "alive", errnoCode: null }
	} catch (error) {
		const code = error?.code ?? null
		if (code === "EPERM") return { state: "alive", errnoCode: "EPERM" }
		if (code === "ESRCH") return { state: "gone", errnoCode: "ESRCH" }
		return { state: "unknown", errnoCode: code }
	}
}

const antiControlName = (() => {
	const index = process.argv.indexOf("--anti-control")
	return index >= 0 ? process.argv[index + 1] : null
})()

if (antiControlName) {
	// -------------------------------------------------------------------------
	// ANTI-CONTROL MODE — process-free.  No child is spawned and no process is
	// observed or signalled.  The synthetic observation drives the SAME gate
	// the production group signal uses.
	// -------------------------------------------------------------------------
	let control
	try {
		control = buildAntiControl(antiControlName)
	} catch (error) {
		console.log(
			`PGID_RESULT_JSON=${JSON.stringify({
				marker: MARKER,
				mode: "anti-control",
				antiControlScenario: antiControlName,
				error: error?.message ?? "unknown anti-control scenario",
			})}`,
		)
		process.exit(2)
	}
	const synthetic = control.observe()
	// The expected group id is the one the fixture captured at spawn time.
	// The group-directed signal is only safe when the OBSERVED pgid still
	// equals that captured value.
	const expectedPgid = control.expected.pgid
	const groupOwnershipHeld = synthetic.pgid !== null && synthetic.pgid === expectedPgid
	const authorization = authorizeDestructiveSignal(synthetic.pid, control.expected, {
		observe: control.observe,
	})
	const allowed = authorization.allowed && groupOwnershipHeld
	if (allowed) {
		// RECORDS the group-directed attempt; it never delivers a real signal.
		control.signalRecorder.deliver(-expectedPgid, "SIGTERM")
	}
	console.log(
		`PGID_RESULT_JSON=${JSON.stringify({
			marker: MARKER,
			identityModule: IDENTITY_MARKER,
			mode: "anti-control",
			antiControlScenario: antiControlName,
			antiControlDescription: control.scenario.description,
			childPid: synthetic.pid,
			pgid: expectedPgid,
			childStartIdentity: synthetic.startIdentity,
			childArgv: synthetic.argv,
			childUid: synthetic.uid,
			preSignalIdentityCheck: {
				observed: synthetic,
				groupOwnershipHeld,
				expected: control.expected,
			},
			// P1 CONTRACT ADJUSTMENT (bounded, 2026-11-05): a separately
			// labelled NON-DELIVERY authorization denial.  Null unless the
			// signal-zero probe was denied with EPERM, in which case NO signal
			// was attempted at all.
			authorizationDenial:
				authorization.reason === "target-unsignalable:EPERM"
					? {
							outcome: "AUTHORIZATION_DENIED_EPERM",
							source: "kill(pid, 0) — non-delivery authorization probe",
							deliversSignal: false,
							signalAttempted: false,
							errnoCode: "EPERM",
							reason: authorization.reason,
						}
					: null,
			signalAttempt: {
				ok: allowed,
				skipped: !allowed,
				target: `-${expectedPgid}`,
			},
			signalDelivered: allowed,
			destructiveSignalsIssued: control.signalRecorder.calls,
			halt: allowed ? null : "HALT_UNSAFE_FIXTURE",
			haltReason: authorization.allowed
				? `group-ownership-changed:observed-pgid=${synthetic.pgid}:expected-pgid=${expectedPgid}`
				: authorization.reason,
			identityMismatchReasons: authorization.mismatchReasons,
			antiControlExpectation: control.scenario.expect,
		})}`,
	)
	process.exit(0)
}

if (process.argv.includes("--child")) {
	const timer = setTimeout(() => process.exit(0), CHILD_LIFETIME_MS)
	process.on("SIGTERM", () => {
		clearTimeout(timer)
		process.exit(0)
	})
	setInterval(() => {}, 250)
} else {
	const child = spawn(process.execPath, [CHILD_SCRIPT, "--child"], {
		detached: true,
		stdio: ["ignore", "ignore", "ignore"],
	})
	const pid = child.pid
	const pgid = pid
	// Capture the identity AFTER the spawn so the detached child has settled.
	await sleep(200)
	const spawnObservation = observeIdentity(pid)
	const startIdentity = spawnObservation.startIdentity
	const argv = spawnObservation.argv
	const uid = spawnObservation.uid
	const result = {
		marker: MARKER,
		identityModule: IDENTITY_MARKER,
		psTimeoutMs: PS_TIMEOUT_MS,
		parentPid: process.pid,
		childPid: pid,
		pgid,
		childStartIdentity: startIdentity,
		childArgv: argv,
		childUid: uid,
		childLifetimeMs: CHILD_LIFETIME_MS,
		signalAttempt: null,
		// P1 CONTRACT ADJUSTMENT: a separately labelled NON-DELIVERY
		// authorization denial.  Null unless the signal-zero probe was denied
		// with EPERM, in which case NO signal was attempted at all.
		authorizationDenial: null,
		preSignalIdentityCheck: null,
		groupStateBefore: null,
		groupStateAfter: null,
		childExited: false,
		childExitSignal: null,
		childExitCode: null,
		cleanupState: "not-required",
		halt: null,
		haltReason: null,
	}

	await sleep(100)
	result.groupStateBefore = groupState(pgid)

	// THE LOAD-BEARING GATE: the child must still own the group, with the
	// same argv, uid and start identity, at the instant before the
	// group-directed signal.  A detached spawn on macOS gives the child its
	// own process group (pgid == pid); if that relationship no longer holds,
	// the group id may have been reused and we must not signal it.
	const groupOwnership = observeIdentity(pid)
	result.preSignalIdentityCheck = {
		observed: groupOwnership,
		groupOwnershipHeld: groupOwnership.pgid === pgid,
		expected: { argv, uid, startIdentity, pgid },
	}
	const authorization = authorizeDestructiveSignal(pid, {
		argv,
		uid,
		startIdentity,
		pgid,
	})

	if (!authorization.allowed || !groupOwnership.complete || groupOwnership.pgid !== pgid) {
		result.halt = "HALT_UNSAFE_FIXTURE"
		result.haltReason = authorization.allowed
			? `group-ownership-changed:observed-pgid=${groupOwnership.pgid}:expected-pgid=${pgid}`
			: authorization.reason
		result.identityMismatchReasons = authorization.mismatchReasons
		result.signalAttempt = { ok: false, skipped: true, target: `-${pgid}` }
		// P1 CONTRACT ADJUSTMENT (bounded, 2026-11-05): when the gate refuses
		// because the signal-zero authorization probe was denied with EPERM, NO
		// group-directed signal was attempted.  The denial is reported under its
		// own, separately labelled NON-DELIVERY field so it is never misread as
		// an attempted SIGTERM that returned EPERM.
		if (authorization.reason === "target-unsignalable:EPERM") {
			result.authorizationDenial = {
				outcome: "AUTHORIZATION_DENIED_EPERM",
				source: "kill(pid, 0) — non-delivery authorization probe",
				deliversSignal: false,
				signalAttempted: false,
				errnoCode: "EPERM",
				reason: authorization.reason,
			}
		}
	} else {
		try {
			process.kill(-pgid, "SIGTERM")
			result.signalAttempt = { ok: true, skipped: false, errnoCode: null, target: `-${pgid}` }
		} catch (error) {
			result.signalAttempt = {
				ok: false,
				skipped: false,
				errnoCode: error?.code ?? null,
				errnoMessage: error?.message ?? null,
				syscall: error?.syscall ?? null,
				target: `-${pgid}`,
			}
		}
	}

	await sleep(SIGNAL_WAIT_MS)
	result.groupStateAfter = groupState(pgid)
	if (child.exitCode !== null || child.signalCode !== null) {
		result.childExited = true
		result.childExitSignal = child.signalCode
		result.childExitCode = child.exitCode
	}

	// Independent cleanup: if the group survived, verify the child's identity
	// immediately before a direct signal.  Never signal a reused pid.
	if (result.groupStateAfter.state !== "gone" && child.exitCode === null && child.signalCode === null) {
		const cleanupAuthorization = authorizeDestructiveSignal(pid, {
			argv,
			uid,
			startIdentity,
		})
		if (cleanupAuthorization.allowed) {
			try {
				process.kill(pid, "SIGKILL")
				result.cleanupState = "identity-verified-direct-sigkill"
			} catch (error) {
				result.cleanupState = `identity-verified-sigkill-failed:${error?.code ?? "unknown"}`
			}
		} else {
			result.cleanupState = `identity-mismatch-no-signal:${cleanupAuthorization.reason}`
		}
	}

	await Promise.race([
		new Promise((resolve) => child.once("exit", resolve)),
		sleep(EXIT_WAIT_MS),
	])
	const finalState = groupState(pgid)
	result.finalGroupState = finalState
	if (finalState.state === "gone") {
		result.cleanupState = result.cleanupState === "not-required" ? "gone" : result.cleanupState
	} else if (result.cleanupState === "not-required") {
		result.cleanupState = "residual-unverified"
	}
	result.finalChildLiveness = probeSignalZero(pid)
	console.log(`PGID_RESULT_JSON=${JSON.stringify(result)}`)
	process.exit(0)
}
