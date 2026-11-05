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
 * Usage:
 *   node foreign-signal-attempt.mjs <foreignPid> <foreignLogPath>
 */
import { readFileSync } from "node:fs"

const MARKER = "CLINEMM_REPAIR01_FOREIGN_SIGNAL_ATTEMPT"

function alive(pid) {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		// EPERM means "exists but not signalable" — never "absent".
		return error?.code === "EPERM"
	}
}

function safeRead(path) {
	try {
		return readFileSync(path, "utf8")
	} catch {
		return null
	}
}

const foreignPid = Number.parseInt(process.argv[2] ?? "", 10)
const logPath = process.argv[3]
const result = {
	marker: MARKER,
	parentPid: process.pid,
	parentPpid: process.ppid,
	foreignPid: Number.isInteger(foreignPid) ? foreignPid : null,
	foreignPidSource: "operator-verified pid + argv + start identity",
	signalAttempt: null,
	signalErrno: null,
	foreignAliveBefore: null,
	foreignAliveAfter: null,
	foreignReceivedSIGTERM: null,
	foreignSignalLogTail: null,
}

if (!Number.isInteger(foreignPid) || foreignPid <= 1 || !logPath) {
	result.error = "invalid-foreign-pid-or-log-path"
	console.log(`FOREIGN_SIGNAL_RESULT_JSON=${JSON.stringify(result)}`)
	process.exit(2)
}

const before = safeRead(logPath)
result.foreignAliveBefore = alive(foreignPid)
try {
	process.kill(foreignPid, "SIGTERM")
	result.signalAttempt = { signal: "SIGTERM", target: "foreign-pid", ok: true }
} catch (error) {
	result.signalAttempt = {
		signal: "SIGTERM",
		target: "foreign-pid",
		ok: false,
		errnoCode: error?.code ?? null,
		errnoMessage: error?.message ?? null,
		syscall: error?.syscall ?? null,
	}
	result.signalErrno = error?.code ?? null
}

await new Promise((resolve) => setTimeout(resolve, 500))
result.foreignAliveAfter = alive(foreignPid)
const after = safeRead(logPath)
result.foreignReceivedSIGTERM =
	after !== null &&
	before !== null &&
	after.includes("FOREIGN_GOT_SIGTERM") &&
	!before.includes("FOREIGN_GOT_SIGTERM")
result.foreignSignalLogTail = after?.slice(-400) ?? null
console.log(`FOREIGN_SIGNAL_RESULT_JSON=${JSON.stringify(result)}`)
process.exit(0)
