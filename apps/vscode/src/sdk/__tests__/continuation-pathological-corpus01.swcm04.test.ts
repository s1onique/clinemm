/**
 * ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01
 *
 * CONTINUATION-PATHOLOGICAL corpus — turns the "Your turn" /
 * premature-handoff / autonomous-continuation failure family into
 * executable behavioral contracts rather than screenshot-driven
 * debugging.
 *
 * PRODUCTION FAITHFULNESS (per ACT §10):
 *
 *   The harness drives the SAME production classes that the live
 *   controller drives:
 *
 *     - BackgroundNotifyCoordinator (real)
 *     - CommandJobManager (real)
 *     - SdkSessionEventCoordinator (real) — the canonical handoff
 *       decision seam at setTurnPhase("completed", ...)
 *     - MessageTranslatorState (real)
 *     - TurnStateTracker (real)
 *     - MessageIdMinter (real)
 *
 *   The `enqueueTerminalWake` callback routes through a
 *   `TestPendingPromptQueue` that simulates the canonical
 *   `PendingPromptsController.enqueue` behavior. The coordinator
 *   reads pending-prompt count via `getPendingPromptCount`, which
 *   the harness wires to the same queue the wake callback enqueues
 *   into. This is the SAME shape the Q5 barrier
 *   (`outstandingAutonomousWork`) reads in production.
 *
 *   NO production code is modified. NO production wiring is changed.
 *
 * OBSERVABLES (per ACT §5):
 *
 *   - completionCommitCount: incremented inside the
 *     `setTurnPhase("completed", ...)` spy. This is the
 *     canonical "user-attention handoff" observation.
 *   - queue.countForSession(activeSessionId): the live pending-prompt
 *     count, read from the SAME queue the wake callback enqueues into.
 *   - getDeferredCompletionBarrierForTesting(): the deferred marker
 *     (sessionId, taskId, epoch) triple exposed by the coordinator.
 *     A non-undefined marker means the coordinator REFUSED to commit
 *     completion and is HOLDING for outstanding obligations to
 *     resolve. A undefined marker after `done` means the coordinator
 *     DID commit.
 *   - notifyCoordinator.activeNotifyCountForOwner / hasActiveNotify:
 *     real notify-owned marker state.
 *
 * CENTRAL INVARIANT (per ACT §6):
 *
 *   outstandingAutonomousWork =
 *       pendingPromptAuthorityUnknown
 *       || pendingPromptsKnown > 0
 *       || activeNotifyCount > 0
 *       || perJobOutstandingNotifyWork
 *
 *   When the coordinator's deferred-completion-barrier admission
 *   guard observes `outstandingAutonomousWork === true` at the
 *   originating turn's `done`, it MUST register the deferred
 *   marker and MUST NOT call `setTurnPhase("completed", ...)`.
 *   When the marker is later cleared by the wake-driven terminal,
 *   the barrier re-evaluates and commits the held completion
 *   EXACTLY ONCE.
 *
 * WAKE DELIVERY SIMULATION:
 *
 *   The harness does NOT rely on the fakeSupervisor's `exit` promise
 *   (which never resolves in tests). Instead, scenarios that need a
 *   wake to land in the queue call `notifyCoordinator.consumeTerminal
 *   (...)` directly. This drives the SAME production code path:
 *   `consumeTerminal` -> `dispatchAndTrackWake` -> the
 *   `enqueueTerminalWake` callback (the host-owned transport).
 *   The harness's enqueueTerminalWake enqueues into the test queue.
 *
 * CLASSIFICATION (per ACT §7):
 *
 *   PASS_CURRENT       — behavior matches the central invariant
 *   FAIL_CURRENT       — observed premature completion OR observed
 *                        dropped/duplicate continuation
 *   NOT_APPLICABLE     — production source has no such seam
 *   LIVE_UNOBSERVABLE  — harness cannot drive the seam
 *
 * This ACT does NOT repair. It classifies.
 */

import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
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

let supervisorPid = 92000
function fakeSupervisor(): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: ++supervisorPid,
		pgid: supervisorPid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "started\nfinished\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	})
}

/**
 * Simulates the canonical PendingPromptService queue. Mirrors the
 * production behavior in `pending-prompt-service.ts`:
 *   - `enqueue` is the SAME path the live host callback routes
 *     through (`active.sdkHost.send({ delivery: "queue", jobId })`).
 *   - `delivery: "queue"` appends; `delivery: "steer"` unshift
 *     (priority enqueue).
 *   - `countForSession(sessionId)` is the read-back that
 *     `getPendingPromptCount` returns.
 */
class TestPendingPromptQueue {
	private readonly items: {
		id: string
		sessionId: string
		prompt: string
		jobId?: string
		delivery: "queue" | "steer"
	}[] = []

	enqueue(input: { sessionId: string; prompt: string; jobId?: string; delivery?: "queue" | "steer" }): string {
		const delivery = input.delivery ?? "queue"
		const id = `pp-${this.items.length + 1}`
		const entry = {
			id,
			sessionId: input.sessionId,
			prompt: input.prompt,
			...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
			delivery,
		}
		if (delivery === "steer") {
			this.items.unshift(entry)
		} else {
			this.items.push(entry)
		}
		return id
	}

	deleteByJobId(jobId: string): number {
		let removed = 0
		for (let i = this.items.length - 1; i >= 0; i--) {
			if (this.items[i].jobId === jobId) {
				this.items.splice(i, 1)
				removed++
			}
		}
		return removed
	}

	deleteById(id: string): number {
		const idx = this.items.findIndex((q) => q.id === id)
		if (idx < 0) return 0
		this.items.splice(idx, 1)
		return 1
	}

	countForSession(sessionId: string): number {
		return this.items.filter((q) => q.sessionId === sessionId).length
	}

	itemsForSession(sessionId: string): readonly { id: string; jobId?: string; delivery: "queue" | "steer" }[] {
		return this.items.filter((q) => q.sessionId === sessionId)
	}

	clearForSession(sessionId: string): void {
		for (let i = this.items.length - 1; i >= 0; i--) {
			if (this.items[i].sessionId === sessionId) {
				this.items.splice(i, 1)
			}
		}
	}
}

function makeSdkHost(queue: TestPendingPromptQueue) {
	return {
		pendingPrompts: (action: string, input: { sessionId: string; promptId?: string } | undefined) => {
			if (action === "count") {
				return { available: true as const, count: queue.countForSession(input?.sessionId ?? "") }
			}
			if (action === "list") {
				return queue
					.itemsForSession(input?.sessionId ?? "")
					.map((q) => ({ id: q.id, jobId: q.jobId, delivery: q.delivery }))
			}
			if (action === "delete") {
				if (input?.promptId) return { deleted: queue.deleteById(input.promptId) }
				return { deleted: 0 }
			}
			throw new Error(`Unhandled pendingPrompts action: ${action}`)
		},
	}
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	notifyCoordinator: BackgroundNotifyCoordinator
	queue: TestPendingPromptQueue
	activeSessionId: string
	activeTaskId: string
	appendAndEmit: ReturnType<typeof vi.fn>
	completionCommitCount: () => number
	pendingPromptCountAtTurnEnd: () => number
	activeNotifyCountAtTurnEnd: () => number
	deferredMarkerSessionId: () => string | undefined
}

/**
 * Drive the wake directly at the notify-coordinator boundary
 * (instead of waiting for the fakeSupervisor's `exit` promise
 * which never resolves). This calls the SAME production code path
 * that `start.terminalPromise.then(...) -> consumeTerminal(...)`
 * would call in the live controller: `consumeTerminal` invokes
 * `dispatchAndTrackWake` which calls the `enqueueTerminalWake`
 * callback (the host-owned transport). The harness's callback
 * enqueues into the test queue, mirroring what the live
 * `PendingPromptService.enqueue` does in production.
 */
function driveNotifyTerminal(notifyCoordinator: BackgroundNotifyCoordinator, jobId: string): void {
	notifyCoordinator.consumeTerminal({
		jobId,
		terminalState: "exited",
		exitCode: 0,
		reason: undefined,
		isContainmentFailed: false,
	})
}

function makeHarness(): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = "session-swcm04"
	const activeTaskId = "task-swcm04"

	const supervisor = fakeSupervisor()
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => supervisor,
	})

	const queue = new TestPendingPromptQueue()
	const sdkHost = makeSdkHost(queue)

	let now = 0
	let completionCommitCount = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: async ({ sessionId, prompt, jobId: jid }) => {
			// Production-real: enqueue into the SAME queue the
			// coordinator reads via getPendingPromptCount. Mirrors
			// the live Controller's enqueueTerminalWake callback.
			queue.enqueue({
				sessionId,
				prompt,
				delivery: "queue",
				...(jid !== undefined ? { jobId: jid } : {}),
			})
			return { kind: "delivered" as const }
		},
		now: () => ++now,
	})

	const appendAndEmit = vi.fn()
	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: { appendAndEmit },
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
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => manager.hasRunningBackgroundJobForOwner(activeSessionId),
		getPendingPromptCount: (ownerSessionId: string | undefined) =>
			sdkHost.pendingPrompts("count", { sessionId: ownerSessionId ?? "" }),
		getActiveNotifyCount: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId),
		hasActiveNotify: (j: string) => notifyCoordinator.hasActiveNotify(j),
		wasWakeDelivered: (j: string) => notifyCoordinator.wasWakeDelivered(j),
		wasWakeDispatchRequested: (j: string) => notifyCoordinator.wasWakeDispatchRequested(j),
		wasWakeDispatchFailed: (j: string) => notifyCoordinator.wasWakeDispatchFailed(j),
		isWakeAuthoritySettled: (j: string) => notifyCoordinator.isWakeAuthoritySettled(j),
	} as never)

	return {
		coordinator,
		tracker,
		translatorState,
		manager,
		notifyCoordinator,
		queue,
		activeSessionId,
		activeTaskId,
		appendAndEmit,
		completionCommitCount: () => completionCommitCount,
		pendingPromptCountAtTurnEnd: () => queue.countForSession(activeSessionId),
		activeNotifyCountAtTurnEnd: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId),
		deferredMarkerSessionId: () => coordinator.getDeferredCompletionBarrierForTesting()?.sessionId,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

async function emitOriginatingDone(h: Harness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	const doneEvent = agentEvent(h.activeSessionId, {
		type: "done",
		reason: "completed",
		text: "Task completed.",
		iterations: 1,
	})
	await h.coordinator.handleSessionEvent(doneEvent)
}

describe("ACT-CLINEMM-SW-CM04-CONTINUATION-PATHOLOGICAL-CORPUS01 — pathological corpus", () => {
	// ---------------------------------------------------------------------
	// P1 — SIMPLE USER TURN / NO AUTONOMOUS WORK
	// ---------------------------------------------------------------------
	it("SWCM04-P1: simple user turn, no autonomous work, no pending prompt, no wake -> completion commits normally", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// No notify marker. No pending prompt. Originating turn completes.
		await emitOriginatingDone(h)

		// INVARIANT: completion commits exactly once, no deferred marker,
		// no premature hold.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.deferredMarkerSessionId()).toBeUndefined()
		expect(h.activeNotifyCountAtTurnEnd()).toBe(0)
		expect(h.pendingPromptCountAtTurnEnd()).toBe(0)
	})

	// ---------------------------------------------------------------------
	// P2 — NOTIFY-OWNED BACKGROUND JOB
	// ---------------------------------------------------------------------
	it("SWCM04-P2: notify-owned background job -> completion held (deferred marker), wake-driven turn commits exactly once", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// Spawn a notify-owned background job, register the marker.
		const start = await h.manager.start({
			command: "/bin/sh -c 'sleep 0.05; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		expect(start.state).toBe("running")
		h.notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})
		expect(h.notifyCoordinator.hasActiveNotify(start.jobId)).toBe(true)

		// Originating turn completes BEFORE the wake fires. INVARIANT:
		// completion SUPPRESSED because hasActiveNotify(J) === true
		// (perJobOutstandingNotifyWork=true), and the deferred marker
		// is set.
		await emitOriginatingDone(h)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.deferredMarkerSessionId()).toBe(h.activeSessionId)

		// Drive the wake to land in the queue.
		driveNotifyTerminal(h.notifyCoordinator, start.jobId)
		// Yield for the wake-delivery promise chain to settle.
		await new Promise((resolve) => setTimeout(resolve, 30))

		// INVARIANT: exactly one pending prompt for this sessionId
		// (Path A delivered).
		expect(h.pendingPromptCountAtTurnEnd()).toBe(1)
		expect(h.notifyCoordinator.wasWakeDelivered(start.jobId)).toBe(true)

		// Simulate the wake-driven runTurn completing: the barrier
		// re-evaluates and commits the held completion EXACTLY ONCE.
		// We use reevaluateDeferredCompletionBarrier directly because
		// the wake-driven turn in production is async; for the
		// invariant under test, we just need to clear the queue and
		// drive the re-evaluation.
		h.queue.clearForSession(h.activeSessionId)
		h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(1)
	})

	// ---------------------------------------------------------------------
	// P3 — PENDING PROMPT ALREADY QUEUED AT TURN END
	// ---------------------------------------------------------------------
	it("SWCM04-P3: pending prompt already queued at turn end -> completion held, no user-attention projection", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// Simulate a pending prompt already in the queue (NOT from a
		// wake — could be from steer / explicit enqueue / system
		// message that arrived mid-turn).
		h.queue.enqueue({
			sessionId: h.activeSessionId,
			prompt: "Pending user steer prompt",
			delivery: "queue",
		})
		expect(h.pendingPromptCountAtTurnEnd()).toBe(1)

		await emitOriginatingDone(h)

		// INVARIANT: completion HELD because pendingPromptsKnown > 0.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.deferredMarkerSessionId()).toBe(h.activeSessionId)

		// Now drain the queue (simulate the pending prompt's runTurn
		// firing). The barrier re-evaluates and commits.
		h.queue.clearForSession(h.activeSessionId)
		h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(1)
	})

	// ---------------------------------------------------------------------
	// P4 — QUEUE EMPTY CONTROL (negative of P3)
	// ---------------------------------------------------------------------
	it("SWCM04-P4: no pending prompt, no notify -> completion commits normally (queue-empty control)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		expect(h.pendingPromptCountAtTurnEnd()).toBe(0)
		expect(h.activeNotifyCountAtTurnEnd()).toBe(0)

		await emitOriginatingDone(h)

		// INVARIANT: completion commits normally; no hold.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.deferredMarkerSessionId()).toBeUndefined()
	})

	// ---------------------------------------------------------------------
	// P5 — STEER / PROMOTED QUEUE HEAD
	// ---------------------------------------------------------------------
	it("SWCM04-P5: steer entry promoted to head of queue -> completion held, drain clears in steer order", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// Two prompts: FIFO first, then steer promoted to head.
		h.queue.enqueue({
			sessionId: h.activeSessionId,
			prompt: "FIFO prompt 1",
			delivery: "queue",
		})
		h.queue.enqueue({
			sessionId: h.activeSessionId,
			prompt: "STEERED prompt (head)",
			delivery: "steer",
		})
		h.queue.enqueue({
			sessionId: h.activeSessionId,
			prompt: "FIFO prompt 2",
			delivery: "queue",
		})

		// INVARIANT: steer is at head. The drain order is steered first.
		const order = h.queue.itemsForSession(h.activeSessionId).map((q) => q.delivery)
		expect(order).toEqual(["steer", "queue", "queue"])

		await emitOriginatingDone(h)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.deferredMarkerSessionId()).toBe(h.activeSessionId)

		// Clear all three queued prompts (drain simulation).
		h.queue.clearForSession(h.activeSessionId)
		h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(1)
	})

	// ---------------------------------------------------------------------
	// P6 — BACKGROUND WAKE + NORMAL USER QUEUE
	// ---------------------------------------------------------------------
	it("SWCM04-P6: background wake + ordinary queue prompt co-exist -> deterministic ordering, no duplicate continuation", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// Spawn a notify-owned background job.
		const start = await h.manager.start({
			command: "/bin/sh -c 'sleep 0.05; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		h.notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})

		// Pre-existing ordinary user prompt in the queue.
		h.queue.enqueue({
			sessionId: h.activeSessionId,
			prompt: "Pre-existing user prompt",
			delivery: "queue",
		})

		await emitOriginatingDone(h)
		// INVARIANT: completion held (notify-owned marker alive AND
		// pendingPromptsKnown > 0 — BOTH reasons).
		expect(h.completionCommitCount()).toBe(0)
		expect(h.deferredMarkerSessionId()).toBe(h.activeSessionId)

		// Drive the wake to land in the queue.
		driveNotifyTerminal(h.notifyCoordinator, start.jobId)
		await new Promise((resolve) => setTimeout(resolve, 30))
		// Two pending prompts now: the original user one + the wake.
		expect(h.pendingPromptCountAtTurnEnd()).toBe(2)

		// Drain both. Barrier re-evaluates with both notifications
		// resolved.
		h.queue.clearForSession(h.activeSessionId)
		h.coordinator.reevaluateDeferredCompletionBarrier()
		// INVARIANT: completion commits exactly ONCE (not twice for
		// the two-drain sequence). The barrier's commit is single-shot.
		expect(h.completionCommitCount()).toBe(1)
	})

	// ---------------------------------------------------------------------
	// P7 — COMPLETION TOOL + AUTONOMOUS WORK OUTSTANDING
	// ---------------------------------------------------------------------
	it("SWCM04-P7: notify-owned J + Path A wake drained BEFORE completion tool -> completion held until wake ack", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const start = await h.manager.start({
			command: "/bin/sh -c 'sleep 0.05; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		h.notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})

		// Drive the wake to land in the queue BEFORE the originating
		// turn fires submit_and_exit (Path A drained first).
		driveNotifyTerminal(h.notifyCoordinator, start.jobId)
		await new Promise((resolve) => setTimeout(resolve, 30))

		// Now the originating turn fires submit_and_exit.
		await emitOriginatingDone(h)

		// INVARIANT: per the C10 framework barrier (already proven
		// load-bearing), the originating completion is SUPPRESSED
		// because wasWakeDelivered(J) === true.
		expect(h.completionCommitCount()).toBe(0)
		// The pending prompt queue still has the wake.
		expect(h.pendingPromptCountAtTurnEnd()).toBe(1)
	})

	// ---------------------------------------------------------------------
	// P8 — LOST WAKE (dispatch rejected)
	// ---------------------------------------------------------------------
	it("SWCM04-P8: lost wake (dispatch rejected) -> completion allowed (lost-wake protocol)", async () => {
		// P8 requires a wake transport that returns "rejected" /
		// "session_gone" so the coordinator drives
		// markWakeDispatchFailed internally.
		const minter = new MessageIdMinter()
		const tracker = new TurnStateTracker(minter)
		const translatorState = new MessageTranslatorState(minter)
		const activeSessionId = "session-swcm04-p8"
		const activeTaskId = "task-swcm04-p8"

		const supervisor = fakeSupervisor()
		const manager = new CommandJobManager({
			maxWaitBudgetMs: 50,
			spawnFactory: () => supervisor,
		})

		const queue = new TestPendingPromptQueue()
		const sdkHost = makeSdkHost(queue)

		let now = 0
		let completionCommitCount = 0
		const notifyCoordinator = new BackgroundNotifyCoordinator({
			resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
			enqueueTerminalWake: async () => {
				// Lost-wake: transport rejected. The wake never
				// lands in PendingPromptsController (the queue
				// must NOT reflect a phantom prompt).
				return { kind: "rejected" as const }
			},
			now: () => ++now,
		})

		const appendAndEmit = vi.fn()
		const coordinator = new SdkSessionEventCoordinator({
			messageTranslatorState: translatorState,
			sessions: {
				getActiveSession: () => ({
					sessionId: activeSessionId,
					sdkHost,
					unsubscribe: vi.fn(),
					startResult: { sessionId: activeSessionId },
					isRunning: false,
				}),
				setRunning: vi.fn(),
			},
			messages: { appendAndEmit },
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
			getTurnPhase: () => tracker.currentPhase,
			translateSessionEvent,
			hasRunningBackgroundJobForOwner: () => manager.hasRunningBackgroundJobForOwner(activeSessionId),
			getPendingPromptCount: () => sdkHost.pendingPrompts("count", { sessionId: activeSessionId }),
			getActiveNotifyCount: () => notifyCoordinator.activeNotifyCountForOwner(activeSessionId, activeTaskId),
			hasActiveNotify: (j: string) => notifyCoordinator.hasActiveNotify(j),
			wasWakeDelivered: (j: string) => notifyCoordinator.wasWakeDelivered(j),
			wasWakeDispatchRequested: (j: string) => notifyCoordinator.wasWakeDispatchRequested(j),
			wasWakeDispatchFailed: (j: string) => notifyCoordinator.wasWakeDispatchFailed(j),
			isWakeAuthoritySettled: (j: string) => notifyCoordinator.isWakeAuthoritySettled(j),
		} as never)

		tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const start = await manager.start({
			command: "/bin/sh -c 'sleep 0.05; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: activeSessionId,
			taskId: activeTaskId,
		})

		// Drive the wake (transport rejects).
		driveNotifyTerminal(notifyCoordinator, start.jobId)
		await new Promise((resolve) => setTimeout(resolve, 30))

		// INVARIANT: no phantom prompt — the rejected transport
		// must not have enqueued.
		expect(queue.countForSession(activeSessionId)).toBe(0)
		expect(notifyCoordinator.wasWakeDispatchFailed(start.jobId)).toBe(true)

		// Drive the originating turn.
		translatorState.setAttemptCompletionSeen()
		translatorState.setTerminalResponseCommittedThisTurn()
		const doneEvent = agentEvent(activeSessionId, {
			type: "done",
			reason: "completed",
			text: "Task completed.",
			iterations: 1,
		})
		await coordinator.handleSessionEvent(doneEvent)

		// INVARIANT: lost-wake protocol ALLOWs the originating
		// completion. completionCommitCount = 1.
		expect(completionCommitCount).toBe(1)
		expect(coordinator.getDeferredCompletionBarrierForTesting()).toBeUndefined()
	})

	// ---------------------------------------------------------------------
	// P9 — TWO NOTIFY-OWNED JOBS
	// ---------------------------------------------------------------------
	it("SWCM04-P9: two notify-owned jobs, J1 fires first -> completion held until both wake acks resolve", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const j1 = await h.manager.start({
			command: "/bin/sh -c 'sleep 0.02; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		const j2 = await h.manager.start({
			command: "/bin/sh -c 'sleep 0.2; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		h.notifyCoordinator.registerMarker({ jobId: j1.jobId, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: j2.jobId, sessionId: h.activeSessionId, taskId: h.activeTaskId })

		// J1 fires first. Because J2 is still alive, the wake
		// for J1 is HELD by the dual-delivery arbitration
		// (background-notify-coordinator.ts:1013-1027): the
		// marker-count guard defers dispatching J1's wake until
		// ALL pending markers for this owner are terminal. The
		// queue is empty.
		driveNotifyTerminal(h.notifyCoordinator, j1.jobId)
		await new Promise((resolve) => setTimeout(resolve, 30))

		// INVARIANT: J1 wake HELD (queue empty); J2 marker still
		// alive.
		expect(h.pendingPromptCountAtTurnEnd()).toBe(0)
		expect(h.notifyCoordinator.hasActiveNotify(j2.jobId)).toBe(true)
		expect(h.notifyCoordinator.hasActiveNotify(j1.jobId)).toBe(false) // marker drained, wake held

		// Now originating turn fires submit_and_exit. INVARIANT:
		// completion held because perJobOutstandingNotifyWork
		// includes J2 (its marker is still alive).
		await emitOriginatingDone(h)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.deferredMarkerSessionId()).toBe(h.activeSessionId)

		// J2 fires. With J1's held wake ready, the dispatch is
		// now triggered for BOTH J1 (held-then-released) and J2
		// (immediate).
		driveNotifyTerminal(h.notifyCoordinator, j2.jobId)
		await new Promise((resolve) => setTimeout(resolve, 30))

		// INVARIANT: both wakes delivered (two pending prompts).
		expect(h.pendingPromptCountAtTurnEnd()).toBe(2)

		// Drain and re-evaluate. completionCommitCount = 1.
		h.queue.clearForSession(h.activeSessionId)
		h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(1)
	})

	// ---------------------------------------------------------------------
	// P10 — FAST TERMINAL RACE
	// ---------------------------------------------------------------------
	it("SWCM04-P10: fast terminal race (job exits around turn end) -> deterministic outcome, no duplicate continuation", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const start = await h.manager.start({
			command: "/bin/sh -c 'sleep 0.01; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		h.notifyCoordinator.registerMarker({
			jobId: start.jobId,
			sessionId: h.activeSessionId,
			taskId: h.activeTaskId,
		})

		// Fire the terminal BEFORE the originating turn's done.
		// The wake may race with the completion tool.
		driveNotifyTerminal(h.notifyCoordinator, start.jobId)
		await new Promise((resolve) => setTimeout(resolve, 30))

		// Queue has the wake.
		expect(h.pendingPromptCountAtTurnEnd()).toBe(1)

		await emitOriginatingDone(h)

		// INVARIANT: either ordering is acceptable per ACT §4, but
		// the invariants hold:
		//   - continuation <= exactly once (1 wake-driven turn enqueued)
		//   - no premature user-attention boundary
		//   - no hang
		//   - no duplicate wake (the queue should not contain MORE
		//     than one entry for this jobId)
		const items = h.queue.itemsForSession(h.activeSessionId)
		const wakesForJob = items.filter((q) => q.jobId === start.jobId)
		expect(wakesForJob.length).toBe(1)
		expect(h.completionCommitCount()).toBe(0) // SUPPRESSED (wake delivered)
		expect(h.deferredMarkerSessionId()).toBe(h.activeSessionId)
	})

	// ---------------------------------------------------------------------
	// P11 — USER INPUT ACTUALLY REQUIRED (FALSE_AUTOCONTINUE control)
	// ---------------------------------------------------------------------
	it("SWCM04-P11: ask-user-question tool called -> completion must NOT auto-commit (FALSE_AUTOCONTINUE control)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// Simulate an ask_user_question tool completion by emitting a
		// tool execution message; the originating turn ends WITHOUT a
		// submit_and_exit (no terminal commit) and the user-attention
		// boundary is allowed.
		const toolEvent = agentEvent(h.activeSessionId, {
			type: "tool_result",
			name: "ask_user_question",
			text: "Which option do you prefer?",
		})
		await h.coordinator.handleSessionEvent(toolEvent)

		// INVARIANT: completion NOT committed because the originating
		// turn did not call submit_and_exit. The user-attention
		// boundary is allowed (FALSE_AUTOCONTINUE control).
		expect(h.completionCommitCount()).toBe(0)
		expect(h.deferredMarkerSessionId()).toBeUndefined() // no marker either
	})

	// ---------------------------------------------------------------------
	// P12 — ACT-MODE / SYNTHETIC CONTINUATION CONTROL
	// ---------------------------------------------------------------------
	it("SWCM04-P12: NOT_APPLICABLE in current production source (no plan->act synthetic continuation seam)", async () => {
		// Recon §1 confirms: the ClineMM current source has NO
		// synthetic-continuation path between plan and act modes. The
		// upstream Cline synthetic continuation flow is NOT
		// implemented in ClineMM. Per ACT §4 P12: mark
		// NOT_APPLICABLE; do not simulate upstream-only behavior.
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// Baseline: ordinary turn completes normally.
		await emitOriginatingDone(h)
		expect(h.completionCommitCount()).toBe(1)
		// P12 is therefore NOT_APPLICABLE in current production.
		// No assertion beyond baseline; the classification lives in
		// result.json.
		expect(true).toBe(true)
	})

	// ---------------------------------------------------------------------
	// ADVERSARIAL — A. duplicate pending prompt IDs
	// ---------------------------------------------------------------------
	it("SWCM04-A: duplicate jobIds in enqueue -> each enqueue is a distinct queue entry (idempotency is by call, not by jobId)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// Enqueue the same jobId twice (e.g., a retry).
		h.queue.enqueue({
			sessionId: h.activeSessionId,
			prompt: "wake for J",
			jobId: "J",
			delivery: "queue",
		})
		h.queue.enqueue({
			sessionId: h.activeSessionId,
			prompt: "wake for J (retry)",
			jobId: "J",
			delivery: "queue",
		})
		// INVARIANT: both enqueued. Production enqueue is by-call, not
		// by jobId-dedup. The barrier suppresses J's originating
		// completion based on wasWakeDelivered(J) === true at submit
		// time, NOT by counting queue entries.
		expect(h.pendingPromptCountAtTurnEnd()).toBe(2)
	})

	// ---------------------------------------------------------------------
	// ADVERSARIAL — B. stale prompt deleted before drain
	// ---------------------------------------------------------------------
	it("SWCM04-B: stale prompt deleted before drain -> queue length drops, barrier releases", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		h.queue.enqueue({
			sessionId: h.activeSessionId,
			prompt: "stale wake",
			jobId: "J",
			delivery: "queue",
		})
		await emitOriginatingDone(h)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.deferredMarkerSessionId()).toBe(h.activeSessionId)

		// Delete the stale entry.
		const removed = h.queue.deleteByJobId("J")
		expect(removed).toBe(1)
		expect(h.pendingPromptCountAtTurnEnd()).toBe(0)

		// Re-evaluate. INVARIANT: completion commits once.
		h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(1)
	})

	// ---------------------------------------------------------------------
	// ADVERSARIAL — E. two jobIds, only one becomes terminal
	// ---------------------------------------------------------------------
	it("SWCM04-E: two jobIds registered, only one terminal -> completion HELD (the other marker still alive)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		const j1 = await h.manager.start({
			command: "/bin/sh -c 'sleep 0.02; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		const j2 = await h.manager.start({
			command: "/bin/sh -c 'sleep 5; exit 0'",
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
			cwd: process.cwd(),
		})
		h.notifyCoordinator.registerMarker({ jobId: j1.jobId, sessionId: h.activeSessionId, taskId: h.activeTaskId })
		h.notifyCoordinator.registerMarker({ jobId: j2.jobId, sessionId: h.activeSessionId, taskId: h.activeTaskId })

		// Only J1 fires.
		driveNotifyTerminal(h.notifyCoordinator, j1.jobId)
		await new Promise((resolve) => setTimeout(resolve, 30))

		await emitOriginatingDone(h)

		// INVARIANT: completion HELD because J2's marker is still alive.
		expect(h.completionCommitCount()).toBe(0)
		expect(h.deferredMarkerSessionId()).toBe(h.activeSessionId)
		expect(h.notifyCoordinator.hasActiveNotify(j2.jobId)).toBe(true)
	})

	// ---------------------------------------------------------------------
	// ADVERSARIAL — H. disappeared session / owner mismatch
	// ---------------------------------------------------------------------
	it("SWCM04-H: sessionId mismatch between marker and active session -> marker resolution returns session_gone path", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// Register a marker for a DIFFERENT sessionId.
		h.notifyCoordinator.registerMarker({
			jobId: "J-other",
			sessionId: "session-other",
			taskId: "task-other",
		})

		// The active session has no markers. INVARIANT: the
		// sessionId mismatch does not pollute the active session's
		// pending-prompt count or notify count. completion commits.
		await emitOriginatingDone(h)
		expect(h.completionCommitCount()).toBe(1)
		expect(h.activeNotifyCountAtTurnEnd()).toBe(0)
	})
})
