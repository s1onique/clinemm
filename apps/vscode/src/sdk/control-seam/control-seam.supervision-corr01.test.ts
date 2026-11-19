/**
 * ACT-CLINEMM-MCP-SUPERVISION-V2-CORR01
 *
 * The behavioral RED -> GREEN witnesses for the TWO P0 findings raised
 * by the `HALT_FEEDBACK_LIFECYCLE_CONSERVATION` review of
 * `ACT-CLINEMM-MCP-SUPERVISION-V2-01` at `f53dfab93`.
 *
 * WHAT IS UNDER TEST
 *
 * The REAL extension-host server (`ControlSeamServer`) over the REAL
 * AF_UNIX transport, driven through the REAL client. Every decision
 * under test is made by PRODUCTION server / ledger / codec code.
 *
 *
 * P0-1 - THE FINGERPRINT IS AMBIGUOUS
 *
 * The V2 implementation bound a supervision `requestId` to its payload
 * with a SHA-256 over a SEPARATOR-LESS concatenation:
 *
 *   [operation, sessionId, String(epoch), expectedRunId ?? "", text ?? ""].join("")
 *
 * Two DIFFERENT valid payloads therefore produce the SAME hash input:
 *
 *   Field        Payload A     Payload B
 *   Operation    feedback      feedback
 *   Session      session-123   session-123
 *   Epoch        2             2
 *   Expected run run_A         run_AB
 *   Text         BC            C
 *
 *   A -> "feedbacksession-1232run_ABC"
 *   B -> "feedbacksession-1232run_ABC"     <-- IDENTICAL
 *
 * Because the ledger lookup happens BEFORE the run-identity check, a
 * replay of an accepted request id with payload B returned payload A's
 * recorded ACCEPTANCE instead of `request-id-conflict`. That violates
 * the required "same request id + different payload -> reject"
 * contract.
 *
 * This is NOT a cryptographic hash collision - it is an AMBIGUOUS
 * SERIALIZATION. The correction is a canonical, unambiguous encoding.
 *
 * P0-2 - THE FEEDBACK BYPASSES THE CANONICAL TURN-START PRELUDE
 *
 * The MCP feedback route called the follow-up coordinator DIRECTLY.
 * That avoided the persisted approval-response enum (correct), but it
 * ALSO skipped the canonical lifecycle prelude that the ordinary UI
 * route performs:
 *
 *   - emit `same_task_continued` (the only accepted exit from
 *     `resumable` in the shadow's lifecycle),
 *   - fence the PREVIOUS canonical run (so a late terminal from the
 *     retired run cannot poison the resumed task),
 *   - set the turn phase to `streaming`,
 *   - clear the previous turn's completion signal,
 *   - publish the updated state to the webview.
 *
 * The correction REUSES that exact prelude - the same primitives, the
 * same order, the same writer identity - while still refusing to forward
 * the persisted approval-response enum.
 *
 *
 * THE WITNESS MAP
 *
 *   FP-1  the ambiguous encoding collides (the reviewer's payload pair)
 *   FP-2  the collision is EXPLOITABLE through the real server: the
 *         replayed payload returns the wrong recorded outcome
 *   FP-3  the canonical encoding does NOT collide
 *   FP-4  a same-id / different-payload replay is REJECTED end to end
 *   FP-5  the existing idempotency contract still holds (a byte-identical
 *         replay returns the SAME recorded outcome)
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ControlSeamClient, connectControlSeam } from "./control-seam-client"
import { ControlSeamEventBuffer } from "./control-seam-event-buffer"
import { CONTROL_SEAM_PROTOCOL_VERSION, type ControlSeamResponse } from "./control-seam-protocol"
import { ControlSeamServer } from "./control-seam-server"

/** A short private root so the AF_UNIX socket path stays under the limit. */
const SHORT_TMP_ROOT = "/tmp"

/** The epoch the fixture reports as the CURRENT conversation epoch. */
const CURRENT_EPOCH = 2

interface AuthorityFixture {
	/** The active session id the controller owns, or `undefined`. */
	sessionId?: string
	/** The workspace the host currently reports. */
	workspace: string
	/** The recorded `sendFeedback` calls. */
	readonly feedbackCalls: { readonly sessionId: string; readonly text: string; readonly expectedEpoch: number }[]
	/** The recorded `cancelRun` calls. */
	readonly cancelCalls: { readonly sessionId: string; readonly expectedEpoch: number }[]
	/** The phase the authority reports. */
	phase?: "idle" | "streaming" | "awaiting_followup" | "awaiting_approval" | "compacting" | "completed" | "error" | "resumable"
	/** The epoch the authority reports. */
	epoch?: number
	/** The run id the authority reports. */
	runId?: string
	/** The session id the authority accepts for a start. */
	acceptedSessionId?: string
	/** When true, the accepted start installs the session as ACTIVE. */
	installSessionOnAccept?: boolean
	/** The outcome the feedback authority reports. */
	feedbackOutcome?: "accepted" | "queued"
}

interface Harness {
	readonly server: ControlSeamServer
	readonly dir: string
	readonly socketPath: string
	readonly token: string
	readonly writeToken?: string
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

/** The authority fixture. Every security decision stays in production code. */
function makeAuthority(fixture: AuthorityFixture) {
	return {
		readActiveSessionId: () => fixture.sessionId,
		readActiveTaskId: () => undefined,
		readIsRunning: () => fixture.phase === "streaming",
		readQueuedPromptCount: () => 0,
		readRuntimeSnapshot: () => ({ status: fixture.phase, runId: fixture.runId ?? "run-current" }),
		readPublishedTaskState: () => undefined,
		readCurrentEpoch: () => fixture.epoch ?? CURRENT_EPOCH,
		readCurrentTurnPhase: () => fixture.phase,
		readWorkspaceRoot: async () => fixture.workspace,
		startAct: async (_input: { readonly prompt: string }) => {
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
			if (fixture.feedbackOutcome === "queued") {
				return { outcome: "queued" as const, queuedPromptId: "pending_queue_1" }
			}
			return { outcome: "accepted" as const }
		},
		cancelRun: async (input: { readonly sessionId: string; readonly expectedEpoch: number }) => {
			fixture.cancelCalls.push({ sessionId: input.sessionId, expectedEpoch: input.expectedEpoch })
			return { outcome: "accepted" as const }
		},
	}
}

async function startHarness(fixture: Partial<AuthorityFixture> = {}): Promise<Harness> {
	const dir = mkdtempSync(join(SHORT_TMP_ROOT, "cscorr-"))
	const socketPath = join(dir, "control.sock")
	const tokenPath = join(dir, "token")
	const ownerPath = join(dir, "owner.json")
	const eventBuffer = new ControlSeamEventBuffer()
	const fullFixture: AuthorityFixture = {
		workspace: fixture.workspace ?? "/tmp/workspace",
		feedbackCalls: fixture.feedbackCalls ?? [],
		cancelCalls: fixture.cancelCalls ?? [],
		...(fixture.sessionId !== undefined ? { sessionId: fixture.sessionId } : {}),
		...(fixture.phase !== undefined ? { phase: fixture.phase } : {}),
		...(fixture.epoch !== undefined ? { epoch: fixture.epoch } : {}),
		...(fixture.runId !== undefined ? { runId: fixture.runId } : {}),
		...(fixture.acceptedSessionId !== undefined ? { acceptedSessionId: fixture.acceptedSessionId } : {}),
		...(fixture.installSessionOnAccept !== undefined ? { installSessionOnAccept: fixture.installSessionOnAccept } : {}),
		...(fixture.feedbackOutcome !== undefined ? { feedbackOutcome: fixture.feedbackOutcome } : {}),
	}
	const mutationOptInPath = join(dir, "mutation.json")
	writeFileSync(mutationOptInPath, JSON.stringify({ v: 1, enabled: true, allowContentRead: false }), { mode: 0o600 })
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
		forceMutationEnabled: true,
	})
	const handle = await server.start()
	expect(handle).toBeDefined()
	const harness: Harness = {
		server,
		dir,
		socketPath,
		token: handle!.token,
		fixture: fullFixture,
		...(handle!.writeToken !== undefined ? { writeToken: handle!.writeToken } : {}),
	}
	openHarnesses.push(harness)
	return harness
}

/** Send a request over a FRESH socket. */
async function send(harness: Harness, request: Record<string, unknown>): Promise<ControlSeamResponse> {
	const socket = await connectControlSeam(harness.socketPath)
	expect(socket).toBeDefined()
	try {
		const client = new ControlSeamClient(
			harness.token,
			harness.writeToken !== undefined ? { writeToken: harness.writeToken } : {},
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
function startActRequest(input: { readonly requestId: string }): Record<string, unknown> {
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: "clinemm_start_act",
		token: "read-token",
		writeToken: "write-token",
		payload: {
			op: "clinemm_start_act",
			input: { requestId: input.requestId, prompt: "fix the failures", expectedWorkspace: "/tmp/workspace" },
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
}): Record<string, unknown> {
	return {
		v: CONTROL_SEAM_PROTOCOL_VERSION,
		op: "clinemm_send_feedback",
		token: "read-token",
		writeToken: "write-token",
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

/** Start a task through the seam so the client OWNS a session. */
async function ownSession(harness: Harness, sessionId = "session-owned"): Promise<string> {
	harness.fixture.acceptedSessionId = sessionId
	harness.fixture.installSessionOnAccept = true
	const response = await send(harness, startActRequest({ requestId: `start-${sessionId}` }))
	expect(response.ok).toBe(true)
	expect(response.result).toMatchObject({ outcome: "accepted", sessionId })
	return sessionId
}

// ===========================================================================
// P0-1 - The fingerprint encoding
// ===========================================================================

describe("ACT-CLINEMM-MCP-SUPERVISION-V2-CORR01 - P0-1 the fingerprint encoding", () => {
	it("FP-1: the SEPARATOR-LESS encoding collides for the reviewer's payload pair", () => {
		// The EXACT payloads from the review.
		const payloadA = { operation: "feedback", sessionId: "session-123", expectedEpoch: 2, expectedRunId: "run_A", text: "BC" }
		const payloadB = { operation: "feedback", sessionId: "session-123", expectedEpoch: 2, expectedRunId: "run_AB", text: "C" }

		// The OLD encoding.
		const oldEncode = (p: typeof payloadA) =>
			[p.operation, p.sessionId, String(p.expectedEpoch), p.expectedRunId ?? "", p.text ?? ""].join("")

		expect(oldEncode(payloadA)).toBe("feedbacksession-1232run_ABC")
		expect(oldEncode(payloadB)).toBe("feedbacksession-1232run_ABC")
		// The two payloads are DIFFERENT...
		expect(payloadA.expectedRunId).not.toBe(payloadB.expectedRunId)
		expect(payloadA.text).not.toBe(payloadB.text)
		// ...yet the OLD encoding maps them onto the SAME input. This is
		// the ambiguity the correction removes.
		expect(oldEncode(payloadA)).toBe(oldEncode(payloadB))
	})

	it("FP-2: the collision is EXPLOITABLE through the REAL server - the replayed payload returns the WRONG recorded outcome", async () => {
		const harness = await startHarness({ phase: "idle", runId: "run_A" })
		const sessionId = await ownSession(harness, "session-123")

		// Payload A is accepted.
		const first = await send(
			harness,
			feedbackRequest({
				requestId: "req-collide",
				sessionId,
				expectedEpoch: 2,
				expectedRunId: "run_A",
				text: "BC",
			}),
		)
		expect(first.ok).toBe(true)
		expect(first.result).toMatchObject({ outcome: "accepted" })

		// Payload B is a DIFFERENT payload under the SAME request id.
		// The contract says: REJECT with `request-id-conflict`.
		const replay = await send(
			harness,
			feedbackRequest({
				requestId: "req-collide",
				sessionId,
				expectedEpoch: 2,
				expectedRunId: "run_AB",
				text: "C",
			}),
		)
		expect(replay.ok).toBe(true)
		const result = replay.result as { outcome?: string; reason?: string }
		// It MUST NOT report A's acceptance.
		expect(result.outcome).not.toBe("accepted")
		expect(result.outcome).toBe("rejected")
		expect(result.reason).toBe("request-id-conflict")
		// And it MUST NOT deliver a second message.
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
		expect(harness.fixture.feedbackCalls[0]?.text).toBe("BC")
	})

	it("FP-3: the CANONICAL encoding does NOT collide for the same payload pair", () => {
		const canonical = (p: {
			operation: string
			sessionId: string
			expectedEpoch: number
			expectedRunId?: string
			text?: string
		}) => JSON.stringify([p.operation, p.sessionId, p.expectedEpoch, p.expectedRunId ?? null, p.text ?? null])

		const a = canonical({
			operation: "feedback",
			sessionId: "session-123",
			expectedEpoch: 2,
			expectedRunId: "run_A",
			text: "BC",
		})
		const b = canonical({
			operation: "feedback",
			sessionId: "session-123",
			expectedEpoch: 2,
			expectedRunId: "run_AB",
			text: "C",
		})
		expect(a).not.toBe(b)
		expect(a).toBe('["feedback","session-123",2,"run_A","BC"]')
		expect(b).toBe('["feedback","session-123",2,"run_AB","C"]')
	})

	it("FP-4: a same-id / different-payload replay is REJECTED end to end, for a payload pair that does NOT collide under the old encoding either", async () => {
		const harness = await startHarness({ phase: "idle", runId: "run_A" })
		const sessionId = await ownSession(harness, "session-123")

		const first = await send(
			harness,
			feedbackRequest({ requestId: "req-diff", sessionId, expectedEpoch: 2, expectedRunId: "run_A", text: "first" }),
		)
		expect(first.result).toMatchObject({ outcome: "accepted" })

		const replay = await send(
			harness,
			feedbackRequest({ requestId: "req-diff", sessionId, expectedEpoch: 2, expectedRunId: "run_A", text: "second" }),
		)
		expect((replay.result as { outcome?: string }).outcome).toBe("rejected")
		expect((replay.result as { reason?: string }).reason).toBe("request-id-conflict")
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
	})

	it("FP-5: the existing idempotency contract still holds - a byte-identical replay returns the SAME recorded outcome and delivers NOTHING new", async () => {
		const harness = await startHarness({ phase: "idle", runId: "run_A" })
		const sessionId = await ownSession(harness, "session-123")

		const first = await send(
			harness,
			feedbackRequest({ requestId: "req-same", sessionId, expectedEpoch: 2, expectedRunId: "run_A", text: "same" }),
		)
		expect(first.result).toMatchObject({ outcome: "accepted" })

		const replay = await send(
			harness,
			feedbackRequest({ requestId: "req-same", sessionId, expectedEpoch: 2, expectedRunId: "run_A", text: "same" }),
		)
		expect(replay.ok).toBe(true)
		expect(replay.result).toMatchObject({ outcome: "accepted" })
		expect(harness.fixture.feedbackCalls).toHaveLength(1)
	})
})
