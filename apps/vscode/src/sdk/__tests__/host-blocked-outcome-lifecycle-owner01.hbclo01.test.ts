/**
 * ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-OWNER01 — HBCLO01
 *
 * Recon pass that selects the existing host lifecycle owner for a
 * blocked completion obligation, and proves the gap via a real
 * production-seam RED test.
 *
 *   Sub-predecessor:
 *     ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-CONSUMER-PROBE01
 *     (c8e2a6e29; PASS_WITH_NONBLOCKING_RESIDUE) closed the
 *     scheduler question: the rebuild scheduler is correctly
 *     conserving a Boolean safety hold. The marker is the
 *     always-on "blocked" surface; the typed `reason` is the
 *     verdict. The next ACT must answer the question this
 *     test poses: which existing production lifecycle surface
 *     should RECEIVE the typed verdict?
 *
 *   Selected owner (this ACT, C7):
 *     `TaskTelemetryTracker.recordRuntimeError(incident)` is
 *     the existing production lifecycle consumer. Pattern:
 *
 *       CommandJobManager.cancel ─→ reportRuntimeError(...) ─→
 *         VscodeSessionHost.onRuntimeError ─→
 *           SdkController.handleTaskRuntimeError ─→
 *             TaskTelemetryTracker.recordRuntimeError ─→
 *               TaskHeaderTelemetryStrip.runtimeErrorCount (wire) ─→
 *                 webview TaskHeader `⚠ N` glyph
 *
 *     The surface is:
 *       - always-on (no opt-in flag; the C0 production seam
 *         is unconditional — `recordRuntimeError` is the V1
 *         public sink wired by SdkController.ts:1901)
 *       - typed (`RuntimeErrorIncident { errorClass, source,
 *         correlationId? }` — closed enum, additive-safe)
 *       - display-only (the webview renders a `⚠ N` glyph,
 *         NEVER a model-input text; `errorClass` / `source`
 *         are NOT projected to the wire and never reach the
 *         model — ExtensionMessage.ts:1042-1056)
 *       - per-task lifetime (latches on `startTask` with a
 *         new identity; same per-task semantics as
 *         `deferredCompletionBarrier` epoch — the natural
 *         replacement guard)
 *       - cumulative monotonic (recoverable hold and
 *         unrecoverable block both increment; matches the
 *         existing `command_containment_failed` precedent)
 *
 *   The RED:
 *     This test drives the REAL `SdkSessionEventCoordinator`
 *     through the REAL `handleSessionEvent` BCB re-registration
 *     path with two consecutive `done` events (K delivers, K+1
 *     stalls). It asserts that the typed verdict reaches a
 *     production lifecycle consumer — specifically a
 *     `recordRuntimeError(...)` call on a `taskTelemetry` that
 *     the coordinator is expected to call. The CURRENT
 *     production code (applyBlockedCompletionContinuationOutcome
 *     at sdk-session-event-coordinator.ts:1688-1808) does NOT
 *     call any `recordRuntimeError(...)` — it only stamps the
 *     marker with a typed `reason` and increments the OPT-IN
 *     dogfood counter. Therefore the test FAILS against the
 *     current implementation, proving the missing consumer.
 *
 *   Conservation guards (pinned, not under test):
 *     - C11 invariant: getTurnPhase() !== "completed" while
 *       the marker is registered. A blocked verdict is NOT a
 *       task completion.
 *     - Negative control: a `delivered` outcome does NOT
 *       invoke recordRuntimeError (the marker is the only
 *       state change).
 *     - C4 adversarial: a stale T1 resolution after a T2
 *       replacement does NOT invoke recordRuntimeError.
 *
 *   Elm conservation: zero Elm changes. The verdict comes
 *   from existing TS disc + existing production callback;
 *   the marker is the host-owned blocked surface; the new
 *   publication is a single additive recordRuntimeError call
 *   in the host.
 *
 *   No new public wire field. The existing
 *   `TaskHeaderTelemetryStrip.runtimeErrorCount` is reused
 *   (zero-hiding at zero, ⚠ N glyph at >0, monotonic
 *   cumulative, task-lifetime reset on new identity). The
 *   V1 webview ignores the `errorClass` / `source` strings
 *   (ExtensionMessage.ts:1042-1056) — adding a new additive
 *   `RuntimeErrorSource` value is a closed-enum extension
 *   that never reaches the wire.
 */
import { type CoreSessionEvent } from "@cline/core"
import type { RuntimeErrorIncident } from "@shared/ExtensionMessage"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyCompletionContinuationUpstreamDiagnosticProfile } from "../dogfood-diagnostic-profile"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import type { SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { SdkSessionEventCoordinator } from "../sdk-session-event-coordinator"
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
		captureProviderApiError: () => {},
		captureTaskStarted: () => {},
		captureTaskCompleted: () => {},
	},
}))

/**
 * The host-owned production lifecycle consumer the coordinator
 * is expected to call on a typed blocked verdict. We hold a
 * `vi.fn()` directly so the test can inspect `.mock.calls`
 * without a structural cast. The shape matches the production
 * `TaskTelemetryTracker.recordRuntimeError(incident)` API
 * surface (sdk-session-event-coordinator.ts sink pattern) so
 * the test stays faithful to the real wiring.
 */
type RecordRuntimeErrorFn = ReturnType<typeof vi.fn<(incident: RuntimeErrorIncident) => void>>

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly taskTelemetry: {
		readonly recordRuntimeError: RecordRuntimeErrorFn
		readonly incidents: RuntimeErrorIncident[]
	}
	readonly sendLog: Array<{ prompt: string; sessionId: string; taskId?: string }>
	readonly sessionId: string
	readonly taskId: string
	readonly heldJobIdsRef: readonly string[]
	readonly countRef: number
	liveTaskIdRef: string
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

const SEVEN_HELD_IDS: readonly string[] = ["j1", "j2", "j3", "j4", "j5", "j6", "j7"]

async function emitCompletionTurn(
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

function makeHarness(
	opts: {
		sessionId?: string
		taskId?: string
		heldJobIds?: readonly string[]
		continuationResult?: (input: {
			sessionId: string
			taskId: string | undefined
			heldJobIds: readonly string[]
		}) => Promise<{ kind: "delivered" }> | Promise<{ kind: "rejected" }>
	} = {},
): Harness {
	const sessionId = opts.sessionId ?? "session-hbclo01"
	const taskId = opts.taskId ?? "task-hbclo01"
	const heldJobIds = opts.heldJobIds ?? SEVEN_HELD_IDS
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sendLog: Array<{ prompt: string; sessionId: string; taskId?: string }> = []
	const harnessRef: { current: Harness } = { current: undefined as unknown as Harness }
	const defaultContinuation = (input: { sessionId: string; taskId: string | undefined; heldJobIds: readonly string[] }) => {
		sendLog.push({
			prompt: `mock:${input.heldJobIds.join(",")}`,
			sessionId: input.sessionId,
			taskId: input.taskId,
		})
		return Promise.resolve({ kind: "delivered" as const })
	}
	const continuationResult = opts.continuationResult ?? defaultContinuation
	// HBCLO01-ADDITION: the production lifecycle consumer the
	// coordinator is expected to call on a typed blocked
	// verdict. The coordinator currently does NOT have a
	// taskTelemetry option; we pass it through the structural
	// cast the project already uses (e.g. ccsrl01.test.ts:146).
	const incidents: RuntimeErrorIncident[] = []
	const recordRuntimeError = vi.fn((incident: RuntimeErrorIncident) => {
		incidents.push(incident)
	}) as RecordRuntimeErrorFn
	const taskTelemetry: { recordRuntimeError: RecordRuntimeErrorFn } = { recordRuntimeError }
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		translateSessionEvent,
		sessions: {
			getActiveSession: () =>
				({
					sessionId: harnessRef.current?.sessionId ?? sessionId,
					sdkHost: {
						send: (input: { sessionId: string; prompt: string; delivery: "queue" }) => {
							const h = harnessRef.current
							sendLog.push({
								prompt: input.prompt,
								sessionId: input.sessionId,
								taskId: h?.taskId,
							})
							return Promise.resolve()
						},
					},
					unsubscribe: () => undefined,
					startResult: { sessionId },
					isRunning: false,
				}) as never,
			setRunning: () => undefined,
		},
		messages: { appendAndEmit: () => undefined },
		taskHistory: { updateTaskUsage: () => undefined },
		getTask: () => ({ taskId: harnessRef.current?.liveTaskIdRef ?? taskId }) as never,
		postStateToWebview: async () => undefined,
		setTurnPhase: ((phase, anchorTs, writerId) => {
			tracker.setWithWriter(phase, anchorTs, { writerId: writerId as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		pendingPromptsController: {
			enqueue: () => ({ id: "fake" }),
			getPendingPromptCountRead: () => 0,
			hasPendingPrompts: () => false,
			discardByPredicate: () => true,
		} as never,
		pendingPromptAuthorityAvailable: true,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasRunningBackgroundJobForOwner: () => false,
		getUnconsumedOwnedTerminalResultCount: () => {
			const ref = harnessRef.current
			return ref?.countRef ?? 0
		},
		getUnconsumedOwnedTerminalJobIds: () => {
			const ref = harnessRef.current
			return ref ? [...ref.heldJobIdsRef] : []
		},
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		getLaunchedBackgroundJobIds: () => [],
		enqueueCompletionContinuation: continuationResult,
		// HBCLO01-ADDITION: project the expected consumer
		// through the same structural cast the rest of the
		// suite uses. The coordinator DOES NOT currently read
		// this field; the test is the missing-link evidence.
		taskTelemetry,
	} as unknown as SdkSessionEventCoordinatorOptions)
	coordinator.setDeferredCompletionBarrierForTesting({
		sessionId,
		taskId,
		epoch: translatorState.getMinter().epoch,
	})
	const h: Harness = {
		coordinator,
		taskTelemetry: { recordRuntimeError, incidents },
		sendLog,
		sessionId,
		taskId,
		heldJobIdsRef: [...heldJobIds],
		countRef: heldJobIds.length,
		liveTaskIdRef: taskId,
	}
	harnessRef.current = h
	return h
}

describe("ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-OWNER01 — HBCLO01", () => {
	beforeEach(() => {
		applyCompletionContinuationUpstreamDiagnosticProfile(true)
	})

	afterEach(() => {
		applyCompletionContinuationUpstreamDiagnosticProfile(false)
	})

	describe("RED — typed blocked verdict MUST reach the existing production lifecycle consumer", () => {
		it("HBCLO-01: stalled_no_progress publication invokes taskTelemetry.recordRuntimeError with typed incident", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			// K: real submit_and_exit → BCB registers barrier →
			// continuation delivered, STALL snapshot pinned.
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			expect(h.sendLog.length).toBe(1)
			// Pre-stall baseline: zero incidents (K is
			// delivered, not a blocked verdict).
			expect(h.taskTelemetry.recordRuntimeError).not.toHaveBeenCalled()

			// K+1: real submit_and_exit → BCB re-registration
			// runs → enqueueIfHeld sees priorSortedHeld ===
			// [j1..j7] and the new held set is identical, so
			// the upstream TS disc returns { kind:
			// "stalled_no_progress" } and the production
			// callback's .then calls
			// applyBlockedCompletionContinuationOutcome.
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 0))
			expect(h.sendLog.length).toBe(1)

			// HBCLO01 HEADLINE: the production lifecycle
			// consumer (TaskTelemetryTracker.recordRuntimeError)
			// MUST have been invoked with a typed
			// RuntimeErrorIncident. The CURRENT production
			// code does NOT make this call — the test FAILS,
			// proving the missing owner wiring.
			expect(h.taskTelemetry.recordRuntimeError).toHaveBeenCalled()
			const calls = h.taskTelemetry.recordRuntimeError.mock.calls
			expect(calls.length).toBeGreaterThanOrEqual(1)
			const incident = calls[0]?.[0] as RuntimeErrorIncident
			expect(incident).toBeDefined()
			// Typed verdict: reuses an existing closed-enum
			// value so the tracker is a no-op branch
			// (cumulative wire field is the same).
			expect(incident.errorClass).toBe("UNKNOWN_RUNTIME_ERROR")
			// Source: an additive new value on the closed
			// RuntimeErrorSource enum (V1 webview ignores
			// the string; safe additive change).
			expect(incident.source).toBe("completion-continuation-stalled")
			// correlationId carries the (sessionId|taskId)
			// for forensic trace; existing V1 contract.
			expect(typeof incident.correlationId).toBe("string")
		})

		it("HBCLO-02: delivery_rejected publication invokes taskTelemetry.recordRuntimeError with typed incident", async () => {
			const h = makeHarness({
				heldJobIds: SEVEN_HELD_IDS,
				continuationResult: () => Promise.resolve({ kind: "rejected" as const }),
			})
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 0))
			expect(h.sendLog.length).toBe(0)

			expect(h.taskTelemetry.recordRuntimeError).toHaveBeenCalled()
			const calls = h.taskTelemetry.recordRuntimeError.mock.calls
			expect(calls.length).toBeGreaterThanOrEqual(1)
			const incident = calls[0]?.[0] as RuntimeErrorIncident
			expect(incident.errorClass).toBe("UNKNOWN_RUNTIME_ERROR")
			expect(incident.source).toBe("completion-continuation-delivery-rejected")
			expect(typeof incident.correlationId).toBe("string")
		})
	})

	describe("NEGATIVE CONTROL — non-blocked outcomes MUST NOT publish to the lifecycle consumer", () => {
		it("HBCLO-10: a delivered outcome does not invoke recordRuntimeError (the marker is the only state change)", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 0))
			expect(h.sendLog.length).toBe(1)

			expect(h.taskTelemetry.recordRuntimeError).not.toHaveBeenCalled()
		})
	})

	describe("CONSERVATION — C11 invariant: blocked verdict does NOT fabricate task completion", () => {
		it("HBCLO-20: while the marker is held and the verdict is blocked, getTurnPhase() !== 'completed'", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 0))

			const phase = h.coordinator["options"].getTurnPhase?.()
			expect(phase).not.toBe("completed")
			expect(phase).toBe("idle")
		})
	})
})
