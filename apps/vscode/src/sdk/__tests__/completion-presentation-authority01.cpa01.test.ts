/**
 * ACT-CLINEMM-COMPLETION-PRESENTATION-AUTHORITY01 / CPA01
 *
 * The live defect: user-visible `✓ Completed` appeared BEFORE
 * `task_completion_committed` was recorded. The dogfood transcript
 * showed:
 *
 *   first ✓ Completed
 *   ↓
 *   BCB finalization prompt: Held terminal observations: 2
 *   ↓
 *   command_status ×2
 *   ↓
 *   second ✓ Completed
 *
 * Two `submit_and_exit` calls for ONE logical task; the first is held
 * by the BCB/C10 barrier because two fire-and-forget background jobs
 * (notify=false) are still owned by the active session. The held
 * `submit_and_exit` is correct (BCB authority is unchanged), but the
 * `say:"completion_result"` row the message-translator emitted at
 * `content_end` is NOT suppressed by the C10 message-layer filter
 * because the filter only consults notify markers and pending prompt
 * counts — NOT the BCB barrier's other hold conditions:
 *   - hasRunningBackgroundJobForOwner
 *   - getUnconsumedOwnedTerminalResultCount
 *
 * ROOT_CAUSE: the C10 message-layer filter at
 *   sdk-session-event-coordinator.ts:1049-1124
 * is keyed on the WRONG predicate. The BCB barrier at SEAM B (the
 * authoritative completion-commit transition) is keyed on the right
 * predicate (line 1313-1318):
 *   holdBarrier = outstandingAutonomousWork
 *              || ownerStillRunningForC10
 *              || unconsumedOwnedTerminalResultsForC10 > 0
 *              || suppressOriginatingCompletion
 *
 * The two seams must reach the same conclusion about whether the
 * task is currently authoritatively complete. Today they don't.
 *
 * REPAIR: extend the C10 message-layer filter to ALSO consult
 * `hasRunningBackgroundJobForOwner` and
 * `getUnconsumedOwnedTerminalResultCount`. Reuse the SAME option-bag
 * methods the SEAM B barrier already uses (no new wiring, no new
 * state, no new protocol field).
 *
 * CONSERVATION (per ACT §3 — explicitly NOT touched):
 *   pending prompt enqueue, pending prompt dequeue, continuation
 *   scheduling, command_status consumer, BCB finalization prompt,
 *   held observation consumption, dogfood diagnostic profile.
 */

import { type CoreSessionEvent, type SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
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

interface ClineMessage {
	ts: number
	type: "say" | "ask"
	say?: string
	text?: string
	isAuthoritativelyCompletedResult?: boolean
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	notifyCoordinator: BackgroundNotifyCoordinator
	manager: CommandJobManager
	activeSessionId: string
	activeTaskId: string
	appendAndEmit: ReturnType<typeof vi.fn>
	completionCommitCount: () => number
	ownedJobs: { jobId: string; notify: boolean; running: boolean }[]
	unconsumedOverride: { value: number }
}

function fakeSupervisor(): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: 1,
		pgid: 1,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(0)
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "OK\n", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	}) as unknown as SupervisableShellProcess
}

function makeHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-cpa01"
	const activeTaskId = opts.activeTaskId ?? "task-cpa01"

	const appendAndEmit = vi.fn()
	let completionCommitCount = 0
	const ownedJobs: { jobId: string; notify: boolean; running: boolean }[] = []
	const unconsumedOverride = { value: 0 }
	let now = 0

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		now: () => ++now,
	})

	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => fakeSupervisor(),
	})

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {} as never,
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: ((msgs: unknown[]) => {
				appendAndEmit(msgs as never)
			}) as never,
		},
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
		hasRunningBackgroundJobForOwner: (sid: string | undefined) => {
			if (sid !== activeSessionId) return false
			return ownedJobs.some((j) => j.running)
		},
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return unconsumedOverride.value
		},
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: (sid: string | undefined, tid: string | undefined) =>
			notifyCoordinator.activeNotifyCountForOwner(sid ?? activeSessionId, tid ?? activeTaskId),
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
		getLaunchedBackgroundJobIds: () => ownedJobs.map((j) => j.jobId),
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		notifyCoordinator,
		manager,
		activeSessionId,
		activeTaskId,
		appendAndEmit,
		completionCommitCount: () => completionCommitCount,
		ownedJobs: ownedJobs as { jobId: string; notify: boolean; running: boolean }[],
		unconsumedOverride,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

/**
 * Drive the canonical translation pipeline through the coordinator's
 * handleSessionEvent. Mirrors production wiring: the translator's
 * content_end handler emits the say:"completion_result" row, and the
 * coordinator's C10 message-layer filter (line 1049-1124) decides
 * whether to drop it before `appendAndEmit`.
 */
async function driveSubmitAndExit(h: Harness, opts: { resultText?: string; turnId?: string } = {}): Promise<void> {
	const resultText = opts.resultText ?? "Here is the final answer."
	const sessionId = h.activeSessionId
	const turnId = opts.turnId ?? "turn-1"
	const state = h.translatorState

	// content_start(submit_and_exit) — sets streaming tool context
	state.setStreamingToolContext("submit_and_exit", { result: resultText })

	// content_end(submit_and_exit) — emits the say:"completion_result" row
	const contentEndEvent = agentEvent(sessionId, {
		type: "content_end",
		contentType: "tool",
		toolName: "submit_and_exit",
		toolCallId: `tc-${turnId}-submit`,
	})
	await h.coordinator.handleSessionEvent(contentEndEvent)

	// done event — fires the BCB/C10 barrier (SEAM B) and decides whether
	// setTurnPhase("completed") fires (authority commit).
	state.setAttemptCompletionSeen()
	state.setTerminalResponseCommittedThisTurn()
	const doneEvent = agentEvent(sessionId, {
		type: "done",
		reason: "completed",
		text: resultText,
		iterations: 1,
	})
	await h.coordinator.handleSessionEvent(doneEvent)
}

function visibleCompletionRows(h: Harness): ClineMessage[] {
	const calls = h.appendAndEmit.mock.calls as Array<[ClineMessage[]]>
	const rows: ClineMessage[] = []
	for (const call of calls) {
		for (const m of call[0]) {
			if (m.say === "completion_result") {
				rows.push(m)
			}
		}
	}
	return rows
}

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

// ---------------------------------------------------------------------------
// RED witness — the live dogfood chronology is encoded exactly here.
// ---------------------------------------------------------------------------

describe("ACT-CLINEMM-COMPLETION-PRESENTATION-AUTHORITY01 / CPA01 — held completion must not show authoritative completion marker", () => {
	describe("CPA-10: TaskHeader phase remains NOT-completed while authority is held", () => {
		it("ownerStillRunning during submit → tracker.currentPhase stays streaming", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})
			h.ownedJobs.push({ jobId: "J1", notify: false, running: true })

			await driveSubmitAndExit(h, { resultText: "mid-flight", turnId: "t1" })

			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.tracker.currentPhase).toBe("streaming")
		})
	})

	describe("CPA-11: after authoritative commit → Working=false (phase=completed)", () => {
		it("ordinary completion commits phase to completed (green-box; Cancel/Working gone)", async () => {
			const h = makeHarness()
			h.tracker.setWithWriter("streaming", undefined, {
				writerId: "task-start-init-task",
			})

			await driveSubmitAndExit(h, { resultText: "done", turnId: "t1" })

			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.completionCommitCount()).toBe(1)
		})
	})

	describe("CPA-14: notify=true path conservation (BCTPA-P7b regression check)", () => {
		it("owned notify=true job + submit_and_exit → SUPPRESS (predecessor BCTPA contract still holds)", async () => {
			const h = makeHarness()
			h.notifyCoordinator.registerMarker({
				jobId: "J-notify",
				sessionId: h.activeSessionId,
				taskId: h.activeTaskId,
			})
			h.translatorState.recordLaunchedBackgroundJob("J-notify")
			h.ownedJobs.push({ jobId: "J-notify", notify: true, running: true })

			await driveSubmitAndExit(h, { resultText: "answer", turnId: "t1" })

			expect(h.completionCommitCount()).toBe(0)
			expect(visibleCompletionRows(h).length).toBe(0)
		})
	})

	describe("CPA-15: notify=false path conservation (BCB01-C2 regression check)", () => {
		it("owned non-notify running job + submit_and_exit → BCB barrier HOLDS; C10 filter now ALSO suppresses", async () => {
			const h = makeHarness()
			h.translatorState.recordLaunchedBackgroundJob("J-non-notify")
			h.ownedJobs.push({ jobId: "J-non-notify", notify: false, running: true })

			await driveSubmitAndExit(h, { resultText: "answer", turnId: "t1" })

			expect(h.completionCommitCount()).toBe(0)
			expect(visibleCompletionRows(h).length).toBe(0)
		})
	})

	describe("CPA-16: no-background-job ordinary task conservation (BCB01-INT-01 regression check)", () => {
		it("no owned jobs + submit_and_exit → 1 row, 1 commit (predecessor ordinary-task contract preserved)", async () => {
			const h = makeHarness()
			await driveSubmitAndExit(h, { resultText: "ordinary", turnId: "t1" })

			expect(h.completionCommitCount()).toBe(1)
			expect(visibleCompletionRows(h).length).toBe(1)
		})
	})

	describe("CPA-09: command_status consumption does not create completion presentation", () => {
		it("draining the unconsumed terminal observation (a la command_status) does NOT itself emit a completion row", async () => {
			const h = makeHarness()
			h.unconsumedOverride.value = 2

			await driveSubmitAndExit(h, { resultText: "first", turnId: "t1" })
			expect(visibleCompletionRows(h).length).toBe(0)

			h.unconsumedOverride.value = 0

			expect(visibleCompletionRows(h).length).toBe(0)

			await driveSubmitAndExit(h, { resultText: "first", turnId: "t2" })
			expect(visibleCompletionRows(h).length).toBe(1)
		})
	})
	describe("CPA-04: two submit_and_exit, one authoritative commit → marker count = 1", () => {
		it("first submit held; second submit commits → 1 visible row", async () => {
			const h = makeHarness()
			h.unconsumedOverride.value = 1

			await driveSubmitAndExit(h, { resultText: "first answer", turnId: "t1" })
			expect(h.completionCommitCount()).toBe(0)
			expect(visibleCompletionRows(h).length).toBe(0)

			h.unconsumedOverride.value = 0
			await driveSubmitAndExit(h, { resultText: "first answer", turnId: "t2" })
			expect(h.completionCommitCount()).toBe(1)
			expect(visibleCompletionRows(h).length).toBe(1)
		})
	})

	describe("CPA-05: two distinct sessions → one marker per session", () => {
		it("session A held, session B free → session A 0 rows, session B 1 row", async () => {
			const sessionA = makeHarness({
				activeSessionId: "session-A",
				activeTaskId: "task-A",
			})
			sessionA.unconsumedOverride.value = 1

			const sessionB = makeHarness({
				activeSessionId: "session-B",
				activeTaskId: "task-B",
			})

			await driveSubmitAndExit(sessionA, { resultText: "A answer", turnId: "A1" })
			await driveSubmitAndExit(sessionB, { resultText: "B answer", turnId: "B1" })

			expect(visibleCompletionRows(sessionA).length).toBe(0)
			expect(visibleCompletionRows(sessionB).length).toBe(1)
			expect(sessionA.completionCommitCount()).toBe(0)
			expect(sessionB.completionCommitCount()).toBe(1)
		})
	})

	describe("CPA-06: same session, duplicate authority event in HELD state → idempotent", () => {
		it("two done events while still held → zero commits; zero rows; idempotent presentation", async () => {
			const h = makeHarness()
			// Held state throughout (job is RUNNING when both submits fire).
			h.ownedJobs.push({ jobId: "J1", notify: false, running: true })

			await driveSubmitAndExit(h, { resultText: "ok", turnId: "t1" })
			expect(h.completionCommitCount()).toBe(0)
			expect(visibleCompletionRows(h).length).toBe(0)

			// A second, redundant done event while STILL HELD must NOT add
			// a second commit and must NOT add a second row. The BCB
			// barrier is the structural dedupe — the same (sessionId, taskId,
			// epoch) predicate evaluation reaches the same conclusion both
			// times (HOLD).
			h.translatorState.setAttemptCompletionSeen()
			h.translatorState.setTerminalResponseCommittedThisTurn()
			const secondDone = agentEvent(h.activeSessionId, {
				type: "done",
				reason: "completed",
				text: "ok",
				iterations: 1,
			})
			await h.coordinator.handleSessionEvent(secondDone)

			expect(h.completionCommitCount()).toBe(0)
			expect(visibleCompletionRows(h).length).toBe(0)
		})
	})

	describe("CPA-07: user-visible final answer text from initial submit is PRESERVED", () => {
		it("the assistant's first answer text reaches appendAndEmit even when completion is held", async () => {
			const h = makeHarness()
			h.unconsumedOverride.value = 1

			const firstText = "My detailed answer to your question."
			await driveSubmitAndExit(h, { resultText: firstText, turnId: "t1" })

			// Drain
			h.unconsumedOverride.value = 0
			await driveSubmitAndExit(h, { resultText: firstText, turnId: "t2" })

			const visible = visibleCompletionRows(h)
			expect(visible.length).toBe(1)
			expect(visible[0]?.text).toBe(firstText)
			expect(visible[0]?.isAuthoritativelyCompletedResult).toBe(true)
		})
	})
	describe("CPA-01: held completion (notify=false running job) must not show completion marker", () => {
		it("submit_and_exit while ownerStillRunning → 0 visible completion_result rows; 0 completion_commit", async () => {
			const h = makeHarness()

			// Step 1: J1 is a fire-and-forget background job (notify=false) and
			// it's still RUNNING when the model calls submit_and_exit.
			h.ownedJobs.push({ jobId: "J1", notify: false, running: true })

			await driveSubmitAndExit(h, { resultText: "Started a job, looks fine.", turnId: "t1" })

			// BCB barrier correctly HOLDS (SEAM B): no phase commit.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")

			// The C10 message-layer filter MUST suppress the
			// say:"completion_result" row because ownerStillRunning is true
			// (the BCB barrier holds on this exact condition at SEAM B).
			const visible = visibleCompletionRows(h)
			expect(visible.length).toBe(0)
		})

		it("submit_and_exit while unconsumedOwnedTerminalResults > 0 → 0 visible completion_result rows; 0 completion_commit", async () => {
			const h = makeHarness()

			// J1 was launched and became terminal. The agent has not yet
			// observed them via command_status. Notify=false → no notify
			// marker is alive, but the terminal observation is held.
			h.unconsumedOverride.value = 1

			await driveSubmitAndExit(h, { resultText: "Job completed (unconsumed).", turnId: "t1" })

			// BCB barrier correctly HOLDS on the second conjunct
			// (unconsumedOwnedTerminalResultsForC10 > 0).
			expect(h.completionCommitCount()).toBe(0)

			// C10 message-layer filter MUST suppress the
			// say:"completion_result" row because unconsumedTerminal > 0
			// (the same predicate the BCB barrier holds on at SEAM B).
			const visible = visibleCompletionRows(h)
			expect(visible.length).toBe(0)
		})
	})

	describe("CPA-02: ordinary completion (no held work) shows exactly one marker", () => {
		it("submit_and_exit with no background jobs / no held observations → 1 visible row; 1 commit", async () => {
			const h = makeHarness()
			// No owned jobs, no unconsumed observations.

			await driveSubmitAndExit(h, { resultText: "All done.", turnId: "t1" })

			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")

			const visible = visibleCompletionRows(h)
			expect(visible.length).toBe(1)
			expect(visible[0]?.text).toBe("All done.")
		})
	})

	describe("CPA-03: full live chronology — held submit + terminal unobs + continuation + final submit → exactly 1 marker", () => {
		it("reproduces the dogfood transcript chronology with zero premature markers", async () => {
			const h = makeHarness()

			// Step 1: two notify=false background jobs become terminal
			// (mirrors the live transcript pattern). The agent has not
			// yet observed them via command_status.
			h.ownedJobs.push({ jobId: "J1", notify: false, running: false })
			h.ownedJobs.push({ jobId: "J2", notify: false, running: false })
			h.unconsumedOverride.value = 2

			// Step 2: the agent calls submit_and_exit the first time.
			// Live: this produced the FIRST premature ✓ Completed.
			await driveSubmitAndExit(h, { resultText: "Here's the answer.", turnId: "t1" })

			// Assert: BCB barrier HOLDS, no phase commit, NO visible
			// completion_result row.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(visibleCompletionRows(h).length).toBe(0)

			// Step 3: model drains the held observations (mirrors the
			// "command_status ×2" step in the live transcript).
			h.unconsumedOverride.value = 0

			// Step 4: model calls submit_and_exit the SECOND time (the
			// BCB continuation's terminal call).
			await driveSubmitAndExit(h, { resultText: "Here's the answer.", turnId: "t2" })

			// Assert: BCB barrier now releases, exactly ONE phase commit,
			// exactly ONE visible completion_result row.
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(visibleCompletionRows(h).length).toBe(1)
		})
	})
})
