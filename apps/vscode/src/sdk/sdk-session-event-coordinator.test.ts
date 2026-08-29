import type { CoreSessionEvent } from "@cline/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import {
	clearPostTerminalAuthorityDiagnostic,
	disablePostTerminalAuthorityDiagnostic,
	enablePostTerminalAuthorityDiagnostic,
	getPostTerminalAuthorityDiagnosticRecords,
	recordPostTerminalAuthoritySnapshot,
} from "@shared/post-terminal-authority-diagnostic"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MessageTranslatorState, translateSessionEvent } from "./message-translator"
import { buildExtensionSnapshotFromState } from "./post-terminal-authority-diagnostic-builder"
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
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup", undefined, expect.any(String))
		expect((options.setTurnPhase as ReturnType<typeof vi.fn>)!.mock.calls.some((call) => call[0] === "completed")).toBe(false)
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

		expect(options.setTurnPhase).toHaveBeenCalledWith("error", undefined, expect.any(String))
		expect(
			(options.setTurnPhase as ReturnType<typeof vi.fn>)!.mock.calls.some((call) => call[0] === "awaiting_followup"),
		).toBe(false)
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
		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming", undefined, expect.any(String))
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

		expect(options.setTurnPhase).toHaveBeenCalledWith("streaming", undefined, expect.any(String))
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
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup", undefined, expect.any(String))
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
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup", undefined, expect.any(String))
		// Conservation: do NOT silently promote to `completed` (no completion
		// authority was committed; CRA02 terminal-content contract preserved).
		expect((options.setTurnPhase as ReturnType<typeof vi.fn>)!.mock.calls.some((call) => call[0] === "completed")).toBe(false)
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

		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup", undefined, expect.any(String))
	})

	it("CRA03-coord: attemptCompletionSeen but no committed terminal response yields awaiting_followup (liveness-corrected, post-CPL04)", async () => {
		// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01-CORRECTION01: this test
		// was originally the CRA03 straggler guard — `attemptCompletionSeen
		// === true`, `terminalResponseCommitted === false`, after `done`.
		// The original assertion rejected BOTH `completed` and
		// `awaiting_followup`, leaving the turn runtime-owned "streaming".
		// That contract only made sense while the run was still in progress
		// (the model could still iterate to deliver a proper `content_end`).
		//
		// On `done`, the agent-runtime has emitted
		// `finishRun("completed")` — either via the session-termination
		// fallback at `sdk/packages/agents/src/agent-runtime.ts:1313-1336`
		// or via a terminal race. No runnable successor exists. The
		// liveness-corrected contract is: DO NOT promote to `completed`
		// (no terminal content was committed; the partial
		// `completion_result` row remains partial with `partial: true`);
		// DO yield to `awaiting_followup` (truthful user-owned incomplete
		// yield). The completion CONTENT authority contract is unchanged
		// — no `completion_result` row is synthesized here.
		//
		// This test is now structurally identical to CPL04; keep it
		// because it documents the CRA03 → CPL04 contract evolution.
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

		expect((options.setTurnPhase as ReturnType<typeof vi.fn>)!.mock.calls.some((call) => call[0] === "completed")).toBe(false)
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup", undefined, expect.any(String))
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
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup", undefined, expect.any(String))
		// Symmetric: do NOT silently promote to `completed` (no completion
		// authority was committed; CRA02 conservation preserved).
		expect((options.setTurnPhase as ReturnType<typeof vi.fn>)!.mock.calls.some((call) => call[0] === "completed")).toBe(false)
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

		expect(options.setTurnPhase).toHaveBeenCalledWith("completed", undefined, expect.any(String))
	})

	it("CPL03: done with committed terminal response but NO attempt-completion transitions to awaiting_followup (structural/synthetic control)", async () => {
		// STRUCTURAL/SYNTHETIC CONSERVATION (not a current production path).
		// The state combination `terminalResponseCommitted=true &&
		// attemptCompletionSeen=false && errorSeen=false` is not reachable
		// via the production translator: `setTerminalResponseCommittedThisTurn`
		// is called ONLY at the completion tool's `content_end` (line 1652 of
		// message-translator.ts, which also sets `attemptCompletionSeen`) OR
		// at the `api_req_failed` handler (line 2024, which also sets
		// `errorSeen`).
		//
		// The CPL03 control pins the coord-side dispatch independently of
		// which producer of the terminal-row flag is the source. If a future
		// change introduces a third producer, the dispatcher must still
		// route the corresponding `done` event to `awaiting_followup` (the
		// user-owned terminal phase) when no completion tool was used.
		// The CPL01 fix confirmed the symmetric branch in the messenger
		// (no terminal commit, no completion tool) yields `awaiting_followup`;
		// this test confirms the `terminalResponseCommitted=true` branch
		// also yields `awaiting_followup` (NOT `completed`) when the
		// completion tool was NOT used.
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [{ ts: 1, type: "say", say: "completion_result", text: "All done", partial: false }],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		options.messageTranslatorState.setTerminalResponseCommittedThisTurn()

		await coordinator.handleSessionEvent(event)

		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup", undefined, expect.any(String))
	})

	it("CPL04: done with attempt-completion declared but NO committed terminal response yields awaiting_followup (liveness, symmetric to CPL01)", async () => {
		// ACT-CLINEMM-COMPLETION-PROTOCOL-LIVENESS01-CORRECTION01: production
		// path: completion tool's `content_start` was emitted (so
		// `attemptCompletionSeen === true`) but its `content_end` never
		// arrived (lost / malformed / interrupted / out-of-order). The agent
		// run terminated via `finishRun("completed")` either through the
		// session-termination fallback at
		// `sdk/packages/agents/src/agent-runtime.ts:1313-1336` after the
		// completion-reminder loop exhausted, or via an external termination
		// that arrived between `content_start` and `content_end`.
		//
		// The CPL04 invariant: once `done` has fired, the run is over. There
		// is no runnable successor — no completion-tool `content_end` to
		// deliver, no retry scheduled, no continuation loop, no pending
		// prompt. The only truthful projection is the same user-owned
		// incomplete yield as CPL01: `awaiting_followup`. CRITICAL: do NOT
		// promote to `completed` (the completion CONTENT authority contract
		// is unchanged — a partial `completion_result` row at `content_start`
		// is NOT a canonical terminal response).
		//
		// Distinction from the original CRA03 straggler guard: the CRA03
		// reasoning (left runtime-owned "streaming") was about the
		// IN-PROGRESS case, BEFORE `done` — the model could still iterate
		// to deliver a proper `content_end`. Once `done` has fired, the run
		// is over.
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

		// Liveness-corrected contract: no `completed` (no terminal content
		// was committed), AND yields to `awaiting_followup` (no runnable
		// successor exists after `done`).
		expect((options.setTurnPhase as ReturnType<typeof vi.fn>)!.mock.calls.some((call) => call[0] === "completed")).toBe(false)
		expect(options.setTurnPhase).toHaveBeenCalledWith("awaiting_followup", undefined, expect.any(String))
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

		expect(options.setTurnPhase).toHaveBeenCalledWith("error", undefined, expect.any(String))
	})

	// ============================================================================
	// ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01 — OWN01 (ownership-transfer RED)
	//
	// LIVE P0 ROOT CAUSE CANDIDATE:
	//   The live PTAD specimen
	//     .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-RECON01/
	//       live-20260829T134901Z/post-terminal-authority-diagnostic-extension.jsonl
	//   for task `1787991478667_tjjyj` shows the bare-done branch at
	//   `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:172-225`:
	//
	//     runtimeStatus=completed
	//     attemptCompletionSeen=false
	//     terminalResponseCommittedThisTurn=false
	//     taskTelemetry.toolCalls=222  (autonomous work DID happen)
	//     taskTelemetry.recoveryBudgetFailures=0
	//     taskHeaderPresentation.phase=awaiting_followup  ← this transition
	//
	//   LIVE_REASON = UNAVAILABLE_FROM_TRACE
	//     The PTAD specimen does NOT capture the authoritative
	//     `AgentDoneEvent.reason` (the `MessageTranslator` discards
	//     `agentEvent.reason` at `apps/vscode/src/sdk/message-translator.ts
	//     :2119`). We can therefore NOT claim this was specifically
	//     `max_iterations` — that is an inference, not a trace. The RED
	//     below pins the negative contract ONLY for the observable state
	//     (no terminal commit, no attempt_completion, no error); the
	//     finish-reason discrimination is OWN02's job in the next cycle.
	//
	//   The reviewer's bounded task: encode the ownership invariant for this
	//   state. The current CPL01 asserts `setTurnPhase("awaiting_followup",…)`
	//   IS called for this state — and the reviewer's hypothesis is that this
	//   is the WRONG contract when no explicit user-yield event/tool fired.
	//
	//   We deliberately do NOT yet prescribe the successor mechanism (per
	//   reviewer bound: "Do not yet assert 'call runTurn() again' or 'loop
	//   automatically.'"). The RED only pins that `awaiting_followup` is
	//   wrong in this state — the fix design will introduce a finish-reason
	//   discriminator (preserving `AgentDoneEvent.reason` through the
	//   translator) and route the bare-done case to the correct successor.
	//
	//   This test fails on current code (RED), proving the missing causal
	//   seam: the coord has no way to distinguish "agent yielded to user via
	//   ask_question / plan_mode_respond / mistake-limit advisory / explicit
	//   ask tool" from "agent returned `done` because runtime exhausted
	//   without committing a terminal response". Today both routes yield
	//   `awaiting_followup` (CPL01/CRA02 paths).
	//
	//   Symmetry preserved: legitimate user-yield paths (ask_question,
	//   plan_mode_respond, mistake_limit, etc.) MUST still produce
	//   `awaiting_followup`. That conservation is out of scope here — this
	//   RED pins the negative contract for the BARE-done case only.
	// ============================================================================
	it("OWN01 RED: bare done + no terminal commit + no attempt_completion + no user-yield authority MUST NOT yield to awaiting_followup", async () => {
		// Live-specimen correspondence. Mirrors CPL01's setup so the failure
		// surfaces the SAME production branch the live task hit.
		const { coordinator, options, event } = makeCoordinator({
			translation: {
				messages: [],
				sessionEnded: false,
				turnComplete: true,
			},
		})
		// Pre-conditions from the live PTAD specimen.
		options.messageTranslatorState.clearTurnOutcome()
		expect(options.messageTranslatorState.wasTerminalResponseCommittedThisTurn()).toBe(false)
		expect(options.messageTranslatorState.wasAttemptCompletionSeen()).toBe(false)
		expect(options.messageTranslatorState.wasErrorSeen()).toBe(false)

		await coordinator.handleSessionEvent(event)

		// NEGATIVE OWNERSHIP INVARIANT: bare AgentRuntime `done` with no
		// committed terminal content and no user-yield authority MUST NOT
		// transfer ownership to the user via `awaiting_followup`. The agent
		// did autonomous work (live specimen: 222 tool calls, 0 recovery
		// budget failures); the runtime returned `done` for some
		// authoritative reason (UNAVAILABLE_FROM_TRACE). Yielding here
		// hands control back to the user regardless of whether the user
		// task is semantically complete.
		//
		// RED: this assertion fails on current code because the coord
		// currently calls `setTurnPhase("awaiting_followup",…)` for this
		// exact state (CPL01). The fix must preserve
		// `AgentDoneEvent.reason` through the translator/coordinator seam
		// and route this case based on the actual finish reason.
		expect(
			(options.setTurnPhase as ReturnType<typeof vi.fn>)!.mock.calls.some((call) => call[0] === "awaiting_followup"),
		).toBe(false)
	})
})

// ============================================================================
// ACT-CLINEMM-COMPLETION-PTAD-EXTEND01 — T2-EXT01 (reviewer P1 round 2 bounded correction)
//
// PRODUCTION-LIFECYCLE temporal-capture test. Lets the production
// SdkSessionEventCoordinator choose when to call
// `messageTranslatorState.clearTurnOutcome()` and when to fire
// `postStateToWebview()` (which is the production seam that
// `SdkController.getStateToPostToWebview()` reads for the PTAD
// capture).
//
// Unlike T1-EXT01 (which manually orchestrates setTerminal →
// capture → clearTurnOutcome), this test wires the REAL
// `translateSessionEvent` and feeds a synthetic terminal event
// sequence through the REAL coordinator. Production decides:
//
//   agent_event { content_start, tool: attempt_completion }
//     → translateSessionEvent sets setAttemptCompletionSeen
//     → appendAndEmit → postStateToWebview → PTAD capture
//
//   agent_event { content_end, tool: attempt_completion }
//     → translateSessionEvent sets setTerminalResponseCommittedThisTurn
//     → appendAndEmit → postStateToWebview → PTAD capture
//
//   agent_event { done, success: true }
//     → turn complete
//     → postStateToWebview → PTAD capture
//
//   event { type: pending_prompt_submitted }   (NEW-TURN boundary)
//     → coordinator calls messageTranslatorState.clearTurnOutcome()
//       BEFORE appendAndEmit and postStateToWebview
//     → PTAD capture reads the post-reset state
//
// If production captures BEFORE clearTurnOutcome (correct), the
// terminal-push record must show (true, true) and the new-turn
// record must show (false, false). If production captures AFTER,
// the terminal-push record would silently show (false, false) —
// the catastrophic failure mode this test exists to detect.
//
// The seam exercised is `SdkController.getStateToPostToWebview()`
// simplified: we only assert that the live PTAD ring buffer
// receives the (true, true) tuple at the moment of the
// terminal-push postStateToWebview hook, and (false, false) at
// the new-turn postStateToWebview hook.
// ============================================================================

describe("T2-EXT01: production-lifecycle PTAD capture order", () => {
	beforeEach(() => {
		enablePostTerminalAuthorityDiagnostic("extension")
		clearPostTerminalAuthorityDiagnostic("extension")
	})

	afterEach(() => {
		disablePostTerminalAuthorityDiagnostic("extension")
		clearPostTerminalAuthorityDiagnostic("extension")
	})

	function makeContentStart(toolName: string): CoreSessionEvent {
		return {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "content_start",
					contentType: "tool",
					toolName,
					toolCallId: "tc-1",
					input: { result: "done" },
				} as never,
			},
		} as unknown as CoreSessionEvent
	}

	function makeContentEnd(toolName: string): CoreSessionEvent {
		return {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "content_end",
					contentType: "tool",
					toolName,
					toolCallId: "tc-1",
					output: { ok: true },
				} as never,
			},
		} as unknown as CoreSessionEvent
	}

	function makeDone(): CoreSessionEvent {
		return {
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "done",
					reason: "completed",
					success: true,
				} as never,
			},
		} as unknown as CoreSessionEvent
	}

	function makePendingPromptSubmitted(): CoreSessionEvent {
		return {
			type: "pending_prompt_submitted",
			payload: { sessionId: "session-123", prompt: "next turn" },
		} as unknown as CoreSessionEvent
	}

	function makeProductionCoordinator() {
		const messageTranslatorState = new MessageTranslatorState()

		// Wire postStateToWebview to invoke the production PTAD
		// capture path: buildExtensionSnapshotFromState reads
		// messageTranslatorState and records into the live ring.
		// This is what SdkController.getStateToPostToWebview()
		// does in production (simplified to the messageTranslatorState
		// axis that this discriminator exercises).
		let stateVersion = 0
		const postStateToWebview = vi.fn().mockImplementation(() => {
			stateVersion += 1
			recordPostTerminalAuthoritySnapshot(
				buildExtensionSnapshotFromState({
					state: {
						stateVersion,
						taskId: "task-X",
						// Stub fields the builder accepts but doesn't
						// touch for the discriminator:
						turnState: { phase: "streaming", seq: 0 },
					},
					shadow: undefined,
					messageTranslatorState,
				}),
			)
			return Promise.resolve()
		})

		const options = {
			messageTranslatorState,
			sessions: {
				getActiveSession: vi.fn(() => ({
					sessionId: "session-123",
					sdkHost: {},
					unsubscribe: vi.fn(),
					startResult: { sessionId: "session-123" },
					isRunning: true,
				})),
				setRunning: vi.fn(),
			},
			messages: {
				appendAndEmit: vi.fn(),
			},
			taskHistory: {
				updateTaskUsage: vi.fn(),
			},
			getTask: vi.fn(() => ({ taskId: "task-X" })),
			postStateToWebview,
			setTurnPhase: vi.fn(),
			getTurnPhase: vi.fn(() => "streaming" as const),
			captureProviderApiError: vi.fn(),
			beginProviderFailureTelemetryTurn: vi.fn(),
			// REAL translateSessionEvent — production chooses ordering.
			translateSessionEvent: vi.fn((event: CoreSessionEvent, state: MessageTranslatorState) =>
				translateSessionEvent(event, state),
			),
		} as unknown as SdkSessionEventCoordinatorOptions

		const coordinator = new SdkSessionEventCoordinator(options)
		return { coordinator, options, messageTranslatorState, postStateToWebview }
	}

	it("T2-EXT01-A: terminal-push capture records (true, true); new-turn capture records (false, false); first is immutable", () => {
		const { coordinator, postStateToWebview } = makeProductionCoordinator()

		// Step 1: drive a real terminal-turn event sequence through
		// the production coordinator. NO manual setAttemptCompletionSeen /
		// setTerminalResponseCommittedThisTurn / clearTurnOutcome —
		// the production code calls all of those.
		coordinator.handleSessionEvent(makeContentStart("attempt_completion"))
		coordinator.handleSessionEvent(makeContentEnd("attempt_completion"))
		coordinator.handleSessionEvent(makeDone())

		// Step 2: at this point, multiple postStateToWebview calls
		// have happened (one per event that produced messages +
		// terminal-turn push + done). Each fired a PTAD capture
		// through the production seam. Find the record from the
		// post-terminal-push where both booleans were captured.
		const terminalRecords = getPostTerminalAuthorityDiagnosticRecords("extension").filter(
			(r) => r.attemptCompletionSeen === true && r.terminalResponseCommittedThisTurn === true,
		)
		expect(terminalRecords.length).toBeGreaterThan(0)
		const terminalRecord = terminalRecords[terminalRecords.length - 1]
		const terminalStateVersion = terminalRecord.stateVersion
		const terminalCapturedAt = terminalRecord.capturedAt

		// Step 3: drive the new-turn boundary. Production calls
		// clearTurnOutcome() BEFORE postStateToWebview (line 80 of
		// sdk-session-event-coordinator.ts). The next push must
		// therefore see (false, false) — the post-reset state — and
		// the previous terminal record must be immutable.
		coordinator.handleSessionEvent(makePendingPromptSubmitted())

		const allRecords = getPostTerminalAuthorityDiagnosticRecords("extension")
		const lastRecord = allRecords[allRecords.length - 1]
		expect(lastRecord.attemptCompletionSeen).toBe(false)
		expect(lastRecord.terminalResponseCommittedThisTurn).toBe(false)

		// Step 4: the terminal record is immutable across the
		// new-turn boundary reset.
		expect(terminalRecord.attemptCompletionSeen).toBe(true)
		expect(terminalRecord.terminalResponseCommittedThisTurn).toBe(true)
		expect(terminalRecord.stateVersion).toBe(terminalStateVersion)
		expect(terminalRecord.capturedAt).toBe(terminalCapturedAt)

		// Sanity: postStateToWebview was invoked at least twice
		// (once for the terminal push, at least once for the new-turn
		// boundary).
		expect(postStateToWebview.mock.calls.length).toBeGreaterThanOrEqual(2)
	})

	it("T2-EXT01-B: when only attempt_completion is observed (no terminal commit), terminal-push records (true, false)", () => {
		// Symmetric branch: content_start (tool: attempt_completion)
		// fires setAttemptCompletionSeen; the done event arrives
		// without content_end having fired setTerminalResponseCommittedThisTurn.
		// Production must NOT promote to "completed"; the captured
		// record reflects the partial-turn state (true, false).
		const { coordinator } = makeProductionCoordinator()

		// content_start fires setAttemptCompletionSeen but NO
		// content_end for the completion tool → terminalResponse NOT
		// committed. Then a `done` arrives.
		coordinator.handleSessionEvent(makeContentStart("attempt_completion"))
		// Skip the content_end to leave terminalResponseCommittedThisTurn=false.
		coordinator.handleSessionEvent(makeDone())

		const records = getPostTerminalAuthorityDiagnosticRecords("extension")
		// Find the record that has attempt=true (regardless of committed).
		const attemptSeenRecords = records.filter((r) => r.attemptCompletionSeen === true)
		expect(attemptSeenRecords.length).toBeGreaterThan(0)
		const lastAttemptSeen = attemptSeenRecords[attemptSeenRecords.length - 1]
		// The terminal push sampled (true, false) — not committed.
		expect(lastAttemptSeen.attemptCompletionSeen).toBe(true)
		expect(lastAttemptSeen.terminalResponseCommittedThisTurn).toBe(false)
	})

	it("T2-EXT01-C: a new-turn boundary reset is visible in the NEXT push only (first is immutable)", () => {
		// Negative case: the new-turn record reflects the post-reset
		// state. The terminal record is unaffected. Pin both shapes.
		const { coordinator } = makeProductionCoordinator()

		coordinator.handleSessionEvent(makeContentStart("attempt_completion"))
		coordinator.handleSessionEvent(makeContentEnd("attempt_completion"))
		coordinator.handleSessionEvent(makeDone())

		const terminalRecords = getPostTerminalAuthorityDiagnosticRecords("extension").filter(
			(r) => r.attemptCompletionSeen === true && r.terminalResponseCommittedThisTurn === true,
		)
		expect(terminalRecords.length).toBeGreaterThan(0)
		const terminalRecord = terminalRecords[terminalRecords.length - 1]
		const beforeResetStateVersion = terminalRecord.stateVersion

		// New-turn boundary.
		coordinator.handleSessionEvent(makePendingPromptSubmitted())

		const afterResetRecords = getPostTerminalAuthorityDiagnosticRecords("extension")
		// The terminal record is still there and still (true, true).
		expect(terminalRecord.attemptCompletionSeen).toBe(true)
		expect(terminalRecord.terminalResponseCommittedThisTurn).toBe(true)
		expect(terminalRecord.stateVersion).toBe(beforeResetStateVersion)

		// The last record reflects the post-reset state.
		const lastRecord = afterResetRecords[afterResetRecords.length - 1]
		expect(lastRecord.attemptCompletionSeen).toBe(false)
		expect(lastRecord.terminalResponseCommittedThisTurn).toBe(false)
		expect(lastRecord.stateVersion).toBeGreaterThan(beforeResetStateVersion)
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
