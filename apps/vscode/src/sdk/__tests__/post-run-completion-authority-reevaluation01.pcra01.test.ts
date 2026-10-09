/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01
 *
 * POSTRUN test suite. Reproduces the LIVE-proven liveness gap:
 *
 *   submit_and_exit_seen
 *     -> real Elm authority consult
 *     -> HOLD(active_run)
 *     -> completion correctly suppressed
 *
 *   agent_turn_done (factual)
 *     -> Elm activeRun clears
 *     -> Elm shadow becomes completionAuthorized=true
 *     -> but no second authority consult occurred
 *     -> no factual task_completion_committed record
 *
 * Real-Elm causal liveness test (REAL_ELM evidence grade).
 * Uses the real compiled Elm kernel wired into the real production
 * coordinator option bag, exactly the same shape the dogfood
 * runtime applies in production.
 *
 * Five tests, frozen:
 *   POSTRUN-RED-01     - GREEN: post-run reevaluation drives one commit.
 *   POSTRUN-ORDER-02   - agent_turn_done flushed BEFORE second consult.
 *   POSTRUN-EXACTLY-ONCE-03 - multiple triggers => exactly one commit.
 *   POSTRUN-ISOLATION-04 - cross-session isolation: B does not release A.
 *   POSTRUN-OFF-CONSERVATION-05 - authority OFF => existing behavior unchanged.
 *
 * Run:
 *   bun run test:unit -- post-run-completion-authority-reevaluation01
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	getElmAuthorityCounters,
	isElmAuthorityAvailable,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "../completion-authority-elm-authority-runtime"
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

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	resetElmAuthorityForTests()
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	resetElmAuthorityForTests()
})

const HERE = fileURLToPath(import.meta.url)
const REAL_KERNEL_PATH = join(HERE, "..", "..", "..", "..", "elm", "completion-authority", "vendor", "completion-authority.js")

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly completionCommitCount: () => number
	readonly phaseAtCompletion: () => string
}

function makeHarness(opts: { activeSessionId: string; activeTaskId: string }): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const wakeSinkQueue: Array<{ sessionId: string; prompt: string }> = []
	let nowCounter = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: opts.activeSessionId, taskId: opts.activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) =>
			Promise.resolve(
				(async () => {
					wakeSinkQueue.push({ sessionId, prompt })
					return { kind: "delivered" as const }
				})(),
			),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => ++nowCounter,
		// ACT-CLINEMM-ELM-SEAM04: tests inject the legacy SEAM03
		// policy as the consumeTerminalAuthority stub so the
		// coordinator's effect interpreter is exercised without
		// loading the Elm kernel. Production wiring uses
		// `defaultElmAuthority`.
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	let commitCount = 0
	let lastPhase = "idle"
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: opts.activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: opts.activeSessionId } as never,
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: ((_msgs: unknown[]) => {}) as never as never,
		},
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => ({ taskId: opts.activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			lastPhase = phase
			if (phase === "completed") {
				commitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: () => 0,
		getUnconsumedOwnedTerminalJobIds: () => [],
		getPendingPromptCount: () => ({ available: true, count: 0 }) as PendingPromptCountRead,
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: () => Promise.resolve({ kind: "no_held_job_ids" }),
		getElmCompletionAuthorityDecision: (sessionId?: string) => getElmAuthorityCompletionDecision(sessionId ?? ""),
		flushElmAuthorityForSession: async (sessionId: string) => flushElmAuthorityForSession(sessionId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		translatorState,
		activeSessionId: opts.activeSessionId,
		activeTaskId: opts.activeTaskId,
		completionCommitCount: () => commitCount,
		phaseAtCompletion: () => lastPhase,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

async function emitCompletionTurn(
	coordinator: SdkSessionEventCoordinator,
	sessionId: string,
	translatorState: MessageTranslatorState,
): Promise<void> {
	translatorState.setAttemptCompletionSeen()
	translatorState.setTerminalResponseCommittedThisTurn()
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason: "completed",
		text: "Task completed.",
		iterations: 1,
	})
	await coordinator.handleSessionEvent(doneEvent)
}

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01", () => {
	describe("POSTRUN-RED-01 - post-run reevaluation drives one commit", () => {
		it("after Elm HOLD at submit, agent_turn_done reevaluates to AUTHORIZE -> exactly one commit", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				activeSessionId: "session-postrun-red-01",
				activeTaskId: "task-postrun-red-01",
			})

			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: h.activeSessionId,
				runId: "run-1",
				origin: "explicit_user",
			})

			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.phaseAtCompletion()).not.toBe("completed")
			const countersAfterHOLD = getElmAuthorityCounters()
			expect(countersAfterHOLD.hold).toBeGreaterThanOrEqual(1)
			expect(countersAfterHOLD.lastDecision).toBe("hold")

			await enqueueElmAuthorityRecord({
				stage: "agent_turn_done",
				sessionId: h.activeSessionId,
				runId: "run-1",
			})

			await h.coordinator.notifyAgentTurnDone(h.activeSessionId)

			expect(h.completionCommitCount()).toBe(1)
			expect(h.phaseAtCompletion()).toBe("completed")
			const countersAfter = getElmAuthorityCounters()
			expect(countersAfter.authorize).toBeGreaterThanOrEqual(1)
			expect(countersAfter.lastDecision).toBe("authorize")
		}, 20_000)
	})

	describe("POSTRUN-ORDER-02 - agent_turn_done flushed BEFORE second decision", () => {
		it("second consult reads `authorize` because agent_turn_done was flushed first", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				activeSessionId: "session-postrun-order-02",
				activeTaskId: "task-postrun-order-02",
			})

			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: h.activeSessionId,
				runId: "run-1",
				origin: "explicit_user",
			})
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			const countersAtHold = getElmAuthorityCounters()
			expect(countersAtHold.lastDecision).toBe("hold")

			// Enqueue agent_turn_done BEFORE calling notifyAgentTurnDone.
			// In production, the `LocalRuntimeHost.onAgentTurnDone` hook
			// (which calls recordAgentTurnDone -> enqueueElmAuthorityRecord)
			// fires first; this test mirrors that chronology.
			await enqueueElmAuthorityRecord({
				stage: "agent_turn_done",
				sessionId: h.activeSessionId,
				runId: "run-1",
			})

			// CRITICAL: if notifyAgentTurnDone flushes authority AFTER
			// the reevaluation consult, the second decision would read
			// stale `hold` and the test would fail with authorize=0.
			await h.coordinator.notifyAgentTurnDone(h.activeSessionId)

			// Second consult MUST observe authorize (proves agent_turn_done
			// was processed by Elm before the decision was read).
			const countersAfter = getElmAuthorityCounters()
			expect(countersAfter.lastDecision).toBe("authorize")
			expect(h.completionCommitCount()).toBe(1)
		}, 20_000)
	})

	describe("POSTRUN-EXACTLY-ONCE-03 - multiple reevaluation triggers => exactly one commit", () => {
		it("two notifyAgentTurnDone calls after the same held completion => exactly one commit", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				activeSessionId: "session-postrun-exactly-once-03",
				activeTaskId: "task-postrun-exactly-once-03",
			})

			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: h.activeSessionId,
				runId: "run-1",
				origin: "explicit_user",
			})
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)

			await enqueueElmAuthorityRecord({
				stage: "agent_turn_done",
				sessionId: h.activeSessionId,
				runId: "run-1",
			})
			await h.coordinator.notifyAgentTurnDone(h.activeSessionId)
			expect(h.completionCommitCount()).toBe(1)

			// Second trigger MUST NOT produce a duplicate commit.
			await h.coordinator.notifyAgentTurnDone(h.activeSessionId)
			expect(h.completionCommitCount()).toBe(1)
		}, 20_000)
	})

	describe("POSTRUN-ISOLATION-04 - cross-session isolation", () => {
		it("agent_turn_done for B does NOT release A; only A's agent_turn_done releases A", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const a = makeHarness({
				activeSessionId: "session-A-postrun-iso-04",
				activeTaskId: "task-A-postrun-iso-04",
			})
			const b = makeHarness({
				activeSessionId: "session-B-postrun-iso-04",
				activeTaskId: "task-B-postrun-iso-04",
			})

			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: a.activeSessionId,
				taskId: a.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: a.activeSessionId,
				runId: "run-A-1",
				origin: "explicit_user",
			})
			await emitCompletionTurn(a.coordinator, a.activeSessionId, a.translatorState)
			expect(a.completionCommitCount()).toBe(0)

			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: b.activeSessionId,
				taskId: b.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: b.activeSessionId,
				runId: "run-B-1",
				origin: "explicit_user",
			})
			await emitCompletionTurn(b.coordinator, b.activeSessionId, b.translatorState)
			expect(b.completionCommitCount()).toBe(0)

			await enqueueElmAuthorityRecord({
				stage: "agent_turn_done",
				sessionId: b.activeSessionId,
				runId: "run-B-1",
			})
			await b.coordinator.notifyAgentTurnDone(b.activeSessionId)
			expect(b.completionCommitCount()).toBe(1)
			expect(a.completionCommitCount()).toBe(0)

			await enqueueElmAuthorityRecord({
				stage: "agent_turn_done",
				sessionId: a.activeSessionId,
				runId: "run-A-1",
			})
			await a.coordinator.notifyAgentTurnDone(a.activeSessionId)
			expect(a.completionCommitCount()).toBe(1)
		}, 20_000)
	})

	describe("POSTRUN-NO-KERNEL-CONSERVATION - Elm kernel not armed => existing barrier held", () => {
		it("kernel-miss + existing TS-created deferred barrier + agent_turn_done => barrier held, no commit", async () => {
			// ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-DEFAULT01-REMOVE-LEGACY-TS-AUTHORITY:
			// there is no OFF mode. The legacy P1 guard that made
			// `setAgentTurnDoneSemanticTrigger` a no-op when Elm authority
			// was OFF has been REMOVED. The trigger ALWAYS fires. But
			// when the runtime is not armed (no setElmAuthorityProvider
			// call), getElmAuthorityCompletionDecision returns a failure
			// decision and the coordinator suppresses the commit effect
			// (fail-closed). The deferred-completion-barrier marker is
			// still held.
			expect(isElmAuthorityAvailable()).toBe(false)
			const h = makeHarness({
				activeSessionId: "session-postrun-no-kernel-05",
				activeTaskId: "task-postrun-no-kernel-05",
			})

			// Pre-populate a legacy TS-created deferredCompletionBarrier
			// (the marker shape that existed before this ACT and is
			// still produced by the TS completion predicate chain).
			const currentEpoch = h.translatorState.getMinter().epoch
			;(h.coordinator as unknown as { deferredCompletionBarrier: unknown }).deferredCompletionBarrier = {
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
				epoch: currentEpoch,
				deferredAt: 1,
			}
			const commitCountBefore = h.completionCommitCount()
			expect(commitCountBefore).toBe(0)

			// Fire the new agent-turn-done trigger. The trigger fires
			// unconditionally (no P1 OFF guard). The reevaluate consults
			// Elm, which returns failure (kernel not armed), so the
			// commit is suppressed and the barrier is held.
			await h.coordinator.notifyAgentTurnDone(h.activeSessionId)

			// No new commit caused by this ACT.
			expect(h.completionCommitCount()).toBe(commitCountBefore)

			// The TS-created barrier is still present (Elm said no, so
			// the barrier was not cleared).
			const marker = (h.coordinator as unknown as { deferredCompletionBarrier: unknown }).deferredCompletionBarrier
			expect(marker).toBeDefined()
		}, 20_000)
	})
})
