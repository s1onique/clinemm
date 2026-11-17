/**
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01
 *
 * Focused R1-R6 tests for the bounded MCP execution-control vertical
 * slice.
 *
 * WHAT IS UNDER TEST
 *
 * The REAL extension-host server (`ControlSeamServer`) over the REAL
 * AF_UNIX transport, driven through the REAL client. The authority is
 * a fixture that stands in for the controller's own closures - but
 * every SECURITY decision (credential comparison, workspace binding,
 * ledger, scope) is made by the production server code, not by the
 * fixture.
 *
 * R1 - Unauthorized start: a valid READ credential cannot mutate.
 * R2 - Authorized start: exactly one task starts through the authority,
 *       and the authoritative session id is returned.
 * R3 - Duplicate request: the same request id delivered twice - including
 *       DURING an in-flight start - produces ONE start and ONE session.
 * R4 - Competing lifecycle operations: the existing operation fence wins;
 *       a superseded start does not install its session.
 * R5 - Read events: real emitted events, correct ordering, bounded
 *       output, cursor behaviour, and explicit gap reporting.
 * R6 - Safety / adversarial: read-only backward compatibility, foreign
 *       session / workspace rejection, invalid input rejection, socket
 *       disconnect, host-restart invalidation, and approval conservation.
 */

import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { afterEach, describe, expect, it } from "vitest"

import { ControlSeamClient, connectControlSeam } from "./control-seam-client"
import { ControlSeamEventBuffer, projectControlSeamBufferedEvent } from "./control-seam-event-buffer"
import {
	CONTROL_SEAM_ERROR_CODES,
	CONTROL_SEAM_MAX_PROMPT_LENGTH,
	CONTROL_SEAM_PROTOCOL_VERSION,
	type ControlSeamResponse,
} from "./control-seam-protocol"
import { ControlSeamServer } from "./control-seam-server"

/** A short private root so the AF_UNIX socket path stays under the limit. */
const SHORT_TMP_ROOT = "/tmp"

interface AuthorityFixture {
	/**
	 * The active session id the controller owns, or `undefined`.
	 *
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: it is MUTABLE
	 * because the production authority installs the accepted session as
	 * the ACTIVE session when a start is accepted - and the corrected
	 * replay contract depends on that precondition being observable.
	 */
	sessionId?: string
	readonly taskId?: string
	readonly isRunning?: boolean
	/**
	 * The workspace the host currently reports. It is MUTABLE so a test
	 * can simulate the user opening a DIFFERENT folder after the grant
	 * was minted.
	 */
	workspace: string
	/**
	 * The recorded `startAct` calls. Each entry is the prompt the
	 * server handed to the authority.
	 */
	readonly startCalls: string[]
	/**
	 * When set, the authority's `startAct` resolves with this outcome
	 * instead of the default `accepted`.
	 */
	readonly startOutcome?: {
		outcome: "accepted" | "rejected" | "superseded" | "unknown_outcome"
		sessionId?: string
		taskId?: string
		reason?: string
	}
	/**
	 * When set, `startAct` throws this error instead of resolving.
	 */
	readonly startThrows?: Error
	/**
	 * When true, `startAct` never settles until `releaseStart` is
	 * called - used to exercise the IN-FLIGHT duplicate path.
	 */
	readonly blockStart?: boolean
	/**
	 * The release handle for a blocked start. The authority ASSIGNS it
	 * when the start blocks, and the test CALLS it to let the start
	 * finish.
	 */
	releaseStart?: () => void
	/**
	 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: when false, the
	 * authority does NOT install the accepted session as the ACTIVE
	 * session. A test that wants to observe the "active task owner
	 * exists" precondition separately from the acceptance sets this to
	 * false.
	 */
	installSessionOnAccept?: boolean
}

interface Harness {
	readonly server: ControlSeamServer
	readonly dir: string
	readonly socketPath: string
	readonly tokenPath: string
	readonly ownerPath: string
	readonly token: string
	readonly writeToken?: string
	readonly writeTokenPath?: string
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
 * The mutation members are the ONLY seam the server has into the
 * controller. Everything the server decides - authorization, workspace
 * binding, idempotency, scope - is production code.
 */
function makeAuthority(fixture: AuthorityFixture) {
	return {
		readActiveSessionId: () => fixture.sessionId,
		readActiveTaskId: () => fixture.taskId,
		readIsRunning: () => fixture.isRunning ?? false,
		readQueuedPromptCount: () => 0,
		readRuntimeSnapshot: () => undefined,
		readPublishedTaskState: () => undefined,
		readCurrentEpoch: () => 0,
		readWorkspaceRoot: async () => fixture.workspace,
		startAct: async (input: { readonly prompt: string }) => {
			fixture.startCalls.push(input.prompt)
			if (fixture.startThrows) {
				throw fixture.startThrows
			}
			if (fixture.blockStart) {
				// The start stays IN FLIGHT until the test releases it.
				await new Promise<void>((resolve) => {
					fixture.releaseStart = resolve
				})
			}
			if (fixture.startOutcome) {
				const outcome = fixture.startOutcome
				if (outcome.outcome === "accepted") {
					const sessionId = outcome.sessionId ?? "session-default"
					if (fixture.installSessionOnAccept !== false) {
						// The production authority installs the session as
						// the ACTIVE session when the start is accepted.
						fixture.sessionId = sessionId
					}
					return {
						outcome: "accepted" as const,
						sessionId,
						...(outcome.taskId !== undefined ? { taskId: outcome.taskId } : {}),
					}
				}
				return { outcome: outcome.outcome, reason: outcome.reason ?? "fixture-outcome" }
			}
			const sessionId = fixture.sessionId ?? "session-started"
			if (fixture.installSessionOnAccept !== false) {
				fixture.sessionId = sessionId
			}
			return {
				outcome: "accepted" as const,
				sessionId,
				...(fixture.taskId !== undefined ? { taskId: fixture.taskId } : {}),
			}
		},
	}
}

async function startHarness(
	fixture: Partial<AuthorityFixture> & { readonly workspace?: string } = {},
	options: { readonly mutationEnabled?: boolean; readonly allowContentRead?: boolean } = {},
): Promise<Harness> {
	const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cec-v1-"))
	const socketPath = join(dir, "control.sock")
	const tokenPath = join(dir, "token")
	const ownerPath = join(dir, "owner.json")
	const eventBuffer = new ControlSeamEventBuffer()
	const fullFixture: AuthorityFixture = {
		workspace: fixture.workspace ?? dir,
		startCalls: fixture.startCalls ?? [],
		...(fixture.sessionId !== undefined ? { sessionId: fixture.sessionId } : {}),
		...(fixture.taskId !== undefined ? { taskId: fixture.taskId } : {}),
		...(fixture.isRunning !== undefined ? { isRunning: fixture.isRunning } : {}),
		...(fixture.startOutcome !== undefined ? { startOutcome: fixture.startOutcome } : {}),
		...(fixture.startThrows !== undefined ? { startThrows: fixture.startThrows } : {}),
		...(fixture.blockStart !== undefined ? { blockStart: fixture.blockStart } : {}),
		...(fixture.releaseStart !== undefined ? { releaseStart: fixture.releaseStart } : {}),
		...(fixture.installSessionOnAccept !== undefined ? { installSessionOnAccept: fixture.installSessionOnAccept } : {}),
	}
	// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01: the operator's SEPARATE
	// mutation opt-in record carries the content-read sub-grant. It is
	// written HERE so the test exercises the REAL opt-in path.
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
		extensionVersion: "9.9.9-v1-test",
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
		tokenPath,
		ownerPath,
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
		...(handle!.writeTokenPath !== undefined ? { writeTokenPath: handle!.writeTokenPath } : {}),
	}
}

/** Send a request over the REAL AF_UNIX socket. */
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

/**
 * Start a task through the seam so the mutation client OWNS the
 * session, and return the accepted session id.
 *
 * ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: `clinemm_read_events`
 * is scoped to the session the mutation client STARTED, not to whatever
 * session happens to be active. A test that reads events must therefore
 * establish ownership first.
 */
async function ownSession(harness: Harness, sessionId: string, requestId: string): Promise<string> {
	const response = await send(
		harness,
		startActRequest({
			requestId,
			expectedWorkspace: "/tmp/workspace",
			writeToken: harness.writeToken,
		}),
		{ withWriteToken: true, writeToken: harness.writeToken },
	)
	expect(response.ok).toBe(true)
	// The authority returns the session id it accepted; the ownership
	// fence is bound to that ACCEPTED id.
	const accepted = (response.result as { sessionId?: string }).sessionId
	expect(accepted).toBe(sessionId)
	return accepted as string
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
// R1 - Unauthorized start
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01 - R1 unauthorized start", () => {
	it("R1-1: a VALID READ credential alone cannot start a task", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		expect(harness.writeToken).toBeDefined()

		const response = await send(
			harness,
			startActRequest({ requestId: "r1-1", expectedWorkspace: "/tmp/workspace" }),
			// The client holds the READ token but NOT the write token.
			{ withWriteToken: false },
		)

		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
		// NO execution started.
		expect(harness.fixture.startCalls).toHaveLength(0)
	})

	it("R1-2: a WRONG write credential cannot start a task", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		const response = await send(
			harness,
			startActRequest({ requestId: "r1-2", expectedWorkspace: "/tmp/workspace", writeToken: "wrong" }),
			{ withWriteToken: false },
		)
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
		expect(harness.fixture.startCalls).toHaveLength(0)
	})

	it("R1-3: with mutation DISABLED, the write operation is refused even with a plausible credential", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: false })
		// There is NO write credential at all when mutation is off.
		expect(harness.writeToken).toBeUndefined()

		const response = await send(
			harness,
			startActRequest({ requestId: "r1-3", expectedWorkspace: "/tmp/workspace", writeToken: "anything" }),
			{ withWriteToken: false },
		)
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
		expect(harness.fixture.startCalls).toHaveLength(0)
	})

	it("R1-4: a READ credential is NEVER equal to the write credential", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		expect(harness.writeToken).toBeDefined()
		expect(harness.writeToken).not.toBe(harness.token)
		expect(harness.writeToken!.length).toBeGreaterThanOrEqual(32)
	})
})

// ===========================================================================
// R2 - Authorized start
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01 - R2 authorized start", () => {
	it("R2-1: an authorized request starts EXACTLY ONE task through the authority", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		const response = await send(
			harness,
			startActRequest({ requestId: "r2-1", expectedWorkspace: "/tmp/workspace", writeToken: harness.writeToken }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)

		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({
			outcome: "accepted",
			sessionId: expect.any(String),
			requestId: "r2-1",
		})
		// EXACTLY ONE start.
		expect(harness.fixture.startCalls).toEqual(["fix the three test failures"])
	})

	it("R2-2: `accepted` ALWAYS carries an authoritative session id", async () => {
		const harness = await startHarness(
			{
				workspace: "/tmp/workspace",
				startOutcome: { outcome: "accepted", sessionId: "session-real-42", taskId: "task-real-42" },
			},
			{ mutationEnabled: true },
		)
		const response = await send(
			harness,
			startActRequest({ requestId: "r2-2", expectedWorkspace: "/tmp/workspace", writeToken: harness.writeToken }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({
			outcome: "accepted",
			sessionId: "session-real-42",
			taskId: "task-real-42",
		})
	})

	it("R2-3: the authority is asked to start the task the client supplied - verbatim", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		const prompt = "please run the disposable fixture tests"
		const response = await send(
			harness,
			startActRequest({ requestId: "r2-3", prompt, expectedWorkspace: "/tmp/workspace", writeToken: harness.writeToken }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(true)
		expect(harness.fixture.startCalls).toEqual([prompt])
	})

	it("R2-4: a lifecycle failure that cannot be proven yields `unknown_outcome`, never `accepted`", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", startThrows: new Error("host exploded") },
			{ mutationEnabled: true },
		)
		const response = await send(
			harness,
			startActRequest({ requestId: "r2-4", expectedWorkspace: "/tmp/workspace", writeToken: harness.writeToken }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "unknown_outcome" })
		expect((response.result as { sessionId?: string }).sessionId).toBeUndefined()
	})
})

// ===========================================================================
// R3 - Duplicate request
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01 - R3 duplicate request", () => {
	it("R3-1: the SAME request id + SAME payload returns the SAME recorded outcome and starts ONCE", async () => {
		const harness = await startHarness(
			{
				workspace: "/tmp/workspace",
				startOutcome: { outcome: "accepted", sessionId: "session-dup" },
			},
			{ mutationEnabled: true },
		)
		const request = startActRequest({
			requestId: "r3-1",
			expectedWorkspace: "/tmp/workspace",
			writeToken: harness.writeToken,
		})

		const first = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		const second = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })

		expect(first.result).toEqual(second.result)
		expect(first.result).toMatchObject({ outcome: "accepted", sessionId: "session-dup" })
		// EXACTLY ONE start.
		expect(harness.fixture.startCalls).toHaveLength(1)
	})

	it("R3-2: the SAME request id + a DIFFERENT payload is REJECTED and starts nothing more", async () => {
		const harness = await startHarness(
			{
				workspace: "/tmp/workspace",
				startOutcome: { outcome: "accepted", sessionId: "session-conflict" },
			},
			{ mutationEnabled: true },
		)
		await send(
			harness,
			startActRequest({
				requestId: "r3-2",
				prompt: "first prompt",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)

		const conflict = await send(
			harness,
			startActRequest({
				requestId: "r3-2",
				prompt: "SECOND, DIFFERENT prompt",
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)

		expect(conflict.ok).toBe(true)
		expect(conflict.result).toMatchObject({ outcome: "rejected", requestId: "r3-2" })
		// Only the FIRST prompt started.
		expect(harness.fixture.startCalls).toEqual(["first prompt"])
	})

	it("R3-3: a duplicate delivered DURING an in-flight start does NOT start a second task", async () => {
		const harness = await startHarness(
			{
				workspace: "/tmp/workspace",
				blockStart: true,
			},
			{ mutationEnabled: true },
		)
		// The authority's start never settles until the gate resolves.
		const request = startActRequest({
			requestId: "r3-3",
			expectedWorkspace: "/tmp/workspace",
			writeToken: harness.writeToken,
		})

		const firstPromise = send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		// Give the server a tick to record the IN-FLIGHT ledger entry.
		await new Promise((resolve) => setTimeout(resolve, 50))

		const duplicate = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		expect(duplicate.ok).toBe(true)
		// The duplicate joins the in-flight operation - it does NOT report
		// a fabricated acceptance and it does NOT start a second task.
		expect(duplicate.result).toMatchObject({ outcome: "unknown_outcome", requestId: "r3-3" })

		// Release the in-flight start. The recorded outcome becomes the
		// ONE authoritative outcome for this request id.
		harness.fixture.releaseStart?.()
		const first = await firstPromise
		expect(first.ok).toBe(true)
		expect(first.result).toMatchObject({ outcome: "accepted" })
		expect(harness.fixture.startCalls).toHaveLength(1)
	})
})

// ===========================================================================
// R4 - Competing lifecycle operations
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01 - R4 competing lifecycle operations", () => {
	it("R4-1: an EXISTING active task owner causes a `rejected` start - no implicit replace/clear/cancel", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", sessionId: "session-already-active" },
			{ mutationEnabled: true },
		)
		const response = await send(
			harness,
			startActRequest({ requestId: "r4-1", expectedWorkspace: "/tmp/workspace", writeToken: harness.writeToken }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "rejected", requestId: "r4-1" })
		expect((response.result as { sessionId?: string }).sessionId).toBeUndefined()
		// The existing owner was NOT disturbed and NO start happened.
		expect(harness.fixture.startCalls).toHaveLength(0)
	})

	it("R4-2: a lifecycle operation that SUPERSEDES the start reports `superseded` and installs no session", async () => {
		const harness = await startHarness(
			{
				workspace: "/tmp/workspace",
				startOutcome: { outcome: "superseded", reason: "operation-fence-won" },
			},
			{ mutationEnabled: true },
		)
		const response = await send(
			harness,
			startActRequest({ requestId: "r4-2", expectedWorkspace: "/tmp/workspace", writeToken: harness.writeToken }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "superseded", requestId: "r4-2" })
		expect((response.result as { sessionId?: string }).sessionId).toBeUndefined()
	})

	it("R4-3: a superseded start is RECORDED, so a replay does not start a task either", async () => {
		const harness = await startHarness(
			{
				workspace: "/tmp/workspace",
				startOutcome: { outcome: "superseded", reason: "operation-fence-won" },
			},
			{ mutationEnabled: true },
		)
		const request = startActRequest({
			requestId: "r4-3",
			expectedWorkspace: "/tmp/workspace",
			writeToken: harness.writeToken,
		})
		const first = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		const replay = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		expect(replay.result).toEqual(first.result)
		expect(harness.fixture.startCalls).toHaveLength(1)
	})
})

// ===========================================================================
// R5 - Read events
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01 - R5 read events", () => {
	/** A message shaped like the REAL published `ClineMessage`. */
	function message(overrides: Partial<ClineMessage> & { readonly seq: number }): ClineMessage {
		return {
			ts: 1_000 + overrides.seq,
			type: "say",
			say: "text",
			text: `event ${overrides.seq}`,
			epoch: 1,
			...overrides,
		} as ClineMessage
	}

	/**
	 * Append a projected event to the harness's ring.
	 *
	 * ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01: the retained event is
	 * attributed to the session that PRODUCED it. `sessionId` is the
	 * producing session — for the events this suite reads back it is
	 * the session the mutation client started.
	 */
	function appendEvent(harness: Harness, seq: number, allowContentRead = true, sessionId = "session-started"): void {
		const projected = projectControlSeamBufferedEvent(message({ seq }), {
			sessionId,
			allowContentRead,
			maxTextLength: 2_000,
		})
		expect(projected).toBeDefined()
		harness.eventBuffer.append(projected!)
	}

	it("R5-1: the REAL emitted events are returned, in the REAL production order", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", installSessionOnAccept: false },
			{ mutationEnabled: true, allowContentRead: true },
		)
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: `clinemm_read_events`
		// is scoped to the session THIS mutation client STARTED. The
		// client therefore starts the task before reading its events.
		const owned = await ownSession(harness, "session-started", "r5-1")
		for (const seq of [1, 2, 3]) {
			appendEvent(harness, seq)
		}

		const response = await send(harness, readEventsRequest({ sessionId: owned, writeToken: harness.writeToken }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)
		const result = response.result as { sessionId: string; events: { cursor: string; text?: string }[] }
		expect(result.sessionId).toBe(owned)
		expect(result.events.map((event) => event.cursor)).toEqual(["1", "2", "3"])
		expect(result.events.map((event) => event.text)).toEqual(["event 1", "event 2", "event 3"])
	})

	it("R5-2: `afterCursor` pages forward and the returned `nextCursor` resumes exactly where it left off", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", installSessionOnAccept: false },
			{ mutationEnabled: true, allowContentRead: true },
		)
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the client must
		// OWN the session before it may read its events.
		const owned = await ownSession(harness, "session-started", "r5-2")
		for (const seq of [1, 2, 3, 4, 5]) {
			appendEvent(harness, seq)
		}

		const first = await send(harness, readEventsRequest({ sessionId: owned, limit: 2, writeToken: harness.writeToken }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		const firstResult = first.result as { events: { cursor: string }[]; nextCursor?: string }
		expect(firstResult.events.map((event) => event.cursor)).toEqual(["1", "2"])
		expect(firstResult.nextCursor).toBe("2")

		const second = await send(
			harness,
			readEventsRequest({
				sessionId: owned,
				afterCursor: firstResult.nextCursor,
				limit: 2,
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		const secondResult = second.result as { events: { cursor: string }[] }
		expect(secondResult.events.map((event) => event.cursor)).toEqual(["3", "4"])
	})

	it("R5-3: the output is BOUNDED by `limit`", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", installSessionOnAccept: false },
			{ mutationEnabled: true, allowContentRead: true },
		)
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the client must
		// OWN the session before it may read its events.
		const owned = await ownSession(harness, "session-started", "r5-3")
		for (let seq = 1; seq <= 20; seq++) {
			appendEvent(harness, seq)
		}
		const response = await send(harness, readEventsRequest({ sessionId: owned, limit: 3, writeToken: harness.writeToken }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		const result = response.result as { events: unknown[] }
		expect(result.events).toHaveLength(3)
	})

	it("R5-4: a cursor older than the retained window is reported EXPLICITLY as expired", async () => {
		// A tiny ring so the oldest events are evicted. The ring is the
		// SAME production buffer the server reads from.
		const smallBuffer = new ControlSeamEventBuffer({ maxEvents: 2 })
		for (const seq of [1, 2, 3, 4]) {
			const projected = projectControlSeamBufferedEvent(message({ seq }), {
				sessionId: "session-started",
				allowContentRead: true,
				maxTextLength: 2_000,
			})
			smallBuffer.append(projected!)
		}
		// ACT-CLINEMM-MCP-EVENT-SESSION-ISOLATION01: the read is scoped to
		// the session whose events are being paged.
		const slice = smallBuffer.read({ sessionId: "session-started", afterCursor: "1", limit: 20 })
		expect(slice.cursorExpired).toBe(true)
		expect(slice.events.map((event) => event.cursor)).toEqual(["3", "4"])
	})

	it("R5-5: a FOREIGN session id is refused and discloses nothing about other tasks", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", sessionId: "session-mine" },
			{ mutationEnabled: true, allowContentRead: true },
		)
		for (const seq of [1, 2]) {
			appendEvent(harness, seq)
		}

		const response = await send(
			harness,
			readEventsRequest({ sessionId: "session-somebody-elses", writeToken: harness.writeToken }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.foreignSession)
		expect(JSON.stringify(response)).not.toContain("event 1")
	})

	it("R5-6: WITHOUT the explicit content-read grant, NO message text is exposed", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", installSessionOnAccept: false },
			{ mutationEnabled: true, allowContentRead: false },
		)
		// ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-CORR01: the client must
		// OWN the session before it may read its events.
		const owned = await ownSession(harness, "session-started", "r5-6")
		appendEvent(harness, 1, false)

		const response = await send(harness, readEventsRequest({ sessionId: owned, writeToken: harness.writeToken }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)
		expect(JSON.stringify(response)).not.toContain("event 1")
	})
})

// ===========================================================================
// R6 - Safety / adversarial
// ===========================================================================

describe("ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01 - R6 safety and adversarial", () => {
	it("R6-1: a foreign workspace is rejected - the client can never SELECT a workspace", async () => {
		const harness = await startHarness({ workspace: "/tmp/the-real-workspace" }, { mutationEnabled: true })
		const response = await send(
			harness,
			startActRequest({
				requestId: "r6-1",
				expectedWorkspace: "/tmp/some-other-workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
		expect(harness.fixture.startCalls).toHaveLength(0)
	})

	it("R6-1b: a WORKSPACE CHANGE after the grant invalidates the request", async () => {
		const harness = await startHarness({ workspace: "/tmp/the-real-workspace" }, { mutationEnabled: true })
		// The user opens a DIFFERENT folder after the grant was minted.
		harness.fixture.workspace = "/tmp/a-different-workspace"

		const response = await send(
			harness,
			startActRequest({
				requestId: "r6-1b",
				expectedWorkspace: "/tmp/the-real-workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
		expect(harness.fixture.startCalls).toHaveLength(0)
	})

	it("R6-2: an invalid request id is rejected by the CODEC, before the server sees it", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		const response = await send(
			harness,
			startActRequest({ requestId: "", expectedWorkspace: "/tmp/workspace", writeToken: harness.writeToken }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.badRequest)
		expect(harness.fixture.startCalls).toHaveLength(0)
	})

	it("R6-3: an oversized prompt is rejected before the lifecycle is called", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		const response = await send(
			harness,
			startActRequest({
				requestId: "r6-3",
				prompt: "x".repeat(CONTROL_SEAM_MAX_PROMPT_LENGTH + 1),
				expectedWorkspace: "/tmp/workspace",
				writeToken: harness.writeToken,
			}),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.badRequest)
		expect(harness.fixture.startCalls).toHaveLength(0)
	})

	it("R6-4: a socket DISCONNECT cannot duplicate an accepted request", async () => {
		const harness = await startHarness(
			{
				workspace: "/tmp/workspace",
				startOutcome: { outcome: "accepted", sessionId: "session-disconnect" },
			},
			{ mutationEnabled: true },
		)
		const request = startActRequest({
			requestId: "r6-4",
			expectedWorkspace: "/tmp/workspace",
			writeToken: harness.writeToken,
		})

		// First delivery: the socket dies BEFORE the response is read.
		const socket = await connectControlSeam(harness.socketPath)
		expect(socket).toBeDefined()
		const client = new ControlSeamClient(harness.token, { writeToken: harness.writeToken! })
		client.setWriter(() => {
			socket?.destroy()
		})
		client.attach(socket!)
		await client.request("clinemm_start_act", undefined, request.payload as never).catch(() => undefined)
		client.dispose()
		socket?.destroy()
		await new Promise((resolve) => setTimeout(resolve, 50))

		// The operation still ran (the ledger recorded it). A replay
		// returns the SAME recorded outcome and does NOT start a second
		// task.
		const replay = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		expect(replay.ok).toBe(true)
		expect(replay.result).toMatchObject({ outcome: "accepted", sessionId: "session-disconnect" })
		expect(harness.fixture.startCalls).toHaveLength(1)
	})

	it("R6-5: the write credential is INVALIDATED on host replacement", async () => {
		const first = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		expect(first.writeToken).toBeDefined()

		// The first instance is disposed (as a host shutdown would).
		await first.server.dispose()

		// A NEW instance on the SAME endpoint mints a NEW credential.
		const second = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		expect(second.writeToken).toBeDefined()
		expect(second.writeToken).not.toBe(first.writeToken)

		// The OLD credential is refused.
		const response = await send(
			second,
			startActRequest({
				requestId: "r6-5",
				expectedWorkspace: "/tmp/workspace",
				writeToken: first.writeToken,
			}),
			{ withWriteToken: false },
		)
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
		expect(second.fixture.startCalls).toHaveLength(0)
	})

	it("R6-6: the READ-ONLY view is UNCHANGED - a read-only client sees exactly two operations", async () => {
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

	it("R6-7: a mutation-AUTHORIZED client sees the write operations in its capabilities", async () => {
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
		expect(capabilities.operations.map((operation) => operation.id)).toEqual([
			"clinemm_capabilities",
			"clinemm_get_run",
			"clinemm_start_act",
			"clinemm_read_events",
		])
	})

	it("R6-8: the write credential file is owner-only, and it is REMOVED on dispose", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		expect(harness.writeTokenPath).toBeDefined()
		expect(statSync(harness.writeTokenPath!).mode & 0o777).toBe(0o600)

		await harness.server.dispose()
		expect(() => statSync(harness.writeTokenPath!)).toThrow()
	})

	it("R6-9: the mutation opt-in record is what enables mutation - and it is SEPARATE from the seam enablement", async () => {
		const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cec-optin-"))
		const socketPath = join(dir, "control.sock")
		const tokenPath = join(dir, "token")
		const ownerPath = join(dir, "owner.json")
		const mutationOptInPath = join(dir, "mutation.json")
		const writeTokenPath = join(dir, "write-token")

		// The mutation opt-in record is written by the OPERATOR.
		writeFileSync(mutationOptInPath, JSON.stringify({ v: 1, enabled: true, allowContentRead: true }), { mode: 0o600 })

		const fixture: AuthorityFixture = { workspace: "/tmp/workspace", startCalls: [] }
		const server = new ControlSeamServer({
			authority: makeAuthority(fixture),
			extensionVersion: "9.9.9-v1-test",
			platform: "darwin",
			socketPath,
			tokenPath,
			ownerPath,
			dirPath: dir,
			forceEnabled: true,
			mutationOptInPath,
			writeTokenPath,
		})
		openHarnesses.push({
			server,
			dir,
			socketPath,
			tokenPath,
			ownerPath,
			token: "",
			eventBuffer: new ControlSeamEventBuffer(),
			fixture,
		})
		const handle = await server.start()
		expect(handle?.writeToken).toBeDefined()
		await server.dispose()
		rmSync(dir, { recursive: true, force: true })
	})

	it("R6-10: the seam exposes NO approval bypass, no cancel, no feedback, and no shell shortcut", async () => {
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
		const capabilities = response.result as { operations: { id: string }[] }
		const ids = capabilities.operations.map((operation) => operation.id)
		for (const forbidden of [
			"clinemm_cancel_run",
			"clinemm_send_feedback",
			"clinemm_respond_approval",
			"run_commands",
			"editor",
			"read_file",
			"write_file",
		]) {
			expect(ids).not.toContain(forbidden)
		}
	})
})
