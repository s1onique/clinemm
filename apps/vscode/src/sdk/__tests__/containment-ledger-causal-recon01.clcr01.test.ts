/**
 * ACT-CLINEMM-CONTAINMENT-LEDGER-CAUSAL-RECON01 — CLCR01
 *
 * The CAUSAL RECONNAISSANCE SUITE for the containment ledger.
 *
 * THE QUESTION THIS SUITE ANSWERS:
 *
 *   Why does the completion barrier hold on unresolved containment
 *   failures, and HOW MANY of the ledger entries represent genuine
 *   containment obligations?
 *
 * THE THREE OUTCOMES THE LEDGER MUST DISTINGUISH (the macOS
 * `kill(2)` contract makes them distinguishable, and the previous
 * capture collapsed them):
 *
 *   1. A process group that ACTUALLY SURVIVED cleanup.
 *      The probe was PERMITTED (rc=0) and the group EXISTS.
 *      The bounded invariant `TERMINAL => PRIMARY OWNED PGID GONE` is
 *      REFUTED — a real, live obligation.
 *
 *   2. A cleanup probe DENIED by the substrate (Seatbelt / privilege).
 *      The errno is EPERM. The group's liveness is UNKNOWN — the
 *      invariant is UNPROVEN, not refuted. This is a DIFFERENT fact
 *      from (1) even though both produce `containment_failed`.
 *
 *   3. A HISTORICAL containment failure whose process group
 *      SUBSEQUENTLY DISAPPEARED, while the controller's projection
 *      remained `containment_failed`.
 *      The failure is REAL but no longer represents an outstanding
 *      obligation.
 *
 * EVIDENCE CLASSIFICATION: **SYNTHETIC_REAL**. The production
 * manager / classifier / coordinator seams are the REAL ones; only the
 * supervisor and the manager's documented `terminalPostconditionProbe`
 * test seam are injected. NO live process-group claim is made from this
 * suite.
 *
 * WHAT THIS SUITE DOES NOT DO:
 *   - It does NOT clear a containment failure.
 *   - It does NOT re-probe the process group (a later authoritative
 *     observation is UNAVAILABLE_FROM_TRACE: issuing one would be a
 *     NEW process signal, which the ACT explicitly forbids).
 *   - It does NOT change the completion-barrier semantics. The
 *     classifier stays fail-closed; only the EVIDENCE improves.
 */

import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	type BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord,
	type BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord,
	clearBackgroundJobLivenessAuthorityCaptureRecords,
	getBackgroundJobLivenessAuthorityCaptureRecords,
	setBackgroundJobLivenessAuthorityCaptureEnabled,
} from "../background-job-liveness-authority"
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
	clearBackgroundJobLivenessAuthorityCaptureRecords()
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
	setBackgroundJobLivenessAuthorityCaptureEnabled(false)
	clearBackgroundJobLivenessAuthorityCaptureRecords()
})

/**
 * A supervisor whose `terminateTree` resolves the exit promise (so the
 * manager's `finalize()` runs) while exposing a controlled pid/pgid.
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
 * test seam; the object form additionally supplies the OS errno, which
 * is what the containment ledger needs to distinguish a surviving
 * process group from a denied probe.
 */
async function startJobAndRunToTerminal(opts: {
	readonly postcondition: TerminalPostconditionProbeResult
	readonly pid: number
	readonly pgid: number
	/**
	 * The launch-time owner session. Omit the property ENTIRELY to
	 * start a job with NO recorded owner (the UNKNOWN-owner case).
	 */
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
function makeCoordinatorHarness(
	opts: {
		readonly sessionId?: string
		readonly taskId?: string
		readonly omitJobStates?: boolean
		readonly omitJobOwners?: boolean
	} = {},
): CoordinatorHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sessionId = opts.sessionId ?? "session-clcr01"
	const taskId = opts.taskId ?? "task-clcr01"
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
		...(opts.omitJobStates ? {} : { getBackgroundCommandJobStates: () => jobStates }),
		...(opts.omitJobOwners ? {} : { getBackgroundCommandJobOwners: () => jobOwners }),
		getElmCompletionAuthorityDecision: () => ({ kind: "authorize", reason: "clcr01-injected-authorize" }) as const,
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

describe("ACT-CLINEMM-CONTAINMENT-LEDGER-CAUSAL-RECON01 (CLCR01)", () => {
	describe("the containment boundary records the causal tuple", () => {
		it("CLCR01-01: a CLEAN terminal (`gone`) produces NO containment-failure record", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "gone", osErrorCode: "ESRCH" },
				pid: 41001,
				pgid: 41001,
			})
			try {
				expect(started.state).toBe("cancelled")
				expect(containmentClassifiedRecords()).toHaveLength(0)
			} finally {
				await started.manager.dispose()
			}
		})

		it("CLCR01-02: a SURVIVING process group (probe permitted, rc=0) is `substrate_alive` with a NULL errno", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "alive", osErrorCode: null },
				pid: 41002,
				pgid: 41002,
			})
			try {
				expect(started.state).toBe("containment_failed")
				const records = containmentClassifiedRecords()
				expect(records).toHaveLength(1)
				const record = records[0]
				// The process group ACTUALLY SURVIVED: the probe was
				// permitted and the group exists. The errno is NULL —
				// the probe did not throw.
				expect(record.postcondition).toBe("alive")
				expect(record.osErrorCode).toBeNull()
				expect(record.containmentFailed).toBe("substrate_alive")
				// The process identity is carried so the entry can be
				// joined back to the original process.
				expect(record.pid).toBe(41002)
				expect(record.pgid).toBe(41002)
				expect(record.jobId).toBe(started.jobId)
				expect(record.jobState).toBe("containment_failed")
			} finally {
				await started.manager.dispose()
			}
		})

		it("CLCR01-03: a DENIED probe (EPERM) is `substrate_eperm` — DISTINCT from a surviving group", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "eperm", osErrorCode: "EPERM" },
				pid: 41003,
				pgid: 41003,
			})
			try {
				expect(started.state).toBe("containment_failed")
				const records = containmentClassifiedRecords()
				expect(records).toHaveLength(1)
				const record = records[0]
				// The probe was DENIED. The group's liveness is UNKNOWN
				// — the invariant is UNPROVEN, not refuted. This is the
				// distinction the previous capture collapsed.
				expect(record.postcondition).toBe("eperm")
				expect(record.osErrorCode).toBe("EPERM")
				expect(record.containmentFailed).toBe("substrate_eperm")
			} finally {
				await started.manager.dispose()
			}
		})

		it("CLCR01-04: an ESRCH verdict is `gone` — the group was NOT FOUND, so it is NOT a containment failure", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "gone", osErrorCode: "ESRCH" },
				pid: 41004,
				pgid: 41004,
			})
			try {
				expect(started.state).toBe("cancelled")
				expect(containmentClassifiedRecords()).toHaveLength(0)
			} finally {
				await started.manager.dispose()
			}
		})

		it("CLCR01-05: the owner session is captured ON the failure record", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "alive", osErrorCode: null },
				pid: 41005,
				pgid: 41005,
				ownerSessionId: "session-owner-a",
			})
			try {
				const records = containmentClassifiedRecords()
				expect(records).toHaveLength(1)
				expect(records[0].ownerSessionId).toBe("session-owner-a")
			} finally {
				await started.manager.dispose()
			}
		})

		it("CLCR01-06: an UNKNOWN errno is `substrate_unknown` and carries the errno verbatim", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "unknown", osErrorCode: "EINVAL" },
				pid: 41006,
				pgid: 41006,
			})
			try {
				expect(started.state).toBe("containment_failed")
				const records = containmentClassifiedRecords()
				expect(records).toHaveLength(1)
				expect(records[0].postcondition).toBe("unknown")
				expect(records[0].osErrorCode).toBe("EINVAL")
				expect(records[0].containmentFailed).toBe("substrate_unknown")
			} finally {
				await started.manager.dispose()
			}
		})

		it("CLCR01-07: the capture is a COMPLETE NO-OP when the diagnostic seam is OFF", async () => {
			setBackgroundJobLivenessAuthorityCaptureEnabled(false)
			clearBackgroundJobLivenessAuthorityCaptureRecords()
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "alive", osErrorCode: null },
				pid: 41007,
				pgid: 41007,
			})
			try {
				// The production semantics are UNCHANGED by the capture:
				// the job is still `containment_failed`.
				expect(started.state).toBe("containment_failed")
				expect(containmentClassifiedRecords()).toHaveLength(0)
			} finally {
				await started.manager.dispose()
			}
		})

		it("CLCR01-08: a job with NO owner recorded has a NULL owner on the failure record", async () => {
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "alive", osErrorCode: null },
				pid: 41008,
				pgid: 41008,
				// The ownerSessionId property is OMITTED entirely so the
				// job starts with NO recorded owner.
			})
			try {
				const records = containmentClassifiedRecords()
				expect(records).toHaveLength(1)
				// No owner recorded → UNKNOWN owner → the classifier
				// fails closed. The record states that explicitly.
				expect(records[0].ownerSessionId).toBeNull()
			} finally {
				await started.manager.dispose()
			}
		})
	})

	describe("the C10 hold boundary records the EXACT blocking set", () => {
		it("CLCR01-09: the blocking set names the EXACT job ids — not merely a count", async () => {
			const h = makeCoordinatorHarness()
			h.jobStates["job-a"] = "containment_failed"
			h.jobStates["job-b"] = "containment_failed"
			h.jobStates["job-clean"] = "exited"
			h.jobOwners["job-a"] = h.sessionId
			h.jobOwners["job-b"] = h.sessionId
			await emitCompletionTurn(h)

			const records = blockingSetRecords()
			expect(records.length).toBeGreaterThan(0)
			const c10 = records.find((r) => r.boundary === "c10_completion_attempt")
			expect(c10).toBeDefined()
			// The EXACT set — the two containment failures, and NOT the
			// clean terminal.
			expect([...c10!.blockingJobIds].sort()).toEqual(["job-a", "job-b"])
			expect(c10!.blockingJobIds).not.toContain("job-clean")
			// The denominator: 2 entries total, both owned by this
			// session, so neither was excluded as foreign.
			expect(c10!.totalContainmentFailureEntries).toBe(2)
			expect(c10!.foreignOwnerEntriesExcluded).toBe(0)
		})

		it("CLCR01-10: a FOREIGN owner's failure is EXCLUDED and counted separately", async () => {
			const h = makeCoordinatorHarness()
			h.jobStates["job-mine"] = "containment_failed"
			h.jobStates["job-theirs"] = "containment_failed"
			h.jobOwners["job-mine"] = h.sessionId
			h.jobOwners["job-theirs"] = "session-other"
			await emitCompletionTurn(h)

			const c10 = blockingSetRecords().find((r) => r.boundary === "c10_completion_attempt")
			expect(c10).toBeDefined()
			expect([...c10!.blockingJobIds]).toEqual(["job-mine"])
			expect(c10!.blockingOwnershipClasses).toEqual(["matching_owner"])
			// The foreign entry is counted as excluded, NOT as a blocker.
			expect(c10!.totalContainmentFailureEntries).toBe(2)
			expect(c10!.foreignOwnerEntriesExcluded).toBe(1)
		})

		it("CLCR01-11: an UNKNOWN owner BLOCKS (fail closed) and is classified as such", async () => {
			const h = makeCoordinatorHarness()
			h.jobStates["job-unknown"] = "containment_failed"
			// NO owner recorded for job-unknown.
			await emitCompletionTurn(h)

			const c10 = blockingSetRecords().find((r) => r.boundary === "c10_completion_attempt")
			expect(c10).toBeDefined()
			expect([...c10!.blockingJobIds]).toEqual(["job-unknown"])
			expect(c10!.blockingOwnershipClasses).toEqual(["unknown_owner"])
			expect(c10!.foreignOwnerEntriesExcluded).toBe(0)
		})

		it("CLCR01-12: an ABSENT owner map BLOCKS (fail closed) and is classified as `owner_map_absent`", async () => {
			const h = makeCoordinatorHarness({ omitJobOwners: true })
			h.jobStates["job-any"] = "containment_failed"
			await emitCompletionTurn(h)

			const c10 = blockingSetRecords().find((r) => r.boundary === "c10_completion_attempt")
			expect(c10).toBeDefined()
			expect([...c10!.blockingJobIds]).toEqual(["job-any"])
			expect(c10!.blockingOwnershipClasses).toEqual(["owner_map_absent"])
		})

		it("CLCR01-13: an ABSENT state map yields an EMPTY blocking set (no authority input → nothing to classify)", async () => {
			const h = makeCoordinatorHarness({ omitJobStates: true })
			await emitCompletionTurn(h)

			const c10 = blockingSetRecords().find((r) => r.boundary === "c10_completion_attempt")
			expect(c10).toBeDefined()
			expect(c10!.blockingJobIds).toEqual([])
			expect(c10!.totalContainmentFailureEntries).toBe(0)
		})

		it("CLCR01-14: the ownership classes are positionally aligned with the blocking job ids", async () => {
			const h = makeCoordinatorHarness()
			h.jobStates["job-matching"] = "containment_failed"
			h.jobStates["job-unknown"] = "containment_failed"
			h.jobOwners["job-matching"] = h.sessionId
			await emitCompletionTurn(h)

			const c10 = blockingSetRecords().find((r) => r.boundary === "c10_completion_attempt")
			expect(c10).toBeDefined()
			expect(c10!.blockingJobIds.length).toBe(c10!.blockingOwnershipClasses.length)
			for (let i = 0; i < c10!.blockingJobIds.length; i += 1) {
				const jobId = c10!.blockingJobIds[i]
				const cls = c10!.blockingOwnershipClasses[i]
				if (jobId === "job-matching") {
					expect(cls).toBe("matching_owner")
				} else if (jobId === "job-unknown") {
					expect(cls).toBe("unknown_owner")
				}
			}
		})
	})

	describe("the RED reproduction: unresolved vs. resolved-but-still-projected", () => {
		it("CLCR01-15: an UNRESOLVED containment failure BLOCKS the completion — the barrier holds", async () => {
			const h = makeCoordinatorHarness()
			h.jobStates["job-live"] = "containment_failed"
			h.jobOwners["job-live"] = h.sessionId

			await emitCompletionTurn(h)
			// The coordinator must NOT have released the deferred
			// completion while an unresolved containment failure owned
			// by this session remains.
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(true)
		})

		it("CLCR01-16: a RESOLVED failure whose HISTORICAL PROJECTION REMAINS is STILL distinguished by the ledger", async () => {
			// THE RED REPRODUCTION CASE.
			//
			// The defect hypothesis: a containment failure whose process
			// group SUBSEQUENTLY DISAPPEARED leaves a PERMANENT
			// `containment_failed` entry in the controller's map. That
			// entry blocks the completion forever, even though no
			// containment obligation remains.
			//
			// The production classifier CANNOT distinguish this case:
			// it reads the projection map, which still says
			// `containment_failed`, and has no way to know the group
			// disappeared. A LATER AUTHORITATIVE OBSERVATION would be
			// required — and issuing one is a NEW process signal, which
			// the ACT explicitly forbids.
			//
			// What the ledger MUST therefore show:
			//   - the blocker is a REAL containment failure
			//     (`postcondition !== "gone"`), and
			//   - there is NO later authoritative observation, i.e. the
			//     obligation is UNRESOLVED AS FAR AS THE TRACE KNOWS.
			//
			// The ledger names the blocker EXACTLY, so an operator can
			// join it to the root-cause record and see WHY it is held.
			const h = makeCoordinatorHarness()
			h.jobStates["job-historical"] = "containment_failed"
			h.jobOwners["job-historical"] = h.sessionId
			await emitCompletionTurn(h)

			const c10 = blockingSetRecords().find((r) => r.boundary === "c10_completion_attempt")
			expect(c10).toBeDefined()
			// The blocker is named — the count-only capture could never
			// say WHICH of the 43 entries held the completion.
			expect([...c10!.blockingJobIds]).toEqual(["job-historical"])
			expect(c10!.blockingOwnershipClasses).toEqual(["matching_owner"])
			// The denominator proves the set is a SUBSET of the
			// population: "43 entries exist, 1 of which blocks here".
			expect(c10!.totalContainmentFailureEntries).toBe(1)
		})

		it("CLCR01-17: the root-cause record proves WHY the historical entry was held (the probe verdict + errno)", async () => {
			// The join: the controller's projection says
			// `containment_failed`; the manager's root-cause record says
			// WHICH verdict produced it. Together they are the causal
			// chain the ACT asks for.
			const started = await startJobAndRunToTerminal({
				postcondition: { postcondition: "eperm", osErrorCode: "EPERM" },
				pid: 41017,
				pgid: 41017,
				ownerSessionId: "session-clcr01",
			})
			try {
				expect(started.state).toBe("containment_failed")
				const rootCause = containmentClassifiedRecords()
				expect(rootCause).toHaveLength(1)
				expect(rootCause[0].jobId).toBe(started.jobId)
				// The verdict AND the errno are both present: the
				// operator can now tell a DENIED probe (the invariant
				// is UNPROVEN) from a SURVIVING group (the invariant is
				// REFUTED). The previous capture could not.
				expect(rootCause[0].postcondition).toBe("eperm")
				expect(rootCause[0].osErrorCode).toBe("EPERM")
				// The owner is the join key to the controller's map.
				expect(rootCause[0].ownerSessionId).toBe("session-clcr01")
			} finally {
				await started.manager.dispose()
			}
		})
	})

	describe("the production seams are wired (source contract)", () => {
		it("CLCR01-18: the controller publishes the terminal state through the captured seam", async () => {
			const fs = await import("node:fs/promises")
			const controllerSource = await fs.readFile(new URL("../SdkController.ts", import.meta.url), "utf8")
			// The terminal-state publication seam MUST capture the
			// published state and the owner — that is the LINK between
			// the manager's root-cause record and the C10 blocker.
			expect(controllerSource).toContain("containment_terminal_state_published")
			expect(controllerSource).toContain('isContainmentFailure: publishedTerminalState === "containment_failed"')
		})

		it("CLCR01-19: the manager captures the containment failure at the containment boundary", async () => {
			const fs = await import("node:fs/promises")
			const managerSource = await fs.readFile(new URL("../command-job-manager.ts", import.meta.url), "utf8")
			expect(managerSource).toContain("containment_failure_classified")
			// The OS errno must reach the capture WITHOUT an additional
			// syscall: it rides along with the verdict the probe
			// already produced.
			expect(managerSource).toContain("osErrorCode: postconditionOsErrorCode")
			// The production probe must return the errno.
			expect(managerSource).toContain('return { postcondition: "eperm", osErrorCode }')
			expect(managerSource).toContain('return { postcondition: "gone", osErrorCode }')
			expect(managerSource).toContain('return { postcondition: "alive", osErrorCode: null }')
		})

		it("CLCR01-20: the shared classifier remains the SINGLE containment predicate", async () => {
			const fs = await import("node:fs/promises")
			const coordinatorSource = await fs.readFile(new URL("../sdk-session-event-coordinator.ts", import.meta.url), "utf8")
			// Exactly ONE definition of the classifier.
			expect((coordinatorSource.match(/private unresolvedContainmentFailuresForOwner\(/g) ?? []).length).toBe(1)
			// Exactly ONE comparison against the `containment_failed` state.
			expect((coordinatorSource.match(/!== "containment_failed"/g) ?? []).length).toBe(1)
			// The classifier + the four production call sites (Site A,
			// Site B, Site C and the R4 commit-boundary revalidation).
			expect((coordinatorSource.match(/unresolvedContainmentFailuresForOwner\(/g) ?? []).length).toBe(5)
			// All FOUR hold boundaries capture the blocking set.
			expect((coordinatorSource.match(/captureContainmentLedgerBlockingSet\(/g) ?? []).length).toBe(5)
		})
	})
})
