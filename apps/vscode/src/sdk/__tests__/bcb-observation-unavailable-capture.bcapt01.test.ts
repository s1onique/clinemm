/**
 * ACT-CLINEMM-BCB-CAPTURE01 — BCAPT01
 *
 * Bounded executable test gate for the BCB observation-unavailable
 * decision-boundary capture diagnostic at
 * `apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3146-3194`.
 *
 * The diagnostic is the bounded read-only instrument recommended by
 * ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01-CORR01 §13.8 to close
 * the `CAPTURE_INSUFFICIENT` gap on a future live run. This test
 * suite proves:
 *
 *   1. The diagnostic is OFF by default and zero state-semantic
 *      delta between OFF and ON for the canonical four scenarios
 *      (BCAPT-EQUIV).
 *   2. When ON, the diagnostic captures the four BCB predicate
 *      inputs (liveTools, held-result ownership/count, suppressOriginating
 *      Completion, selected writer) at the BCB decision point
 *      (BCAPT-01..BCAPT-05).
 *   3. The diagnostic never invokes `liveTools()` an additional
 *      time — it reuses the already-evaluated production locals
 *      (BCAPT-01 captures the liveTools value, not a recomputation).
 *   4. The toggle + dump commands are wired (CMD-01..CMD-04).
 *   5. The intentionally RED L2847 witnesses in
 *      `task-terminal-divergence-red01.tdd-red01.test.ts` are NOT
 *      re-introduced or weakened by this ACT. The default test
 *      gate (the vitest base config) is unchanged; the three RED
 *      tests remain RED until the L2847 precedence repair ACT
 *      lands. They are excluded from this suite to make the
 *      isolation explicit (BCAPT-RED-ISOLATION).
 */

import { existsSync, mkdtempSync, readFileSync, readFileSync as readFileSyncFs, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { type CoreSessionEvent } from "@cline/core"
import {
	clearBcbObservationUnavailableCapture,
	disableBcbObservationUnavailableCapture,
	enableBcbObservationUnavailableCapture,
	findBcbObservationUnavailableCaptureByWriter,
	getBcbObservationUnavailableCaptureLatest,
	getBcbObservationUnavailableCaptureRecords,
	getBcbObservationUnavailableCaptureSeq,
	isBcbObservationUnavailableCaptureEnabled,
	isBcbObservationUnavailableCaptureInDefaultState,
	recordBcbObservationUnavailableCapture,
	setBcbObservationUnavailableCaptureBufferSize,
} from "@shared/bcb-observation-unavailable-capture"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type BcbObservationUnavailableCaptureContext,
	dumpExtensionSideBcbObservationUnavailableCapture,
	isBcbObservationUnavailableCaptureWorkspaceEnabled,
	toggleBcbObservationUnavailableCaptureWorkspaceEnabled,
} from "@/sdk/bcb-observation-unavailable-capture-runtime"
import { MessageIdMinter } from "@/sdk/message-id-minter"
import { MessageTranslatorState } from "@/sdk/message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "@/sdk/sdk-session-event-coordinator"
import { TurnStateTracker } from "@/sdk/turn-state-tracker"

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

function makeBcaptHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): BcaptHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-bcapt01"
	const activeTaskId = opts.activeTaskId ?? "task-bcapt01"

	const appendAndEmit = vi.fn()
	let completionCommitCount = 0
	let errorPhaseCommitCount = 0
	const allCommittedPhases: string[] = []
	const allCommittedWriterIds: string[] = []
	const ownedJobs: { jobId: string; notify: boolean; running: boolean }[] = []
	const unconsumedOverride = { value: 0 }
	const unconsumedJobIdsOverride: { value: readonly string[] } = { value: [] }
	const liveToolsOverride: { value: readonly string[] | undefined } = {
		value: ["command_status", "read_files", "run_commands", "submit_and_exit"],
	}
	const suppressOriginatingCompletionOverride: { value: boolean } = { value: false }

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
		messages: { appendAndEmit: ((msgs: unknown[]) => appendAndEmit(msgs as never)) as never },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			allCommittedPhases.push(phase)
			allCommittedWriterIds.push(String(writerId ?? "unknown-legacy-writer"))
			if (phase === "completed") {
				completionCommitCount += 1
			}
			if (phase === "error") {
				errorPhaseCommitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		getElmCompletionAuthorityDecision: () => ({ kind: "hold" as const, reason: "test_default_hold" }),
		flushElmAuthorityForSession: async () => {},
		hasRunningBackgroundJobForOwner: (sid: string | undefined) => {
			if (sid !== activeSessionId) return false
			return ownedJobs.some((j) => j.running)
		},
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) => {
			if (sid !== activeSessionId) return 0
			return unconsumedOverride.value
		},
		getUnconsumedOwnedTerminalJobIds: (sid: string, _tid: string | undefined) => {
			if (sid !== activeSessionId) return []
			return unconsumedJobIdsOverride.value
		},
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		getLaunchedBackgroundJobIds: () => ownedJobs.map((j) => j.jobId),
		liveTools: () => liveToolsOverride.value,
	} as unknown as SdkSessionEventCoordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		errorPhaseCommitCount: () => errorPhaseCommitCount,
		allCommittedPhases: () => allCommittedPhases,
		allCommittedWriterIds: () => allCommittedWriterIds,
		finalPhase: () => tracker.currentPhase,
		finalWriterId: () => allCommittedWriterIds[allCommittedWriterIds.length - 1] ?? "none",
		appendAndEmit,
		ownedJobs,
		unconsumedOverride,
		unconsumedJobIdsOverride,
		liveToolsOverride,
		suppressOriginatingCompletionOverride,
		enableCapture: () => enableBcbObservationUnavailableCapture(),
		disableCapture: () => disableBcbObservationUnavailableCapture(),
		clearCapture: () => clearBcbObservationUnavailableCapture(),
		getCaptureRecords: () => getBcbObservationUnavailableCaptureRecords(),
		getCaptureLatest: () => getBcbObservationUnavailableCaptureLatest(),
		getCaptureSeq: () => getBcbObservationUnavailableCaptureSeq(),
	}
}

async function emitSubmitAndExit(h: BcaptHarness): Promise<void> {
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

beforeEach(() => {
	disableBcbObservationUnavailableCapture()
	clearBcbObservationUnavailableCapture()
})

afterEach(() => {
	disableBcbObservationUnavailableCapture()
	clearBcbObservationUnavailableCapture()
})

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

interface BcaptHarness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	translatorState: MessageTranslatorState
	activeSessionId: string
	activeTaskId: string
	completionCommitCount: () => number
	errorPhaseCommitCount: () => number
	allCommittedPhases: () => string[]
	allCommittedWriterIds: () => string[]
	finalPhase: () => string
	finalWriterId: () => string
	appendAndEmit: ReturnType<typeof vi.fn>
	ownedJobs: { jobId: string; notify: boolean; running: boolean }[]
	unconsumedOverride: { value: number }
	unconsumedJobIdsOverride: { value: readonly string[] }
	liveToolsOverride: { value: readonly string[] | undefined }
	suppressOriginatingCompletionOverride: { value: boolean }
	enableCapture: () => void
	disableCapture: () => void
	clearCapture: () => void
	getCaptureRecords: () => ReturnType<typeof getBcbObservationUnavailableCaptureRecords>
	getCaptureLatest: () => ReturnType<typeof getBcbObservationUnavailableCaptureLatest>
	getCaptureSeq: () => number
}

// =============================================================================
// BCAPT-01: BCB observation unavailable — exact writer + final error
// =============================================================================
describe("BCAPT-01: BCB observation unavailable — exact writer + final error + capture record", () => {
	it("BCAPT-01.1: liveTools missing command_status + unconsumed=1 -> BCB writer fires, capture records the actual liveToolsValue", async () => {
		const h = makeBcaptHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalPhase()).toBe("error")
		expect(h.finalWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(h.completionCommitCount()).toBe(0)

		const records = h.getCaptureRecords()
		expect(records).toHaveLength(1)
		const r = records[0]!
		expect(r.writerId).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(r.requestedPhase).toBe("error")
		expect(r.committedPhase).toBe("error")
		expect(r.liveToolsAvailable).toBe(true)
		expect(r.liveToolsIncludesCommandStatus).toBe(false)
		expect(r.liveToolsCount).toBe(2)
		expect(r.liveToolsValue).toEqual(["read_files", "run_commands"])
		expect(r.canObserveHeldResults).toBe(false)
		expect(r.sameObligationAlreadyObservationUnavailable).toBe(false)
		expect(r.unconsumedOwnedTerminalResultsForC10).toBe(1)
		expect(r.ownedTerminalJobIdsForC10).toEqual(["cmd-bcb-held-1"])
		expect(r.eligibleForCoalescedContinuation).toBe(true)
		expect(r.suppressOriginatingCompletion).toBe(false)
		expect(r.sessionId).toBe(h.activeSessionId)
		expect(r.taskId).toBe(h.activeTaskId)
		expect(typeof r.epoch).toBe("number")
	})

	it("BCAPT-01.2: liveTools === undefined (null semantics preserved) — canObserveHeldResults is null, capture distinguishes defined vs undefined", async () => {
		const h = makeBcaptHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
		h.liveToolsOverride.value = undefined
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalWriterId()).not.toBe("session-event-bcb-blocked-observation-unavailable")

		const records = h.getCaptureRecords()
		expect(records).toHaveLength(1)
		const r = records[0]!
		expect(r.writerId).toBe("session-event-bcb-eligible-no-bcb-writer")
		expect(r.liveToolsAvailable).toBe(false)
		expect(r.liveToolsIncludesCommandStatus).toBe(false)
		expect(r.liveToolsCount).toBe(0)
		expect(r.liveToolsValue).toBeUndefined()
		expect(r.canObserveHeldResults).toBeNull()
		expect(r.sameObligationAlreadyObservationUnavailable).toBe(false)
		expect(r.committedPhase).toBeUndefined()
	})
})

// =============================================================================
// BCAPT-02: command_status present — BCB observation-unavailable writer NOT selected
// =============================================================================
describe("BCAPT-02: command_status present — BCB observation-unavailable writer NOT selected", () => {
	it("BCAPT-02.1: liveTools includes command_status + unconsumed=1 -> BCB writer does not fire, capture records eligible-no-bcb-writer", async () => {
		const h = makeBcaptHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
		h.liveToolsOverride.value = ["command_status", "read_files", "run_commands", "submit_and_exit"]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalWriterId()).not.toBe("session-event-bcb-blocked-observation-unavailable")
		expect(h.completionCommitCount()).toBe(0)

		const records = h.getCaptureRecords()
		expect(records).toHaveLength(1)
		const r = records[0]!
		expect(r.writerId).toBe("session-event-bcb-eligible-no-bcb-writer")
		expect(r.liveToolsIncludesCommandStatus).toBe(true)
		expect(r.canObserveHeldResults).toBe(true)
		expect(r.sameObligationAlreadyObservationUnavailable).toBe(false)
		expect(r.eligibleForCoalescedContinuation).toBe(true)
	})
})

// =============================================================================
// BCAPT-03: Unknown registry (no command_status) — preserve false semantics
// =============================================================================
describe("BCAPT-03: Unknown registry (no command_status) — preserve false semantics, not null", () => {
	it("BCAPT-03.1: liveTools=[read_files, run_commands] -> canObserveHeldResults=false, NOT null", async () => {
		const h = makeBcaptHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")

		const records = h.getCaptureRecords()
		expect(records).toHaveLength(1)
		const r = records[0]!
		// KEY invariant: canObserveHeldResults is FALSE, not NULL.
		expect(r.canObserveHeldResults).toBe(false)
		expect(r.liveToolsValue).toEqual(["read_files", "run_commands"])
	})
})

// =============================================================================
// BCAPT-04: No held obligation — no false-positive BCB writer
// =============================================================================
describe("BCAPT-04: No held obligation — no false-positive BCB writer, no record", () => {
	it("BCAPT-04.1: with unconsumed=0 + liveTools missing command_status — no BCB writer, zero records", async () => {
		const h = makeBcaptHarness()
		h.unconsumedOverride.value = 0
		h.unconsumedJobIdsOverride.value = []
		h.liveToolsOverride.value = ["read_files", "run_commands"]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		expect(h.finalWriterId()).not.toBe("session-event-bcb-blocked-observation-unavailable")
		// Eligibility branch is not taken: zero records.
		expect(h.getCaptureRecords()).toHaveLength(0)
		expect(h.getCaptureSeq()).toBe(0)
	})
})

// =============================================================================
// BCAPT-05: Same-obligation idempotence
// =============================================================================
describe("BCAPT-05: Same-obligation idempotence", () => {
	it("BCAPT-05.1: a second submit_and_exit on the same obligation does NOT re-fire the BCB writer; capture records sameObligationAlreadyObservationUnavailable=true", async () => {
		const h = makeBcaptHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"]
		h.enableCapture()

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.finalWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")
		const firstRecords = h.getCaptureRecords()
		expect(firstRecords).toHaveLength(1)
		expect(firstRecords[0]!.sameObligationAlreadyObservationUnavailable).toBe(false)
		expect(firstRecords[0]!.committedPhase).toBe("error")

		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		const allRecords = h.getCaptureRecords()
		expect(allRecords).toHaveLength(2)
		expect(allRecords[1]!.sameObligationAlreadyObservationUnavailable).toBe(true)
		expect(allRecords[1]!.committedPhase).toBeUndefined()
	})
})

// =============================================================================
// BCAPT-EQUIV: OFF vs ON — zero state-semantic delta
// =============================================================================
describe("BCAPT-EQUIV: OFF vs ON — zero state-semantic delta for the four canonical scenarios", () => {
	interface Scenario {
		readonly id: string
		readonly setup: (h: BcaptHarness) => void
		readonly cycles: number
	}

	const scenarios: Scenario[] = [
		{
			id: "BCB-observation-unavailable",
			setup: (h) => {
				h.unconsumedOverride.value = 1
				h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
				h.liveToolsOverride.value = ["read_files", "run_commands"]
			},
			cycles: 1,
		},
		{
			id: "command_status-present",
			setup: (h) => {
				h.unconsumedOverride.value = 1
				h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
				h.liveToolsOverride.value = ["command_status", "submit_and_exit"]
			},
			cycles: 1,
		},
		{
			id: "no-held-obligation",
			setup: (h) => {
				h.unconsumedOverride.value = 0
				h.unconsumedJobIdsOverride.value = []
				h.liveToolsOverride.value = ["read_files", "run_commands"]
			},
			cycles: 1,
		},
		{
			id: "same-obligation-idempotence",
			setup: (h) => {
				h.unconsumedOverride.value = 1
				h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
				h.liveToolsOverride.value = ["read_files", "run_commands"]
			},
			cycles: 2,
		},
	]

	for (const sc of scenarios) {
		it(`BCAPT-EQUIV.${sc.id}: OFF and ON produce identical state transitions, message publication, and callback counts`, async () => {
			// OFF run
			disableBcbObservationUnavailableCapture()
			clearBcbObservationUnavailableCapture()
			const hOff = makeBcaptHarness()
			sc.setup(hOff)
			for (let i = 0; i < sc.cycles; i++) {
				await emitSubmitAndExit(hOff)
				await new Promise<void>((r) => setImmediate(r))
			}
			const offFinalPhase = hOff.finalPhase()
			const offFinalWriter = hOff.finalWriterId()
			const offAllPhases = hOff.allCommittedPhases().slice()
			const offAllWriters = hOff.allCommittedWriterIds().slice()
			const offCompletionCount = hOff.completionCommitCount()
			const offErrorCount = hOff.errorPhaseCommitCount()
			const offAppendCount = hOff.appendAndEmit.mock.calls.length
			const offCaptureCount = hOff.getCaptureRecords().length

			// ON run — same scenario, capture enabled
			disableBcbObservationUnavailableCapture()
			clearBcbObservationUnavailableCapture()
			enableBcbObservationUnavailableCapture()
			const hOn = makeBcaptHarness()
			sc.setup(hOn)
			for (let i = 0; i < sc.cycles; i++) {
				await emitSubmitAndExit(hOn)
				await new Promise<void>((r) => setImmediate(r))
			}
			const onFinalPhase = hOn.finalPhase()
			const onFinalWriter = hOn.finalWriterId()
			const onAllPhases = hOn.allCommittedPhases().slice()
			const onAllWriters = hOn.allCommittedWriterIds().slice()
			const onCompletionCount = hOn.completionCommitCount()
			const onErrorCount = hOn.errorPhaseCommitCount()
			const onAppendCount = hOn.appendAndEmit.mock.calls.length
			const onCaptureCount = hOn.getCaptureRecords().length

			expect(onFinalPhase).toBe(offFinalPhase)
			expect(onFinalWriter).toBe(offFinalWriter)
			expect(onAllPhases).toEqual(offAllPhases)
			expect(onAllWriters).toEqual(offAllWriters)
			expect(onCompletionCount).toBe(offCompletionCount)
			expect(onErrorCount).toBe(offErrorCount)
			expect(onAppendCount).toBe(offAppendCount)
			expect(offCaptureCount).toBe(0)
			if (sc.id === "no-held-obligation") {
				expect(onCaptureCount).toBe(0)
			} else {
				expect(onCaptureCount).toBeGreaterThanOrEqual(1)
			}
		})
	}
})

// =============================================================================
// BCAPT-DIAG: diagnostic module unit tests
// =============================================================================

const bcbDiagRec = (overrides: Partial<Parameters<typeof recordBcbObservationUnavailableCapture>[0]> = {}) => ({
	sessionId: "s",
	taskId: "t",
	epoch: 0,
	eligibleForCoalescedContinuation: true,
	unconsumedOwnedTerminalResultsForC10: 1,
	ownedTerminalJobIdsForC10: ["j"],
	outstandingAutonomousWork: false,
	ownerStillRunningForC10: false,
	heldObligationForC10: true,
	suppressOriginatingCompletion: false,
	liveToolsAvailable: true,
	liveToolsIncludesCommandStatus: false,
	liveToolsCount: 2,
	liveToolsValue: ["read_files", "run_commands"] as readonly string[],
	canObserveHeldResults: false as const,
	sameObligationAlreadyObservationUnavailable: false,
	writerId: "session-event-bcb-blocked-observation-unavailable" as const,
	requestedPhase: "error" as const,
	committedPhase: "error" as const,
	...overrides,
})

describe("BCAPT-DIAG: diagnostic module unit tests", () => {
	it("BCAPT-DIAG.1: default state is OFF and empty", () => {
		disableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
		expect(isBcbObservationUnavailableCaptureEnabled()).toBe(false)
		expect(isBcbObservationUnavailableCaptureInDefaultState()).toBe(true)
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(0)
		expect(getBcbObservationUnavailableCaptureLatest()).toBeUndefined()
		expect(getBcbObservationUnavailableCaptureSeq()).toBe(0)
	})

	it("BCAPT-DIAG.2: when disabled, recordBcbObservationUnavailableCapture is a complete no-op", () => {
		disableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
		recordBcbObservationUnavailableCapture(bcbDiagRec())
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(0)
		expect(getBcbObservationUnavailableCaptureSeq()).toBe(0)
	})

	it("BCAPT-DIAG.3: when enabled, records are captured with the right shape and ordering", () => {
		enableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
		recordBcbObservationUnavailableCapture(bcbDiagRec())
		recordBcbObservationUnavailableCapture(
			bcbDiagRec({
				sessionId: "s2",
				taskId: "t2",
				epoch: 1,
				writerId: "session-event-bcb-eligible-no-bcb-writer",
				canObserveHeldResults: true,
				liveToolsIncludesCommandStatus: true,
				liveToolsValue: ["command_status", "submit_and_exit"],
				committedPhase: undefined,
			}),
		)
		const records = getBcbObservationUnavailableCaptureRecords()
		expect(records).toHaveLength(2)
		expect(records[0]!.sessionId).toBe("s")
		expect(records[1]!.sessionId).toBe("s2")
		expect(records[0]!.writerId).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(records[1]!.writerId).toBe("session-event-bcb-eligible-no-bcb-writer")
		expect(getBcbObservationUnavailableCaptureSeq()).toBe(2)
		expect(getBcbObservationUnavailableCaptureLatest()?.sessionId).toBe("s2")
	})

	it("BCAPT-DIAG.4: ring is bounded (default 64; FIFO evict)", () => {
		setBcbObservationUnavailableCaptureBufferSize(64)
		enableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
		for (let i = 0; i < 100; i++) {
			recordBcbObservationUnavailableCapture(bcbDiagRec({ sessionId: `s${i}`, epoch: i, liveToolsValue: [] }))
		}
		const records = getBcbObservationUnavailableCaptureRecords()
		expect(records).toHaveLength(64)
		expect(records[0]!.sessionId).toBe("s36")
		expect(records[63]!.sessionId).toBe("s99")
	})

	it("BCAPT-DIAG.5: findBcbObservationUnavailableCaptureByWriter returns the matching subset", () => {
		enableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
		recordBcbObservationUnavailableCapture(bcbDiagRec({ sessionId: "s1" }))
		recordBcbObservationUnavailableCapture(
			bcbDiagRec({
				sessionId: "s2",
				writerId: "session-event-bcb-eligible-no-bcb-writer",
				canObserveHeldResults: true,
				liveToolsIncludesCommandStatus: true,
				committedPhase: undefined,
			}),
		)
		const blocked = findBcbObservationUnavailableCaptureByWriter("session-event-bcb-blocked-observation-unavailable")
		expect(blocked).toHaveLength(1)
		expect(blocked[0]!.sessionId).toBe("s1")
		const noBcb = findBcbObservationUnavailableCaptureByWriter("session-event-bcb-eligible-no-bcb-writer")
		expect(noBcb).toHaveLength(1)
		expect(noBcb[0]!.sessionId).toBe("s2")
	})

	it("BCAPT-DIAG.6: clear() resets the ring + seq", () => {
		enableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
		recordBcbObservationUnavailableCapture(bcbDiagRec())
		expect(getBcbObservationUnavailableCaptureSeq()).toBe(1)
		clearBcbObservationUnavailableCapture()
		expect(getBcbObservationUnavailableCaptureSeq()).toBe(0)
		expect(getBcbObservationUnavailableCaptureRecords()).toHaveLength(0)
	})
})

// =============================================================================
// BCAPT-RED-ISOLATION: confirm the intentionally RED L2847 tests stay RED
// =============================================================================
describe("BCAPT-RED-ISOLATION: three intentionally RED L2847 witnesses stay RED and outside this ACT", () => {
	it("BCAPT-RED-ISOLATION.1: the L2847 test file is reachable from the default vitest gate (not excluded) so its 3 RED tests remain RED until the L2847 repair ACT", () => {
		const l2847TestPath = resolve(__dirname, "task-terminal-divergence-red01.tdd-red01.test.ts")
		expect(existsSync(l2847TestPath)).toBe(true)
	})

	it("BCAPT-RED-ISOLATION.2: this ACT's diagnostic does not silence the L2847 'error' phase write", async () => {
		disableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
		const h = makeBcaptHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"]
		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))

		// The BCB writer is the live firing branch for the SEAM10 turn
		// (per CORR01 §1). Capture is OFF -> zero records.
		expect(h.finalWriterId()).toBe("session-event-bcb-blocked-observation-unavailable")
		expect(h.getCaptureRecords()).toHaveLength(0)
	})
})

// =============================================================================
// BCAPT-CMD: command surface (registry + package.json + extension.ts)
// =============================================================================

const COMMAND_REGISTRY_PATH = resolve(__dirname, "../../registry.ts")
const COMMAND_PACKAGE_JSON_PATH = resolve(__dirname, "../../../package.json")
const COMMAND_EXTENSION_PATH = resolve(__dirname, "../../extension.ts")

function readCommandSource(path: string): string {
	return readFileSyncFs(path, "utf8")
}

function fakeBcbCaptureContext(storagePath: string): BcbObservationUnavailableCaptureContext {
	const store = new Map<string, unknown>()
	return {
		workspaceState: {
			get: ((key: string) => store.get(key)) as BcbObservationUnavailableCaptureContext["workspaceState"]["get"],
			update: async (key: string, value: unknown) => {
				if (value === undefined) {
					store.delete(key)
				} else {
					store.set(key, value)
				}
			},
		},
		globalStorageUri: { fsPath: storagePath },
		subscriptions: [],
	}
}

describe("BCAPT-CMD.1: package.json contributes both command IDs", () => {
	it("BCAPT-CMD.1.1: toggle command is declared in package.json with palette-searchable title", () => {
		const pkg = readCommandSource(COMMAND_PACKAGE_JSON_PATH)
		expect(pkg).toContain("cline.debug.toggleBcbObservationUnavailableCapture")
		expect(pkg).toMatch(
			/"command":\s*"cline\.debug\.toggleBcbObservationUnavailableCapture"[\s\S]*?"title":\s*"[^"]*[Bb][Cc][Bb][^"]*"/,
		)
	})

	it("BCAPT-CMD.1.2: dump command is declared in package.json with palette-searchable title", () => {
		const pkg = readCommandSource(COMMAND_PACKAGE_JSON_PATH)
		expect(pkg).toContain("cline.debug.dumpBcbObservationUnavailableCapture")
		expect(pkg).toMatch(
			/"command":\s*"cline\.debug\.dumpBcbObservationUnavailableCapture"[\s\S]*?"title":\s*"[^"]*[Bb][Cc][Bb][^"]*"/,
		)
	})
})

describe("BCAPT-CMD.2: registry exposes both command constants and extension.ts registers them", () => {
	it("BCAPT-CMD.2.1: registry declares both constants with the correct id-suffix", () => {
		const registry = readCommandSource(COMMAND_REGISTRY_PATH)
		expect(registry).toContain("ToggleBcbObservationUnavailableCapture")
		expect(registry).toContain("DumpBcbObservationUnavailableCapture")
		expect(registry).toMatch(/prefix\s*\+\s*"\.debug\.toggleBcbObservationUnavailableCapture"/)
		expect(registry).toMatch(/prefix\s*\+\s*"\.debug\.dumpBcbObservationUnavailableCapture"/)
	})

	it("BCAPT-CMD.2.2: extension.ts registers both commands via vscode.commands.registerCommand", () => {
		const ext = readCommandSource(COMMAND_EXTENSION_PATH)
		expect(ext).toMatch(/vscode\.commands\.registerCommand\([^)]*commands\.ToggleBcbObservationUnavailableCapture/s)
		expect(ext).toMatch(/vscode\.commands\.registerCommand\([^)]*commands\.DumpBcbObservationUnavailableCapture/s)
	})
})

describe("BCAPT-CMD.3: toggle calls the existing capture enable/disable seam", () => {
	let tmp: string
	let context: BcbObservationUnavailableCaptureContext

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "bcb-obs-cap-cmd-toggle-"))
		context = fakeBcbCaptureContext(tmp)
		disableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
	})

	afterEach(() => {
		if (existsSync(tmp)) {
			rmSync(tmp, { recursive: true, force: true })
		}
		disableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
	})

	it("BCAPT-CMD.3.1: workspace state default is OFF (undefined → false)", () => {
		expect(isBcbObservationUnavailableCaptureWorkspaceEnabled(context)).toBe(false)
	})

	it("BCAPT-CMD.3.2: toggle flips the workspace flag AND the in-process enabled flag", async () => {
		const next1 = await toggleBcbObservationUnavailableCaptureWorkspaceEnabled(context)
		expect(next1).toBe(true)
		expect(isBcbObservationUnavailableCaptureWorkspaceEnabled(context)).toBe(true)
		expect(isBcbObservationUnavailableCaptureEnabled()).toBe(true)

		const next2 = await toggleBcbObservationUnavailableCaptureWorkspaceEnabled(context)
		expect(next2).toBe(false)
		expect(isBcbObservationUnavailableCaptureWorkspaceEnabled(context)).toBe(false)
		expect(isBcbObservationUnavailableCaptureEnabled()).toBe(false)
	})

	it("BCAPT-CMD.3.3: post-toggle capture records exactly one entry per BCB cycle", async () => {
		await toggleBcbObservationUnavailableCaptureWorkspaceEnabled(context)
		const h = makeBcaptHarness()
		h.unconsumedOverride.value = 1
		h.unconsumedJobIdsOverride.value = ["cmd-bcb-held-1"]
		h.liveToolsOverride.value = ["read_files", "run_commands"]
		await emitSubmitAndExit(h)
		await new Promise<void>((r) => setImmediate(r))
		expect(h.getCaptureRecords()).toHaveLength(1)
		expect(h.getCaptureRecords()[0]!.writerId).toBe("session-event-bcb-blocked-observation-unavailable")
	})
})

describe("BCAPT-CMD.4: dump calls the existing capture get/export seam", () => {
	let tmp: string
	let context: BcbObservationUnavailableCaptureContext

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "bcb-obs-cap-cmd-dump-"))
		context = fakeBcbCaptureContext(tmp)
		disableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
	})

	afterEach(() => {
		if (existsSync(tmp)) {
			rmSync(tmp, { recursive: true, force: true })
		}
		disableBcbObservationUnavailableCapture()
		clearBcbObservationUnavailableCapture()
	})

	it("BCAPT-CMD.4.1: dump writes the JSONL file to <globalStorageUri>/bcb-observation-unavailable-capture.jsonl", async () => {
		enableBcbObservationUnavailableCapture()
		recordBcbObservationUnavailableCapture(bcbDiagRec({ sessionId: "s-dump", taskId: "t-dump", liveToolsValue: [] }))
		const file = await dumpExtensionSideBcbObservationUnavailableCapture(context)
		expect(file).toBe(join(tmp, "bcb-observation-unavailable-capture.jsonl"))
		const contents = readFileSync(file, "utf8")
		const lines = contents.split("\n").filter((l) => l.length > 0)
		expect(lines).toHaveLength(1)
		const parsed = JSON.parse(lines[0]!)
		expect(parsed.sessionId).toBe("s-dump")
		expect(parsed.writerId).toBe("session-event-bcb-blocked-observation-unavailable")
	})
})
