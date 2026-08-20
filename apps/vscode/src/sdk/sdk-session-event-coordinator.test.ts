import type { CoreSessionEvent } from "@cline/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { MessageTranslatorState } from "./message-translator"
import { PROVIDER_FAILURE_ERROR_TYPE, PROVIDER_FAILURE_PHASE } from "./provider-failure-telemetry"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "./sdk-session-event-coordinator"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}))

describe("SdkSessionEventCoordinator", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("translates and emits session messages, then posts state", async () => {
		const message: ClineMessage = { ts: 1, type: "say", say: "text", text: "hello" }
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [message],
				sessionEnded: false,
				turnComplete: false,
			},
		})

		coordinator.handleSessionEvent(event)
		await Promise.resolve()

		expect(options.messages.appendAndEmit).toHaveBeenCalledWith([message], event)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("filters late completion messages after cancellation", async () => {
		const { coordinator, options, event } = makeCoordinator({
			activeSession: makeActiveSession({ isRunning: false }),
			translation: {
				messages: [
					{ ts: 1, type: "ask", ask: "completion_result", text: "" },
					{ ts: 2, type: "say", say: "text", text: "kept" },
				],
				sessionEnded: false,
				turnComplete: false,
			},
		})

		coordinator.handleSessionEvent(event)
		await Promise.resolve()

		expect(options.messages.appendAndEmit).toHaveBeenCalledWith([{ ts: 2, type: "say", say: "text", text: "kept" }], event)
	})

	it("ignores stale events from inactive sessions", async () => {
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [{ ts: 1, type: "say", say: "text", text: "stale" }],
				sessionEnded: false,
				turnComplete: false,
			},
		})
		const staleEvent = {
			...event,
			payload: { ...event.payload, sessionId: "old-session" },
		} as CoreSessionEvent

		await coordinator.handleSessionEvent(staleEvent)

		expect(options.translateSessionEvent).not.toHaveBeenCalled()
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
		expect(options.postStateToWebview).not.toHaveBeenCalled()
	})

	it("marks turns complete through the session lifecycle", async () => {
		const activeSession = makeActiveSession()
		const { coordinator, options, event } = makeCoordinator({
			activeSession,
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
	})

	it("posts state on turn end even when the turn-complete event carries NO messages", async () => {
		// The `done` handler emits no transcript message, so a turn-complete event has
		// messages.length === 0. State must still be posted on turn end regardless of message
		// count, or the footer stays stuck on the previous phase (e.g. scroll-arrows /
		// streaming).
		//
		// ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01: the completion
		// CONTENT authority contract — a `completion_result` row requires a
		// committed terminal response. The harness bypasses the real translator
		// (translation is mocked with empty messages), so the translator-side
		// fallback does not run; no `completion_result` row is synthesized.
		//
		// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01: the PHASE transition is
		// independent of the CONTENT authority. Even with no terminal response
		// committed, the `done-without-completion` case MUST transition to
		// `awaiting_followup` (truthful user-owned incomplete yield) so the
		// TaskHeader stops showing "Working". The post still fires so the
		// webview receives the new phase.
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		// Liveness: phase transitions to `awaiting_followup` (truthful user-
		// owned incomplete yield) AND state is posted.
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("completed")
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("resolves the turn phase to 'error' when the turn surfaced a provider error", async () => {
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.setErrorSeen()

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("error")
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("awaiting_followup")
	})

	it("marks a submitted queued prompt as a new streaming turn", async () => {
		const message: ClineMessage = { ts: 1, type: "say", say: "user_feedback", text: "queued prompt" }
		const { coordinator, options } = makeCoordinator({
			translation: {
				messages: [message],
				sessionEnded: false,
				turnComplete: false,
			},
		})
		const clearTurnOutcome = vi.spyOn(options.messageTranslatorState, "clearTurnOutcome")
		const event: CoreSessionEvent = {
			type: "pending_prompt_submitted",
			payload: {
				sessionId: "session-123",
				id: "pending-1",
				prompt: "queued prompt",
				delivery: "queue",
				attachmentCount: 0,
			},
		} as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(clearTurnOutcome).toHaveBeenCalledOnce()
		expect(options.beginProviderFailureTelemetryTurn).toHaveBeenCalledOnce()
		expect(options.sessions.setRunning).toHaveBeenCalledWith(true)
		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming")
		expect(options.messages.appendAndEmit).toHaveBeenCalledWith([message], event)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("posts state for queued prompt turn start even when no transcript message is emitted", async () => {
		const { coordinator, options } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: false,
			},
		})
		const event: CoreSessionEvent = {
			type: "pending_prompt_submitted",
			payload: {
				sessionId: "session-123",
				id: "pending-1",
				prompt: "",
				delivery: "queue",
				attachmentCount: 0,
			},
		} as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming")
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("does NOT override the phase on a turn-complete straggler from an already-cancelled session", async () => {
		// After cancelTask sets phase "resumable" and aborts, the SDK may still emit a trailing
		// done/turnComplete. Because the session is no longer running, this straggler must NOT
		// set "awaiting_followup"/"completed" — doing so would clobber "resumable" and the footer
		// would lose the Resume Task button (showing scroll-arrows).
		const { coordinator, options, event } = makeCoordinator({
			activeSession: makeActiveSession({ isRunning: false }),
			turnPhase: "resumable",
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).not.toHaveBeenCalled()
	})

	it("resolves the phase when a queued turn completes after its running flag was clobbered", async () => {
		// When the SDK drains a queued prompt at turn end, the previous turn's send promise
		// settles after the queued turn already started and flips isRunning back to false
		// mid-turn. The queued turn's real completion must still resolve the terminal phase —
		// treating it as a cancel straggler leaves the phase stuck on "streaming" (endless
		// Thinking). Only an actual cancel (phase "resumable") is preserved.
		//
		// ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01: the completion
		// CONTENT authority contract — a `completion_result` row requires a
		// committed terminal response. In this mocked harness no messages are
		// emitted so the translator-side fallback does not run.
		//
		// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01: the PHASE transition is
		// independent of the CONTENT authority. Even with no terminal response
		// committed, the queued turn's `done-without-completion` case MUST
		// transition to `awaiting_followup` (truthful user-owned incomplete
		// yield) so the TaskHeader stops showing "Working" — same invariant
		// as CPL01 but exercised through the queued-turn-clobber path.
		const { coordinator, options, event } = makeCoordinator({
			activeSession: makeActiveSession({ isRunning: false }),
			turnPhase: "streaming",
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		// Liveness: the phase MUST transition to `awaiting_followup` (the
		// queued-turn-clobber path is the same done-without-completion case
		// as CPL01 — both must yield to the user).
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
		expect(options.sessions.setRunning).toHaveBeenCalledWith(false)
	})

	it("updates task usage when the active session has a start result", async () => {
		const { coordinator, options, event } = makeCoordinator({
			task: { taskId: "task-1" },
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: false,
				usage: { tokensIn: 3, tokensOut: 4, cacheReads: 5, cacheWrites: 0, totalCost: 0.01 },
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.taskHistory.updateTaskUsage).toHaveBeenCalledWith("task-1", {
			tokensIn: 3,
			tokensOut: 4,
			cacheReads: 5,
			cacheWrites: 0,
			totalCost: 0.01,
		})
	})

	it("zeros usage and api request message cost for free Cline models", async () => {
		const { coordinator, options, event } = makeCoordinator({
			isClineFreeModel: vi.fn().mockResolvedValue(true),
			task: { taskId: "task-1" },
			translation: {
				messages: [
					{
						ts: 1,
						type: "say",
						say: "api_req_started",
						text: JSON.stringify({ tokensIn: 10, tokensOut: 5, cost: 0.0016 }),
					},
				],
				sessionEnded: false,
				turnComplete: false,
				usage: { tokensIn: 10, tokensOut: 5, totalCost: 0.0016 },
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.messages.appendAndEmit).toHaveBeenCalledWith(
			[
				{
					ts: 1,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ tokensIn: 10, tokensOut: 5, cost: 0 }),
				},
			],
			event,
		)
		expect(options.taskHistory.updateTaskUsage).toHaveBeenCalledWith("task-1", {
			tokensIn: 10,
			tokensOut: 5,
			totalCost: 0,
		})
	})

	it("leaves mistake-limit recovery to the SDK callback instead of mutating tool-error events", async () => {
		const message: ClineMessage = { ts: 1, type: "say", say: "tool", text: "{}", partial: false }
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [message],
				sessionEnded: false,
				turnComplete: false,
				toolError: true,
			},
		})

		await coordinator.handleSessionEvent(event)

		expect(options.messages.appendAndEmit).toHaveBeenCalledWith([message], event)
		expect(options.sessions.setRunning).not.toHaveBeenCalled()
	})

	it("captures provider failure telemetry for SDK agent errors", async () => {
		const error = new Error("provider failed")
		const { coordinator, options } = makeCoordinator()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "error",
					error,
					recoverable: false,
				},
			},
		} as unknown as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.captureProviderApiError).toHaveBeenCalledWith({
			sessionId: "session-123",
			error,
			errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_ERROR,
			failurePhase: PROVIDER_FAILURE_PHASE.STREAMING,
		})
	})

	it("does not capture provider failure telemetry for SDK agent errors without an error payload", async () => {
		const { coordinator, options } = makeCoordinator()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "error",
				},
			},
		} as unknown as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.captureProviderApiError).not.toHaveBeenCalled()
	})

	it("does not capture provider failure telemetry for recoverable error events (mistake notices)", async () => {
		const { coordinator, options } = makeCoordinator()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "error",
					// The MistakeTracker emits one of these per recorded mistake,
					// carrying tool-failure details — not a provider API error.
					error: new Error('2 tool call(s) failed: [shell] {"error":"command not found"}'),
					recoverable: true,
				},
			},
		} as unknown as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.captureProviderApiError).not.toHaveBeenCalled()
	})

	it("captures provider failure telemetry when the SDK finishes a turn with reason error", async () => {
		const { coordinator, options } = makeCoordinator()
		const event: CoreSessionEvent = {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "done",
					reason: "error",
					text: "stream failed before assistant output",
					iterations: 1,
				},
			},
		} as unknown as CoreSessionEvent

		await coordinator.handleSessionEvent(event)

		expect(options.captureProviderApiError).toHaveBeenCalledWith({
			sessionId: "session-123",
			error: "stream failed before assistant output",
			errorType: PROVIDER_FAILURE_ERROR_TYPE.SDK_AGENT_DONE_ERROR,
			failurePhase: PROVIDER_FAILURE_PHASE.STREAMING,
		})
	})

	// ===========================================================================
	// ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY-LIVE-RECON01
	//
	// Canonical terminal invariant: a coordinator `setTurnPhase("awaiting_followup")`
	// (the user-owned terminal phase) must only fire when the translator actually
	// committed a terminal user-facing response (say:"completion_result" /
	// say:"plan_completion_result" / ask:"api_req_failed"). Otherwise the user sees
	// whatever intermediate debugging content was last — the LIVE screenshot witness.
	//
	// The harness's `translateSessionEvent` mock bypasses the real translator and is
	// the only place we can exercise the coordinator's invariant gate without the
	// production translator's help. The translator-level proof lives in
	// message-translator.test.ts (CRA02/CRA03/etc.). This block pins the COORD-side
	// invariant.
	// ===========================================================================

	it("CRA02-coord: done with no committed terminal response DOES promote to awaiting_followup (liveness-corrected)", async () => {
		// text → tool → done (no attemptCompletionSeen, no completion_result committed).
		// ACT-CLINEMM-COMPLETION-RESPONSE-AUTHORITY01-CORRECTION01: translation returns
		// 0 messages for the done event because the only non-tool authority source
		// (`takeTurnFinalText()`) was cleared by the tool call, and the unproven
		// fallback ladder (`takeLastAssistantFallback` / `takeOpenStreamingText`) has
		// been REMOVED. No `completion_result` row is synthesized from prior
		// intermediate content.
		//
		// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01: the prior CRA02-coord
		// contract ("do NOT promote to awaiting_followup when no terminal
		// response is committed") left `turnState.phase = "streaming"` forever
		// when the agent-runtime session-termination fallback fires
		// `finishRun("completed", finalAssistantMessage)` without a completion
		// tool. The TaskHeader state label is a pure projection from
		// `turnState.phase`, so the user saw a stuck "Working" header with no
		// model/tool/approval in flight.
		//
		// Liveness-corrected contract: a successful agent run end WITHOUT a
		// committed terminal response is an EXPLICIT user-owned incomplete
		// yield — phase `awaiting_followup` (the EXISTING phase-enum contract
		// for "done-without-completion" at `ExtensionMessage.ts:355`). The
		// completion authority contract (terminal CONTENT row requires
		// `terminalResponseCommittedThisTurn === true`) is UNCHANGED: no
		// `completion_result` row is synthesized here, only the phase
		// transitions to truthfully project the runtime-owned-but-no-work
		// state.
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.clearTurnOutcome()
		expect(options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()).toBe(false)

		await coordinator.handleSessionEvent(event)

		// Liveness: the phase MUST transition to `awaiting_followup`
		// (truthful user-owned incomplete yield; `turnAllowsFollowup() === true`
		// so the composer stays enabled and CRA13 user follow-up continues to
		// work).
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
		// Conservation: do NOT silently promote to `completed` (no completion
		// authority was committed; CRA02 terminal-content contract preserved).
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("completed")
	})

	it("CRA02-coord-translator-committed: DOES promote to awaiting_followup when the translator committed a terminal completion_result", async () => {
		// Symmetric control case: when the translator committed a canonical terminal
		// response (the completion tool `content_end`, OR the `takeTurnFinalText()`
		// happy path when the turn ended on text), the coordinator may safely flip to
		// awaiting_followup. This is the ONLY path that produces a successful terminal
		// promotion.
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [{ ts: 1, type: "say", say: "completion_result", text: "All done", partial: false }],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		// Simulate the translator recording the terminal-response authority.
		options.messageTranslatorState.setTerminalResponseCommittedThisTurn()

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
	})

	it("CRA03-coord: attemptCompletionSeen but no committed terminal response must NOT promote to completed", async () => {
		// CRA03 production seam: attempt_completion content_start fired (so
		// attemptCompletionSeen is true) but content_end never arrived. The partial
		// completion_result is the last assistant content but its `partial` flag is true.
		// The coordinator must NOT promote to completed (which would render the bogus green
		// box); it must also NOT promote to awaiting_followup (which would let the user
		// send the next prompt as if the task had finished).
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.setAttemptCompletionSeen()
		expect(options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()).toBe(false)

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).not.toHaveBeenCalledWith("completed")
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("awaiting_followup")
	})

	// ===========================================================================
	// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01: forward-progress guarantee when
	// the agent run returns normally without a canonical terminal response.
	//
	// The completion-response-authority ACT (CRA02/CRA03) pinned "do NOT promote
	// to awaiting_followup" — but that contract left `turnState.phase =
	// "streaming"` forever when the agent-runtime session-termination fallback
	// fires `finishRun("completed", finalAssistantMessage)` without a completion
	// tool. The TaskHeader state label is a pure projection from
	// `turnState.phase`, so the visible "Working" header stuck indefinitely with
	// no model/tool/approval in flight. The liveness epic reverses the runtime-
	// owned branch into an EXPLICIT user-owned incomplete yield: phase
	// `awaiting_followup`, which is the EXISTING phase-enum contract for
	// "done-without-completion" (`ExtensionMessage.ts:355`).
	//
	// `turnAllowsFollowup()` returns true for `awaiting_followup`, so user
	// follow-up routes through the existing follow-up coordinator (CRA13
	// conservation). The completion-tool path is unaffected: completion
	// authority still gates the `completed` phase AND the `completion_result`
	// content row.
	// ===========================================================================

	it("CPL01: done with no terminal response / no attempt-completion / no error transitions to awaiting_followup (liveness)", async () => {
		// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01 RED. Production-seam
		// forward-progress invariant: when an interactive run ends normally
		// without committing any terminal-response authority, the phase must
		// transition to a user-owned state — NOT remain runtime-owned
		// (`streaming`), because the TaskHeader state label is a pure
		// phase projection and the user must NOT see a stuck "Working"
		// header with no cancellable work in flight.
		//
		// Reaches `done(reason=completed)` via the agent-runtime session-
		// termination fallback (`sdk/packages/agents/src/agent-runtime.ts
		// :1313-1336`) because either (a) no `completesRun` tool was
		// registered for this configuration, or (b) the completion-reminder
		// loop exhausted `maxIterations` without the model calling the
		// completion tool.
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.clearTurnOutcome()
		expect(options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()).toBe(false)
		expect(options.messageTranslatorState.wasAttemptCompletionSeen()).toBe(false)
		expect(options.messageTranslatorState.wasErrorSeen()).toBe(false)

		await coordinator.handleSessionEvent(event)

		// FORWARD-PROGRESS INVARIANT: the phase MUST transition to the
		// existing user-owned incomplete-yield phase. `awaiting_followup`
		// keeps the composer enabled (`turnAllowsFollowup() === true`),
		// which is the same condition the CRA02-empty branch deliberately
		// preserved — but now with truthful phase projection so the
		// TaskHeader stops showing "Working" with nothing in flight.
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
		// Symmetric: do NOT silently promote to `completed` (no completion
		// authority was committed; CRA02 conservation preserved).
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("completed")
	})

	it("CPL02: done with committed terminal response AND attempt-completion transitions to completed (control: completion-tool path)", async () => {
		// Symmetric control case. The valid completion-tool path still
		// transitions to `completed` AND commits a `completion_result`
		// content row. This is the existing CRA02-committed contract —
		// pinned here so a future repair does not regress the completion
		// authority while fixing liveness.
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [{ ts: 1, type: "say", say: "completion_result", text: "All done", partial: false }],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.setAttemptCompletionSeen()
		options.messageTranslatorState.setTerminalResponseCommittedThisTurn()

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("completed")
	})

	it("CPL03: done with committed terminal response but NO attempt-completion transitions to awaiting_followup (control: text-path)", async () => {
		// Symmetric control case. The valid text → done path with a
		// committed terminal response (no completion tool used) transitions
		// to `awaiting_followup` so the user can keep talking. This is the
		// existing CRA02-committed contract for the non-tool text path.
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [{ ts: 1, type: "say", say: "completion_result", text: "All done", partial: false }],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.setTerminalResponseCommittedThisTurn()

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup")
	})

	it("CPL04: done with attempt-completion declared but NO committed terminal response stays runtime-owned (CRA03 conservation)", async () => {
		// CRA03 straggler case: completion tool `content_start` fired but
		// `content_end` never arrived before `done`. The model may be
		// mid-completion and may recover on a subsequent turn — DO NOT
		// transition to `completed` (would render the bogus green box) AND
		// DO NOT transition to `awaiting_followup` (would let the user
		// treat this as a terminal state when the model is still working).
		// Leave `phase = "streaming"` so the runtime keeps ownership.
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.setAttemptCompletionSeen()
		expect(options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()).toBe(false)

		await coordinator.handleSessionEvent(event)

		// Symmetric: neither promoted. The runtime-owned "streaming" phase
		// is the truthful state for a CRA03 straggler.
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("completed")
		expect(options.setTurnPhase).not.toHaveBeenCalledWith("awaiting_followup")
	})

	it("CPL05: done with error transitions to error (conservation)", async () => {
		// Symmetric control case. Provider-failure surfaces (ask:"api_req_failed")
		// must transition to the existing `error` phase. Pinned so the liveness
		// fix does not regress error recovery (Retry / Start New Task).
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.setErrorSeen()
		options.messageTranslatorState.setTerminalResponseCommittedThisTurn()

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("error")
	})
})

function makeCoordinator(input: Partial<MakeCoordinatorInput> = {}) {
	const event: CoreSessionEvent = {
		type: "agent_event",
		payload: {
			sessionId: "session-123",
			event: { type: "done", success: true },
		},
	} as unknown as CoreSessionEvent
	const activeSession = input.activeSession ?? makeActiveSession()
	const options = {
		messageTranslatorState: new MessageTranslatorState(),
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
		},
		taskHistory: {
			updateTaskUsage: vi.fn(),
		},
		getTask: vi.fn(() => input.task),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: vi.fn(),
		getTurnPhase: vi.fn(() => input.turnPhase ?? "streaming"),
		captureProviderApiError: vi.fn(),
		beginProviderFailureTelemetryTurn: vi.fn(),
		translateSessionEvent: vi.fn(() => input.translation ?? { messages: [], sessionEnded: false, turnComplete: false }),
		isClineFreeModel: input.isClineFreeModel,
	} as unknown as SdkSessionEventCoordinatorOptions & {
		sessions: SdkSessionEventCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
		}
		messages: SdkSessionEventCoordinatorOptions["messages"] & { appendAndEmit: ReturnType<typeof vi.fn> }
		taskHistory: SdkSessionEventCoordinatorOptions["taskHistory"] & { updateTaskUsage: ReturnType<typeof vi.fn> }
		postStateToWebview: ReturnType<typeof vi.fn>
		captureProviderApiError: ReturnType<typeof vi.fn>
		beginProviderFailureTelemetryTurn: ReturnType<typeof vi.fn>
		translateSessionEvent: ReturnType<typeof vi.fn>
		messageTranslatorState: MessageTranslatorState
	}

	return {
		coordinator: new SdkSessionEventCoordinator(options),
		options,
		event,
	}
}

function makeActiveSession(input: Partial<{ isRunning: boolean }> = {}) {
	return {
		sessionId: "session-123",
		sdkHost: {},
		unsubscribe: vi.fn(),
		startResult: { sessionId: "session-123" },
		isRunning: input.isRunning ?? true,
	}
}

interface MakeCoordinatorInput {
	activeSession: ReturnType<typeof makeActiveSession>
	task: { taskId: string }
	turnPhase: "streaming" | "resumable"
	isClineFreeModel: () => Promise<boolean>
	translation: {
		messages: ClineMessage[]
		sessionEnded: boolean
		turnComplete: boolean
		toolError?: boolean
		usage?: {
			tokensIn: number
			tokensOut: number
			cacheWrites?: number
			cacheReads?: number
			totalCost?: number
		}
	}
}
