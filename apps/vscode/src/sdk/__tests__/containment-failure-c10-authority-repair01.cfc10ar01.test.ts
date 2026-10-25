/**
 * ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01 — CFC10AR01
 *
 * THE CAUSAL CONSERVATION SUITE for the C10 containment repair.
 *
 * THE SUCCESS CRITERION (from the ACT):
 *
 *   `containment_failed + observation_consumed + Elm_AUTHORIZE → C10_completed`
 *
 * must become IMPOSSIBLE through the tested production paths, and the
 * corresponding CLEAN-terminal path must CONTINUE to work.
 *
 * WHAT IS DISTINGUISHED HERE (the load-bearing distinction):
 *
 *   OBSERVATION ACCOUNTING  ≠  PROCESS-CONTAINMENT SAFETY
 *
 *   - The BCB's `heldObligationForC10` is a count of UNCONSUMED terminal
 *     OBSERVATIONS. It drains when the agent OBSERVES the terminal fact.
 *   - The `CommandJobManager`'s `ownerStillRunningForC10` is an
 *     ACTIVE-MAP CARDINALITY question. The manager removes a job from
 *     the active map on BOTH the clean path and the containment-failure
 *     path.
 *
 * Neither proves the process group was REAPED. A job whose terminal
 * postcondition was not `gone` is classified `containment_failed` and
 * carries an UNRESOLVED subprocess-safety obligation.
 *
 * EVIDENCE CLASSIFICATION: **SYNTHETIC_REAL**. The production
 * manager / BCB / coordinator / status-tool seams are the REAL ones;
 * only the supervisor and the manager's documented
 * `terminalPostconditionProbe` test seam are injected. NO live
 * process-group claim is made from this suite.
 *
 * THE REPAIR BEING VERIFIED:
 *
 *   1. ONE shared, pure, owner-scoped classifier
 *      (`unresolvedContainmentFailuresForOwner`) is the SINGLE
 *      computation of the containment fact.
 *   2. It is applied at the IMMEDIATE C10 barrier (Site A), the
 *      DEFERRED C10 re-evaluation (Site B) and the Q5 deferred-handoff
 *      path (Site C).
 *   3. It is REVALIDATED at the actual commit boundary (after the
 *      awaited Elm-authority flush), because that await is a real
 *      time-of-check/time-of-use interval.
 */

import type { CoreSessionEvent, SupervisableShellProcess } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import { CommandJobManager } from "../command-job-manager"
import { createCommandStatusTool } from "../command-status-tool"
import type { ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"
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
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
})

/**
 * A supervisor whose `terminateTree` resolves the exit promise (so the
 * manager's `finalize()` runs) while the injected
 * `terminalPostconditionProbe` reports a NON-`gone` verdict.
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
	readonly phaseWrites: readonly string[]
	/** The authoritative-marker promotion channel (the production `emitHookMessage`). */
	readonly markerPromotions: () => number
	readonly jobStates: Record<string, string>
	readonly jobOwners: Record<string, string | undefined>
	readonly publishTerminalState: (jobId: string, state: string, ownerSessionId?: string) => void
	/** Resolve the injected Elm-authority flush (the R4 TOCTOU interval). */
	readonly releaseElmFlush: () => void
	/** Whether the injected Elm-authority flush is currently held. */
	readonly elmFlushHeld: () => boolean
	/** The number of Elm-authority decision consults. */
	readonly elmDecisionCount: () => number
}

interface HarnessOpts {
	readonly sessionId?: string
	readonly taskId?: string
	readonly elmDecision?: "authorize" | "hold" | "failure"
	/** Hold the asynchronous Elm-authority flush (the R4 interval). */
	readonly holdElmFlush?: boolean
	/** Omit the per-job terminal projection map (the ABSENT authority input). */
	readonly omitJobStates?: boolean
	/** Omit the per-job owner map (the ABSENT owner discriminator). */
	readonly omitJobOwners?: boolean
}

function makeHarness(opts: HarnessOpts = {}): Harness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const sessionId = opts.sessionId ?? "session-cfc10ar01"
	const taskId = opts.taskId ?? "task-cfc10ar01"

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId, taskId }),
		enqueueTerminalWake: async () => ({ kind: "delivered" as const }),
		now: () => Date.now(),
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const jobStates: Record<string, string> = {}
	const jobOwners: Record<string, string | undefined> = {}
	let completionCommitCount = 0
	let markerPromotionCount = 0
	let elmDecisionCount = 0
	const phaseWrites: string[] = []
	const elmDecision: "authorize" | "hold" | "failure" = opts.elmDecision ?? "authorize"

	// The R4 TOCTOU seam: an injected promise that HOLDS the
	// asynchronous Elm-authority flush until the test releases it.
	let elmFlushHeld = opts.holdElmFlush === true
	let flushGate: Promise<void> | undefined
	let openFlushGate: (() => void) | undefined
	if (elmFlushHeld) {
		flushGate = new Promise<void>((r) => {
			openFlushGate = () => r()
		})
	}

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
			// The production "update a message" channel. The
			// authoritative completion marker is published ONLY by the
			// C10 commit, so a promotion here proves the commit ran.
			emitHookMessage: (m: { isAuthoritativelyCompletedResult?: boolean }) => {
				if (m?.isAuthoritativelyCompletedResult === true) {
					markerPromotionCount += 1
				}
			},
		},
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			if (phase === "completed") {
				completionCommitCount += 1
			}
			phaseWrites.push(`${phase}:${writerId ?? "unknown-legacy-writer"}`)
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		hasRunningBackgroundJobForOwner: () => false,
		getPendingPromptCount: () => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: (jobId: string) => notifyCoordinator.hasActiveNotify(jobId),
		wasWakeDelivered: (jobId: string) => notifyCoordinator.wasWakeDelivered(jobId),
		getUnconsumedOwnedTerminalResultCount: (sid: string | undefined) =>
			sid === sessionId ? notifyCoordinator.unconsumedTerminalCountForOwner(sessionId, taskId) : 0,
		getUnconsumedOwnedTerminalJobIds: (sid: string, tid: string | undefined) =>
			sid === sessionId ? notifyCoordinator.unconsumedOwnedTerminalJobIdsForOwner(sid, tid) : [],
		// The PHCF01 authority inputs, wired exactly as `SdkController`
		// wires them. Either can be OMITTED to exercise the ABSENT-input
		// semantics of the shared classifier.
		...(opts.omitJobStates ? {} : { getBackgroundCommandJobStates: () => jobStates }),
		...(opts.omitJobOwners ? {} : { getBackgroundCommandJobOwners: () => jobOwners }),
		// The Elm completion-authority boundary.
		getElmCompletionAuthorityDecision: () => {
			elmDecisionCount += 1
			const decision: ElmCompletionAuthorityDecision =
				elmDecision === "authorize"
					? ({ kind: "authorize", reason: "cfc10ar01-injected-authorize" } as const)
					: elmDecision === "hold"
						? ({
								kind: "hold",
								reason: "cfc10ar01-injected-hold",
								holdReasons: ["cfc10ar01-injected-hold"],
							} as const)
						: ({
								kind: "failure",
								reason: "cfc10ar01-injected-failure",
								classification: "elm_authority_unavailable",
							} as const)
			return decision
		},
		// The R4 async Elm-authority flush seam.
		flushElmAuthorityForSession: async () => {
			if (flushGate) {
				await flushGate
			}
		},
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
		phaseWrites,
		markerPromotions: () => markerPromotionCount,
		jobStates,
		jobOwners,
		publishTerminalState: (jobId: string, state: string, ownerSessionId?: string) => {
			jobStates[jobId] = state
			if (ownerSessionId !== undefined) {
				jobOwners[jobId] = ownerSessionId
			}
		},
		releaseElmFlush: () => {
			elmFlushHeld = false
			openFlushGate?.()
			openFlushGate = undefined
		},
		elmFlushHeld: () => elmFlushHeld,
		elmDecisionCount: () => elmDecisionCount,
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
	h.publishTerminalState(jobId, state, h.sessionId)
	return { jobId, state, manager }
}

/** Register the non-notify terminal observation exactly as the runner does. */
function registerNonNotifyObservation(h: Harness, jobId: string): void {
	h.notifyCoordinator.recordNonNotifyTerminalObservation({
		jobId,
		sessionId: h.sessionId,
		taskId: h.taskId,
	})
}

/** Consume the terminal observation through the REAL status tool. */
async function consumeObservation(h: Harness, manager: CommandJobManager, jobId: string): Promise<void> {
	const statusTool = createCommandStatusTool(manager, {
		backgroundNotifyCoordinator: h.notifyCoordinator,
		resolveActiveOwner: () => ({ sessionId: h.sessionId, taskId: h.taskId }),
	})
	await statusTool.execute({ jobId, waitMs: 0 }, { sessionId: h.sessionId, agentId: "test-agent", iteration: 1 })
}

/** The C10 cardinality records the production capture produced. */
function c10CaptureCount(): number {
	return getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "task_completion_committed").length
}

// =============================================================================
// MATRIX-1 — the immediate C10 barrier
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01 / MATRIX-1 immediate C10 barrier", () => {
	it("CFC10AR01-M1-A: FAILED containment + observation PENDING → HOLD", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 93001 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			expect(h.jobStates[started.jobId]).toBe("containment_failed")
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M1-B: FAILED containment + observation CONSUMED → HOLD (the success criterion)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 93002 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			await consumeObservation(h, started.manager, started.jobId)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)
			expect(h.jobStates[started.jobId]).toBe("containment_failed")

			await emitCompletionTurn(h)
			// containment_failed + observation_consumed + Elm_AUTHORIZE
			// MUST NOT produce a C10 commit.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
			// No authoritative marker promotion.
			expect(h.markerPromotions()).toBe(0)
			// No `task_completion_committed` capture.
			expect(c10CaptureCount()).toBe(0)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M1-C: CLEAN containment + observation PENDING → HOLD", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "gone", pid: 93003 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			expect(h.jobStates[started.jobId]).not.toBe("containment_failed")
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M1-D: CLEAN containment + observation CONSUMED → AUTHORIZE (no new false HOLD)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "gone", pid: 93004 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			await consumeObservation(h, started.manager, started.jobId)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)

			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M1-E: a FOREIGN owner's failed containment does NOT block this task's completion", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			h.publishTerminalState("cmd_foreign", "containment_failed", "some-other-session")
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M1-F: an UNKNOWN-owner failed containment → HOLD (fail closed)", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			// The state map carries the failure but the owner map does NOT
			// carry an owner for it.
			h.publishTerminalState("cmd_unknown_owner", "containment_failed")
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M1-G: an ABSENT owner map + a failed containment → HOLD (conservative fail-closed)", async () => {
		const h = makeHarness({ omitJobOwners: true })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			h.publishTerminalState("cmd_no_owner_map", "containment_failed")
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M1-H: an ABSENT state map (authority input not wired) does NOT block", async () => {
		// The ABSENT authority input is NOT the same as a known
		// failed-containment entry. The Q5 pre-PHCF01 fallback is
		// preserved.
		const h = makeHarness({ omitJobStates: true })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			h.publishTerminalState("cmd_ignored", "containment_failed", h.sessionId)
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M1-I: MULTIPLE jobs, at least ONE matching failure → HOLD", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			// Two clean jobs owned by this session and ONE matching
			// containment failure owned by this session.
			h.publishTerminalState("cmd_clean_a", "exited", h.sessionId)
			h.publishTerminalState("cmd_clean_b", "cancelled", h.sessionId)
			h.publishTerminalState("cmd_failed", "containment_failed", h.sessionId)
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M1-J: MULTIPLE jobs, only FOREIGN failures → NOT blocked", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			h.publishTerminalState("cmd_clean_a", "exited", h.sessionId)
			h.publishTerminalState("cmd_failed_foreign", "containment_failed", "some-other-session")
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})
})

// =============================================================================
// MATRIX-2 — the Elm boundary
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01 / MATRIX-2 Elm boundary", () => {
	it("CFC10AR01-M2-A: Elm HOLD + clean containment → HOLD (the Elm gate is preserved)", async () => {
		const h = makeHarness({ elmDecision: "hold" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "gone", pid: 93010 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			await consumeObservation(h, started.manager, started.jobId)
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.markerPromotions()).toBe(0)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M2-B: Elm AUTHORIZE + FAILED containment → HOLD", async () => {
		const h = makeHarness({ elmDecision: "authorize" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 93011 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			await consumeObservation(h, started.manager, started.jobId)
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.markerPromotions()).toBe(0)
			expect(c10CaptureCount()).toBe(0)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M2-C: Elm FAILURE + clean containment → HOLD (no silent TS fallback)", async () => {
		const h = makeHarness({ elmDecision: "failure" })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "gone", pid: 93012 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			await consumeObservation(h, started.manager, started.jobId)
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})
})

// =============================================================================
// MATRIX-3 — the deferred C10 re-evaluation
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01 / MATRIX-3 deferred C10 re-evaluation", () => {
	it("CFC10AR01-M3-A: a HELD barrier + drained observation + FAILED containment → the deferred release is REFUSED", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 93020 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			// Register the ACTUAL deferred completion barrier.
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(true)

			// Drain the observation while the barrier is held.
			await consumeObservation(h, started.manager, started.jobId)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)
			expect(h.jobStates[started.jobId]).toBe("containment_failed")

			// Exercise the ACTUAL deferred re-evaluation method.
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.markerPromotions()).toBe(0)
			expect(c10CaptureCount()).toBe(0)
			// The barrier is PRESERVED so a later re-evaluation can
			// release the completion if the failure is resolved.
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(true)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M3-B: a HELD barrier + drained observation + CLEAN containment → the deferred release PROCEEDS", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "gone", pid: 93021 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(true)

			await consumeObservation(h, started.manager, started.jobId)
			expect(h.notifyCoordinator.unconsumedTerminalCountForOwner(h.sessionId, h.taskId)).toBe(0)

			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(false)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M3-C: a FOREIGN owner's failed containment does NOT block the deferred release", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "gone", pid: 93022 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			await emitCompletionTurn(h)
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(true)
			await consumeObservation(h, started.manager, started.jobId)
			// A FOREIGN owner's failure arrives while the barrier is held.
			h.publishTerminalState("cmd_foreign", "containment_failed", "some-other-session")

			await h.coordinator.reevaluateDeferredCompletionBarrier()
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})
})

// =============================================================================
// MATRIX-4 — the R4 asynchronous admission interval
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01 / MATRIX-4 async admission interval", () => {
	it("CFC10AR01-M4-A: a containment failure published DURING the awaited Elm flush cannot slip through the commit boundary", async () => {
		const h = makeHarness({ holdElmFlush: true })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			// STEP 1: no containment failure exists yet.
			expect(Object.values(h.jobStates).filter((s) => s === "containment_failed")).toHaveLength(0)

			// STEP 2: drive the C10 barrier. The barrier passes (there is
			// nothing to hold it), and the coordinator reaches the
			// awaited Elm-authority flush.
			const completionTurn = emitCompletionTurn(h)
			// Let the barrier and the flush await run.
			await new Promise((r) => setTimeout(r, 10))
			expect(h.elmFlushHeld()).toBe(true)

			// STEP 3: publish a containment failure for the SAME owner
			// while the flush is held.
			h.publishTerminalState("cmd_late_failure", "containment_failed", h.sessionId)

			// STEP 4: resolve the flush; Elm AUTHORIZEs.
			h.releaseElmFlush()
			await completionTurn

			// STEP 5: the commit MUST NOT happen. The failure was known
			// at the ACTUAL commit boundary.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.markerPromotions()).toBe(0)
			expect(c10CaptureCount()).toBe(0)
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M4-B: the async interval does NOT introduce a false HOLD on the clean path", async () => {
		const h = makeHarness({ holdElmFlush: true })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			const completionTurn = emitCompletionTurn(h)
			await new Promise((r) => setTimeout(r, 10))
			expect(h.elmFlushHeld()).toBe(true)
			h.releaseElmFlush()
			await completionTurn
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M4-C: the revalidation does NOT add a second Elm consult (no repeated provider calls)", async () => {
		const h = makeHarness({ holdElmFlush: true })
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		try {
			const completionTurn = emitCompletionTurn(h)
			await new Promise((r) => setTimeout(r, 10))
			h.releaseElmFlush()
			await completionTurn
			// EXACTLY ONE Elm decision consult, even though the
			// containment fact is read at BOTH the barrier and the
			// commit boundary.
			expect(h.elmDecisionCount()).toBe(1)
		} finally {
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})
})

// =============================================================================
// MATRIX-5 — conservation of the surrounding contracts
// =============================================================================

describe("ACT-CLINEMM-P0-CONTAINMENT-FAILURE-C10-AUTHORITY-REPAIR01 / MATRIX-5 conservation", () => {
	it("CFC10AR01-M5-A: observing or evicting a failed job does NOT erase its containment classification", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 93030 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			// The CONTAINMENT classification survives the observation
			// consumption (the observation is a DIFFERENT fact).
			await consumeObservation(h, started.manager, started.jobId)
			expect(h.jobStates[started.jobId]).toBe("containment_failed")
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M5-B: a STALE task/epoch marker cannot commit a stale completion", async () => {
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "alive", pid: 93032 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			// The barrier is registered under the current epoch.
			await emitCompletionTurn(h)
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(true)

			// The epoch advances: the marker is superseded.
			h.minter.bumpEpoch()
			await h.coordinator.reevaluateDeferredCompletionBarrier()
			// The stale marker cannot commit anything.
			expect(h.completionCommitCount()).toBe(0)
			expect(h.tracker.currentPhase).not.toBe("completed")
			expect(h.coordinator.isDeferredCompletionBarrierOutstandingForTesting()).toBe(false)
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M5-C: the Q5 failure recovery is UNCHANGED (resumable + the canonical writer identity)", async () => {
		// The Q5 path (`reevaluateDeferredContinuation`) is exercised by
		// the PHCF01 suite. This case pins the WRITER IDENTITY and the
		// recovery phase that the shared-classifier refactor must
		// preserve.
		const fs = await import("node:fs/promises")
		const coordinatorSource = await fs.readFile(new URL("../sdk-session-event-coordinator.ts", import.meta.url), "utf8")
		expect(coordinatorSource).toContain(
			'setTurnPhase?.("resumable", undefined, "session-event-turn-complete-containment-failed-resumable")',
		)
		expect(coordinatorSource).toContain("unresolved containment failure (jobs=")
		// The Q5 path uses the SHARED classifier (no second copy).
		expect(coordinatorSource.includes("failedContainmentJobIds = this.unresolvedContainmentFailuresForOwner(")).toBe(true)
	})

	it("CFC10AR01-M5-D: tracing DISABLED preserves the normal (non-defect) behavior", async () => {
		// The lifecycle trace is OFF by default; the completion commit
		// still happens on the clean path.
		const h = makeHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const started = await startJobAndRunToTerminal(h, { postcondition: "gone", pid: 93033 })
		try {
			registerNonNotifyObservation(h, started.jobId)
			await consumeObservation(h, started.manager, started.jobId)
			await emitCompletionTurn(h)
			expect(h.completionCommitCount()).toBe(1)
			expect(h.tracker.currentPhase).toBe("completed")
			// The canonical writer identity is preserved.
			expect(h.phaseWrites).toContain("completed:session-event-turn-complete-completed")
		} finally {
			await started.manager.dispose()
			h.notifyCoordinator.dispose()
			await h.manager.dispose()
		}
	})

	it("CFC10AR01-M5-E: the CCARD capture fires exactly once on the clean path and NEVER on the blocked path", async () => {
		setContinuationCardinalityAuthorityCaptureEnabled(true)
		const blocked = makeHarness()
		blocked.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const failed = await startJobAndRunToTerminal(blocked, { postcondition: "alive", pid: 93034 })
		try {
			registerNonNotifyObservation(blocked, failed.jobId)
			await consumeObservation(blocked, failed.manager, failed.jobId)
			await emitCompletionTurn(blocked)
			expect(blocked.completionCommitCount()).toBe(0)
			expect(c10CaptureCount()).toBe(0)
		} finally {
			await failed.manager.dispose()
			blocked.notifyCoordinator.dispose()
			await blocked.manager.dispose()
		}

		clearContinuationCardinalityAuthorityCapture()
		const clean = makeHarness()
		clean.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		const ok = await startJobAndRunToTerminal(clean, { postcondition: "gone", pid: 93035 })
		try {
			registerNonNotifyObservation(clean, ok.jobId)
			await consumeObservation(clean, ok.manager, ok.jobId)
			await emitCompletionTurn(clean)
			expect(clean.completionCommitCount()).toBe(1)
			expect(c10CaptureCount()).toBe(1)
		} finally {
			await ok.manager.dispose()
			clean.notifyCoordinator.dispose()
			await clean.manager.dispose()
		}
	})

	it("CFC10AR01-M5-F: the shared classifier is the SINGLE containment predicate (no triplication)", async () => {
		const fs = await import("node:fs/promises")
		const coordinatorSource = await fs.readFile(new URL("../sdk-session-event-coordinator.ts", import.meta.url), "utf8")
		// Exactly ONE definition of the classifier.
		expect((coordinatorSource.match(/private unresolvedContainmentFailuresForOwner\(/g) ?? []).length).toBe(1)
		// Exactly ONE comparison against the `containment_failed` state.
		expect((coordinatorSource.match(/!== "containment_failed"/g) ?? []).length).toBe(1)
		// The classifier + the four call sites (Site A, Site B, Site C
		// and the R4 commit-boundary revalidation helper).
		expect((coordinatorSource.match(/unresolvedContainmentFailuresForOwner\(/g) ?? []).length).toBe(5)
	})
})
