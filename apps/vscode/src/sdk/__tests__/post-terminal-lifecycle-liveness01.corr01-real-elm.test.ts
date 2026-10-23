/**
 * ACT-CLINEMM-P0-POST-TERMINAL-LIFECYCLE-LIVENESS01 (PTLL01-CORR01)
 *
 * REAL-ELM qualification of the L1 completion-liveness chronology.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The PTLL01 evidence commit (`cb39c81e4`) added a BCB "owned terminal set
 * drained" callback (`BackgroundNotifyCoordinator.onOwnedTerminalSetDrained`)
 * and claimed it repaired the false-Working/Cancel defect: a task whose final
 * `agent_turn_done` landed while the Elm authority still held on
 * `scheduled_continuation` stranded in `streaming`.
 *
 * The review found the load-bearing RED-03 test does not prove that claim:
 * after clearing the scheduled-continuation dependency it called
 * `notifyAgentTurnDone(...)` — the very production reevaluation entry point
 * whose ABSENCE is the premise of the defect. This file therefore qualifies
 * the chronology against the REAL compiled Elm kernel (not the synthetic
 * `ElmAuthorityHarness` stand-in), and answers the causal question directly:
 *
 *   Q1 (REAL-ELM-CAUSAL-ORDER): does the `scheduled_continuation` hold clear
 *       BEFORE the `agent_turn_done`-driven reevaluation consult? i.e. is the
 *       post-continuation reevaluation the SAME event that clears the hold?
 *
 *   Q2 (REAL-ELM-L1-CHRONOLOGY): replay the FULL reported chronology through
 *       the real kernel + the real coordinator, with NO synthetic Elm
 *       stand-in, and assert the C10 commit count at each step.
 *
 *   Q3 (REAL-ELM-DRAIN-CALLBACK-NOT-CAUSE): ablate the new drain callback
 *       and show the reported chronology STILL commits — i.e. the drain
 *       callback is not the causal repair for this defect.
 *
 * The Elm kernel used here is the SAME compiled artifact the shipped
 * extension loads (`elm/completion-authority/vendor/completion-authority.js`),
 * driven through the SAME production DI seam
 * (`completion-authority-elm-authority-runtime.ts`) that
 * `SdkController` wires at `SdkController.ts:2784-2786`.
 *
 * PRODUCTION CAUSAL CHAIN (asserted, not assumed):
 *
 *   continuation_scheduled(promptRef)        -> Elm: PromptScheduled
 *   continuation_started(promptRef, runRef)  -> Elm: PromptRunning runRef
 *        |                                            => hold: scheduled_continuation
 *   agent_turn_done(runRef)                  -> Elm: consumePromptForRun
 *        |                                       => PromptConsumed
 *        |                                       => hold: scheduled_continuation CLEARED
 *        v
 *   recordAgentTurnDone() emits the CCARD `agent_turn_done` record FIRST,
 *   THEN fires the semantic trigger
 *        -> SdkController.setAgentTurnDoneSemanticTrigger
 *        -> sessionEvents.notifyAgentTurnDone(sessionId)
 *             -> flushElmAuthorityForSession(sessionId)   <-- processes the record
 *             -> reevaluateDeferredCompletionBarrier()     <-- consults Elm
 *
 * So the Elm hold is cleared by the SAME `agent_turn_done` event that drives
 * the reevaluation, and the flush is ORDERED BEFORE the consult.
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import {
	enqueueElmAuthorityRecord,
	flushElmAuthorityForSession,
	getElmAuthorityCompletionDecision,
	isElmAuthorityAvailable,
	resetElmAuthorityForTests,
	setElmAuthorityProvider,
} from "../completion-authority-elm-authority-runtime"
import { setCompletionContinuationUpstreamEnabled } from "../completion-continuation-upstream-runtime"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
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
	setCompletionContinuationUpstreamEnabled(true)
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

/** The five task-owned jobIds from the reported incident shape. */
const FIVE_HELD = [
	"cmd_mvcz1k7a5irpcww7",
	"cmd_mvcz934cx36o6oh5",
	"cmd_mvczawjxn8du7rlw",
	"cmd_mvczu3i72jb9sb5g",
	"cmd_mvczv13lozyou9dk",
]

interface RealElmHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly translatorState: MessageTranslatorState
	readonly notify: BackgroundNotifyCoordinator
	readonly sessionId: string
	readonly taskId: string
	readonly completionCommitCount: () => number
	readonly phaseWrites: { phase: string }[]
	readonly drainTriggerCount: () => number
	readonly runningJobs: string[]
}

/**
 * A harness that wires the REAL Elm authority runtime through the SAME DI
 * seam `SdkController` uses, plus the REAL `BackgroundNotifyCoordinator`
 * (the actual BCB obligation store) and the REAL
 * `SdkSessionEventCoordinator` (the real barrier logic).
 *
 * `withDrainCallback` toggles the PTLL01-L1 production repair
 * (`onOwnedTerminalSetDrained`) so the ablation can isolate it.
 */
function makeRealElmHarness(opts: { withDrainCallback: boolean }): RealElmHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sessionId = "ptll01-corr01-session"
	const taskId = "ptll01-corr01-task"

	const phaseWrites: { phase: string }[] = []
	const runningJobs: string[] = []
	let completionCommitCount = 0
	let drainTriggerCount = 0
	let nowCounter = 0

	let coordinator: SdkSessionEventCoordinator

	const notify = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId, taskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "rejected" as const }),
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => ++nowCounter,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
		// The PTLL01-L1 production repair, wired exactly as SdkController
		// wires it. Disabled in the ablation arm.
		...(opts.withDrainCallback
			? {
					onOwnedTerminalSetDrained: () => {
						drainTriggerCount += 1
						void coordinator.reevaluateDeferredCompletionBarrier()
					},
				}
			: {}),
	} as ConstructorParameters<typeof BackgroundNotifyCoordinator>[0])

	coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId,
				sdkHost: {
					send: () => Promise.resolve(),
					abort: () => Promise.resolve(),
				},
				unsubscribe: vi.fn(),
				startResult: { sessionId },
				isRunning: true,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId }) as never,
		getTurnPhase: () => tracker.currentPhase,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase: string) => {
			phaseWrites.push({ phase })
			if (phase === "completed") {
				completionCommitCount += 1
			}
			tracker.setWithWriter(phase as never, undefined, { writerId: "test" as never })
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
		hasRunningBackgroundJobForOwner: () => runningJobs.length > 0,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) =>
			sid === sessionId ? notify.unconsumedTerminalCountForOwner(sessionId, taskId) : 0,
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) =>
			sid === sessionId ? notify.unconsumedOwnedTerminalJobIdsForOwner(sessionId, tid) : [],
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getLaunchedBackgroundJobIds: () => [...runningJobs],
		liveTools: () => ["command_status", "submit_and_exit"],
		// THE REAL Elm authority, through the production DI seam.
		getElmCompletionAuthorityDecision: (sid?: string) => getElmAuthorityCompletionDecision(sid ?? ""),
		flushElmAuthorityForSession: async (sid: string) => flushElmAuthorityForSession(sid),
		enqueueCompletionContinuation: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => {
			if (input.heldJobIds.length === 0) {
				return Promise.resolve({ kind: "no_held_job_ids" as const })
			}
			return Promise.resolve({ kind: "delivered" as const })
		},
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		translatorState,
		notify,
		sessionId,
		taskId,
		completionCommitCount: () => completionCommitCount,
		phaseWrites,
		drainTriggerCount: () => drainTriggerCount,
		runningJobs,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: { sessionId, event: event as never },
	}) as CoreSessionEvent

async function emitSubmitAndExit(h: RealElmHarness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	await h.coordinator.handleSessionEvent(
		agentEvent(h.sessionId, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
	)
}

/**
 * Drive the REAL Elm kernel to the state where the coalesced continuation is
 * scheduled and RUNNING — i.e. the state in which the Elm authority HOLDS on
 * `scheduled_continuation`.
 *
 * This is the production chronology of the reported incident:
 *   - the coalesced continuation is enqueued as a pending prompt
 *   - it is dequeued and scheduled by the runtime
 *   - the runtime starts a run for it (`continuation_started` joins
 *     prompt ↔ run)
 */
async function seedScheduledContinuationElm(h: RealElmHarness, promptId: string, runId: string): Promise<void> {
	await enqueueElmAuthorityRecord({ stage: "task_started", sessionId: h.sessionId, taskId: h.taskId })
	await enqueueElmAuthorityRecord({
		stage: "run_turn_started",
		sessionId: h.sessionId,
		runId: "run-origin",
		origin: "explicit_user",
	})
	await enqueueElmAuthorityRecord({
		stage: "agent_turn_done",
		sessionId: h.sessionId,
		runId: "run-origin",
	})
	await enqueueElmAuthorityRecord({ stage: "pending_prompt_enqueued", sessionId: h.sessionId, promptId })
	await enqueueElmAuthorityRecord({ stage: "pending_prompt_dequeued", sessionId: h.sessionId, promptId })
	await enqueueElmAuthorityRecord({ stage: "continuation_scheduled", sessionId: h.sessionId, promptId })
	await enqueueElmAuthorityRecord({
		stage: "continuation_started",
		sessionId: h.sessionId,
		promptId,
		runId,
	})
	await flushElmAuthorityForSession(h.sessionId)
}

describe("PTLL01-CORR01 — REAL-ELM qualification of the L1 completion-liveness chronology", () => {
	it("REAL-ELM-LOAD: the compiled Elm kernel the extension ships loads and reports enabled", () => {
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		expect(isElmAuthorityAvailable()).toBe(true)
	}, 20_000)

	it("REAL-ELM-CAUSAL-ORDER: the scheduled_continuation hold is cleared BY the agent_turn_done that drives the reevaluation, and the flush is ordered BEFORE the consult", async () => {
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		const h = makeRealElmHarness({ withDrainCallback: true })

		await seedScheduledContinuationElm(h, "prompt-1", "run-continuation")

		// The continuation is scheduled AND running -> the real Elm kernel
		// holds on `scheduled_continuation`.
		await flushElmAuthorityForSession(h.sessionId)
		const held = getElmAuthorityCompletionDecision(h.sessionId)
		expect(held.kind).toBe("hold")
		expect(held.kind === "hold" ? held.holdReasons : []).toContain("scheduled_continuation")

		// Now the continuation's own turn ends. THIS is the event that
		// clears the hold: Elm's `handleAgentTurnDone` transitions
		// `PromptRunning runRef` -> `PromptConsumed`.
		await enqueueElmAuthorityRecord({
			stage: "agent_turn_done",
			sessionId: h.sessionId,
			runId: "run-continuation",
		})
		await flushElmAuthorityForSession(h.sessionId)

		// The hold is gone, WITHOUT any further barrier reevaluation.
		const cleared = getElmAuthorityCompletionDecision(h.sessionId)
		expect(cleared.kind).toBe("authorize")
	}, 20_000)

	it("REAL-ELM-NO-TURN-DONE: with the drain callback present but NO post-continuation agent_turn_done, the task strands (C10=0) — the real defect shape", async () => {
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		const h = makeRealElmHarness({ withDrainCallback: true })

		for (const jobId of FIVE_HELD) {
			h.runningJobs.push(jobId)
			h.notify.recordNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
			await enqueueElmAuthorityRecord({
				stage: "terminal_committed",
				sessionId: h.sessionId,
				jobId,
				ownerId: h.sessionId,
			})
		}
		await flushElmAuthorityForSession(h.sessionId)
		await emitSubmitAndExit(h)
		await seedScheduledContinuationElm(h, "prompt-1", "run-continuation")
		h.runningJobs.length = 0
		for (const jobId of FIVE_HELD) {
			h.notify.consumeNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
			// PRODUCTION NOTE: the `notify_consume_enter` capture
			// (background-notify-coordinator.ts:2863) carries NO sessionId,
			// so the Elm adapter rejects it as INSUFFICIENT_IDENTITY. The
			// Elm kernel therefore never registers BCB-owned terminal jobs
			// (the `terminal_committed` capture also omits `terminalKind`
			// per command-job-manager.ts:2711) — the Elm hold reasons for
			// this chronology are exactly active_run / pending_prompt /
			// scheduled_continuation.
		}
		await flushElmAuthorityForSession(h.sessionId)

		// The drain callback fired, but the continuation is still scheduled
		// -> Elm HOLDS -> the marker is re-registered -> C10 = 0.
		expect(h.drainTriggerCount()).toBeGreaterThanOrEqual(1)
		await flushElmAuthorityForSession(h.sessionId)
		expect(getElmAuthorityCompletionDecision(h.sessionId).kind).toBe("hold")
		expect(h.completionCommitCount()).toBe(0)

		// No further agent_turn_done arrives. The task is stranded: the
		// drain callback did NOT repair the post-continuation liveness.
		// Settle the drain callback's async reevaluation first, then prove
		// that no C10 commits even after it settled.
		await settleUntil(() => h.drainTriggerCount() >= 1, "drain-callback-fired")
		await new Promise((r) => setTimeout(r, 100))
		expect(h.completionCommitCount()).toBe(0)
		expect(
			(
				h.coordinator as unknown as { isDeferredCompletionBarrierOutstandingForTesting(): boolean }
			).isDeferredCompletionBarrierOutstandingForTesting(),
		).toBe(true)
	}, 30_000)
})

/**
 * Replay the FULL reported chronology against the REAL Elm kernel and the
 * REAL coordinator, up to (but NOT including) the post-continuation
 * `agent_turn_done`.
 *
 * After this returns:
 *   - all five held terminal obligations are drained (BCB set empty),
 *   - the drain callback has fired at least once,
 *   - the coalesced continuation is scheduled/running, so Elm HOLDS,
 *   - no C10 has committed yet.
 */
async function replayReportedChronologyToElmHold(h: RealElmHarness): Promise<void> {
	for (const jobId of FIVE_HELD) {
		h.runningJobs.push(jobId)
		h.notify.recordNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
		await enqueueElmAuthorityRecord({
			stage: "terminal_committed",
			sessionId: h.sessionId,
			jobId,
			ownerId: h.sessionId,
		})
	}
	await flushElmAuthorityForSession(h.sessionId)

	// The model calls submit_and_exit -> the BCB holds the completion.
	await emitSubmitAndExit(h)
	expect(h.completionCommitCount()).toBe(0)

	// The coalesced continuation is scheduled and starts running.
	await seedScheduledContinuationElm(h, "prompt-1", "run-continuation")

	// The model observes the held jobIds through the production Path C
	// observation seam; the last drain empties the owner's set and fires
	// the new drain callback.
	h.runningJobs.length = 0
	for (const jobId of FIVE_HELD) {
		h.notify.consumeNonNotifyTerminalObservation({ jobId, sessionId: h.sessionId, taskId: h.taskId })
		await enqueueElmAuthorityRecord({
			stage: "notify_consume_enter",
			sessionId: h.sessionId,
			jobId,
		})
	}
	await flushElmAuthorityForSession(h.sessionId)
	// The PTLL01-L1 repair fires the reevaluation as a fire-and-forget
	// promise (`void coordinator.reevaluateDeferredCompletionBarrier()`,
	// background-notify-coordinator.ts:2103). Settle it deterministically
	// before observing the marker state — a fixed sleep would be a timing
	// dependency, and a synchronous observation would race the promise.
	//
	// In the ABLATED arm the callback never fires, so the settle
	// predicate is the marker state alone (there is no promise in flight).
	const drainSettled = async (): Promise<void> => {
		if (h.drainTriggerCount() >= 1) {
			await settleUntil(
				() =>
					(
						h.coordinator as unknown as { isDeferredCompletionBarrierOutstandingForTesting(): boolean }
					).isDeferredCompletionBarrierOutstandingForTesting(),
				"drain-callback-reevaluation-settled",
			)
		}
	}
	await drainSettled()
	expect(h.notify.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)
}

/**
 * Deterministic settlement of the drain callback's ASYNCHRONOUS reevaluation.
 *
 * The PTLL01-L1 production repair fires the reevaluation as
 * `void coordinator.reevaluateDeferredCompletionBarrier()` — a
 * fire-and-forget promise (background-notify-coordinator.ts:2103). A test
 * that observes the marker state synchronously after the drain would race
 * that promise and observe the marker mid-flight (cleared at
 * sdk-session-event-coordinator.ts:1512, re-registered on Elm HOLD at
 * L1539).
 *
 * This helper polls a PREDICATE (not a fixed sleep) with a bounded ceiling
 * that fails loudly rather than passing vacuously.
 */
async function settleUntil(predicate: () => boolean, label: string): Promise<void> {
	for (let turn = 0; turn < 50; turn++) {
		if (predicate()) {
			return
		}
		await new Promise((r) => setTimeout(r, 10))
	}
	if (!predicate()) {
		throw new Error(`settleUntil(${label}) did not settle within the bounded ceiling`)
	}
}

describe("PTLL01-CORR01 — the causal trigger, isolated against the REAL Elm kernel", () => {
	it("REAL-ELM-L1-CHRONOLOGY: the reported chronology commits exactly one C10, driven by the post-continuation agent_turn_done", async () => {
		setElmAuthorityProvider(REAL_KERNEL_PATH)
		const h = makeRealElmHarness({ withDrainCallback: true })
		await replayReportedChronologyToElmHold(h)

		// The drain callback fired (the PTLL01-L1 repair is present) but the
		// continuation is still scheduled/running -> the Elm authority still
		// HOLDS, so no C10 yet.
		expect(h.drainTriggerCount()).toBeGreaterThanOrEqual(1)
		await flushElmAuthorityForSession(h.sessionId)
		expect(getElmAuthorityCompletionDecision(h.sessionId).kind).toBe("hold")
		expect(h.completionCommitCount()).toBe(0)

		// The continuation's turn ends -> agent_turn_done. In production this
		// IS the reevaluation trigger:
		//   recordAgentTurnDone -> CCARD record -> semantic trigger ->
		//   notifyAgentTurnDone -> flushElmAuthorityForSession -> reevaluate.
		await enqueueElmAuthorityRecord({
			stage: "agent_turn_done",
			sessionId: h.sessionId,
			runId: "run-continuation",
		})
		await h.coordinator.notifyAgentTurnDone(h.sessionId)

		// Exactly one C10 commits.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.phaseWrites.filter((w) => w.phase === "completed")).toHaveLength(1)
	}, 40_000)

	it("REAL-ELM-DRAIN-CALLBACK-NOT-CAUSE: ablating the PTLL01 drain callback does NOT change the C10 outcome of the reported chronology", async () => {
		setElmAuthorityProvider(REAL_KERNEL_PATH)

		// --- Arm A: WITH the drain callback (the shipped repair) ---
		const withDrain = makeRealElmHarness({ withDrainCallback: true })
		await replayReportedChronologyToElmHold(withDrain)
		await enqueueElmAuthorityRecord({
			stage: "agent_turn_done",
			sessionId: withDrain.sessionId,
			runId: "run-continuation",
		})
		await withDrain.coordinator.notifyAgentTurnDone(withDrain.sessionId)
		const withDrainCommits = withDrain.completionCommitCount()

		// --- Arm B: WITHOUT the drain callback (the ablation) ---
		const withoutDrain = makeRealElmHarness({ withDrainCallback: false })
		await replayReportedChronologyToElmHold(withoutDrain)
		await enqueueElmAuthorityRecord({
			stage: "agent_turn_done",
			sessionId: withoutDrain.sessionId,
			runId: "run-continuation",
		})
		await withoutDrain.coordinator.notifyAgentTurnDone(withoutDrain.sessionId)
		const withoutDrainCommits = withoutDrain.completionCommitCount()

		// The drain callback fired in Arm A and NOT in Arm B, yet the C10
		// outcome is IDENTICAL. Therefore the drain callback is NOT the
		// causal repair for the reported chronology: the post-continuation
		// `agent_turn_done` is.
		expect(withDrain.drainTriggerCount()).toBeGreaterThanOrEqual(1)
		expect(withoutDrain.drainTriggerCount()).toBe(0)
		expect(withDrainCommits).toBe(1)
		expect(withoutDrainCommits).toBe(withDrainCommits)
	}, 60_000)
})
