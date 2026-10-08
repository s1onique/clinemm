/**
 * ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01 / MAPPING01-CORRECTION01 — HBCLO01
 *
 * Bounded producer-to-consumer wiring test. Authorizes the
 * MAPPING01 contract and pins its invariants on the REAL
 * production seam.
 *
 *   Predecessor:
 *     ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-OWNER01
 *     (4d57e8d97; PASS_BLOCKED_COMPLETION_LIFECYCLE_OWNER_FROZEN)
 *     identified `TaskTelemetryTracker.recordRuntimeError(incident)`
 *     as the existing production lifecycle consumer and froze
 *     the bounded repair contract: one additive call site
 *     inside the existing
 *     `applyBlockedCompletionContinuationOutcome(...)` helper
 *     (AFTER the C4 guards pass + AFTER the marker stamp) +
 *     one additive new value on the closed `RuntimeErrorSource`
 *     enum.
 *
 *   Factory reviewer (PASS_WITH_ONE_P1) correction:
 *     The P1 finding required this ACT to make both RED cases
 *     GREEN immediately, AND to prove producer → actual
 *     `TaskTelemetryTracker` → real TaskHeader telemetry
 *     projection. A mocked `recordRuntimeError` call alone is
 *     insufficient. This test therefore holds a REAL
 *     `TaskTelemetryTracker` instance (the same single source
 *     of truth the production SdkController thread-through hands
 *     to the shared-host coordinator) and asserts the
 *     cumulative in-memory counter
 *     (`tracker.currentRuntimeErrorCount`) and the
 *     `TaskHeaderTelemetryStrip.runtimeErrorCount` wire field
 *     (`tracker.get()?.runtimeErrorCount`) — the latter is the
 *     field the webview TaskHeader reads to render the `⚠ N`
 *     glyph.
 *
 *   Production seam exercised (end-to-end):
 *       SdkSessionEventCoordinator.handleSessionEvent
 *         → enqueueCompletionContinuationIfHeld
 *           → Promise<EnqueueCompletionContinuationOutcome>
 *             → .then((outcome) => applyBlockedCompletionContinuationOutcome)
 *               → C4 adversarial guards
 *                 → marker stamp (typed `reason`)
 *                 → dogfood counter increment (existing)
 *                 → taskTelemetry.recordRuntimeError(incident) ← NEW
 *                   → tracker.runtimeErrorCount++ (cumulative)
 *                     → TaskHeaderTelemetryStrip.runtimeErrorCount (wire)
 *                       → webview TaskHeader `⚠ N` glyph
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
 *   (ExtensionMessage.ts:1042-1056) — the two additive new
 *   `RuntimeErrorSource` values are closed-enum extensions
 *   that never reach the wire.
 */
import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyCompletionContinuationUpstreamDiagnosticProfile } from "../dogfood-diagnostic-profile"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import type { SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { SdkSessionEventCoordinator } from "../sdk-session-event-coordinator"
import { TaskTelemetryTracker } from "../task-telemetry-tracker"
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
 * ACT-CLINEMM-P0-BLOCKED-COMPLETION-LIFECYCLE-MAPPING01 / MAPPING01-CORRECTION01:
 *
 * The harness holds a REAL `TaskTelemetryTracker` instance (the
 * production lifecycle consumer; the same single-source-of-truth
 * the production SdkController thread-through hands to the
 * shared-host coordinator). The factory reviewer's P1 finding
 * requires the producer → actual `TaskTelemetryTracker` → real
 * TaskHeader telemetry projection proof; a mocked
 * `recordRuntimeError` call alone is insufficient. The
 * assertions therefore read the real
 * `TaskHeaderTelemetryStrip.runtimeErrorCount` wire field
 * (`tracker.get()?.runtimeErrorCount`) and the cumulative
 * in-memory counter (`tracker.currentRuntimeErrorCount`).
 */
interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly taskTelemetry: TaskTelemetryTracker
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
	// HBCLO01-MAPPING01-CORRECTION01: the REAL
	// `TaskTelemetryTracker` (the production lifecycle consumer;
	// same single-source-of-truth the SdkController
	// thread-through hands to the shared-host coordinator).
	// The factory reviewer's P1 finding requires the producer
	// → actual `TaskTelemetryTracker` → real TaskHeader
	// telemetry projection proof; a mocked
	// `recordRuntimeError` call alone is insufficient.
	const taskTelemetry = new TaskTelemetryTracker()
	taskTelemetry.startTask(taskId, 1_700_000_000_000)
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
		taskTelemetry,
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
		it("HBCLO-01: stalled_no_progress publication reaches the real TaskTelemetryTracker (wire projection)", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			// K: real submit_and_exit → BCB registers barrier →
			// continuation delivered, STALL snapshot pinned.
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			expect(h.sendLog.length).toBe(1)
			// Pre-stall baseline: zero runtime-error incidents
			// (K is delivered, not a blocked verdict).
			expect(h.taskTelemetry.currentRuntimeErrorCount).toBe(0)
			expect(h.taskTelemetry.get()?.runtimeErrorCount).toBeUndefined() // zero-hiding

			// K+1: real submit_and_exit → BCB re-registration
			// runs → enqueueIfHeld sees priorSortedHeld ===
			// [j1..j7] and the new held set is identical, so
			// the upstream TS disc returns { kind:
			// "stalled_no_progress" } and the production
			// callback's .then calls
			// applyBlockedCompletionContinuationOutcome,
			// which (after the C4 guards pass and the marker
			// stamp) now invokes the production lifecycle
			// consumer `taskTelemetry.recordRuntimeError(...)`.
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 0))
			expect(h.sendLog.length).toBe(1)

			// HBCLO01-MAPPING01-CORRECTION01 HEADLINE: the real
			// production lifecycle consumer
			// (`TaskTelemetryTracker.recordRuntimeError`) was
			// invoked end-to-end through the production
			// `SdkSessionEventCoordinator.handleSessionEvent` →
			// `enqueueCompletionContinuationIfHeld` → `.then` →
			// `applyBlockedCompletionContinuationOutcome` seam.
			//
			// The factory reviewer's P1 finding requires the
			// producer → actual `TaskTelemetryTracker` → real
			// TaskHeader telemetry projection proof; a mocked
			// `recordRuntimeError` call alone is insufficient.
			// The cumulative `currentRuntimeErrorCount` is
			// the in-memory counter, and `get()?.runtimeErrorCount`
			// is the `TaskHeaderTelemetryStrip.runtimeErrorCount`
			// wire field that the webview TaskHeader reads to
			// render the `⚠ N` glyph.
			expect(h.taskTelemetry.currentRuntimeErrorCount).toBe(1)
			const wire = h.taskTelemetry.get()
			expect(wire).toBeDefined()
			expect(wire?.runtimeErrorCount).toBe(1)
		})

		it("HBCLO-02: delivery_rejected publication reaches the real TaskTelemetryTracker (wire projection)", async () => {
			const h = makeHarness({
				heldJobIds: SEVEN_HELD_IDS,
				continuationResult: () => Promise.resolve({ kind: "rejected" as const }),
			})
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 0))
			expect(h.sendLog.length).toBe(0)

			// Same projection proof as HBCLO-01; the
			// `rejected` callback outcome is the parallel
			// blocked verdict.
			expect(h.taskTelemetry.currentRuntimeErrorCount).toBe(1)
			const wire = h.taskTelemetry.get()
			expect(wire).toBeDefined()
			expect(wire?.runtimeErrorCount).toBe(1)
		})
	})

	describe("NEGATIVE CONTROL — non-blocked outcomes MUST NOT publish to the lifecycle consumer", () => {
		it("HBCLO-10: a delivered outcome does not increment the lifecycle counter (the marker is the only state change)", async () => {
			const h = makeHarness({ heldJobIds: SEVEN_HELD_IDS })
			const translatorState = h.coordinator["options"].messageTranslatorState

			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 0))
			expect(h.sendLog.length).toBe(1)

			// The cumulative `runtimeErrorCount` remains 0;
			// the wire field is omitted (zero-hiding per
			// the REC-09 invariant). The webview TaskHeader
			// hides the `⚠ N` glyph (data-testid absent).
			expect(h.taskTelemetry.currentRuntimeErrorCount).toBe(0)
			expect(h.taskTelemetry.get()?.runtimeErrorCount).toBeUndefined()
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
