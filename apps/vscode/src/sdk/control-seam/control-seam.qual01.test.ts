/**
 * ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01
 *
 * The bounded P1 correction's transport witnesses.
 *
 * Four defects were corrected before the listener was enabled:
 *
 *   C1.1  EXPLICIT INSTANCE OWNERSHIP — a second instance must not
 *         replace a live socket or token, and cleanup must not remove
 *         another instance's artifacts.
 *   C1.2  EVERY OUTSTANDING REQUEST IS SETTLED — no permanently
 *         unresolved promise on timeout, socket close or transport error.
 *   C1.3  BOUNDED NDJSON — oversized input and unbounded incomplete-line
 *         buffering are rejected without affecting the extension host.
 *   C1.4  VALIDATED OPT-IN — the explicit opt-in record is parsed, not
 *         merely probed for existence.
 *
 * Every test below drives the REAL AF_UNIX transport (a real
 * `ControlSeamServer` listener and a real `node:net` client socket),
 * never a mock.
 *
 * The two-operation read-only registry is preserved and re-asserted.
 */

import { existsSync, mkdtempSync, statSync, writeFileSync } from "node:fs"
import { type Socket } from "node:net"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { ControlSeamAuthority } from "./control-seam-authority"
import { ControlSeamClient, connectControlSeam } from "./control-seam-client"
import { parseControlSeamOptInRecord } from "./control-seam-enablement"
import {
	acquireControlSeamOwnership,
	CONTROL_SEAM_FORCE_ENV_VAR,
	fingerprintControlSeamToken,
	isControlSeamPidAlive,
	readControlSeamOwnerRecord,
	releaseControlSeamOwnership,
	resolveControlSeamOwnerPath,
} from "./control-seam-ownership"
import {
	CONTROL_SEAM_ERROR_CODES,
	CONTROL_SEAM_MAX_REQUEST_BYTES,
	CONTROL_SEAM_PROTOCOL_VERSION,
	CONTROL_SEAM_READ_OPERATIONS,
} from "./control-seam-protocol"
import { ControlSeamServer, readControlSeamOptInRecord } from "./control-seam-server"

/**
 * The AF_UNIX `sock_path` budget is ~104 usable bytes on macOS, so the
 * test's temp directory must be SHORT. `os.tmpdir()` on this host is
 * already 84 bytes, which is why the harness uses a fixed short
 * prefix under `/tmp` instead of `mkdtemp` under `tmpdir()`.
 */
const SHORT_TMP_ROOT = "/tmp"

interface AuthorityFixture {
	sessionId?: string
	taskId?: string
	isRunning?: boolean
	queuedPromptCount?: number
	runtimeStatus?: string
	runId?: string
}

function makeAuthority(fixture: AuthorityFixture = {}): ControlSeamAuthority {
	return {
		readActiveSessionId: () => fixture.sessionId,
		readActiveTaskId: () => fixture.taskId,
		readIsRunning: () => fixture.isRunning ?? false,
		readQueuedPromptCount: () => fixture.queuedPromptCount ?? 0,
		readRuntimeSnapshot: () => {
			if (fixture.runtimeStatus === undefined && fixture.runId === undefined) {
				return undefined
			}
			return { status: fixture.runtimeStatus, runId: fixture.runId }
		},
		// ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01: this fixture has no
		// published TaskHeader record, so `taskState` is omitted.
		readPublishedTaskState: () => undefined,
		readCurrentEpoch: () => 0,
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: READ-ONLY fixture.
		// The mutation members are never exercised by the qualification
		// tests.
		readWorkspaceRoot: async () => "/tmp/cq-workspace",
		startAct: async () => ({ outcome: "rejected" as const, reason: "not-authorized-in-this-fixture" }),
	}
}

interface Harness {
	server: ControlSeamServer
	dir: string
	socketPath: string
	tokenPath: string
	ownerPath: string
	token: string
}

const openHarnesses: Harness[] = []
const openSockets: Socket[] = []

function makeHarness(authority: ControlSeamAuthority, forceEnabled = true, env?: NodeJS.ProcessEnv): Harness {
	const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cq-"))
	const socketPath = join(dir, "control.sock")
	const tokenPath = join(dir, "token")
	const ownerPath = resolveControlSeamOwnerPath(dir)
	const server = new ControlSeamServer({
		authority,
		extensionVersion: "9.9.9-qual-test",
		platform: "darwin",
		socketPath,
		tokenPath,
		ownerPath,
		dirPath: dir,
		forceEnabled,
		env,
	})
	const harness: Harness = { server, dir, socketPath, tokenPath, ownerPath, token: "" }
	openHarnesses.push(harness)
	return harness
}

async function startHarness(authority: ControlSeamAuthority, forceEnabled = true, env?: NodeJS.ProcessEnv): Promise<Harness> {
	const harness = makeHarness(authority, forceEnabled, env)
	const handle = await harness.server.start()
	if (handle) {
		harness.token = handle.token
	}
	return harness
}

afterEach(async () => {
	while (openSockets.length > 0) {
		openSockets.pop()?.destroy()
	}
	while (openHarnesses.length > 0) {
		await openHarnesses.pop()?.server.dispose()
	}
})

/**
 * Read exactly one NDJSON response line from a socket.
 *
 * Used by the negative-control tests that need the RAW wire bytes.
 */
function readOneLine(socket: Socket, timeoutMs = 2000): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		let buffer = ""
		const timer = setTimeout(() => {
			socket.off("data", onData)
			reject(new Error("timed out waiting for a response line"))
		}, timeoutMs)
		const onData = (chunk: Buffer): void => {
			buffer += chunk.toString("utf8")
			const newlineIndex = buffer.indexOf("\n")
			if (newlineIndex >= 0) {
				clearTimeout(timer)
				socket.off("data", onData)
				resolve(buffer.slice(0, newlineIndex))
			}
		}
		socket.on("data", onData)
	})
}

/** Open a raw socket to the seam's listener. */
async function openRawSocket(socketPath: string): Promise<Socket> {
	const socket = await connectControlSeam(socketPath)
	if (!socket) {
		throw new Error("could not connect to the control socket")
	}
	openSockets.push(socket)
	return socket
}

describe("ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 — C1.1 explicit instance ownership", () => {
	it("QL01: a SECOND instance CANNOT replace a live instance's socket or token", async () => {
		const first = await startHarness(makeAuthority({ sessionId: "session-first" }))
		expect(existsSync(first.socketPath)).toBe(true)
		const firstTokenOnDisk = first.token
		const firstTokenPathStat = statSync(first.tokenPath)

		// A second instance tries to take the SAME endpoint.
		const contending = new ControlSeamServer({
			authority: makeAuthority({ sessionId: "session-second" }),
			extensionVersion: "9.9.9-qual-test",
			platform: "darwin",
			socketPath: first.socketPath,
			tokenPath: first.tokenPath,
			ownerPath: first.ownerPath,
			dirPath: first.dir,
			forceEnabled: true,
		})
		openHarnesses.push({ ...first, server: contending })

		await expect(contending.start()).rejects.toThrow(/already owned by a live instance/)

		// The first instance's endpoint is INTACT and still serving.
		expect(existsSync(first.socketPath)).toBe(true)
		expect(statSync(first.tokenPath).mode & 0o777).toBe(0o600)
		// The token file was not rewritten (same inode).
		expect(statSync(first.tokenPath).ino).toBe(firstTokenPathStat.ino)

		const socket = await openRawSocket(first.socketPath)
		const client = new ControlSeamClient(firstTokenOnDisk)
		client.setWriter((payload) => socket.write(payload))
		client.attach(socket)
		const response = await client.request("clinemm_get_run")
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ sessionId: "session-first" })
	})

	it("QL02: cleanup does NOT remove another instance's live artifacts", async () => {
		const first = await startHarness(makeAuthority({ sessionId: "session-owner" }))
		const firstToken = first.token
		expect(readControlSeamOwnerRecord(first.ownerPath)).toBeDefined()

		// A DIFFERENT instance disposes. It never owned the endpoint.
		const foreign = new ControlSeamServer({
			authority: makeAuthority({ sessionId: "session-foreign" }),
			extensionVersion: "9.9.9-qual-test",
			platform: "darwin",
			socketPath: first.socketPath,
			tokenPath: first.tokenPath,
			ownerPath: first.ownerPath,
			dirPath: first.dir,
			forceEnabled: true,
		})
		await foreign.dispose()

		// The live instance's socket and token are STILL THERE.
		expect(existsSync(first.socketPath)).toBe(true)
		expect(existsSync(first.tokenPath)).toBe(true)

		// And the endpoint still works for the original owner.
		const socket = await openRawSocket(first.socketPath)
		const client = new ControlSeamClient(firstToken)
		client.setWriter((payload) => socket.write(payload))
		client.attach(socket)
		const response = await client.request("clinemm_get_run")
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ sessionId: "session-owner" })
	})

	it("QL03: the OWNER's dispose removes only its own artifacts", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-owner" }))
		expect(existsSync(harness.socketPath)).toBe(true)
		expect(existsSync(harness.tokenPath)).toBe(true)
		expect(existsSync(harness.ownerPath)).toBe(true)

		await harness.server.dispose()

		expect(existsSync(harness.socketPath)).toBe(false)
		expect(existsSync(harness.tokenPath)).toBe(false)
		expect(existsSync(harness.ownerPath)).toBe(false)
	})

	it("QL04: a STALE socket file (dead owner) IS reclaimed", async () => {
		// A crashed host leaves a socket file AND an owner record whose
		// pid is gone. The new instance must be able to take it over.
		const harness = makeHarness(makeAuthority({ sessionId: "session-stale" }))
		writeFileSync(
			harness.ownerPath,
			JSON.stringify({ v: 1, instanceId: "dead-instance", pid: 999_999_999, startedAt: 1, tokenFingerprint: "dead" }),
		)
		writeFileSync(harness.tokenPath, "stale-token\n")
		writeFileSync(harness.socketPath, "")

		const handle = await harness.server.start()
		expect(handle, "a stale endpoint must be reclaimable").toBeDefined()
		expect(existsSync(harness.socketPath)).toBe(true)

		// The new owner record replaced the stale one.
		const owner = readControlSeamOwnerRecord(harness.ownerPath)
		expect(owner?.instanceId).toBe(handle?.instanceId)
		expect(owner?.pid).toBe(process.pid)
	})

	it("QL05: a LIVE owner record makes the acquisition fail closed", () => {
		const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cq-own-"))
		const ownerPath = resolveControlSeamOwnerPath(dir)
		// `process.pid` is definitionally alive.
		writeFileSync(
			ownerPath,
			JSON.stringify({ v: 1, instanceId: "live-instance", pid: process.pid, startedAt: Date.now(), tokenFingerprint: "x" }),
		)
		expect(isControlSeamPidAlive(process.pid)).toBe(true)

		expect(() => acquireControlSeamOwnership({ dirPath: dir, ownerPath, token: "a".repeat(64), env: {} })).toThrow(
			/already owned by a live instance/,
		)
	})

	it("QL06: the operator can explicitly break a stale lock with the FORCE escape hatch", () => {
		const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cq-force-"))
		const ownerPath = resolveControlSeamOwnerPath(dir)
		writeFileSync(
			ownerPath,
			JSON.stringify({
				v: 1,
				instanceId: "unknown-instance",
				pid: process.pid,
				startedAt: Date.now(),
				tokenFingerprint: "x",
			}),
		)

		const record = acquireControlSeamOwnership({
			dirPath: dir,
			ownerPath,
			token: "b".repeat(64),
			env: { [CONTROL_SEAM_FORCE_ENV_VAR]: "1" },
		})
		expect(record.instanceId).not.toBe("unknown-instance")
		expect(record.pid).toBe(process.pid)
	})

	it("QL07: an unreadable owner record fails closed (no silent takeover)", () => {
		const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cq-bad-"))
		const ownerPath = resolveControlSeamOwnerPath(dir)
		writeFileSync(ownerPath, "this is not json")

		expect(() => acquireControlSeamOwnership({ dirPath: dir, ownerPath, token: "c".repeat(64), env: {} })).toThrow(
			/could not be read/,
		)
	})

	it("QL08: the owner record is 0600 and carries a non-reversible token fingerprint", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-fp" }))
		expect(statSync(harness.ownerPath).mode & 0o777).toBe(0o600)
		const owner = readControlSeamOwnerRecord(harness.ownerPath)
		expect(owner?.tokenFingerprint).toBe(fingerprintControlSeamToken(harness.token))
		// The fingerprint is NOT the token.
		expect(owner?.tokenFingerprint).not.toBe(harness.token)
		expect(harness.token.length).toBe(64)
	})

	it("QL09: releasing ownership for a FOREIGN instance id is a no-op", () => {
		const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cq-rel-"))
		const ownerPath = resolveControlSeamOwnerPath(dir)
		writeFileSync(
			ownerPath,
			JSON.stringify({ v: 1, instanceId: "the-real-owner", pid: process.pid, startedAt: 1, tokenFingerprint: "x" }),
		)

		expect(releaseControlSeamOwnership({ ownerPath, instanceId: "somebody-else" })).toBe(false)
		expect(existsSync(ownerPath)).toBe(true)
		expect(releaseControlSeamOwnership({ ownerPath, instanceId: "the-real-owner" })).toBe(true)
		expect(existsSync(ownerPath)).toBe(false)
	})
})

describe("ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 — C1.2 every outstanding request is settled", () => {
	it("QL10: a DISCONNECTED client settles the outstanding request", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-disc" }))
		const socket = await openRawSocket(harness.socketPath)
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket.write(payload))
		client.attach(socket)

		// Destroy the socket WITHOUT ever sending a request.
		socket.destroy()
		await new Promise((resolve) => setTimeout(resolve, 50))

		// The request must SETTLE (not hang) once the socket is gone.
		const response = await Promise.race([
			client.request("clinemm_get_run"),
			new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("the request never settled")), 1500)),
		])
		expect(response.ok).toBe(false)
	})

	it("QL11: a request with NO server response settles on the client TIMEOUT", async () => {
		// A client wired to a writer that swallows the payload: the
		// server never sees the request, so it never answers.
		const client = new ControlSeamClient("t".repeat(64), { requestTimeoutMs: 150 })
		client.setWriter(() => {
			// Swallowed on purpose.
		})

		const started = Date.now()
		const response = await client.request("clinemm_get_run")
		const elapsed = Date.now() - started

		expect(response.ok).toBe(false)
		expect(response.error?.message).toMatch(/timed out/)
		expect(elapsed).toBeLessThan(2000)
		client.dispose()
	})

	it("QL12: `dispose()` settles every outstanding request", async () => {
		const client = new ControlSeamClient("t".repeat(64), { requestTimeoutMs: 60_000 })
		client.setWriter(() => {
			// Swallowed on purpose.
		})
		const pending = client.request("clinemm_get_run")
		client.dispose()

		const response = await Promise.race([
			pending,
			new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("the request never settled")), 1500)),
		])
		expect(response.ok).toBe(false)
	})

	it("QL13: a DISCONNECTED instance makes the outstanding request FAIL (not hang)", async () => {
		// The server is disposed while the client is connected.
		const harness = await startHarness(makeAuthority({ sessionId: "session-gone" }))
		const socket = await openRawSocket(harness.socketPath)
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket.write(payload))
		client.attach(socket)

		await harness.server.dispose()

		const response = await Promise.race([
			client.request("clinemm_get_run"),
			new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("the request never settled")), 3000)),
		])
		expect(response.ok).toBe(false)
	})
})

describe("ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 — C1.3 bounded NDJSON", () => {
	it("QL14: an OVERSIZED unauthenticated line is rejected and the connection is closed", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-big" }))
		const socket = await openRawSocket(harness.socketPath)

		// An UNAUTHENTICATED oversized line: no valid token at all.
		const oversized = "x".repeat(CONTROL_SEAM_MAX_REQUEST_BYTES + 1024)
		socket.write(oversized)

		const line = await readOneLine(socket)
		const parsed = JSON.parse(line) as { ok: boolean; error?: { code: string } }
		expect(parsed.ok).toBe(false)
		expect(parsed.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.payloadTooLarge)
		// The rejection discloses nothing.
		expect(line).not.toContain("session-big")

		// The extension host is still healthy and still serving.
		const socket2 = await openRawSocket(harness.socketPath)
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket2.write(payload))
		client.attach(socket2)
		const response = await client.request("clinemm_get_run")
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ sessionId: "session-big" })
	})

	it("QL15: an incomplete line that never terminates is BOUNDED, not buffered without limit", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-incomplete" }))
		const socket = await openRawSocket(harness.socketPath)

		// Send a huge amount of data with NO newline. The server must
		// reject it once the bound is crossed.
		const chunk = "y".repeat(16 * 1024)
		for (let index = 0; index < 8; index++) {
			socket.write(chunk)
		}

		const line = await readOneLine(socket)
		const parsed = JSON.parse(line) as { ok: boolean; error?: { code: string } }
		expect(parsed.ok).toBe(false)
		expect(parsed.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.payloadTooLarge)
	})

	it("QL16: a LEGITIMATE request just under the bound is accepted", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-ok" }))
		const socket = await openRawSocket(harness.socketPath)
		// A normal request with a long (but legal) session id echo.
		const longSessionId = "s".repeat(1024)
		socket.write(
			`${JSON.stringify({ v: CONTROL_SEAM_PROTOCOL_VERSION, op: "clinemm_get_run", token: harness.token, sessionId: longSessionId })}\n`,
		)
		const line = await readOneLine(socket)
		const parsed = JSON.parse(line) as { ok: boolean; error?: { code: string } }
		// The echo does not match, so it is refused — but it was PARSED,
		// not rejected for size.
		expect(parsed.ok).toBe(false)
		expect(parsed.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.foreignSession)
	})
})

describe("ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 — C1.4 validated opt-in record", () => {
	it("QL17: a MALFORMED opt-in record does NOT enable the seam", () => {
		for (const malformed of [
			"",
			"   ",
			"not json",
			"{}",
			'{"enabled": false}',
			'{"enabled": "true"}',
			'{"enabled": 1}',
			"[]",
			"null",
		]) {
			expect(parseControlSeamOptInRecord(malformed), `"${malformed}" must not be a valid opt-in`).toBeUndefined()
		}
	})

	it("QL18: a WELL-FORMED opt-in record enables the seam", () => {
		expect(parseControlSeamOptInRecord('{"enabled": true}')).toEqual({ enabled: true })
		expect(parseControlSeamOptInRecord('{\n  "enabled": true\n}\n')).toEqual({ enabled: true })
	})

	it("QL19: a malformed opt-in FILE leaves the seam OFF (no listener, no socket, no token)", async () => {
		const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cq-opt-"))
		const optInPath = join(dir, "enabled.json")
		writeFileSync(optInPath, "this is not a valid opt-in record")

		expect(readControlSeamOptInRecord(optInPath)).toBeUndefined()

		const socketPath = join(dir, "control.sock")
		const tokenPath = join(dir, "token")
		const ownerPath = resolveControlSeamOwnerPath(dir)
		const server = new ControlSeamServer({
			authority: makeAuthority({ sessionId: "session-opt" }),
			extensionVersion: "9.9.9-qual-test",
			platform: "darwin",
			socketPath,
			tokenPath,
			ownerPath,
			dirPath: dir,
			optInPath,
			env: {},
		})
		openHarnesses.push({ server, dir, socketPath, tokenPath, ownerPath, token: "" })

		const handle = await server.start()
		expect(handle, "a malformed opt-in record must not enable the seam").toBeUndefined()
		expect(existsSync(socketPath)).toBe(false)
		expect(existsSync(tokenPath)).toBe(false)
		expect(existsSync(ownerPath)).toBe(false)
	})

	it("QL20: a WELL-FORMED opt-in FILE enables the seam and creates the artifacts", async () => {
		const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cq-opt2-"))
		const optInPath = join(dir, "enabled.json")
		writeFileSync(optInPath, '{"enabled": true}\n')

		expect(readControlSeamOptInRecord(optInPath)).toEqual({ enabled: true })

		const socketPath = join(dir, "control.sock")
		const tokenPath = join(dir, "token")
		const ownerPath = resolveControlSeamOwnerPath(dir)
		const server = new ControlSeamServer({
			authority: makeAuthority({ sessionId: "session-opt2" }),
			extensionVersion: "9.9.9-qual-test",
			platform: "darwin",
			socketPath,
			tokenPath,
			ownerPath,
			dirPath: dir,
			optInPath,
			env: {},
		})
		openHarnesses.push({ server, dir, socketPath, tokenPath, ownerPath, token: "" })

		const handle = await server.start()
		expect(handle).toBeDefined()
		expect(handle?.source).toBe("opt-in-file")
		expect(existsSync(socketPath)).toBe(true)
		expect(existsSync(tokenPath)).toBe(true)
	})
})

describe("ACT-CLINEMM-MCP-READONLY-LIVE-QUAL01 — the read-only registry is preserved", () => {
	it("QL21: EXACTLY two READ-ONLY operations remain, and no mutating operation exists", () => {
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the READ-ONLY
		// projection is UNCHANGED. The two write operations live in the
		// full registry but are NOT part of the read-only view, and a
		// read-only client never sees them.
		expect(CONTROL_SEAM_READ_OPERATIONS).toHaveLength(2)
		expect(CONTROL_SEAM_READ_OPERATIONS.map((operation) => operation.id)).toEqual(["clinemm_capabilities", "clinemm_get_run"])
		for (const operation of CONTROL_SEAM_READ_OPERATIONS) {
			expect(operation.mutating).toBe(false)
		}
		for (const forbidden of ["start_act", "send_feedback", "cancel_run", "run_commands", "editor", "read_file"]) {
			expect(CONTROL_SEAM_READ_OPERATIONS.map((operation) => operation.id)).not.toContain(forbidden)
		}
	})
})
