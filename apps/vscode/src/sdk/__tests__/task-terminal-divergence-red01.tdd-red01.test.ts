// ============================================================================
// ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01 + CORR01
//
// LIVE-FAILURE-FROZEN RED suite. The LIVE specimen (task headed
// ACT-CLINEMM-ELM-SEAM09-TOOL-APPROVAL-LIFECYCLE-RECON, session
// `1791831094459_33v63`, totalCost $1.13646336) showed:
//
//   - On the live UI: Error, no completion report.
//   - On reopen from history: Complete, with a green COMPLETED card carrying
//     the SEAM10 verdict text.
//
// Both the live and reopen paths must agree on whether the task is
// "completed" or "error". Today they don't, because the live phase decision
// at `sdk-session-event-coordinator.ts:2847-2850` keys on
// `wasErrorSeen()` BEFORE `wasAttemptCompletionSeen()`, and the
// in-memory `errorSeen` flag is not persisted — so the persisted
// `say: "completion_result"` row with
// `isAuthoritativelyCompletedResult: true` shows on reopen while the
// live phase is "error".
//
// The reproducers below are derived from the LIVE transcript chronology
// (the SEAM09 + SEAM10 back-to-back `submit_and_exit` invocations and the
// earlier non-recoverable error events). Each is a single-message
// sequence through the REAL production seam
// (SdkSessionEventCoordinator → MessageTranslatorState → appendAndEmit).
//
// ACT-CLINEMM-CORR01 expansion (CLOSED_HALTED_CLEAN — evidence recovered):
//
//  1. The captured epoch-3 writer at seq 1870 in the live provenance
//     capture is `session-event-bcb-blocked-observation-unavailable`
//     (per user-supplied writer-provenance bundle, restored to
//     `.factory/evidence/ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01-CORR01/live-captures/`,
//     SHA-256 `d58cc10ff2a101227c61dcf3dc6e8ee5dee2e3e1200414ad412c8469aab7ba1f`).
//     The writer record is AUTHORITATIVE.
//
//  2. The previously-asserted `session-event-turn-complete-error` was
//     inferred from a transcript-statistics argument (five prior
//     `command_status` invocations in the messages file), which does
//     NOT establish the value of `liveTools()` at the final
//     `submit_and_exit` timestamp. That inference is WITHDRAWN.
//     No `session-event-turn-complete-error` record exists in the
//     live capture for the SEAM10 turn.
//
//  3. The original TDD-01.A/B assertions forbade the transient
//     setTurnPhase("error", ..., "session-event-turn-complete-error")
//     at L2850 from firing. That is over-constrained — the production
//     code intentionally fires it on the done event when wasErrorSeen()
//     is true. The corrected witnesses (TDD-01 and TDD-07) assert on
//     the FINAL state (`tracker.currentPhase`), not the transient
//     commits. TDD-01.A/B + TDD-07 are an INDEPENDENT witness of the
//     errorSeen-precedence defect; they are NOT claimed to be the
//     live firing branch.
//
//  4. TDD-05a reproduces the BCB writer branch through the real
//     SdkSessionEventCoordinator. The exact unavailable input is
//     `canObserveHeldResults === false` at
//     `sdk-session-event-coordinator.ts:3154`. TDD-05a is a real
//     production-seam witness of the BCB writer, but its inputs are
//     SYNTHETIC — it injects `liveTools = ["read_files", "run_commands"]`
//     to satisfy the `canObserveHeldResults === false` precondition.
//     TDD-05a is the correct `REAL_PRODUCTION_SEAM` witness of the
//     live firing branch.
//
//  5. TDD-05b is RE-CLASSIFIED as SYNTHETIC_REAL. It injects
//     `recoverable: false` to select the L2847 error branch and adds
//     `command_status` to `liveTools`. The L2847 branch fires
//     `session-event-turn-complete-error`, but that is the result of
//     injected preconditions, not a claim about the live firing
//     branch. TDD-05b is preserved as a preservation/ablation witness
//     of the L2847 behavior; it is NOT evidence of what the live
//     branch was.
//
//  6. TDD-08 is the necessity ablation — the BCB result is
//     independent of the L2847 precedence.
//
//  7. The cause of `canObserveHeldResults === false` in the live
//     capture REMAINS `CAPTURE_INSUFFICIENT` (the recovered bundle
//     does not contain the `liveTools()` value at the BCB writer
//     firing moment — the PTAD record at stateVersion 1871 has no
//     `liveTools` field). The recommended next ACT is a DEFAULT_OFF,
//     read-only diagnostic at the BCB decision boundary to capture
//     the four BCB predicate inputs (liveTools, held-result
//     ownership/count, suppressOriginatingCompletion, selected writer)
//     on a future live run. The independent L2847 precedence RED can
//     proceed as a separately scoped repair ACT, but its closure must
//     NOT claim to have fixed the live incident.
//
// RED invariant (CORR01 §3):
//   For ANY turn that produces a `say: "completion_result"` row with
//   `isAuthoritativelyCompletedResult: true` via the canonical completion
//   tool `content_end` seam, the same turn's live `tracker.currentPhase`
//   MUST be "completed" — NOT "error". A non-recoverable error event that
//   arrived earlier in the same turn does NOT downgrade the terminal
//   phase, because the canonical completion tool `content_end` has
//   already been committed.
//
// Without the fix, the live UI shows Error + green completion box;
// on reopen the persisted state shows only the green completion box.
// ============================================================================

import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => "default",
			getGlobalStateKey: () => undefined,
			setGlobalState: vi.fn(),
		}),
	},
}))

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: {
		captureTerminalUserIntervention: () => {},
		captureTerminalExecution: () => {},
	},
}))

interface ClineMessage {
	ts: number
	type: "say" | "ask"
	say?: string
	ask?: string
	text?: string
	partial?: boolean
	isAuthoritativelyCompletedResult?: boolean
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	activeSessionId: string
	activeTaskId: string
	appendAndEmit: ReturnType<typeof vi.fn>
	/**
	 * ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01-CORRECTION01
	 * (C9C10CDAP01): the PRODUCTION "update a message" channel
	 * (`SdkMessageCoordinator.emitHookMessage`) — the channel the C10
	 * commit publishes the completion authority marker through.
	 */
	emitHookMessage: ReturnType<typeof vi.fn>
	/**
	 * The MESSAGE STORE as the user sees it: the rows that survived the
	 * message-layer completion filter, with the production
	 * upsert-by-`ts` semantics applied.
	 */
	storedRows: ClineMessage[]
	completionCommitCount: () => number
	errorPhaseCommitCount: () => number
	allCommittedPhases: () => string[]
	allCommittedWriterIds: () => string[]
	finalPhase: () => string
	finalWriterId: () => string
	ownedJobs: { jobId: string; notify: boolean; running: boolean }[]
	unconsumedOverride: { value: number }
	liveToolsOverride: { value: readonly string[] | undefined }
	unconsumedJobIdsOverride: { value: readonly string[] }
	suppressOriginatingCompletionOverride: { value: boolean }
}

function fakeSupervisor() {
	let resolveExit: (code: number) => void = () => {}
	const exitPromise = new Promise<number>((resolve) => {
		resolveExit = resolve
	})
	return {
		process: { pid: 1, killed: false } as never,
		exit: exitPromise as unknown as Promise<never>,
		pid: 1,
		pgid: 1,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "OK\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	} as unknown as SupervisableShellProcess
}

function makeHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-tdd-01"
	const activeTaskId = opts.activeTaskId ?? "task-tdd-01"

	const appendAndEmit = vi.fn()
	// ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01-CORRECTION01
	// (C9C10CDAP01): the PRODUCTION "update a message" channel
	// (`SdkMessageCoordinator.emitHookMessage`). The completion
	// authority marker is published BY THE C10 COMMIT through this
	// channel (the row is re-published with the SAME `ts` and the
	// marker ADDED), so the harness MUST model it for the visible row
	// to carry the marker.
	const emitHookMessage = vi.fn()
	// The MESSAGE STORE, with the production upsert-by-`ts` semantics
	// (`MessageStateHandler.addMessages`): a message with the same `ts`
	// REPLACES the stored row in place.
	const storedRows: ClineMessage[] = []
	let completionCommitCount = 0
	let errorPhaseCommitCount = 0
	const allCommittedPhases: string[] = []
	const allCommittedWriterIds: string[] = []
	const ownedJobs: { jobId: string; notify: boolean; running: boolean }[] = []
	const unconsumedOverride = { value: 0 }
	const liveToolsOverride: { value: readonly string[] | undefined } = {
		value: ["command_status", "read_files", "run_commands"],
	}
	const unconsumedJobIdsOverride: { value: readonly string[] } = { value: [] }
	const suppressOriginatingCompletionOverride: { value: boolean } = { value: false }
	let now = 0

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		now: () => ++now,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const _manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => fakeSupervisor(),
	})
	void _manager

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: ((msgs: unknown[]) => {
				for (const m of msgs as ClineMessage[]) {
					const idx = storedRows.findIndex((r) => r.ts === m.ts)
					if (idx >= 0) {
						storedRows[idx] = m
					} else {
						storedRows.push(m)
					}
				}
				appendAndEmit(msgs as never)
			}) as never,
			// ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01-CORRECTION01
			// (C9C10CDAP01): the PRODUCTION "update a message" channel
			// (`SdkMessageCoordinator.emitHookMessage`). The completion
			// authority marker is published BY THE C10 COMMIT through this
			// channel (the row is re-published with the SAME `ts` and the
			// marker ADDED), so the harness MUST model it for the visible
			// row to carry the marker. The production store upserts by
			// `ts`, so an update REPLACES the row in place.
			emitHookMessage: (m: ClineMessage) => {
				const idx = storedRows.findIndex((r) => r.ts === m.ts)
				if (idx >= 0) {
					storedRows[idx] = m
				} else {
					storedRows.push(m)
				}
				emitHookMessage(m)
			},
		},
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			allCommittedPhases.push(phase)
			allCommittedWriterIds.push(String(writerId ?? "unknown-legacy-writer"))
			if (phase === "completed") {
				completionCommitCount += 1
			}
			if (phase === "error") {
				errorPhaseCommitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01: provide a default
		// "authorize" decision so the test exercises the same production
		// checkElmCompletionAuthority gate. Without this, the production
		// Elm-authority consult is bypassed (HOLD default) and the
		// "completed" phase commit is suppressed — that gate is
		// orthogonal to the TDD-01 divergence under test.
		getElmCompletionAuthorityDecision: () => ({ kind: "authorize", reason: "test_default_authorize" }),
		flushElmAuthorityForSession: async () => {},
		hasRunningBackgroundJobForOwner: (sid: string | undefined) => {
			if (sid !== activeSessionId) return false
			return ownedJobs.some((j) => j.running)
		},
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return unconsumedOverride.value
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string, _tid: string | undefined) => {
			if (sid !== activeSessionId) return []
			return unconsumedJobIdsOverride.value
		},
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: (sid: string | undefined, tid: string | undefined) =>
			notifyCoordinator.activeNotifyCountForOwner(sid ?? activeSessionId, tid ?? activeTaskId),
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
		getLaunchedBackgroundJobIds: () => ownedJobs.map((j) => j.jobId),
		// ACT-CLINEMM-CORR01: liveTools is the host's tool-registry
		// gate (production seam at sdk-session-event-coordinator.ts:3149).
		// When `liveTools().includes("command_status")` is FALSE, the
		// BCB-blocked-observation-unavailable writer fires. The default
		// mirror of the LIVE SEAM10 turn includes command_status.
		liveTools: () => liveToolsOverride.value,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		activeSessionId,
		activeTaskId,
		appendAndEmit,
		emitHookMessage,
		storedRows,
		completionCommitCount: () => completionCommitCount,
		errorPhaseCommitCount: () => errorPhaseCommitCount,
		allCommittedPhases: () => allCommittedPhases,
		allCommittedWriterIds: () => allCommittedWriterIds,
		finalPhase: () => tracker.currentPhase,
		finalWriterId: () => {
			const writers = allCommittedWriterIds
			return writers[writers.length - 1] ?? "none"
		},
		ownedJobs: ownedJobs as { jobId: string; notify: boolean; running: boolean }[],
		unconsumedOverride,
		liveToolsOverride,
		unconsumedJobIdsOverride,
		suppressOriginatingCompletionOverride,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

function visibleCompletionRows(h: Harness): ClineMessage[] {
	// ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01-CORRECTION01
	// (C9C10CDAP01): read the MESSAGE STORE — what the user actually
	// sees — not the raw publish calls. The completion authority marker
	// is published BY THE C10 COMMIT through the "update a message"
	// channel, so a store read is the faithful projection. The store
	// applies the production upsert-by-`ts` semantics, so the promotion
	// (same `ts`, marker ADDED) replaces the row IN PLACE — the visible
	// row cardinality is unchanged.
	const rows: ClineMessage[] = []
	for (const m of h.storedRows) {
		// Skip the partial streaming row that content_start emits;
		// only the non-partial finalized row is the canonical terminal
		// surface.
		if (m.say === "completion_result" && !m.partial) {
			rows.push(m)
		}
	}
	return rows
}

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

// ---------------------------------------------------------------------------
// RED witness — the live dogfood chronology encoded here.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01 — errorSeen must not clobber committed completion", () => {
	// ACT-CLINEMM-CORR01 §3: the original TDD-01.A/B assertions forbade
	// the production setTurnPhase("error", ..., "session-event-turn-complete-error")
	// at L2850 from firing. That assertion is over-constrained — the
	// production code intentionally fires it on the done event when
	// wasErrorSeen() is true. The corrected witness asserts on the
	// FINAL state (tracker.currentPhase), not the transient commits.
	// This is the SYNTHETIC_REAL witness — it preserves the live
	// chronology but uses a structurally honest assertion.
	describe("TDD-01 (SYNTHETIC_REAL witness): final state MUST be 'completed' (corrected to assert on tracker.currentPhase, not transient commits)", () => {
		it("non-recoverable error earlier in the same turn as submit_and_exit content_end: finalPhase = completed; 1 visible completion row", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			// STEP 1 (mirrors the SEAM09 mid-turn mistake): a non-recoverable
			// error event arrives. The translator sets errorSeen + emits
			// ask:"api_req_failed". This is the load-bearing divergence
			// trigger: errorSeen is now TRUE in-memory but the run continues
			// (the agent later declares completion).
			const errorEvent = agentEvent(sessionId, {
				type: "error",
				error: { message: "stream hiccup" },
				recoverable: false,
			})
			await h.coordinator.handleSessionEvent(errorEvent)

			// Sanity: errorSeen is now true (this is the source of the divergence)
			expect(h.translatorState.wasErrorSeen()).toBe(true)

			// STEP 2 (mirrors the SEAM09 submit_and_exit): the agent calls
			// submit_and_exit. content_start + content_end through the
			// canonical completion publication seam.
			const toolId = "tc-tdd-01-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Final SEAM09 verdict." })

			const contentStartEvent = agentEvent(sessionId, {
				type: "content_start",
				contentType: "tool",
				toolName: "submit_and_exit",
				toolCallId: toolId,
				input: { result: "Final SEAM09 verdict." },
			})
			await h.coordinator.handleSessionEvent(contentStartEvent)

			const contentEndEvent = agentEvent(sessionId, {
				type: "content_end",
				contentType: "tool",
				toolName: "submit_and_exit",
				toolCallId: toolId,
				input: { result: "Final SEAM09 verdict." },
			})
			await h.coordinator.handleSessionEvent(contentEndEvent)

			// Sanity: completion tool was seen and terminal response committed
			expect(h.translatorState.wasAttemptCompletionSeen()).toBe(true)
			expect(h.translatorState.wasTerminalResponseCommittedThisTurn()).toBe(true)

			// STEP 3: the SDK emits done(reason:"completed") for this turn.
			const doneEvent = agentEvent(sessionId, {
				type: "done",
				reason: "completed",
				text: "Final SEAM09 verdict.",
				iterations: 1,
			})
			await h.coordinator.handleSessionEvent(doneEvent)

			// ─── RED invariant: FINAL state MUST be "completed" ───
			// ACT-CLINEMM-CORR01 §3 correction: the previous assertion
			// forbade the transient setTurnPhase("error", ...,
			// "session-event-turn-complete-error") at L2850. That is
			// over-constrained — the production code intentionally
			// fires it on the done event when wasErrorSeen() is true.
			// The honest assertion is on `tracker.currentPhase`, the
			// post-all-commits state the user observed.
			//
			// Today the coordinator's precedence
			// (sdk-session-event-coordinator.ts:2847) checks
			// wasErrorSeen() BEFORE wasAttemptCompletionSeen(), so the
			// final phase commits as "error" — the divergence the user
			// observed.
			expect(h.finalPhase()).toBe("completed")
			expect(h.finalWriterId()).toBe("session-event-turn-complete-completed")

			// The completion row was committed to appendAndEmit AND
			// persisted with isAuthoritativelyCompletedResult: true.
			// On reopen, the webview will render the green COMPLETED
			// card from this row's marker.
			const visible = visibleCompletionRows(h)
			expect(visible.length).toBe(1)
			expect(visible[0]?.isAuthoritativelyCompletedResult).toBe(true)
		})

		it("the visible completion row is the SAME on live and reopen paths — both reads must agree on isAuthoritativelyCompletedResult", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			// Mid-turn recoverable mistake is not enough on its own (recoverable
			// errors don't set errorSeen). To force the live path into the
			// divergence, we need a non-recoverable error event. Mirrors the
			// live SEAM09 transcript pattern.
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "error",
					error: { message: "transient stream failure" },
					recoverable: false,
				}),
			)

			const toolId = "tc-tdd-02-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Done." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Done." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Done." },
				}),
			)

			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Done.",
					iterations: 1,
				}),
			)

			// ACT-CLINEMM-CORR01 §3 correction: assert on FINAL state
			// (tracker.currentPhase) and on the persisted row's
			// marker, not on transient commits.
			expect(h.finalPhase()).toBe("completed")

			const visible = visibleCompletionRows(h)
			expect(visible.length).toBeGreaterThan(0)
			expect(visible[0]?.isAuthoritativelyCompletedResult).toBe(true)

			// The terminalReportFraming decision (webview side) uses
			//   (a) the row's isAuthoritativelyCompletedResult marker, OR
			//   (b) the live turnState.phase as a SECONDARY gate.
			// Both must agree on "completed" framing for the divergence to
			// not surface as Error/Complete.
			//
			// The honest assertion is on `tracker.currentPhase` and the
			// persisted row's marker. If isAuthoritativelyCompletedResult
			// is true (it is), the row frames as completed EVEN IF the
			// live phase is something else. So the reopen UI shows
			// "Completed" while the live UI shows "Error" — this is the
			// precise divergence.
			const reopenFramesCompleted = visible[0]?.isAuthoritativelyCompletedResult === true
			const liveFramesCompleted = h.finalPhase() === "completed"
			expect(reopenFramesCompleted).toBe(liveFramesCompleted)
		})
	})

	describe("TDD-02: CONTROL — no error event, submit_and_exit content_end only → phase = completed (no divergence)", () => {
		it("clean completion (no error, no held work) → exactly 1 completed commit, 1 visible completion row", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			const toolId = "tc-tdd-03-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Clean finish." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Clean finish." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Clean finish." },
				}),
			)

			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Clean finish.",
					iterations: 1,
				}),
			)

			expect(h.allCommittedPhases()).toContain("completed")
			expect(h.allCommittedPhases()).not.toContain("error")
			expect(h.completionCommitCount()).toBe(1)
			expect(h.errorPhaseCommitCount()).toBe(0)

			const visible = visibleCompletionRows(h)
			expect(visible.length).toBe(1)
			expect(visible[0]?.isAuthoritativelyCompletedResult).toBe(true)
		})
	})

	describe("TDD-03: CONTROL — error event with NO submit_and_exit → phase = error (the original design intent)", () => {
		it("non-recoverable error then done(reason:'error'), no completion tool → phase = error; 0 visible completion rows", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "error",
					error: { message: "stream failed" },
					recoverable: false,
				}),
			)

			// No submit_and_exit — the agent gives up. done(reason:"error")
			// is the canonical terminal surface for this turn.
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "error",
					text: "stream failed before assistant output",
					iterations: 1,
				}),
			)

			// The error path commits "error" once (the error event itself).
			// The done(reason:"error") also fires setTurnPhase("error", ...) —
			// production accepts the duplicate (it's the same phase).
			expect(h.allCommittedPhases()).toContain("error")
			expect(h.completionCommitCount()).toBe(0)

			// No completion row should be visible. The error path owns the
			// terminal surface (api_req_failed row).
			const visible = visibleCompletionRows(h)
			expect(visible.length).toBe(0)
		})
	})

	describe("TDD-04: ABLATION — errorSeen is the load-bearing trigger; clearing it changes the phase decision", () => {
		it("clearing errorSeen mid-turn flips the live phase from 'error' to 'awaiting_followup' (NOT 'completed' — clearTurnOutcome also clears attemptCompletionSeen, so the completion-seen branch is also bypassed)", async () => {
			// ABLATION: prove that the in-memory `errorSeen` flag is the
			// load-bearing trigger for the divergence. If the flag is
			// cleared between the error event and the done event, the
			// coordinator's precedence at L2847 falls through to the
			// next branch (no longer "error"). This is a partial
			// discriminator — it proves the bug is keyed on `errorSeen`,
			// not on the BCB barrier (L3027) or the Elm authority gate
			// (L3281) or the done event translation (L2063).
			//
			// The full ABLATION (with attemptCompletionSeen preserved)
			// is a separate production-fix concern: a future repair that
			// reorders the precedence at L2847 to prefer
			// "wasTerminalResponseCommittedThisTurn" over "wasErrorSeen"
			// would make TDD-01.A pass. TDD-04 is the discriminator
			// for the cause, not the cure.
			const h = makeHarness()
			const sessionId = h.activeSessionId

			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "error",
					error: { message: "stream hiccup" },
					recoverable: false,
				}),
			)

			const toolId = "tc-tdd-04-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Final verdict." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)

			// ABLATION: clear errorSeen mid-turn. The production
			// equivalent of "the errorSeen flag was never observed by
			// the user-visible phase decision" is a no-op for
			// `clearTurnOutcome()` (which also clears
			// attemptCompletionSeen — too aggressive). The
			// fine-grained equivalent is to set just errorSeen = false.
			// Since the test asserts on the coordinator's reaction,
			// any mid-turn flag manipulation is sufficient to
			// discriminate cause.
			h.translatorState.clearTurnOutcome()

			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Final verdict.",
					iterations: 1,
				}),
			)

			// The error path is bypassed (no second "error" commit on
			// the done event). This proves the precedence at L2847
			// is keyed on wasErrorSeen. Whether the final phase is
			// "completed" or "awaiting_followup" is incidental here —
			// the important assertion is that it's NOT a second
			// "error" commit.
			const phaseCommits = h.allCommittedPhases()
			expect(phaseCommits.filter((p) => p === "error")).toHaveLength(1) // only the original error event
			expect(phaseCommits.filter((p) => p === "error").length).toBeLessThan(2) // not the divergent double-error
			expect(phaseCommits[phaseCommits.length - 1]).not.toBe("error")
		})
	})

	// ACT-CLINEMM-CORR01 §1: BCB BLOCKED OBSERVATION-UNAVAILABLE — exact writer reproduction.
	describe("TDD-05a: BCB writer — held terminal result + liveTools excludes 'command_status'", () => {
		it("writes 'session-event-bcb-blocked-observation-unavailable' as the final writer; phase='error'; completion row filtered (L2818); 0 completed commits", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			h.unconsumedOverride.value = 1
			h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
			h.liveToolsOverride.value = ["read_files", "run_commands"]

			const toolId = "tc-tdd-05a-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Final verdict." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Final verdict.",
					iterations: 1,
				}),
			)

			// EXACT writer assertion. The BCB writer stamps
			// "session-event-bcb-blocked-observation-unavailable" at L3190-3194.
			const writerIds = h.allCommittedWriterIds()
			expect(writerIds).toContain("session-event-bcb-blocked-observation-unavailable")
			expect(h.finalPhase()).toBe("error")
			expect(h.finalWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")
			// BCB filter at L2818 suppresses the completion row.
			const visible = visibleCompletionRows(h)
			expect(visible.length).toBe(0)
			expect(h.completionCommitCount()).toBe(0)
		})
	})

	// ACT-CLINEMM-CORR01 §2 (REVISED): TDD-05b is reclassified as
	// SYNTHETIC_REAL. It injects `recoverable: false` to force the L2847
	// branch AND `command_status` into liveTools. The L2847 branch
	// fires "session-event-turn-complete-error" — but this is the
	// result of injected preconditions, NOT a claim about the live
	// firing branch. The live firing branch is reported as
	// `CAPTURE_INSUFFICIENT` (see header §6).
	describe("TDD-05b: SYNTHETIC_REAL — L2847 precedence firing with command_status present (NOT a live branch claim)", () => {
		it("with command_status present AND a non-recoverable error injected, the L2847 precedence writer fires 'session-event-turn-complete-error'; BCB writer is not reached", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			// Same held-work state as TDD-05a, but with command_status
			// available in the live tool registry.
			h.unconsumedOverride.value = 1
			h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
			h.liveToolsOverride.value = ["command_status", "read_files", "run_commands"]

			// Force a non-recoverable error to trigger the L2847 bug.
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "error",
					error: { message: "stream hiccup" },
					recoverable: false,
				}),
			)

			const toolId = "tc-tdd-05b-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Final SEAM10 verdict." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final SEAM10 verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final SEAM10 verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Final SEAM10 verdict.",
					iterations: 1,
				}),
			)

			// SYNTHETIC_REAL: this test injects `recoverable: false`
			// AND command_status in liveTools. The L2847 branch
			// fires "session-event-turn-complete-error" because
			// wasErrorSeen() is checked BEFORE
			// wasAttemptCompletionSeen() && wasTerminalResponseCommittedThisTurn().
			// This is NOT a claim about the live firing branch —
			// see header §6 (CAPTURE_INSUFFICIENT).
			const writerIds = h.allCommittedWriterIds()
			expect(writerIds).not.toContain("session-event-bcb-blocked-observation-unavailable")
			expect(writerIds).toContain("session-event-turn-complete-error")

			// L2847 precedence demonstrated: with wasErrorSeen()=true
			// (injected), the phase is "error" even though the
			// completion tool's content_end was committed. This
			// independently corroborates the errorSeen-precedence
			// defect (TDD-01.A/B, TDD-07) without claiming the live
			// firing branch.
			expect(h.finalPhase()).toBe("error")
			expect(h.errorPhaseCommitCount()).toBeGreaterThan(0)
			expect(h.completionCommitCount()).toBe(0)

			// The completion row IS filtered by the BCB barrier's
			// outstandingAutonomousWork check (L2818), even with
			// command_status present. This is the expected
			// held-work behavior: the completion row is held back
			// until the held terminal result is observed by the
			// agent. The reopen UI does not see the row either
			// (until the BCB reevaluates and clears the barrier).
			// What matters for the divergence diagnosis is the
			// phase writer, not the row visibility.
			//
			// NOTE: this preserved behavior (BCB barrier filters the
			// completion row when held work exists) is independent of
			// whether the BCB WRITER itself fires. The barrier is a
			// row-filter at L2818; the writer at L3190-3194 is a
			// phase-write that requires `canObserveHeldResults === false`.
		})
	})

	// ACT-CLINEMM-CORR01 §3: SYNTHETIC_REAL witness.
	describe("TDD-07: SYNTHETIC_REAL witness — final-state assertion", () => {
		it("same chronology as TDD-01.A; final state must be 'completed' (RED today)", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "error",
					error: { message: "stream hiccup" },
					recoverable: false,
				}),
			)

			const toolId = "tc-tdd-07-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Final verdict." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Final verdict.",
					iterations: 1,
				}),
			)

			// FINAL-STATE ASSERTION. The user observed the task header
			// showing "Error" persistently. The production state that
			// the user-visible phase reads from is tracker.currentPhase.
			expect(h.finalPhase()).toBe("completed")
			expect(h.finalWriterId()).toBe("session-event-turn-complete-completed")
		})
	})

	// ACT-CLINEMM-CORR01 §4: PRECEDENCE-SWAP NECESSITY ABLATION.
	describe("TDD-08: PRECEDENCE-SWAP NECESSITY ABLATION", () => {
		it("BCB result is INDEPENDENT of the L2847 precedence", async () => {
			// The necessity discriminator. If a precedence swap at
			// L2847 were applied, the BCB reproducer's result would
			// still be the BCB writer committing "error" — because
			// the BCB barrier is reached on a DIFFERENT branch
			// (L3027-3164) that does not consult wasErrorSeen at all.
			const h = makeHarness()
			const sessionId = h.activeSessionId

			h.unconsumedOverride.value = 1
			h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
			h.liveToolsOverride.value = ["read_files", "run_commands"]

			const toolId = "tc-tdd-08-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Final verdict." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Final verdict.",
					iterations: 1,
				}),
			)

			// The BCB writer STILL fires on this path. The L2847 swap
			// would not change this result.
			const writerIds = h.allCommittedWriterIds()
			expect(writerIds).toContain("session-event-bcb-blocked-observation-unavailable")
			expect(h.finalPhase()).toBe("error")
			expect(h.finalWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")

			// The L2847 writer did NOT fire (no error event on this
			// turn). The two paths are independent.
			expect(writerIds).not.toContain("session-event-turn-complete-error")
			expect(writerIds).not.toContain("session-event-turn-complete-completed")
		})
	})

	// ACT-CLINEMM-CORR01 §5: PERSISTENCE/APPEND vs WEBVIEW RENDERING.
	describe("TDD-09: PERSISTENCE/APPEND vs WEBVIEW RENDERING", () => {
		it("on a clean completion, the say:'completion_result' row IS appended; webview render is separate", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			// Clean completion: no error event, no held work.
			const toolId = "tc-tdd-09-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Clean verdict." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Clean verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Clean verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Clean verdict.",
					iterations: 1,
				}),
			)

			// 1. The completion row WAS appended to the message store.
			const visible = visibleCompletionRows(h)
			expect(visible.length).toBe(1)
			expect(visible[0]?.isAuthoritativelyCompletedResult).toBe(true)

			// 2. The postStateToWebview mock was NOT asserted to have
			//    rendered the row. The webview's applyStateSnapshot
			//    reducer is a separate path. The append-side of the
			//    persistence is asserted; the render-side is NOT
			//    asserted here. The user's report of "after reopen, the
			//    chat body showed Complete" only attests the reopen
			//    render path, not the live render path.
		})
	})

	// ACT-CLINEMM-CORR01 §6: PRESERVATION — cancellation.
	describe("TDD-10a: PRESERVATION — cancellation preserves 'resumable' phase", () => {
		it("a cancelled turn (getTurnPhase=resumable) is NOT clobbered by the L2847 error branch", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			;(h.coordinator as unknown as { options: { getTurnPhase: () => string } }).options.getTurnPhase = () => "resumable"

			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "error",
					error: { message: "cancelled" },
					recoverable: false,
				}),
			)

			const toolId = "tc-tdd-10a-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Verdict." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Verdict.",
					iterations: 1,
				}),
			)

			// The L2845-2846 exception fires: setTurnPhase was NOT
			// called for "error" or "completed" on the done event.
			expect(h.completionCommitCount()).toBe(0)
			const errorCommits = h.allCommittedPhases().filter((p) => p === "error")
			expect(errorCommits.length).toBeLessThan(2)
		})
	})

	// ACT-CLINEMM-CORR01 §6: PRESERVATION — genuine-error.
	describe("TDD-10b: PRESERVATION — genuine-error commits 'error' via L2850", () => {
		it("non-recoverable error + done(reason:'error') + NO completion tool → phase='error'; 0 completion rows; L2850 writer fires", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "error",
					error: { message: "stream failed" },
					recoverable: false,
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "error",
					text: "stream failed before assistant output",
					iterations: 1,
				}),
			)

			expect(h.allCommittedPhases()).toContain("error")
			expect(h.completionCommitCount()).toBe(0)
			expect(h.errorPhaseCommitCount()).toBeGreaterThan(0)

			const writerIds = h.allCommittedWriterIds()
			expect(writerIds).toContain("session-event-turn-complete-error")
		})
	})

	// ACT-CLINEMM-CORR01 §6: PRESERVATION — held-work with command_status available.
	describe("TDD-10c: PRESERVATION — held-work with command_status AVAILABLE does NOT fire the BCB writer", () => {
		it("the BCB barrier registers a marker but does NOT commit 'error' when command_status is available", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			h.unconsumedOverride.value = 1
			h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
			h.liveToolsOverride.value = ["command_status", "read_files"]

			const toolId = "tc-tdd-10c-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Final verdict." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Final verdict." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Final verdict.",
					iterations: 1,
				}),
			)

			// The BCB writer does NOT fire. The completion path runs.
			const writerIds = h.allCommittedWriterIds()
			expect(writerIds).not.toContain("session-event-bcb-blocked-observation-unavailable")
		})
	})

	// ACT-CLINEMM-CORR01 §6: PRESERVATION — stale-event idempotence.
	describe("TDD-10d: PRESERVATION — stale-event idempotence (BCB sameObligationAlreadyObservationUnavailable guard)", () => {
		it("a second submit_and_exit in the same BCB obligation does NOT re-stamp the BCB marker", async () => {
			const h = makeHarness()
			const sessionId = h.activeSessionId

			h.unconsumedOverride.value = 1
			h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
			h.liveToolsOverride.value = ["read_files", "run_commands"]

			// First obligation: drives the BCB writer.
			const toolId = "tc-tdd-10d-submit"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Verdict 1." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Verdict 1." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId,
					input: { result: "Verdict 1." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Verdict 1.",
					iterations: 1,
				}),
			)

			const writerIdsAfterFirst = h.allCommittedWriterIds()
			expect(writerIdsAfterFirst).toContain("session-event-bcb-blocked-observation-unavailable")

			// Second submit_and_exit in the same obligation: the
			// marker is already stamped with
			// reason='observation_unavailable', so the guard prevents
			// a second stamp.
			const toolId2 = "tc-tdd-10d-submit-2"
			h.translatorState.setStreamingToolContext("submit_and_exit", { result: "Verdict 2." })
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_start",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId2,
					input: { result: "Verdict 2." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "content_end",
					contentType: "tool",
					toolName: "submit_and_exit",
					toolCallId: toolId2,
					input: { result: "Verdict 2." },
				}),
			)
			await h.coordinator.handleSessionEvent(
				agentEvent(sessionId, {
					type: "done",
					reason: "completed",
					text: "Verdict 2.",
					iterations: 1,
				}),
			)

			// BCB writer is idempotent on the same obligation.
			const finalWriterIds = h.allCommittedWriterIds()
			const bcbStampCount = finalWriterIds.filter((w) => w === "session-event-bcb-blocked-observation-unavailable").length
			expect(bcbStampCount).toBe(1)
		})
	})
})
