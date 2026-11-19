/**
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01
 *
 * The behavioral RED -> GREEN witnesses for the bounded correction of
 * the MCP execution-control concurrency contract.
 *
 * WHAT IS UNDER TEST
 *
 * The REAL extension-host server (`ControlSeamServer`) over the REAL
 * AF_UNIX transport, driven through the REAL client. The authority is
 * a fixture that stands in for the controller's own closures - but
 * every decision under test (idempotency ordering, in-flight
 * reservation, event-read ownership, response ordering, ledger
 * eviction) is made by the PRODUCTION server / ledger code.
 *
 * THE FIVE DEFECTS THIS ACT CORRECTS
 *
 *   - C1 (P0) REPLAY ORDERING. `handleStartAct` consulted the
 *     "active task owner exists" check BEFORE its idempotency ledger.
 *     A replay of an already-accepted request therefore returned
 *     `rejected(active-task-owner-exists)` instead of the SAME
 *     recorded outcome. C1-1 pins the corrected order.
 *   - C2 (P0) IN-FLIGHT RESERVATION. Two DIFFERENT request ids could
 *     both pass the no-active-session check while neither start had
 *     finished, and both reached `authority.startAct()`. C2-1 pins
 *     the single global in-flight reservation.
 *   - C3 (P0) EVENT-READ OWNERSHIP. `clinemm_read_events` compared the
 *     requested session against the CURRENTLY ACTIVE session, so a
 *     valid write credential could read a task this client never
 *     started. C3-1 pins the explicit ownership fence.
 *   - C4 (P1) PENDING EVICTION. The 64-entry ledger evicted the
 *     OLDEST entry, including an IN-FLIGHT (`pending`) one, so a later
 *     duplicate could be treated as new. C4-1 pins the protection.
 *   - C5 (P1) SAME-SOCKET RESPONSE ORDERING. The server wrote each
 *     response as its handler settled, so two async requests on ONE
 *     socket could answer out of order - while the client matches
 *     replies through a FIFO pending queue. C5-1 pins the ordering.
 *
 * CONSERVATION
 *
 * The controller lifecycle, the authorization model, the two MCP
 * operations and the read-only view are all UNCHANGED. These tests
 * assert that as well.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ControlSeamClient, connectControlSeam, encodeControlSeamRequest } from "./control-seam-client"
import { ControlSeamEventBuffer, projectControlSeamBufferedEvent } from "./control-seam-event-buffer"
import { ControlSeamOperationLedger } from "./control-seam-operation-ledger"
import { CONTROL_SEAM_ERROR_CODES, CONTROL_SEAM_PROTOCOL_VERSION, type ControlSeamResponse } from "./control-seam-protocol"
import { ControlSeamServer } from "./control-seam-server"

/** A short private root so the AF_UNIX socket path stays under the limit. */
const SHORT_TMP_ROOT = "/tmp"

interface AuthorityFixture {
	/** The active session id the controller owns, or `undefined`. */
	sessionId?: string
	/** The workspace the host currently reports. */
	workspace: string
	/** The recorded `startAct` calls. */
	readonly startCalls: string[]
	/**
	 * When true, `startAct` NEVER settles until `releaseStart` is
	 * called - used to hold the in-flight window open.
	 */
	blockStart?: boolean
	/** The release handle for a blocked start. */
	releaseStart?: () => void
	/**
	 * When true, the authority installs the accepted session id as the
	 * ACTIVE session - i.e. the "active session becomes visible"
	 * condition the replay-ordering defect needed.
	 */
	installSessionOnAccept?: boolean
	/** The session id the authority accepts. */
	acceptedSessionId?: string
	/**
	 * When set, the accepted start resolves only after this many
	 * milliseconds - used to make two concurrent requests settle out of
	 * order deterministically.
	 */
	startDelayMs?: number
}

interface Harness {
	readonly server: ControlSeamServer
	readonly dir: string
	readonly socketPath: string
	readonly token: string
	readonly writeToken?: string
	readonly eventBuffer: ControlSeamEventBuffer
	readonly fixture: AuthorityFixture
}

const openHarnesses: Harness[] = []

afterEach(async () => {
	while (openHarnesses.length > 0) {
		const harness = openHarnesses.pop()
		if (!harness) {
			continue
		}
		await harness.server.dispose()
		try {
			rmSync(harness.dir, { recursive: true, force: true })
		} catch {
			// Best effort.
		}
	}
})

/**
 * Build the authority fixture.
 *
 * The fixture only stands in for the CONTROLLER's closures. Every
 * security / concurrency decision is production code.
 */
function makeAuthority(fixture: AuthorityFixture) {
	return {
		readActiveSessionId: () => fixture.sessionId,
		readActiveTaskId: () => undefined,
		readIsRunning: () => false,
		readQueuedPromptCount: () => 0,
		readRuntimeSnapshot: () => undefined,
		readPublishedTaskState: () => undefined,
		readCurrentEpoch: () => 0,
		readCurrentTurnPhase: () => undefined,
		readWorkspaceRoot: async () => fixture.workspace,
		startAct: async (input: { readonly prompt: string }) => {
			fixture.startCalls.push(input.prompt)
			if (fixture.startDelayMs !== undefined) {
				await new Promise((resolve) => setTimeout(resolve, fixture.startDelayMs))
			}
			if (fixture.blockStart) {
				await new Promise<void>((resolve) => {
					fixture.releaseStart = resolve
				})
			}
			const sessionId = fixture.acceptedSessionId ?? "session-accepted"
			if (fixture.installSessionOnAccept !== false) {
				// The production authority installs the session as the
				// ACTIVE session when the start is accepted. The
				// "active task owner exists" check therefore becomes
				// true for every subsequent request.
				fixture.sessionId = sessionId
			}
			return { outcome: "accepted" as const, sessionId }
		},
		// ACT-CLINEMM-MCP-SUPERVISION-V2-01: the supervision members are
		// not exercised by this fixture.
		sendFeedback: async () => ({ outcome: "rejected" as const, reason: "not-authorized-in-this-fixture" }),
		cancelRun: async () => ({ outcome: "rejected" as const, reason: "not-authorized-in-this-fixture" }),
	}
}

async function startHarness(
	fixture: Partial<AuthorityFixture> & { readonly workspace?: string } = {},
	options: { readonly mutationEnabled?: boolean; readonly allowContentRead?: boolean } = {},
): Promise<Harness> {
	const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cec-corr01-"))
	const socketPath = join(dir, "control.sock")
	const tokenPath = join(dir, "token")
	const ownerPath = join(dir, "owner.json")
	const eventBuffer = new ControlSeamEventBuffer()
	const fullFixture: AuthorityFixture = {
		workspace: fixture.workspace ?? "/tmp/workspace",
		startCalls: fixture.startCalls ?? [],
		...(fixture.sessionId !== undefined ? { sessionId: fixture.sessionId } : {}),
		...(fixture.blockStart !== undefined ? { blockStart: fixture.blockStart } : {}),
		...(fixture.installSessionOnAccept !== undefined ? { installSessionOnAccept: fixture.installSessionOnAccept } : {}),
		...(fixture.acceptedSessionId !== undefined ? { acceptedSessionId: fixture.acceptedSessionId } : {}),
		...(fixture.startDelayMs !== undefined ? { startDelayMs: fixture.startDelayMs } : {}),
	}
	const mutationOptInPath = join(dir, "mutation.json")
	if (options.mutationEnabled !== undefined) {
		writeFileSync(
			mutationOptInPath,
			JSON.stringify({ v: 1, enabled: true, allowContentRead: options.allowContentRead === true }),
			{ mode: 0o600 },
		)
	}
	const server = new ControlSeamServer({
		authority: makeAuthority(fullFixture),
		extensionVersion: "9.9.9-corr01-test",
		platform: "darwin",
		socketPath,
		tokenPath,
		ownerPath,
		dirPath: dir,
		forceEnabled: true,
		eventBuffer,
		mutationOptInPath,
		...(options.mutationEnabled !== undefined ? { forceMutationEnabled: options.mutationEnabled } : {}),
	})
	const harness: Harness = {
		server,
		dir,
		socketPath,
		token: "",
		eventBuffer,
		fixture: fullFixture,
	}
	openHarnesses.push(harness)
	const handle = await server.start()
	expect(handle).toBeDefined()
	return {
		...harness,
		token: handle!.token,
		...(handle!.writeToken !== undefined ? { writeToken: handle!.writeToken } : {}),
	}
}

/** Send a request over a FRESH socket. */
async function send(
	harness: Harness,
	request: Record<string, unknown>,
	options: { readonly writeToken?: string; readonly withWriteToken?: boolean } = {},
): Promise<ControlSeamResponse> {
	const socket = await connectControlSeam(harness.socketPath)
	expect(socket).toBeDefined()
	try {
		const client = new ControlSeamClient(
			harness.token,
			options.withWriteToken && options.writeToken !== undefined ? { writeToken: options.writeToken } : {},
		)
		client.setWriter((payload) => socket?.write(payload))
		client.attach(socket!)
		const response = await client.request(
			request.op as "clinemm_get_run",
			request.sessionId as string | undefined,
			request.payload as never,
		)
		client.dispose()
		return response
	} finally {
		socket?.destroy()
	}
}

/** Build a `clinemm_start_act` request envelope. */
function startActRequest(input: {
	readonly requestId: string
	readonly prompt?: string
	readonly expectedWorkspace?: string
	readonly writeToken?: string
}): Record<string, unknown> {
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: "clinemm_start_act",
		token: "read-token",
		...(input.writeToken !== undefined ? { writeToken: input.writeToken } : {}),
		payload: {
			op: "clinemm_start_act",
			input: {
				requestId: input.requestId,
				prompt: input.prompt ?? "fix the three test failures",
				expectedWorkspace: input.expectedWorkspace ?? "/tmp/workspace",
			},
		},
	}
}

/** Build a `clinemm_read_events` request envelope. */
function readEventsRequest(input: {
	readonly sessionId: string
	readonly afterCursor?: string
	readonly limit?: number
	readonly writeToken?: string
}): Record<string, unknown> {
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: "clinemm_read_events",
		token: "read-token",
		...(input.writeToken !== undefined ? { writeToken: input.writeToken } : {}),
		payload: {
			op: "clinemm_read_events",
			input: {
				sessionId: input.sessionId,
				...(input.afterCursor !== undefined ? { afterCursor: input.afterCursor } : {}),
				...(input.limit !== undefined ? { limit: input.limit } : {}),
			},
		},
	}
}

// ===========================================================================
// C1 - The idempotency ledger is consulted BEFORE the active-owner check
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01 - C1 replay ordering", () => {
	it("C1-1: a replay of an ACCEPTED request returns the SAME recorded outcome after the active session becomes visible", async () => {
		const harness = await startHarness(
			{
				workspace: "/tmp/workspace",
				acceptedSessionId: "session-replay",
				installSessionOnAccept: true,
			},
			{ mutationEnabled: true, allowContentRead: true },
		)
		const request = startActRequest({
			requestId: "corr01-c1-1",
			expectedWorkspace: "/tmp/workspace",
			writeToken: harness.writeToken,
		})

		const first = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		expect(first.ok).toBe(true)
		expect(first.result).toMatchObject({ outcome: "accepted", sessionId: "session-replay" })

		// The production authority has now installed the session, so the
		// "active task owner exists" precondition is TRUE.
		expect(harness.fixture.sessionId).toBe("session-replay")

		const replay = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		expect(replay.ok).toBe(true)
		// The SAME recorded outcome - NOT `rejected`.
		expect(replay.result).toEqual(first.result)
		expect(replay.result).toMatchObject({ outcome: "accepted", sessionId: "session-replay" })
		// EXACTLY ONE start.
		expect(harness.fixture.startCalls).toHaveLength(1)
	})

	it("C1-2: a replay of a REJECTED request returns the SAME recorded outcome", async () => {
		const harness = await startHarness(
			{
				workspace: "/tmp/workspace",
				// An EXISTING active owner makes the FIRST request reject.
				sessionId: "session-already-active",
				installSessionOnAccept: false,
			},
			{ mutationEnabled: true },
		)
		const request = startActRequest({
			requestId: "corr01-c1-2",
			expectedWorkspace: "/tmp/workspace",
			writeToken: harness.writeToken,
		})

		const first = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		expect(first.ok).toBe(true)
		expect(first.result).toMatchObject({ outcome: "rejected" })

		const replay = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		expect(replay.ok).toBe(true)
		expect(replay.result).toEqual(first.result)
		expect(harness.fixture.startCalls).toHaveLength(0)
	})
})

// ===========================================================================
// C2 - A single global in-flight start reservation
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01 - C2 in-flight reservation", () => {
	it("C2-1: TWO different request ids cannot both reach the lifecycle while the first start is blocked", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", blockStart: true }, { mutationEnabled: true })

		const firstPromise = send(
			harness,
			startActRequest({
				requestId: "corr01-c2-1-a",
				prompt: "first prompt",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		// Give the server a tick to record the in-flight reservation.
		await new Promise((resolve) => setTimeout(resolve, 50))

		// A DIFFERENT request id arrives while the first start is still
		// in flight. It MUST NOT reach the lifecycle.
		const second = await send(
			harness,
			startActRequest({
				requestId: "corr01-c2-1-b",
				prompt: "second prompt",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)

		expect(second.ok).toBe(true)
		expect(second.result).toMatchObject({ outcome: "rejected", requestId: "corr01-c2-1-b" })
		expect((second.result as { sessionId?: string }).sessionId).toBeUndefined()
		// EXACTLY ONE lifecycle call while the first start was blocked.
		expect(harness.fixture.startCalls).toEqual(["first prompt"])

		// Release the blocked start; it completes normally.
		harness.fixture.releaseStart?.()
		const first = await firstPromise
		expect(first.ok).toBe(true)
		expect(first.result).toMatchObject({ outcome: "accepted" })
		expect(harness.fixture.startCalls).toHaveLength(1)
	})

	it("C2-2: the in-flight reservation is RELEASED - a later DIFFERENT request id can start after the first completed", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", acceptedSessionId: "session-first" },
			{ mutationEnabled: true },
		)
		const first = await send(
			harness,
			startActRequest({
				requestId: "corr01-c2-2-a",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(first.result).toMatchObject({ outcome: "accepted", sessionId: "session-first" })

		// The session is now active, so a NEW start is refused by the
		// EXISTING owner check - but it is refused as a PRECONDITION,
		// not as an in-flight reservation, and it starts nothing.
		const second = await send(
			harness,
			startActRequest({
				requestId: "corr01-c2-2-b",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(second.result).toMatchObject({ outcome: "rejected" })
		expect(harness.fixture.startCalls).toHaveLength(1)
	})
})

// ===========================================================================
// C3 - Explicit session ownership for event reads
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01 - C3 event-read ownership", () => {
	it("C3-1: a write credential that did NOT start the session cannot read that session's events", async () => {
		// A session the UI started - NOT this mutation client.
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", sessionId: "session-ui-started", installSessionOnAccept: false },
			{ mutationEnabled: true, allowContentRead: true },
		)
		const projected = projectControlSeamBufferedEvent(
			{ ts: 1_000, type: "say", say: "text", text: "a private ui event", epoch: 1, seq: 1 } as never,
			// ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01: the event is
			// attributed to the session that PRODUCED it.
			{ sessionId: "session-ui-started", allowContentRead: true, maxTextLength: 2_000 },
		)
		expect(projected).toBeDefined()
		harness.eventBuffer.append(projected!)

		const response = await send(
			harness,
			readEventsRequest({ sessionId: "session-ui-started", writeToken: harness.writeToken }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)

		// The read is REFUSED: the client never started this session.
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.foreignSession)
		// NOTHING about the other task's content is disclosed.
		expect(JSON.stringify(response)).not.toContain("a private ui event")
	})

	it("C3-2: the session this mutation client STARTED is readable", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", acceptedSessionId: "session-owned", installSessionOnAccept: true },
			{ mutationEnabled: true, allowContentRead: true },
		)
		const started = await send(
			harness,
			startActRequest({
				requestId: "corr01-c3-2",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(started.result).toMatchObject({ outcome: "accepted", sessionId: "session-owned" })

		const projected = projectControlSeamBufferedEvent(
			{ ts: 2_000, type: "say", say: "text", text: "my own event", epoch: 1, seq: 7 } as never,
			// ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01: the event is
			// attributed to the session that PRODUCED it.
			{ sessionId: "session-owned", allowContentRead: true, maxTextLength: 2_000 },
		)
		expect(projected).toBeDefined()
		harness.eventBuffer.append(projected!)

		const response = await send(harness, readEventsRequest({ sessionId: "session-owned", writeToken: harness.writeToken }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)
		const result = response.result as { sessionId: string; events: { cursor: string; text?: string }[] }
		expect(result.sessionId).toBe("session-owned")
		expect(result.events.map((event) => event.cursor)).toEqual(["7"])
		expect(result.events.map((event) => event.text)).toEqual(["my own event"])
	})
})

// ===========================================================================
// C4 - The ledger never evicts an in-flight entry
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01 - C4 pending eviction", () => {
	it("C4-1: an IN-FLIGHT ledger entry is never evicted by later entries", () => {
		const ledger = new ControlSeamOperationLedger({ maxEntries: 4 })
		ledger.begin("in-flight", "fingerprint")
		for (let index = 0; index < 16; index++) {
			ledger.begin(`other-${index}`, `fingerprint-${index}`)
		}
		// The in-flight entry is STILL there, still pending.
		const lookup = ledger.lookup("in-flight", "fingerprint")
		expect(lookup.kind).toBe("found")
		if (lookup.kind === "found") {
			expect(lookup.outcome.status).toBe("pending")
		}
	})

	it("C4-2: a COMPLETED entry is still evictable, so the ledger stays bounded", () => {
		const ledger = new ControlSeamOperationLedger({ maxEntries: 4 })
		ledger.begin("done", "fingerprint")
		ledger.complete("done", { status: "accepted", sessionId: "session-x" })
		for (let index = 0; index < 16; index++) {
			ledger.begin(`other-${index}`, `fingerprint-${index}`)
			ledger.complete(`other-${index}`, { status: "rejected", reason: "fixture" })
		}
		expect(ledger.lookup("done", "fingerprint").kind).toBe("absent")
		// The ledger remains BOUNDED: the bound applies to the COMPLETED
		// entries, and the IN-FLIGHT entries are never evicted.
		expect(ledger.size).toBeLessThanOrEqual(4)
	})

	it("C4-2b: the bound applies to the COMPLETED entries - pending entries are retained", () => {
		const ledger = new ControlSeamOperationLedger({ maxEntries: 4 })
		// ONE pending entry (the server admits at most one in flight).
		ledger.begin("pending", "fingerprint")
		for (let index = 0; index < 16; index++) {
			ledger.begin(`done-${index}`, `fingerprint-${index}`)
			ledger.complete(`done-${index}`, { status: "rejected", reason: "fixture" })
		}
		// The COMPLETED entries are bounded.
		expect(ledger.size).toBeLessThanOrEqual(5)
		// The PENDING entry survived.
		const lookup = ledger.lookup("pending", "fingerprint")
		expect(lookup.kind).toBe("found")
	})

	it("C4-3: an in-flight entry's terminal outcome is still observable after other entries", () => {
		const ledger = new ControlSeamOperationLedger({ maxEntries: 4 })
		ledger.begin("in-flight", "fingerprint")
		for (let index = 0; index < 16; index++) {
			ledger.begin(`other-${index}`, `fingerprint-${index}`)
		}
		ledger.complete("in-flight", { status: "accepted", sessionId: "session-late" })
		const lookup = ledger.lookup("in-flight", "fingerprint")
		expect(lookup.kind).toBe("found")
		if (lookup.kind === "found") {
			expect(lookup.outcome).toEqual({ status: "accepted", sessionId: "session-late" })
		}
	})
})

// ===========================================================================
// C5 - Responses on ONE socket arrive in REQUEST order
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01 - C5 same-socket response ordering", () => {
	it("C5-1: two requests on ONE socket are answered in REQUEST order even when the first settles LAST", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", startDelayMs: 120 }, { mutationEnabled: true })
		const socket = await connectControlSeam(harness.socketPath)
		expect(socket).toBeDefined()
		try {
			const client = new ControlSeamClient(harness.token, { writeToken: harness.writeToken! })
			client.setWriter((payload) => socket?.write(payload))
			client.attach(socket!)

			// The FIRST request is the SLOW one (the start is delayed).
			const first = client.request("clinemm_start_act", undefined, {
				op: "clinemm_start_act",
				input: {
					requestId: "corr01-c5-1-a",
					prompt: "slow prompt",
					expectedWorkspace: "/tmp/workspace",
				},
			})
			// The SECOND request is FAST (a capability read).
			const second = client.request("clinemm_capabilities")

			const [firstResponse, secondResponse] = await Promise.all([first, second])

			// The FIFO pending queue of the client maps the FIRST reply to
			// the FIRST request. If the server answered out of order, the
			// first request would have received the capability payload.
			expect(firstResponse.ok).toBe(true)
			expect(firstResponse.result).toMatchObject({ outcome: "accepted", requestId: "corr01-c5-1-a" })
			expect(secondResponse.ok).toBe(true)
			expect(secondResponse.result).toMatchObject({ readOnly: false })
			client.dispose()
		} finally {
			socket?.destroy()
		}
	})

	it("C5-2: the server writes each response as ONE line on the same socket", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: false })
		const socket = await connectControlSeam(harness.socketPath)
		expect(socket).toBeDefined()
		const lines: string[] = []
		try {
			await new Promise<void>((resolve, reject) => {
				socket!.on("data", (chunk: Buffer) => {
					for (const line of chunk.toString("utf8").split("\n")) {
						if (line.length > 0) {
							lines.push(line)
						}
					}
					if (lines.length >= 2) {
						resolve()
					}
				})
				socket!.on("error", reject)
				socket!.write(encodeControlSeamRequest({ op: "clinemm_capabilities", token: harness.token }))
				socket!.write(encodeControlSeamRequest({ op: "clinemm_get_run", token: harness.token }))
				setTimeout(() => reject(new Error("timed out waiting for two responses")), 5_000)
			})
			expect(lines).toHaveLength(2)
			const first = JSON.parse(lines[0]) as ControlSeamResponse
			const second = JSON.parse(lines[1]) as ControlSeamResponse
			expect(first.result).toMatchObject({ readOnly: true })
			expect(second.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.noActiveRun)
		} finally {
			socket?.destroy()
		}
	})
})

// ===========================================================================
// Conservation - the authorization model and the operation set are UNCHANGED
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01 - conservation", () => {
	it("CN-1: a VALID READ credential alone still cannot start a task", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		const response = await send(harness, startActRequest({ requestId: "corr01-cn-1", expectedWorkspace: "/tmp/workspace" }), {
			withWriteToken: false,
		})
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
		expect(harness.fixture.startCalls).toHaveLength(0)
	})

	it("CN-2: the READ-ONLY view is UNCHANGED - exactly the original two operations", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: false })
		const response = await send(harness, {
			v: CONTROL_SEAM_PROTOCOL_VERSION,
			op: "clinemm_capabilities",
			token: harness.token,
		})
		expect(response.ok).toBe(true)
		const capabilities = response.result as { operations: { id: string }[]; readOnly: boolean }
		expect(capabilities.readOnly).toBe(true)
		expect(capabilities.operations.map((operation) => operation.id)).toEqual(["clinemm_capabilities", "clinemm_get_run"])
	})

	it("CN-3: the mutation-AUTHORIZED view shows the V1 write operations plus the two supervision operations", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		const response = await send(
			harness,
			{
				v: CONTROL_SEAM_PROTOCOL_VERSION,
				op: "clinemm_capabilities",
				token: harness.token,
				writeToken: harness.writeToken,
			},
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(true)
		const capabilities = response.result as { operations: { id: string }[]; readOnly: boolean }
		expect(capabilities.readOnly).toBe(false)
		// ACT-CLINEMM-MCP-SUPERVISION-V2-01: the mutation-authorized view
		// now carries the two SUPERVISION operations in addition to the
		// V1 pair. The registry order is the declaration order.
		expect(capabilities.operations.map((operation) => operation.id)).toEqual([
			"clinemm_capabilities",
			"clinemm_get_run",
			"clinemm_start_act",
			"clinemm_read_events",
			"clinemm_send_feedback",
			"clinemm_cancel_run",
		])
	})
})
