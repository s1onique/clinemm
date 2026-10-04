/**
 * ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01-CORRECTION01-PRECHECK-LIVENESS
 *
 * LIVE-shaped test suite. Reproduces the LIVE-proven gap that the
 * prior POSTRUN test suite (5/5 GREEN) could NOT cover, because the
 * prior tests used `getUnconsumedOwnedTerminalResultCount: () => 0`
 * and so never exercised the second-conjunct (BCB01 §0.1
 * `unconsumed_owned_terminal_results == 0`) guard at
 * sdk-session-event-coordinator.ts:821-822 and the early-return at
 * L848-874 inside `reevaluateDeferredCompletionBarrier`.
 *
 * Tests:
 *   PCRL-01 - LIVE-shaped blocker classification
 *   PCRL-02 - clean state still releases (POSTRUN conservation)
 *   PCRL-03 - dedupe reset between submit and agent_turn_done allows a second consult
 *   PCRL-04 - repeated reevaluation is idempotent on dedupe
 *   PCRL-05 - precheck is legitimate (no second Elm consult under terminal obligation)
 */
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	getElmAuthorityCounters,
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
	readonly continuationSendLog: ReadonlyArray<{ sessionId: string; heldJobIds: readonly string[] }>
}

interface HarnessInternals {
	__setUnconsumed: (n: number) => void
}

function makeHarness(opts: { activeSessionId: string; activeTaskId: string }): Harness & HarnessInternals {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)

	const continuationSendLog: Array<{ sessionId: string; heldJobIds: readonly string[] }> = []
	let nowCounter = 0

	const _notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: opts.activeSessionId, taskId: opts.activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found", jobId: "" }),
		now: () => ++nowCounter,
	})

	let commitCount = 0
	let lastPhase = "idle"
	// LIVE-shaped: defaults to 1 to mirror the frozen LIVE specimen.
	let unconsumed = 1
	const unconsumedJobIds = ["cmd_muuew7yq3gbi7raf"]

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: opts.activeSessionId,
				sdkHost: {
					send: (_input: { sessionId: string; prompt: string; delivery: "queue"; jobId?: string }) => {
						return Promise.resolve()
					},
				} as never,
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
		getUnconsumedOwnedTerminalResultCount: () => unconsumed,
		getUnconsumedOwnedTerminalJobIds: () => (unconsumed > 0 ? unconsumedJobIds : []),
		getPendingPromptCount: () => ({ available: true, count: 0 }) as PendingPromptCountRead,
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchFailed: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			continuationSendLog.push({ sessionId: input.sessionId, heldJobIds: input.heldJobIds })
			return Promise.resolve({ kind: "delivered" as const })
		},
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
		continuationSendLog,
		__setUnconsumed: (n: number) => {
			unconsumed = n
		},
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

async function emitAgentTurnDone(coordinator: SdkSessionEventCoordinator, sessionId: string, runId: string): Promise<void> {
	await enqueueElmAuthorityRecord({
		stage: "agent_turn_done",
		sessionId,
		runId,
	})
	await coordinator.notifyAgentTurnDone(sessionId)
}

describe("ACT-CLINEMM-COMPLETION-AUTHORITY-POST-RUN-REEVALUATION01-CORRECTION01-PRECHECK-LIVENESS", () => {
	describe("PCRL-01 - LIVE-shaped blocker classification", () => {
		it("at submit: BCB clears AND Elm consult #1 returns HOLD (active_run). At agent_turn_done: unconsumed count > 0; reevaluation returns at the unconsumed-terminal guard, no second consult, dedupe consumed by initial-dispatch", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				activeSessionId: "session-pcrl01-live-shaped",
				activeTaskId: "task-pcrl01-live-shaped",
			})

			await enqueueElmAuthorityRecord({
				stage: "task_started",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			await enqueueElmAuthorityRecord({
				stage: "run_turn_started",
				sessionId: h.activeSessionId,
				runId: "run-kYcP208W",
				origin: "explicit_user",
			})

			// LIVE-shaped: at submit_and_exit_seen time, the unconsumed
			// terminal result had not yet entered the unconsumed counter
			// (or was consumed implicitly via the wake-driven turn path).
			// The BCB barrier clears, Elm consult #1 fires, returns
			// HOLD(active_run). `hold = 1`, `total = 1`.
			h.__setUnconsumed(0)
			await emitCompletionTurn(h.coordinator, h.activeSessionId, h.translatorState)
			expect(h.completionCommitCount()).toBe(0)
			const countersAfterHold = getElmAuthorityCounters()
			expect(countersAfterHold.hold).toBeGreaterThanOrEqual(1)
			expect(countersAfterHold.lastDecision).toBe("hold")
			expect(countersAfterHold.total).toBeGreaterThanOrEqual(1)

			// The initial-dispatch continuation enqueue at L1616 was
			// not fired here because unconsumedOwnedTerminalResultsForC10
			// was 0 at submit time. So no continuationSendLog entry.
			expect(h.continuationSendLog.length).toBe(0)

			// After submit_and_exit_seen, but BEFORE agent_turn_done,
			// the terminal result becomes unconsumed (mirroring the
			// LIVE chronology: terminal_committed was seq 4, but the
			// unconsumed counter only registered as > 0 in the
			// post-submit window, after the BCB barrier had already
			// fired its initial-dispatch HOLD).
			h.__setUnconsumed(1)

			await emitAgentTurnDone(h.coordinator, h.activeSessionId, "run-kYcP208W")

			// FIRST_DIVERGENCE: reevaluation hits the unconsumed-terminal
			// guard at L848 and returns BEFORE checkElmCompletionAuthority.
			// The continuation enqueue at L855 fires (dedupe is fresh
			// because the initial-dispatch path did NOT fire earlier
			// under this unconsumed state). But no second Elm consult.
			const countersAfter = getElmAuthorityCounters()
			expect(countersAfter.authorize).toBe(0)
			expect(countersAfter.total).toBe(countersAfterHold.total)
			expect(countersAfter.lastDecision).toBe("authorize") // agent_turn_done advanced Elm
			expect(h.completionCommitCount()).toBe(0)
			expect(h.phaseAtCompletion()).not.toBe("completed")
			// The post-run reevaluation's continuation enqueue fires
			// (dedupe was not consumed at submit because unconsumed was 0).
			expect(h.continuationSendLog.length).toBe(1)
		}, 20_000)
	})

	describe("PCRL-02 - clean state still releases (POSTRUN conservation)", () => {
		it("with no terminal result: post-run reevaluation drives one commit", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				activeSessionId: "session-pcrl02-clean",
				activeTaskId: "task-pcrl02-clean",
			})
			h.__setUnconsumed(0)

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
			const countersAfterHold = getElmAuthorityCounters()
			expect(countersAfterHold.lastDecision).toBe("hold")

			await emitAgentTurnDone(h.coordinator, h.activeSessionId, "run-1")

			expect(h.completionCommitCount()).toBe(1)
			expect(h.phaseAtCompletion()).toBe("completed")
			const countersAfter = getElmAuthorityCounters()
			expect(countersAfter.authorize).toBeGreaterThanOrEqual(1)
			expect(countersAfter.lastDecision).toBe("authorize")
		}, 20_000)
	})

	describe("PCRL-03 - dedupe reset allows a second consult after unconsumed clears", () => {
		it("clearing the unconsumed count BEFORE agent_turn_done triggers commit", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				activeSessionId: "session-pcrl03-dedupe-reset",
				activeTaskId: "task-pcrl03-dedupe-reset",
			})
			h.__setUnconsumed(1)

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
			expect(h.continuationSendLog.length).toBe(1)

			// Mirror the BCB happy path: unconsumed count dropped to 0
			// (the held terminal fact was observed by the model).
			h.__setUnconsumed(0)

			await emitAgentTurnDone(h.coordinator, h.activeSessionId, "run-1")

			expect(h.completionCommitCount()).toBe(1)
			expect(h.phaseAtCompletion()).toBe("completed")
			const countersAfter = getElmAuthorityCounters()
			expect(countersAfter.authorize).toBeGreaterThanOrEqual(1)
			expect(countersAfter.lastDecision).toBe("authorize")
		}, 20_000)
	})

	describe("PCRL-04 - repeated reevaluation is idempotent on dedupe", () => {
		it("two notifyAgentTurnDone calls in a row do not double-fire enqueue", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				activeSessionId: "session-pcrl04-idempotent",
				activeTaskId: "task-pcrl04-idempotent",
			})
			h.__setUnconsumed(1)

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
			expect(h.continuationSendLog.length).toBe(1)

			await emitAgentTurnDone(h.coordinator, h.activeSessionId, "run-1")
			expect(h.continuationSendLog.length).toBe(1)

			await emitAgentTurnDone(h.coordinator, h.activeSessionId, "run-1")
			expect(h.continuationSendLog.length).toBe(1)
			expect(h.completionCommitCount()).toBe(0)
		}, 20_000)
	})

	describe("PCRL-05 - precheck is legitimate (no second Elm consult under terminal obligation)", () => {
		it("does not call checkElmCompletionAuthority while unconsumed count is positive", async () => {
			setElmAuthorityProvider(REAL_KERNEL_PATH)
			const h = makeHarness({
				activeSessionId: "session-pcrl05-precheck-legit",
				activeTaskId: "task-pcrl05-precheck-legit",
			})
			h.__setUnconsumed(1)

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
			const totalAtHold = countersAtHold.total
			const authorizeAtHold = countersAtHold.authorize

			await h.coordinator.reevaluateDeferredCompletionBarrier()

			const countersAfter = getElmAuthorityCounters()
			expect(countersAfter.total).toBe(totalAtHold)
			expect(countersAfter.authorize).toBe(authorizeAtHold)
			expect(h.completionCommitCount()).toBe(0)
		}, 20_000)
	})
})
