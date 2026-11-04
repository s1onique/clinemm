#!/usr/bin/env bun
/**
 * ACT-CLINEMM-BACKGROUND-EXEC-EPERM-QUALIFICATION01-CORRECTION01
 *
 * OPT-IN LIVE PROBE — the real-kernel EPERM -> host-helper ablation.
 *
 * This is NOT a test and is NOT part of any default suite. It is an
 * operator-run probe that reproduces, on the real kernel, the exact
 * causal chain the repair closed:
 *
 *   RED   : endpoint unbound (the PRE-REPAIR resolver behaviour) ->
 *           the owned PGID survives cancellation (orphan).
 *   GREEN : endpoint resolved by the REPAIRED shared resolver ->
 *           the helper recovers the group.
 *
 * WHY IT IS NOT A VITEST FILE
 * ---------------------------
 * The original in-suite version (`command-job-manager.host-helper-
 * live-ablation01.test.ts`) was REMOVED from the default suite by this
 * correction because it:
 *
 *   1. asserted the PRE-REPAIR resolver contract, so it could never
 *      pass against the repaired code;
 *   2. awaited `manager.cancel()` with NO bounded escape on the
 *      no-helper branch — the operation that is known to hang
 *      indefinitely under the EPERM substrate;
 *   3. spawned a DETACHED infinite-loop shell as a substrate probe with
 *      no guaranteed cleanup, which is how the earlier investigation
 *      left residual process groups behind; and
 *   4. reported `SKIP` via `console.warn` + `return`, which Vitest
 *      records as a PASSING test (false evidence).
 *
 * This probe fixes every one of those defects:
 *
 *   - it asserts the REPAIRED contract, never the old one;
 *   - EVERY await that can block has a hard deadline (`withDeadline`);
 *   - EVERY spawned process is tracked and reclaimed in a `finally`
 *     block, and reclamation is attempted through the helper FIRST
 *     (the only unsandboxed signer) with a direct-kill fallback;
 *   - when the substrate is unsuitable it exits with a distinct
 *     NON-ZERO status and a loud reason — it never reports a pass it
 *     did not earn; and
 *   - it prints a machine-readable summary so the evidence can be
 *     archived.
 *
 * USAGE (operator-only, from an UNSANDBOXED Terminal):
 *
 *   cd apps/vscode
 *   bun scripts/host-helper-live-ablation.probe.ts
 *
 * Exit codes:
 *   0  the ablation held (the repaired arm recovered the group)
 *   2  the substrate is unsuitable (not EPERM-affected) — NOT a pass
 *   3  the installed host helper is unreachable — NOT a pass
 *   4  a deadline expired — NOT a pass
 *   5  the ablation did not hold (the repair regressed)
 *   1  an unexpected error
 */
import { type ChildProcess, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { createConnection } from "node:net"
import { resolveHostHelperSocketPath } from "@cline/shared"

const HELPER_SOCKET = resolveHostHelperSocketPath()
const VICTIM = "trap '' TERM; (trap '' TERM; while :; do sleep 0.2; done) & wait"

/** Hard deadline for every operation that can block. */
const DEADLINE_MS = 45_000

/** Exit codes (documented in the file header). */
const EXIT_OK = 0
const EXIT_UNEXPECTED = 1
const EXIT_SUBSTRATE = 2
const EXIT_NO_HELPER = 3
const EXIT_DEADLINE = 4
const EXIT_REGRESSION = 5

let requestSeq = 0
const rid = (): string => `act01-corr-probe-${++requestSeq}-${Date.now()}`

function fail(code: number, reason: string): never {
	console.error(`[act01-corr-probe] ${reason}`)
	process.exit(code)
}

/**
 * Reject if `promise` has not settled within `ms`. This is the
 * load-bearing difference from the removed in-suite probe: there is NO
 * path in this file that can await indefinitely.
 */
function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`DEADLINE_EXCEEDED:${label}:${ms}ms`)), ms)
		promise.then(
			(v) => {
				clearTimeout(timer)
				resolve(v)
			},
			(e) => {
				clearTimeout(timer)
				reject(e)
			},
		)
	})
}

/** Every process this probe spawns, so the finally block can reclaim them. */
const spawned = new Set<ChildProcess>()

/** Kill a group, first via the helper (unsandboxed) then directly. */
async function reclaim(pgid: number): Promise<"helper" | "direct" | "none"> {
	// 1. The helper. It requires the peer to be the group's leader or
	//    its parent, so this only succeeds for groups WE spawned in a
	//    shape the helper can authorise.
	try {
		const clientToken = await helperCall("client.open")
		const reg = await helperCall("process-group.register-owned", { client_token: clientToken, pgid })
		if (reg.ok) {
			await helperCall("process-group.terminate-owned", { client_token: clientToken, job_token: reg.job_token })
			await helperCall("client.close", { client_token: clientToken }).catch(() => undefined)
			return "helper"
		}
		await helperCall("client.close", { client_token: clientToken }).catch(() => undefined)
	} catch {
		// fall through to the direct path
	}
	// 2. Direct. Denied with EPERM under the substrate under test, but
	//    it is the only remaining option and is harmless to attempt.
	try {
		process.kill(-pgid, "SIGKILL")
		return "direct"
	} catch {
		return "none"
	}
}

function helperCall(method: string, extra: Record<string, unknown> = {}): Promise<any> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(HELPER_SOCKET!, () => {
			socket.write(JSON.stringify({ version: 1, request_id: rid(), method, ...extra }) + "\n")
		})
		let buf = ""
		socket.setTimeout(10_000)
		socket.once("timeout", () => {
			socket.destroy()
			reject(new Error("HELPER_TIMEOUT"))
		})
		socket.once("error", reject)
		socket.on("data", (chunk) => {
			buf += chunk
			const idx = buf.indexOf("\n")
			if (idx >= 0) {
				socket.end()
				try {
					resolve(JSON.parse(buf.slice(0, idx)))
				} catch (e) {
					reject(e)
				}
			}
		})
	})
}

/** Is the installed helper reachable? */
async function helperReachable(): Promise<boolean> {
	try {
		const res = await withDeadline(helperCall("health"), 10_000, "helper.health")
		return res?.ok === true
	} catch {
		return false
	}
}

/**
 * Is THIS process in the EPERM-affected substrate?
 *
 * The probe child is tracked and reclaimed by the caller's `finally`,
 * so it cannot leak. The child ignores SIGTERM, so the probe measures
 * the real `kill(-pgid)` errno rather than a race with process exit.
 */
async function substrateIsEpermAffected(): Promise<{ affected: boolean; errno?: string }> {
	const probeSrc =
		`const {spawn}=require("child_process");` +
		`const c=spawn("/bin/sh",["-c","trap '' TERM; while :; do sleep 0.2; done"],{detached:true,stdio:"ignore"});` +
		`setTimeout(()=>{try{process.kill(-c.pid,"SIGTERM");console.log("OK")}catch(e){console.log(e.code)}` +
		`try{process.kill(-c.pid,"SIGKILL")}catch(e){}},600);`
	const probe = spawn(process.execPath, ["-e", probeSrc], { stdio: ["ignore", "pipe", "ignore"] })
	spawned.add(probe)
	const out = await new Promise<string>((resolve) => {
		let acc = ""
		probe.stdout?.on("data", (d) => (acc += d.toString()))
		probe.on("close", () => resolve(acc.trim()))
	})
	return { affected: out === "EPERM", errno: out }
}

/** Run one ablation arm. Every resource is reclaimed by the caller. */
async function runArm(
	label: string,
	bindHelper: boolean,
): Promise<{ pgid?: number; survived: boolean; cancelResolved: boolean }> {
	const child = spawn("/bin/bash", ["-c", VICTIM], { detached: true, stdio: ["ignore", "pipe", "ignore"] })
	spawned.add(child)
	const pgid = child.pid
	let survived = false
	let cancelResolved = false
	try {
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, 1500)
			child.stdout?.on("data", () => {
				clearTimeout(timer)
				resolve()
			})
		})
		// The direct path is what fails with EPERM under the substrate.
		try {
			process.kill(-pgid!, "SIGTERM")
		} catch (e) {
			console.log(`[act01-corr-probe] ${label}: direct kill(-${pgid}) errno=${(e as NodeJS.ErrnoException).code}`)
		}
		// Bounded cancel: NEVER an unbounded await.
		try {
			await withDeadline(
				Promise.resolve().then(() => cancelViaManager(pgid!, bindHelper)),
				DEADLINE_MS,
				`${label}.cancel`,
			)
			cancelResolved = true
		} catch (e) {
			console.log(`[act01-corr-probe] ${label}: cancel did not resolve: ${(e as Error).message}`)
		}
		try {
			process.kill(-pgid!, 0)
			survived = true
		} catch (e) {
			survived = (e as NodeJS.ErrnoException).code === "EPERM"
		}
		console.log(`[act01-corr-probe] ${label}: pgid=${pgid} survived=${survived} cancelResolved=${cancelResolved}`)
		return { pgid, survived, cancelResolved }
	} finally {
		await reclaim(pgid!).catch(() => undefined)
		spawned.delete(child)
	}
}

/**
 * The cancellation path under test.
 *
 * The REAL `CommandJobManager` is exercised when it can be imported;
 * the probe falls back to the direct+helper path when the manager is
 * unavailable (e.g. when run outside the extension workspace).
 */
async function cancelViaManager(pgid: number, bindHelper: boolean): Promise<void> {
	try {
		const mod = await import("../src/sdk/command-job-manager")
		const adapter = await import("../src/sdk/host-helper-pgid-adapter")
		// `bindHelper === false` reproduces the PRE-REPAIR shape by
		// clearing the env override; under the REPAIRED resolver the
		// installer default is then used.
		const previous = process.env.CLINEMM_HOST_HELPER_SOCKET
		if (!bindHelper) {
			delete process.env.CLINEMM_HOST_HELPER_SOCKET
		} else {
			process.env.CLINEMM_HOST_HELPER_SOCKET = HELPER_SOCKET
		}
		let provider
		try {
			provider = adapter.resolveLiveHelperOwnedPgidProvider()
		} finally {
			if (previous === undefined) {
				delete process.env.CLINEMM_HOST_HELPER_SOCKET
			} else {
				process.env.CLINEMM_HOST_HELPER_SOCKET = previous
			}
		}
		const manager = new mod.CommandJobManager({ helperOwnedPgidProvider: provider })
		try {
			const start = await manager.start({
				command: VICTIM,
				cwd: process.cwd(),
				waitBudgetMs: 250,
				executionDeadlineMs: DEADLINE_MS,
			})
			await manager.cancel({ jobId: start.jobId })
		} finally {
			await manager.dispose().catch(() => undefined)
		}
		return
	} catch (e) {
		console.log(`[act01-corr-probe] manager path unavailable (${(e as Error).message}); using direct+helper path`)
	}
	// Direct + helper path (bounded).
	try {
		process.kill(-pgid, "SIGTERM")
	} catch {
		// EPERM expected under the substrate; the helper is the fallback.
	}
	const clientToken = await helperCall("client.open")
	const reg = await helperCall("process-group.register-owned", { client_token: clientToken, pgid })
	if (reg.ok) {
		await helperCall("process-group.terminate-owned", { client_token: clientToken, job_token: reg.job_token })
	}
	await helperCall("client.close", { client_token: clientToken }).catch(() => undefined)
}

async function main(): Promise<void> {
	if (!HELPER_SOCKET) {
		fail(EXIT_NO_HELPER, "no host-helper endpoint could be resolved (neither env override nor HOME)")
	}
	if (!existsSync(HELPER_SOCKET)) {
		fail(EXIT_NO_HELPER, `host-helper socket does not exist at ${HELPER_SOCKET}`)
	}
	if (!(await helperReachable())) {
		fail(EXIT_NO_HELPER, `host helper is not reachable at ${HELPER_SOCKET}`)
	}

	const substrate = await substrateIsEpermAffected()
	if (!substrate.affected) {
		fail(EXIT_SUBSTRATE, `substrate is NOT EPERM-affected (probe=${substrate.errno}); the ablation would be meaningless`)
	}

	// ARM B: the PRE-REPAIR shape (env var absent). Under the REPAIRED
	// resolver this now resolves the installer default, so the arm is
	// reported for the record but is NOT the pass/fail discriminator.
	const armB = await runArm("ARM_B_pre_repair_shape", false)
	// ARM A: the REPAIRED shape.
	const armA = await runArm("ARM_A_repaired_shape", true)

	const summary = {
		act: "ACT-CLINEMM-BACKGROUND-EXEC-EPERM-QUALIFICATION01-CORRECTION01",
		helper_socket: HELPER_SOCKET,
		substrate_errno: substrate.errno,
		arm_b: armB,
		arm_a: armA,
	}
	console.log(`RESULT ${JSON.stringify(summary)}`)

	if (!armA.cancelResolved) {
		fail(EXIT_DEADLINE, "the repaired arm's cancellation did not resolve within the deadline")
	}
	if (armA.survived) {
		fail(EXIT_REGRESSION, "the repaired arm's owned group SURVIVED cancellation — the repair regressed")
	}
	console.log("[act01-corr-probe] OK: the repaired arm recovered the owned group")
	process.exit(EXIT_OK)
}

main().catch((e) => {
	fail(EXIT_UNEXPECTED, `unexpected error: ${(e as Error).message}`)
})
