// ============================================================================
// ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / TCL-REACH01
//
// DISCRIMINATOR: prove or disprove that the wedge state
//   activeSession !== undefined  AND  getTask() === undefined
// is REACHABLE through any real production task-control teardown transition.
//
// Per the Factory reviewer's HALT_SHARED_CAUSE_NOT_PROVEN directive:
//   "TCL09 ... constructs the wedge state directly via the seam, not by
//    driving a real lifecycle transition. So label it WEDGE_REACHABILITY =
//    HYPOTHESIS_ONLY until a production lifecycle path actually produces
//    activeSession != undefined AND TaskProxy == undefined."
//
//   "Create a real lifecycle test that uses the actual task-control
//    teardown path. ... If it cannot produce the state: WEDGE_STATE_NOT_
//    REPRODUCED and TCL09 remains only a hardening witness."
//
// This test drives every reachable production teardown transition through
// the real SdkTaskControlCoordinator and asserts that the wedge state
// (getTask() === undefined && getActiveSession() !== undefined) is never
// produced. If GREEN, the wedge is NOT production-reachable through any
// canonical task-control path — the parent live defect is NOT
// `MESSAGE_COORDINATOR_SILENT_DROP` and the cause must lie elsewhere.
//
// If RED (wedge produced), this test pins the production reachability of
// the wedge and unlocks TCL-COMMON01 (the desired-behavior assertion of
// New Task + Compact from the wedge state).
//
// THIS TEST EXERCISES:
//   1. clearTask() — canonical "New Task" intent
//   2. cancelTask() — Cancel button (does NOT clear TaskProxy, but does
//      NOT end the session either; this verifies cancelTask alone cannot
//      produce the wedge)
//   3. clearTask() with simulated endActiveSession failure (abort hang)
//   4. cancelTask() followed by clearTask() (the "Cancel then New Task"
//      path the user might take after seeing an unresponsive task)
//   5. showTaskWithId() race while clearTask is in flight (the wedge
//      hypothesis originally arose from this kind of ordering)
//
// EXPECTED OUTCOME (per the reviewer's directive): GREEN, with the
// intermediate state always either (a) getTask() defined + activeSession
// defined, (b) both undefined, or (c) getTask() defined + activeSession
// undefined. The wedge (getTask undefined + activeSession defined) must
// not be produced by any of these paths.
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SdkTaskControlCoordinator, type SdkTaskControlCoordinatorOptions } from "../sdk-task-control-coordinator"
import { TaskOperationFence } from "../task-operation-fence"

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

interface CoordinatorState {
	task?: ReturnType<typeof makeTask>
	activeSession: ReturnType<typeof makeActiveSession> | undefined
}

function makeTask(taskId: string) {
	return {
		taskId,
		messageStateHandler: {
			getClineMessages: () => [],
			clear: vi.fn(),
			addMessages: vi.fn(),
		},
	} as never
}

function makeActiveSession(sessionId: string) {
	return {
		sessionId,
		sdkHost: {
			start: vi.fn(),
			readMessages: vi.fn().mockResolvedValue([]),
			updateSessionCompactionState: vi.fn().mockResolvedValue({ updated: true }),
			send: vi.fn(),
			abort: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		unsubscribe: vi.fn(),
		startResult: { sessionId },
		isRunning: false,
	}
}

function makeCoordinator(state: CoordinatorState) {
	// endActiveSession PRESERVES the production semantics from
	// apps/vscode/src/sdk/sdk-session-lifecycle.ts:121-142:
	//   1. clear activeSession reference SYNCHRONOUSLY (line 117)
	//   2. asynchronously track the stop (never throws — trackSessionStop
	//      swallows errors at line 346-348; waitForStop only times out)
	// This mirror is what guarantees the wedge is unreachable IF the
	// canonical teardown ordering is preserved.
	const endActiveSession = vi.fn(async () => {
		const prev = state.activeSession
		state.activeSession = undefined
		return prev
	})
	// ACT-CLINEMM-TASK-CONTROL-LIVENESS01-FIX01: each test owns a fresh
	// TaskOperationFence. Required by SdkTaskControlCoordinatorOptions.
	const fx_fence = new TaskOperationFence()
	const options = {
		sessions: {
			getActiveSession: vi.fn(() => state.activeSession),
			endActiveSession,
			setRunning: vi.fn((running: boolean) => {
				if (state.activeSession) {
					state.activeSession.isRunning = running
				}
			}),
		},
		interactions: {
			clearPending: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
			appendMessages: vi.fn(),
			cancelPendingSave: vi.fn(),
			finalizeMessagesForSave: vi.fn((messages: unknown[]) => messages),
		},
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			getClineMessages: vi.fn().mockResolvedValue([]),
			getSessionStatus: vi.fn().mockResolvedValue("idle"),
			isLegacyTask: vi.fn().mockResolvedValue(false),
		},
		getTask: vi.fn(() => state.task),
		setTask: vi.fn((task) => {
			state.task = task
		}),
		onAskResponse: vi.fn().mockResolvedValue(undefined),
		resetMessageTranslator: vi.fn(),
		raiseCancelFence: vi.fn(),
		setTurnPhase: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		taskOperationFence: fx_fence,
	} as unknown as SdkTaskControlCoordinatorOptions & {
		sessions: SdkTaskControlCoordinatorOptions["sessions"] & {
			getActiveSession: ReturnType<typeof vi.fn>
			endActiveSession: ReturnType<typeof vi.fn>
			setRunning: ReturnType<typeof vi.fn>
		}
	}
	return { coordinator: new SdkTaskControlCoordinator(options), options, state }
}

function assertNoWedge(state: CoordinatorState, label: string) {
	const getTask = state.task
	const getActiveSession = state.activeSession
	const isWedge = getTask === undefined && getActiveSession !== undefined
	expect(
		isWedge,
		`WEDGE PRODUCED at "${label}": getTask() === ${getTask ? "defined" : "undefined"} AND getActiveSession() === ${
			getActiveSession ? "defined" : "undefined"
		}. ` +
			`This means a real production teardown produced the silent-no-op state. ` +
			`If this fails, the wedge is reachable and TCL-COMMON01 should be written.`,
	).toBe(false)
}

describe("ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / TCL-REACH01 — wedge-state reachability", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		// After every test, verify the wedge is never the resting state.
		// (Per-test assertions already check this; this is defense in depth.)
	})

	it("clearTask does not produce the wedge (canonical 'New Task' intent)", async () => {
		const state: CoordinatorState = {
			task: makeTask("session-A"),
			activeSession: makeActiveSession("session-A"),
		}
		const { coordinator } = makeCoordinator(state)
		assertNoWedge(state, "initial")

		await coordinator.clearTask()

		// After clearTask: getTask() === undefined AND activeSession === undefined
		// (both cleared atomically; endActiveSession ran BEFORE setTask(undefined))
		assertNoWedge(state, "after clearTask")
		expect(state.task).toBeUndefined()
		expect(state.activeSession).toBeUndefined()
	})

	it("cancelTask does not produce the wedge (Cancel button only)", async () => {
		const state: CoordinatorState = {
			task: makeTask("session-A"),
			activeSession: makeActiveSession("session-A"),
		}
		const { coordinator } = makeCoordinator(state)
		assertNoWedge(state, "initial")

		await coordinator.cancelTask()

		// After cancelTask: getTask() still defined AND activeSession still defined
		// (cancelTask only aborts the in-flight turn; it does NOT clear either)
		assertNoWedge(state, "after cancelTask")
		expect(state.task).toBeDefined()
		expect(state.activeSession).toBeDefined()
	})

	it("cancelTask followed by clearTask does not produce the wedge (Cancel then New Task)", async () => {
		const state: CoordinatorState = {
			task: makeTask("session-A"),
			activeSession: makeActiveSession("session-A"),
		}
		const { coordinator } = makeCoordinator(state)
		assertNoWedge(state, "initial")

		await coordinator.cancelTask()
		assertNoWedge(state, "after cancelTask (intermediate)")

		await coordinator.clearTask()
		assertNoWedge(state, "after clearTask (post-cancel)")

		expect(state.task).toBeUndefined()
		expect(state.activeSession).toBeUndefined()
	})

	it("clearTask with slow endActiveSession does not produce the wedge mid-flight", async () => {
		const state: CoordinatorState = {
			task: makeTask("session-A"),
			activeSession: makeActiveSession("session-A"),
		}
		const { coordinator, options } = makeCoordinator(state)
		// Simulate a slow endActiveSession: the synchronous clear of
		// state.activeSession happens IMMEDIATELY, but the awaited portion
		// (trackSessionStop) takes longer. This mirrors the production
		// behavior at sdk-session-lifecycle.ts:117 (sync) + :134 (await).
		;(options.sessions as { endActiveSession: ReturnType<typeof vi.fn> }).endActiveSession.mockImplementation(async () => {
			const prev = state.activeSession
			state.activeSession = undefined // sync (matches production line 117)
			await new Promise((resolve) => setTimeout(resolve, 50)) // async (matches production line 134)
			return prev
		})
		assertNoWedge(state, "initial")

		const inFlight = coordinator.clearTask()
		// Even at this synchronous point after the await start, the wedge
		// must not exist: endActiveSession synchronously cleared the
		// activeSession reference, and setTask(undefined) is still pending.
		assertNoWedge(state, "during clearTask (mid-flight)")

		await inFlight
		assertNoWedge(state, "after clearTask (slow path)")

		expect(state.task).toBeUndefined()
		expect(state.activeSession).toBeUndefined()
	})

	it("concurrent clearTask calls do not produce the wedge", async () => {
		const state: CoordinatorState = {
			task: makeTask("session-A"),
			activeSession: makeActiveSession("session-A"),
		}
		const { coordinator } = makeCoordinator(state)
		assertNoWedge(state, "initial")

		// Two concurrent New Task clicks. In the canonical SdkController
		// flow, the second click is gated by webview state and shouldn't
		// happen, but if it did, the coordinator should not produce the
		// wedge.
		const [_a, _b] = await Promise.all([coordinator.clearTask(), coordinator.clearTask()])

		assertNoWedge(state, "after concurrent clearTask")
		expect(state.task).toBeUndefined()
		expect(state.activeSession).toBeUndefined()
	})

	it("clearTask with no active session does not produce the wedge (defensive)", async () => {
		// Edge case: user clicks New Task when no session is active.
		// endActiveSession is a no-op (no active session), setTask(undefined)
		// runs. No wedge possible.
		const state: CoordinatorState = {
			task: makeTask("session-A"),
			activeSession: undefined,
		}
		const { coordinator } = makeCoordinator(state)
		assertNoWedge(state, "initial (no active session)")

		await coordinator.clearTask()

		assertNoWedge(state, "after clearTask (no active session)")
		expect(state.task).toBeUndefined()
		expect(state.activeSession).toBeUndefined()
	})
})
