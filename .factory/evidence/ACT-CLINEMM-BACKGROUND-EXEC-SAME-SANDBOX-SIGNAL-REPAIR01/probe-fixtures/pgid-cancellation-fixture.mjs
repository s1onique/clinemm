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
 * Cleanup is identity-checked: before any direct child signal, the parent
 * verifies that the recorded pid still has the expected argv and process start
 * identity.  If identity cannot be established, no signal is sent and the
 * result is reported as inconclusive.
 */
import { spawn, execFileSync } from "node:child_process"

const MARKER = "CLINEMM_REPAIR01_PGID_CANCELLATION"
const CHILD_LIFETIME_MS = 6_000
const SIGNAL_WAIT_MS = 1_500
const EXIT_WAIT_MS = 3_000
const CHILD_SCRIPT = process.argv[1]

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function readStartIdentity(pid) {
	try {
		return execFileSync("/bin/bash", ["-c", `ps -o lstart= -p ${pid}`], { encoding: "utf8" }).trim()
	} catch {
		return ""
	}
}

function readArgv(pid) {
	try {
		return execFileSync("/bin/bash", ["-c", `ps -o command= -p ${pid}`], { encoding: "utf8" }).trim()
	} catch {
		return ""
	}
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
	const startIdentity = readStartIdentity(pid)
	const argv = readArgv(pid)
	const result = {
		marker: MARKER,
		parentPid: process.pid,
		childPid: pid,
		pgid,
		childStartIdentity: startIdentity,
		childArgv: argv,
		childLifetimeMs: CHILD_LIFETIME_MS,
		signalAttempt: null,
		groupStateBefore: null,
		groupStateAfter: null,
		childExited: false,
		childExitSignal: null,
		childExitCode: null,
		cleanupState: "not-required",
	}

	await sleep(300)
	result.groupStateBefore = groupState(pgid)
	try {
		process.kill(-pgid, "SIGTERM")
		result.signalAttempt = { ok: true, errnoCode: null, target: `-${pgid}` }
	} catch (error) {
		result.signalAttempt = {
			ok: false,
			errnoCode: error?.code ?? null,
			errnoMessage: error?.message ?? null,
			syscall: error?.syscall ?? null,
			target: `-${pgid}`,
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
		const currentStart = readStartIdentity(pid)
		const currentArgv = readArgv(pid)
		if (currentStart && currentArgv && currentStart === startIdentity && currentArgv === argv) {
			try {
				process.kill(pid, "SIGKILL")
				result.cleanupState = "identity-verified-direct-sigkill"
			} catch (error) {
				result.cleanupState = `identity-verified-sigkill-failed:${error?.code ?? "unknown"}`
			}
		} else {
			result.cleanupState = "identity-mismatch-no-signal"
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
	console.log(`PGID_RESULT_JSON=${JSON.stringify(result)}`)
	process.exit(0)
}
