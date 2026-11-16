/**
 * ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02
 *
 * The cross-process ownership-exclusivity witnesses.
 *
 * The QUAL01 correction established EXPLICIT INSTANCE OWNERSHIP with an
 * on-disk owner record. It closed the "second instance replaces a live
 * instance" defect for the SEQUENTIAL case, but the claim itself was a
 * READ-CHECK followed by a rename-to-overwrite — which is NOT an
 * exclusive claim.
 *
 * This suite proves the two interleavings that the read-check window
 * left open:
 *
 *   R1 — SIMULTANEOUS ACQUISITION
 *        Two independent processes find an unowned endpoint before either
 *        completes its claim. Can both report a successful acquisition?
 *        Can one replace the other's record?
 *
 *   R2 — CLEANUP VERSUS ACQUISITION
 *        Instance A releases its owner record while cleaning up. Instance
 *        B acquires the endpoint before A completes cleanup. Can A
 *        remove B's socket/token?
 *
 * The witnesses drive the REAL production functions in REAL independent
 * processes. The scheduling barrier is an interposition on `node:fs`
 * INSIDE THE CHILD PROCESS ONLY: it parks a contender at the exact
 * instruction boundary the interleaving needs, without modifying any
 * production code. The production functions themselves are untouched.
 */

import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
	acquireControlSeamOwnership,
	CONTROL_SEAM_FORCE_ENV_VAR,
	readControlSeamOwnerRecord,
	resolveControlSeamOwnerPath,
	resolveControlSeamOwnerReclaimPath,
} from "./control-seam-ownership"

/**
 * The AF_UNIX `sock_path` budget is ~104 usable bytes on macOS, so the
 * test's temp directory must be SHORT. `os.tmpdir()` on this host is
 * already 84 bytes, which is why the harness uses a fixed short prefix
 * under `/tmp` instead of `mkdtemp` under `tmpdir()`.
 */
const SHORT_TMP_ROOT = "/tmp"

/**
 * The directory that holds the production control-seam modules.
 *
 * The worker source is written HERE (not in the temp directory) so the
 * child process resolves `./control-seam-ownership` and
 * `./control-seam-server` to the REAL production modules.
 */
const MODULE_DIR = import.meta.dirname

/**
 * The child-process worker source.
 *
 * The worker runs the REAL production ownership functions in a REAL
 * independent process. The `node:fs` interposition is applied ONLY in
 * the child process and ONLY to park the contender at the exact
 * instruction boundary the interleaving needs.
 */
const WORKER_SOURCE = `
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const [mode, dirPath, barrierPath, resultPath, label] = process.argv.slice(2)

const socketPath = join(dirPath, "control.sock")
const tokenPath = join(dirPath, "token")

/**
 * The cross-process write gate.
 *
 * When RACE_WRITE_GATE is set, the FIRST owner-record write in this
 * process parks on a gate file. The parent releases the gate once every
 * contender has parked. This makes the race deterministic instead of
 * probabilistic: the production read-check has already happened in BOTH
 * contenders before either write lands.
 */
const writeGatePath = process.env.RACE_WRITE_GATE
const parkedPath = process.env.RACE_PARKED_MARKER
const cleanupGatePath = process.env.CLEANUP_GATE
let parked = false

if (writeGatePath || cleanupGatePath) {
	const { mock } = await import("bun:test")
	const realFs = await import("node:fs")
	mock.module("node:fs", () => {
		const patched = { ...realFs }
		const originalWriteFileSync = realFs.writeFileSync
		patched.writeFileSync = ((path, ...rest) => {
			const asString = String(path)
			if (!parked && writeGatePath && asString.includes("owner.json") && asString.includes(".tmp")) {
				parked = true
				try {
					writeFileSync(parkedPath, label + " parked\\n")
				} catch {}
				const deadline = Date.now() + 30000
				while (!existsSync(writeGatePath)) {
					if (Date.now() > deadline) break
				}
			}
			return originalWriteFileSync(path, ...rest)
		})

		const originalRmSync = realFs.rmSync
		let cleanupParked = false
		patched.rmSync = ((path, ...rest) => {
			const asString = String(path)
			if (!cleanupParked && cleanupGatePath && asString.endsWith("control.sock")) {
				cleanupParked = true
				try {
					writeFileSync(cleanupGatePath + ".parked", label + " parked\\n")
				} catch {}
				const deadline = Date.now() + 30000
				while (!existsSync(cleanupGatePath)) {
					if (Date.now() > deadline) break
				}
			}
			return originalRmSync(path, ...rest)
		})
		return patched
	})
}

const { acquireControlSeamOwnership, readControlSeamOwnerRecord, resolveControlSeamOwnerPath } = await import("./control-seam-ownership")

const resolvedOwnerPath = resolveControlSeamOwnerPath(dirPath)

async function waitForBarrier() {
	const deadline = Date.now() + 30000
	while (!existsSync(barrierPath)) {
		if (Date.now() > deadline) throw new Error("barrier timeout")
		await new Promise((resolve) => setTimeout(resolve, 1))
	}
}

const result = { label, mode, pid: process.pid, acquired: false, error: undefined, errorReason: undefined, observedInstanceId: undefined, observedPid: undefined, released: undefined }

try {
	if (mode === "acquire") {
		await waitForBarrier()
		const preExisting = readControlSeamOwnerRecord(resolvedOwnerPath)
		result.observedInstanceId = preExisting?.instanceId
		result.observedPid = preExisting?.pid
		const record = acquireControlSeamOwnership({
			dirPath,
			ownerPath: resolvedOwnerPath,
			token: "token-for-" + label,
			instanceId: label + "-instance",
			env: {},
		})
		result.acquired = true
		result.observedInstanceId = record.instanceId
	} else if (mode === "cleanup") {
		const { ControlSeamServer } = await import("./control-seam-server")
		const authority = {
			readActiveSessionId: () => "session-cor02",
			readActiveTaskId: () => undefined,
			readIsRunning: () => false,
			readQueuedPromptCount: () => 0,
			readRuntimeSnapshot: () => undefined,
			// ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01: the published
			// TaskHeader record is absent in this fixture — the seam
			// therefore omits taskState (no fabricated idle).
			readPublishedTaskState: () => undefined,
			readCurrentEpoch: () => 0,
		}
		const server = new ControlSeamServer({
			authority,
			extensionVersion: "9.9.9-cor02",
			platform: "darwin",
			socketPath,
			tokenPath,
			ownerPath: resolvedOwnerPath,
			dirPath,
			forceEnabled: true,
			env: {},
		})
		const handle = await server.start()
		result.acquired = handle !== undefined
		result.observedInstanceId = handle?.instanceId
		writeFileSync(resultPath + ".started", "started\\n")
		await waitForBarrier()
		const record = readControlSeamOwnerRecord(resolvedOwnerPath)
		result.observedInstanceId = record?.instanceId
		await server.dispose()
		result.released = true
	}
} catch (error) {
	result.error = error.message
	result.errorReason = error.reason
}

writeFileSync(resultPath, JSON.stringify(result, null, 2) + "\\n")
process.exit(0)
`

interface WorkerResult {
	readonly label: string
	readonly mode: string
	readonly pid: number
	readonly acquired: boolean
	readonly error?: string
	readonly errorReason?: string
	readonly observedInstanceId?: string
	readonly observedPid?: number
	readonly released?: boolean
}

interface WorkerHandle {
	readonly child: ReturnType<typeof spawn>
	readonly resultPath: string
	exited: boolean
}

const tempDirs: string[] = []

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop()
		if (dir) {
			try {
				rmSync(dir, { recursive: true, force: true })
			} catch {
				// Best effort.
			}
		}
	}
	// A worker that was killed before it could exit leaves its source
	// file behind. Remove every one of them.
	try {
		for (const entry of readdirSync(MODULE_DIR)) {
			if (entry.startsWith("__cor02-worker-") && entry.endsWith(".ts")) {
				rmSync(join(MODULE_DIR, entry), { force: true })
			}
		}
	} catch {
		// Best effort.
	}
})

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(SHORT_TMP_ROOT, prefix))
	tempDirs.push(dir)
	return dir
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForFiles(paths: string[], timeoutMs = 30_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs
	while (!paths.every((path) => existsSync(path))) {
		if (Date.now() > deadline) {
			return false
		}
		await sleep(2)
	}
	return true
}

/**
 * Spawn a REAL independent worker process.
 *
 * The worker source is written NEXT TO the production module so the
 * child resolves `./control-seam-ownership` and `./control-seam-server`
 * — the REAL production modules, unmodified.
 */
function spawnWorker(
	mode: string,
	dirPath: string,
	barrierPath: string,
	resultPath: string,
	label: string,
	env: NodeJS.ProcessEnv = {},
): WorkerHandle {
	const workerPath = join(MODULE_DIR, `__cor02-worker-${label}-${process.pid}.ts`)
	writeFileSync(workerPath, WORKER_SOURCE)
	const child = spawn(process.execPath, [workerPath, mode, dirPath, barrierPath, resultPath, label], {
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
		cwd: MODULE_DIR,
	})
	child.stdout?.on("data", () => {})
	child.stderr?.on("data", (chunk: Buffer) => {
		process.stderr.write(`[${label}] ${chunk.toString()}`)
	})
	const handle: WorkerHandle = { child, resultPath, exited: false }
	child.on("exit", () => {
		handle.exited = true
		try {
			rmSync(workerPath, { force: true })
		} catch {
			// Best effort.
		}
	})
	return handle
}

async function waitForExit(handle: WorkerHandle): Promise<void> {
	if (handle.exited) {
		return
	}
	await new Promise<void>((resolve) => {
		handle.child.on("exit", () => resolve())
	})
}

async function awaitResult(path: string, timeoutMs = 30_000): Promise<WorkerResult> {
	const deadline = Date.now() + timeoutMs
	while (!existsSync(path)) {
		if (Date.now() > deadline) {
			throw new Error(`timed out waiting for ${path}`)
		}
		await sleep(2)
	}
	await sleep(20)
	return JSON.parse(readFileSync(path, "utf8")) as WorkerResult
}

describe("ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02 — R1 simultaneous acquisition", () => {
	it("COR02-R1: at most ONE process acquires an unowned endpoint, and the loser's record is NOT replaced", async () => {
		const dir = makeTempDir("cor02-r1-")
		const barrier = join(dir, "barrier")
		const writeGate = join(dir, "write-gate")
		const parkedA = join(dir, "parked-a")
		const parkedB = join(dir, "parked-b")
		const resultA = join(dir, "result-a.json")
		const resultB = join(dir, "result-b.json")

		const a = spawnWorker("acquire", dir, barrier, resultA, "A", {
			RACE_WRITE_GATE: writeGate,
			RACE_PARKED_MARKER: parkedA,
		})
		const b = spawnWorker("acquire", dir, barrier, resultB, "B", {
			RACE_WRITE_GATE: writeGate,
			RACE_PARKED_MARKER: parkedB,
		})

		await sleep(800)
		// Release the barrier: both proceed into the acquisition.
		writeFileSync(barrier, "go\n")

		// Wait until BOTH contenders have passed their read-check and
		// parked. This is what makes the interleaving deterministic.
		const bothParked = await waitForFiles([parkedA, parkedB], 30_000)
		expect(bothParked, "both contenders must reach the write gate").toBe(true)

		// Release both writes. Both had already observed an unowned
		// endpoint, so both had already passed their check.
		writeFileSync(writeGate, "go\n")

		const [resA, resB] = await Promise.all([awaitResult(resultA), awaitResult(resultB)])
		await Promise.all([waitForExit(a), waitForExit(b)])

		// INVARIANT 1: at most one process acquires the endpoint.
		expect(resA.acquired && resB.acquired, "both processes must NOT report a successful acquisition").toBe(false)
		expect(resA.acquired || resB.acquired, "exactly one process must acquire the endpoint").toBe(true)

		// INVARIANT 2: the loser changed nothing — the owner's record,
		// token fingerprint and pid survive untouched.
		const ownerPath = resolveControlSeamOwnerPath(dir)
		const owner = readControlSeamOwnerRecord(ownerPath)
		expect(owner, "the owner's record must survive the losing contender").toBeDefined()
		const winner = resA.acquired ? resA : resB
		const loser = resA.acquired ? resB : resA
		expect(owner?.instanceId).toBe(winner.observedInstanceId)
		expect(owner?.pid).toBe(winner.pid)
		expect(loser.errorReason).toBe("live-owner")
		expect(loser.error).toMatch(/already owned by a live instance/)
	}, 60_000)
})

describe("ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02 — R2 cleanup versus acquisition", () => {
	it("COR02-R2: ownership is held until the cleanup finishes, and a contender cannot take the endpoint underneath it", async () => {
		const dir = makeTempDir("cor02-r2-")
		const barrier = join(dir, "barrier")
		const socketPath = join(dir, "control.sock")
		const tokenPath = join(dir, "token")
		const ownerPath = resolveControlSeamOwnerPath(dir)
		const cleanupResult = join(dir, "result-cleanup.json")
		const acquireResult = join(dir, "result-acquire.json")
		const cleanupGate = join(dir, "cleanup-gate")

		// Instance A is a REAL started `ControlSeamServer`: it owns the
		// endpoint and has published its socket and token.
		const a = spawnWorker("cleanup", dir, barrier, cleanupResult, "A", {
			CLEANUP_GATE: cleanupGate,
		})
		const aStarted = await waitForFiles([`${cleanupResult}.started`], 30_000)
		expect(aStarted, "instance A must start the control seam").toBe(true)
		await sleep(300)

		// Order A's cleanup. A parks INSIDE the production cleanup, on
		// the socket removal.
		writeFileSync(barrier, "go\n")
		const aParked = await waitForFiles([`${cleanupGate}.parked`], 30_000)
		expect(aParked, "instance A must reach the production cleanup gate").toBe(true)
		await sleep(200)

		// INVARIANT 3: the ownership record is STILL PRESENT while the
		// cleanup is removing the owned artifacts.
		expect(existsSync(ownerPath), "ownership must be held until the cleanup finishes").toBe(true)
		const ownerDuringCleanup = readControlSeamOwnerRecord(ownerPath)
		expect(ownerDuringCleanup).toBeDefined()

		// Instance B tries to acquire the endpoint while A is cleaning up.
		const b = spawnWorker("acquire", dir, join(dir, "barrier-b"), acquireResult, "B")
		await sleep(200)
		writeFileSync(join(dir, "barrier-b"), "go\n")
		const resB = await awaitResult(acquireResult)
		await waitForExit(b)

		// The contender must fail closed: A's live owner still holds
		// the exclusive claim.
		expect(resB.acquired, "the contender must NOT acquire the endpoint").toBe(false)
		expect(resB.errorReason).toBe("live-owner")

		// A completes its cleanup.
		await sleep(300)
		writeFileSync(cleanupGate, "go\n")
		const resA = await awaitResult(cleanupResult)
		await waitForExit(a)

		expect(resA.acquired, "instance A must have owned the endpoint").toBe(true)
		expect(resA.released, "instance A must have completed its cleanup").toBe(true)

		// INVARIANT 4: the cleanup removed only its OWN artifacts. The
		// contender never published any, so nothing of its own is lost;
		// and A's own artifacts are gone.
		expect(existsSync(socketPath), "the owner's own socket must be removed by its own cleanup").toBe(false)
		expect(existsSync(tokenPath), "the owner's own token must be removed by its own cleanup").toBe(false)
		expect(existsSync(ownerPath), "the ownership record must be released after the cleanup").toBe(false)
	}, 60_000)
})

describe("ACT-CLINEMM-MCP-OWNER-EXCLUSIVITY-CORR02 — the exclusive claim itself", () => {
	it("COR02-C1: the ownership claim is an EXCLUSIVE create — a second claim on the same path fails", () => {
		const dir = makeTempDir("cor02-c1-")
		const ownerPath = resolveControlSeamOwnerPath(dir)
		const first = acquireControlSeamOwnership({
			dirPath: dir,
			ownerPath,
			token: "t".repeat(64),
			instanceId: "first-instance",
			env: {},
		})
		expect(first.instanceId).toBe("first-instance")

		// The second claim on the SAME path must fail closed: the record
		// names a live pid (this process), so the endpoint is busy.
		expect(() =>
			acquireControlSeamOwnership({
				dirPath: dir,
				ownerPath,
				token: "u".repeat(64),
				instanceId: "second-instance",
				env: {},
			}),
		).toThrow(/already owned by a live instance/)

		// The first claim's record is UNCHANGED.
		const owner = readControlSeamOwnerRecord(ownerPath)
		expect(owner?.instanceId).toBe("first-instance")
		expect(owner?.pid).toBe(process.pid)
	})

	it("COR02-C2: a CRASHED owner fails closed — the stale record is reclaimed only under the exclusive reclaim token", () => {
		const dir = makeTempDir("cor02-c2-")
		const ownerPath = resolveControlSeamOwnerPath(dir)
		// A record whose pid is provably gone: the owner crashed.
		writeFileSync(
			ownerPath,
			`${JSON.stringify({ v: 1, instanceId: "crashed-instance", pid: 999_999_999, startedAt: 1, tokenFingerprint: "x" }, null, 2)}\n`,
		)
		const record = acquireControlSeamOwnership({
			dirPath: dir,
			ownerPath,
			token: "v".repeat(64),
			instanceId: "reclaiming-instance",
			env: {},
		})
		expect(record.instanceId).toBe("reclaiming-instance")
		const owner = readControlSeamOwnerRecord(ownerPath)
		expect(owner?.instanceId).toBe("reclaiming-instance")
		// The transient reclaim token is released again.
		expect(existsSync(resolveControlSeamOwnerReclaimPath(dir))).toBe(false)
	})

	it("COR02-C3: the FORCE escape hatch breaks an UNREADABLE owner record", () => {
		const dir = makeTempDir("cor02-c3-")
		const ownerPath = resolveControlSeamOwnerPath(dir)
		writeFileSync(ownerPath, "this is not json")

		// Without FORCE, an unreadable record fails closed.
		expect(() => acquireControlSeamOwnership({ dirPath: dir, ownerPath, token: "w".repeat(64), env: {} })).toThrow(
			/could not be read/,
		)

		// With FORCE, the operator breaks it.
		const record = acquireControlSeamOwnership({
			dirPath: dir,
			ownerPath,
			token: "w".repeat(64),
			instanceId: "forced-instance",
			env: { [CONTROL_SEAM_FORCE_ENV_VAR]: "1" },
		})
		expect(record.instanceId).toBe("forced-instance")
		expect(readControlSeamOwnerRecord(ownerPath)?.instanceId).toBe("forced-instance")
	})
})
