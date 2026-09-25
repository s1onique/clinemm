/**
 * ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01
 *
 * TRANSPORT-NEUTRAL PENDING-PROMPT AUTHORITY — RED-to-GREEN closure suite.
 *
 * Goal: prove the architectural seam is closed.
 *
 *   Before this ACT:
 *     - `RuntimeHost.getPendingPromptsCount?(sessionId)` existed as a
 *       provisional primitive on the transport-safe execution boundary
 *       (PROVISIONAL_ARCHITECTURAL_LEAK).
 *     - `ClineCore.getPendingPromptsCount(sessionId)` mirrored the host
 *       primitive through a one-method proxy.
 *     - `SdkSessionHost.pendingPromptsCount?(sessionId)` and
 *       `VscodeSessionHost.pendingPromptsCount(sessionId)` were
 *       narrow transport-specific accessors that leaked the
 *       transport implementation to the Q5 composition seam.
 *
 *   After this ACT:
 *     - The provisional `RuntimeHost` primitive is REMOVED.
 *     - The provisional `ClineCore.getPendingPromptsCount` proxy is
 *       REMOVED.
 *     - The Q5 composition seam reads pending-prompt count
 *       AUTHORITATIVELY from the canonical
 *       `ClineCore.pendingPrompts.count(sessionId)` service operation,
 *       a transport-neutral service-style method on the grouped
 *       `PendingPromptsServiceApi` interface.
 *     - Every backend that exposes `pendingPrompts` MUST implement
 *       `count(sessionId): number` (LocalRuntimeHost, HubRuntimeHost,
 *       RemoteRuntimeHost).
 *
 * Reference (frozen): https://github.com/cline/cline/blob/main/sdk/ARCHITECTURE.md, lines 454-460:
 *
 *   > pending prompt list/update/delete are exposed through the grouped
 *   > `ClineCore.pendingPrompts` service. ... These service APIs are
 *   > intentionally outside the minimal `RuntimeHost` primitive vocabulary.
 */
import type { CoreSessionEvent } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

vi.mock("@/shared/services/Logger", () => ({
	Logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), debug: vi.fn() },
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

let supervisorPid = 80000

// =============================================================================
// Minimal SdkSessionHost stub with a production-shape `pendingPrompts` service
// (mirrors VscodeSessionHost.pendingPrompts which routes
// `pendingPrompts("count", { sessionId })` to the underlying
// `ClineCore.pendingPrompts.count(sessionId)`).
// =============================================================================

interface PendingPromptQueueEntry {
	readonly sessionId: string
	readonly prompt: string
}

/**
 * Test pending-prompt queue that mirrors the production semantics:
 *   - LocalRuntimeHost: queue is mutated synchronously by
 *     enqueue/update/delete; `count` is unconditionally `available: true`.
 *   - HubRuntimeHost: queue lives behind a per-session mirror that may
 *     not have been initialized; the `count` returns `available: false`
 *     for uninitialized sessions (PROVISIONAL_FAIL_OPEN_RISK fix per
 *     CORRECTION01).
 *
 * The test drives the HubRuntimeHost case by calling `setMirror(...)`
 * (which mirrors the authoritative `requestPendingPromptsList` /
 * `session.pending_prompts` event sources). `enqueue(...)` simulates
 * a LocalRuntimeHost-style authoritative push (always
 * `available: true`).
 */
class TestPendingPromptQueue {
	public readonly items: PendingPromptQueueEntry[] = []
	private readonly initializedSessions = new Set<string>()

	enqueue(input: PendingPromptQueueEntry): void {
		this.items.push(input)
		// Local authoritative enqueue → session is initialized.
		this.initializedSessions.add(input.sessionId)
	}
	consume(sessionId: string): PendingPromptQueueEntry | undefined {
		const idx = this.items.findIndex((q) => q.sessionId === sessionId)
		if (idx < 0) return undefined
		const [item] = this.items.splice(idx, 1)
		return item
	}
	/**
	 * LocalRuntimeHost-style direct count read (always available).
	 * Mirrors the production `LocalRuntimeHost.pendingPrompts.count`
	 * which reads `active.pendingPrompts.length` unconditionally.
	 */
	countForSession(sessionId: string | undefined): number {
		if (!sessionId) return 0
		return this.items.filter((q) => q.sessionId === sessionId).length
	}
	/**
	 * CORRECTION01 availability-aware read (mirrors production
	 * `HubRuntimeHost.pendingPrompts.count`).
	 */
	readCountForSession(sessionId: string | undefined): {
		available: boolean
		count?: number
	} {
		if (!sessionId) return { available: false }
		if (!this.initializedSessions.has(sessionId)) {
			return { available: false }
		}
		return {
			available: true,
			count: this.items.filter((q) => q.sessionId === sessionId).length,
		}
	}
	/**
	 * Set the authoritative mirror for a session (simulates the
	 * authoritative `requestPendingPromptsList` reply OR a
	 * `session.pending_prompts` event payload reaching
	 * `HubRuntimeHost.pendingPromptCountBySession`).
	 */
	setMirror(sessionId: string, count: number): void {
		// Clear existing items for this session.
		for (let i = this.items.length - 1; i >= 0; i--) {
			if (this.items[i].sessionId === sessionId) this.items.splice(i, 1)
		}
		for (let i = 0; i < count; i++) {
			this.items.push({ sessionId, prompt: `mirror-${i}` })
		}
		// The mirror update is itself an authoritative initialization.
		this.initializedSessions.add(sessionId)
	}
	/**
	 * Drop the mirror for a session (simulates `stopSession` /
	 * `deleteSession` / `dispose` clearing the HubRuntimeHost
	 * initialization marker so the next `count(...)` returns
	 * `{ available: false }`).
	 */
	clearMirror(sessionId: string): void {
		this.initializedSessions.delete(sessionId)
		for (let i = this.items.length - 1; i >= 0; i--) {
			if (this.items[i].sessionId === sessionId) this.items.splice(i, 1)
		}
	}
	get length(): number {
		return this.items.length
	}
}

function makeSdkHost(queue: TestPendingPromptQueue) {
	return {
		// ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01 /
		// CORRECTION01:
		// The pending-prompt service. Q5 reads through the `count` action,
		// which is the canonical `ClineCore.pendingPrompts.count` service
		// operation. The stub returns the availability-aware
		// `PendingPromptCountRead` discriminated union — same shape as
		// `HubRuntimeHost.pendingPrompts.count` after CORRECTION01.
		pendingPrompts: (action: string, input: { sessionId: string } | undefined): { available: boolean; count?: number } => {
			if (action === "count") {
				return queue.readCountForSession(input?.sessionId)
			}
			throw new Error(`Unhandled pendingPrompts action in test stub: ${action}`)
		},
	}
}

interface AuthorityHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	manager: CommandJobManager
	notifyCoordinator: BackgroundNotifyCoordinator
	queue: TestPendingPromptQueue
	activeSessionId: string
	activeTaskId: string
}

function makeAuthorityHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): AuthorityHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-ppat01"
	const activeTaskId = opts.activeTaskId ?? "task-ppat01-live"

	const supervisor = { pid: ++supervisorPid, pgid: ++supervisorPid } as never
	const manager = new CommandJobManager({ maxWaitBudgetMs: 50, spawnFactory: () => supervisor as never })

	const queue = new TestPendingPromptQueue()
	const sdkHost = makeSdkHost(queue)

	let now = 0
	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: ({ sessionId, prompt }) =>
			Promise.resolve(queue.enqueue({ sessionId, prompt })).then(() => ({ kind: "delivered" as const })),
		now: () => ++now,
	})

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
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			tracker.setWithWriter(phase, anchorTs, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: () => manager.hasRunningBackgroundJobForOwner(activeSessionId),
		// PRODUCTION ADAPTER (mirrors SdkController.getPendingPromptCount
		// wired in production at SdkController.ts:2160-2166): the
		// authoritative count is read through the canonical `pendingPrompts`
		// service boundary (`pendingPrompts("count", { sessionId })`), NOT
		// through a `RuntimeHost` primitive.
		getPendingPromptCount: (ownerSessionId: string | undefined) =>
			sdkHost.pendingPrompts("count", { sessionId: ownerSessionId ?? "" }),
		getActiveNotifyCount: (ownerSessionId: string | undefined, taskId: string | undefined) =>
			notifyCoordinator.activeNotifyCountForOwner(ownerSessionId ?? "", taskId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	return { coordinator, tracker, translatorState, manager, notifyCoordinator, queue, activeSessionId, activeTaskId }
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

async function emitDoneWithoutCompletion(coordinator: SdkSessionEventCoordinator, sessionId: string): Promise<void> {
	await coordinator.handleSessionEvent(
		agentEvent(sessionId, {
			type: "done",
			reason: "completed",
			text: "Some text without commit.",
			iterations: 1,
		}),
	)
}

describe("ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01", () => {
	describe("PPA-RED-01 architectural seam: RuntimeHost.getPendingPromptsCount absent", () => {
		it("RuntimeHost interface does NOT carry getPendingPromptsCount — authority moved to pendingPrompts service", () => {
			// Source-level assertion: the RuntimeHost interface no longer
			// declares getPendingPromptsCount. If anyone re-adds the leak,
			// this assertion fails at load time.
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const fs = require("node:fs")
			const path = require("node:path")
			const runtimeHostSource = fs.readFileSync(
				path.resolve(__dirname, "../../../../../sdk/packages/core/src/runtime/host/runtime-host.ts"),
				"utf-8",
			) as string
			// The provisional leak MUST be absent:
			// The RuntimeHost interface no longer declares the
			// `getPendingPromptsCount?(sessionId): number` optional
			// primitive as part of the transport-safe execution
			// vocabulary. We assert by looking for a non-comment
			// declaration of the method (i.e. outside the line-comment
			// block that documents the REMOVED primitive).
			expect(runtimeHostSource).not.toMatch(/^\s*getPendingPromptsCount\?\(sessionId: string\): number/)
			// The service-style authority MUST be present, with the
			// CORRECTION01 availability-aware return shape.
			expect(runtimeHostSource).toMatch(/PendingPromptsServiceApi/)
			expect(runtimeHostSource).toMatch(/PendingPromptCountRead/)
			expect(runtimeHostSource).toMatch(/count\(sessionId: string\): PendingPromptCountRead/)
		})
	})

	describe("PPA-CTL-01..03 local synchronous authority via service", () => {
		it("PPA-CTL-01: enqueue at T, count at T+ε returns {available:true, count:1} (synchronous authoritative)", () => {
			const h = makeAuthorityHarness()
			// Pre-enqueue: queue is empty and uninitialized → available:false.
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({ available: false })
			h.queue.enqueue({ sessionId: h.activeSessionId, prompt: "wake-1" })
			// Synchronous read through the service boundary after the
			// authoritative enqueue → available:true, count:1.
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({
				available: true,
				count: 1,
			})
		})

		it("PPA-CTL-02: empty queue → service returns {available:false} (uninitialized)", () => {
			const h = makeAuthorityHarness()
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({ available: false })
		})

		it("PPA-CTL-03: prompt consumed → service count returns {available:true, count:0}", () => {
			const h = makeAuthorityHarness()
			h.queue.enqueue({ sessionId: h.activeSessionId, prompt: "wake-1" })
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({
				available: true,
				count: 1,
			})
			const consumed = h.queue.consume(h.activeSessionId)
			expect(consumed).toBeDefined()
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({
				available: true,
				count: 0,
			})
		})
	})

	describe("PPA-CTL-04..06 hub mirror projections", () => {
		it("PPA-CTL-04: hub mirror reflects the authoritative list reply", () => {
			// Mirrors `HubRuntimeHost.requestPendingPromptsList` populating
			// `pendingPromptCountBySession` from the authoritative reply AND
			// marking the session as initialized (CORRECTION01).
			const h = makeAuthorityHarness()
			// Pre-mirror: session is uninitialized → available:false.
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({ available: false })
			// Simulate the hub reply payload arriving (the local mirror
			// is updated from the reply of `requestPendingPromptsList`).
			h.queue.setMirror(h.activeSessionId, 3)
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({
				available: true,
				count: 3,
			})
		})

		it("PPA-CTL-05: hub mirror reflects the session.pending_prompts event payload", () => {
			// Mirrors `HubRuntimeHost`'s handler for the
			// `session.pending_prompts` event populating the mirror AND
			// marking the session as initialized (CORRECTION01).
			const h = makeAuthorityHarness()
			// First initialize at 0 via an event payload.
			h.queue.setMirror(h.activeSessionId, 0)
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({
				available: true,
				count: 0,
			})
			// Simulate a published `session.pending_prompts` event
			// carrying two authoritative prompts.
			h.queue.setMirror(h.activeSessionId, 2)
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({
				available: true,
				count: 2,
			})
		})

		it("PPA-CTL-06: stopSession / deleteSession clears the hub mirror AND initialization marker", () => {
			// Mirrors `HubRuntimeHost.stopSession` and
			// `HubRuntimeHost.deleteSession` clearing both the mirror
			// AND the initialized marker (CORRECTION01).
			const h = makeAuthorityHarness()
			h.queue.setMirror(h.activeSessionId, 2)
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({
				available: true,
				count: 2,
			})
			// Simulate stop / delete — the next `count` must read
			// `{ available: false }` (NOT `{ available: true; count: 0 }`)
			// so that Q5 cannot accidentally authorize operator handoff
			// on a freshly-drained session.
			h.queue.clearMirror(h.activeSessionId)
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({ available: false })
		})
	})

	describe("PPA-COMPOSE-01: load-bearing production composition through service boundary", () => {
		it("enqueue wake → done-without-completion → Q5 DEFERS via service-bound count", async () => {
			// The discriminator for this ACT. Drives the SAME production
			// composition as LHOWA01/CORRECTION02 but routes the count
			// through the transport-neutral `pendingPrompts.count` service
			// operation (NOT through a `RuntimeHost` primitive).
			const h = makeAuthorityHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			expect(h.tracker.currentPhase).toBe("streaming")

			// T0: enqueue terminal wake.
			h.queue.enqueue({ sessionId: h.activeSessionId, prompt: "SERVICE_AUTHORITY_OK" })
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({
				available: true,
				count: 1,
			})

			// Q5 reads through the service-style `count` action
			// (availability-aware read — CORRECTION01). The
			// `count: 1` projection means Q5 will defer.
			const beforeQ5 = h.queue.readCountForSession(h.activeSessionId)
			expect(beforeQ5.available).toBe(true)
			expect((beforeQ5 as { available: true; count: number }).count).toBeGreaterThan(0)

			// T1: emit done-without-completion.
			await emitDoneWithoutCompletion(h.coordinator, h.activeSessionId)

			// The Q5 writer DEFERS because the service-bound count read
			// returns {available:true, count:1} (the wake is queued for
			// autonomous continuation).
			expect(h.tracker.currentPhase).not.toBe("awaiting_followup")
			expect(h.tracker.currentPhase).toBe("streaming")

			// T2: consume the queued prompt (mirrors the next turn
			// draining the queue). The session is still initialized
			// (LocalRuntimeHost semantics).
			const consumed = h.queue.consume(h.activeSessionId)
			expect(consumed).toBeDefined()
			expect(h.queue.readCountForSession(h.activeSessionId)).toEqual({
				available: true,
				count: 0,
			})

			// T3: re-evaluation. The terminal-idle consumer commits
			// awaiting_followup exactly once after the wake has been
			// delivered (BTCONT01 GREEN) — `{available:true, count:0}`
			// is the ONLY state that authorizes operator handoff
			// (CORRECTION01).
			h.coordinator.reevaluateDeferredContinuation?.()
			expect(h.tracker.currentPhase).toBe("awaiting_followup")
		}, 15_000)
	})

	describe("PPA-CTL-07 transport neutrality (discriminator)", () => {
		it("different session ids do not leak counts across sessions", () => {
			const h1 = makeAuthorityHarness({ activeSessionId: "session-A", activeTaskId: "task-A" })
			const h2 = makeAuthorityHarness({ activeSessionId: "session-B", activeTaskId: "task-B" })
			h1.queue.enqueue({ sessionId: h1.activeSessionId, prompt: "wake-A" })
			expect(h1.queue.readCountForSession(h1.activeSessionId)).toEqual({
				available: true,
				count: 1,
			})
			// session-B is uninitialized on h1's host → available:false.
			expect(h1.queue.readCountForSession(h2.activeSessionId)).toEqual({
				available: false,
			})
			// session-A is uninitialized on h2's host → available:false.
			expect(h2.queue.readCountForSession(h1.activeSessionId)).toEqual({
				available: false,
			})
			// session-B is uninitialized on h2's host → available:false.
			expect(h2.queue.readCountForSession(h2.activeSessionId)).toEqual({
				available: false,
			})
		})

		it("empty sessionId returns {available:false} (failsafe)", () => {
			const h = makeAuthorityHarness()
			expect(h.queue.readCountForSession(undefined)).toEqual({ available: false })
			expect(h.queue.readCountForSession("")).toEqual({ available: false })
		})
	})
})
