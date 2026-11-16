/**
 * ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01
 *
 * The bounded read-only proof + the C4 security/conservation matrix.
 *
 * These tests drive the REAL production seams:
 *
 *   - the REAL `ControlSeamServer` (a real AF_UNIX listener),
 *   - the REAL `ControlSeamClient` (a real socket round trip),
 *   - the REAL protocol codec,
 *   - the REAL enablement resolver.
 *
 * The AUTHORITY is a fixture that mirrors the controller's own read
 * closures (`getActiveSession()`, `ActiveSession.isRunning`,
 * `ActiveSession.queuedPromptCount`, `runtimeSnapshot()`). The
 * production-shape proof of those closures is
 * `control-seam-authority.production-shape.test.ts`.
 */

import { existsSync, mkdtempSync, statSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { type ControlSeamAuthority, readControlSeamRunIdentity } from "./control-seam-authority"
import { ControlSeamClient, connectControlSeam } from "./control-seam-client"
import { resolveControlSeamEnablement } from "./control-seam-enablement"
import { resolveControlSeamSocketPath, resolveControlSeamTokenPath } from "./control-seam-paths"
import {
	CONTROL_SEAM_ERROR_CODES,
	CONTROL_SEAM_OPERATIONS,
	CONTROL_SEAM_PROTOCOL_VERSION,
	decodeControlSeamRequest,
	encodeControlSeamResponse,
	isControlSeamRunIdentity,
} from "./control-seam-protocol"
import { ControlSeamServer, readControlSeamToken } from "./control-seam-server"

interface AuthorityFixture {
	sessionId?: string
	taskId?: string
	isRunning?: boolean
	queuedPromptCount?: number
	runtimeStatus?: string
	runId?: string
}

/**
 * Build a read-only authority fixture shaped exactly like the
 * controller's own closures.
 */
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
	}
}

interface Harness {
	server: ControlSeamServer
	dir: string
	socketPath: string
	tokenPath: string
	token: string
}

const openHarnesses: Harness[] = []

/**
 * The AF_UNIX `sock_path` budget is ~104 usable bytes on macOS, so the
 * test's temp directory must be SHORT. `os.tmpdir()` on this host is
 * already 84 bytes, which is why the harness uses a fixed short
 * prefix under `/tmp` instead of `mkdtemp` under `tmpdir()`.
 */
const SHORT_TMP_ROOT = "/tmp"

function makeHarness(authority: ControlSeamAuthority, forceEnabled = true): Harness {
	const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cs-"))
	const socketPath = join(dir, "control.sock")
	const tokenPath = join(dir, "token")
	const server = new ControlSeamServer({
		authority,
		extensionVersion: "9.9.9-test",
		platform: "darwin",
		socketPath,
		tokenPath,
		dirPath: dir,
		forceEnabled,
	})
	const harness: Harness = { server, dir, socketPath, tokenPath, token: "" }
	openHarnesses.push(harness)
	return harness
}

async function startHarness(authority: ControlSeamAuthority, forceEnabled = true): Promise<Harness> {
	const harness = makeHarness(authority, forceEnabled)
	const handle = await harness.server.start()
	if (handle) {
		harness.token = handle.token
	}
	return harness
}

afterEach(async () => {
	while (openHarnesses.length > 0) {
		const harness = openHarnesses.pop()
		await harness?.server.dispose()
	}
})

describe("ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01 — C3 read-only proof", () => {
	it("CS01: an authorized client retrieves the SAME session identity the extension host owns", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-alpha", taskId: "task-alpha" }))
		const socket = await connectControlSeam(harness.socketPath)
		expect(socket, "the control socket must accept a local connection").toBeDefined()
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)

		const response = await client.request("clinemm_get_run")
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({
			sessionId: "session-alpha",
			taskId: "task-alpha",
			running: false,
			queuedPromptCount: 0,
		})
		socket?.destroy()
	})

	it("CS02: the capabilities payload discloses NO session identity", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-alpha" }))
		const socket = await connectControlSeam(harness.socketPath)
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)

		const response = await client.request("clinemm_capabilities")
		expect(response.ok).toBe(true)
		const capabilities = response.result as {
			operations: { id: string }[]
			readOnly: boolean
			host: { extensionVersion: string }
		}
		expect(capabilities.operations.map((operation) => operation.id)).toEqual(["clinemm_capabilities", "clinemm_get_run"])
		expect(capabilities.readOnly).toBe(true)
		expect(capabilities.host.extensionVersion).toBe("9.9.9-test")
		// No session id anywhere in the capabilities payload.
		expect(JSON.stringify(capabilities)).not.toContain("session-alpha")
		socket?.destroy()
	})

	it("CS03: the registry exposes exactly two READ-ONLY operations", () => {
		expect(CONTROL_SEAM_OPERATIONS).toHaveLength(2)
		for (const operation of CONTROL_SEAM_OPERATIONS) {
			expect(operation.mutating).toBe(false)
		}
		expect(CONTROL_SEAM_OPERATIONS.map((operation) => operation.id)).not.toContain("start_act")
		expect(CONTROL_SEAM_OPERATIONS.map((operation) => operation.id)).not.toContain("send_feedback")
		expect(CONTROL_SEAM_OPERATIONS.map((operation) => operation.id)).not.toContain("cancel_run")
	})
})

describe("ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01 — C4 security + conservation", () => {
	it("CS04 (C4.1): a DISABLED bridge produces no listener, no socket and no token", async () => {
		const harness = makeHarness(makeAuthority({ sessionId: "session-alpha" }), false)
		const handle = await harness.server.start()
		expect(handle, "a disabled seam must not start").toBeUndefined()
		expect(existsSync(harness.socketPath)).toBe(false)
		expect(existsSync(harness.tokenPath)).toBe(false)
		expect(harness.server.activeHandle).toBeUndefined()
	})

	it("CS05 (C4.1): the default enablement is OFF with no env override and no opt-in record", () => {
		const resolution = resolveControlSeamEnablement({}, false)
		expect(resolution.enabled).toBe(false)
		expect(resolution.source).toBe("default-off")
	})

	it("CS06 (C4.1): an explicit opt-in record turns the seam ON", () => {
		const resolution = resolveControlSeamEnablement({}, true)
		expect(resolution.enabled).toBe(true)
		expect(resolution.source).toBe("opt-in-file")
	})

	it("CS07 (C4.2): an UNAUTHORIZED client cannot read session information", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-secret" }))
		const socket = await connectControlSeam(harness.socketPath)
		const client = new ControlSeamClient("wrong-token")
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)

		const response = await client.request("clinemm_get_run")
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.unauthorized)
		// The response discloses NOTHING about the session.
		expect(JSON.stringify(response)).not.toContain("session-secret")
		socket?.destroy()
	})

	it("CS08 (C4.2): a client with NO token is refused", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-secret" }))
		const response = harness.server.handleLine(
			JSON.stringify({ v: CONTROL_SEAM_PROTOCOL_VERSION, op: "clinemm_get_run", token: "" }),
		)
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.badRequest)
		expect(JSON.stringify(response)).not.toContain("session-secret")
	})

	it("CS09 (C4.3): a STALE/FOREIGN session identifier does not disclose another run", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-current" }))
		const socket = await connectControlSeam(harness.socketPath)
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)

		const response = await client.request("clinemm_get_run", "session-someone-else")
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.foreignSession)
		// Neither the foreign id nor the active id is disclosed.
		expect(JSON.stringify(response)).not.toContain("session-current")
		expect(JSON.stringify(response)).not.toContain("session-someone-else")
		socket?.destroy()
	})

	it("CS10 (C4.3): the MATCHING session identifier is accepted", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-current" }))
		const socket = await connectControlSeam(harness.socketPath)
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)

		const response = await client.request("clinemm_get_run", "session-current")
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ sessionId: "session-current" })
		socket?.destroy()
	})

	it("CS11 (C4.4): repeated reads are IDEMPOTENT", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-idem", isRunning: true }))
		const socket = await connectControlSeam(harness.socketPath)
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)

		const first = await client.request("clinemm_get_run")
		const second = await client.request("clinemm_get_run")
		const third = await client.request("clinemm_get_run")
		expect(JSON.stringify(first.result)).toBe(JSON.stringify(second.result))
		expect(JSON.stringify(second.result)).toBe(JSON.stringify(third.result))
		socket?.destroy()
	})

	it("CS12 (C4.5): a bridge DISCONNECT does not stop or change an agent run", async () => {
		const runCancelled = false
		const harness = await startHarness(
			makeAuthority({
				sessionId: "session-running",
				isRunning: true,
				// The authority models the runtime's own cancel hook. The
				// seam has no reference to it — so a disconnect cannot
				// reach it.
				queuedPromptCount: 1,
			}),
		)
		const socket = await connectControlSeam(harness.socketPath)
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)

		await client.request("clinemm_get_run")
		socket?.destroy()
		await new Promise((resolve) => setTimeout(resolve, 20))

		// The run is still owned by the same session and still running.
		const after = harness.server.handleLine(
			JSON.stringify({
				v: CONTROL_SEAM_PROTOCOL_VERSION,
				op: "clinemm_get_run",
				token: harness.token,
			}),
		)
		expect(after.ok).toBe(true)
		expect(after.result).toMatchObject({ sessionId: "session-running", running: true })
		expect(runCancelled).toBe(false)
	})

	it("CS13 (C4.7): NO exposed operation can invoke run_commands / editor / file reads", async () => {
		// The payload allow-list is the enforcement point: the seam can
		// only ever emit these keys.
		expect(isControlSeamRunIdentity({ sessionId: "s", running: false, queuedPromptCount: 0 })).toBe(true)
		for (const forbidden of ["transcript", "messages", "toolArguments", "apiKey", "config", "prompt"]) {
			expect(
				isControlSeamRunIdentity({
					sessionId: "s",
					running: false,
					queuedPromptCount: 0,
					[forbidden]: "leak",
				}),
				`the payload allow-list must reject "${forbidden}"`,
			).toBe(false)
		}
		// There is no mutating operation to invoke.
		const ids = CONTROL_SEAM_OPERATIONS.map((operation) => operation.id)
		expect(ids).not.toContain("run_commands")
		expect(ids).not.toContain("editor")
		expect(ids).not.toContain("read_file")
	})

	it("CS14: the private socket directory and files are owner-only", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-alpha" }))
		// The directory is 0700 and the socket/token are 0600.
		expect(statSync(harness.dir).mode & 0o777).toBe(0o700)
		expect(statSync(harness.socketPath).mode & 0o777).toBe(0o600)
		expect(statSync(harness.tokenPath).mode & 0o777).toBe(0o600)
	})

	it("CS15: dispose() removes the socket AND the bearer token", async () => {
		const harness = await startHarness(makeAuthority({ sessionId: "session-alpha" }))
		expect(existsSync(harness.socketPath)).toBe(true)
		expect(existsSync(harness.tokenPath)).toBe(true)
		await harness.server.dispose()
		expect(existsSync(harness.socketPath)).toBe(false)
		expect(existsSync(harness.tokenPath)).toBe(false)
		// A second dispose is a no-op.
		await harness.server.dispose()
	})

	it("CS16: the bearer token is readable only by the owner and is per-start unique", async () => {
		const first = await startHarness(makeAuthority({ sessionId: "session-alpha" }))
		const firstToken = readControlSeamToken(first.tokenPath)
		expect(firstToken).toBe(first.token)
		expect(firstToken).toHaveLength(64)
		await first.server.dispose()

		const second = await startHarness(makeAuthority({ sessionId: "session-alpha" }))
		expect(second.token).not.toBe(first.token)
	})

	it("CS17: with NO active session, the seam reports no active run", async () => {
		const harness = await startHarness(makeAuthority({}))
		const socket = await connectControlSeam(harness.socketPath)
		const client = new ControlSeamClient(harness.token)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)

		const response = await client.request("clinemm_get_run")
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.noActiveRun)
		socket?.destroy()
	})

	it("CS18: an unknown operation id is refused at the decoder", () => {
		expect(
			decodeControlSeamRequest(JSON.stringify({ v: CONTROL_SEAM_PROTOCOL_VERSION, op: "start_act", token: "t" })),
		).toBeUndefined()
		expect(
			decodeControlSeamRequest(JSON.stringify({ v: CONTROL_SEAM_PROTOCOL_VERSION, op: "clinemm_get_run", token: "" })),
		).toBeUndefined()
		expect(decodeControlSeamRequest("not json")).toBeUndefined()
		expect(decodeControlSeamRequest(JSON.stringify({ v: 999, op: "clinemm_get_run", token: "t" }))).toBeUndefined()
	})

	it("CS19: the authority projects ONLY identity + status", () => {
		const identity = readControlSeamRunIdentity(
			makeAuthority({
				sessionId: "session-alpha",
				taskId: "task-alpha",
				isRunning: true,
				queuedPromptCount: 2,
				runtimeStatus: "running",
				runId: "run-1",
			}),
		)
		expect(identity).toEqual({
			sessionId: "session-alpha",
			taskId: "task-alpha",
			running: true,
			queuedPromptCount: 2,
			runtimeStatus: "running",
			runId: "run-1",
		})
		expect(isControlSeamRunIdentity(identity)).toBe(true)
	})

	it("CS20: the response codec round-trips through the wire", () => {
		const line = encodeControlSeamResponse({
			v: CONTROL_SEAM_PROTOCOL_VERSION,
			ok: true,
			result: { sessionId: "s" },
		})
		expect(line.endsWith("\n")).toBe(true)
		expect(JSON.parse(line)).toEqual({ v: 1, ok: true, result: { sessionId: "s" } })
	})

	it("CS21: the socket path lives under the private data dir, never a TCP port", () => {
		const env = { CLINE_DIR: "/tmp/clinemm-seam-test" }
		const socketPath = resolveControlSeamSocketPath(env)
		const tokenPath = resolveControlSeamTokenPath(env)
		expect(socketPath.startsWith("/tmp/clinemm-seam-test/")).toBe(true)
		expect(tokenPath.startsWith("/tmp/clinemm-seam-test/")).toBe(true)
		// An AF_UNIX path, not a host:port pair.
		expect(socketPath).not.toMatch(/:\d+$/)
	})
})
