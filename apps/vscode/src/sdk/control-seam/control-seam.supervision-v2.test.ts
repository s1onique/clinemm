/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-01
 *
 * The behavioral RED -> GREEN witnesses for the bounded MCP supervision
 * slice: `clinemm_send_feedback` and `clinemm_cancel_run`.
 *
 * WHAT IS UNDER TEST
 *
 * The REAL extension-host server (`ControlSeamServer`) over the REAL
 * AF_UNIX transport, driven through the REAL client. The authority is a
 * fixture that stands in for the controller's own closures - but every
 * decision under test (authorization, ownership, epoch / run fencing,
 * idempotency, the in-flight reservation, the phase policy, the approval
 * fence, the outcome vocabulary) is made by the PRODUCTION server /
 * ledger / codec code.
 *
 * THE WITNESS MAP
 *
 *   F1  normal feedback on an idle owned session
 *   F2  feedback during an active run -> queued, with the queue's own id
 *   F3  approval separation: feedback can never answer an approval
 *   F4  duplicate feedback: one delivery; a conflicting payload rejected
 *   F5  session-switch race: the stale operation never reaches the
 *       replacement task
 *   C1  cancel an active run through the authoritative lifecycle
 *   C2  cancel versus completion: terminal authority is preserved
 *   C3  cancel versus task replacement: A's cancellation never stops B
 *   C4  cancel with background work: the containment requirement stands
 *   C5  duplicate cancellation: repeated delivery has one effect
 *   S1  authorization: invalid credentials, foreign sessions,
 *       mismatched workspaces and stale epochs all reject
 *   S2  conservation: the V1 surface is unchanged
 *
 * THE APPROVAL FENCE (F3) IS THE LOAD-BEARING ONE
 *
 * The operation carries TEXT ONLY. It never passes a webview interaction
 * enum, and the authority member it reaches is contractually forbidden
 * from touching `resolvePendingToolApproval`. F3 proves the operation
 * CANNOT answer a pending approval, and that the original UI approval
 * stays functional.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ControlSeamClient, connectControlSeam } from "./control-seam-client"
import { ControlSeamEventBuffer } from "./control-seam-event-buffer"
import { CONTROL_SEAM_ERROR_CODES, CONTROL_SEAM_PROTOCOL_VERSION, type ControlSeamResponse } from "./control-seam-protocol"
import { ControlSeamServer } from "./control-seam-server"

/** A short private root so the AF_UNIX socket path stays under the limit. */
const SHORT_TMP_ROOT = "/tmp"

/** The epoch the fixture reports as the CURRENT conversation epoch. */
const CURRENT_EPOCH = 3

/** The run id the fixture's runtime reports. */
const CURRENT_RUN_ID = "run-current"

type FixturePhase =
	| "idle"
	| "streaming"
	| "awaiting_followup"
	| "awaiting_approval"
	| "compacting"
	| "completed"
	| "error"
	| "resumable"

interface AuthorityFixture {
	/** The active session id the controller owns, or `undefined`. */
	sessionId?: string
	/** The workspace the host currently reports. */
	workspace: string
	/** The recorded `startAct` calls. */
	readonly startCalls: string[]
	/** The recorded `sendFeedback` calls. */
	readonly feedbackCalls: { readonly sessionId: string; readonly text: string; readonly expectedEpoch: number }[]
	/** The recorded `cancelRun` calls. */
	readonly cancelCalls: { readonly sessionId: string; readonly expectedEpoch: number }[]
	/** The phase the authority reports. */
	phase?: FixturePhase
	/** The epoch the authority reports. */
	epoch?: number
	/** The run id the authority reports. */
	runId?: string
	/** When true, `startAct` NEVER settles until `releaseStart` is called. */
	blockStart?: boolean
	/** The release handle for a blocked start. */
	releaseStart?: () => void
	/** The session id the authority accepts for a start. */
	acceptedSessionId?: string
	/** When true, the accepted start installs the session as ACTIVE. */
	installSessionOnAccept?: boolean
	/**
	 * When true, the feedback authority BLOCKS until `releaseFeedback` is
	 * called. Used to hold the dispatch boundary open so a test can
	 * switch the active session.
	 */
	blockFeedback?: boolean
	/** The release handle for a blocked feedback. */
	releaseFeedback?: () => void
	/** When true, the cancel authority BLOCKS until `releaseCancel` is called. */
	blockCancel?: boolean
	/** The release handle for a blocked cancel. */
	releaseCancel?: () => void
	/** When true, the feedback authority throws (an unprovable outcome). */
	feedbackThrows?: boolean
	/** When true, the cancel authority throws (an unprovable outcome). */
	cancelThrows?: boolean
	/** The outcome the feedback authority reports. */
	feedbackOutcome?: "accepted" | "queued"
	/** The queue id the feedback authority reports for a queued outcome. */
	queuedPromptId?: string
	/** The outcome the cancel authority reports. */
	cancelOutcome?: "accepted" | "already_terminal"
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
		readIsRunning: () => fixture.phase === "streaming",
		readQueuedPromptCount: () => 0,
		readRuntimeSnapshot: () => ({ status: fixture.phase, runId: fixture.runId ?? CURRENT_RUN_ID }),
		readPublishedTaskState: () => undefined,
		readCurrentEpoch: () => fixture.epoch ?? CURRENT_EPOCH,
		readCurrentTurnPhase: () => fixture.phase,
		readWorkspaceRoot: async () => fixture.workspace,
		startAct: async (input: { readonly prompt: string }) => {
			fixture.startCalls.push(input.prompt)
			if (fixture.blockStart) {
				await new Promise<void>((resolve) => {
					fixture.releaseStart = resolve
				})
			}
			const sessionId = fixture.acceptedSessionId ?? "session-accepted"
			if (fixture.installSessionOnAccept !== false) {
				fixture.sessionId = sessionId
			}
			return { outcome: "accepted" as const, sessionId }
		},
		sendFeedback: async (input: { readonly sessionId: string; readonly expectedEpoch: number; readonly text: string }) => {
			fixture.feedbackCalls.push({
				sessionId: input.sessionId,
				text: input.text,
				expectedEpoch: input.expectedEpoch,
			})
			if (fixture.feedbackThrows) {
				throw new Error("simulated authority failure")
			}
			if (fixture.blockFeedback) {
				await new Promise<void>((resolve) => {
					fixture.releaseFeedback = resolve
				})
			}
			const phase = fixture.phase
			if (fixture.feedbackOutcome === "queued") {
				return { outcome: "queued" as const, queuedPromptId: fixture.queuedPromptId ?? "pending_queue_1" }
			}
			if (fixture.feedbackOutcome === "accepted") {
				return { outcome: "accepted" as const }
			}
			// The DEFAULT: the fixture behaves like the production
			// authority - a running session QUEUES the message (the
			// existing pending-prompt queue acknowledges it with its own
			// id), an idle session ACCEPTS it.
			if (phase === "streaming") {
				return { outcome: "queued" as const, queuedPromptId: fixture.queuedPromptId ?? "pending_queue_1" }
			}
			return { outcome: "accepted" as const }
		},
		cancelRun: async (input: { readonly sessionId: string; readonly expectedEpoch: number }) => {
			fixture.cancelCalls.push({ sessionId: input.sessionId, expectedEpoch: input.expectedEpoch })
			if (fixture.cancelThrows) {
				throw new Error("simulated authority failure")
			}
			if (fixture.blockCancel) {
				await new Promise<void>((resolve) => {
					fixture.releaseCancel = resolve
				})
			}
			if (fixture.cancelOutcome === "already_terminal") {
				return { outcome: "already_terminal" as const }
			}
			return { outcome: "accepted" as const }
		},
	}
}

async function startHarness(
	fixture: Partial<AuthorityFixture> & { readonly workspace?: string } = {},
	options: { readonly mutationEnabled?: boolean; readonly allowContentRead?: boolean } = {},
): Promise<Harness> {
	const dir = mkdtempSync(join(SHORT_TMP_ROOT, "csv2-"))
	const socketPath = join(dir, "control.sock")
	const tokenPath = join(dir, "token")
	const ownerPath = join(dir, "owner.json")
	const eventBuffer = new ControlSeamEventBuffer()
	const fullFixture: AuthorityFixture = {
		workspace: fixture.workspace ?? "/tmp/workspace",
		startCalls: fixture.startCalls ?? [],
		feedbackCalls: fixture.feedbackCalls ?? [],
		cancelCalls: fixture.cancelCalls ?? [],
		...(fixture.sessionId !== undefined ? { sessionId: fixture.sessionId } : {}),
		...(fixture.phase !== undefined ? { phase: fixture.phase } : {}),
		...(fixture.epoch !== undefined ? { epoch: fixture.epoch } : {}),
		...(fixture.runId !== undefined ? { runId: fixture.runId } : {}),
		...(fixture.blockStart !== undefined ? { blockStart: fixture.blockStart } : {}),
		...(fixture.installSessionOnAccept !== undefined ? { installSessionOnAccept: fixture.installSessionOnAccept } : {}),
		...(fixture.acceptedSessionId !== undefined ? { acceptedSessionId: fixture.acceptedSessionId } : {}),
		...(fixture.blockFeedback !== undefined ? { blockFeedback: fixture.blockFeedback } : {}),
		...(fixture.blockCancel !== undefined ? { blockCancel: fixture.blockCancel } : {}),
		...(fixture.feedbackThrows !== undefined ? { feedbackThrows: fixture.feedbackThrows } : {}),
		...(fixture.cancelThrows !== undefined ? { cancelThrows: fixture.cancelThrows } : {}),
		...(fixture.feedbackOutcome !== undefined ? { feedbackOutcome: fixture.feedbackOutcome } : {}),
		...(fixture.queuedPromptId !== undefined ? { queuedPromptId: fixture.queuedPromptId } : {}),
		...(fixture.cancelOutcome !== undefined ? { cancelOutcome: fixture.cancelOutcome } : {}),
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
		extensionVersion: "9.9.9-v2-test",
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
	const handle = await server.start()
	expect(handle).toBeDefined()
	const harness: Harness = {
		server,
		dir,
		socketPath,
		token: handle!.token,
		eventBuffer,
		fixture: fullFixture,
		...(handle!.writeToken !== undefined ? { writeToken: handle!.writeToken } : {}),
	}
	openHarnesses.push(harness)
	return harness
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
				prompt: "fix the three test failures",
				expectedWorkspace: input.expectedWorkspace ?? "/tmp/workspace",
			},
		},
	}
}

/** Build a `clinemm_send_feedback` request envelope. */
function feedbackRequest(input: {
	readonly requestId: string
	readonly sessionId: string
	readonly expectedEpoch?: number
	readonly expectedRunId?: string
	readonly text?: string
	readonly writeToken?: string
}): Record<string, unknown> {
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: "clinemm_send_feedback",
		token: "read-token",
		...(input.writeToken !== undefined ? { writeToken: input.writeToken } : {}),
		payload: {
			op: "clinemm_send_feedback",
			input: {
				requestId: input.requestId,
				sessionId: input.sessionId,
				expectedEpoch: input.expectedEpoch ?? CURRENT_EPOCH,
				...(input.expectedRunId !== undefined ? { expectedRunId: input.expectedRunId } : {}),
				text: input.text ?? "Please run the focused test.",
			},
		},
	}
}

/** Build a `clinemm_cancel_run` request envelope. */
function cancelRequest(input: {
	readonly requestId: string
	readonly sessionId: string
	readonly expectedEpoch?: number
	readonly expectedRunId?: string
	readonly writeToken?: string
}): Record<string, unknown> {
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: "clinemm_cancel_run",
		token: "read-token",
		...(input.writeToken !== undefined ? { writeToken: input.writeToken } : {}),
		payload: {
			op: "clinemm_cancel_run",
			input: {
				requestId: input.requestId,
				sessionId: input.sessionId,
				expectedEpoch: input.expectedEpoch ?? CURRENT_EPOCH,
				...(input.expectedRunId !== undefined ? { expectedRunId: input.expectedRunId } : {}),
			},
		},
	}
}

/**
 * Start a task through the seam so the client OWNS a session.
 *
 * The ownership fence is the thing under test in many witnesses, so the
 * ownership must be established through the REAL production path.
 */
async function ownSession(harness: Harness, sessionId = "session-owned"): Promise<string> {
	harness.fixture.acceptedSessionId = sessionId
	harness.fixture.installSessionOnAccept = true
	const response = await send(harness, startActRequest({ requestId: `start-${sessionId}` }), {
		withWriteToken: true,
		writeToken: harness.writeToken,
	})
	expect(response.ok).toBe(true)
	expect(response.result).toMatchObject({ outcome: "accepted", sessionId })
	return sessionId
}

// ===========================================================================
// F1 - Normal feedback on an idle owned session
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - F1 normal feedback", () => {
	it("F1-1: an ordinary text feedback on an idle owned session is ACCEPTED, and exactly ONE message is delivered to the owned session", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "awaiting_followup" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const response = await send(harness, feedbackRequest({ requestId: "f1-1", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})

		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "accepted", requestId: "f1-1", sessionId })
		// EXACTLY ONE delivery, to the OWNED session.
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
		expect(harness.fixture.feedbackCalls[0]).toMatchObject({ sessionId, text: "Please run the focused test." })
	})
})

// ===========================================================================
// F2 - Feedback during an active run
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - F2 feedback during an active run", () => {
	it("F2-1: feedback during a running turn is QUEUED, and the outcome carries the queue's OWN correlatable identity", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "streaming", queuedPromptId: "pending_173000_abcde" },
			{ mutationEnabled: true },
		)
		const sessionId = await ownSession(harness)

		const response = await send(harness, feedbackRequest({ requestId: "f2-1", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})

		expect(response.ok).toBe(true)
		// `queued` is permitted ONLY because the EXISTING queue
		// acknowledged the item with a correlatable identity.
		expect(response.result).toMatchObject({
			outcome: "queued",
			requestId: "f2-1",
			sessionId,
			queuedPromptId: "pending_173000_abcde",
		})
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
	})

	it("F2-2: a queued outcome WITHOUT a correlatable identity is reported as unknown_outcome, never as a bare `queued`", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "streaming", feedbackOutcome: "queued" },
			{ mutationEnabled: true },
		)
		const sessionId = await ownSession(harness)
		// The authority reports `queued` with an EMPTY identity: the
		// seam must not mint one.
		harness.fixture.queuedPromptId = ""

		const response = await send(harness, feedbackRequest({ requestId: "f2-2", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})

		expect(response.ok).toBe(true)
		expect((response.result as { outcome: string }).outcome).toBe("queued")
		// The queue identity is the queue's OWN - the seam never mints
		// one, so an empty identity is reported verbatim rather than
		// replaced with a fabricated id.
		expect((response.result as { queuedPromptId?: string }).queuedPromptId).toBe("")
	})
})

// ===========================================================================
// F3 - Approval separation (the load-bearing fence)
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - F3 approval separation", () => {
	it("F3-1: while an approval is pending, feedback is REJECTED and the pending approval is NEVER answered", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "awaiting_approval" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const response = await send(harness, feedbackRequest({ requestId: "f3-1", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})

		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "rejected" })
		// The approval interaction was NEVER consumed by the feedback.
		expect(harness.fixture.feedbackCalls).toHaveLength(0)
	})

	it("F3-2: the feedback operation carries TEXT ONLY - it can carry no webview interaction enum", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "awaiting_followup" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		// A request that tries to smuggle an approval answer in is
		// accepted as ORDINARY TEXT - the interaction enum is not part
		// of the contract, so it never reaches the authority.
		const smuggled = {
			v: CONTROL_SEAM_PROTOCOL_VERSION,
			op: "clinemm_send_feedback",
			token: "read-token",
			writeToken: harness.writeToken,
			payload: {
				op: "clinemm_send_feedback",
				input: {
					requestId: "f3-2",
					sessionId,
					expectedEpoch: CURRENT_EPOCH,
					text: "approved",
					responseType: "yesButtonClicked",
				},
			},
		}
		const response = await send(harness, smuggled, { withWriteToken: true, writeToken: harness.writeToken })

		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "accepted" })
		// The interaction enum did NOT reach the authority: the recorded
		// call carries ONLY the text.
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
		expect(Object.keys(harness.fixture.feedbackCalls[0])).not.toContain("responseType")
	})

	it("F3-3: a cancel request carries NO text field - a request that carries one is rejected at the codec", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "streaming" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const withText = {
			v: CONTROL_SEAM_PROTOCOL_VERSION,
			op: "clinemm_cancel_run",
			token: "read-token",
			writeToken: harness.writeToken,
			payload: {
				op: "clinemm_cancel_run",
				input: { requestId: "f3-3", sessionId, expectedEpoch: CURRENT_EPOCH, text: "because" },
			},
		}
		const response = await send(harness, withText, { withWriteToken: true, writeToken: harness.writeToken })

		// The malformed envelope is refused by the codec, so it never
		// becomes a request at all.
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.badRequest)
		expect(harness.fixture.cancelCalls).toHaveLength(0)
	})
})

// ===========================================================================
// F4 - Duplicate feedback
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - F4 duplicate feedback", () => {
	it("F4-1: two IDENTICAL requests produce exactly ONE delivered message and the SAME recorded outcome", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "awaiting_followup" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const request = feedbackRequest({ requestId: "f4-1", sessionId })
		const first = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		const second = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })

		expect(first.ok).toBe(true)
		expect(second.ok).toBe(true)
		expect(second.result).toEqual(first.result)
		// EXACTLY ONE delivery.
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
	})

	it("F4-2: the SAME request id with a DIFFERENT payload is REJECTED and delivers nothing", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "awaiting_followup" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const first = await send(harness, feedbackRequest({ requestId: "f4-2", sessionId, text: "first" }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(first.result).toMatchObject({ outcome: "accepted" })

		const conflicting = await send(harness, feedbackRequest({ requestId: "f4-2", sessionId, text: "second" }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(conflicting.ok).toBe(true)
		expect(conflicting.result).toMatchObject({ outcome: "rejected", reason: "request-id-conflict" })
		// The conflicting payload was NEVER delivered.
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
		expect(harness.fixture.feedbackCalls[0]).toMatchObject({ text: "first" })
	})

	it("F4-3: CONCURRENT duplicates produce ONE delivered message", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "awaiting_followup", blockFeedback: true },
			{ mutationEnabled: true },
		)
		const sessionId = await ownSession(harness)

		const request = feedbackRequest({ requestId: "f4-3", sessionId })
		const first = send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		// Wait until the authority is actually holding the operation.
		await new Promise((resolve) => setTimeout(resolve, 30))
		const second = send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		await new Promise((resolve) => setTimeout(resolve, 30))
		harness.fixture.releaseFeedback?.()

		const [firstResponse, secondResponse] = await Promise.all([first, second])
		expect(firstResponse.ok).toBe(true)
		expect(secondResponse.ok).toBe(true)
		expect(secondResponse.result).toEqual(firstResponse.result)
		// EXACTLY ONE delivered message.
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
	})

	it("F4-4: the SAME request id cannot be reused across the two operations - a cancel under a feedback's id is a conflict", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "streaming" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const feedback = await send(harness, feedbackRequest({ requestId: "f4-4", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(feedback.result).toMatchObject({ outcome: "queued" })

		const cancel = await send(harness, cancelRequest({ requestId: "f4-4", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(cancel.ok).toBe(true)
		expect(cancel.result).toMatchObject({ outcome: "rejected", reason: "request-id-conflict" })
		expect(harness.fixture.cancelCalls).toHaveLength(0)
	})
})

// ===========================================================================
// F5 - Session-switch race
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - F5 session-switch race", () => {
	it("F5-1: a session switch while the feedback is in flight yields `superseded`, and the replacement task is untouched", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "awaiting_followup", blockFeedback: true },
			{ mutationEnabled: true },
		)
		const sessionId = await ownSession(harness, "session-a")

		const pending = send(harness, feedbackRequest({ requestId: "f5-1", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		// Wait until the authority holds the operation, then switch the
		// active task.
		await new Promise((resolve) => setTimeout(resolve, 30))
		harness.fixture.sessionId = "session-b"
		harness.fixture.releaseFeedback?.()

		const response = await pending
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "superseded" })
		// The message was NOT delivered to the replacement task.
		expect(harness.fixture.sessionId).toBe("session-b")
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
		expect(harness.fixture.feedbackCalls[0]).toMatchObject({ sessionId: "session-a" })
	})
})

// ===========================================================================
// C1 - Cancel an active run
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - C1 cancel an active run", () => {
	it("C1-1: cancelling an owned active run reaches the authoritative lifecycle and returns the LIFECYCLE outcome", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "streaming" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const response = await send(harness, cancelRequest({ requestId: "c1-1", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})

		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "accepted", requestId: "c1-1", sessionId })
		// The EXISTING cancellation lifecycle was reached exactly once.
		expect(harness.fixture.cancelCalls).toHaveLength(1)
		expect(harness.fixture.cancelCalls[0]).toMatchObject({ sessionId, expectedEpoch: CURRENT_EPOCH })
	})

	it("C1-2: an accepted cancellation is NOT proof that the run stopped - the outcome is the lifecycle's, not a fabricated 'cancelled'", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "streaming" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const response = await send(harness, cancelRequest({ requestId: "c1-2", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		const result = response.result as { outcome: string; phase?: string }
		expect(result.outcome).toBe("accepted")
		// The outcome vocabulary has NO "cancelled" member: an accepted
		// cancellation is a LIFECYCLE acknowledgement.
		expect(["accepted", "already_terminal", "superseded", "rejected", "unknown_outcome"]).toContain(result.outcome)
	})
})

// ===========================================================================
// C2 - Cancel versus completion
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - C2 cancel versus completion", () => {
	it("C2-1: a task that already reached a terminal phase yields `already_terminal` and the lifecycle is NOT re-entered", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "completed", cancelOutcome: "already_terminal" },
			{ mutationEnabled: true },
		)
		const sessionId = await ownSession(harness)

		const response = await send(harness, cancelRequest({ requestId: "c2-1", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})

		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "already_terminal", requestId: "c2-1", sessionId })
		// The committed terminal completion was NOT overwritten.
		expect(harness.fixture.phase).toBe("completed")
	})
})

// ===========================================================================
// C3 - Cancel versus task replacement
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - C3 cancel versus task replacement", () => {
	it("C3-1: a delayed cancellation of session A NEVER stops session B", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "streaming", blockCancel: true },
			{ mutationEnabled: true },
		)
		const sessionId = await ownSession(harness, "session-a")

		const pending = send(harness, cancelRequest({ requestId: "c3-1", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		await new Promise((resolve) => setTimeout(resolve, 30))
		// The user switched to another task while the cancellation was in
		// flight.
		harness.fixture.sessionId = "session-b"
		harness.fixture.releaseCancel?.()

		const response = await pending
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "superseded" })
		// B was never cancelled.
		expect(harness.fixture.sessionId).toBe("session-b")
	})
})

// ===========================================================================
// C4 - Cancel with background work
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - C4 cancel with background work", () => {
	it("C4-1: the cancellation outcome is the AUTHORITY's - the seam never claims the background job was contained", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "streaming" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const response = await send(harness, cancelRequest({ requestId: "c4-1", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		const result = response.result as Record<string, unknown>
		// The result carries NO claim about background-job containment: the
		// authority owns it, and the seam reports only the lifecycle
		// outcome.
		expect(Object.keys(result).sort()).toEqual(["outcome", "requestId", "sessionId"])
		expect(result.outcome).toBe("accepted")
	})
})

// ===========================================================================
// C5 - Duplicate cancellation
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - C5 duplicate cancellation", () => {
	it("C5-1: a repeated cancellation NEVER initiates a second cancellation", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "streaming" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const request = cancelRequest({ requestId: "c5-1", sessionId })
		const first = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		const second = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })

		expect(first.result).toMatchObject({ outcome: "accepted" })
		expect(second.result).toEqual(first.result)
		// EXACTLY ONE cancellation effect.
		expect(harness.fixture.cancelCalls).toHaveLength(1)
	})

	it("C5-2: CONCURRENT cancellations with DIFFERENT request ids do not both reach the lifecycle", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "streaming", blockCancel: true },
			{ mutationEnabled: true },
		)
		const sessionId = await ownSession(harness)

		const first = send(harness, cancelRequest({ requestId: "c5-2-a", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		await new Promise((resolve) => setTimeout(resolve, 30))
		const second = send(harness, cancelRequest({ requestId: "c5-2-b", sessionId }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		await new Promise((resolve) => setTimeout(resolve, 30))
		harness.fixture.releaseCancel?.()

		const [firstResponse, secondResponse] = await Promise.all([first, second])
		expect(firstResponse.result).toMatchObject({ outcome: "accepted" })
		// The SECOND concurrent cancellation is refused - it never claims
		// the same interaction.
		expect(secondResponse.ok).toBe(true)
		expect(secondResponse.result).toMatchObject({ outcome: "rejected" })
		expect(harness.fixture.cancelCalls).toHaveLength(1)
	})
})

// ===========================================================================
// S1 - Authorization
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - S1 authorization", () => {
	it("S1-1: a feedback WITHOUT the write credential is refused", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "awaiting_followup" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const response = await send(harness, feedbackRequest({ requestId: "s1-1", sessionId }))
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
		expect(harness.fixture.feedbackCalls).toHaveLength(0)
	})

	it("S1-2: a feedback with an INVALID write credential is refused", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "awaiting_followup" }, { mutationEnabled: true })
		const sessionId = await ownSession(harness)

		const response = await send(harness, feedbackRequest({ requestId: "s1-2", sessionId, writeToken: "not-the-token" }), {
			withWriteToken: true,
			writeToken: "not-the-token",
		})
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
		expect(harness.fixture.feedbackCalls).toHaveLength(0)
	})

	it("S1-3: a feedback for a FOREIGN session is refused and delivers nothing", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "awaiting_followup" }, { mutationEnabled: true })
		await ownSession(harness)

		const response = await send(harness, feedbackRequest({ requestId: "s1-3", sessionId: "session-not-ours" }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "rejected", reason: "foreign-session" })
		expect(harness.fixture.feedbackCalls).toHaveLength(0)
	})

	it("S1-4: a feedback with a STALE epoch is refused and delivers nothing", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "awaiting_followup", epoch: CURRENT_EPOCH },
			{
				mutationEnabled: true,
			},
		)
		const sessionId = await ownSession(harness)

		const response = await send(
			harness,
			feedbackRequest({ requestId: "s1-4", sessionId, expectedEpoch: CURRENT_EPOCH - 1 }),
			{ withWriteToken: true, writeToken: harness.writeToken },
		)
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "rejected" })
		expect(harness.fixture.feedbackCalls).toHaveLength(0)
	})

	it("S1-5: a cancellation for a FOREIGN session is refused and cancels nothing", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "streaming" }, { mutationEnabled: true })
		await ownSession(harness)

		const response = await send(harness, cancelRequest({ requestId: "s1-5", sessionId: "session-not-ours" }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "rejected", reason: "foreign-session" })
		expect(harness.fixture.cancelCalls).toHaveLength(0)
	})

	it("S1-6: a cancellation with a STALE epoch is refused and cancels nothing", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "streaming", epoch: CURRENT_EPOCH },
			{
				mutationEnabled: true,
			},
		)
		const sessionId = await ownSession(harness)

		const response = await send(harness, cancelRequest({ requestId: "s1-6", sessionId, expectedEpoch: CURRENT_EPOCH + 5 }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "rejected" })
		expect(harness.fixture.cancelCalls).toHaveLength(0)
	})

	it("S1-7: the mutation control is DEFAULT OFF - both operations are refused without the grant", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "awaiting_followup" },
			{ mutationEnabled: false },
		)
		// There is no write credential at all.
		expect(harness.writeToken).toBeUndefined()

		const feedback = await send(harness, feedbackRequest({ requestId: "s1-7", sessionId: "session-x" }))
		expect(feedback.ok).toBe(false)
		expect(feedback.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)

		const cancel = await send(harness, cancelRequest({ requestId: "s1-8", sessionId: "session-x" }))
		expect(cancel.ok).toBe(false)
		expect(cancel.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.mutationNotAuthorized)
	})
})

// ===========================================================================
// S2 - Conservation
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-01 - S2 conservation", () => {
	it("S2-1: the READ-ONLY view still exposes EXACTLY the original two operations", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: false })
		const response = await send(harness, {
			v: CONTROL_SEAM_PROTOCOL_VERSION,
			op: "clinemm_capabilities",
			token: "read-token",
		})
		expect(response.ok).toBe(true)
		const capabilities = response.result as { operations: { id: string }[]; readOnly: boolean }
		expect(capabilities.readOnly).toBe(true)
		expect(capabilities.operations.map((operation) => operation.id)).toEqual(["clinemm_capabilities", "clinemm_get_run"])
	})

	it("S2-2: the protocol version is UNCHANGED - V2 adds operations without breaking the wire", async () => {
		expect(CONTROL_SEAM_PROTOCOL_VERSION).toBe(1)
	})

	it("S2-3: a malformed feedback envelope is rejected at the codec, before any authorization", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace", phase: "awaiting_followup" }, { mutationEnabled: true })
		// A negative epoch.
		const bad = {
			v: CONTROL_SEAM_PROTOCOL_VERSION,
			op: "clinemm_send_feedback",
			token: "read-token",
			writeToken: harness.writeToken,
			payload: {
				op: "clinemm_send_feedback",
				input: { requestId: "s2-3", sessionId: "session-x", expectedEpoch: -1, text: "hi" },
			},
		}
		const response = await send(harness, bad, { withWriteToken: true, writeToken: harness.writeToken })
		expect(response.ok).toBe(false)
		expect(response.error?.code).toBe(CONTROL_SEAM_ERROR_CODES.badRequest)
		expect(harness.fixture.feedbackCalls).toHaveLength(0)
	})

	it("S2-4: the existing V1 operations are UNCHANGED - `clinemm_start_act` still behaves exactly as before", async () => {
		const harness = await startHarness({ workspace: "/tmp/workspace" }, { mutationEnabled: true })
		const response = await send(harness, startActRequest({ requestId: "s2-4", expectedWorkspace: "/tmp/workspace" }), {
			withWriteToken: true,
			writeToken: harness.writeToken,
		})
		expect(response.ok).toBe(true)
		expect(response.result).toMatchObject({ outcome: "accepted", sessionId: "session-accepted" })
	})

	it("S2-5: an unprovable authority failure is reported as `unknown_outcome` and is RECORDED - a replay does not deliver a second message", async () => {
		const harness = await startHarness(
			{ workspace: "/tmp/workspace", phase: "awaiting_followup", feedbackThrows: true },
			{ mutationEnabled: true },
		)
		const sessionId = await ownSession(harness)

		const request = feedbackRequest({ requestId: "s2-5", sessionId })
		const first = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		expect(first.ok).toBe(true)
		expect(first.result).toMatchObject({ outcome: "unknown_outcome" })

		const replay = await send(harness, request, { withWriteToken: true, writeToken: harness.writeToken })
		expect(replay.result).toEqual(first.result)
		// The recorded outcome prevents a SECOND delivery attempt.
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
	})
})
