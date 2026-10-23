// ============================================================================
// ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01 — RED
//
// DISCRIMINATOR: the on-call expert verdict requires us to prove
// which boundary (no-active-session OR sdkHost.abort never
// settles) breaks the webview Cancel path. The previous
// `sdk-task-control-coordinator.ts:cancelTask()` collapsed
// FOUR sub-boundaries into one opaque function, so neither
// hypothesis was observable.
//
// REQUIRED RED (per ACT §4):
//
//   RED-A1 (Healthy):   req=1, acc=1, inv=1, cmp=1, pub=1
//   RED-A2 (H-A):       req=1, acc=0, inv=0, cmp=0, pub=1
//   RED-B  (H-B):       req=1, acc=1, inv=1, cmp=0, pub=0
//
// ACT-CLINEMM-P0-POST-TERMINAL-LIFECYCLE-LIVENESS01 (PTLL01-L2) CHANGED
// THE H-A ROW. The predecessor RED asserted `pub=0` and
// `raiseCancelFence` NOT called — i.e. it pinned the DEFECTIVE behavior in
// place: a Cancel with no active session produced NO lifecycle transition, so
// the committed webview state kept saying `streaming`, the TaskHeader kept
// offering Working + Cancel, and re-clicking re-entered the same no-op
// forever. That is the false-Working defect this ACT repairs.
//
// The repaired H-A row is `(req=1, acc=0, inv=0, cmp=0, pub=1)`: there is
// still no abort target (`acc/inv/cmp` stay 0 — nothing was aborted), but the
// fence IS raised and the state IS published, so the task reaches a truthful,
// supported recovery phase. The discriminator still separates H-A from H-B:
// H-A never invokes abort, H-B invokes it and stalls on the await.
//
// Each test uses the REAL `SdkTaskControlCoordinator` with the
// REAL `TaskOperationFence`. The "active session" and
// "sdkHost.abort settlement" sub-boundaries are controlled via
// hand-written vi.fn() mocks of the SdkTaskControlCoordinator's
// dependency seams (`sessions`, `interactions`, `messages`,
// etc.) — they are NOT real `SdkSessionLifecycle` /
// `SdkSessionHost` instances (see
// apps/vscode/src/sdk/sdk-session-lifecycle.ts for the real
// lifecycle). The mocks drive the actual failing boundary (per
// ACT §4 RED property #8): a `gateAbort` flag holds the awaited
// `sdkHost.abort(sessionId)` open, mirroring the H-B signature
// the real boundary could exhibit. No direct test-body call to
// the suspected helpers; no fake
// `cancel_published` / `cancel_accepted`; no test-owned
// constants; no arbitrary sleeps as the causal mechanism.
//
// After each test, the diagnostic is reset and re-disabled in
// the `afterEach` block to keep the public default-off contract
// (per ACT §15 REMOVAL_TRIGGER).
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	getCancelLivenessDiagnosticSnapshot,
	isCancelLivenessDiagnosticEnabled,
	resetCancelLivenessDiagnostic,
	setCancelLivenessDiagnosticEnabled,
} from "../cancel-liveness-diagnostic"
import type { ActiveSession } from "../cline-session-factory"
import { SdkTaskControlCoordinator, type SdkTaskControlCoordinatorOptions } from "../sdk-task-control-coordinator"
import type { SdkSessionHost } from "../session-host"
import { TaskOperationFence } from "../task-operation-fence"
import { createTaskProxy } from "../task-proxy"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

/** Bounded test timeout for the never-settles test. */
const MAX_ABORT_WAIT_MS = 250

interface TestSessionOptions {
	readonly sessionId: string
	/**
	 * If true, the abort await hangs until `release()` is called
	 * (the test simulates the H-B boundary). If false/undefined,
	 * abort resolves immediately (Healthy / H-A paths).
	 */
	readonly gateAbort?: boolean
}

function makeControlledSession(opts: TestSessionOptions): {
	readonly session: ActiveSession
	readonly release: () => void
} {
	let release: () => void = () => {}
	const abortMock = vi.fn(async (sessionId: string) => {
		if (opts.gateAbort) {
			await new Promise<void>((resolve) => {
				release = resolve
			})
		}
		void sessionId
	})

	const sdkHost = {
		abort: abortMock,
	} as unknown as SdkSessionHost

	const session = {
		sessionId: opts.sessionId,
		sdkHost,
		isRunning: true,
		startConfig: { taskId: opts.sessionId, mode: "act" as const, enableAutoApprove: false, enableQueuedPrompts: false },
		unsubscribe: vi.fn(),
	} as unknown as ActiveSession

	return { session, release: () => release() }
}

function makeCoordinatorOptions(input: { readonly activeSession: ActiveSession | undefined }): SdkTaskControlCoordinatorOptions {
	const taskProxy = input.activeSession ? createTaskProxy(input.activeSession.sessionId, vi.fn(), vi.fn()) : undefined
	return {
		sessions: {
			getActiveSession: vi.fn(() => input.activeSession),
			endActiveSession: vi.fn().mockResolvedValue(input.activeSession),
			setRunning: vi.fn(),
		},
		interactions: {
			clearPending: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
			appendMessages: vi.fn(),
			cancelPendingSave: vi.fn(),
			finalizeMessagesForSave: vi.fn((messages) => messages),
		},
		taskHistory: {
			getClineMessages: vi.fn().mockResolvedValue([]),
			getSessionStatus: vi.fn().mockResolvedValue("cancelled"),
			isLegacyTask: vi.fn().mockResolvedValue(false),
			findHistoryItem: vi.fn(() => undefined),
		},
		getTask: vi.fn(() => taskProxy),
		setTask: vi.fn(),
		onAskResponse: vi.fn().mockResolvedValue(undefined),
		resetMessageTranslator: vi.fn(),
		raiseCancelFence: vi.fn(),
		setTurnPhase: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		taskOperationFence: new TaskOperationFence(),
		clearTaskSettings: vi.fn().mockResolvedValue(undefined),
	} as unknown as SdkTaskControlCoordinatorOptions
}

describe("ACT-CLINEMM-CANCEL-LIVENESS-DISCRIMINATOR01 — cancelTask", () => {
	beforeEach(() => {
		resetCancelLivenessDiagnostic()
		setCancelLivenessDiagnosticEnabled(true)
	})

	it("RED-A1 (Healthy): active session present + abort resolves → req=1, acc=1, inv=1, cmp=1, pub=1", async () => {
		const { session } = makeControlledSession({ sessionId: "session-1" })
		const options = makeCoordinatorOptions({ activeSession: session })
		const coordinator = new SdkTaskControlCoordinator(options)

		await coordinator.cancelTask()

		const counters = getCancelLivenessDiagnosticSnapshot()
		expect(counters.cancelRequestCalls).toBe(1)
		expect(counters.cancelAcceptedCalls).toBe(1)
		expect(counters.abortInvokedCalls).toBe(1)
		expect(counters.abortCompletedCalls).toBe(1)
		expect(counters.cancelPublishedCalls).toBe(1)
		expect(counters.byActiveSession["session-1"] ?? 0).toBeGreaterThanOrEqual(0)
		expect(options.postStateToWebview).toHaveBeenCalledOnce()
		expect(session.sdkHost.abort).toHaveBeenCalledWith("session-1")
	})

	it("RED-A2 (H-A, REPAIRED by PTLL01-L2): active session absent → req=1, acc=0, inv=0, cmp=0, pub=1; recovery state IS published", async () => {
		const options = makeCoordinatorOptions({ activeSession: undefined })
		const coordinator = new SdkTaskControlCoordinator(options)

		await coordinator.cancelTask()

		const counters = getCancelLivenessDiagnosticSnapshot()
		expect(counters.cancelRequestCalls).toBe(1)
		// No abort target exists, so these three stay 0 — this is still what
		// distinguishes H-A from H-B and from Healthy.
		expect(counters.cancelAcceptedCalls).toBe(0)
		expect(counters.abortInvokedCalls).toBe(0)
		expect(counters.abortCompletedCalls).toBe(0)
		// PTLL01-L2: the recovery state IS now published. Before the repair
		// this was 0 and the displayed "streaming" phase was never reconciled,
		// which is the false-Working/Cancel defect.
		expect(counters.cancelPublishedCalls).toBe(1)
		expect(options.postStateToWebview).toHaveBeenCalledTimes(1)
		// The cancel fence MUST still raise even with no abort target: bumping
		// the epoch is what drops straggler SDK events.
		expect(options.raiseCancelFence).toHaveBeenCalledTimes(1)
		// A truthful recovery phase is published, and it is NOT a completion:
		// Cancel must never grant completion authority.
		expect(options.setTurnPhase).toHaveBeenCalledTimes(1)
		const setTurnPhaseSpy = options.setTurnPhase as unknown as ReturnType<typeof vi.fn>
		const [phase] = setTurnPhaseSpy.mock.calls[0] as [string]
		expect(phase).toBe("resumable")
		expect(phase).not.toBe("completed")
		// LCV-12: no extra user prompt is dispatched to make the UI look idle.
		expect(options.messages.appendAndEmit).not.toHaveBeenCalled()
	})

	it(
		"RED-B (H-B): abort never settles → req=1, acc=1, inv=1, cmp=0, pub=0; post-state NOT published until the await drains",
		async () => {
			const { session, release } = makeControlledSession({
				sessionId: "session-2",
				gateAbort: true,
			})
			const options = makeCoordinatorOptions({ activeSession: session })
			const coordinator = new SdkTaskControlCoordinator(options)

			// Fire-and-forget: cancelTask() will block on the
			// gated abort. We drain it deterministically below.
			const inFlight = coordinator.cancelTask()

			// Give the synchronous pre-await code time to run
			// (request / accepted / abort_invoked must all
			// have fired by now). The await is the only
			// outstanding work.
			await new Promise<void>((r) => setTimeout(r, 25))

			const countersMid = getCancelLivenessDiagnosticSnapshot()
			expect(countersMid.cancelRequestCalls).toBe(1)
			expect(countersMid.cancelAcceptedCalls).toBe(1)
			expect(countersMid.abortInvokedCalls).toBe(1)
			// The await is still pending → abort_completed is 0
			// and cancel_published is 0.
			expect(countersMid.abortCompletedCalls).toBe(0)
			expect(countersMid.cancelPublishedCalls).toBe(0)
			// The post-state publication MUST NOT have happened
			// (this is the load-bearing H-B witness).
			expect(options.postStateToWebview).not.toHaveBeenCalled()

			// Drain the gated await and confirm the rest of
			// the pipeline completes.
			release()
			await inFlight

			const countersFinal = getCancelLivenessDiagnosticSnapshot()
			expect(countersFinal.abortCompletedCalls).toBe(1)
			expect(countersFinal.cancelPublishedCalls).toBe(1)
			expect(options.postStateToWebview).toHaveBeenCalledOnce()
		},
		MAX_ABORT_WAIT_MS + 1000,
	)

	it("discrimination matrix is exhaustive: each of {Healthy, H-A, H-B} matches its row", async () => {
		// Healthy row
		{
			const { session } = makeControlledSession({ sessionId: "session-healthy" })
			const options = makeCoordinatorOptions({ activeSession: session })
			const coordinator = new SdkTaskControlCoordinator(options)
			await coordinator.cancelTask()
			const c = getCancelLivenessDiagnosticSnapshot()
			expect(c.cancelRequestCalls).toBe(1)
			expect(c.cancelAcceptedCalls).toBe(1)
			expect(c.abortInvokedCalls).toBe(1)
			expect(c.abortCompletedCalls).toBe(1)
			expect(c.cancelPublishedCalls).toBe(1)
		}
		resetCancelLivenessDiagnostic()
		setCancelLivenessDiagnosticEnabled(true)

		// H-A row (REPAIRED by PTLL01-L2: pub is now 1 — no abort target, but
		// the fence raises and the recovery state is published).
		{
			const options = makeCoordinatorOptions({ activeSession: undefined })
			const coordinator = new SdkTaskControlCoordinator(options)
			await coordinator.cancelTask()
			const c = getCancelLivenessDiagnosticSnapshot()
			expect(c.cancelRequestCalls).toBe(1)
			expect(c.cancelAcceptedCalls).toBe(0)
			expect(c.abortInvokedCalls).toBe(0)
			expect(c.abortCompletedCalls).toBe(0)
			expect(c.cancelPublishedCalls).toBe(1)
		}
		resetCancelLivenessDiagnostic()
		setCancelLivenessDiagnosticEnabled(true)

		// H-B row (synchronous slice; the await is the only
		// outstanding work, which is asserted above in RED-B).
		{
			const { session, release } = makeControlledSession({
				sessionId: "session-hb",
				gateAbort: true,
			})
			const options = makeCoordinatorOptions({ activeSession: session })
			const coordinator = new SdkTaskControlCoordinator(options)
			// We do not await; we only assert the synchronous
			// pre-await slice. Drain to avoid an orphan promise.
			const inFlight = coordinator.cancelTask()
			await new Promise<void>((r) => setTimeout(r, 10))
			const c = getCancelLivenessDiagnosticSnapshot()
			expect(c.cancelRequestCalls).toBe(1)
			expect(c.cancelAcceptedCalls).toBe(1)
			expect(c.abortInvokedCalls).toBe(1)
			expect(c.abortCompletedCalls).toBe(0)
			expect(c.cancelPublishedCalls).toBe(0)
			release()
			await inFlight
		}
	})

	// P1-1 bounded invariant: the in-flight pending-abort map is
	// capped at MAX_PENDING_ABORTS (= MAX_BUCKETS = 32). Past the
	// cap, FIFO eviction kicks in and the dropped session's
	// abort_completed delta is reported as 0 so the H-B signature
	// is never lost in a quiet leak.
	it("in-flight pending-abort map is bounded at MAX_PENDING_ABORTS; past-cap sessions count as pendingAbortOverflowed", async () => {
		const MAX = 32
		// Build MAX + 2 distinct sessions, each gating its abort
		// so the t0 stays in the map.
		const handles: { release: () => void; session: ActiveSession }[] = []
		for (let i = 0; i < MAX + 2; i++) {
			const h = makeControlledSession({ sessionId: `s-${i}`, gateAbort: true })
			handles.push(h)
		}
		// Issue MAX + 2 in-flight cancelTask() calls; each one
		// will park at the gated await after recording
		// abortInvoked. The first 32 are stored; the 33rd and
		// 34th evict the oldest (FIFO) and bump
		// pendingAbortOverflowed.
		const inFlights: Promise<void>[] = []
		for (const h of handles) {
			const options = makeCoordinatorOptions({ activeSession: h.session })
			const coordinator = new SdkTaskControlCoordinator(options)
			inFlights.push(coordinator.cancelTask())
		}
		// Let the synchronous pre-await slice complete.
		await new Promise<void>((r) => setTimeout(r, 25))
		const counters = getCancelLivenessDiagnosticSnapshot()
		expect(counters.abortInvokedCalls).toBe(MAX + 2)
		// 2 evictions (the 33rd and 34th sessions pushed out
		// s-0 and s-1).
		expect(counters.pendingAbortOverflowed).toBe(2)
		// Drain all gated awaits.
		for (const h of handles) h.release()
		for (const p of inFlights) await p
	})

	afterEach(() => {
		// Public default-off contract: ALWAYS disable + reset
		// after each test, regardless of outcome. This is the
		// structural pin for ACT §15 REMOVAL_TRIGGER.
		setCancelLivenessDiagnosticEnabled(false)
		resetCancelLivenessDiagnostic()
		expect(isCancelLivenessDiagnosticEnabled()).toBe(false)
	})
})
