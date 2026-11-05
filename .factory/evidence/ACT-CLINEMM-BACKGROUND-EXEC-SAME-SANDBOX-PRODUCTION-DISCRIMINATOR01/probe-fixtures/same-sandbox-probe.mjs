#!/usr/bin/env node
/**
 * ACT-CLINEMM-BACKGROUND-EXEC-SAME-SANDBOX-PRODUCTION-DISCRIMINATOR01
 * Marker: CLINEMM_SAME_SANDBOX_PRODUCTION_DISCRIMINATOR01
 *
 * FINITE parent/child fixture. Reuses the RECON01/RECON02 Node probe
 * behavior (see
 * `.factory/evidence/ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01/probe-fixtures/probe.mjs`)
 * with the §6 evidence shape.
 *
 * PARENT behavior:
 *   1. Starts ONE Node child.
 *   2. Observes a unique `CHILD_READY` marker.
 *   3. Records PID, PPID and PGID when observable.
 *   4. Attempts `process.kill(childPid, "SIGTERM")` EXACTLY ONCE.
 *   5. Records `signalAttempt.ok` and the actual errno.
 *   6. Observes whether the child received SIGTERM.
 *   7. Awaits the child's bounded exit.
 *   8. Emits a machine-readable result.
 *
 * CHILD behavior:
 *   - Has a short independent self-exit deadline (~4s).
 *   - Exits when SIGTERM is received.
 *   - Emits `CHILD_GOT_SIGTERM` on delivery.
 *   - Does NOT create additional descendants.
 *   - Does NOT perform filesystem or network mutations.
 *
 * A signal denial must NOT leave an infinite-loop child running: the
 * child's own deadline guarantees termination even when the parent's
 * SIGTERM is denied.
 *
 * Output (authoritative):
 *   SAME_SANDBOX_RESULT_JSON=<json>
 *
 * Exit status is NOT authoritative. Parse SAME_SANDBOX_RESULT_JSON.
 */
import { execFileSync, spawn } from "node:child_process";

const MARKER = "CLINEMM_SAME_SANDBOX_PRODUCTION_DISCRIMINATOR01";
const CHILD_LIFETIME_MS = 4000;
const EXIT_WAIT_MS = 6000;
const SELF = process.argv[1];

function log(...parts) {
	console.log(...parts);
}

/**
 * Best-effort PGID observation. On darwin the child's process group is
 * observable via `ps`; a failure here is recorded as LIVE_UNOBSERVABLE
 * rather than invented.
 *
 * NOTE: `/bin/ps` may itself be denied by the Seatbelt profile (it is
 * NOT in the profile's allow-list for `process-exec` of every helper
 * binary). When that happens the PGID fields stay `null` and the
 * independent Terminal performs the authoritative PGID check AFTER the
 * job completes. The PGID fields are NOT load-bearing for the causal
 * decision: the decision rests on the signal errno + the correlated
 * child delivery/exit evidence.
 */
function observePgid(pid) {
	try {
		const out = execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(pid)], {
			encoding: "utf8",
			timeout: 2000,
		});
		const parsed = Number.parseInt(out.trim(), 10);
		return Number.isInteger(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

if (process.argv.includes("--child")) {
	log(`CHILD_READY pid=${process.pid} ppid=${process.ppid} marker=${MARKER}`);
	const timer = setTimeout(() => {
		log(`CHILD_SELF_EXIT pid=${process.pid}`);
		process.exit(0);
	}, CHILD_LIFETIME_MS);
	process.on("SIGTERM", () => {
		log(`CHILD_GOT_SIGTERM pid=${process.pid}`);
		clearTimeout(timer);
		process.exit(0);
	});
	const keepAlive = setInterval(() => {}, 1000);
	process.on("exit", () => clearInterval(keepAlive));
} else {
	const child = spawn(process.execPath, [SELF, "--child"], {
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const childPid = child.pid;
	let childOut = "";
	child.stdout.on("data", (d) => {
		childOut += d.toString();
	});
	child.stderr.on("data", (d) => {
		childOut += d.toString();
	});

	const waitForReady = (timeoutMs) =>
		new Promise((resolve) => {
			const deadline = Date.now() + timeoutMs;
			const tick = () => {
				if (childOut.includes("CHILD_READY")) return resolve(true);
				if (Date.now() > deadline) return resolve(false);
				setTimeout(tick, 25);
			};
			tick();
		});
	const waitExit = (timeoutMs) =>
		new Promise((resolve) => {
			if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
			const timer = setTimeout(() => resolve(false), timeoutMs);
			child.once("exit", () => {
				clearTimeout(timer);
				resolve(true);
			});
		});

	const result = {
		marker: MARKER,
		parentPid: process.pid,
		childPid: childPid ?? null,
		parentPgid: observePgid(process.pid),
		childPgid: null,
		childReady: false,
		profileApplied: null,
		signalAttempt: {
			ok: null,
			errnoCode: null,
		},
		childReceivedSigterm: null,
		childExited: null,
		childStillAliveAfter: null,
		// Additional lifecycle evidence (not part of the minimum shape).
		parentPpid: process.ppid,
		childExitCode: null,
		childExitSignal: null,
		childSelfExited: null,
		childOut: "",
	};

	const ready = await waitForReady(3000);
	result.childReady = ready;
	if (ready) {
		result.childPgid = observePgid(childPid);
		try {
			process.kill(childPid, "SIGTERM");
			result.signalAttempt = { ok: true, errnoCode: null };
		} catch (err) {
			result.signalAttempt = {
				ok: false,
				errnoCode: err?.code ?? null,
				errnoMessage: err?.message ?? null,
				syscall: err?.syscall ?? null,
			};
		}
		const exited = await waitExit(EXIT_WAIT_MS);
		result.childExited = exited;
		result.childExitCode = exited ? child.exitCode : null;
		result.childExitSignal = exited ? child.signalCode : null;
		result.childReceivedSigterm = childOut.includes("CHILD_GOT_SIGTERM");
		result.childSelfExited = exited && child.exitCode === 0 && child.signalCode === null;
		if (!exited) {
			// The child outlived the bounded wait. Force-terminate our OWN
			// child so the experiment cannot leave an orphan.
			try {
				process.kill(childPid, "SIGKILL");
			} catch {
				/* ignore */
			}
			await waitExit(2000);
		}
	}
	result.childOut = childOut;
	try {
		process.kill(childPid, 0);
		result.childStillAliveAfter = true;
	} catch (err) {
		result.childStillAliveAfter = false;
		result.childAliveProbeErrno = err?.code ?? null;
	}
	log("SAME_SANDBOX_RESULT_JSON=" + JSON.stringify(result));
	process.exit(0);
}
