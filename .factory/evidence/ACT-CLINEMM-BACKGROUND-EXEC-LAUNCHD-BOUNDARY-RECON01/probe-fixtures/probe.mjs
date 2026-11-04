#!/usr/bin/env node
/**
 * ACT-CLINEMM-BACKGROUND-EXEC-LAUNCHD-BOUNDARY-RECON01 — bounded causal probe.
 * Marker: CLINEMM_RECON01_SIGNAL_PROBE
 *
 * Parent: spawns ONE detached child (own process group), waits for READY,
 * attempts ONE controlled parent->child SIGTERM, records the exact errno,
 * then waits (bounded) for the child exit.
 *
 * The CHILD always exits on its own after a fixed short interval, so a
 * failed signal cannot leave an orphan. The parent verifies liveness
 * afterwards and reports whether the child had to be force-killed.
 *
 * Usage:
 *   node probe.mjs            # parent mode
 *   node probe.mjs --child    # child mode (internal)
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MARKER = "CLINEMM_RECON01_SIGNAL_PROBE";
const CHILD_LIFETIME_MS = 4000;
const EXIT_WAIT_MS = 6000;
const SELF = process.argv[1];

function log(...parts) {
	console.log(...parts);
}

if (process.argv.includes("--child")) {
	log(`CHILD_READY pid=${process.pid} marker=${MARKER}`);
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
	const outDir = mkdtempSync(join(tmpdir(), "clinemm-recon01-out-"));
	const resultPath = join(outDir, "result.json");
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
		parentPpid: process.ppid,
		childPid,
		childOut: "",
		signalAttempt: null,
		signalErrno: null,
		childExitedOnOwn: false,
		childExitCode: null,
		childExitSignal: null,
		childStillAlive: null,
		childStillAliveAfter: null,
		cleanup: null,
	};
	const ready = await waitForReady(3000, () => childOut);
	result.childReady = ready;
	if (ready) {
		try {
			process.kill(childPid, "SIGTERM");
			result.signalAttempt = { signal: "SIGTERM", target: "child-pid", ok: true };
		} catch (err) {
			result.signalAttempt = {
				signal: "SIGTERM",
				target: "child-pid",
				ok: false,
				errnoCode: err?.code ?? null,
				errnoMessage: err?.message ?? null,
				syscall: err?.syscall ?? null,
			};
			result.signalErrno = err?.code ?? null;
		}
		const exited = await waitExit(EXIT_WAIT_MS);
		result.childExitCode = exited ? child.exitCode : null;
		result.childExitSignal = exited ? child.signalCode : null;
		result.childExitedOnOwn = exited && child.exitCode === 0 && child.signalCode === null;
		result.childStillAlive = !exited;
		if (!exited) {
			try {
				process.kill(childPid, "SIGKILL");
				result.cleanup = "SIGKILLed-own-child";
			} catch (e) {
				result.cleanup = `cleanup-failed:${e?.code ?? "?"}`;
			}
			await waitExit(2000);
		} else {
			result.cleanup = "child-exited-no-cleanup-needed";
		}
	} else {
		result.cleanup = "child-not-ready";
		try {
			process.kill(childPid, "SIGKILL");
		} catch {
			/* ignore */
		}
	}
	result.childOut = childOut;
	try {
		process.kill(childPid, 0);
		result.childStillAliveAfter = true;
	} catch (e) {
		result.childStillAliveAfter = false;
		result.childAliveProbeErrno = e?.code ?? null;
	}
	writeFileSync(resultPath, JSON.stringify(result, null, 2));
	log("PROBE_RESULT_JSON=" + JSON.stringify(result));
	log("PROBE_RESULT_PATH=" + resultPath);
	process.exit(0);
}
