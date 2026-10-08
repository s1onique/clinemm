/**
 * ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-CONSUMER-PROBE01 — HBOCP01
 *
 * Recon-level executable probe. The predecessor
 * ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-PUBLICATION01 left a typed
 * `reason` on the `DeferredCompletionBarrier` marker. The
 * outstanding P0 question:
 *
 *     Does the existing production scheduler consumer
 *     (SdkSessionRebuildScheduler.drain via the
 *     `isDeferredCompletionOutstanding` predicate wired from
 *     `SdkController` to the live
 *     `SdkSessionEventCoordinator.isDeferredCompletionBarrierOutstandingForTesting`)
 *     actually behave differently for a `reason=stalled_no_progress`
 *     barrier vs. an ordinary held barrier, or does it just see a
 *     boolean and hold both the same way?
 *
 *     If the scheduler holds both identically, then the missing
 *     consumer is ELSEWHERE in the host lifecycle.
 *
 * This probe drives the REAL production scheduler with a closure
 * predicate that captures the marker's `reason` value on every
 * read, so the consumer-side observability is preserved while
 * the production boolean is exercised unchanged. It also drives
 * the real `enqueueCompletionContinuationIfHeld` →
 * `applyBlockedCompletionContinuationOutcome` chain to confirm
 * the producer→consumer path produces the same scheduler
 * effect regardless of reason.
 *
 * Hard rule: no new mock framework, no fabricated harness. The
 * scheduler is the actual `SdkSessionRebuildScheduler`; the
 * coordinator is the actual `SdkSessionEventCoordinator`. The
 * only mocks are the existing lightweight ones (Logger,
 * StateManager) that every other suite in this directory uses.
 *
 * Predicted outcome (pre-probe): the scheduler's drain decision
 * is identical for `reason=undefined` and
 * `reason="stalled_no_progress"`, because the production wiring
 * at `SdkController.ts:2775` binds the predicate to
 * `isDeferredCompletionBarrierOutstandingForTesting()` which is
 * a pure `!== undefined` check. If the probe confirms this, the
 * scheduler is not the wrong consumer — it is correctly holding
 * the safety invariant; the missing host consumer is elsewhere.
 */

import { type CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator } from "../sdk-session-event-coordinator"
import { SdkSessionRebuildScheduler } from "../sdk-session-rebuild-scheduler"
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

interface Observer {
	readonly reads: ReadonlyArray<{ outstanding: boolean; reason: string | undefined }>
	readonly predicate: () => boolean
	reset: () => void
}

/**
 * Production-shape predicate: identical signature to
 * `SdkController.ts:2775` which binds
 *   () => sessionEvents.isDeferredCompletionBarrierOutstandingForTesting()
 * The closure additionally records every read so the test can
 * observe the consumer-side view of the marker without
 * altering the production boolean. The scheduler's decision
 * is driven ONLY by the boolean.
 */
function makeObserver(coordinator: SdkSessionEventCoordinator): Observer {
	const reads: Array<{ outstanding: boolean; reason: string | undefined }> = []
	const predicate = () => {
		const outstanding = coordinator.isDeferredCompletionBarrierOutstandingForTesting()
		const barrier = coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
		reads.push({ outstanding, reason: barrier?.reason })
		return outstanding
	}
	return {
		get reads() {
			return reads
		},
		predicate,
		reset() {
			reads.length = 0
		},
	}
}

const SEVEN_HELD_IDS: readonly string[] = ["j1", "j2", "j3", "j4", "j5", "j6", "j7"]

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
	translatorState: { setAttemptCompletionSeen: () => void; setTerminalResponseCommittedThisTurn: () => void },
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

interface Harness {
	coordinator: SdkSessionEventCoordinator
	observer: Observer
	scheduler: SdkSessionRebuildScheduler
	sessionId: string
	taskId: string
	rebuild: () => Promise<void>
	heldJobIdsRef: readonly string[]
	countRef: number
}

function makeHarness(opts: { sessionId?: string; taskId?: string; heldJobIds?: readonly string[] } = {}): Harness {
	const sessionId = opts.sessionId ?? "session-hbocp01"
	const taskId = opts.taskId ?? "task-hbocp01"
	const heldJobIds = opts.heldJobIds ?? SEVEN_HELD_IDS
	const harnessRef: { current: Harness } = { current: undefined as unknown as Harness }
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sendLog: Array<{ prompt: string; sessionId: string; taskId?: string }> = []
	const defaultContinuation = (input: { sessionId: string; taskId: string | undefined; heldJobIds: readonly string[] }) => {
		sendLog.push({
			prompt: `mock:${input.heldJobIds.join(",")}`,
			sessionId: input.sessionId,
			taskId: input.taskId,
		})
		return Promise.resolve({ kind: "delivered" as const })
	}
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
		getTask: () => ({ taskId: harnessRef.current?.taskId ?? taskId }) as never,
		postStateToWebview: async () => undefined,
		setTurnPhase: ((phase: string) => tracker.set(phase as never)) as never,
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
		enqueueCompletionContinuation: defaultContinuation,
	} as unknown as ConstructorParameters<typeof SdkSessionEventCoordinator>[0])
	const observer = makeObserver(coordinator)
	const rebuild = vi.fn(async () => undefined) as unknown as () => Promise<void>
	const scheduler = new SdkSessionRebuildScheduler({
		sessions: {
			getActiveSession: () => ({ sessionId, isRunning: false }) as never,
		},
		// The production wiring shape (SdkController.ts:2775):
		//   setIsDeferredCompletionOutstanding(() =>
		//     sessionEvents.isDeferredCompletionBarrierOutstandingForTesting()
		//   )
		// Our observer wraps that same boolean read and additionally
		// records the `reason` for observation. The boolean drives
		// the scheduler; the reason is recorded but does not
		// influence the drain decision.
		isDeferredCompletionOutstanding: observer.predicate,
	})
	const h: Harness = {
		coordinator,
		observer,
		scheduler,
		sessionId,
		taskId,
		rebuild,
		heldJobIdsRef: heldJobIds,
		countRef: heldJobIds.length,
	}
	harnessRef.current = h
	return h
}

describe("ACT-CLINEMM-P0-HOST-BLOCKED-OUTCOME-CONSUMER-PROBE01 — HBOCP01", () => {
	beforeEach(() => {
		// No global state to manage; observer is per-harness.
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("PROBE-01 — Recoverable hold (reason=undefined)", () => {
		it("HBOCP-01: barrier exists with reason=undefined → drain held, no rebuild", async () => {
			const h = makeHarness()
			h.coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: h.sessionId,
				taskId: h.taskId,
				epoch: 0,
			})
			const seeded = h.coordinator.getDeferredCompletionBarrierForTesting()
			expect(seeded).toBeDefined()
			expect(seeded?.reason).toBeUndefined()

			h.observer.reset()
			h.scheduler.request("mcpTools", h.rebuild)
			await h.scheduler.waitUntilSettled()

			expect(h.rebuild).not.toHaveBeenCalled()
			const reads = h.observer.reads
			expect(reads.length).toBeGreaterThan(0)
			const sawTrue = reads.some((r) => r.outstanding === true && r.reason === undefined)
			expect(sawTrue).toBe(true)
		})
	})

	describe("PROBE-02 — Stalled hold (reason='stalled_no_progress')", () => {
		it("HBOCP-02: barrier exists with reason='stalled_no_progress' → drain held, no rebuild", async () => {
			const h = makeHarness()
			h.coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: h.sessionId,
				taskId: h.taskId,
				epoch: 0,
			})
			const helper = h.coordinator as unknown as {
				applyBlockedCompletionContinuationOutcome: (
					captured: { sessionId: string; taskId: string | undefined; enqueueEpoch: number },
					outcome: { kind: "stalled_no_progress" },
				) => void
			}
			helper.applyBlockedCompletionContinuationOutcome(
				{ sessionId: h.sessionId, taskId: h.taskId, enqueueEpoch: 0 },
				{ kind: "stalled_no_progress" },
			)
			const stamped = h.coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
			expect(stamped?.reason).toBe("stalled_no_progress")

			h.observer.reset()
			h.scheduler.request("mcpTools", h.rebuild)
			await h.scheduler.waitUntilSettled()

			// DECISIVE OBSERVATION: the scheduler sees `true` and
			// holds. Same as PROBE-01. The reason is observable
			// in the observer, but the scheduler's decision is
			// boolean-only.
			expect(h.rebuild).not.toHaveBeenCalled()
			const reads = h.observer.reads
			expect(reads.length).toBeGreaterThan(0)
			const sawStalled = reads.some((r) => r.outstanding === true && r.reason === "stalled_no_progress")
			expect(sawStalled).toBe(true)
		})
	})

	describe("PROBE-03 — Delivery rejection (reason='delivery_rejected')", () => {
		it("HBOCP-03: barrier exists with reason='delivery_rejected' → drain held, no rebuild", async () => {
			const h = makeHarness()
			h.coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: h.sessionId,
				taskId: h.taskId,
				epoch: 0,
			})
			const helper = h.coordinator as unknown as {
				applyBlockedCompletionContinuationOutcome: (
					captured: { sessionId: string; taskId: string | undefined; enqueueEpoch: number },
					outcome: { kind: "rejected" },
				) => void
			}
			helper.applyBlockedCompletionContinuationOutcome(
				{ sessionId: h.sessionId, taskId: h.taskId, enqueueEpoch: 0 },
				{ kind: "rejected" },
			)
			const stamped = h.coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
			expect(stamped?.reason).toBe("delivery_rejected")

			h.observer.reset()
			h.scheduler.request("mcpTools", h.rebuild)
			await h.scheduler.waitUntilSettled()

			expect(h.rebuild).not.toHaveBeenCalled()
			const reads = h.observer.reads
			expect(reads.length).toBeGreaterThan(0)
			const sawRejected = reads.some((r) => r.outstanding === true && r.reason === "delivery_rejected")
			expect(sawRejected).toBe(true)
		})
	})

	describe("PROBE-04 — Barrier absence releases the hold", () => {
		// REVIEWER NOTE (PASS_WITH_NONBLOCKING_RESIDUE):
		// This probe uses the test-only setter
		// `setDeferredCompletionBarrierForTesting(undefined)` to
		// clear the marker, followed by
		// `scheduler.deferredCompletionSettled()` to wake the
		// scheduler. It proves the scheduler releases when the
		// barrier is ABSENT, NOT the causal path from real
		// held-result consumption to marker removal. The
		// production path that clears the marker after a real
		// terminal-result consumption is the BCB01 §0.1
		// conservation predicates' success branch (a different
		// test seam, exercised by HBOP-30 and PCRA01; see also
		// `mcp-tool-restart-deferred-completion-barrier`).
		// This probe is a necessary but not sufficient witness
		// for the conservation claim: it confirms the scheduler
		// does not hold drain in a barrier-absent state, which
		// is the converse of the held states in PROBE-01..03.
		it("HBOCP-04: barrier removed (test seam) + deferredCompletionSettled → drain resumes, rebuild runs", async () => {
			const h = makeHarness()
			h.coordinator.setDeferredCompletionBarrierForTesting({
				sessionId: h.sessionId,
				taskId: h.taskId,
				epoch: 0,
			})
			const helper = h.coordinator as unknown as {
				applyBlockedCompletionContinuationOutcome: (
					captured: { sessionId: string; taskId: string | undefined; enqueueEpoch: number },
					outcome: { kind: "stalled_no_progress" },
				) => void
			}
			helper.applyBlockedCompletionContinuationOutcome(
				{ sessionId: h.sessionId, taskId: h.taskId, enqueueEpoch: 0 },
				{ kind: "stalled_no_progress" },
			)

			h.observer.reset()
			h.scheduler.request("mcpTools", h.rebuild)
			await h.scheduler.waitUntilSettled()
			expect(h.rebuild).not.toHaveBeenCalled()

			// Remove the barrier (test seam) and wake the
			// scheduler. The held rebuild now drains.
			h.coordinator.setDeferredCompletionBarrierForTesting(undefined)
			h.scheduler.deferredCompletionSettled()
			await h.scheduler.waitUntilSettled()

			expect(h.rebuild).toHaveBeenCalledOnce()
			expect(h.coordinator.getDeferredCompletionBarrierForTesting()).toBeUndefined()
		})
	})

	describe("PROBE-05 — Real producer→consumer chain", () => {
		it("HBOCP-05: K delivers, K+1 stalls → marker carries reason; scheduler sees true boolean", async () => {
			const h = makeHarness()
			// biome-ignore lint/suspicious/noExplicitAny: test seam
			const translatorState = (h.coordinator as any).options.messageTranslatorState as {
				setAttemptCompletionSeen: () => void
				setTerminalResponseCommittedThisTurn: () => void
			}
			// K: deliver
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			// K+1: stall → marker stamped
			await emitCompletionTurn(h.coordinator, translatorState, h.sessionId)
			await new Promise<void>((r) => setTimeout(r, 0))

			const barrier = h.coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
			expect(barrier).toBeDefined()
			expect(barrier?.reason).toBe("stalled_no_progress")

			h.observer.reset()
			h.scheduler.request("mcpTools", h.rebuild)
			await h.scheduler.waitUntilSettled()

			expect(h.rebuild).not.toHaveBeenCalled()
			const reads = h.observer.reads
			expect(reads.some((r) => r.outstanding === true && r.reason === "stalled_no_progress")).toBe(true)
		})
	})

	describe("PROBE-06 — C7 discriminator: scheduler decisions bit-identical across reason states", () => {
		it("HBOCP-06: production wiring's deferred-outstanding predicate returns true for all three reason states", async () => {
			const h = makeHarness()
			const states: Array<{
				name: string
				reason: "stalled_no_progress" | "delivery_rejected" | undefined
			}> = [
				{ name: "recoverable", reason: undefined },
				{ name: "stalled", reason: "stalled_no_progress" },
				{ name: "rejected", reason: "delivery_rejected" },
			]
			const observations: Array<{ name: string; outstanding: boolean; reason: string | undefined }> = []
			for (const s of states) {
				h.coordinator.setDeferredCompletionBarrierForTesting({
					sessionId: h.sessionId,
					taskId: h.taskId,
					epoch: 0,
				})
				if (s.reason) {
					const helper = h.coordinator as unknown as {
						applyBlockedCompletionContinuationOutcome: (
							captured: { sessionId: string; taskId: string | undefined; enqueueEpoch: number },
							outcome: unknown,
						) => void
					}
					// Pass the full discriminated union shape so the
					// helper's narrow `outcome.kind` check is the
					// ONLY discriminator consulted (mirrors the
					// production `.then((outcome) => ...)` payload).
					const out =
						s.reason === "stalled_no_progress"
							? { kind: "stalled_no_progress" as const }
							: {
									kind: "rejected" as const,
									heldJobIds: ["j1", "j2", "j3", "j4", "j5", "j6", "j7"] as const,
									continuationSessionEpoch: "x|y|0",
								}
					helper.applyBlockedCompletionContinuationOutcome(
						{ sessionId: h.sessionId, taskId: h.taskId, enqueueEpoch: 0 },
						out,
					)
				}
				const outstanding = h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()
				const barrier = h.coordinator.getDeferredCompletionBarrierForTesting() as { reason?: string } | undefined
				observations.push({ name: s.name, outstanding, reason: barrier?.reason })
			}
			// All three states produce outstanding=true at the
			// predicate the production wiring binds. The reason is
			// a strict refinement of the boolean and is NOT a
			// second bit — the scheduler sees a single true.
			expect(observations.every((o) => o.outstanding === true)).toBe(true)
			expect(observations.find((o) => o.name === "recoverable")?.reason).toBeUndefined()
			expect(observations.find((o) => o.name === "stalled")?.reason).toBe("stalled_no_progress")
			expect(observations.find((o) => o.name === "rejected")?.reason).toBe("delivery_rejected")
		})
	})
})
