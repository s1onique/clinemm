/**
 * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 — CFPR01
 *
 * The PROVENANCE RETENTION SUITE for containment failures.
 *
 * THE QUESTION THIS SUITE ANSWERS:
 *
 *   When a containment failure occurs and a later C10 completion barrier
 *   holds on that job, can the operator still recover the ORIGINAL
 *   cleanup evidence from a single BJLA dump — even after hundreds or
 *   thousands of unrelated lifecycle events have aged the ordinary
 *   256-record FIFO out?
 *
 * THE DEFECT THIS REPRODUCES:
 *
 *   The ordinary BJLA FIFO is bounded at 256 records. A containment
 *   failure record is emitted once, at the moment the manager
 *   classifies the terminal postcondition. Every subsequent unrelated
 *   lifecycle event pushes the ring forward. After 256 more events the
 *   ORIGINAL failure classification — the kernel verdict, the OS errno,
 *   the owner session — has been EVICTED from the ring and is simply
 *   GONE. The C10 blocking set that later holds the completion names
 *   the job id, but the reason the job is in the containment ledger is
 *   no longer recoverable from the dump.
 *
 * WHAT THIS ACT CHANGES:
 *
 *   Diagnostics ONLY. A bounded, diagnostic-only protected retention
 *   store keeps the ORIGINAL per-job failure observation, the
 *   associated controller terminal publication, and the most recent
 *   nonempty C10 blocking-set snapshots OUTSIDE the ordinary FIFO, so
 *   they survive FIFO wrap. No process termination, no job state, no
 *   containment classification, no continuation scheduling and no task
 *   completion semantics change.
 *
 * EVIDENCE CLASSIFICATION: **SYNTHETIC_REAL**. The production
 * manager / classifier / coordinator / dump seams are the REAL ones;
 * only the supervisor and the manager's documented
 * `terminalPostconditionProbe` test seam are injected. NO live
 * process-group claim is made from this suite.
 *
 * WHAT THIS SUITE DOES NOT DO:
 *   - It does NOT re-probe a process group (a later authoritative
 *     observation is UNAVAILABLE_FROM_TRACE: issuing one would be a
 *     NEW process signal, which the ACT explicitly forbids).
 *   - It does NOT clear a containment failure.
 *   - It does NOT change the completion-barrier semantics.
 *   - It does NOT add any process signal of its own.
 */

import { mkdtempSync, readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord,
	type BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord,
	type BackgroundJobLivenessAuthorityProvenanceSnapshot,
	captureBackgroundJobLivenessAuthorityRecord,
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	clearBackgroundJobLivenessAuthorityProvenanceStore,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityProvenanceSnapshot,
	setBackgroundJobLivenessAuthorityCaptureBufferSize,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
	setBackgroundJobLivenessAuthorityProvenanceBounds,
} from "../background-job-liveness-authority"
import { dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic } from "../background-job-liveness-authority-runtime"
import { CommandJobManager, type TerminalPostconditionProbeResult } from "../command-job-manager"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState } from "../message-translator"
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
	setBackgroundJobLivenessAuthorityCaptureEnabled(true)
	// The ordinary FIFO stays at its PRODUCTION bound (256) — the RED
	// must reproduce against the real capacity, not a shrunken one.
	setBackgroundJobLivenessAuthorityCaptureBufferSize(256)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	clearBackgroundJobLivenessAuthorityProvenanceStore()
	setBackgroundJobLivenessAuthorityProvenanceBounds(undefined)
})

afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	setBackgroundJobLivenessAuthorityCaptureEnabled(false)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
	clearBackgroundJobLivenessAuthorityProvenanceStore()
	setBackgroundJobLivenessAuthorityProvenanceBounds(undefined)
})

/**
 * A supervisor whose `terminateTree` resolves the exit promise (so the
 * manager's `finalize()` runs) while exposing a controlled pid/pgid.
 *
 * NO real process is spawned and NO real signal is sent.
 */
function makeSupervisorDouble(pid: number, pgid: number): SupervisableShellProcess {
	let exitResolve: ((v: { exitCode: number | null; signal: NodeJS.Signals | null }) => void) | null = null
	const exit = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((r) => {
		exitResolve = r
	})
	return {
		pid,
		pgid,
		exit,
		killTree: async () => {},
		terminateTree: async () => {
			setImmediate(() => {
				exitResolve?.({ exitCode: null, signal: "SIGKILL" })
			})
			return { treeTerminated: true, escalatedToKill: false, epermDetected: false }
		},
		stdoutSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
		stderrSnapshot: () => ({ text: "", totalChars: 0, dropped: false }),
	} as unknown as SupervisableShellProcess
}

interface StartedJob {
	readonly jobId: string
	readonly state: string
	readonly manager: CommandJobManager
}

/**
 * Start a job through the REAL manager with a controlled terminal
 * postcondition, run it to terminal, and return the job id + the
 * terminal state the manager actually published.
 *
 * The `terminalPostconditionProbe` seam is the DOCUMENTED manager
 * test seam; the object form additionally supplies the OS errno.
 */
async function startJobAndRunToTerminal(opts: {
	readonly postcondition: TerminalPostconditionProbeResult
	readonly pid: number
	readonly pgid: number
	readonly ownerSessionId?: string
}): Promise<StartedJob> {
	const manager = new CommandJobManager({
		spawnFactory: () => makeSupervisorDouble(opts.pid, opts.pgid),
		terminalPostconditionProbe: () => opts.postcondition,
	})
	const started = await manager.start(
		{
			command: "/bin/sh -c 'sleep 60'",
			cwd: process.cwd(),
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
		},
		"ownerSessionId" in opts ? ({ sessionId: opts.ownerSessionId } as never) : ({} as never),
	)
	const jobId = started.jobId
	await manager.cancel({ jobId })
	for (let i = 0; i < 200; i += 1) {
		const status = await manager.status({ jobId, waitMs: 0 })
		if (status.ok && status.snapshot.state !== "running") break
		await new Promise((r) => setTimeout(r, 10))
	}
	const terminal = await manager.status({ jobId, waitMs: 0 })
	return { jobId, state: terminal.ok ? terminal.snapshot.state : "unknown", manager }
}

function containmentClassifiedRecords(): BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord[] {
	return getBackgroundJobLivenessAuthorityCaptureRecords().filter(
		(r): r is BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord =>
			r.event === "containment_failure_classified",
	)
}

function blockingSetRecords(): BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord[] {
	return getBackgroundJobLivenessAuthorityCaptureRecords().filter(
		(r): r is BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord =>
			r.event === "containment_ledger_blocking_set",
	)
}

/**
 * Emit ORDINARY (unrelated) BJLA lifecycle observations. These are the
 * records that age the ordinary 256-record FIFO out of the original
 * containment evidence.
 *
 * The emitted event is a real BJLA record type so the reproduction
 * uses the production capture seam verbatim.
 */
function emitOrdinaryLifecycleEvents(count: number): void {
	for (let i = 0; i < count; i += 1) {
		captureBackgroundJobLivenessAuthorityRecord({
			event: "job_status_lookup",
			capturedAt: Date.now(),
			managerInstance: null,
			hostInstance: null,
			jobId: `ordinary-job-${i}`,
			source: "miss",
			returnedState: null,
		})
	}
}

/**
 * Emit a controller terminal-state publication for a job — the REAL
 * record shape produced by `SdkController.updateBackgroundCommandState`.
 *
 * This is an INJECTED CONTROLLER PROJECTION: the record shape and the
 * capture seam are production, but the SdkController instance itself is
 * not constructed in this suite. The suite says so honestly.
 */
function emitControllerTerminalPublication(opts: {
	readonly jobId: string
	readonly ownerSessionId: string | null
	readonly publishedState: "containment_failed" | "exited" | "cancelled"
}): void {
	captureBackgroundJobLivenessAuthorityRecord({
		event: "containment_terminal_state_published",
		capturedAt: Date.now(),
		managerInstance: null,
		hostInstance: null,
		jobId: opts.jobId,
		publishedState: opts.publishedState,
		ownerSessionId: opts.ownerSessionId,
		isContainmentFailure: opts.publishedState === "containment_failed",
	})
}

interface CoordinatorHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly translatorState: MessageTranslatorState
	readonly sessionId: string
	readonly taskId: string
	readonly jobStates: Record<string, string>
	readonly jobOwners: Record<string, string | undefined>
}

/**
 * Build a REAL `SdkSessionEventCoordinator` wired exactly as
 * `SdkController` wires the PHCF01 authority inputs, so the blocking-set
 * capture is exercised through the production classifier.
 */
function makeCoordinatorHarness(opts: { readonly sessionId?: string; readonly taskId?: string } = {}): CoordinatorHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sessionId = opts.sessionId ?? "session-cfpr01"
	const taskId = opts.taskId ?? "task-cfpr01"
	const jobStates: Record<string, string> = {}
	const jobOwners: Record<string, string | undefined> = {}

	const coordinator = new SdkSessionEventCoordinator({
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId,
				sdkHost: {},
				unsubscribe: vi.fn(),
				startResult: { sessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
			emitHookMessage: vi.fn(),
		},
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		hasRunningBackgroundJobForOwner: () => false,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		getUnconsumedOwnedTerminalResultCount: () => 0,
		getUnconsumedOwnedTerminalJobIds: () => [],
		getBackgroundCommandJobStates: () => jobStates,
		getBackgroundCommandJobOwners: () => jobOwners,
		getElmCompletionAuthorityDecision: () => ({ kind: "authorize", reason: "cfpr01-injected-authorize" }) as const,
		flushElmAuthorityForSession: async () => {},
	} as unknown as SdkSessionEventCoordinatorOptions)

	return { coordinator, translatorState, sessionId, taskId, jobStates, jobOwners }
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

/**
 * Drive a completion attempt through the REAL coordinator so the C10
 * completion-attempt boundary is reached.
 */
async function emitCompletionTurn(h: CoordinatorHarness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	await h.coordinator.handleSessionEvent(
		agentEvent(h.sessionId, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
	)
}

function makeDumpDir(): string {
	return mkdtempSync(join(tmpdir(), "cfpr01-dump-"))
}

describe("ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01)", () => {
	describe("RED-01: ordinary FIFO eviction destroys the original cause", () => {
		it("CFPR01-01: a real containment failure is produced by the real CommandJobManager", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "eperm", osErrorCode: "EPERM" },
				pid: 51001,
				pgid: 51001,
				ownerSessionId: "session-cfpr01",
			})
			try {
				expect(started.state).toBe("containment_failed")
				const records = containmentClassifiedRecords()
				expect(records).toHaveLength(1)
				expect(records[0].jobId).toBe(started.jobId)
				expect(records[0].postcondition).toBe("eperm")
				expect(records[0].osErrorCode).toBe("EPERM")
				expect(records[0].containmentFailed).toBe("substrate_eperm")
				expect(records[0].ownerSessionId).toBe("session-cfpr01")
			} finally {
				await started.manager.dispose()
			}
		})

		it("CFPR01-02: the original failure record IS evicted from the ordinary 256-record FIFO", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "eperm", osErrorCode: "EPERM" },
				pid: 51002,
				pgid: 51002,
				ownerSessionId: "session-cfpr01",
			})
			try {
				expect(containmentClassifiedRecords()).toHaveLength(1)
				// More than 256 ordinary, unrelated lifecycle events.
				emitOrdinaryLifecycleEvents(300)
				// THE OBSERVED DEFECT: the original cause is GONE from
				// the ordinary ring. Nothing in the ring can explain
				// WHY the job is in the containment ledger.
				expect(containmentClassifiedRecords()).toHaveLength(0)
				expect(getBackgroundJobLivenessAuthorityCaptureRecords().length).toBeLessThanOrEqual(256)
			} finally {
				await started.manager.dispose()
			}
		})

		it("CFPR01-03: the provenance dump STILL recovers the original cause after FIFO eviction", async () => {
			const dir = makeDumpDir()
			try {
				const started = await startJobAndRunToTerminal({
					postcondition: { postcondition: "eperm", osErrorCode: "EPERM" },
					pid: 51003,
					pgid: 51003,
					ownerSessionId: "session-cfpr01",
				})
				try {
					emitControllerTerminalPublication({
						jobId: started.jobId,
						ownerSessionId: "session-cfpr01",
						publishedState: "containment_failed",
					})
					// Age the ordinary FIFO out.
					emitOrdinaryLifecycleEvents(300)
					expect(containmentClassifiedRecords()).toHaveLength(0)

					// The operator dumps the diagnostic.
					const { file } = await dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic({
						globalStorageUri: { fsPath: dir },
					})
					expect(file).toBe(join(dir, "background-job-liveness-authority.jsonl"))

					// The COMPANION artifact carries the protected evidence.
					const provenanceFile = join(dir, "background-job-liveness-authority.provenance.json")
					const provenance = JSON.parse(
						readFileSync(provenanceFile, "utf8"),
					) as BackgroundJobLivenessAuthorityProvenanceSnapshot
					const entry = provenance.protectedJobs.find((j) => j.jobId === started.jobId)
					expect(entry).toBeDefined()
					// THE VERDICT AND THE ERRNO ARE PRESERVED EXACTLY.
					expect(entry!.failureRecord).not.toBeNull()
					expect(entry!.failureRecord!.postcondition).toBe("eperm")
					expect(entry!.failureRecord!.osErrorCode).toBe("EPERM")
					expect(entry!.failureRecord!.containmentFailed).toBe("substrate_eperm")
					expect(entry!.failureRecord!.ownerSessionId).toBe("session-cfpr01")
				} finally {
					await started.manager.dispose()
				}
			} finally {
				await rm(dir, { recursive: true, force: true })
			}
		})
	})

	describe("RED-02: the C10 completion boundary joins to the retained provenance", () => {
		it("CFPR01-04: the C10 blocker id EQUALS the retained failure job id AND the publication job id", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "alive", osErrorCode: null },
				pid: 51004,
				pgid: 51004,
				ownerSessionId: "session-cfpr01",
			})
			try {
				// The controller's per-job map projects the terminal
				// state the C10 classifier reads. (INJECTED
				// CONTROLLER PROJECTION — the coordinator is real, the
				// SdkController instance is not constructed here.)
				emitControllerTerminalPublication({
					jobId: started.jobId,
					ownerSessionId: "session-cfpr01",
					publishedState: "containment_failed",
				})

				const h = makeCoordinatorHarness({ sessionId: "session-cfpr01" })
				h.jobStates[started.jobId] = "containment_failed"
				h.jobOwners[started.jobId] = "session-cfpr01"
				await emitCompletionTurn(h)

				const c10 = blockingSetRecords().find((r) => r.boundary === "c10_completion_attempt")
				expect(c10).toBeDefined()
				expect([...c10!.blockingJobIds]).toEqual([started.jobId])
				expect(c10!.blockingOwnershipClasses).toEqual(["matching_owner"])

				// Age the ordinary FIFO out so the join can only be
				// satisfied by the PROTECTED store.
				emitOrdinaryLifecycleEvents(300)
				expect(containmentClassifiedRecords()).toHaveLength(0)

				const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
				const entry = snapshot.protectedJobs.find((j) => j.jobId === started.jobId)
				expect(entry).toBeDefined()
				// blocking job id = retained original failure job id =
				// retained terminal-publication job id.
				expect(entry!.jobId).toBe(c10!.blockingJobIds[0])
				expect(entry!.failureRecord!.jobId).toBe(c10!.blockingJobIds[0])
				expect(entry!.terminalPublicationRecord!.jobId).toBe(c10!.blockingJobIds[0])
				// The source's owner identity is preserved.
				expect(entry!.failureRecord!.ownerSessionId).toBe("session-cfpr01")
			} finally {
				await started.manager.dispose()
			}
		})

		it("CFPR01-05: a FOREIGN owner's job is NOT a blocker and is NOT misclassified", async () => {
			const h = makeCoordinatorHarness({ sessionId: "session-cfpr01" })
			h.jobStates["job-foreign"] = "containment_failed"
			h.jobOwners["job-foreign"] = "session-other"
			await emitCompletionTurn(h)

			const c10 = blockingSetRecords().find((r) => r.boundary === "c10_completion_attempt")
			expect(c10).toBeDefined()
			expect([...c10!.blockingJobIds]).toEqual([])
			expect(c10!.foreignOwnerEntriesExcluded).toBe(1)

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			// The foreign job never became a blocker, so it must not
			// appear in the blocking-set membership coverage.
			const coverage = snapshot.coverage.filter((c) => c.blockingJobIds.includes("job-foreign"))
			expect(coverage).toHaveLength(0)
		})

		it("CFPR01-06: an UNKNOWN owner blocks (fail closed) and stays explicitly unknown", async () => {
			const h = makeCoordinatorHarness({ sessionId: "session-cfpr01" })
			h.jobStates["job-unknown"] = "containment_failed"
			// NO owner recorded.
			await emitCompletionTurn(h)

			const c10 = blockingSetRecords().find((r) => r.boundary === "c10_completion_attempt")
			expect(c10).toBeDefined()
			expect([...c10!.blockingJobIds]).toEqual(["job-unknown"])
			expect(c10!.blockingOwnershipClasses).toEqual(["unknown_owner"])

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			const coverage = snapshot.coverage.find((c) => c.blockingJobIds.includes("job-unknown"))
			expect(coverage).toBeDefined()
			expect(coverage!.ownershipClass).toBe("unknown_owner")
			// The job never produced a failure observation in this
			// suite, so the join is INCOMPLETE — and says so.
			expect(coverage!.failureRecordAvailability).not.toBe("JOIN_COMPLETE")
		})
	})

	describe("RED-03: overflow honesty", () => {
		it("CFPR01-07: exceeding the protected store bound reports ACTUAL loss", async () => {
			setBackgroundJobLivenessAuthorityProvenanceBounds({ maxProtectedJobs: 2, maxProtectedBlockingSessions: 1 })

			for (let i = 0; i < 5; i += 1) {
				captureBackgroundJobLivenessAuthorityRecord({
					event: "containment_failure_classified",
					capturedAt: Date.now(),
					managerInstance: null,
					hostInstance: null,
					jobId: `overflow-job-${i}`,
					ownerSessionId: "session-cfpr01",
					pid: 52000 + i,
					pgid: 52000 + i,
					postcondition: "eperm",
					osErrorCode: "EPERM",
					containmentFailed: "substrate_eperm",
					jobState: "containment_failed",
				})
			}

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			// The store NEVER grows without bound.
			expect(snapshot.protectedJobs.length).toBeLessThanOrEqual(2)
			// The loss is REPORTED, not silent.
			expect(snapshot.loss.protectedJobEvictions).toBeGreaterThan(0)
			// The NEWEST relevant evidence is preserved.
			expect(snapshot.protectedJobs.map((j) => j.jobId)).toContain("overflow-job-4")
		})

		it("CFPR01-08: a missing required record is NOT reported as JOIN_COMPLETE and no errno is manufactured", async () => {
			const h = makeCoordinatorHarness({ sessionId: "session-cfpr01" })
			h.jobStates["job-no-failure"] = "containment_failed"
			h.jobOwners["job-no-failure"] = "session-cfpr01"
			await emitCompletionTurn(h)

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			const coverage = snapshot.coverage.find((c) => c.blockingJobIds.includes("job-no-failure"))
			expect(coverage).toBeDefined()
			expect(coverage!.failureRecordAvailability).toBe("UNAVAILABLE_FROM_TRACE")
			expect(coverage!.terminalPublicationAvailability).toBe("UNAVAILABLE_FROM_TRACE")
			// NO postcondition / errno is invented for a missing record.
			expect(coverage!.postcondition ?? null).toBeNull()
			expect(coverage!.osErrorCode ?? null).toBeNull()
		})

		it("CFPR01-09: an unusually LARGE blocking set is not presented as complete", async () => {
			setBackgroundJobLivenessAuthorityProvenanceBounds({ maxProtectedBlockingSessions: 1, maxBlockingSetJobIds: 2 })
			captureBackgroundJobLivenessAuthorityRecord({
				event: "containment_ledger_blocking_set",
				capturedAt: Date.now(),
				managerInstance: null,
				hostInstance: null,
				activeSessionId: "session-big",
				blockingJobIds: ["big-a", "big-b", "big-c", "big-d"],
				blockingOwnershipClasses: ["matching_owner", "matching_owner", "matching_owner", "matching_owner"],
				totalContainmentFailureEntries: 4,
				foreignOwnerEntriesExcluded: 0,
				boundary: "c10_completion_attempt",
			})

			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			const set = snapshot.blockingSets[0]
			expect(set).toBeDefined()
			// The overflow is reported EXACTLY.
			expect(set!.truncated).toBe(true)
			expect(set!.originalBlockingJobCount).toBe(4)
			expect(set!.retainedBlockingJobCount).toBe(2)
			expect(set!.omittedBlockingJobIds).toEqual(["big-c", "big-d"])
			expect(snapshot.loss.blockingSetTruncations).toBe(1)
		})
	})

	describe("the GATES", () => {
		it("CFPR01-10: repeated dumps are IDENTICAL when no new events occur", async () => {
			const dir = makeDumpDir()
			try {
				const started = await startJobAndRunToTerminal({
					postcondition: { postcondition: "eperm", osErrorCode: "EPERM" },
					pid: 51010,
					pgid: 51010,
					ownerSessionId: "session-cfpr01",
				})
				try {
					emitControllerTerminalPublication({
						jobId: started.jobId,
						ownerSessionId: "session-cfpr01",
						publishedState: "containment_failed",
					})
					const ctx = { globalStorageUri: { fsPath: dir } }
					const first = await dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic(ctx)
					const firstText = readFileSync(join(dir, "background-job-liveness-authority.provenance.json"), "utf8")
					const second = await dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic(ctx)
					const secondText = readFileSync(join(dir, "background-job-liveness-authority.provenance.json"), "utf8")
					// dump != clear: the evidence survives the dump.
					expect(first.recordCount).toBe(second.recordCount)
					expect(firstText).toBe(secondText)
					// And the evidence is STILL there after the dumps.
					expect(firstText).toContain(started.jobId)
				} finally {
					await started.manager.dispose()
				}
			} finally {
				await rm(dir, { recursive: true, force: true })
			}
		})

		it("CFPR01-11: the capture is DEFAULT_OFF — no protected record, no map mutation", async () => {
			setBackgroundJobLivenessAuthorityCaptureEnabled(false)
			clearBackgroundJobLivenessAuthorityCaptureRecords()
			clearBackgroundJobLivenessAuthorityProvenanceStore()
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "alive", osErrorCode: null },
				pid: 51011,
				pgid: 51011,
				ownerSessionId: "session-cfpr01",
			})
			try {
				// The PRODUCTION semantics are unchanged.
				expect(started.state).toBe("containment_failed")
				expect(containmentClassifiedRecords()).toHaveLength(0)
				// And NO protected record was inserted.
				const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
				expect(snapshot.protectedJobs).toHaveLength(0)
				expect(snapshot.blockingSets).toHaveLength(0)
			} finally {
				await started.manager.dispose()
			}
		})

		it("CFPR01-12: an EMPTY capture reports incomplete evidence honestly", async () => {
			const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
			expect(snapshot.protectedJobs).toHaveLength(0)
			expect(snapshot.blockingSets).toHaveLength(0)
			expect(snapshot.coverage).toHaveLength(0)
			expect(snapshot.loss.protectedJobEvictions).toBe(0)
			expect(snapshot.loss.protectedRecordEvictions).toBe(0)
			expect(snapshot.loss.blockingSetEvictions).toBe(0)
			expect(snapshot.loss.blockingSetTruncations).toBe(0)
		})

		it("CFPR01-13: the ordinary 256-record FIFO bound is UNCHANGED", async () => {
			emitOrdinaryLifecycleEvents(1000)
			expect(getBackgroundJobLivenessAuthorityCaptureRecords().length).toBe(256)
		})

		it("CFPR01-14: the protected store introduces NO process signal", async () => {
			const fs = await import("node:fs/promises")
			const source = await fs.readFile(new URL("../background-job-liveness-authority.ts", import.meta.url), "utf8")
			// The protected store must not reach for a process signal.
			expect(source).not.toMatch(/process\.kill\s*\(/)
			expect(source).not.toMatch(/killpg/)
			expect(source).not.toMatch(/child_process/)
			expect(source).not.toMatch(/execSync|spawnSync/)
		})
	})

	describe("NECESSITY / ABLATION (ACT sec 9)", () => {
		it("CFPR01-15: ABLATED (protected capacity 0) — the original provenance disappears after FIFO eviction", async () => {
			// ABLATION: the protected retention is REMOVED (capacity 0).
			// The containment ENFORCEMENT is untouched — the job still
			// reaches `containment_failed` exactly as before. Only the
			// diagnostic retention is gone.
			setBackgroundJobLivenessAuthorityProvenanceBounds({ maxProtectedJobs: 0 })
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "eperm", osErrorCode: "EPERM" },
				pid: 51015,
				pgid: 51015,
				ownerSessionId: "session-cfpr01",
			})
			try {
				// The PRODUCTION semantics are UNCHANGED by the ablation.
				expect(started.state).toBe("containment_failed")
				expect(containmentClassifiedRecords()).toHaveLength(1)
				// Age the ordinary FIFO out.
				emitOrdinaryLifecycleEvents(300)
				expect(containmentClassifiedRecords()).toHaveLength(0)
				// THE ABLATION RESULT: with the protected retention
				// removed, the original provenance is GONE — not merely
				// moved somewhere else.
				const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
				expect(snapshot.protectedJobs).toHaveLength(0)
				expect(snapshot.loss.protectedJobEvictions).toBeGreaterThan(0)
			} finally {
				await started.manager.dispose()
			}
		})

		it("CFPR01-16: RETAINED (protected capacity 128) — the SAME evidence survives", async () => {
			// The matched arm of the ablation: the intervention is
			// RETAINING EVIDENCE, and nothing else changed.
			setBackgroundJobLivenessAuthorityProvenanceBounds({ maxProtectedJobs: 128 })
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "eperm", osErrorCode: "EPERM" },
				pid: 51016,
				pgid: 51016,
				ownerSessionId: "session-cfpr01",
			})
			try {
				expect(started.state).toBe("containment_failed")
				emitOrdinaryLifecycleEvents(300)
				expect(containmentClassifiedRecords()).toHaveLength(0)
				const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
				const entry = snapshot.protectedJobs.find((j) => j.jobId === started.jobId)
				expect(entry).toBeDefined()
				expect(entry!.failureRecord!.postcondition).toBe("eperm")
				expect(entry!.failureRecord!.osErrorCode).toBe("EPERM")
			} finally {
				await started.manager.dispose()
			}
		})

		it("CFPR01-17: with diagnostic capture DISABLED the production behaviour is UNCHANGED", async () => {
			// The third leg of the ablation: turning the diagnostic off
			// does not change containment enforcement.
			setBackgroundJobLivenessAuthorityCaptureEnabled(false)
			clearBackgroundJobLivenessAuthorityCaptureRecords()
			clearBackgroundJobLivenessAuthorityProvenanceStore()
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "alive", osErrorCode: null },
				pid: 51017,
				pgid: 51017,
				ownerSessionId: "session-cfpr01",
			})
			try {
				// IDENTICAL production outcome to the capture-ON arm.
				expect(started.state).toBe("containment_failed")
				const status = await started.manager.status({ jobId: started.jobId, waitMs: 0 })
				expect(status.ok).toBe(true)
				if (status.ok) {
					expect(status.snapshot.state).toBe("containment_failed")
				}
				// And NOTHING was retained.
				const snapshot = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
				expect(snapshot.protectedJobs).toHaveLength(0)
				expect(snapshot.blockingSets).toHaveLength(0)
				expect(snapshot.captureEnabled).toBe(false)
			} finally {
				await started.manager.dispose()
			}
		})
	})
})
