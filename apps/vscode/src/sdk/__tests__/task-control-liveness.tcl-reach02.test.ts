// ============================================================================
// ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / TCL-REACH02
//
// DISCRIMINATOR (CORRECTION02): prove or disprove that the wedge state
//   activeSession !== undefined  AND  getTask() === undefined
// is REACHABLE through the REAL SdkSessionLifecycle + REAL SdkTaskControlCoordinator
// under realistic concurrency paths.
//
// Per the Factory reviewer's HALT_EVIDENCE_CONTRADICTION directive on
// TCL-REACH01:
//
//   "The test mocks the very lifecycle behavior it claims to prove.
//    TCL-REACH02 — use the real lifecycle owner. Exercise:
//      real SdkTaskControlCoordinator + real SdkSessionLifecycle
//    with only the irreducible external dependencies injected."
//
//   "Do not write a mock whose implementation itself says:
//      activeSession = undefined
//    The actual lifecycle class must execute that mutation."
//
// This test reuses the same vscode-session-host factory mock as
// apps/vscode/src/sdk/sdk-session-lifecycle.test.ts (line 9-13), which
// mocks ONLY the VscodeSessionHost.create factory and lets the real
// SdkSessionLifecycle execute all of its own bookkeeping. The
// SdkTaskControlCoordinator is the real class, exercised through its
// own public surface (clearTask, cancelTask, showTaskWithId).
//
// REQUIRED INVARIANT (asserted at every observable sync point):
//   never observe (getTask() === undefined AND getActiveSession() !== undefined)
//
// OUTCOME (this ACT):
//   - 4 / 5 GREEN: the single-call teardown paths (clearTask happy
//     path, slow stop, stop rejection, stop timeout) preserve the
//     invariant at the real lifecycle seam.
//   - 1 / 5 RED: the concurrent clearTask + startNewSession race
//     produces the wedge — `getTask() === undefined` while
//     `getActiveSession()` is set to a NEW session (session-B) that
//     startNewSession started AFTER clearTask's setTask(undefined)
//     ran. This is the parental RED for the live incident.
//   - COMMON01 (NEW_TASK from wedge): the SECOND clearTask from the
//     wedge state recovers cleanly, bringing both to undefined. The
//     user can recover by clicking New Task again.
//   - COMMON02 (real SdkMessageCoordinator boundary from wedge):
//     calling appendMessages from the wedge state silently drops
//     the divider row — the canonical preimage of the live outage.
//     The fix candidate will either add a Logger.warn on this
//     boundary, or surface a typed failure, or — preferably — prevent
//     the wedge at its source via atomic session ↔ TaskProxy
//     teardown.
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest"
import { SdkMessageCoordinator } from "../sdk-message-coordinator"
import { SdkSessionLifecycle } from "../sdk-session-lifecycle"
import { SdkTaskControlCoordinator, type SdkTaskControlCoordinatorOptions } from "../sdk-task-control-coordinator"

const mockCreateSessionHost = vi.hoisted(() => vi.fn())

vi.mock("@/core/storage/StateManager", () => ({
	StateManager: {
		get: () => ({
			getGlobalSettingsKey: () => undefined,
		}),
	},
}))

vi.mock("../vscode-session-host", () => ({
	VscodeSessionHost: {
		create: mockCreateSessionHost,
	},
}))

vi.mock("@/shared/services/Logger", () => ({
	Logger: {
		debug: vi.fn(),
		error: vi.fn(),
		log: vi.fn(),
		warn: vi.fn(),
	},
}))

import { Logger } from "@/shared/services/Logger"

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

function makeSdkHost(overrides: Record<string, unknown> = {}) {
	const startResult = overrides.startResult ?? { sessionId: "session-default" }
	return {
		start: vi.fn().mockResolvedValue(startResult),
		subscribe: vi.fn().mockReturnValue(overrides.unsubscribe ?? vi.fn()),
		send: vi.fn().mockResolvedValue(undefined),
		abort: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
}

function assertNoWedge(activeSession: unknown, task: unknown, label: string) {
	const isWedge = task === undefined && activeSession !== undefined
	expect(
		isWedge,
		`WEDGE PRODUCED at "${label}": getTask() === ${task ? "defined" : "undefined"} AND getActiveSession() === ${
			activeSession ? "defined" : "undefined"
		}. ` +
			`This means the REAL SdkSessionLifecycle + REAL SdkTaskControlCoordinator produced the silent-no-op state. ` +
			`If this fails, the wedge is reachable at the production lifecycle seam and TCL-COMMON01 should be written.`,
	).toBe(false)
}

interface Fixture {
	host: ReturnType<typeof makeSdkHost>
	getTask: () => unknown
	getActiveSession: () => unknown
	clearTask: () => Promise<void>
	cancelTask: () => Promise<void>
	startSession: (sessionId: string) => Promise<void>
	lifecycle: SdkSessionLifecycle
}

function makeFixture(): Fixture {
	const host = makeSdkHost()
	mockCreateSessionHost.mockResolvedValue(host)

	let liveTask: unknown

	const lifecycle = new SdkSessionLifecycle({
		mcpHub: {} as never,
		requestToolApproval: vi.fn(),
		askQuestion: vi.fn(),
		onSessionEvent: vi.fn(),
		onSendComplete: vi.fn(),
		onSendError: vi.fn(),
	})

	const options: SdkTaskControlCoordinatorOptions = {
		sessions: lifecycle,
		interactions: {
			clearPending: vi.fn(),
		} as never,
		messages: {
			appendAndEmit: vi.fn(),
			appendMessages: vi.fn(),
			cancelPendingSave: vi.fn(),
			finalizeMessagesForSave: vi.fn((messages: unknown[]) => messages),
			emitSessionEvents: vi.fn(),
		} as never,
		taskHistory: {
			findHistoryItem: vi.fn().mockResolvedValue(undefined),
			getClineMessages: vi.fn().mockResolvedValue([]),
			getSessionStatus: vi.fn().mockResolvedValue("idle"),
			isLegacyTask: vi.fn().mockResolvedValue(false),
		} as never,
		getTask: () => liveTask as never,
		setTask: (task: unknown) => {
			liveTask = task
		},
		onAskResponse: vi.fn().mockResolvedValue(undefined),
		resetMessageTranslator: vi.fn(),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: vi.fn(),
		raiseCancelFence: vi.fn(),
	}

	const coordinator = new SdkTaskControlCoordinator(options)

	const startSession = async (sessionId: string) => {
		;(host.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ sessionId })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		await lifecycle.startNewSession({ config: { sessionId, providerId: "anthropic", modelId: "claude-sonnet-4" } } as any)
		liveTask = makeTask(sessionId)
	}

	return {
		host,
		getTask: () => liveTask,
		getActiveSession: () => lifecycle.getActiveSession(),
		clearTask: () => coordinator.clearTask(),
		cancelTask: () => coordinator.cancelTask(),
		startSession,
		lifecycle,
	}
}

describe("ACT-CLINEMM-TASK-CONTROL-LIVENESS01 / TCL-REACH02 — real lifecycle wedge reachability", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("clearTask does not produce the wedge (real lifecycle, happy path)", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "initial")
		await fx.clearTask()
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "after clearTask")
		expect(fx.getTask()).toBeUndefined()
		expect(fx.getActiveSession()).toBeUndefined()
	})

	it("slow sdkHost.stop does not produce the wedge during or after clearTask", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "initial")
		;(fx.host.stop as ReturnType<typeof vi.fn>).mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve(undefined), 50)),
		)
		const inFlight = fx.clearTask()
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "during clearTask (mid-flight, sync portion)")
		await inFlight
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "after clearTask (slow path)")
		expect(fx.getTask()).toBeUndefined()
		expect(fx.getActiveSession()).toBeUndefined()
	})

	it("sdkHost.stop rejection does not produce the wedge (real lifecycle swallows)", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "initial")
		;(fx.host.stop as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("stop failed"))
		await fx.clearTask()
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "after clearTask (stop rejected)")
		expect(fx.getTask()).toBeUndefined()
		expect(fx.getActiveSession()).toBeUndefined()
	})

	it("sdkHost.stop never resolves does not produce the wedge (waitForStop timeout)", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "initial")
		;(fx.host.stop as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}))
		const result = await Promise.race([
			fx.clearTask().then(() => "completed" as const),
			new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3500)),
		])
		assertNoWedge(fx.getActiveSession(), fx.getTask(), `after clearTask (slow stop, result=${result})`)
		expect(fx.getActiveSession()).toBeUndefined()
	})

	// PARENTAL RED: the wedge is REACHABLE at the real lifecycle seam
	// via concurrent clearTask + startNewSession.
	it("REACH02 PARENTAL RED: concurrent clearTask + startNewSession produces the wedge", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "initial")

		// Configure host.start for the second session
		;(fx.host.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ sessionId: "session-B" })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		const startB = fx.lifecycle.startNewSession({
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			config: { sessionId: "session-B", providerId: "anthropic", modelId: "claude-sonnet-4" },
		} as any)

		await Promise.all([fx.clearTask(), startB])

		// The wedge MUST be present at the real lifecycle seam.
		// This is the canonical preimage of the live incident:
		//   activeSession = session-B (set by startNewSession AFTER
		//     clearTask's setTask(undefined) ran)
		//   getTask() === undefined (cleared by the inner clearTask)
		// Subsequent operations on this orphaned session silently fail
		// because SdkMessageCoordinator.appendMessages' guard at
		// sdk-message-coordinator.ts:79-82 drops the message.
		assertNoWedge(fx.getActiveSession(), fx.getTask(), "after concurrent clearTask + startNewSession")
	})

	// TCL-COMMON01: from the wedge state, the SECOND New Task click
	// recovers cleanly. This proves the user can escape the wedge by
	// clicking New Task AGAIN — but the FIRST click is silently lost.
	it("COMMON01: from the wedge state, the second New Task click recovers cleanly", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		;(fx.host.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ sessionId: "session-B" })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		const startB = fx.lifecycle.startNewSession({
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			config: { sessionId: "session-B", providerId: "anthropic", modelId: "claude-sonnet-4" },
		} as any)
		await Promise.all([fx.clearTask(), startB])
		// Sanity: the wedge is present.
		expect(fx.getTask()).toBeUndefined()
		expect(fx.getActiveSession()).toBeDefined()

		// The user clicks New Task again. The desired behavior is
		// recovery: both should be undefined.
		await fx.clearTask()
		expect(fx.getTask()).toBeUndefined()
		expect(fx.getActiveSession()).toBeUndefined()
	})

	// TCL-COMMON02: from the wedge state, the REAL SdkMessageCoordinator
	// boundary silently drops the divider row that Compact would emit.
	// This is the SAME boundary that drops the cancelTask resume_message
	// row — the COMMON failing boundary for both user intents.
	it("COMMON02: from the wedge state, the real SdkMessageCoordinator boundary silently drops the divider row", async () => {
		const fx = makeFixture()
		await fx.startSession("session-A")
		;(fx.host.start as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ sessionId: "session-B" })
		// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
		const startB = fx.lifecycle.startNewSession({
			// biome-ignore lint/suspicious/noExplicitAny: focused fake for lifecycle unit test
			config: { sessionId: "session-B", providerId: "anthropic", modelId: "claude-sonnet-4" },
		} as any)
		await Promise.all([fx.clearTask(), startB])
		expect(fx.getTask()).toBeUndefined()
		expect(fx.getActiveSession()).toBeDefined()

		// Wire the REAL SdkMessageCoordinator to the wedge state.
		const messages = new SdkMessageCoordinator({ getTask: () => fx.getTask() as never })

		const beforeWarnCalls = (Logger.warn as ReturnType<typeof vi.fn>).mock.calls.length
		const beforeErrorCalls = (Logger.error as ReturnType<typeof vi.fn>).mock.calls.length

		// Simulate what compactTask would do via runCompaction:
		// emit a `say: "compaction"` divider row.
		messages.appendMessages([
			{
				ts: Date.now(),
				type: "say",
				say: "compaction",
				text: "Compacting context...",
				partial: false,
			},
		])

		// DESIRED BEHAVIOR: some observable failure signal MUST be
		// emitted (Logger.warn or Logger.error). The current behavior
		// is silent drop — the live outage.
		const afterWarnCalls = (Logger.warn as ReturnType<typeof vi.fn>).mock.calls.length
		const afterErrorCalls = (Logger.error as ReturnType<typeof vi.fn>).mock.calls.length
		const newWarnCalls = afterWarnCalls - beforeWarnCalls
		const newErrorCalls = afterErrorCalls - beforeErrorCalls
		const observableFailureSignal = newWarnCalls + newErrorCalls
		expect(
			observableFailureSignal,
			"appendMessages SILENTLY DROPPED the divider row from the wedge state — the user's Compact click is silently lost (live outage)",
		).toBeGreaterThan(0)
	})
})
