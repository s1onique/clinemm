#!/usr/bin/env node
/**
 * ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02 — D2 fixture.
 * Marker: CLINEMM_RECON02_FOREIGN_SIGNAL_ATTEMPT
 *
 * Runs UNDER a tested Seatbelt profile and attempts EXACTLY ONE signal
 * against a controlled foreign PID that was started OUTSIDE that sandbox
 * instance. This is the mandatory security negative control for the
 * `(allow signal (target same-sandbox))` candidate.
 *
 * The program NEVER signals its own descendants and NEVER sweeps process
 * groups. It performs exactly one `process.kill(foreignPid, "SIGTERM")`.
 *
 * Usage:
 *   node foreign-signal-attempt.mjs <foreignPid>
 *
 * Output:
 *   FOREIGN_SIGNAL_RESULT_JSON=<json>   (authoritative)
 *
 * Exit status is NOT authoritative. Parse FOREIGN_SIGNAL_RESULT_JSON.
 */
import { readFileSync } from "node:fs";

const MARKER = "CLINEMM_RECON02_FOREIGN_SIGNAL_ATTEMPT";

function log(...parts) {
	console.log(...parts);
}

function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		// EPERM means "exists but not signalable" -> treat as alive.
		if (err?.code === "EPERM") return true;
		return false;
	}
}

const rawPid = process.argv[2];
const foreignPid = Number.parseInt(rawPid ?? "", 10);

const result = {
	marker: MARKER,
	parentPid: process.pid,
	parentPpid: process.ppid,
	foreignPid: Number.isInteger(foreignPid) ? foreignPid : null,
	foreignPidSource: "operator-verified argv",
	signalAttempt: null,
	signalErrno: null,
	foreignAliveBefore: null,
	foreignAliveAfter: null,
	foreignReceivedSIGTERM: null,
	foreignSignalLogTail: null,
};

if (!Number.isInteger(foreignPid) || foreignPid <= 1) {
	result.error = "invalid-foreign-pid";
	log("FOREIGN_SIGNAL_RESULT_JSON=" + JSON.stringify(result));
	process.exit(2);
}

// Optional: the operator may pass the foreign fixture's log path so the
// program can observe whether the foreign target actually received SIGTERM.
const logPath = process.argv[3];
const foreignLogBefore = logPath ? safeRead(logPath) : null;

result.foreignAliveBefore = alive(foreignPid);

try {
	process.kill(foreignPid, "SIGTERM");
	result.signalAttempt = {
		signal: "SIGTERM",
		target: "foreign-pid",
		ok: true,
	};
} catch (err) {
	result.signalAttempt = {
		signal: "SIGTERM",
		target: "foreign-pid",
		ok: false,
		errnoCode: err?.code ?? null,
		errnoMessage: err?.message ?? null,
		syscall: err?.syscall ?? null,
	};
	result.signalErrno = err?.code ?? null;
}

// Give a successful signal a bounded moment to be delivered and observed.
await new Promise((r) => setTimeout(r, 500));

result.foreignAliveAfter = alive(foreignPid);
if (logPath) {
	const foreignLogAfter = safeRead(logPath);
	result.foreignReceivedSIGTERM =
		foreignLogAfter !== null &&
		foreignLogBefore !== null &&
		foreignLogAfter.includes("FOREIGN_GOT_SIGTERM") &&
		!foreignLogBefore.includes("FOREIGN_GOT_SIGTERM");
	result.foreignSignalLogTail = foreignLogAfter === null ? null : foreignLogAfter.slice(-400);
}

log("FOREIGN_SIGNAL_RESULT_JSON=" + JSON.stringify(result));
process.exit(0);

function safeRead(p) {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return null;
	}
}
