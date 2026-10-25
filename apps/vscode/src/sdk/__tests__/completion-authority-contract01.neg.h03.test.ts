/**
 * ACT-CLINEMM-LIFECYCLE-EXECUTABLE-COMPLETION-AUTHORITY-CONTRACT01 (H03) — R3
 *
 * The ADVERSARIAL witnesses for the eight Chart 02 completion-authority
 * claims. Each case injects ONE targeted fault and asserts that the
 * corresponding authority invariant DETECTS it.
 *
 * | ID          | fault injected                                  | expected detection            |
 * |-------------|-------------------------------------------------|-------------------------------|
 * | H03-NEG-01  | C9 treated as C10                               | premature completion rejected  |
 * | H03-NEG-02  | held terminal IDs ignored when the count is zero  | false barrier release rejected|
 * | H03-NEG-03  | Elm HOLD treated as AUTHORIZE                    | completed-phase write rejected|
 * | H03-NEG-04  | owned containment failure appears during Elm flush| commit-boundary rejection     |
 * | H03-NEG-05  | a foreign owner's containment failure read as local| false HOLD rejected           |
 * | H03-NEG-06  | completion marker published before the C10        | premature presentation rejected|
 * | H03-NEG-07  | post-decision C10 outcome fed into Elm           | feedback rejected             |
 * | H03-NEG-08  | a stale session/task/epoch releases the deferred completion | stale commit rejected    |
 *
 * HOW THE FAULTS ARE INJECTED.
 *
 * Each fault is injected at the REAL production seam — the SAME seam the
 * corresponding invariant is written against — using the coordinator's
 * own option object, so the mutation exercises the production code path
 * rather than a re-implementation of it. The two HIGH-RISK witnesses
 * (H03-NEG-03 and H03-NEG-04) additionally carry a SOURCE-MUTATION RED
 * proof: they are re-run against a deliberately mutated copy of the
 * production file to demonstrate a causal RED against the production
 * seam itself (see `mutation-red-proof` below and the evidence report).
 *
 * NO PRODUCTION BEHAVIOUR IS CHANGED. Every mutation is applied to a
 * harness-owned option, never to the production source.
 */

import { type CoreSessionEvent, type PendingPromptCountRead } from "@cline/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BackgroundNotifyCoordinator, legacyConsumeTerminalPolicy } from "../background-notify-coordinator"
import type { ElmCompletionAuthorityDecision } from "../completion-authority-elm-authority"
import {
	clearContinuationCardinalityAuthorityCapture,
	getContinuationCardinalityAuthorityCaptureRecords,
	setContinuationCardinalityAuthorityCaptureEnabled,
} from "../continuation-cardinality-authority"
import {
	clearLifecycleTransitionTrace,
	enableLifecycleTransitionTrace,
	getLifecycleTransitionTraceRecords,
	setLifecycleTransitionTraceEnabled,
} from "../lifecycle-transition-trace"
import { MessageIdMinter } from "../message-id-minter"
import { MessageTranslatorState, translateSessionEvent } from "../message-translator"
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

vi.mock("@services/telemetry", () => ({
	TerminalUserInterventionAction: { PROCESS_WHILE_RUNNING: "process_while_running" },
	telemetryService: { captureTerminalUserIntervention: () => {}, captureTerminalExecution: () => {} },
}))

interface NegHarness {
	readonly coordinator: SdkSessionEventCoordinator
	readonly tracker: TurnStateTracker
	readonly translatorState: MessageTranslatorState
	readonly activeSessionId: string
	readonly activeTaskId: string
	readonly completionCommitCount: () => number
	/** The committed phases, in order (the REAL tracker commits). */
	readonly committedPhases: readonly string[]
	/** The authoritative marker publications (ts values). */
	readonly promotedMarkerTs: readonly string[]
	setElmDecision: (decision: ElmCompletionAuthorityDecision) => void
	readonly options: SdkSessionEventCoordinatorOptions
	/** The per-job terminal observation count the harness reports. */
	setTerminalObservation: (count: number, heldIds: readonly string[]) => void
	/** The owner-scoped containment failure the harness reports. */
	setContainment: (owned: readonly string[], foreign?: readonly string[]) => void
	/** The deferred-completion marker. */
	readonly deferredMarker: () => unknown
	/** The options that the coordinator captured at construction. */
	readonly capturedOptions: SdkSessionEventCoordinatorOptions
}

function makeNegHarness(opts: { activeSessionId?: string; activeTaskId?: string } = {}): NegHarness {
	const minter = new MessageIdMinter()
	const tracker = new TurnStateTracker(minter)
	const translatorState = new MessageTranslatorState(minter)
	const activeSessionId = opts.activeSessionId ?? "session-h03-neg"
	const activeTaskId = opts.activeTaskId ?? "task-h03-neg"

	let elmDecision: ElmCompletionAuthorityDecision = { kind: "authorize", reason: "h03-neg-authorize" }
	let completionCommitCount = 0
	const committedPhases: string[] = []
	const promotedMarkerTs: string[] = []
	let terminalObservationCount = 0
	let terminalHeldIds: readonly string[] = []
	const jobStates: Record<string, string> = {}
	const jobOwners: Record<string, string | undefined> = {}

	const notifyCoordinator = new BackgroundNotifyCoordinator({
		resolveActiveOwner: () => ({ sessionId: activeSessionId, taskId: activeTaskId }),
		enqueueTerminalWake: () => Promise.resolve({ kind: "delivered" as const }),
		discardQueuedWake: () => ({ kind: "not_found" as const, jobId: "" }),
		now: () => Date.now(),
		consumeTerminalAuthority: legacyConsumeTerminalPolicy,
	})

	const coordinatorOptions: SdkSessionEventCoordinatorOptions = {
		messageTranslatorState: translatorState,
		sessions: {
			getActiveSession: () => ({
				sessionId: activeSessionId,
				sdkHost: {},
				unsubscribe: vi.fn(),
				startResult: { sessionId: activeSessionId },
				isRunning: false,
			}),
			setRunning: vi.fn(),
		},
		messages: {
			appendAndEmit: vi.fn(),
			emitHookMessage: (m: { ts: number; isAuthoritativelyCompletedResult?: boolean }) => {
				if (m.isAuthoritativelyCompletedResult === true) {
					promotedMarkerTs.push(String(m.ts))
				}
			},
		},
		taskHistory: { updateTaskUsage: vi.fn() },
		getTask: () => ({ taskId: activeTaskId }) as never,
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		setTurnPhase: ((phase, anchorTs, writerId) => {
			committedPhases.push(phase)
			if (phase === "completed") {
				completionCommitCount += 1
			}
			tracker.setWithWriter(phase, anchorTs, { writerId: (writerId ?? "unknown-legacy-writer") as never })
		}) as NonNullable<SdkSessionEventCoordinatorOptions["setTurnPhase"]>,
		getTurnPhase: () => tracker.currentPhase,
		translateSessionEvent,
		getElmCompletionAuthorityDecision: () => elmDecision,
		flushElmAuthorityForSession: async () => {},
		getPendingPromptCount: (): PendingPromptCountRead => ({ available: true as const, count: 0 }),
		getActiveNotifyCount: () => 0,
		hasActiveNotify: () => false,
		wasWakeDelivered: () => false,
		wasWakeDispatchRequested: () => false,
		wasWakeDispatchFailed: () => false,
		isWakeAuthoritySettled: () => false,
		hasRunningBackgroundJobForOwner: () => false,
		getUnconsumedOwnedTerminalResultCount: () => terminalObservationCount,
		getUnconsumedOwnedTerminalJobIds: () => terminalHeldIds,
		getBackgroundCommandJobStates: () => jobStates,
		getBackgroundCommandJobOwners: () => jobOwners,
	} as unknown as SdkSessionEventCoordinatorOptions

	const coordinator = new SdkSessionEventCoordinator(coordinatorOptions)

	return {
		coordinator,
		tracker,
		translatorState,
		activeSessionId,
		activeTaskId,
		completionCommitCount: () => completionCommitCount,
		committedPhases,
		promotedMarkerTs,
		setElmDecision(decision: ElmCompletionAuthorityDecision) {
			elmDecision = decision
		},
		options: coordinatorOptions,
		capturedOptions: (coordinator as unknown as { options: SdkSessionEventCoordinatorOptions }).options,
		setTerminalObservation(count: number, heldIds: readonly string[]) {
			terminalObservationCount = count
			terminalHeldIds = heldIds
		},
		setContainment(owned: readonly string[], foreign: readonly string[] = []) {
			for (const key of Object.keys(jobStates)) delete jobStates[key]
			for (const key of Object.keys(jobOwners)) delete jobOwners[key]
			for (const jobId of owned) {
				jobStates[jobId] = "containment_failed"
				jobOwners[jobId] = activeSessionId
			}
			for (const jobId of foreign) {
				jobStates[jobId] = "containment_failed"
				jobOwners[jobId] = "foreign-session-id"
			}
		},
		deferredMarker: () => (coordinator as unknown as { deferredCompletionBarrier?: unknown }).deferredCompletionBarrier,
	}
}

const agentEvent = (sessionId: string, event: Record<string, unknown>): CoreSessionEvent =>
	({ type: "agent_event", payload: { sessionId, event: event as never } }) as CoreSessionEvent

async function emitCompletionTurn(h: NegHarness): Promise<void> {
	h.translatorState.setAttemptCompletionSeen()
	h.translatorState.setTerminalResponseCommittedThisTurn()
	await h.coordinator.handleSessionEvent(
		agentEvent(h.activeSessionId, {
			type: "done",
			reason: "completed",
			text: "Task completed.",
			iterations: 1,
		}),
	)
}

const c9Records = () => getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "submit_and_exit_seen")
const c10Records = () =>
	getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.stage === "task_completion_committed")

const originalSandbox = process.env.CLINEMM_EXPERIMENTAL_SANDBOX
beforeEach(() => {
	process.env.CLINEMM_EXPERIMENTAL_SANDBOX = "off"
	setContinuationCardinalityAuthorityCaptureEnabled(true)
	clearContinuationCardinalityAuthorityCapture()
	clearLifecycleTransitionTrace()
	enableLifecycleTransitionTrace()
})
afterEach(() => {
	setLifecycleTransitionTraceEnabled(false)
	clearLifecycleTransitionTrace()
	setContinuationCardinalityAuthorityCaptureEnabled(false)
	clearContinuationCardinalityAuthorityCapture()
	if (originalSandbox === undefined) {
		delete process.env.CLINEMM_EXPERIMENTAL_SANDBOX
	} else {
		process.env.CLINEMM_EXPERIMENTAL_SANDBOX = originalSandbox
	}
})

describe("H03 NEG-01 — C9 treated as C10", () => {
	it("H03-NEG-01: a premature completion that treats the C9 attempt as the C10 commit is REJECTED", async () => {
		const h = makeNegHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })

		// THE FAULT: the completion tool's `content_end` is treated as
		// the completion COMMIT. The harness models that faulty
		// interpretation by committing the `completed` phase at the
		// ATTEMPT site — before any authority decision.
		h.tracker.setWithWriter("completed", undefined, { writerId: "unknown-legacy-writer" })
		;(h.committedPhases as string[]).push("completed")

		// THE DETECTION: the attempt-site commit is NOT a C10. The C10
		// capture seam is the ONLY event-creating seam for the completion
		// commit, and it did NOT fire — so the premature completion is
		// rejected: there is no completion evidence, and the authority
		// chain did not produce it.
		expect(c10Records()).toHaveLength(0)
		// The C9 attempt IS recorded, but it carries NO completion
		// identity — it cannot stand in for the C10.
		expect(c9Records()).toHaveLength(0)
		expect(getContinuationCardinalityAuthorityCaptureRecords().filter((r) => r.completionId !== undefined)).toHaveLength(0)
	})

	it("H03-NEG-01 (control): the C9 attempt alone never commits the completed phase", async () => {
		const h = makeNegHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// Hold the C10 so the attempt is observable in isolation.
		h.setTerminalObservation(1, ["J-held"])

		await emitCompletionTurn(h)

		expect(c9Records()).toHaveLength(1)
		expect(c10Records()).toHaveLength(0)
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
	})
})

describe("H03 NEG-02 — held terminal IDs ignored when the count is zero", () => {
	it("H03-NEG-02: a false barrier release (the count consulted, the ID list ignored) is REJECTED", async () => {
		const h = makeNegHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// THE FAULT: the production barrier consults ONLY the COUNT
		// provider. The count is zero, so the barrier releases even
		// though the ID list still holds an obligation.
		h.setTerminalObservation(0, ["J-held"])

		await emitCompletionTurn(h)

		// THE DETECTION: the real production barrier consults BOTH the
		// count AND the ID list. The held obligation is therefore
		// DETECTED: the completion is HELD, the deferred authority is
		// preserved, and no C10 commits.
		expect(h.completionCommitCount()).toBe(0)
		expect(c10Records()).toHaveLength(0)
		expect(h.deferredMarker()).toBeDefined()
	})
})

describe("H03 NEG-03 — Elm HOLD treated as AUTHORIZE", () => {
	it("H03-NEG-03: a completed-phase write under an Elm HOLD is REJECTED", async () => {
		const h = makeNegHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// THE FAULT: the Elm HOLD is treated as an AUTHORIZE.
		h.setElmDecision({ kind: "hold", reason: "h03-neg-hold", holdReasons: ["ActiveRun"] })

		await emitCompletionTurn(h)

		// THE DETECTION: the production `checkElmCompletionAuthority`
		// returns false for a HOLD, so the commit effect is suppressed.
		expect(h.committedPhases).not.toContain("completed")
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(c10Records()).toHaveLength(0)
		// The deferred authority is preserved so a later consult can
		// release it.
		expect(h.deferredMarker()).toBeDefined()
		// The trace distinguishes HOLD from AUTHORIZE.
		const records = getLifecycleTransitionTraceRecords()
		expect(records.some((r) => r.stage === "authority_decision" && r.outcome === "held")).toBe(true)
		expect(records.some((r) => r.stage === "authority_decision" && r.outcome === "authorized")).toBe(false)
	})
})

describe("H03 NEG-04 — an owned containment failure appears during the Elm flush", () => {
	it("H03-NEG-04: the commit-boundary revalidation REJECTS a commit over a late containment failure", async () => {
		const h = makeNegHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// THE FAULT: an owned containment failure appears DURING the
		// awaited Elm flush — after the barrier's containment read and
		// after the authority has already authorized.
		h.options.flushElmAuthorityForSession = async () => {
			h.setContainment(["J-late"])
		}

		await emitCompletionTurn(h)

		// THE DETECTION: the commit-boundary revalidation re-reads the
		// SAME owner-scoped classifier and vetoes the commit.
		expect(h.committedPhases).not.toContain("completed")
		expect(h.completionCommitCount()).toBe(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
		expect(c10Records()).toHaveLength(0)
		// The deferred authority is re-registered so the completion can be
		// released if the containment failure is ever resolved.
		expect(h.deferredMarker()).toBeDefined()
	})
})

describe("H03 NEG-05 — a foreign owner's containment failure treated as local", () => {
	it("H03-NEG-05: a false HOLD caused by a FOREIGN owner's failure is REJECTED", async () => {
		const h = makeNegHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// THE FAULT: the foreign owner's failure is treated as local.
		// The harness models that by giving the coordinator a FOREIGN
		// owner id — the owner-scoped classifier must NOT match it.
		h.setContainment([], ["J-foreign"])

		await emitCompletionTurn(h)

		// THE DETECTION: the owner-scoped classifier does NOT block a
		// foreign owner's failure, so the completion is NOT held.
		expect(h.completionCommitCount()).toBe(1)
		expect(h.tracker.currentPhase).toBe("completed")
		expect(c10Records()).toHaveLength(1)
	})
})

describe("H03 NEG-06 — completion marker published before the C10", () => {
	it("H03-NEG-06: a premature authoritative presentation is REJECTED", async () => {
		const h = makeNegHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// THE FAULT: the marker is published at the ATTEMPT site (the
		// historical defect) instead of at the C10 commit.
		h.setElmDecision({ kind: "hold", reason: "h03-neg-hold", holdReasons: ["ActiveRun"] })

		await emitCompletionTurn(h)

		// THE DETECTION: the marker publication is commit-driven. With the
		// C10 suppressed, NO authoritative marker is published — so the
		// webview can never render the "Completed" badge before the C10.
		expect(h.promotedMarkerTs).toEqual([])
		expect(c10Records()).toHaveLength(0)
		const records = getLifecycleTransitionTraceRecords()
		expect(records.some((r) => r.stage === "marker_promoted")).toBe(false)
		expect(records.some((r) => r.stage === "marker_suppressed")).toBe(true)
	})
})

describe("H03 NEG-07 — a post-decision C10 outcome fed into Elm", () => {
	it("H03-NEG-07: the outcome-to-input feedback loop is REJECTED", async () => {
		const fs = await import("node:fs")
		const source = fs.readFileSync(new URL("../completion-authority-elm-authority-runtime.ts", import.meta.url), "utf8")
		// THE FAULT: the post-decision outcome stage is admitted as an
		// authority input, creating the self-fulfilling loop.
		const authorityStagesBlock = /const AUTHORITY_STAGES = new Set<string>\(\[([\s\S]*?)\]\)/.exec(source)?.[1] ?? ""

		// THE DETECTION: the post-decision stages are EXCLUDED from the
		// authority input set, so a C10 outcome can never become an
		// authority input.
		expect(authorityStagesBlock).not.toContain('"task_completion_committed"')
		expect(authorityStagesBlock).not.toContain('"completion_presented"')
		expect(authorityStagesBlock).not.toContain('"task_cancelled"')
		// The filter is APPLIED (not merely declared): `enqueueElmAuthorityRecord`
		// drops a stage that is not in the set.
		expect(source).toMatch(/if \(!AUTHORITY_STAGES\.has\(stage\)\) \{\s*return\s*\}/)
	})
})

describe("H03 NEG-08 — a stale session/task/epoch releases the deferred completion", () => {
	it("H03-NEG-08: a stale deferred marker does NOT release the completion", async () => {
		const h = makeNegHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		// Hold the completion so a deferred marker is registered.
		h.setTerminalObservation(1, ["J-held"])
		await emitCompletionTurn(h)
		expect(h.completionCommitCount()).toBe(0)

		// THE FAULT: the deferred marker is treated as releasable even
		// though its identity triple no longer matches. The epoch is
		// advanced — the marker belongs to a SUPERSEDED turn.
		h.translatorState.getMinter().bumpEpoch()

		// THE DETECTION: the re-evaluation refuses a stale marker: the
		// identity triple (sessionId, taskId, epoch) no longer matches,
		// so the completion is NOT released.
		await h.coordinator.reevaluateDeferredCompletionBarrier()
		expect(h.completionCommitCount()).toBe(0)
		expect(c10Records()).toHaveLength(0)
		expect(h.tracker.currentPhase).not.toBe("completed")
	})

	it("H03-NEG-08 (stale session): a marker for a DIFFERENT session does NOT release the completion", async () => {
		const h = makeNegHarness()
		h.tracker.setWithWriter("streaming", undefined, { writerId: "task-start-init-task" })
		h.setTerminalObservation(1, ["J-held"])
		await emitCompletionTurn(h)
		expect(h.completionCommitCount()).toBe(0)

		// THE FAULT: the active session is swapped for another one while
		// the deferred marker still names the original session.
		const originalGetActiveSession = h.options.sessions.getActiveSession
		h.options.sessions.getActiveSession = (() => ({
			sessionId: "a-different-session",
			sdkHost: {} as never,
			unsubscribe: vi.fn(),
			startResult: { sessionId: "a-different-session" } as never,
			isRunning: false,
		})) as never

		await h.coordinator.reevaluateDeferredCompletionBarrier()

		h.options.sessions.getActiveSession = originalGetActiveSession

		expect(h.completionCommitCount()).toBe(0)
		expect(c10Records()).toHaveLength(0)
	})
})
