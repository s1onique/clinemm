/**
 * ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01 — CFC10A01
 *
 * Causal reproduction: does a background job whose process containment
 * FAILED permit a C10 completion merely because its terminal observation
 * was consumed / its manager entry disappeared?
 *
 * Three INDEPENDENTLY observable conditions are separated:
 *
 *   1. Manager retention  — is the job still in an active/terminal registry?
 *   2. Observation consumption — did the owning agent receive the terminal
 *      fact, and was the BCB observation obligation drained?
 *   3. Containment safety — was the original process group PROVEN gone
 *      (postcondition === "gone"), or does it remain alive / eperm /
 *      unknown / pgid_unset?
 *
 * THE STRUCTURAL ASYMMETRY UNDER TEST (source-bound):
 *
 *   - The Q5 deferred-handoff path
 *     (`SdkSessionEventCoordinator.reevaluateDeferredContinuation`)
 *     EXPLICITLY consults the per-job containment classification
 *     (`getBackgroundCommandJobStates` / `getBackgroundCommandJobOwners`)
 *     and FAILS CLOSED on an unresolved containment failure (PHCF01).
 *     Its own docstring says: "the `>0 -> 0` cardinal transition proves
 *     only that the ACTIVE MAP is empty -- it does NOT prove that the
 *     process group was reaped."
 *
 *   - The C10 completion-commit barrier (`handleSessionEvent` barrier
 *     block, and `reevaluateDeferredCompletionBarrier`) consults FOUR
 *     conjuncts: outstandingAutonomousWork, ownerStillRunningForC10,
 *     heldObligationForC10, suppressOriginatingCompletion. NONE of them
 *     consults the containment classification. `ownerStillRunningForC10`
 *     is an ACTIVE-MAP CARDINALITY question — the manager removes a job
 *     from the active map on BOTH the clean path AND the
 *     containment-failure path (command-job-manager.ts `active.delete`).
 *
 *   - The Elm completion-authority kernel has NO containment fact at
 *     all: `apps/vscode/elm/completion-authority/src/Authority.elm`
 *     models jobs only as `JobRunning | JobTerminal ObservationPending
 *     | JobTerminal ObservationConsumed`. A containment-failed terminal
 *     is INDISTINGUISHABLE from a clean terminal once observed.
 *
 * So the hypothesis under test is: C10 authorization depends on the
 * DISAPPEARANCE of the observation (heldObligationForC10 -> 0), NOT on
 * proven containment.
 *
 * EVIDENCE CLASSIFICATION: every case below is SYNTHETIC_REAL — the
 * production manager / BCB / coordinator / status-tool seams are the
 * REAL ones; only the terminal-postcondition probe and the supervisor
 * are injected (the manager's own documented `terminalPostconditionProbe`
 * test seam). NO live process-group claim is made from this suite. The
 * known EPERM-constrained sandbox is used for controlled structural
 * reproduction only.
 *
 * The suite CHARACTERIZES the actual behaviour. Each case states the
 * EXPECTED observation-vs-containment relationship as an explicit
 * assertion, so a behaviour change is caught as a deliberate,
 * reviewable diff rather than silently absorbed.
 */

import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { createCommandStatusTool } from "../command-status-tool"
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
})
afterEach(() => {
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

// ---------------------------------------------------------------------------
// Supervisor double: a job whose process group the kernel CANNOT prove gone.
// ---------------------------------------------------------------------------

/**
 * A supervisor whose `terminateTree` resolves the exit promise (so the
 * manager's `finalize()` runs) while the injected
 * `terminalPostconditionProbe` reports a NON-`gone` verdict.
 *
 * The supervisor is a DOUBLE; the manager, the postcondition probe
 * injection point, the BCB, the status tool and the coordinator are all
 * the REAL production seams.
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

// ---------------------------------------------------------------------------
// Harness: the REAL manager / BCB / status-tool / coordinator seams.
// ---------------------------------------------------------------------------

interface Harness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly tracker: TurnStateTracker
	readonly translatorState: MessageTranslatorState
	readonly minter: MessageIdMinter
	readonly notifyCoordinator: BackgroundNotifyCoordinator
	readonly manager: CommandJobManager
	readonly sessionId: string
	readonly taskId: string
	readonly completionCommitCount: () => number
	/**
	 * The per-job terminal projection map, mirroring the production
	 * `SdkController.backgroundCommandJobStates` (PHCF01's authority
	 * input). The production controller maintains it from the runner's
	 * per-job terminal publication.
	 */
	readonly jobStates: Record<string, string>
	/**
	 * The per-job OWNER map, mirroring the production
	 * `SdkController.backgroundCommandJobOwners` (PHCF17's discriminator).
	 */
	readonly jobOwners: Record<string, string | undefined>
	/** Publish the per-job terminal projection exactly as the runner does. */
	readonly publishTerminalState: (jobId: string, state: string, ownerSessionId?: string) => void
}

interface HarnessOpts {
	readonly sessionId?: string
	readonly taskId?: string
	/**
	 * The Elm completion-authority decision the coordinator consults at
	 * the C10 boundary. `authorize` models "the Elm kernel has no
	 * unresolved obligation" — i.e. the C10 gate is reached and the
	 * TS barrier is the ONLY thing that can hold it.
	 */
	readonly elmDecision?: "authorize" | "hold" | "failure"
}

function makeHarness(opts: HarnessOpts = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sessionId = opts.sessionId ?? "session-cfc10a01"
	const taskId = opts.taskId ?? "task-cfc10a01"

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId, taskId }),
		enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
		now: () => Date.now(),
		// Inject the LEGACY consume policy so the coordinator's effect
		// interpreter is exercised without loading the Elm kernel. The
		// C10 boundary's Elm decision is injected separately below (the
		// ACT's "existing Elm authority boundary").
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const jobStates: Record<string, string> = {}
	const jobOwners: Record<string, string | undefined> = {}
	let completionCommitCount = 0
	const elmDecision: "authorize" | "hold" | "failure" = opts.elmDecision ?? "authorize"

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
		messages: { appendAndEmit: vi.fn() },
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		// NO running background job: the manager's active map is EMPTY
		// at the C10 boundary (the manager removes a job from the
		// active map on BOTH the clean path and the
		// containment-failure path).
		hasRunningBackgroundJobForOwner: () => false,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
		wasWakeDelivered: (jobId: string) => notifyCoordinator.wasWakeDelivered(jobId),
		// The BCB observation count / list — the REAL BCB.
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) =>
			sid === sessionId ? notifyCoordinator.unconsumedTerminalCountForOwner(sessionId, taskId) : 0,
		getUnconsumedOwnedTerminalJobIds: (sid: string, tid: string | undefined) =>
			sid === sessionId ? notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(sid, tid) : [],
		// PHCF01's authority inputs, wired exactly as
		// `SdkController` wires them (SdkController.ts:2664 / 2683).
		getBackgroundCommandJobStates: () => jobStates,
		getBackgroundCommandJobOwners: () => jobOwners,
		// The Elm completion-authority boundary.
		getElmCompletionAuthorityDecision: () =>
			elmDecision === "authorize"
				? ({ kind: "authorize" } as const)
				: elmDecision === "hold"
					? ({ kind: "hold", reason: "cfc10a01-injected-hold" } as const)
					: ({ kind: "failure", classification: "elm_authority_unavailable" } as const),
	} as unknown as SdkSessionEventCoordinatorOptions)

	const manager = new CommandJobManager()

	return {
		coordinator,
		tracker,
		translatorState,
		minter,
		notifyCoordinator,
		manager,
		sessionId,
		taskId,
		completionCommitCount: () => completionCommitCount,
		jobStates,
		jobOwners,
		publishTerminalState: (jobId: string, state: string, ownerSessionId?: string) => {
			jobStates[jobId] = state
			if (ownerSessionId !== undefined) {
				jobOwners[jobId] = ownerSessionId
			}
		},
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

async function emitCompletionTurn(h: Harness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	await h.coordinator.handleSessionEvent(
		agentEvent(h.sessionId, { type: "done", reason: "completed", text: "Task completed.", iterations: 1 }),
	)
}

/**
 * Start a job through the REAL manager with a controlled terminal
 * postcondition, run it to terminal, and publish the per-job terminal
 * projection exactly as the production runner does.
 *
 * `postcondition` selects the injected probe verdict:
 *   - "gone"    → clean terminal (`exited`)
 *   - anything else → containment failure (`containment_failed`)
 *
 * A fresh manager is created per case so the terminal registry holds
 * only this job (the status tool consults the SAME manager instance).
 */
async function startJobAndRunToTerminal(
	h: Harness,
	opts: { postcondition: "gone" | "alive" | "eperm" | "unknown"; pid: number },
): Promise<{ jobId: string; state: string; manager: CommandJobManager }> {
	const manager = new CommandJobManager({
		spawnFactory: () => makeSupervisorDouble(opts.pid, opts.pid),
		terminalPostconditionProbe: () => opts.postcondition,
	})
	const started = await manager.start(
		{
			command: "/bin/sh -c 'sleep 60'",
			cwd: process.cwd(),
			waitBudgetMs: 5,
			executionDeadlineMs: 30_000,
		},
		{ sessionId: h.sessionId } as never,
	)
	const jobId = started.jobId
	await manager.cancel({ jobId })
	for (let i = 0; i < 200; i += 1) {
		const status = await manager.status({ jobId, waitMs: 0 })
		if (status.ok && status.snapshot.state !== "running") break
		await new Promise((r) => setTimeout(r, 10))
	}
	const terminal = await manager.status({ jobId, waitMs: 0 })
	const state = terminal.ok ? terminal.snapshot.state : "unknown"
	// The production runner publishes the per-job terminal reason into
	// the controller's projection map (the PHCF01 authority input).
	// Mirror it exactly.
	h.publishTerminalState(jobId, state, h.sessionId)
	return { jobId, state, manager }
}

/**
 * Register the non-notify (fire-and-forget) terminal observation
 * exactly as `vscode-run-commands-tool.ts` does: UNCONDITIONALLY for
 * every terminal state, INCLUDING `containment_failed`.
 */
function registerNonNotifyObservation(h: Harness, jobId: string): void {
	h.notifyCoordinator.recordNonNotifyTerminalObservation({
		jobId,
		sessionId: h.sessionId,
		taskId: h.taskId,
	})
}

// =============================================================================
// RED-01 — Unknown is not clean
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01 / RED-01 unknown is not clean", () => {
	it("CFC10A01-RED-01-A: a non-`gone` postcondition classifies the job `containment_failed`", async () => {
		const h = makeHarness()
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91001 })
		try {
			// 1. TERMINAL CLASSIFICATION: the manager overwrites the
			//    caller's clean terminal state with `containment_failed`
			//    whenever the postcondition is not `gone`.
			expect(started.state).toBe("containment_failed")
			// 3. CONTAINMENT SAFETY: the job is NOT proven gone.
			expect(started.manager.activeCount).toBe(0)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-01-B: `unknown` and `eperm` postconditions are ALSO `containment_failed` (unknown != clean)", async () => {
		const h = makeHarness()
		const unknown = await startJobAndRunToTerminal(h, { postcondition: "unknown", pid: 91002 })
		try {
			expect(unknown.state).toBe("containment_failed")
		} finally {
			await unknown.manager.dispose()
		}
		const eperm = await startJobAndRunToTerminal(h, { postcondition: "eperm", pid: 91003 })
		try {
			expect(eperm.state).toBe("containment_failed")
		} finally {
			await eperm.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-01-C: MANAGER ACTIVE-MAP REMOVAL does not prove containment — the active map is empty for BOTH the clean and the containment-failure path", async () => {
		const h = makeHarness()
		const failed = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91004 })
		try {
			expect(failed.state).toBe("containment_failed")
			// The manager's active map is EMPTY — the cardinal fact the
			// C10 barrier's `ownerStillRunningForC10` consults. It is
			// IDENTICAL for the clean path and the failure path, so it
			// CANNOT be evidence of process safety.
			expect(failed.manager.activeCount).toBe(0)
		} finally {
			await failed.manager.dispose()
		}
		const clean = await startJobAndRunToTerminal(h, { postcondition: "gone", pid: 91005 })
		try {
			// The CLEAN terminal class: the caller's own terminal reason
			// (`cancelled`) is PRESERVED because the postcondition was
			// `gone`. This is the exact contrast with RED-01-A/B, where
			// the caller's clean reason was OVERWRITTEN with
			// `containment_failed`.
			expect(clean.state).toBe("cancelled")
			expect(clean.manager.activeCount).toBe(0)
			// SAME active-map cardinality, DIFFERENT containment truth.
			// This is the load-bearing asymmetry the RED exposes.
		} finally {
			await clean.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-01-D: a subsequent `unknown_job` result does NOT prove the process group disappeared", async () => {
		const h = makeHarness()
		// The REAL bounded-FIFO eviction path: `maxTerminalJobs: 1` makes
		// the manager evict the FIRST terminal job when the SECOND
		// terminalizes. The evicted jobId is no longer resolvable via
		// `manager.status(...)` — the same `source: "miss"` shape the
		// LIVE liveness ring recorded for the incident job.
		const manager = new CommandJobManager({
			maxTerminalJobs: 1,
			spawnFactory: () => makeSupervisorDouble(91007, 91007),
			terminalPostconditionProbe: () => "alive",
		})
		try {
			const first = await manager.start(
				{ command: "/bin/sh -c 'sleep 60'", cwd: process.cwd(), waitBudgetMs: 5, executionDeadlineMs: 30_000 },
				{ sessionId: h.sessionId } as never,
			)
			await manager.cancel({ jobId: first.jobId })
			for (let i = 0; i < 200; i += 1) {
				const s = await manager.status({ jobId: first.jobId, waitMs: 0 })
				if (s.ok && s.snapshot.state !== "running") break
				await new Promise((r) => setTimeout(r, 10))
			}
			const firstTerminal = await manager.status({ jobId: first.jobId, waitMs: 0 })
			expect(firstTerminal.ok).toBe(true)
			if (firstTerminal.ok) {
				expect(firstTerminal.snapshot.state).toBe("containment_failed")
			}
			h.publishTerminalState(first.jobId, "containment_failed", h.sessionId)

			// A SECOND job terminalizes and evicts the first.
			const second = await manager.start(
				{ command: "/bin/sh -c 'sleep 60'", cwd: process.cwd(), waitBudgetMs: 5, executionDeadlineMs: 30_000 },
				{ sessionId: h.sessionId } as never,
			)
			await manager.cancel({ jobId: second.jobId })
			for (let i = 0; i < 200; i += 1) {
				const s = await manager.status({ jobId: second.jobId, waitMs: 0 })
				if (s.ok && s.snapshot.state !== "running") break
				await new Promise((r) => setTimeout(r, 10))
			}

			// The evicted jobId now MISSES.
			const missed = await manager.status({ jobId: first.jobId, waitMs: 0 })
			expect(missed.ok).toBe(false)
			if (!missed.ok) {
				expect(missed.code).toBe("unknown_job")
			}
			// The terminal classification is STILL `containment_failed`
			// in the host-owned projection. The manager miss did not
			// and cannot revoke it.
			expect(h.jobStates[first.jobId]).toBe("containment_failed")
		} finally {
			await manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})
})

// =============================================================================
// RED-02 — Observation versus containment
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01 / RED-02 observation versus containment", () => {
	it("CFC10A01-RED-02-A: PRESENT compact receipt — the receipt path drains the observation and the retained classification stays `containment_failed`", async () => {
		const h = makeHarness()
		// A manager with NO entry for this jobId — the manager MISS.
		const emptyManager = new CommandJobManager()
		try {
			registerNonNotifyObservation(h, "cmd_receipt_case")
			// BEFORE the observation: the BCB obligation is held.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(1)

			// Record a compact terminal receipt carrying the terminal
			// classification (the production `recordTerminalReceipt`
			// seam, called from the lifecycle sink).
			h.notifyCoordinator.recordTerminalReceipt({
				jobId: "cmd_receipt_case",
				sessionId: h.sessionId,
				taskId: h.taskId,
				terminalState: "containment_failed",
				exitCode: undefined,
				reason: undefined,
				isContainmentFailed: true,
			})
			h.publishTerminalState("cmd_receipt_case", "containment_failed", h.sessionId)

			const statusTool = createCommandStatusTool(emptyManager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner: () => ({ sessionId: h.sessionId, taskId: h.taskId }),
			})
			const result = (await statusTool.execute(
				{ jobId: "cmd_receipt_case", waitMs: 0 },
				{ sessionId: h.sessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string; observation?: string }>

			// MANAGER LOOKUP: the manager has no entry → the tool took
			// the RECEIPT path.
			expect(result[0]?.ok).toBe(true)
			expect(result[0]?.observation).toBe("evicted_receipt")
			// The RECEIPT carries the TRUE terminal classification.
			expect(result[0]?.state).toBe("containment_failed")

			// 2. OBSERVATION CONSUMPTION: the BCB obligation is drained.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)
			// 3. CONTAINMENT SAFETY: UNCHANGED. The drain did not change
			//    the containment truth at all.
			expect(h.jobStates.cmd_receipt_case).toBe("containment_failed")
		} finally {
			await emptyManager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-02-B: ABSENT receipt — a manager miss with NO matching receipt is NOT a successfully observed terminal fact", async () => {
		const h = makeHarness()
		const emptyManager = new CommandJobManager()
		try {
			registerNonNotifyObservation(h, "cmd_no_receipt_case")
			h.publishTerminalState("cmd_no_receipt_case", "containment_failed", h.sessionId)
			// NO receipt recorded.

			const statusTool = createCommandStatusTool(emptyManager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner: () => ({ sessionId: h.sessionId, taskId: h.taskId }),
			})
			const result = (await statusTool.execute(
				{ jobId: "cmd_no_receipt_case", waitMs: 0 },
				{ sessionId: h.sessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; error?: string; state?: string }>

			// The truthful response is the `unknown_job` error — NOT a
			// terminal fact.
			expect(result[0]?.ok).toBe(false)
			expect(result[0]?.error).toContain("unknown_job")
			// The observation obligation is NOT drained: the agent never
			// received the terminal fact.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(1)
			// Containment truth unchanged.
			expect(h.jobStates.cmd_no_receipt_case).toBe("containment_failed")
		} finally {
			await emptyManager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-02-C: Path C' drains the observation for a `containment_failed` job (the PCCA01 contract) while the containment truth is untouched", async () => {
		const h = makeHarness()
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91012 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(1)

			const statusTool = createCommandStatusTool(started.manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner: () => ({ sessionId: h.sessionId, taskId: h.taskId }),
			})
			const result = (await statusTool.execute(
				{ jobId: started.jobId, waitMs: 0 },
				{ sessionId: h.sessionId, agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; state?: string }>

			expect(result[0]?.ok).toBe(true)
			expect(result[0]?.state).toBe("containment_failed")
			// OBSERVATION CONSUMPTION: drained.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)
			// CONTAINMENT SAFETY: unchanged.
			expect(h.jobStates[started.jobId]).toBe("containment_failed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})
})

// =============================================================================
// RED-03 — C10 authority discriminator
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01 / RED-03 C10 authority discriminator", () => {
	it("CFC10A01-RED-03-A: the C10 barrier holds while the observation is UNCONSUMED, even with a containment failure present", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91020 })
		try {
			registerNonNotifyObservation(h, started.jobId)

			await emitCompletionTurn(h)
			// The BCB's second conjunct (`heldObligationForC10`) holds
			// the C10 commit.
			expect(h.completionCommitCount()).toBe(0)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-03-B (RED WITNESS): after the observation is CONSUMED, the C10 commit MUST STAY BLOCKED while the containment failure is STILL UNRESOLVED", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91021 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			expect(h.jobStates[started.jobId]).toBe("containment_failed")

			const statusTool = createCommandStatusTool(started.manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner: () => ({ sessionId: h.sessionId, taskId: h.taskId }),
			})
			await statusTool.execute(
				{ jobId: started.jobId, waitMs: 0 },
				{ sessionId: h.sessionId, agentId: "test-agent", iteration: 1 },
			)
			// OBSERVATION CONSUMPTION: drained.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)
			// CONTAINMENT SAFETY: STILL UNRESOLVED. The process group was
			// NEVER proven gone.
			expect(h.jobStates[started.jobId]).toBe("containment_failed")

			await emitCompletionTurn(h)
			// ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01
			// (CFC10AR01): the REPAIRED expectation. The C10 commit
			// MUST NOT proceed: the observation was consumed, but the
			// owner's containment failure is UNRESOLVED, so the
			// process group is still not proven reaped.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-03-B-DEFERRED (RED WITNESS): the DEFERRED C10 re-evaluation MUST NOT release the held completion while the owner's containment failure is UNRESOLVED", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91024 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			expect(h.jobStates[started.jobId]).toBe("containment_failed")

			// STEP 1: REGISTER the actual deferred completion barrier.
			// The BCB's second conjunct (the held observation) holds the
			// C10 commit, so the REAL production barrier registration in
			// `handleSessionEvent` runs and the marker is created.
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(true)

			// STEP 2: HOLD the barrier while the terminal observation is
			// outstanding, then consume the observation. The manager's
			// active map is already empty and the BCB count drains to 0.
			const statusTool = createCommandStatusTool(started.manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner: () => ({ sessionId: h.sessionId, taskId: h.taskId }),
			})
			await statusTool.execute(
				{ jobId: started.jobId, waitMs: 0 },
				{ sessionId: h.sessionId, agentId: "test-agent", iteration: 1 },
			)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)

			// STEP 3: the owner's `containment_failed` classification is
			// UNCHANGED by the observation consumption.
			expect(h.jobStates[started.jobId]).toBe("containment_failed")

			// STEP 4: exercise the ACTUAL deferred completion barrier
			// re-evaluation method.
			await h.coordinator.reevaluateDeferredCompletionBarrier()

			// ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01
			// (CFC10AR01): the REPAIRED expectation. A drained
			// terminal observation MUST NOT release a completion while
			// the corresponding unresolved containment classification
			// remains.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-03-C (CLEAN CONTROL): with postcondition `gone`, the same chronology also commits — the C10 outcome does NOT distinguish containment from non-containment", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "gone", pid: 91022 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			// The clean terminal class is PRESERVED (the caller cancelled
			// the job; the `gone` postcondition keeps `cancelled`).
			expect(h.jobStates[started.jobId]).toBe("cancelled")

			const statusTool = createCommandStatusTool(started.manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner: () => ({ sessionId: h.sessionId, taskId: h.taskId }),
			})
			await statusTool.execute(
				{ jobId: started.jobId, waitMs: 0 },
				{ sessionId: h.sessionId, agentId: "test-agent", iteration: 1 },
			)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)

			await emitCompletionTurn(h)
			// IDENTICAL outcome to RED-03-B. The C10 result is
			// INDISTINGUISHABLE between a proven-clean terminal and an
			// unresolved containment failure.
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-03-D (ELM CONTROL): an Elm HOLD suppresses the C10 commit even with the observation consumed and containment unresolved", async () => {
		const h = makeHarness({ elmDecision: "hold" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91023 })
		try {
			registerNonNotifyObservation(h, started.jobId)

			const statusTool = createCommandStatusTool(started.manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				resolveActiveOwner: () => ({ sessionId: h.sessionId, taskId: h.taskId }),
			})
			await statusTool.execute(
				{ jobId: started.jobId, waitMs: 0 },
				{ sessionId: h.sessionId, agentId: "test-agent", iteration: 1 },
			)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)

			await emitCompletionTurn(h)
			// The Elm authority remains the FINAL gate — the RED is NOT
			// "Elm ignores containment"; it is "the TS BCB barrier has no
			// containment conjunct, so an AUTHORIZED Elm decision is
			// sufficient to commit over an unresolved containment
			// failure".
			expect(h.completionCommitCount()).toBe(0)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-03-E: the Q5 deferred-handoff path DOES fail closed on the SAME unresolved containment failure, and (after the repair) so do BOTH C10 paths", async () => {
		const fs = await import("node:fs/promises")
		const coordinatorSource = await fs.readFile(new URL("../sdk-session-event-coordinator.ts", import.meta.url), "utf8")
		// ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01
		// (CFC10AR01): the C10 barrier block NOW consults the
		// containment authority input — through the SHARED
		// `unresolvedContainmentFailuresForOwner` classifier. The
		// predecessor asserted the ABSENCE of that consult; the
		// repaired contract requires its PRESENCE.
		const barrierIdx = coordinatorSource.indexOf("const heldObligationForC10 =")
		expect(barrierIdx).toBeGreaterThan(-1)
		const barrierBlock = coordinatorSource.slice(barrierIdx, barrierIdx + 2400)
		expect(barrierBlock).toContain("unresolvedContainmentFailuresForOwner")
		expect(barrierBlock).toContain("unresolvedContainmentFailuresForC10.length > 0")
		// The Q5 path DOES consult it, and FAILS CLOSED.
		expect(coordinatorSource).toContain("getBackgroundCommandJobStates")
		expect(coordinatorSource).toContain("unresolved containment failure (jobs=")
		// The BCB re-evaluation path (the deferred C10 release) ALSO
		// consults the containment authority input now. The source
		// slice runs from the method declaration to the NEXT method
		// declaration, so the assertion is anchored on the method
		// boundary rather than on an arbitrary character width.
		const reevalIdx = coordinatorSource.indexOf("async reevaluateDeferredCompletionBarrier()")
		expect(reevalIdx).toBeGreaterThan(-1)
		const nextMethodIdx = coordinatorSource.indexOf("\n\t/**", reevalIdx)
		const reevalBlock = coordinatorSource.slice(reevalIdx, nextMethodIdx > reevalIdx ? nextMethodIdx : undefined)
		expect(reevalBlock).toContain("unresolvedContainmentFailuresForOwner")
		// The predicate is NOT duplicated: there is exactly ONE shared
		// classifier definition, and it is the only place that compares
		// a job state against `containment_failed`.
		const classifierDefinitions = coordinatorSource.match(/private unresolvedContainmentFailuresForOwner\(/g) ?? []
		expect(classifierDefinitions.length).toBe(1)
		const containmentFailedComparisons = coordinatorSource.match(/!== "containment_failed"/g) ?? []
		expect(containmentFailedComparisons.length).toBe(1)
	})
})

// =============================================================================
// RED-04 — Foreign owner and stale epoch
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01 / RED-04 foreign owner and stale epoch", () => {
	it("CFC10A01-RED-04-A: a FOREIGN owner's containment failure does not block this task's completion", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			// A job owned by a DIFFERENT session leaves a permanent
			// `containment_failed` entry in the CONTROLLER-LEVEL map.
			h.publishTerminalState("cmd_foreign", "containment_failed", "some-other-session")

			await emitCompletionTurn(h)
			// The foreign failure does not hold this task's C10.
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-04-B: a FOREIGN owner's receipt cannot drain this owner's obligation and does not release this task's completion", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91030 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(1)

			const statusTool = createCommandStatusTool(started.manager, {
				backgroundNotifyCoordinator: h.notifyCoordinator,
				// A FOREIGN owner tries to observe the job.
				resolveActiveOwner: () => ({ sessionId: "some-other-session", taskId: "some-other-task" }),
			})
			const result = (await statusTool.execute(
				{ jobId: started.jobId, waitMs: 0 },
				{ sessionId: "some-other-session", agentId: "test-agent", iteration: 1 },
			)) as Array<{ ok: boolean; error?: string; state?: string }>

			// The READ is not owner-scoped: the manager's terminal map
			// is a process-level registry, so the foreign caller can
			// read the terminal fact. What IS owner-scoped is the BCB
			// DRAIN: `consumeNonNotifyTerminalObservation` validates the
			// (sessionId, taskId) triple and REFUSES to delete an
			// observation it does not own.
			expect(result[0]?.ok).toBe(true)
			// The foreign read did NOT drain the owner's obligation.
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(1)
			// And the current task's completion stays HELD.
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10A01-RED-04-C: a stale epoch does not inherit the earlier epoch's obligation as cleanup evidence", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91031 })
		try {
			registerNonNotifyObservation(h, started.jobId)

			// The epoch advances — a marker registered under the OLD epoch
			// is superseded.
			h.minter.bumpEpoch()

			await emitCompletionTurn(h)
			// The held observation still holds (it is not epoch-scoped),
			// but the point of this case is that the EPOCH never grants
			// a completion by itself and never inherits a stale receipt
			// as cleanup evidence.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.jobStates[started.jobId]).toBe("containment_failed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})
})

// =============================================================================
// RED-05 — The receipt channel itself is `gone`-gated
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01 / RED-05 receipt channel gating", () => {
	it("CFC10A01-RED-05-A: a containment-failed job NEVER produces a compact terminal receipt (the receipt channel is `command_job_terminal_committed`-gated, and that event only fires on postcondition `gone`)", async () => {
		const h = makeHarness()
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 91040 })
		try {
			// The REAL production receipt channel: the manager's
			// `command_job_terminal_committed` lifecycle event, routed
			// through `recordTerminalReceiptFromLifecycle` — exactly the
			// free function `SdkController.handleCommandJobLifecycle`
			// calls (SdkController.ts:5754).
			const { recordTerminalReceiptFromLifecycle } = await import("../background-notify-coordinator")

			// The FAILURE path emits `command_job_containment_failed`,
			// NOT `command_job_terminal_committed`.
			const failureDisposition = recordTerminalReceiptFromLifecycle(h.notifyCoordinator, {
				event: "command_job_containment_failed",
				jobId: started.jobId,
				ownerSessionId: h.sessionId,
				ownerTaskId: h.taskId,
				jobState: "containment_failed",
				exitCode: null,
				signal: null,
			})
			// The receipt channel IGNORES the failure event.
			expect(failureDisposition.kind).toBe("ignored")
			expect(h.notifyCoordinator.diagnosticTerminalReceiptCount()).toBe(0)

			// Contrast: the CLEAN path's event DOES record a receipt.
			const cleanDisposition = recordTerminalReceiptFromLifecycle(h.notifyCoordinator, {
				event: "command_job_terminal_committed",
				jobId: "cmd_clean_probe",
				ownerSessionId: h.sessionId,
				ownerTaskId: h.taskId,
				jobState: "exited",
				exitCode: 0,
				signal: null,
			})
			// No held obligation exists for the probe jobId, so the
			// receipt channel reports `no_obligation` — but it is NOT
			// `ignored`: the event IS accepted by the receipt channel.
			expect(cleanDisposition.kind).toBe("no_obligation")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})
})

// =============================================================================
// RED-06 — Causal ablation matrix
//
// Each case changes EXACTLY ONE fact and records the C10 outcome. The
// matrix answers: does C10 authorization depend on PROVEN CONTAINMENT, or
// only on the DISAPPEARANCE of the observation?
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPRO01 / RED-06 causal ablation matrix", () => {
	/**
	 * One row of the ablation matrix.
	 *
	 * @param postcondition   the injected terminal-postcondition verdict
	 * @param consume         whether the observation is consumed
	 * @param receiptPresent  whether a compact receipt exists
	 */
	async function runAblationRow(opts: {
		postcondition: "gone" | "alive"
		consume: boolean
		receiptPresent: boolean
	}): Promise<{ committed: number; containmentClass: string | undefined; observationCount: number }> {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: opts.postcondition, pid: 92000 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			if (opts.receiptPresent) {
				h.notifyCoordinator.recordTerminalReceipt({
					jobId: started.jobId,
					sessionId: h.sessionId,
					taskId: h.taskId,
					terminalState: started.state as never,
					exitCode: undefined,
					reason: undefined,
					isContainmentFailed: started.state === "containment_failed",
				})
			}
			if (opts.consume) {
				const statusTool = createCommandStatusTool(started.manager, {
					backgroundNotifyCoordinator: h.notifyCoordinator,
					resolveActiveOwner: () => ({ sessionId: h.sessionId, taskId: h.taskId }),
				})
				await statusTool.execute(
					{ jobId: started.jobId, waitMs: 0 },
					{ sessionId: h.sessionId, agentId: "test-agent", iteration: 1 },
				)
			}
			const observationCount = h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)
			await emitCompletionTurn(h)
			return {
				committed: h.completionCommitCount(),
				containmentClass: h.jobStates[started.jobId],
				observationCount,
			}
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	}

	it("CFC10A01-RED-06-A: ABLATION MATRIX — after the repair, PROVEN CONTAINMENT (not observation consumption alone) moves the C10 outcome", async () => {
		// ROW 1: containment FAILED, observation NOT consumed.
		const row1 = await runAblationRow({ postcondition: "alive", consume: false, receiptPresent: false })
		expect(row1.containmentClass).toBe("containment_failed")
		expect(row1.observationCount).toBe(1)
		expect(row1.committed).toBe(0)

		// ROW 2: containment FAILED, observation CONSUMED.
		const row2 = await runAblationRow({ postcondition: "alive", consume: true, receiptPresent: false })
		expect(row2.containmentClass).toBe("containment_failed")
		expect(row2.observationCount).toBe(0)
		// ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01
		// (CFC10AR01): the CORRECTED expectation. The observation was
		// consumed, but the containment failure is UNRESOLVED, so the
		// C10 commit is STILL blocked. This is the assertion the
		// predecessor's characterization suite encoded as `1`.
		expect(row2.committed).toBe(0)

		// ROW 3: containment PROVEN GONE, observation NOT consumed.
		const row3 = await runAblationRow({ postcondition: "gone", consume: false, receiptPresent: false })
		expect(row3.containmentClass).toBe("cancelled")
		expect(row3.observationCount).toBe(1)
		expect(row3.committed).toBe(0)

		// ROW 4: containment PROVEN GONE, observation CONSUMED.
		const row4 = await runAblationRow({ postcondition: "gone", consume: true, receiptPresent: false })
		expect(row4.containmentClass).toBe("cancelled")
		expect(row4.observationCount).toBe(0)
		expect(row4.committed).toBe(1)

		// THE POST-REPAIR DISCRIMINATOR: rows 1->2 differ ONLY in
		// whether the observation was consumed, and the C10 outcome does
		// NOT flip any more (both held) — because the containment
		// failure still blocks. Rows 3->4 differ ONLY in observation
		// consumption and the C10 outcome DOES flip (held -> committed)
		// — because the containment was PROVEN gone.
		//
		//   C10 authorization now depends on PROVEN CONTAINMENT,
		//   NOT on observation consumption alone.
		expect(row2.committed).toBe(row1.committed)
		expect(row1.committed).toBe(row3.committed)
		expect(row4.committed).not.toBe(row3.committed)
		expect(row2.committed).not.toBe(row4.committed)
	})

	it("CFC10A01-RED-06-B: the receipt's PRESENCE does not move the C10 outcome — only the DRAIN does", async () => {
		// Same containment failure, same non-consumption, receipt present
		// vs absent: the C10 outcome is IDENTICAL (held). The receipt
		// makes the terminal fact OBSERVABLE; it does not make the
		// process SAFE.
		const withReceipt = await runAblationRow({ postcondition: "alive", consume: false, receiptPresent: true })
		const withoutReceipt = await runAblationRow({ postcondition: "alive", consume: false, receiptPresent: false })
		expect(withReceipt.committed).toBe(withoutReceipt.committed)
		expect(withReceipt.committed).toBe(0)
		expect(withReceipt.containmentClass).toBe("containment_failed")
		expect(withoutReceipt.containmentClass).toBe("containment_failed")
	})
})
