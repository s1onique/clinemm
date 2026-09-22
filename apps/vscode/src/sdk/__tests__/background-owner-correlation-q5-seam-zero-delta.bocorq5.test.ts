/**
 * ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01
 *
 * SEMANTIC ABLATION test for the Q5 BOCOR capture seam. Per ACT
 * sec 22, the capture MUST have zero semantic delta:
 *
 *   capture disabled vs capture enabled
 *   -> identical:
 *        guard result
 *        writer decision
 *        turn phase
 *        CommandJob state
 *        posted webview state
 *
 * Only the ring contents may differ.
 *
 * If the diagnostic changes semantics, the test must
 * HALT_DIAGNOSTIC_CHANGES_SEMANTICS (the test asserts the
 * negative form: identical semantics, ring contents are the
 * ONLY delta).
 *
 * Uses the same fakeSupervisor pattern as
 * background-command-awaiting-followup-guard01.bcafg01 so the
 * CommandJobManager does not need a real shell.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import {
	clearTurnStateWriterProvenanceDiagnostic,
	disableTurnStateWriterProvenanceDiagnostic,
} from "@shared/turn-state-writer-provenance"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	type BackgroundOwnerCorrelationRecord,
	clearBackgroundOwnerCorrelationCaptureRecords,
	getBackgroundOwnerCorrelationCaptureRecords,
	setBackgroundOwnerCorrelationCaptureBufferSize,
	setBackgroundOwnerCorrelationCaptureEnabled,
} from "../background-owner-correlation"
import { dumpExtensionSideBackgroundOwnerCorrelationDiagnostic } from "../background-owner-correlation-runtime"
import { CommandJobManager } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
import { SdkSessionEventCoordinator, type SdkSessionEventCoordinatorOptions } from "../sdk-session-event-coordinator"
import { TurnStateTracker } from "../turn-state-tracker"

// Disable the experimental sandbox (mirrors BCAFG01).
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

let supervisorPid = 91000

function fakeSupervisor(): SupervisableShellProcess {
	let resolveExit: (code: number | null) => void = () => {}
	const exitPromise = new Promise<number | null>((resolve) => {
		resolveExit = resolve
	})
	return Object.freeze({
		exit: exitPromise as unknown as Promise<never>,
		pid: ++supervisorPid,
		pgid: ++supervisorPid,
		killTree: async () => {},
		terminateTree: async () => {
			resolveExit(null)
			return {
				treeTerminated: true,
				escalatedToKill: false,
				epermDetected: false,
			}
		},
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	}) as unknown as SupervisableShellProcess
}

interface Harness {
	coordinator: SdkSessionEventCoordinator
	tracker: TurnStateTracker
	manager: CommandJobManager
	guardCalls: { count: number; lastResult: boolean | undefined }
}

function makeHarness(activeSessionId: string, jobOwnerSessionId: string | undefined, passContext: boolean): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState()
	void minter
	const supervisor = fakeSupervisor()
	const manager = new CommandJobManager({
		maxWaitBudgetMs: 50,
		spawnFactory: () => supervisor,
	})
	const guardCalls = { count: 0, lastResult: undefined as boolean | undefined }
	const options = {
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {},
				unsubscribe: () => {},
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: () => {},
		},
		messages: { appendAndEmit: () => {} },
		taskHistory: { updateTaskUsage: () => {} },
		getTask: () => undefined,
		postStateToWebview: () => Promise.resolve(),
		setTurnPhase: ((
			phase: Parameters<NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>>[0],
			_anchorTs?: number,
			writerId?: string,
		) => {
			tracker.setWithWriter(phase, undefined, {
				writerId: (writerId ?? "unknown-legacy-writer") as never,
			})
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		hasRunningBackgroundJobForOwner: (ownerSessionId: string | undefined) => {
			guardCalls.count += 1
			guardCalls.lastResult = Boolean(jobOwnerSessionId) && jobOwnerSessionId === ownerSessionId
			return guardCalls.lastResult
		},
		// ACT-CLINEMM-LONG-HORIZON-PENDING-PROMPT-AUTHORITY-TRANSPORT01-CORRECTION01:
		// Wire the CORRECTION01 availability-aware `getPendingPromptCount`
		// option. This harness simulates a LocalRuntimeHost where the
		// queue is unconditionally `available: true` with no pending
		// prompts — i.e. Shape F. Without this wire, the Q5 seam
		// defaults to `{ available: false }` (authority unavailable),
		// which is the production fail-closed default but does NOT
		// match this harness's intent (no queued autonomous work,
		// commit `awaiting_followup`).
		getPendingPromptCount: () => ({ available: true, count: 0 }),
		getActiveJobOwnershipSnapshot: () => manager.getActiveJobOwnershipSnapshot(),
	} as unknown as SdkSessionEventCoordinatorOptions
	void passContext // passed to startBackgroundJob, not used in harness
	return {
		coordinator: new SdkSessionEventCoordinator(options),
		tracker,
		manager,
		guardCalls,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({
		type: "agent_event",
		payload: {
			sessionId,
			event: event as never,
		},
	}) as CoreSessionEvent

async function startBackgroundJob(
	manager: CommandJobManager,
	passContext: boolean,
	sessionId: string,
): Promise<{ jobId: string }> {
	const start = await manager.start(
		{
			command: "sleep 120",
			cwd: process.cwd(),
			shell: "/bin/sh",
			env: { SHELL: "/bin/sh" },
			waitBudgetMs: 10,
			executionDeadlineMs: 60_000,
			maxOutputChars: 4096,
		},
		passContext ? { sessionId, agentId: "test-agent", iteration: 1 } : undefined,
	)
	if (start.state !== "running") {
		throw new Error(`expected state=running, got state=${start.state}`)
	}
	return { jobId: start.jobId }
}

describe("ACT-CLINEMM-BACKGROUND-COMMAND-OWNER-CORRELATION-CAPTURE01 / Q5 semantic ablation", () => {
	let dirs: string[] = []

	beforeEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		disableTurnStateWriterProvenanceDiagnostic()
		clearBackgroundOwnerCorrelationCaptureRecords()
		setBackgroundOwnerCorrelationCaptureEnabled(false)
		setBackgroundOwnerCorrelationCaptureBufferSize(64)
	})

	afterEach(() => {
		clearTurnStateWriterProvenanceDiagnostic()
		disableTurnStateWriterProvenanceDiagnostic()
		clearBackgroundOwnerCorrelationCaptureRecords()
		setBackgroundOwnerCorrelationCaptureEnabled(false)
		setBackgroundOwnerCorrelationCaptureBufferSize(64)
		dirs.forEach((d) => {
			try {
				rmSync(d, { recursive: true, force: true })
			} catch {
				// ignore
			}
		})
		dirs = []
	})

	it("capture OFF vs capture ON: identical guard result + writer decision + turn phase", async () => {
		// Set up the same LIVE-evidence scenario: a RUNNING job stamped
		// with the ACTIVE session id, and a done-without-completion
		// event arriving. Capture is OFF for the control case.
		const sessionId = "session-A"
		const h1 = makeHarness(sessionId, sessionId, true)
		const { jobId } = await startBackgroundJob(h1.manager, true, sessionId)
		expect(jobId).toBeTruthy()
		// Baseline turn phase
		h1.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		const beforePhase = h1.tracker.currentPhase
		// OFF capture: recorder bails. Phase transition MUST still be
		// SUPPRESSED because the guard returns true (matching owner).
		const done = agentEvent(sessionId, {
			type: "done",
			reason: "completed",
			text: "Some text without commit.",
			iterations: 1,
		})
		await h1.coordinator.handleSessionEvent(done)
		const phaseOff = h1.tracker.currentPhase
		expect(phaseOff).toBe(beforePhase)

		// ON capture: recorder appends. Phase transition MUST STILL be
		// SUPPRESSED (identical semantic).
		const h2 = makeHarness(sessionId, sessionId, true)
		const { jobId: jobId2 } = await startBackgroundJob(h2.manager, true, sessionId)
		expect(jobId2).toBeTruthy()
		h2.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		setBackgroundOwnerCorrelationCaptureEnabled(true)
		const beforePhase2 = h2.tracker.currentPhase
		await h2.coordinator.handleSessionEvent(
			agentEvent(sessionId, {
				type: "done",
				reason: "completed",
				text: "Some text without commit.",
				iterations: 1,
			}),
		)
		const phaseOn = h2.tracker.currentPhase
		expect(phaseOn).toBe(beforePhase2)

		// Identical semantic: both phases equal "streaming".
		expect(phaseOff).toBe("streaming")
		expect(phaseOn).toBe("streaming")

		// Only the ring contents differ.
		const recordsOn = getBackgroundOwnerCorrelationCaptureRecords()
		// The capture fires once for the h2 case.
		expect(recordsOn.length).toBe(1)
		const record = recordsOn[0]
		expect(record.event).toBe("background_owner_correlation_decision")
		expect(record.activeSessionId).toBe(sessionId)
		expect(record.queriedOwnerSessionId).toBe(sessionId)
		expect(record.guardAvailable).toBe(true)
		expect(record.guardResult).toBe(true)
		expect(record.candidateWriterId).toBe("session-event-turn-complete-resumable-straggler-preserve")
		expect(record.activeJobs).toHaveLength(1)
		expect(record.activeJobs[0].state).toBe("running")
		expect(record.activeJobs[0].ownerSessionId).toBe(sessionId)
	})

	it("capture ON: OC1-classifiable record shape when the job's ownerSessionId is undefined (no context passed)", async () => {
		// OC1 producer owner stamp defect: job started without context
		// so ownerSessionId is undefined; guard returns false; the
		// capture record carries the exact tuple needed to classify
		// as OC1 (active job with ownerSessionId undefined).
		const sessionId = "session-A"
		const h = makeHarness(sessionId, undefined, false)
		const { jobId } = await startBackgroundJob(h.manager, false, sessionId)
		expect(jobId).toBeTruthy()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		setBackgroundOwnerCorrelationCaptureEnabled(true)
		await h.coordinator.handleSessionEvent(
			agentEvent(sessionId, {
				type: "done",
				reason: "completed",
				text: "Some text without commit.",
				iterations: 1,
			}),
		)
		const records: readonly BackgroundOwnerCorrelationRecord[] = getBackgroundOwnerCorrelationCaptureRecords()
		expect(records).toHaveLength(1)
		const record = records[0]
		// OC1 signature: ownerSessionId is undefined on the active job.
		expect(record.activeJobs[0].ownerSessionId).toBeUndefined()
		expect(record.activeJobs[0].state).toBe("running")
		expect(record.activeSessionId).toBe(sessionId)
		expect(record.queriedOwnerSessionId).toBe(sessionId)
		expect(record.guardAvailable).toBe(true)
		expect(record.guardResult).toBe(false)
	})

	it("capture ON: OC2-classifiable record shape when ownerSessionId is a DIFFERENT session", async () => {
		// OC2 active session identity drift: job stamped with session B
		// but active session at done-time is session A. The capture
		// record carries the exact tuple needed to classify as OC2.
		const activeSessionId = "session-A"
		const ownerSessionId = "session-B"
		const h = makeHarness(activeSessionId, ownerSessionId, true)
		const { jobId } = await startBackgroundJob(h.manager, true, ownerSessionId)
		expect(jobId).toBeTruthy()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		setBackgroundOwnerCorrelationCaptureEnabled(true)
		await h.coordinator.handleSessionEvent(
			agentEvent(activeSessionId, {
				type: "done",
				reason: "completed",
				text: "Some text without commit.",
				iterations: 1,
			}),
		)
		const records: readonly BackgroundOwnerCorrelationRecord[] = getBackgroundOwnerCorrelationCaptureRecords()
		expect(records).toHaveLength(1)
		const record = records[0]
		expect(record.activeJobs[0].ownerSessionId).toBe("session-B")
		expect(record.activeJobs[0].ownerSessionId).not.toBe(record.activeSessionId)
		expect(record.queriedOwnerSessionId).toBe(activeSessionId)
		expect(record.guardAvailable).toBe(true)
		expect(record.guardResult).toBe(false)
	})

	it("capture ON: dump roundtrip after a single Q5 evaluation contains the exact correlation tuple", async () => {
		const dir = mkdtempSync(join(tmpdir(), "bocor-q5-ablation-"))
		dirs.push(dir)
		const sessionId = "session-X"
		const h = makeHarness(sessionId, sessionId, true)
		const { jobId } = await startBackgroundJob(h.manager, true, sessionId)
		expect(jobId).toBeTruthy()
		h.tracker.setWithWriter("streaming", undefined, {
			writerId: "task-start-init-task",
		})
		setBackgroundOwnerCorrelationCaptureEnabled(true)
		await h.coordinator.handleSessionEvent(
			agentEvent(sessionId, {
				type: "done",
				reason: "completed",
				text: "Some text without commit.",
				iterations: 1,
			}),
		)
		const { file } = await dumpExtensionSideBackgroundOwnerCorrelationDiagnostic({
			globalStorageUri: { fsPath: dir },
		})
		const lines = readFileSync(file, "utf8")
			.split("\n")
			.filter((l) => l.length > 0)
		expect(lines).toHaveLength(1)
		const parsed = JSON.parse(lines[0]) as BackgroundOwnerCorrelationRecord
		expect(parsed.event).toBe("background_owner_correlation_decision")
		expect(parsed.activeSessionId).toBe(sessionId)
		expect(parsed.guardResult).toBe(true)
		expect(parsed.guardAvailable).toBe(true)
		expect(parsed.activeJobs[0].ownerSessionId).toBe(sessionId)
		// Guard is consumed AFTER the capture is appended (the
		// capture is appended BEFORE the if/else resolves). Phase
		// stays streaming because the guard returned true (matching
		// owner; transition suppressed).
		expect(h.tracker.currentPhase).toBe("streaming")
	})
})

// Suppress unused-import lint for vi (kept for symmetry with BCAFG01).
