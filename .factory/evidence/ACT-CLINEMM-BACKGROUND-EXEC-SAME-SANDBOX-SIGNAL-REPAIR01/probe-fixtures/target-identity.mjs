#!/usr/bin/env node
/**
 * Shared signal-target identity verification for
 * ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-SIGNAL-REPAIR01.
 * Marker: CLINEMM_REPAIR01_TARGET_IDENTITY
 *
 * SAFETY CONTRACT
 * ---------------
 * Every destructive signal issued by a qualification fixture MUST be
 * preceded by an IMMEDIATE identity re-verification of its target.  This
 * module exists so that the foreign-process and PGID fixtures share one
 * fail-closed implementation instead of two divergent copies.
 *
 * Fail-closed rules enforced here:
 *
 *   1. A process-table observation that cannot be completed (timeout,
 *      `ps` failure, empty output) is UNVERIFIABLE — never "absent".
 *   2. Only a kernel `ESRCH` from `kill(pid, 0)` establishes ABSENCE.
 *   3. `EPERM` means "exists, but not signalable" — it is UNVERIFIABLE for
 *      destructive purposes and must never be promoted to absence.
 *   4. Every `ps` observation runs with a FINITE timeout so a slow or
 *      blocked `ps` can never consume a fixture's whole lifetime.
 */

import { execFileSync } from "node:child_process";

export const IDENTITY_MARKER = "CLINEMM_REPAIR01_TARGET_IDENTITY";

/** Finite timeout for every process-table observation. */
export const PS_TIMEOUT_MS = 2_000;

/** Maximum number of argv characters compared, to bound comparison cost. */
const ARGV_COMPARE_LIMIT = 4_096;

/**
 * Run `ps` with a finite timeout and return trimmed stdout, or `null` when
 * the observation could not be completed (timeout, non-zero exit, empty).
 */
export function psField(pid, field) {
	try {
		const out = execFileSync("/bin/ps", ["-o", `${field}=`, "-p", String(pid)], {
			encoding: "utf8",
			timeout: PS_TIMEOUT_MS,
			killSignal: "SIGKILL",
			stdio: ["ignore", "pipe", "ignore"],
		});
		const trimmed = out.trim();
		return trimmed.length > 0 ? trimmed : null;
	} catch {
		return null;
	}
}

/** Read the full argv/command line of `pid`, or `null` if unobservable. */
export function readArgv(pid) {
	return psField(pid, "command");
}

/** Read the process start identity (`lstart`) of `pid`, or `null`. */
export function readStartIdentity(pid) {
	return psField(pid, "lstart");
}

/** Read the numeric UID of `pid`, or `null` if unobservable. */
export function readUid(pid) {
	const raw = psField(pid, "uid");
	if (raw === null) return null;
	const normalized = raw.trim();
	return /^\d+$/.test(normalized) ? normalized : null;
}

/** Read the process-group id of `pid`, or `null` if unobservable. */
export function readPgid(pid) {
	const raw = psField(pid, "pgid");
	if (raw === null) return null;
	const normalized = raw.trim();
	return /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : null;
}


/**
 * Kernel liveness probe via signal 0.
 *
 * Signal 0 performs the permission/existence check WITHOUT delivering a
 * signal.  It is therefore a safe, non-mutating authorization probe.
 *
 * Returns one of:
 *   - `{ state: "alive", errnoCode: null }`   — exists and signalable
 *   - `{ state: "alive", errnoCode: "EPERM" }` — exists, not signalable
 *   - `{ state: "gone", errnoCode: "ESRCH" }`  — definitively absent
 *   - `{ state: "unknown", errnoCode: <code> }` — indeterminate
 */
export function probeSignalZero(pid) {
	try {
		process.kill(pid, 0);
		return { state: "alive", errnoCode: null, delivered: false };
	} catch (error) {
		const code = error?.code ?? null;
		if (code === "EPERM") return { state: "alive", errnoCode: "EPERM", delivered: false };
		if (code === "ESRCH") return { state: "gone", errnoCode: "ESRCH", delivered: false };
		return { state: "unknown", errnoCode: code, delivered: false };
	}
}

/**
 * Observe the complete identity of `pid`.
 *
 * Returns an object with an explicit `complete` flag.  `complete` is true
 * ONLY when every identity field the fixtures rely on was observed.  A
 * `complete: false` observation is a HARD BLOCK for any destructive signal.
 */
export function observeIdentity(pid) {
	const argv = readArgv(pid);
	const startIdentity = readStartIdentity(pid);
	const uid = readUid(pid);
	const pgid = readPgid(pid);
	const liveness = probeSignalZero(pid);
	return {
		pid,
		argv,
		startIdentity,
		uid,
		pgid,
		liveness,
		complete:
			argv !== null &&
			startIdentity !== null &&
			uid !== null &&
			pgid !== null &&
			liveness.state !== "unknown",
	};
}

/**
 * Compare an observation against the expected identity.
 *
 * `expected` may carry any subset of { argv, startIdentity, uid, pgid }.
 * A field that is absent from `expected` is not compared.  A field that IS
 * expected but missing or changed from the observation is a mismatch.
 */
export function identityMatches(observed, expected) {
	const reasons = [];
	for (const field of ["argv", "startIdentity", "uid", "pgid"]) {
		if (!(field in expected) || expected[field] === undefined || expected[field] === null) {
			continue;
		}
		const observedValue = observed[field];
		if (observedValue === null || observedValue === undefined) {
			reasons.push(`${field}:missing`);
			continue;
		}
		const expectedValue = expected[field];
		const same =
			typeof expectedValue === "string" && typeof observedValue === "string"
				? expectedValue.slice(0, ARGV_COMPARE_LIMIT) === observedValue.slice(0, ARGV_COMPARE_LIMIT)
				: expectedValue === observedValue;
		if (!same) {
			reasons.push(`${field}:changed`);
		}
	}
	return { matches: reasons.length === 0, reasons };
}

/**
 * The single gate every destructive signal in these fixtures must pass.
 *
 * Returns `{ allowed: true, observed }` only when the target is
 * (a) observed completely, (b) matches the expected identity, and
 * (c) is confirmed present by signal 0.  Otherwise it returns
 * `{ allowed: false, reason, observed, mismatchReasons }` and the caller
 * MUST NOT deliver a signal.
 *
 * `options.observe` is an injection seam used ONLY by the process-free
 * anti-control harness.  When supplied, it replaces the real process-table
 * observation entirely, so the harness can exercise every unsafe-target
 * shape without ever touching a real process.  Production callers omit it
 * and therefore always use the real observation path.
 */
export function authorizeDestructiveSignal(pid, expected, options = {}) {
	const observed = options.observe ? options.observe(pid) : observeIdentity(pid);
	if (!observed.complete) {
		const missing = [];
		if (observed.argv === null) missing.push("argv");
		if (observed.startIdentity === null) missing.push("startIdentity");
		if (observed.uid === null) missing.push("uid");
		if (observed.pgid === null) missing.push("pgid");
		if (observed.liveness.state === "unknown") missing.push("liveness");
		return {
			allowed: false,
			reason: `identity-incomplete:${missing.join(",")}`,
			observed,
			mismatchReasons: [],
		};
	}
	if (observed.liveness.state === "gone") {
		return {
			allowed: false,
			reason: "target-absent:ESRCH",
			observed,
			mismatchReasons: [],
		};
	}
	// EPERM means the target EXISTS but this process may not signal it.  It is
	// present, so it is never "absent" — but it is also not verifiable for
	// destructive purposes, so the attempt must fail closed.  Attempting the
	// signal anyway would produce an errno the caller could not distinguish
	// from a genuine authorization denial.
	if (observed.liveness.errnoCode === "EPERM") {
		return {
			allowed: false,
			reason: "target-unsignalable:EPERM",
			observed,
			mismatchReasons: [],
		};
	}
	const comparison = identityMatches(observed, expected);
	if (!comparison.matches) {
		return {
			allowed: false,
			reason: `identity-mismatch:${comparison.reasons.join(",")}`,
			observed,
			mismatchReasons: comparison.reasons,
		};
	}
	return { allowed: true, reason: "identity-verified", observed, mismatchReasons: [] };
}
