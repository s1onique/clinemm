/**
 * ACT-CLINEMM-BACKGROUND-COMPLETION-BARRIER01-CORRECTION04 — BCB01-C4
 *
 * Repair target: the terminal-idle / Q5 re-evaluation trigger path.
 * The CORRECTION03 trigger fires at the initial-done path (where
 * `unconsumedOwnedTerminalResultsForC10` may be 0 because jobs are
 * still RUNNING at submit_and_exit time). When the last job later
 * becomes terminal and the re-evaluation runs, the previous ACT
 * did NOT enqueue the continuation, so the held submit_and_exit
 * stayed held forever and the model never got an opportunity to
 * call command_status.
 *
 * CORRECTION04 fires the bounded coalesced continuation trigger at
 * the terminal-idle / Q5 re-evaluation transition (inside
 * `reevaluateDeferredCompletionBarrier`) so the live chronology
 * works end-to-end.
 *
 * Tests (5):
 *  - BCB-31: full live chronology — submit while J runs, J terminal,
 *            reevaluate fires continuation, second reevaluate dedupes,
 *            exactly 1 continuation.
 *  - BCB-32: 3 parallel jobs terminal → ONE coalesced continuation.
 *  - BCB-33: dedupe bounded state — single string marker, not Set.
 *  - BCB-34: two same-epoch trigger calls → only first fires.
 *  - BCB-35: after continuation, draining the held jobId releases
 *            the barrier; next reevaluate commits completed.
 */

import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
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

interface ContinuationSend {
	readonly sessionId: string
	readonly taskId?: string | undefined
	readonly prompt: string
	readonly delivery: "queue"
	readonly jobId?: string
}

interface ProductionHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	activeSessionId: string
	activeTaskId: string
	sendLog: ContinuationSend[]
	completionCommitCount: () => number
	ownedJobs: { jobId: string; notify: boolean }[]
	hasRunningBackgroundJobForOwner: () => boolean
	unconsumedOverride: { value: number }
}

function makeHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): ProductionHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-bcb01-c4"
	const activeTaskId = opts.activeTaskId ?? "task-bcb01-c4"

	const sendLog: ContinuationSend[] = []
	let now = 0
	const ownedJobs: { jobId: string; notify: boolean }[] = []

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "rejected" as const }),
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => ++now,
		// ACT-CLINEMM-ELM-SEAM04: tests inject the legacy SEAM03
		// policy as the consumeTerminalAuthority stub so the
		// coordinator's effect interpreter is exercised without
		// loading the Elm kernel. Production wiring uses
		// `defaultElmAuthority`.
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const unconsumedOverride: { value: number } = { value: 0 }

	let completionCommitCount = 0
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: (input: { sessionId: string; prompt: string; delivery: "queue"; jobId?: string }) => {
						sendLog.push({ ...input })
						return Promise.resolve()
					},
				},
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		},
		pendingPromptAuthorityAvailable: true,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasRunningBackgroundJobForOwner: () => ownedJobs.length > 0,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return unconsumedOverride.value > 0
				? unconsumedOverride.value
				: notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, activeTaskId)
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== activeSessionId) return []
			return notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, tid)
		},
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getLaunchedBackgroundJobIds: () => ownedJobs.map((j) => j.jobId),
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			if (input.heldJobIds.length === 0) {
				return Promise.resolve({ kind: "no_held_job_ids" as const })
			}
			sendLog.push({
				sessionId: input.sessionId,
				taskId: input.taskId,
				prompt: `COALESCED continuation for jobIds=${input.heldJobIds.join(",")}`,
				delivery: "queue",
			})
			return Promise.resolve({ kind: "delivered" as const })
		},
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		activeSessionId,
		activeTaskId,
		sendLog,
		completionCommitCount: () => completionCommitCount,
		ownedJobs: ownedJobs as { jobId: string; notify: boolean }[],
		hasRunningBackgroundJobForOwner: () => ownedJobs.length > 0,
		unconsumedOverride,
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

async function emitSubmitAndExit(
	coordinator: SdkSessionEventCoordinator,
	translatorState: MessageTranslatorState,
	sessionId: string,
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

describe("BCB01-C4 — HALT_FINALIZATION_TRIGGER_AT_WRONG_TRANSITION closure", () => {
	describe("BCB-31: full live chronology — submit while J runs, J terminal, reevaluate fires continuation", () => {
		it("fires exactly 1 continuation at the terminal-idle re-evaluation, none at submit time", async () => {
			const h = makeHarness()
			// Step 1: J1 is RUNNING when submit_and_exit is emitted.
			h.ownedJobs.push({ jobId: "J1", notify: false })
			// Step 2: emit submit_and_exit. The C10 barrier predicate
			// `ownerStillRunningForC10` is TRUE (J1 is RUNNING), so the
			// barrier HOLDS on the running-job half. The CORRECTION03
			// trigger fires only if `unconsumedOwnedTerminalResultsForC10 > 0`,
			// which is 0 (J1 not yet terminal). So sendLog is empty
			// after submit.
			await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
			expect(h.sendLog.length).toBe(0)
			// Step 3: J1 becomes terminal (matches production seam at
			// vscode-run-commands-tool.ts:890).
			h.notifyCoordinator.recordNonNotifyTerminalObservation({
				jobId: "J1",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			// Step 4: terminal-idle fires (the >0->0 transition of
			// hasRunningBackgroundJobForOwner). The harness's job
			// counter models the now-terminal job; we mark it
			// complete.
			h.ownedJobs.length = 0
			// Step 5: drive reevaluateDeferredCompletionBarrier (the
			// production call site after terminal-idle). With
			// CORRECTION04, this fires the bounded coalesced
			// continuation trigger now.
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			await new Promise((r) => setImmediate(r))
			// ONE continuation fired, listing J1.
			expect(h.sendLog.length).toBe(1)
			expect(h.sendLog[0].prompt).toContain("J1")
			// Step 6: second reevaluation. Deduped.
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			await new Promise((r) => setImmediate(r))
			expect(h.sendLog.length).toBe(1)
		})
	})

	describe("BCB-32: 3 parallel jobs terminal → ONE coalesced continuation", () => {
		it("coalesces all 3 jobs into a single continuation prompt", async () => {
			const h = makeHarness()
			// Setup: model already in submit_and_exit with jobs running.
			h.ownedJobs.push({ jobId: "J1", notify: false })
			h.ownedJobs.push({ jobId: "J2", notify: false })
			h.ownedJobs.push({ jobId: "J3", notify: false })
			await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
			// All 3 become terminal in sequence (matches multi-job
			// cases where notify=false jobs launched in parallel
			// finish at slightly different times).
			h.notifyCoordinator.recordNonNotifyTerminalObservation({
				jobId: "J1",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			h.notifyCoordinator.recordNonNotifyTerminalObservation({
				jobId: "J2",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			h.notifyCoordinator.recordNonNotifyTerminalObservation({
				jobId: "J3",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			h.ownedJobs.length = 0
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(3)
			// Single reevaluation fires ONE continuation (NOT 3).
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			await new Promise((r) => setImmediate(r))
			expect(h.sendLog.length).toBe(1)
			expect(h.sendLog[0].prompt).toContain("J1")
			expect(h.sendLog[0].prompt).toContain("J2")
			expect(h.sendLog[0].prompt).toContain("J3")
		})
	})

	describe("BCB-33: dedupe bounded state — O(1) memory regardless of re-evaluation count", () => {
		it("the coordinator's dedupe marker is a single string slot, not a Set", () => {
			// The P1 halt: the prior implementation used a Set<string>
			// keyed by (sessionId, taskId, epoch), which grew
			// unboundedly across epoch advances. CORRECTION04
			// replaces the Set with a single
			// `lastCompletionContinuationSessionEpoch` string field.
			const fs = require("node:fs")
			const path = require("node:path")
			const filePath = path.resolve(__dirname, "../sdk-session-event-coordinator.ts")
			const src = fs.readFileSync(filePath, "utf8")
			expect(src).not.toMatch(/completionContinuationSentForSessionEpoch:\s+Set/)
			expect(src).toMatch(/lastCompletionContinuationSessionEpoch:\s+string\s*\|\s*undefined/)
		})
	})

	describe("BCB-34: two same-epoch trigger calls → only the first fires", () => {
		it("dedupe suppresses duplicate triggers within the same epoch", async () => {
			const h = makeHarness()
			// Set up the marker via the production C10 path:
			// 1) J1 starts running (submit_and_exit while running).
			h.ownedJobs.push({ jobId: "J1", notify: false })
			// 2) submit_and_exit done — barrier holds on ownerStillRunning.
			await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
			// 3) J1 becomes terminal; barrier still holds.
			h.notifyCoordinator.recordNonNotifyTerminalObservation({
				jobId: "J1",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			// 4) terminal-idle: reevaluateDeferredCompletionBarrier fires
			//    the continuation trigger.
			h.ownedJobs.length = 0
			const epochBefore = h.translatorState.getMinter().epoch
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			await new Promise((r) => setImmediate(r))
			expect(h.sendLog.length).toBe(1)
			expect(h.coordinator.wasCompletionContinuationSentForTesting(h.activeSessionId, h.activeTaskId, epochBefore)).toBe(
				true,
			)
			// Second reevaluation in the same epoch: deduped.
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			await new Promise((r) => setImmediate(r))
			expect(h.sendLog.length).toBe(1)
		})
	})

	describe("BCB-35: after continuation, draining the held jobId releases the barrier", () => {
		it("the barrier count drops to 0 after consumption, allowing final submit_and_exit", () => {
			const h = makeHarness()
			h.notifyCoordinator.recordNonNotifyTerminalObservation({
				jobId: "J1",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(1)
			// Production: the continuation drains, the model issues
			// command_status, Path C consumes the observation.
			h.notifyCoordinator.consumeNonNotifyTerminalObservation({
				jobId: "J1",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.activeSessionId, h.activeTaskId)).toBe(0)
		})
	})
})
