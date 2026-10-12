// ============================================================================
// ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01
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
// RED invariant (ACT §4):
//   For ANY turn that produces a `say: "completion_result"` row with
//   `isAuthoritativelyCompletedResult: true` via the canonical completion
//   tool `content_end` seam, the same turn's live turn phase MUST be
//   "completed" — NOT "error". A non-recoverable error event that
//   arrived earlier in the same turn does NOT downgrade the
//   terminal phase, because the canonical completion tool
//   `content_end` has already been committed.
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
	completionCommitCount: () => number
	errorPhaseCommitCount: () => number
	allCommittedPhases: () => string[]
	ownedJobs: { jobId: string; notify: boolean; running: boolean }[]
	unconsumedOverride: { value: number }
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
	let completionCommitCount = 0
	let errorPhaseCommitCount = 0
	const allCommittedPhases: string[] = []
	const ownedJobs: { jobId: string; notify: boolean; running: boolean }[] = []
	const unconsumedOverride = { value: 0 }
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
				appendAndEmit(msgs as never)
			}) as never,
		},
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			allCommittedPhases.push(phase)
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
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: (sid: string | undefined, tid: string | undefined) =>
			notifyCoordinator.activeNotifyCountForOwner(sid ?? activeSessionId, tid ?? activeTaskId),
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
		getLaunchedBackgroundJobIds: () => ownedJobs.map((j) => j.jobId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		activeSessionId,
		activeTaskId,
		appendAndEmit,
		completionCommitCount: () => completionCommitCount,
		errorPhaseCommitCount: () => errorPhaseCommitCount,
		allCommittedPhases: () => allCommittedPhases,
		ownedJobs: ownedJobs as { jobId: string; notify: boolean; running: boolean }[],
		unconsumedOverride,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

function visibleCompletionRows(h: Harness): ClineMessage[] {
	const calls = h.appendAndEmit.mock.calls as Array<[ClineMessage[]]>
	const rows: ClineMessage[] = []
	for (const call of calls) {
		for (const m of call[0]) {
			// Skip the partial streaming row that content_start emits;
			// only the non-partial `isAuthoritativelyCompletedResult: true`
			// row at content_end is the canonical terminal surface.
			if (m.say === "completion_result" && !m.partial) {
				rows.push(m)
			}
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
	describe("TDD-01: error + submit_and_exit in the same turn → phase MUST be 'completed' (not 'error')", () => {
		it("non-recoverable error earlier in the same turn as submit_and_exit content_end: phase = completed; 1 visible completion row", async () => {
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

			// ─── RED invariant: live phase MUST be "completed" ───
			// Today the coordinator's precedence (sdk-session-event-coordinator.ts
			// :2847) checks wasErrorSeen() BEFORE wasAttemptCompletionSeen(),
			// so the phase commits as "error" — the divergence the user observed.
			expect(h.allCommittedPhases()).toContain("completed")
			expect(h.allCommittedPhases()).not.toContain("error")
			expect(h.completionCommitCount()).toBe(1)
			expect(h.errorPhaseCommitCount()).toBe(0)

			// The visible completion row was committed to the webview AND
			// persisted with isAuthoritativelyCompletedResult: true. On
			// reopen, the webview will render the green COMPLETED card.
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

			// The live path committed a completion row AND a phase commit.
			// Both reads must agree:
			//   1) live:  a "completed" phase commit was made
			//   2) reopen: appendAndEmit history row has isAuthoritativelyCompletedResult === true
			expect(h.allCommittedPhases()).toContain("completed")

			const visible = visibleCompletionRows(h)
			expect(visible.length).toBeGreaterThan(0)
			expect(visible[0]?.isAuthoritativelyCompletedResult).toBe(true)

			// The terminalReportFraming decision (webview side) uses
			//   (a) the row's isAuthoritativelyCompletedResult marker, OR
			//   (b) the live turnState.phase as a SECONDARY gate.
			// Both must agree on "completed" framing for the divergence to
			// not surface as Error/Complete.
			//
			// If isAuthoritativelyCompletedResult is true (it is), the row
			// frames as completed EVEN IF the live phase is something else.
			// So the reopen UI shows "Completed" while the live UI shows
			// "Error" — this is the precise divergence.
			const reopenFramesCompleted = visible[0]?.isAuthoritativelyCompletedResult === true
			const liveFramesCompleted = h.allCommittedPhases().includes("completed")
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
})
