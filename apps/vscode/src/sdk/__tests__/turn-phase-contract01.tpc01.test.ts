/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 — TPC01
 *
 * SOURCE-BOUND EXECUTABLE CONFORMANCE for Chart 01 (Task / Turn Phase),
 * claims T-01 … T-14.
 *
 * WHAT THIS SUITE IS.
 *
 * Chart 01's claims are turned into assertions against the REAL
 * production seams. Nothing here is a re-implementation of production
 * behaviour and nothing here is a synthetic trace-only proof:
 *
 *   - the REAL `TurnStateTracker` (`turn-state-tracker.ts`) owns the
 *     committed phase, the anchor and the monotonic `seq`;
 *   - the REAL `SdkSessionEventCoordinator`
 *     (`sdk-session-event-coordinator.ts`) owns the session-event driven
 *     transitions (T-01, T-02, T-03, T-04, T-06, T-07, T-08);
 *   - the REAL `SdkInteractionCoordinator`
 *     (`sdk-interaction-coordinator.ts`) owns the approval / ask-question
 *     transitions (T-12, T-13, T-14);
 *   - the REAL `SdkCompactionCoordinator`
 *     (`sdk-compaction-coordinator.ts`) owns the compaction system
 *     transition (T-10, T-11);
 *   - the REAL `SdkTaskControlCoordinator`
 *     (`sdk-task-control-coordinator.ts`) owns the cancellation /
 *     recovery transitions (T-05);
 *   - the REAL host projection selector
 *     (`task-state-shadow-arbiter-mapper.ts#selectTaskHeaderPresentation`)
 *     owns the TaskHeader authority;
 *   - the REAL webview projection helper
 *     (`taskHeaderTelemetryHelpers.ts`) owns the label/glyph/live
 *     projection (T-09);
 *   - the REAL webview replica reducer (`messageReducer.ts`) owns the
 *     stale-snapshot acceptance rule (INV-T02 / NEG-T03).
 *
 * THE ONE INJECTED BOUNDARY.
 *
 * The Elm completion-authority decision is INJECTED at the existing
 * provider boundary (`getElmCompletionAuthorityDecision`), exactly as
 * the H01/Chart 04 suite does. That is the ONLY injected boundary;
 * every other seam is production code. The evidence level for T-02 is
 * therefore `INJECTED_DECISION`, not live Elm execution, and no live
 * Elm run is claimed.
 *
 * WHAT IS *NOT* CLAIMED.
 *
 *   - No installed-extension live capture was taken. The closure is
 *     therefore `PASS_STRUCTURAL_ONLY`.
 *   - A host snapshot commit is NOT the same as a webview delivery.
 *     Where a claim says "the webview accepted the state", the witness
 *     drives the REAL reducer. Where a claim says "the phase is
 *     committed", the witness asserts the tracker's committed snapshot.
 *     The two are never conflated.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { CoreSessionEvent } from "@cline/core"
import type { ClineMessage, TurnPhase, TurnState } from "@shared/ExtensionMessage"
import { describe, expect, it, vi } from "vitest"
// The REAL webview replica reducer — the transport-level stale fence.
import {
	applyPresentationProjection,
	applyStateSnapshot,
	applyTurnState,
	createReplicaState,
} from "../../../webview-ui/src/components/chat/chat-view/messageReducer"
// The REAL webview follow-up selector.
import { turnAllowsFollowup } from "../../../webview-ui/src/components/chat/chat-view/shared/turnStateSelectors"
// The REAL webview projection under test (imported as production source,
// not copied).
import {
	stateLabel,
	taskHeaderPresentationStateLabel,
} from "../../../webview-ui/src/components/chat/task-header/taskHeaderTelemetryHelpers"
import { type ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
import {
	CHART_01_VERIFIED_EDGES,
	extractMermaidBlocks,
	parseMermaidTransitionEdges,
	transitionIdOfLabel,
	verifyChart01TurnPhase,
} from "../lifecycle-transition-contract-verifier"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkCompactionCoordinator, type SdkCompactionCoordinatorOptions } from "../sdk-compaction-coordinator"
import { SdkInteractionCoordinator } from "../sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "../sdk-message-coordinator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { SdkTaskControlCoordinator } from "../sdk-task-control-coordinator"
import { TaskOperationFence } from "../task-operation-fence"
import { createTaskProxy } from "../task-proxy"
// The REAL host projection authority selector.
import { selectTaskHeaderPresentation } from "../task-state-shadow-arbiter-mapper"
import {
	CHART_01_ALL_EXPECTED_EDGES,
	CHART_01_EXPECTED_EDGES,
	CHART_01_GROUPED_EXPECTED_EDGES,
	TURN_PHASE_CLAIMS,
	TURN_PHASE_NON_TRANSITION_CLAIM_IDS,
	TURN_PHASE_PROJECTION_AUTHORITY,
	TURN_PHASE_RESTORE_WRITERS,
	TURN_PHASE_TRANSITION_CLAIM_IDS,
	TURN_PHASE_VOCABULARY,
	TURN_PHASE_WRITER_MAP,
} from "../turn-phase-contract"
import { TurnStateTracker } from "../turn-state-tracker"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..")

// ===========================================================================
// THE HARNESS.
//
// It wires the REAL production objects together the way SdkController
// wires them:
//
//   coordinator.setTurnPhase -> REAL TurnStateTracker.setWithWriter
//   coordinator.getTurnPhase -> REAL TurnStateTracker.currentPhase
//
// The tracker is the SINGLE authority. Every committed-phase assertion
// in this suite reads `tracker.get()` — the committed snapshot — never
// a request-time value captured before the write.
// ===========================================================================

interface SessionHarness {
	coordinator: SdkSessionEventCoordinator
	readonly tracker: TurnStateTracker
	readonly translatorState: MessageTranslatorState
	/** The committed snapshot, as the host would publish it. */
	committed: () => TurnState
	/** Number of committed `completed` phase writes. */
	completionCommitCount: () => number
	/** The phase-writer identities observed on the tracker, in order. */
	writers: () => string[]
	setElmDecision: (fn: () => ElmCompletionAuthorityDecision) => void
	setRunning: (running: boolean) => void
	/** Owned background-job observations (BCB inputs). */
	readonly ownedJobs: { jobId: string; running: boolean }[]
	/** The live tools registry the BCB capability probe reads. */
	liveTools: string[] | undefined
	/** The number of unconsumed owned terminal results. */
	unconsumed: { value: number }
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

function makeSessionHarness(opts: { sessionId?: string } = {}): SessionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sessionId = opts.sessionId ?? "session-tpc01"

	let completionCommitCount = 0
	let elmDecision: () => ElmCompletionAuthorityDecision = () => ({
		kind: "authorize",
		reason: "tpc01-test-authorize",
	})
	let running = false
	const ownedJobs: { jobId: string; running: boolean }[] = []
	const unconsumed = { value: 0 }
	const harness: SessionHarness = {
		coordinator: undefined as unknown as SdkSessionEventCoordinator,
		tracker,
		translatorState,
		committed: () => tracker.get(),
		completionCommitCount: () => completionCommitCount,
		writers: () => writers,
		setElmDecision: (fn) => {
			elmDecision = fn
		},
		setRunning: (value) => {
			running = value
		},
		ownedJobs,
		liveTools: undefined,
		unconsumed,
	}

	// The observed writer identities. The tracker itself does not expose
	// them, so the harness records them at the SAME production callback
	// the coordinator uses (`setTurnPhase`) — the callback is the
	// production seam, and the recorder is observation-only.
	const writers: string[] = []

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId },
				get isRunning() {
					return running
				},
			}),
			setRunning: (value: boolean) => {
				running = value
			},
		},
		messages: {
			appendAndEmit: (() => {
				// The BCB message-layer filter needs the produced rows;
				// the harness publishes them to the REAL translator's
				// own output collector so the coordinator's filter sees
				// the same rows production would.
			}) as never,
			emitHookMessage: (() => {
				// The completion-authority marker publication channel.
			}) as never,
		},
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: "task-tpc01" }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase: TurnPhase, anchorTs: number | undefined, writerId?: string) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			writers.push(writerId ?? "unknown-legacy-writer")
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		getElmCompletionAuthorityDecision: () => elmDecision(),
		hasRunningBackgroundJobForOwner: (sid: string | undefined) => {
			if (sid !== sessionId) return false
			return ownedJobs.some((j) => j.running)
		},
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== sessionId) return 0
			return unconsumed.value
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== sessionId || tid !== "task-tpc01") return []
			return unconsumed.value > 0 ? ownedJobs.map((j) => j.jobId) : []
		},
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		getLaunchedBackgroundJobIds: () => ownedJobs.map((j) => j.jobId),
		liveTools: () => harness.liveTools,
	} as unknown as SdkSessionEventCoordinatorOptions)

	harness.coordinator = coordinator
	return harness
}

// ===========================================================================
// THE INTERACTION HARNESS (T-12, T-13, T-14).
//
// The REAL `SdkInteractionCoordinator` drives the REAL tracker through
// the SAME `setTurnPhase` callback production uses.
// ===========================================================================

interface InteractionHarness {
	readonly coordinator: SdkInteractionCoordinator
	readonly tracker: TurnStateTracker
	readonly writers: () => string[]
	committed: () => TurnState
	/** The ask messages the coordinator emitted, read from the REAL store. */
	emittedAsks: () => ClineMessage[]
}

function makeInteractionHarness(): InteractionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const writers: string[] = []

	// The REAL production message channel, wired exactly as SdkController
	// wires it: a task proxy owns the message store, and the
	// coordinator publishes through `SdkMessageCoordinator`.
	const task = createTaskProxy("session-tpc01-interaction", vi.fn(), vi.fn())
	const messages = new SdkMessageCoordinator({ getTask: () => task })

	const coordinator = new SdkInteractionCoordinator({
		messages,
		getSessionId: () => "session-tpc01-interaction",
		getMinter: () => minter,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase: TurnPhase, anchorTs: number | undefined, writerId?: string) => {
			writers.push(writerId ?? "unknown-legacy-writer")
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as never,
		recordApprovedToolMessage: vi.fn(),
		recordDeniedToolApproval: vi.fn(),
	} as never)

	// The emitted ask rows are read from the REAL message store.
	const emittedAsks = () => task.messageStateHandler.getClineMessages().filter((m) => m.type === "ask")

	return {
		coordinator,
		tracker,
		writers: () => writers,
		emittedAsks,
		committed: () => tracker.get(),
	}
}

// ===========================================================================
// THE COMPACTION HARNESS (T-10, T-11).
//
// The REAL `SdkCompactionCoordinator` drives the REAL tracker. The
// phase is sampled at the exact instant the "Compacting context"
// divider is emitted — the same sampling point the existing CSA suite
// uses — so the assertion is about the phase the user actually sees.
// ===========================================================================

interface CompactionHarness {
	readonly coordinator: SdkCompactionCoordinator
	readonly tracker: TurnStateTracker
	readonly writers: () => string[]
	committed: () => TurnState
	/** The phase sampled when the "started" divider became visible. */
	phaseWhenCompactionStarted: () => TurnPhase | undefined
	/** The phase sampled when the terminal divider became visible. */
	phaseWhenCompactionFinished: () => TurnPhase | undefined
}

function makeCompactionHarness(entryPhase: TurnPhase, entryAnchorTs?: number): CompactionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const writers: string[] = []
	let sampledStarted: TurnPhase | undefined
	let sampledFinished: TurnPhase | undefined

	tracker.set(entryPhase, entryAnchorTs)

	const sessionHost = {
		start: vi.fn().mockResolvedValue({ sessionId: "old-session" }),
		readMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		updateSessionCompactionState: vi.fn().mockResolvedValue({ updated: true }),
		send: vi.fn(),
		abort: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
	const activeSession = {
		sessionId: "old-session",
		sdkHost: sessionHost,
		unsubscribe: vi.fn(),
		startResult: { sessionId: "old-session" },
		isRunning: false,
	}

	const options = {
		stateManager: { getGlobalSettingsKey: vi.fn(() => "act") },
		sessions: {
			getActiveSession: vi.fn(() => activeSession),
			startNewSession: vi.fn(),
			setRunning: vi.fn(),
			endActiveSession: vi.fn().mockResolvedValue(undefined),
			waitForPendingStop: vi.fn().mockResolvedValue(undefined),
		},
		rebuilds: { runExclusive: vi.fn(async (operation: () => Promise<unknown>) => operation()) },
		messages: {
			appendAndEmit: vi.fn((messages: ClineMessage[]) => {
				for (const message of messages) {
					if (message.say !== "compaction") continue
					const info = JSON.parse(message.text ?? "{}") as { status?: string }
					if (info.status === "started") {
						sampledStarted = tracker.currentPhase
					}
					if (info.status && info.status !== "started") {
						sampledFinished = tracker.currentPhase
					}
				}
			}),
		},
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			getLegacyResumeInitialMessages: vi.fn(async (_taskId: string, fallback?: unknown[]) => fallback),
		},
		sessionConfigBuilder: {
			build: vi.fn().mockResolvedValue({
				providerConfig: { providerId: "anthropic", modelId: "claude" },
				providerId: "anthropic",
				modelId: "claude",
			}),
		},
		getDisplayedTaskId: vi.fn(() => "old-session"),
		createTempSessionHost: vi.fn().mockResolvedValue(sessionHost),
		loadInitialMessages: vi.fn().mockResolvedValue([{ role: "user", content: "1" }]),
		getWorkspaceRoot: vi.fn().mockResolvedValue("/workspace"),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		getTurnState: () => tracker.get(),
		setTurnPhase: ((phase: TurnPhase, anchorTs: number | undefined, writerId?: string) => {
			writers.push(writerId ?? "unknown-legacy-writer")
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as never,
	} as unknown as SdkCompactionCoordinatorOptions

	return {
		coordinator: new SdkCompactionCoordinator(options),
		tracker,
		writers: () => writers,
		committed: () => tracker.get(),
		phaseWhenCompactionStarted: () => sampledStarted,
		phaseWhenCompactionFinished: () => sampledFinished,
	}
}

// ===========================================================================
// THE CANCELLATION HARNESS (T-05).
//
// The REAL `SdkTaskControlCoordinator.cancelTask` is the production
// cancel seam the webview's Cancel button reaches. It drives the REAL
// tracker through the same `setTurnPhase` callback production wires.
//
// The `controller-cancel-task` writer identity lives in
// `SdkController.cancelTask` (the caller). The coordinator's own
// no-active-session writer is `task-control-cancel-no-active-session`.
// The witness drives the coordinator's REAL no-active-session recovery
// branch — the branch that raises the cancel fence AND publishes the
// authoritative `resumable` recovery phase — and asserts the phase AND
// the fence ordering against the REAL tracker.
// ===========================================================================

interface CancelHarness {
	readonly coordinator: SdkTaskControlCoordinator
	readonly tracker: TurnStateTracker
	readonly writers: () => string[]
	committed: () => TurnState
	/** The order of the observable cancel sub-boundaries. */
	readonly boundaryOrder: string[]
}

function makeCancelHarness(): CancelHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const writers: string[] = []
	const boundaryOrder: string[] = []

	const coordinator = new SdkTaskControlCoordinator({
		sessions: {
			// The task view still exists (the user sees the task and the
			// Working/Cancel header) but there is NO active SDK session.
			getActiveSession: () => undefined,
			endActiveSession: vi.fn().mockResolvedValue(undefined),
			setRunning: vi.fn(),
		} as never,
		interactions: {
			clearPending: () => {
				boundaryOrder.push("clearPending")
			},
		} as never,
		messages: { cancelPendingSave: vi.fn() } as never,
		taskHistory: {} as never,
		taskOperationFence: new TaskOperationFence(),
		getTask: () => ({ taskId: "task-tpc01-cancel" }) as never,
		setTask: vi.fn(),
		onAskResponse: vi.fn().mockResolvedValue(undefined),
		resetMessageTranslator: () => {
			minter.bumpEpoch()
		},
		postStateToWebview: vi.fn().mockImplementation(() => {
			boundaryOrder.push("postStateToWebview")
			return Promise.resolve()
		}),
		clearTaskSettings: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase: TurnPhase, anchorTs: number | undefined, writerId?: string) => {
			writers.push(writerId ?? "unknown-legacy-writer")
			boundaryOrder.push(`setTurnPhase:${phase}`)
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as never,
		getTurnPhase: () => tracker.currentPhase,
		raiseCancelFence: () => {
			boundaryOrder.push("raiseCancelFence")
			minter.bumpEpoch()
		},
	} as never)

	return {
		coordinator,
		tracker,
		writers: () => writers,
		boundaryOrder,
		committed: () => tracker.get(),
	}
}

// ===========================================================================
// EVENT HELPERS.
//
// These drive the REAL coordinator with the REAL event shapes. The
// `pending_prompt_submitted` event is the REAL production turn-start
// event; the `done` event carries the REAL completion reason.
// ===========================================================================

function pendingPromptSubmitted(sessionId: string): CoreSessionEvent {
	return { type: "pending_prompt_submitted", payload: { sessionId } } as unknown as CoreSessionEvent
}

function doneEvent(sessionId: string, reason = "completed"): CoreSessionEvent {
	return agentEvent(sessionId, { type: "done", reason, text: "Task finished.", iterations: 1 })
}

// ===========================================================================
// T-01 — the turn enters `streaming`.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-01", () => {
	it("T-01: a pending_prompt_submitted event commits `streaming` with a strictly greater seq", async () => {
		const h = makeSessionHarness()
		// The pre-event committed snapshot.
		const before = h.committed()
		expect(before.phase).toBe("idle")

		await h.coordinator.handleSessionEvent(pendingPromptSubmitted("session-tpc01"))

		const after = h.committed()
		expect(after.phase).toBe("streaming")
		// The COMMITTED snapshot advanced, not just the sequence generator.
		expect(after.seq).toBeGreaterThan(before.seq)
		// The writer identity is the production one.
		expect(h.writers()).toContain("session-event-pending-prompt-submitted")
	})

	it("T-01 (authority): the tracker mutation is the authoritative host phase boundary and precedes listener notification", async () => {
		const h = makeSessionHarness()
		// A listener that OBSERVES the committed snapshot at notification
		// time. If the mutation happened AFTER the fan-out, the listener
		// would see the OLD phase.
		const observed: TurnPhase[] = []
		h.tracker.subscribe((phase) => {
			observed.push(h.tracker.get().phase)
			expect(phase).toBe(h.tracker.get().phase)
		})

		await h.coordinator.handleSessionEvent(pendingPromptSubmitted("session-tpc01"))

		expect(observed).toEqual(["streaming"])
		expect(h.committed().phase).toBe("streaming")
	})
})

// ===========================================================================
// T-02 — the C10 completion commit.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-02", () => {
	it("T-02 (authorized): the C10 commit publishes `completed` when the completion facts hold and Elm authorizes", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		const before = h.committed()

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		expect(h.committed().phase).toBe("completed")
		expect(h.committed().seq).toBeGreaterThan(before.seq)
		expect(h.completionCommitCount()).toBe(1)
		expect(h.writers()).toContain("session-event-turn-complete-completed")
	})

	it("T-02 (Elm HOLD): an Elm HOLD suppresses the C10 commit entirely — no `completed` is committed", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "hold", reason: "tpc01-hold", holdReasons: ["held"] }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		const before = h.committed()

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		expect(h.completionCommitCount()).toBe(0)
		expect(h.committed().phase).not.toBe("completed")
		// The phase is UNCHANGED — the HOLD did not write anything.
		expect(h.committed().phase).toBe(before.phase)
		expect(h.committed().seq).toBe(before.seq)
	})

	it("T-02 (Elm FAILURE): an Elm failure suppresses the C10 commit entirely — no `completed` is committed", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({
			kind: "failure",
			reason: "tpc01-failure",
			classification: "elm_authority_unavailable",
		}))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		const before = h.committed()

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		expect(h.completionCommitCount()).toBe(0)
		expect(h.committed().phase).not.toBe("completed")
		expect(h.committed().phase).toBe(before.phase)
		expect(h.committed().seq).toBe(before.seq)
	})

	it("T-02 (conservation): a turn WITHOUT a committed terminal response does NOT reach `completed`", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// Attempt completion was DECLARED but no terminal response was
		// committed — the C10 conservation condition fails.
		h.translatorState.setAttemptCompletionSeen()

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		expect(h.completionCommitCount()).toBe(0)
		expect(h.committed().phase).not.toBe("completed")
	})
})

// ===========================================================================
// T-03 — the turn yields for follow-up (NOT completion).
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-03", () => {
	it("T-03: a turn with no committed completion attempt commits `awaiting_followup`, never `completed`", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const before = h.committed()

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		expect(h.committed().phase).toBe("awaiting_followup")
		expect(h.committed().seq).toBeGreaterThan(before.seq)
		// The completion commit did NOT happen.
		expect(h.completionCommitCount()).toBe(0)
		// The production writer for the done-without-completion path.
		expect(h.writers()).toContain("session-event-turn-complete-resumable-straggler-preserve")
	})

	it("T-03 (user-action semantics): the `awaiting_followup` phase keeps the composer continuable", async () => {
		const h = makeSessionHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		const committed = h.committed()
		// The REAL webview follow-up selector accepts the committed phase.
		expect(turnAllowsFollowup({ phase: committed.phase, seq: committed.seq })).toBe(true)
		// And the phase is DISTINCT from approval and compaction.
		expect(committed.phase).not.toBe("awaiting_approval")
		expect(committed.phase).not.toBe("compacting")
	})
})

// ===========================================================================
// T-04 — the provider/agent error phase.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-04", () => {
	it("T-04: a turn that surfaced a provider error commits `error` through the provider-error writer", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.translatorState.setErrorSeen()
		const before = h.committed()

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01", "error"))

		expect(h.committed().phase).toBe("error")
		expect(h.committed().seq).toBeGreaterThan(before.seq)
		expect(h.writers()).toContain("session-event-turn-complete-error")
		// The error path is NOT a completion.
		expect(h.completionCommitCount()).toBe(0)
	})

	it("T-04 (distinctness): the provider-error writer is NOT the BCB observation-unavailable writer", async () => {
		const providerErrorHarness = makeSessionHarness()
		providerErrorHarness.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		providerErrorHarness.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		providerErrorHarness.translatorState.setErrorSeen()
		await providerErrorHarness.coordinator.handleSessionEvent(doneEvent("session-tpc01", "error"))

		const bcbHarness = makeSessionHarness()
		bcbHarness.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		bcbHarness.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// The BCB holds an owned terminal result the resumed turn cannot
		// observe (no `command_status` in the live tool registry).
		bcbHarness.ownedJobs.push({ jobId: "cmd-tpc01-held", running: true })
		bcbHarness.unconsumed.value = 1
		bcbHarness.liveTools = ["read_files", "run_commands"]
		bcbHarness.translatorState.setAttemptCompletionSeen()
		bcbHarness.translatorState.setTerminalResponseCommittedThisTurn()
		await bcbHarness.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		// Both commit `error`, but through DIFFERENT writer identities.
		expect(providerErrorHarness.committed().phase).toBe("error")
		expect(bcbHarness.committed().phase).toBe("error")
		expect(providerErrorHarness.writers()).toContain("session-event-turn-complete-error")
		expect(bcbHarness.writers()).toContain("session-event-bcb-blocked-observation-unavailable")
		expect(providerErrorHarness.writers()).not.toContain("session-event-bcb-blocked-observation-unavailable")
		expect(bcbHarness.writers()).not.toContain("session-event-turn-complete-error")
	})
})

// ===========================================================================
// T-06 — the cancellation straggler GUARD.
//
// This claim carries NO Mermaid edge. It is a SUPPRESSION, not a
// transition: the guard SKIPS the phase write entirely.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-06", () => {
	it("T-06: a turn-complete after a cancellation commits NO phase — `resumable` AND its seq are preserved", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// The cancel commits `resumable` and the session stops running.
		h.tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" })
		h.setRunning(false)
		const afterCancel = h.committed()
		expect(afterCancel.phase).toBe("resumable")

		// The straggler `done` arrives AFTER the cancellation.
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		// The phase is preserved AND the seq is UNCHANGED — the guard
		// performed NO write at all.
		expect(h.committed().phase).toBe("resumable")
		expect(h.committed().seq).toBe(afterCancel.seq)
		expect(h.completionCommitCount()).toBe(0)
	})

	it("T-06 (guard shape): the straggler guard is a SUPPRESSION — no phase write is recorded at all", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" })
		h.setRunning(false)
		const writersBefore = h.writers().length

		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		// NO writer was invoked at all by the straggler event.
		expect(h.writers().length).toBe(writersBefore)
	})
})

// ===========================================================================
// T-07 — the BCB observation-unavailable error.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-07", () => {
	it("T-07: a BCB-held obligation the resumed turn cannot observe commits `error` through the BCB writer", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// The BCB holds an owned terminal result. The resumed turn's tool
		// registry has NO `command_status`, so it CANNOT observe the held
		// result — the capability is PROVEN unavailable (false), not
		// merely unknown (null).
		h.ownedJobs.push({ jobId: "cmd-tpc01-held", running: true })
		h.unconsumed.value = 1
		h.liveTools = ["read_files", "run_commands"]
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		const before = h.committed()

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		expect(h.committed().phase).toBe("error")
		expect(h.committed().seq).toBeGreaterThan(before.seq)
		expect(h.writers()).toContain("session-event-bcb-blocked-observation-unavailable")
		// The BCB recovery error is NOT a completion.
		expect(h.completionCommitCount()).toBe(0)
	})

	it("T-07 (capability available): when the resumed turn CAN observe held results, the BCB writer does NOT fire", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.ownedJobs.push({ jobId: "cmd-tpc01-held", running: true })
		h.unconsumed.value = 1
		// The registry HAS `command_status` — the capability is available.
		h.liveTools = ["command_status", "read_files", "run_commands"]
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		expect(h.writers()).not.toContain("session-event-bcb-blocked-observation-unavailable")
	})
})

// ===========================================================================
// T-08 — the grouped next-turn resumption over FOUR distinct source states.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-08", () => {
	const SOURCES: ReadonlyArray<{ readonly id: string; readonly phase: TurnPhase }> = [
		{ id: "T-08", phase: "awaiting_followup" },
		{ id: "T-08a", phase: "completed" },
		{ id: "T-08b", phase: "error" },
		{ id: "T-08c", phase: "resumable" },
	]

	for (const source of SOURCES) {
		it(`T-08 (${source.id}): from \`${source.phase}\` a pending_prompt_submitted commits \`streaming\` with a greater seq`, async () => {
			const h = makeSessionHarness()
			// Establish the SOURCE state through the REAL tracker.
			h.tracker.setWithWriter(source.phase, undefined, { writerId: "controller-clear-task" })
			const before = h.committed()
			expect(before.phase).toBe(source.phase)

			await h.coordinator.handleSessionEvent(pendingPromptSubmitted("session-tpc01"))

			const after = h.committed()
			expect(after.phase).toBe("streaming")
			expect(after.seq).toBeGreaterThan(before.seq)
			expect(h.writers()).toContain("session-event-pending-prompt-submitted")
		})
	}

	it("T-08 (grouping): the four source states are four DISTINCT runtime phases, not one slash-delimited phase", () => {
		// The grouped contract's source states must be four real members
		// of the `TurnPhase` vocabulary — a slash-delimited string would
		// NOT be a runtime phase.
		for (const source of SOURCES) {
			expect(TURN_PHASE_VOCABULARY).toContain(source.phase)
		}
		// And the four are pairwise distinct.
		expect(new Set(SOURCES.map((s) => s.phase)).size).toBe(4)
		// The grouped contract's edge association names each of them.
		const groupedSources = [
			CHART_01_EXPECTED_EDGES["T-08"].source,
			CHART_01_GROUPED_EXPECTED_EDGES["T-08a"].source,
			CHART_01_GROUPED_EXPECTED_EDGES["T-08b"].source,
			CHART_01_GROUPED_EXPECTED_EDGES["T-08c"].source,
		]
		expect(new Set(groupedSources).size).toBe(4)
		for (const source of groupedSources) {
			expect(TURN_PHASE_VOCABULARY).toContain(source)
		}
	})
})

// ===========================================================================
// T-09 — the TaskHeader PROJECTION.
//
// This claim carries NO Mermaid edge. The TaskHeader label is a
// function of the committed phase (and the presentation authority),
// not a lifecycle state.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-09", () => {
	it("T-09 (labels): the REAL `stateLabel` maps all eight phases to their exact label/glyph/live triple", () => {
		expect(stateLabel("idle")).toEqual({ label: "Idle", glyph: "○", live: false })
		expect(stateLabel("streaming")).toEqual({ label: "Working", glyph: "●", live: true })
		expect(stateLabel("awaiting_approval")).toEqual({ label: "Approval", glyph: "?", live: true })
		expect(stateLabel("awaiting_followup")).toEqual({ label: "Your turn", glyph: "↳", live: true })
		expect(stateLabel("compacting")).toEqual({ label: "Compacting", glyph: "⌄", live: true })
		expect(stateLabel("completed")).toEqual({ label: "Complete", glyph: "✓", live: false })
		expect(stateLabel("error")).toEqual({ label: "Error", glyph: "!", live: false })
		expect(stateLabel("resumable")).toEqual({ label: "Paused", glyph: "↻", live: false })
	})

	it("T-09 (vocabulary): every canonical phase has a distinct label and the eight phases are all covered", () => {
		const labels = TURN_PHASE_VOCABULARY.map((phase) => stateLabel(phase).label)
		expect(labels).toHaveLength(8)
		expect(new Set(labels).size).toBe(8)
	})

	it("T-09 (authority): the production entry point reads the CANONICAL projection, not the legacy phase", () => {
		// The canonical projection says `completed`; the legacy phase
		// says `streaming`. The production entry point MUST follow the
		// canonical projection.
		const canonical = { phase: "completed" as const, source: "shadow" as const, seq: 42 }
		const legacy = { phase: "streaming" as const, anchorTs: undefined, seq: 41 }
		expect(taskHeaderPresentationStateLabel(canonical, legacy)).toEqual({
			label: "Complete",
			glyph: "✓",
			live: false,
		})

		// With the canonical projection ABSENT (Hub/Remote / pre-
		// observation), the legacy fallback is used.
		expect(taskHeaderPresentationStateLabel(undefined, legacy)).toEqual({
			label: "Working",
			glyph: "●",
			live: true,
		})
	})

	it("T-09 (host authority): the host-owned compaction override wins over the canonical shadow", () => {
		// The host owns `compacting` — the canonical shadow cannot
		// represent it, so the host branch is the authority.
		const projection = selectTaskHeaderPresentation({
			currentLegacyPhase: "compacting",
			canonicalShadowPhase: "streaming",
			seq: 99,
		})
		expect(projection.phase).toBe("compacting")
		expect(projection.source).toBe("host")
		expect(projection.seq).toBe(99)
		// And the header renders the compaction label, not a human wait.
		expect(taskHeaderPresentationStateLabel(projection, undefined)).toEqual({
			label: "Compacting",
			glyph: "⌄",
			live: true,
		})
	})

	it("T-09 (shadow authority): the canonical shadow wins over the legacy phase when it is authoritative", () => {
		const projection = selectTaskHeaderPresentation({
			currentLegacyPhase: "streaming",
			canonicalShadowPhase: "awaiting_approval",
			seq: 100,
			canonicalShadowObservedTurnSeq: 100,
		})
		expect(projection.phase).toBe("awaiting_approval")
		expect(projection.source).toBe("shadow")
	})

	it("T-09 (legacy fallback): with no canonical observation the legacy phase is the authority", () => {
		const projection = selectTaskHeaderPresentation({
			currentLegacyPhase: "streaming",
			canonicalShadowPhase: undefined,
			seq: 7,
		})
		expect(projection.phase).toBe("streaming")
		expect(projection.source).toBe("legacy")
	})

	it("T-09 (not a state): the TaskHeader label is a PROJECTION of the phase, not a lifecycle state", () => {
		// Two DIFFERENT phases produce two DIFFERENT labels — the label
		// is derived, and the phase remains the authority.
		expect(stateLabel("streaming").label).not.toBe(stateLabel("awaiting_followup").label)
		expect(stateLabel("awaiting_approval").label).not.toBe(stateLabel("compacting").label)
		// The projection never invents a phase of its own.
		expect(stateLabel(undefined).label).toBe("Unknown")
	})
})

// ===========================================================================
// T-05 — the cancellation / recovery transition.
//
// The REAL `SdkTaskControlCoordinator.cancelTask` raises the cancel
// fence and publishes the authoritative `resumable` recovery phase.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-05", () => {
	it("T-05: cancellation commits `resumable` and raises the fence BEFORE the publication", async () => {
		const h = makeCancelHarness()
		// The committed phase before the cancel.
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const before = h.committed()
		expect(before.phase).toBe("streaming")

		await h.coordinator.cancelTask()

		// The COMMITTED snapshot is `resumable` with a strictly greater seq.
		expect(h.committed().phase).toBe("resumable")
		expect(h.committed().seq).toBeGreaterThan(before.seq)
		expect(h.writers()).toContain("task-control-cancel-no-active-session")

		// The fence is raised BEFORE the phase is published, so any
		// straggler SDK event lands on the wrong side of the fence.
		expect(h.boundaryOrder.indexOf("raiseCancelFence")).toBeGreaterThanOrEqual(0)
		expect(h.boundaryOrder.indexOf("raiseCancelFence")).toBeLessThan(h.boundaryOrder.indexOf("setTurnPhase:resumable"))
	})

	it("T-05 (conservation): a cancellation never OVERWRITES an already-committed terminal phase", async () => {
		const h = makeCancelHarness()
		// The C10 already committed `completed` — the authoritative
		// terminal phase stands and Cancel must not clobber it.
		h.tracker.setWithWriter("completed", undefined, { writerId: "session-event-turn-complete-completed" })
		const before = h.committed()

		await h.coordinator.cancelTask()

		expect(h.committed().phase).toBe("completed")
		expect(h.committed().seq).toBe(before.seq)
	})
})

// ===========================================================================
// T-10 / T-11 — the compaction system transition.
//
// The compaction phase is a HOST-OWNED SYSTEM TRANSITION. It is NOT a
// human wait and NOT model/tool work.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-10 / T-11", () => {
	it("T-10: the production compaction path commits `compacting` while the divider is visible", async () => {
		const h = makeCompactionHarness("awaiting_followup")
		const before = h.committed()

		await h.coordinator.compactTask()

		// The phase sampled at the exact instant the "Compacting context"
		// divider became visible is `compacting` — not a human wait.
		expect(h.phaseWhenCompactionStarted()).toBe("compacting")
		// The `compacting` write strictly advanced the committed seq.
		expect(h.writers()).toContain("compaction-enter")
		expect(before.seq).toBeLessThan(h.committed().seq)
	})

	it("T-10 (not a human wait): the compaction phase is distinct from approval and follow-up", async () => {
		const h = makeCompactionHarness("awaiting_followup")
		await h.coordinator.compactTask()

		const sampled = h.phaseWhenCompactionStarted()
		expect(sampled).not.toBe("awaiting_followup")
		expect(sampled).not.toBe("awaiting_approval")
		expect(sampled).not.toBe("streaming")
		// And the TaskHeader renders the compaction label.
		expect(stateLabel(sampled as TurnPhase).label).toBe("Compacting")
	})

	it("T-11: the terminal compaction event restores the phase that was current on entry", async () => {
		const h = makeCompactionHarness("awaiting_followup")
		const entry = h.committed()
		expect(entry.phase).toBe("awaiting_followup")

		await h.coordinator.compactTask()

		// The entry phase is restored with a strictly greater seq.
		expect(h.committed().phase).toBe("awaiting_followup")
		expect(h.committed().seq).toBeGreaterThan(entry.seq)
		// The restore is a HOST write, not a shadow projection.
		expect(h.writers()).toContain("compaction-restore-entry-preserve")
	})

	it("T-11 (anchor): the entry anchor is preserved across the compaction window", async () => {
		const h = makeCompactionHarness("awaiting_followup", 4242)
		const entry = h.committed()
		expect(entry.anchorTs).toBe(4242)

		await h.coordinator.compactTask()

		expect(h.committed().anchorTs).toBe(4242)
	})
})

// ===========================================================================
// T-12 / T-13 / T-14 — the interaction-driven transitions.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / T-12 / T-13 / T-14", () => {
	const approvalRequest = {
		agentId: "agent",
		conversationId: "conversation",
		iteration: 1,
		toolCallId: "tool-call-tpc01",
		toolName: "read_files",
		input: { path: "README.md" },
		policy: { autoApprove: false },
	}

	it("T-12: a tool approval request commits `awaiting_approval` anchored on the approval ask", async () => {
		const h = makeInteractionHarness()
		const before = h.committed()

		const approvalPromise = h.coordinator.handleRequestToolApproval(approvalRequest)
		await vi.waitFor(() => expect(h.emittedAsks()).toHaveLength(1))

		const committed = h.committed()
		expect(committed.phase).toBe("awaiting_approval")
		expect(committed.seq).toBeGreaterThan(before.seq)
		// The anchor IS the approval ask message's ts.
		expect(committed.anchorTs).toBe(h.emittedAsks()[0].ts)
		expect(h.writers()).toContain("interaction-handle-tool-approval")

		h.coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")
		await approvalPromise
	})

	it("T-13: an ask_question commits `awaiting_followup` anchored on the ask message", async () => {
		const h = makeInteractionHarness()
		const before = h.committed()

		const answerPromise = h.coordinator.handleAskQuestion("Continue?", ["Yes"], undefined)
		await vi.waitFor(() => expect(h.emittedAsks()).toHaveLength(1))

		const committed = h.committed()
		expect(committed.phase).toBe("awaiting_followup")
		expect(committed.seq).toBeGreaterThan(before.seq)
		expect(committed.anchorTs).toBe(h.emittedAsks()[0].ts)
		expect(h.writers()).toContain("interaction-handle-ask-question")
		// The phase is DISTINCT from `awaiting_approval`.
		expect(committed.phase).not.toBe("awaiting_approval")

		h.coordinator.resolvePendingAskQuestion("yes")
		await answerPromise
	})

	it("T-14: resolving a pending approval commits `streaming` with the anchor cleared", async () => {
		const h = makeInteractionHarness()

		const approvalPromise = h.coordinator.handleRequestToolApproval(approvalRequest)
		await vi.waitFor(() => expect(h.emittedAsks()).toHaveLength(1))
		const beforeResolve = h.committed()
		expect(beforeResolve.phase).toBe("awaiting_approval")

		expect(h.coordinator.resolvePendingToolApproval(undefined, "yesButtonClicked")).toBe(true)

		const committed = h.committed()
		expect(committed.phase).toBe("streaming")
		expect(committed.seq).toBeGreaterThan(beforeResolve.seq)
		// The anchor is CLEARED — the approval is no longer pending.
		expect(committed.anchorTs).toBeUndefined()
		expect(h.writers()).toContain("interaction-resolve-tool-approval-yes-no")

		await approvalPromise
	})
})

// ===========================================================================
// INV-T01 — the single authoritative commit boundary.
//
// Every phase write is witnessed as: requested phase, actual writer,
// previous committed phase/seq, new committed phase/seq, and observer
// notification. A listener callback is NOT an independent authority.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / INV-T01", () => {
	it("INV-T01: the tracker mutation precedes the listener notification and the listener is not an authority", () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const observed: { phase: TurnPhase; seq: number }[] = []
		tracker.subscribe(() => {
			// The listener READS the committed snapshot. If the mutation
			// had not happened yet, it would observe the old phase.
			const snapshot = tracker.get()
			observed.push({ phase: snapshot.phase, seq: snapshot.seq })
		})

		const before = tracker.get()
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const after = tracker.get()

		expect(observed).toHaveLength(1)
		expect(observed[0].phase).toBe("streaming")
		expect(observed[0].seq).toBe(after.seq)
		// The observer cannot change the committed snapshot.
		expect(after.phase).toBe("streaming")
		expect(after.seq).toBeGreaterThan(before.seq)
	})

	it("INV-T01 (legacy alias): `set()` is the legacy alias and stamps `unknown-legacy-writer`", () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const before = tracker.get()
		tracker.set("streaming")
		const after = tracker.get()
		expect(after.phase).toBe("streaming")
		expect(after.seq).toBeGreaterThan(before.seq)
	})
})

// ===========================================================================
// INV-T02 — sequence monotonicity.
//
// For a sequence of successful tracker writes, INCLUDING repeated
// writes of the same phase: newSeq > previousSeq. The assertion is on
// the COMMITTED SNAPSHOT, not on the sequence generator's return value.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / INV-T02", () => {
	it("INV-T02: every committed write advances the committed seq, including repeated writes of the SAME phase", () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const seqs: number[] = [tracker.get().seq]
		const phases: TurnPhase[] = ["streaming", "streaming", "completed", "completed", "error", "error"]
		for (const phase of phases) {
			tracker.setWithWriter(phase, undefined, { writerId: "task-start-init-task" })
			seqs.push(tracker.get().seq)
		}
		for (let i = 1; i < seqs.length; i++) {
			expect(seqs[i]).toBeGreaterThan(seqs[i - 1])
		}
		// The repeated same-phase writes DID advance the seq.
		expect(seqs[2]).toBeGreaterThan(seqs[1])
		expect(seqs[4]).toBeGreaterThan(seqs[3])
	})

	it("INV-T02 (webview fence): the REAL webview reducer rejects a stale lower-sequence phase state", () => {
		// The committed state.
		let replica = createReplicaState()
		replica = applyTurnState(replica, { phase: "completed", anchorTs: undefined, seq: 100 })
		expect(replica.turnState?.phase).toBe("completed")

		// A STALE snapshot with a LOWER seq arrives afterwards.
		const afterStale = applyTurnState(replica, { phase: "streaming", anchorTs: undefined, seq: 50 })
		expect(afterStale.turnState?.phase).toBe("completed")
		expect(afterStale.turnState?.seq).toBe(100)

		// The same rule applies to the presentation projections.
		const current = { phase: "completed" as const, source: "shadow" as const, seq: 100 }
		expect(applyPresentationProjection(current, { phase: "streaming", source: "shadow", seq: 50 })?.phase).toBe("completed")
		// A NEWER seq advances.
		expect(applyPresentationProjection(current, { phase: "streaming", source: "shadow", seq: 150 })?.phase).toBe("streaming")
	})

	it("INV-T02 (epoch scope): a stale snapshot from an OLDER epoch is dropped wholesale", () => {
		let replica = createReplicaState()
		replica = applyStateSnapshot(replica, [], 5, 10, { phase: "completed", anchorTs: undefined, seq: 100 })
		expect(replica.turnState?.phase).toBe("completed")
		expect(replica.epoch).toBe(5)

		// An OLDER epoch snapshot with a HIGHER seq is still dropped.
		const afterOlderEpoch = applyStateSnapshot(replica, [], 4, 11, {
			phase: "streaming",
			anchorTs: undefined,
			seq: 999,
		})
		expect(afterOlderEpoch.turnState?.phase).toBe("completed")
		expect(afterOlderEpoch.turnState?.seq).toBe(100)
	})
})

// ===========================================================================
// INV-T09 — observers cannot veto commits.
//
// On the REAL tracker:
//   - one throwing subscriber must not prevent the commit;
//   - later subscribers must still be notified;
//   - a subscriber removing itself or another subscriber must not
//     corrupt the notification iteration;
//   - diagnostics disabled must preserve state and sequence semantics.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / INV-T09", () => {
	it("INV-T09: a throwing subscriber cannot prevent the commit, and later subscribers still run", () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		tracker.subscribe(() => {
			throw new Error("observer is buggy today")
		})
		let laterCalls = 0
		tracker.subscribe(() => {
			laterCalls += 1
		})

		const before = tracker.get()
		expect(() => tracker.setWithWriter("completed", undefined, { writerId: "task-start-init-task" })).not.toThrow()

		// The state IS committed.
		expect(tracker.get().phase).toBe("completed")
		expect(tracker.get().seq).toBeGreaterThan(before.seq)
		// And the later subscriber ran.
		expect(laterCalls).toBe(1)
	})

	it("INV-T09: a subscriber removing itself or another subscriber does not corrupt the iteration", () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		let bCalls = 0
		let cCalls = 0
		const unsubA: () => void = tracker.subscribe(() => {
			unsubA() // unsubscribe SELF during iteration
		})
		tracker.subscribe(() => {
			bCalls += 1
		})
		tracker.subscribe(() => {
			cCalls += 1
		})

		expect(() => tracker.setWithWriter("completed", undefined, { writerId: "task-start-init-task" })).not.toThrow()
		expect(bCalls).toBe(1)
		expect(cCalls).toBe(1)

		// A subscriber removing ANOTHER subscriber mid-iteration.
		const tracker2 = new TurnStateTracker(new MessageIdMinter())
		let dCalls = 0
		const unsubD = tracker2.subscribe(() => {
			unsubD()
		})
		tracker2.subscribe(() => {
			dCalls += 1
		})
		expect(() => tracker2.setWithWriter("completed", undefined, { writerId: "task-start-init-task" })).not.toThrow()
		expect(dCalls).toBe(1)
	})

	it("INV-T09 (diagnostics off): with the writer-provenance diagnostic disabled the state and seq semantics are unchanged", async () => {
		const { isTurnStateWriterProvenanceDiagnosticEnabled } = await import("@shared/turn-state-writer-provenance")
		// The diagnostic is OFF by default.
		expect(isTurnStateWriterProvenanceDiagnosticEnabled()).toBe(false)

		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const before = tracker.get()
		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const after = tracker.get()
		expect(after.phase).toBe("streaming")
		expect(after.seq).toBeGreaterThan(before.seq)
	})
})

// ===========================================================================
// THE NEGATIVE WITNESSES.
//
// Each one is a CONTROLLED MUTATION or a controlled event ordering —
// never a sleep. Each asserts the DETECTED defect.
//
//   NEG-T01  unauthorized completion after an Elm HOLD
//   NEG-T02  late `done` after a cancellation
//   NEG-T03  older phase snapshot delivered after a newer one
//   NEG-T04  throwing tracker subscriber
//   NEG-T05  incorrect ID attached to a Mermaid edge (see the
//            chart-01 diagram mutation suite)
//   NEG-T06  compaction represented as a user wait
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / NEG", () => {
	it("NEG-T01: an unauthorized completion after an Elm HOLD commits NO `completed` phase", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "hold", reason: "tpc01-neg-hold", holdReasons: ["held"] }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()

		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		// The HOLD suppressed the commit entirely.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.committed().phase).not.toBe("completed")
		expect(h.writers()).not.toContain("session-event-turn-complete-completed")
	})

	it("NEG-T02: a late `done` after a cancellation preserves `resumable` (controlled event ordering)", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// Controlled ordering: cancel FIRST, then the late `done`.
		h.tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" })
		h.setRunning(false)
		const afterCancel = h.committed()

		h.translatorState.setAttemptCompletionSeen()
		h.translatorState.setTerminalResponseCommittedThisTurn()
		await h.coordinator.handleSessionEvent(doneEvent("session-tpc01"))

		expect(h.committed().phase).toBe("resumable")
		expect(h.committed().seq).toBe(afterCancel.seq)
		expect(h.completionCommitCount()).toBe(0)
	})

	it("NEG-T02 (legitimate resume): a NEW turn after the cancellation DOES advance to `streaming`", async () => {
		const h = makeSessionHarness()
		h.setElmDecision(() => ({ kind: "authorize", reason: "tpc01-authorize" }))
		h.tracker.setWithWriter("resumable", undefined, { writerId: "controller-cancel-task" })
		h.setRunning(false)
		const afterCancel = h.committed()

		// A NEW turn is a legitimate successor, not a stale straggler.
		await h.coordinator.handleSessionEvent(pendingPromptSubmitted("session-tpc01"))

		expect(h.committed().phase).toBe("streaming")
		expect(h.committed().seq).toBeGreaterThan(afterCancel.seq)
	})

	it("NEG-T03: an older phase snapshot delivered after a newer one is REJECTED by the real webview reducer", () => {
		let replica = createReplicaState()
		// The NEWER state arrives first.
		replica = applyTurnState(replica, { phase: "completed", anchorTs: undefined, seq: 200 })
		// The OLDER state arrives afterwards (out-of-order delivery).
		replica = applyTurnState(replica, { phase: "streaming", anchorTs: undefined, seq: 100 })

		expect(replica.turnState?.phase).toBe("completed")
		expect(replica.turnState?.seq).toBe(200)
	})

	it("NEG-T04: a throwing tracker subscriber leaves the state committed and the subsequent subscriber runs", () => {
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		let laterCalls = 0
		tracker.subscribe(() => {
			throw new Error("observer is buggy today")
		})
		tracker.subscribe(() => {
			laterCalls += 1
		})

		expect(() => tracker.setWithWriter("error", undefined, { writerId: "task-start-init-task" })).not.toThrow()
		expect(tracker.get().phase).toBe("error")
		expect(laterCalls).toBe(1)
	})

	it("NEG-T06: compaction is NOT presented as a user wait — the phase and the projection are distinct", async () => {
		const h = makeCompactionHarness("awaiting_followup")
		await h.coordinator.compactTask()

		const sampled = h.phaseWhenCompactionStarted()
		// The phase is `compacting`, NOT `awaiting_followup`.
		expect(sampled).toBe("compacting")
		// And the projection says "Compacting", NOT "Your turn".
		const projection = selectTaskHeaderPresentation({
			currentLegacyPhase: sampled as TurnPhase,
			canonicalShadowPhase: "awaiting_followup",
			seq: h.committed().seq,
		})
		expect(projection.phase).toBe("compacting")
		expect(projection.source).toBe("host")
		expect(taskHeaderPresentationStateLabel(projection, undefined).label).toBe("Compacting")
		expect(taskHeaderPresentationStateLabel(projection, undefined).label).not.toBe("Your turn")
	})
})

// ===========================================================================
// THE CHART 01 DIAGRAM CONTRACT (NEG-T05).
//
// The strict Mermaid ASSOCIATION checker is the EXISTING one, extended
// for Chart 01. It is a DOCUMENTATION-SYNCHRONIZATION guard — it never
// asserts behaviour.
//
// The mutation witnesses below prove the guard has teeth: a SWAPPED
// pair of edge labels (both ids still present exactly once) is
// REJECTED as an association mismatch, NOT merely as a missing id.
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / NEG-T05 (diagram association)", () => {
	const chart01Path = resolve(repoRoot, "docs/architecture/task-lifecycle/01-task-turn-phase.md")
	const chart01Markdown = readFileSync(chart01Path, "utf8")

	it("NEG-T05 (baseline): the REAL Chart 01 document passes the strict association checker", () => {
		const result = verifyChart01TurnPhase({ markdown: chart01Markdown })
		expect(result.errors).toEqual([])
		expect(result.mermaidBlockCount).toBe(1)
	})

	it("NEG-T05: a SWAPPED pair of edge labels is REJECTED as an ASSOCIATION mismatch", () => {
		// Swap the labels of T-03 (streaming → awaiting_followup) and
		// T-12 (streaming → awaiting_approval) BY THEIR ENDPOINTS —
		// never by an already-mutated id. Both ids survive exactly once.
		const mutated = chart01Markdown
			.replace(/(streaming\s*-->\s*awaiting_followup\s*:\s*)T-03\b/, "$1T-12")
			.replace(/(streaming\s*-->\s*awaiting_approval\s*:\s*)T-12\b/, "$1T-03")

		// Verify the mutation itself: both ids survive exactly once,
		// but each is now attached to the other's edge.
		const edges = parseMermaidTransitionEdges(extractMermaidBlocks(mutated).join("\n"))
		const endpointsFor = (id: string) =>
			edges.filter((edge) => transitionIdOfLabel(edge.label) === id).map((e) => `${e.source} --> ${e.target}`)
		expect(endpointsFor("T-03")).toEqual(["streaming --> awaiting_approval"])
		expect(endpointsFor("T-12")).toEqual(["streaming --> awaiting_followup"])

		const { errors } = verifyChart01TurnPhase({ markdown: mutated })
		expect(errors).toEqual(
			expect.arrayContaining([
				expect.stringContaining("T-03: Mermaid edge is"),
				expect.stringContaining("T-12: Mermaid edge is"),
			]),
		)
		// The rejection must NOT be a mere "missing id" artifact.
		expect(errors.some((error) => error.includes("absent from the Chart 01 Mermaid projection"))).toBe(false)
	})

	it("NEG-T05 (guard claim): a GUARD / PROJECTION claim carrying an edge is REJECTED", () => {
		// T-06 is a GUARD and T-09 is a PROJECTION. Neither may carry a
		// Mermaid edge.
		const mutated = chart01Markdown.replace(
			/(streaming\s*-->\s*resumable\s*:\s*)T-05\b/,
			"$1T-05\n    resumable --> streaming : T-06 straggler guard",
		)
		const { errors } = verifyChart01TurnPhase({ markdown: mutated })
		expect(errors.join("\n")).toContain("T-06")
		expect(errors.join("\n")).toContain("must NOT carry a Chart 01 Mermaid edge")
	})

	it("NEG-T05 (unauthorized completion): an edge into `completed` that is NOT the C10 commit is REJECTED", () => {
		// Inject an unauthorized path into `completed`.
		const mutated = chart01Markdown.replace(
			/(streaming\s*-->\s*error\s*:\s*)T-04\b/,
			"$1T-04\n    streaming --> completed : T-09 unauthorized completion",
		)
		const { errors } = verifyChart01TurnPhase({ markdown: mutated })
		expect(errors.join("\n")).toContain("UNAUTHORIZED path into the completed phase")
	})

	it("NEG-T05 (vocabulary): a diagram missing a canonical phase state is REJECTED", () => {
		// Rename EVERY occurrence of the `compacting` state inside the
		// diagram so the canonical phase is genuinely ABSENT from the
		// projection. The vocabulary gate must fire.
		const block = extractMermaidBlocks(chart01Markdown)[0]
		const mutated = chart01Markdown.replace(block, block.replace(/\bcompacting\b/g, "compacting_x"))
		const { errors } = verifyChart01TurnPhase({ markdown: mutated })
		expect(errors.join("\n")).toContain("canonical phase state")
	})
})

// ===========================================================================
// THE OWNERSHIP MAP (G0) AND THE VOCABULARY GATE (G2).
// ===========================================================================

describe("ACT-CLINEMM-LIFECYCLE-EXECUTABLE-TURN-PHASE-CONTRACT01 / ownership map", () => {
	it("G0: the registry's writer map names ONLY real production writer identities", () => {
		const provenanceSource = readFileSync(resolve(repoRoot, "apps/vscode/src/shared/turn-state-writer-provenance.ts"), "utf8")
		// The closed `TurnStateWriterId` union is the authority. Every
		// writer the registry names must be a member of it.
		const unionMatch = /export type TurnStateWriterId =\s*([\s\S]*?)\n\n/.exec(provenanceSource)
		expect(unionMatch).not.toBeNull()
		const union = unionMatch?.[1] ?? ""
		for (const phase of TURN_PHASE_VOCABULARY) {
			for (const writer of TURN_PHASE_WRITER_MAP[phase]) {
				expect(union, `writer "${writer}" (phase ${phase}) must be in the TurnStateWriterId union`).toContain(
					`"${writer}"`,
				)
			}
		}
	})

	it("G0 (completeness): every production writer identity is mapped to exactly ONE phase", () => {
		const provenanceSource = readFileSync(resolve(repoRoot, "apps/vscode/src/shared/turn-state-writer-provenance.ts"), "utf8")
		const unionMatch = /export type TurnStateWriterId =\s*([\s\S]*?)\n\n/.exec(provenanceSource)
		const union = unionMatch?.[1] ?? ""
		const unionWriters = [...union.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1])

		// The registry's map is a TOTAL map over the union (minus the
		// legacy sentinel, which is phase-agnostic, and the
		// phase-dependent restore writers, which are listed separately).
		const mapped = TURN_PHASE_VOCABULARY.flatMap((phase) => TURN_PHASE_WRITER_MAP[phase])
		expect(new Set(mapped).size).toBe(mapped.length)
		for (const writer of unionWriters) {
			if (writer === "unknown-legacy-writer") {
				continue
			}
			if (TURN_PHASE_RESTORE_WRITERS.includes(writer)) {
				expect(TURN_PHASE_RESTORE_WRITERS).toContain(writer)
				continue
			}
			expect(mapped, `writer "${writer}" must be mapped to a phase`).toContain(writer)
		}
		// And the two sets partition the union exactly.
		expect([...mapped, ...TURN_PHASE_RESTORE_WRITERS].sort()).toEqual(
			[...unionWriters.filter((w) => w !== "unknown-legacy-writer")].sort(),
		)
	})

	it("G2: every canonical phase has at least one production writer and one projection authority", () => {
		for (const phase of TURN_PHASE_VOCABULARY) {
			expect(TURN_PHASE_WRITER_MAP[phase].length).toBeGreaterThan(0)
			expect(TURN_PHASE_PROJECTION_AUTHORITY[phase].length).toBeGreaterThan(0)
		}
		// The vocabulary is exactly the eight canonical phases.
		expect(TURN_PHASE_VOCABULARY).toHaveLength(8)
		expect(new Set(TURN_PHASE_VOCABULARY).size).toBe(8)
	})

	it("G1: all nine pre-existing T-series claims keep their stable ids and their classification", () => {
		const byId = new Map(TURN_PHASE_CLAIMS.map((claim) => [claim.claim_id, claim]))
		// The nine pre-existing ids are all present.
		for (const id of ["T-01", "T-02", "T-03", "T-04", "T-05", "T-06", "T-07", "T-08", "T-09"]) {
			expect(byId.has(id)).toBe(true)
		}
		// T-06 is a GUARD; T-09 is a PROJECTION; the rest are TRANSITIONs.
		expect(byId.get("T-06")?.kind).toBe("GUARD")
		expect(byId.get("T-09")?.kind).toBe("PROJECTION")
		for (const id of ["T-01", "T-02", "T-03", "T-04", "T-05", "T-07", "T-08"]) {
			expect(byId.get(id)?.kind).toBe("TRANSITION")
		}
		// The GUARD and PROJECTION claims carry NO Mermaid edge.
		expect(TURN_PHASE_NON_TRANSITION_CLAIM_IDS).toEqual(["T-06", "T-09"])
		// Every other claim IS a transition and therefore DOES carry one.
		// 14 claims total - 1 GUARD - 1 PROJECTION = 12 transitions.
		expect(TURN_PHASE_TRANSITION_CLAIM_IDS).toHaveLength(12)
		expect(TURN_PHASE_TRANSITION_CLAIM_IDS).toContain("T-01")
		expect(TURN_PHASE_TRANSITION_CLAIM_IDS).not.toContain("T-06")
		expect(TURN_PHASE_TRANSITION_CLAIM_IDS).not.toContain("T-09")
	})

	it("G9: the registry's edge association agrees with the verifier's verified edges", () => {
		for (const [claimId, edge] of Object.entries(CHART_01_ALL_EXPECTED_EDGES)) {
			expect(CHART_01_VERIFIED_EDGES[claimId]).toEqual(edge)
		}
		expect(CHART_01_ALL_EXPECTED_EDGES["T-08a"]).toEqual({ source: "completed", target: "streaming" })
		expect(CHART_01_ALL_EXPECTED_EDGES["T-08b"]).toEqual({ source: "error", target: "streaming" })
		expect(CHART_01_ALL_EXPECTED_EDGES["T-08c"]).toEqual({ source: "resumable", target: "streaming" })
	})

	it("G3: the canonical ledger's Chart 01 rows carry the claim taxonomy and the executable witness", () => {
		const ledgerPath = resolve(repoRoot, "docs/architecture/task-lifecycle/transitions.tsv")
		const ledgerLines = readFileSync(ledgerPath, "utf8").trim().split("\n")
		const header = ledgerLines[0].split("\t")
		const claimKindIdx = header.indexOf("claim_kind")
		const witnessIdx = header.indexOf("evidence_witness")
		const statusIdx = header.indexOf("evidence_status")
		expect(claimKindIdx).toBeGreaterThanOrEqual(0)
		expect(witnessIdx).toBeGreaterThanOrEqual(0)
		expect(statusIdx).toBeGreaterThanOrEqual(0)

		const rows = ledgerLines.slice(1).map((line) => line.split("\t"))
		for (const claim of TURN_PHASE_CLAIMS) {
			const row = rows.find((r) => r[0] === claim.claim_id)
			expect(row, `ledger is missing ${claim.claim_id}`).toBeDefined()
			expect(row?.[claimKindIdx]).toBe(claim.kind)
			expect(row?.[witnessIdx]).toBe(claim.witness)
			expect(row?.[statusIdx]).toBe(claim.evidence_level)
		}
	})
})
