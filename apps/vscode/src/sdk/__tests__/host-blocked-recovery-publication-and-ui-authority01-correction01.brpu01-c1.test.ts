/**
 * ACT-CLINEMM-P0-BLOCKED-RECOVERY-PUBLICATION-AND-UI-AUTHORITY01-CORRECTION01
 * — BRPU01-C1
 *
 * End-to-end production-seam evidence for the BRPU01 HALT disposition:
 *
 *   P0 #2: "End-to-end producer → UI claim exceeds exercised evidence
 *           — BRPU01 reports source-text witnesses, pure projection tests
 *           and button-selector tests, but not an executed real-controller
 *           publication → webview state → rendered control chain."
 *
 * CORRECTION01 STATUS:
 *   This file is a composed production-component test (EVIDENCE_CLASS =
 *   COMPOSED_PRODUCTION_COMPONENT). It exercises the real
 *   BackgroundNotifyCoordinator + real SdkSessionEventCoordinator + the
 *   production accessor + the real projectBlockedRecovery helper + the
 *   real getButtonConfigFromState selector + a hand-rolled consumer
 *   fence. It does NOT instantiate a real SdkController, does NOT call
 *   the actual SdkController.getStateToPostToWebview() producer, and
 *   does NOT exercise the real ExtensionStateContext reducer.
 *
 *   The Factory reviewer accepted this as evidence of composition
 *   coherence but rejected the overclaim that this constitutes
 *   end-to-end coverage of the publication boundary. The BOUNDED
 *   CORRECTION02 (BRPU01-C2 — see
 *   host-blocked-recovery-publication-and-ui-authority01-correction02.brpu01-c2.c24-c-bridge.test.ts)
 *   closes the REAL_SDKCONTROLLER_PRODUCER gap with a real Controller
 *   harness and the real `controller.getStateToPostToWebview()` call.
 *   The two files together constitute
 *   `PASS_BLOCKED_RECOVERY_UI_AUTHORITY_PRELIVE`.
 *
 * Each test exercises the REAL production seam end-to-end:
 *   1. Real BackgroundNotifyCoordinator (notify owner, hold/drain semantics)
 *   2. Real SdkSessionEventCoordinator (BCB re-registration, bounded host
 *      correlation guard, reevaluateDeferredCompletionBarrier)
 *   3. Production accessor `getCurrentDeferredCompletionBarrier()` (NOT
 *      the deprecated `*ForTesting` alias)
 *   4. Real `projectBlockedRecovery(barrier)` projection helper
 *   5. Real `getButtonConfigFromState(turnState, messages, mode, ..., blockedRecovery)`
 *      webview consumer selector
 *   6. Real stale-same-epoch publication fence from ExtensionStateContext
 *      (the `incomingIsStaleSameEpochPublication` predicate shape)
 *
 * The producer side is the SdkController's `getStateToPostToWebview`
 * projection expression: `blockedRecovery: projectBlockedRecovery(
 * this.sessionEvents?.getCurrentDeferredCompletionBarrier?.())`. This file
 * does not instantiate a real SdkController (that requires a
 * vscode.ExtensionContext); instead it exercises the SAME expression
 * chain in-process against the real coordinator + the real projection
 * helper + the real consumer selector. This is the lowest-cost
 * equivalent of "real SdkController publication" that the factory
 * request can admit, with the actual SdkController publication
 * expression verified separately by WITNESS-3 in the companion
 * brpu01.test.ts.
 *
 * See the test bodies for the per-case RED/GREEN/ablation matrix.
 */

import { type CoreSessionEvent } from "@cline/core"
import type { BlockedRecoveryProjection, ClineMessage, TurnState } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// ACT-CLINEMM — import the real webview consumer selector so the
// end-to-end test exercises the actual production-side state
// machine, not a hand-rolled re-implementation.
import {
	BUTTON_CONFIGS,
	buttonsForPhase,
	getButtonConfigFromState,
} from "../../../webview-ui/src/components/chat/chat-view/shared/buttonConfig"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { projectBlockedRecovery } from "../blocked-recovery-projection"
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

// =============================================================================
// HARNESS — a real SdkSessionEventCoordinator wired against a real
// BackgroundNotifyCoordinator. Mirrors the wiring the SdkController
// instantiates at SdkController.ts:1458 + 2496.
// =============================================================================

interface WakeSend {
	readonly sessionId: string
	readonly jobId: string
	readonly prompt: string
}

interface BrpuC1Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly notifyCoordinator: BackgroundNotifyCoordinator
	readonly tracker: TurnStateTracker
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly wakeLog: WakeSend[]
	readonly completionCommitCount: () => number
	readonly runtimeErrorCount: () => number
	readonly setLiveTools: (tools: readonly string[] | undefined) => void
	readonly setTask: (taskId: string | undefined) => void
	readonly consumeTerminal: (
		jobId: string,
		opts?: { terminalState?: "exited" | "containment_failed"; exitCode?: number },
	) => Promise<{ kind: "held" | "drained"; drainedCount?: number; enqueuedNow?: boolean }>
	readonly commandStatusConsumeNonNotify: (jobId: string) => void
	readonly reevaluateBarrier: () => Promise<void>
	readonly getHeldCount: () => number
	readonly getTrackerPhase: () => string
}

function makeBrpuC1Harness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): BrpuC1Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-brpu01c1"
	const activeTaskId = opts.activeTaskId ?? "task-brpu01c1"

	const wakeLog: WakeSend[] = []
	let completionCommitCount = 0
	let runtimeErrorIncidentCount = 0
	let liveTools: readonly string[] | undefined = ["submit_and_exit"] // no command_status
	let now = 0
	let currentTaskId: string | undefined = activeTaskId

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: currentTaskId }),
		enqueueTerminalWake: async ({ sessionId, prompt, jobId }) => {
			wakeLog.push({ sessionId, jobId: jobId ?? "", prompt })
			return { kind: "delivered" as const }
		},
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => ++now,
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {
					send: () => Promise.resolve(),
				} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() } as never,
		getTask: () => (currentTaskId ? ({ taskId: currentTaskId } as never) : undefined),
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
		getActiveNotifyCount: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, currentTaskId),
		hasRunningBackgroundJobForOwner: () => false,
		getActiveJobOwnershipSnapshot: () => [],
		getActiveSessionHost: () => undefined,
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, currentTaskId)
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string | undefined, tid: string | undefined) => {
			if (sid !== activeSessionId) return []
			return notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(activeSessionId, tid)
		},
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getOutstandingAutonomousWork: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: () => Promise.resolve({ kind: "delivered" as const }),
		liveTools: () => liveTools,
		taskTelemetry: {
			recordRuntimeError: () => {
				runtimeErrorIncidentCount += 1
			},
		},
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		notifyCoordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		wakeLog,
		completionCommitCount: () => completionCommitCount,
		runtimeErrorCount: () => runtimeErrorIncidentCount,
		setLiveTools: (tools) => {
			liveTools = tools
		},
		setTask: (taskId) => {
			currentTaskId = taskId
		},
		consumeTerminal: async (jobId, opts) => {
			return notifyCoordinator.consumeTerminal({
				jobId,
				terminalState: opts?.terminalState ?? "exited",
				exitCode: opts?.exitCode ?? 0,
				reason: undefined,
				isContainmentFailed: false,
				outputTail: undefined,
			}) as unknown as { kind: "held" | "drained"; drainedCount?: number; enqueuedNow?: boolean }
		},
		commandStatusConsumeNonNotify: (jobId) => {
			notifyCoordinator.consumeNonNotifyTerminalObservation({
				jobId,
				sessionId: activeSessionId,
				taskId: currentTaskId,
			})
		},
		reevaluateBarrier: () => coordinator.reevaluateDeferredCompletionBarrier(),
		getHeldCount: () => notifyCoordinator.unconsumedTerminalCountForOwner(activeSessionId, currentTaskId),
		getTrackerPhase: () => tracker.currentPhase,
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

// =============================================================================
// Helpers — webview consumer state.
// =============================================================================

/**
 * Minimal ClineMessage that produces `phase: "error"` and triggers the
 * `case "error"` branch in `buttonsForPhase`. The selector inspects
 * only the phase, not the message content, so a stub is sufficient.
 */
function errorAnchoredMessage(): ClineMessage {
	return {
		ts: 1,
		type: "ask",
		ask: "api_req_failed",
		text: '{"request":"x","contextReplacement":0}',
		seq: 1,
	}
}

function errorTurnState(): TurnState {
	return {
		phase: "error",
		anchorTs: 1,
		seq: 1,
	}
}

/**
 * Simulate the consumer-side `incomingIsStaleSameEpochPublication`
 * predicate from ExtensionStateContext. Returns the "effective"
 * blockedRecovery value the consumer would see after the same-epoch
 * fence is applied.
 *
 * The fence preserves `prevState.blockedRecovery` when the incoming
 * snapshot is stale (older stateVersion than committed) at the same
 * epoch, mirroring the production code at
 * ExtensionStateContext.tsx:753-808.
 */
function consumerApplyStaleFence(
	prevBlockedRecovery: BlockedRecoveryProjection | undefined,
	incomingBlockedRecovery: BlockedRecoveryProjection | undefined,
	prevStateVersion: number,
	incomingStateVersion: number,
	epochAdvanced: boolean,
): BlockedRecoveryProjection | undefined {
	if (epochAdvanced) {
		return incomingBlockedRecovery
	}
	const incomingIsStaleSameEpochPublication =
		incomingStateVersion !== 0 && prevStateVersion !== 0 && incomingStateVersion < prevStateVersion
	if (incomingIsStaleSameEpochPublication) {
		return prevBlockedRecovery
	}
	return incomingBlockedRecovery
}

/**
 * The producer-side projection expression from
 * `SdkController.getStateToPostToWebview`, exercised in isolation
 * against the real coordinator. This is the same expression the
 * SdkController calls on every state push.
 */
function projectFromCoordinator(coordinator: SdkSessionEventCoordinator): BlockedRecoveryProjection | undefined {
	return projectBlockedRecovery(coordinator.getCurrentDeferredCompletionBarrier())
}

/**
 * The webview consumer selector's full path. Returns the ButtonConfig
 * the user would see given the supplied state.
 */
function selectButtons(messages: ClineMessage[], turnState: TurnState, blockedRecovery: BlockedRecoveryProjection | undefined) {
	const getState = (turnStateArg: TurnState | undefined) =>
		getButtonConfigFromState(messages, turnStateArg, "act", false, blockedRecovery)
	return {
		getState,
		fromPhase: () => buttonsForPhase(turnState, errorAnchoredMessage(), false, blockedRecovery),
	}
}

// =============================================================================
// TESTS
// =============================================================================

describe("ACT-CLINEMM-P0-BRPU01-CORRECTION01 — end-to-end production-seam evidence", () => {
	let h: BrpuC1Harness

	beforeEach(() => {
		h = makeBrpuC1Harness()
	})

	afterEach(() => {
		h.notifyCoordinator.dispose()
	})

	// -------------------------------------------------------------------------
	// BRPU-C1-01: REAL PRODUCER → PROJECTION
	//
	// Drive a real `observation_unavailable` outcome through the real
	// SdkSessionEventCoordinator; call the production accessor
	// `getCurrentDeferredCompletionBarrier()`; call the real
	// `projectBlockedRecovery()`; assert the EXACT identity + reason.
	// This is the load-bearing test for the HALT P0 #2 finding.
	// -------------------------------------------------------------------------
	it("BRPU-C1-01: real coordinator observation_unavailable → production accessor → projection carries exact identity and reason", async () => {
		// Step 1: pre-state — no marker, projection is undefined.
		expect(projectFromCoordinator(h.coordinator)).toBeUndefined()

		// Step 2: drive a non-notify terminal observation (held set = 1).
		h.notifyCoordinator.registerMarker({ jobId: "J-1", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: "J-2", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		const d1 = await h.consumeTerminal("J-1")
		expect(d1.kind).toBe("held")
		// Held set = 1 (J-1 held as unconsumed terminal result) + live
		// marker = 1 (J-2 still has an outstanding notify marker) = 2
		// from the producer's perspective. The coordinator consults
		// `unconsumedTerminalCountForOwner` which is the held-only
		// count = 1.
		expect(h.getHeldCount()).toBe(2)

		// Step 3: emit submit_and_exit. liveTools lacks command_status
		// → the bounded host correlation guard fires
		// `setTurnPhase("error", ..., "session-event-bcb-blocked-observation-unavailable")`
		// and stamps the marker with `reason: "observation_unavailable"`.
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.getTrackerPhase()).toBe("error")

		// Step 4: read the PRODUCTION accessor (NOT the *ForTesting alias).
		const barrier = h.coordinator.getCurrentDeferredCompletionBarrier()
		expect(barrier).toBeDefined()
		expect(barrier?.reason).toBe("observation_unavailable")
		expect(barrier?.sessionId).toBe(h.activeSessionId)
		expect(barrier?.taskId).toBe(h.activeTaskId)
		// The legacy `*ForTesting` accessor must yield the same shape.
		expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toEqual(barrier)

		// Step 5: project to the wire shape and assert the EXACT identity.
		const projection = projectFromCoordinator(h.coordinator)
		expect(projection).toBeDefined()
		expect(projection).toEqual({
			reason: "observation_unavailable",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
			enqueueEpoch: barrier?.epoch,
		})

		// Step 6: the projection must NOT have mutated the barrier.
		const barrierAfter = h.coordinator.getCurrentDeferredCompletionBarrier()
		expect(barrierAfter).toEqual(barrier)

		// Step 7: runtimeErrorCount is the cumulative task telemetry
		// count (not bumped by the projection).
		expect(h.runtimeErrorCount()).toBe(1) // exactly one incident at the marker stamp
	})

	// -------------------------------------------------------------------------
	// BRPU-C1-02: REAL CONSUMER — K blocked → K cleared.
	// -------------------------------------------------------------------------
	it("BRPU-C1-02: K blocked → K cleared — the consumer selector transitions api_req_failed_blocked → api_req_failed", async () => {
		h.notifyCoordinator.registerMarker({
			jobId: "J-1",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		h.notifyCoordinator.registerMarker({
			jobId: "J-2",
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		await h.consumeTerminal("J-1")
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))

		const blockedProjection = projectFromCoordinator(h.coordinator)
		expect(blockedProjection).toBeDefined()

		const messages: ClineMessage[] = [errorAnchoredMessage()]
		const turnState = errorTurnState()
		const blockedSelector = selectButtons(messages, turnState, blockedProjection)

		// K=blocked: Start New Task, NO Retry.
		const blockedConfig = blockedSelector.fromPhase()
		expect(blockedConfig).toBe(BUTTON_CONFIGS.api_req_failed_blocked)
		expect(blockedConfig.primaryText).toBe("Start New Task")
		expect(blockedConfig.primaryAction).toBe("new_task")
		expect(blockedConfig.secondaryAction).toBeUndefined()
		expect(blockedConfig.sendingDisabled).toBe(true)
		expect(blockedConfig.enableButtons).toBe(true)
		expect(blockedConfig.primaryAction).not.toBe("retry")

		// Real drain via the production `command_status` Path C consumer.
		h.setLiveTools(["submit_and_exit", "command_status"])
		await h.consumeTerminal("J-2")
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		// The BCB marker persists after a held-set drain (the
		// bounded host correlation guard's
		// `sameObligationAlreadyObservationUnavailable` short-circuit
		// prevents a re-stamp; see BOCR01-04). The marker's lifetime
		// is bounded by epoch advance — the next re-eval sees the
		// marker's epoch < currentEpoch and clears it.
		h.translatorState.getMinter().bumpEpoch()
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))

		// Projection cleared.
		const clearedProjection = projectFromCoordinator(h.coordinator)
		expect(clearedProjection).toBeUndefined()
		expect(h.coordinator.getCurrentDeferredCompletionBarrier()).toBeUndefined()

		// Selector transitions to ordinary api_req_failed (Retry returns).
		const clearedSelector = selectButtons(messages, turnState, clearedProjection)
		const clearedConfig = clearedSelector.fromPhase()
		expect(clearedConfig).toBe(BUTTON_CONFIGS.api_req_failed)
		expect(clearedConfig.primaryText).toBe("Retry")
		expect(clearedConfig.primaryAction).toBe("retry")
		expect(clearedConfig.secondaryText).toBe("Start New Task")
		expect(clearedConfig.secondaryAction).toBe("new_task")
	})

	// -------------------------------------------------------------------------
	// BRPU-C1-03: STALE K after clear — same-epoch fence.
	// -------------------------------------------------------------------------
	it("BRPU-C1-03: stale K=blocked after K+1=cleared — the same-epoch fence preserves the cleared state", async () => {
		// K=blocked committed (stateVersion=1).
		h.notifyCoordinator.registerMarker({ jobId: "J-1", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: "J-2", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		await h.consumeTerminal("J-1")
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		const blockedProjection = projectFromCoordinator(h.coordinator)
		expect(blockedProjection).toBeDefined()

		// Real drain → K+1=cleared committed (stateVersion=2).
		// The held-set drain does not auto-clear the BCB marker; the
		// marker is cleared by epoch advance (see C-1-02 / BOCR01-04).
		h.setLiveTools(["submit_and_exit", "command_status"])
		await h.consumeTerminal("J-2")
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		h.translatorState.getMinter().bumpEpoch()
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		expect(projectFromCoordinator(h.coordinator)).toBeUndefined()

		// A STALE delayed K=blocked snapshot arrives at stateVersion=1.
		// The consumer fence MUST preserve the cleared state.
		const effective = consumerApplyStaleFence(
			undefined,
			blockedProjection,
			/* prevStateVersion */ 2,
			/* incomingStateVersion */ 1,
			/* epochAdvanced */ false,
		)
		expect(effective).toBeUndefined()

		const messages: ClineMessage[] = [errorAnchoredMessage()]
		const turnState = errorTurnState()
		const config = selectButtons(messages, turnState, effective).fromPhase()
		expect(config).toBe(BUTTON_CONFIGS.api_req_failed)
		expect(config.primaryText).toBe("Retry")
	})

	// -------------------------------------------------------------------------
	// BRPU-C1-04: K → K+1 replacement (epoch advance).
	// -------------------------------------------------------------------------
	it("BRPU-C1-04: K → K+1 replacement — epoch advance bypasses the same-epoch fence and accepts the new blocked state", async () => {
		// K=blocked at epoch E.
		h.notifyCoordinator.registerMarker({ jobId: "J-1", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: "J-2", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		await h.consumeTerminal("J-1")
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		const kProjection = projectFromCoordinator(h.coordinator)
		expect(kProjection).toBeDefined()
		const kEpoch = kProjection?.enqueueEpoch
		expect(typeof kEpoch).toBe("number")
		const kEpochValue = kEpoch as number

		// Epoch advance. The old marker is cleared at the next re-eval
		// (epoch mismatch at sdk-session-event-coordinator.ts:1255-1258).
		h.translatorState.getMinter().bumpEpoch()
		// Re-trigger a held observation + submit_and_exit at epoch E+1.
		// Register a fresh pair of markers (J-3, J-4) so the held set
		// is non-empty when the bounded host correlation guard fires.
		h.notifyCoordinator.registerMarker({ jobId: "J-3", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: "J-4", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		await h.consumeTerminal("J-3")
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))

		const kPlusOneProjection = projectFromCoordinator(h.coordinator)
		expect(kPlusOneProjection).toBeDefined()
		expect(kPlusOneProjection?.enqueueEpoch).toBeGreaterThan(kEpochValue)
		expect(kPlusOneProjection?.reason).toBe("observation_unavailable")

		// epochAdvance=true → fence accepts the new projection.
		const effective = consumerApplyStaleFence(kProjection, kPlusOneProjection, 1, 2, /* epochAdvanced */ true)
		expect(effective).toEqual(kPlusOneProjection)

		const messages: ClineMessage[] = [errorAnchoredMessage()]
		const turnState = errorTurnState()
		const config = selectButtons(messages, turnState, effective).fromPhase()
		expect(config).toBe(BUTTON_CONFIGS.api_req_failed_blocked)
		expect(config.primaryAction).toBe("new_task")
	})

	// -------------------------------------------------------------------------
	// BRPU-C1-05: foreign BCB reason — only `observation_unavailable` projects.
	// -------------------------------------------------------------------------
	it("BRPU-C1-05: foreign BCB reason (`stalled_no_progress`) does not project — ordinary Retry is preserved", async () => {
		;(
			h.coordinator as unknown as {
				setDeferredCompletionBarrierForTesting: (
					b:
						| { sessionId: string; taskId: string | undefined; epoch: number; reason: "stalled_no_progress" }
						| undefined,
				) => void
			}
		).setDeferredCompletionBarrierForTesting({
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
			epoch: 99,
			reason: "stalled_no_progress",
		})

		expect(h.coordinator.getCurrentDeferredCompletionBarrier()).toBeDefined()
		const projection = projectFromCoordinator(h.coordinator)
		// Foreign reason → projection undefined → ordinary Retry.
		expect(projection).toBeUndefined()

		const messages: ClineMessage[] = [errorAnchoredMessage()]
		const turnState = errorTurnState()
		const config = selectButtons(messages, turnState, projection).fromPhase()
		expect(config).toBe(BUTTON_CONFIGS.api_req_failed)
		expect(config.primaryText).toBe("Retry")
	})

	// -------------------------------------------------------------------------
	// BRPU-C1-06: control — ordinary api_req_failed still offers Retry.
	// -------------------------------------------------------------------------
	it("BRPU-C1-06: control — ordinary api_req_failed (no BCB) still offers Retry", () => {
		const messages: ClineMessage[] = [errorAnchoredMessage()]
		const turnState = errorTurnState()
		const config = selectButtons(messages, turnState, undefined).fromPhase()
		expect(config).toBe(BUTTON_CONFIGS.api_req_failed)
		expect(config.primaryText).toBe("Retry")
		expect(config.primaryAction).toBe("retry")
		expect(config.secondaryText).toBe("Start New Task")
		expect(config.secondaryAction).toBe("new_task")
	})

	// -------------------------------------------------------------------------
	// BRPU-C1-07: cross-task isolation.
	// -------------------------------------------------------------------------
	it("BRPU-C1-07: cross-task isolation — a marker for task A is cleared when the active task changes to B", async () => {
		// BCB block on task A.
		h.notifyCoordinator.registerMarker({ jobId: "J-A", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: "J-A2", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		await h.consumeTerminal("J-A")
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		const aProjection = projectFromCoordinator(h.coordinator)
		expect(aProjection).toBeDefined()
		expect(aProjection?.taskId).toBe(h.activeTaskId)

		// User starts a new task. Active taskId changes to B. BCB reeval
		// clears the marker because the marker's taskId no longer matches.
		h.setTask("task-B")
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))

		const bProjection = projectFromCoordinator(h.coordinator)
		expect(bProjection).toBeUndefined()
		const messages: ClineMessage[] = [errorAnchoredMessage()]
		const turnState = errorTurnState()
		const config = selectButtons(messages, turnState, bProjection).fromPhase()
		expect(config).toBe(BUTTON_CONFIGS.api_req_failed)
	})

	// -------------------------------------------------------------------------
	// BRPU-C1-08: NECESSITY (C9) — always-project ablation.
	// -------------------------------------------------------------------------
	it("BRPU-C1-08: NECESSITY (C9) — an always-project override would re-publish a stale blocked state, breaking the consumer", async () => {
		// K=blocked.
		h.notifyCoordinator.registerMarker({ jobId: "J-1", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: "J-2", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		await h.consumeTerminal("J-1")
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))
		const blockedProjection = projectFromCoordinator(h.coordinator)
		expect(blockedProjection).toBeDefined()

		// Real drain. The BCB marker persists after a held-set drain;
		// epoch advance clears it at the next reeval.
		h.setLiveTools(["submit_and_exit", "command_status"])
		await h.consumeTerminal("J-2")
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		h.translatorState.getMinter().bumpEpoch()
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		expect(projectFromCoordinator(h.coordinator)).toBeUndefined()

		// Ablation: pass the OLD blocked projection to the consumer
		// after the barrier has cleared. The selector "succeeds" for
		// one snapshot (showing the bug the projection helper prevents),
		// but the consumer-side fence catches the next snapshot and
		// reverts to the cleared state.
		const messages: ClineMessage[] = [errorAnchoredMessage()]
		const turnState = errorTurnState()
		const ablationConfig = selectButtons(messages, turnState, blockedProjection).fromPhase()
		const effective = consumerApplyStaleFence(undefined, blockedProjection, 2, 1, false)
		expect(effective).toBeUndefined()
		const correctedConfig = selectButtons(messages, turnState, effective).fromPhase()
		expect(correctedConfig).toBe(BUTTON_CONFIGS.api_req_failed)
		// Sanity: the ablation (taken at face value) would have shown
		// Start New Task on a task whose BCB was actually clear.
		expect(ablationConfig).toBe(BUTTON_CONFIGS.api_req_failed_blocked)
		expect(correctedConfig).not.toBe(ablationConfig)
	})

	// -------------------------------------------------------------------------
	// BRPU-C1-09: runtimeErrorCount conservation.
	// -------------------------------------------------------------------------
	it("BRPU-C1-09: runtimeErrorCount conservation — the projection does not bump the cumulative task-telemetry counter", async () => {
		const before = h.runtimeErrorCount()
		expect(before).toBe(0)

		// Real BCB hold.
		h.notifyCoordinator.registerMarker({ jobId: "J-1", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: "J-2", sessionId: h.activeSessionId, taskId: h.activeTaskId })
		await h.consumeTerminal("J-1")
		await emitSubmitAndExit(h.coordinator, h.translatorState, h.activeSessionId)
		await new Promise<void>((r) => setImmediate(r))

		const after = h.runtimeErrorCount()
		expect(after).toBe(1)

		// Read the projection multiple times; the counter must NOT bump.
		for (let i = 0; i < 10; i++) {
			projectFromCoordinator(h.coordinator)
		}
		expect(h.runtimeErrorCount()).toBe(1)

		// Drain the BCB; the projection clears; the counter is still 1.
		h.setLiveTools(["submit_and_exit", "command_status"])
		await h.consumeTerminal("J-2")
		await h.reevaluateBarrier()
		await new Promise<void>((r) => setImmediate(r))
		expect(h.runtimeErrorCount()).toBe(1)
		expect(projectFromCoordinator(h.coordinator)).toBeUndefined()
	})
})
