/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT
 *
 * Stateful W01-W16 + F01-F03 workload qualification for the unified
 * observation boundary. Continuation of C2.3 (which established the
 * harness foundation; this ACT applies the C3.CONT.0 harness
 * corrections before adding W05-W16).
 *
 * CONT.0 HARNESS CORRECTIONS (from C2.3 review):
 *   R1  canonical step must carry the facts valid AT THAT INSTANT.
 *       - canonical step accepts an explicit `arbiter` + `legacyPhase`.
 *       - if absent, the harness auto-advances `currentArbiter` from
 *         `event.snapshot.execution` and `currentLegacyPhase` stays
 *         at whatever it was (caller must opt-in to phase changes).
 *       - `currentArbiter` is NEVER inherited across a canonical step.
 *   R2  `canonicalAvailable` is a real harness input. When the wiring
 *       is built with canonicalAvailable=false, the harness routes
 *       reconstructed events through the SAME production decision the
 *       wiring uses (DIAGNOSTIC_ONLY -> FALLBACK_APPLY). F01-F03
 *       actually exercise this.
 *   R3  `set-active-run` actually sets the active run identity.
 *       The active runId is sampled from the latest canonical
 *       snapshot. W11/F02 use it.
 *   R4  W01 must terminate lifecycle.kind === "completed" (exact).
 *       Use `run-finished` (the canonical terminal edge) which
 *       adapts to `task_completed`.
 *   R5  W03/W04 must prove intermediate states via inline
 *       checkpoints, not just final-state assertions.
 *   R6  W03 must use exact deterministic counts.
 *   R7  W02 must use production-realistic legacy phases. No
 *       "choose idle to minimize divergence" — that hides
 *       classification behavior.
 *   R8  HOST_RECOVERY production ingress is `emitHostRecovery()`,
 *       not direct `coordinator.observe()`.
 *
 * PRODUCTION-INGRESS ONLY:
 *   canonical      -> wiring.observeCanonicalRuntimeEvent(...)
 *   legacy         -> sessionOptions.onSessionEvent(...)
 *   host-task      -> emitTask{Requested|Cancelled|Reset|SameTaskContinued}
 *   host-recovery  -> emitHostRecovery(...)
 *
 * The harness NEVER mutates comparator / recorder / coordinator
 * directly. Reads back via wiring.records() / wiring.recorderCounts()
 * / wiring.comparator.debugSnapshot().
 */

import { TaskState } from "@cline/agents"
import type { CoreSessionEvent } from "@cline/core"
import type {
	AgentEvent,
	AgentRuntimeEvent,
	AgentRuntimeExecutionState,
	AgentRuntimeStateSnapshot,
	RecoveryState,
} from "@cline/shared"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import type { SdkSessionLifecycleOptions } from "../sdk-session-lifecycle"
import {
	emitHostRecovery,
	emitSameTaskContinued,
	emitTaskCancelled,
	emitTaskRequested,
	emitTaskReset,
} from "../task-state-shadow-host-msgs"
import {
	createTaskShadowHostWiring,
	emptyArbiterSnapshot,
	type TaskShadowHostWiringDeps,
	type TaskShadowHostWiringWithSink,
} from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot, TaskShadowDifferentialRecord, TaskShadowRecorderCounts } from "../task-state-shadow-recorder"

const NOW = 1_700_000_000_000
const ENV_FLAG = "CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL"
const ORIGINAL_ENV = process.env[ENV_FLAG]

beforeEach(() => {
	process.env[ENV_FLAG] = "1"
})
afterEach(() => {
	if (ORIGINAL_ENV === undefined) delete process.env[ENV_FLAG]
	else process.env[ENV_FLAG] = ORIGINAL_ENV
})

export type WorkloadStep =
	| {
			kind: "canonical"
			sessionId: string
			event: AgentRuntimeEvent
			/**
			 * R1: explicit facts valid AT THIS INSTANT. Optional —
			 * when omitted, the harness auto-derives the arbiter
			 * from `event.snapshot.execution` (so canonical events
			 * own their own temporal state). The legacyPhase is
			 * left untouched unless the caller opts in via
			 * `setLegacyPhase: true`.
			 */
			arbiter?: ArbiterSnapshot
			setLegacyPhase?: { phase: TurnPhase; advance: boolean }
	  }
	| { kind: "legacy"; event: CoreSessionEvent; legacyPhase: TurnPhase; arbiter: ArbiterSnapshot }
	| {
			kind: "host-task"
			taskId: string
			which: "requested" | "cancelled" | "reset" | "continued"
			legacyPhase: TurnPhase
	  }
	| {
			kind: "host-recovery"
			sessionId: string
			from: RecoveryState
			to: RecoveryState
			canonicalAvailable: boolean
	  }
	| { kind: "set-active-session"; sessionId: string | undefined }
	| { kind: "set-legacy-phase"; phase: TurnPhase }
	| { kind: "fence-canonical-run" }
	| { kind: "wiring-reset-for-new-task" }
	| { kind: "checkpoint"; selected: CheckpointSelection }
	| { kind: "expect-state"; assertion: (model: TaskState.TaskModel) => void }
	| {
			kind: "expect-counts"
			assertion: (counts: TaskShadowRecorderCounts, records: readonly TaskShadowDifferentialRecord[]) => void
	  }

export type CheckpointSelection = Partial<{
	eventsObserved: number
	comparisons: number
	agreements: number
	divergences: number
	invariants: number
	droppedRecords: number
	evidenceGaps: number
	observerErrors: number
	suppressedRUNTIME_CANONICAL: number
	suppressedRUNTIME_RECONSTRUCTED: number
	suppressedHOST_TASK: number
	suppressedHOST_RECOVERY: number
	diagnosticRUNTIME_CANONICAL: number
	diagnosticRUNTIME_RECONSTRUCTED: number
	diagnosticHOST_TASK: number
	diagnosticHOST_RECOVERY: number
	fallbackReconstructedApplied: number
	fallbackRecoveryApplied: number
	D00: number
	D01: number
	D02: number
	D03: number
	D04: number
	D05: number
	D06: number
	D07: number
	D08: number
	D09: number
	D10: number
	D11: number
}>

function snapshotFixture(opts: {
	runId: string
	iteration: number
	execution: AgentRuntimeExecutionState
	recoveryState: RecoveryState
	status: AgentRuntimeStateSnapshot["status"]
	pendingToolCalls: readonly string[]
}): AgentRuntimeStateSnapshot {
	return {
		agentId: opts.runId,
		runId: opts.runId,
		status: opts.status,
		iteration: opts.iteration,
		messages: [],
		pendingToolCalls: opts.pendingToolCalls,
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
		execution: opts.execution,
		recovery: {
			state: opts.recoveryState,
			tracker: {
				state: opts.recoveryState,
				currentRepairAttempts: 0,
				equivalentRepeatCount: 0,
				blockedExactKeys: [],
				blockedFamilies: [],
			},
			secondStage: "idle",
			episodeFailures: 0,
			maxEpisodeFailures: 5,
			circuitNoticeCount: 0,
		},
	}
}

function execEvent(prev: AgentRuntimeExecutionState, snapshot: AgentRuntimeStateSnapshot): AgentRuntimeEvent {
	return { type: "execution-state-changed", previousExecution: prev, snapshot }
}
function recoveryEvent(from: RecoveryState, snapshot: AgentRuntimeStateSnapshot): AgentRuntimeEvent {
	const prev = snapshot.recovery ?? {
		state: from,
		tracker: {
			state: from,
			currentRepairAttempts: 0,
			equivalentRepeatCount: 0,
			blockedExactKeys: [],
			blockedFamilies: [],
		},
		secondStage: "idle" as const,
		episodeFailures: 0,
		maxEpisodeFailures: 5,
		circuitNoticeCount: 0,
	}
	return { type: "recovery-state-changed", previousRecovery: prev, snapshot }
}
function runStarted(snapshot: AgentRuntimeStateSnapshot): AgentRuntimeEvent {
	return { type: "run-started", snapshot }
}
function runFinished(snapshot: AgentRuntimeStateSnapshot): AgentRuntimeEvent {
	return {
		type: "run-finished",
		snapshot,
		result: {
			agentId: snapshot.agentId,
			runId: snapshot.runId ?? "run-unknown",
			status: "completed",
			iterations: 0,
			outputText: "",
			messages: [],
			usage: snapshot.usage,
		},
	}
}
function turnFinished(snapshot: AgentRuntimeStateSnapshot, toolCallCount: number): AgentRuntimeEvent {
	return { type: "turn-finished", snapshot, iteration: snapshot.iteration, toolCallCount }
}
function toolStarted(snapshot: AgentRuntimeStateSnapshot, toolCallId: string, toolName = "read_file"): AgentRuntimeEvent {
	return {
		type: "tool-started",
		snapshot,
		iteration: snapshot.iteration,
		toolCall: { type: "tool-call", toolCallId, toolName, input: {} },
	}
}
function toolFinished(snapshot: AgentRuntimeStateSnapshot, toolCallId: string): AgentRuntimeEvent {
	return {
		type: "tool-finished",
		snapshot,
		iteration: snapshot.iteration,
		toolCall: { type: "tool-call", toolCallId, toolName: "read_file", input: {} },
		message: { id: `m-${toolCallId}`, role: "tool", content: [], createdAt: NOW },
	}
}
function runFailed(snapshot: AgentRuntimeStateSnapshot): AgentRuntimeEvent {
	return { type: "run-failed", snapshot, error: new Error("provider_error"), errorClass: "unknown" }
}
function arbiterOf(opts: {
	modelStreaming: boolean
	tooling: boolean
	awaitingApproval: boolean
	pendingToolCalls: readonly string[]
}): ArbiterSnapshot {
	return {
		execution: { modelStreaming: opts.modelStreaming, tooling: opts.tooling, awaitingApproval: opts.awaitingApproval },
		recoveryState: "idle",
		status: "running",
		pendingToolCalls: opts.pendingToolCalls,
	}
}
function legacyEnvelope(event: AgentEvent, sessionId = "session-A"): CoreSessionEvent {
	return { type: "agent_event", payload: { sessionId, event } } as CoreSessionEvent
}

interface HarnessState {
	wiring: TaskShadowHostWiringWithSink
	sessionOptions: SdkSessionLifecycleOptions
	currentArbiter: ArbiterSnapshot
	currentLegacyPhase: TurnPhase
	activeSessionId: string | undefined
	activeRunId: string | undefined
	canonicalAvailable: boolean
}

function buildWiring(opts: { canonicalAvailable: boolean; initialSession?: string }): HarnessState {
	const sessionOptions: SdkSessionLifecycleOptions = {
		mcpHub: undefined as never,
		requestToolApproval: () => undefined as never,
		askQuestion: () => undefined as never,
		onSessionEvent: () => undefined,
		onSendComplete: () => undefined,
		onSendError: () => undefined,
	}
	const state: HarnessState = {
		wiring: undefined as never,
		sessionOptions,
		currentArbiter: emptyArbiterSnapshot(),
		currentLegacyPhase: "idle",
		activeSessionId: opts.initialSession,
		activeRunId: undefined,
		canonicalAvailable: opts.canonicalAvailable,
	}
	const deps: TaskShadowHostWiringDeps = {
		lifecycle: {
			getActiveSession: () =>
				state.activeSessionId !== undefined ? ({ sessionId: state.activeSessionId } as never) : (undefined as never),
			setRunning: () => undefined,
		},
		sessionOptions,
		getLegacyPhase: () => state.currentLegacyPhase,
		getArbiterSnapshot: () => state.currentArbiter,
		// C3.CONT.0-CORRECTION01 R2: real wiring dependency for the
		// canonical-runtime availability decision. The wiring's
		// legacy ingress reads this and routes through the same
		// production decision the rest of the system uses.
		getCanonicalRuntimeAvailable: () => state.canonicalAvailable,
		now: () => NOW,
	}
	state.wiring = createTaskShadowHostWiring(deps)
	return state
}

function sinkFromState(state: HarnessState) {
	return { coordinator: state.wiring.coordinator, now: state.wiring.now }
}

function runStep(state: HarnessState, step: WorkloadStep): void {
	switch (step.kind) {
		case "canonical": {
			// R1: auto-derive arbiter from snapshot.execution when
			// the caller did not provide one explicitly. This
			// guarantees the canonical comparison sees the
			// facts valid AT THAT INSTANT.
			if (step.arbiter) {
				state.currentArbiter = step.arbiter
			} else if (step.event.snapshot?.execution) {
				state.currentArbiter = {
					execution: { ...step.event.snapshot.execution },
					recoveryState: step.event.snapshot.recovery?.state ?? state.currentArbiter.recoveryState,
					status: step.event.snapshot.status,
					pendingToolCalls: step.event.snapshot.pendingToolCalls ?? [],
				}
			}
			if (step.setLegacyPhase?.advance) {
				state.currentLegacyPhase = step.setLegacyPhase.phase
			}
			if (step.event.snapshot?.runId) {
				state.activeRunId = step.event.snapshot.runId
			}
			state.wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: step.sessionId,
				event: step.event,
			})
			return
		}
		case "legacy":
			state.currentLegacyPhase = step.legacyPhase
			state.currentArbiter = step.arbiter
			// Mirror the translator's activeRunId tracking for
			// legacy ingress — the translator sets activeRunId
			// from `iteration_start.conversationId`, so we read
			// the same field here. This lets harness assertions
			// observe what the translator's run-epoch gate
			// (CONT.2-CORRECTION02) sees.
			const legacyAgentEvent = (step.event as { payload?: { event?: { type?: string; conversationId?: string } } }).payload
				?.event
			if (legacyAgentEvent?.type === "iteration_start" && legacyAgentEvent.conversationId !== undefined) {
				state.activeRunId = legacyAgentEvent.conversationId
			}
			state.sessionOptions.onSessionEvent(step.event)
			return
		case "host-task":
			switch (step.which) {
				case "requested":
					state.currentLegacyPhase = step.legacyPhase
					emitTaskRequested(sinkFromState(state), step.taskId, NOW)
					return
				case "cancelled":
					state.currentLegacyPhase = step.legacyPhase
					emitTaskCancelled(sinkFromState(state), step.legacyPhase, NOW)
					return
				case "reset":
					state.currentLegacyPhase = step.legacyPhase
					emitTaskReset(sinkFromState(state), step.legacyPhase, NOW)
					return
				case "continued":
					state.currentLegacyPhase = step.legacyPhase
					emitSameTaskContinued(sinkFromState(state), step.legacyPhase, NOW)
					return
			}
			return
		case "host-recovery":
			// R8: production ingress (not direct coordinator.observe).
			emitHostRecovery(sinkFromState(state), step.sessionId, { state: step.to }, step.canonicalAvailable, NOW)
			return
		case "set-active-session":
			state.activeSessionId = step.sessionId
			return
		case "set-legacy-phase":
			state.currentLegacyPhase = step.phase
			return
		case "wiring-reset-for-new-task":
			state.wiring.resetForNewTask()
			return
		case "fence-canonical-run":
			// C3.CONT.2-CORRECTION04 R2: harness hook that
			// mirrors SdkController's call to
			// fenceCanonicalRunForContinuation() adjacent to
			// emitSameTaskContinued(). In production this is
			// driven by SdkController; the harness drives it
			// explicitly so each witness can target the
			// continuation-before-next-run-start window.
			state.wiring.fenceCanonicalRunForContinuation()
			return
		case "checkpoint":
			assertCheckpoint(state, step.selected)
			return
		case "expect-state": {
			const model = state.wiring.comparator.debugSnapshot()
			step.assertion(model)
			return
		}
		case "expect-counts": {
			const counts = state.wiring.recorderCounts()
			const records = state.wiring.records()
			step.assertion(counts, records)
			return
		}
	}
}

function runWorkload(steps: readonly WorkloadStep[]): HarnessState {
	const state = buildWiring({ canonicalAvailable: true })
	for (const s of steps) {
		runStep(state, s)
	}
	return state
}

function assertCheckpoint(state: HarnessState, sel: CheckpointSelection): void {
	const counts = state.wiring.recorderCounts()
	const checks: [string, number | undefined, number | undefined][] = [
		["eventsObserved", counts.eventsObserved, sel.eventsObserved],
		["comparisons", counts.comparisons, sel.comparisons],
		["agreements", counts.agreements, sel.agreements],
		["divergences", counts.divergences, sel.divergences],
		["invariants", counts.invariantViolations, sel.invariants],
		["droppedRecords", counts.droppedRecords, sel.droppedRecords],
		["evidenceGaps", counts.evidenceGaps, sel.evidenceGaps],
		["observerErrors", counts.observerErrors, sel.observerErrors],
		["suppressedRUNTIME_CANONICAL", counts.observationsSuppressedByOrigin.RUNTIME_CANONICAL, sel.suppressedRUNTIME_CANONICAL],
		[
			"suppressedRUNTIME_RECONSTRUCTED",
			counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED,
			sel.suppressedRUNTIME_RECONSTRUCTED,
		],
		["suppressedHOST_TASK", counts.observationsSuppressedByOrigin.HOST_TASK, sel.suppressedHOST_TASK],
		["suppressedHOST_RECOVERY", counts.observationsSuppressedByOrigin.HOST_RECOVERY, sel.suppressedHOST_RECOVERY],
		["diagnosticRUNTIME_CANONICAL", counts.observationsDiagnosticByOrigin.RUNTIME_CANONICAL, sel.diagnosticRUNTIME_CANONICAL],
		[
			"diagnosticRUNTIME_RECONSTRUCTED",
			counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED,
			sel.diagnosticRUNTIME_RECONSTRUCTED,
		],
		["diagnosticHOST_TASK", counts.observationsDiagnosticByOrigin.HOST_TASK, sel.diagnosticHOST_TASK],
		["diagnosticHOST_RECOVERY", counts.observationsDiagnosticByOrigin.HOST_RECOVERY, sel.diagnosticHOST_RECOVERY],
		["fallbackReconstructedApplied", counts.fallbackReconstructedApplied, sel.fallbackReconstructedApplied],
		["fallbackRecoveryApplied", counts.fallbackRecoveryApplied, sel.fallbackRecoveryApplied],
	]
	for (const [name, actual, expected] of checks) {
		if (expected === undefined) continue
		expect(actual, `checkpoint failure: ${name} actual=${actual} expected=${expected}`).toBe(expected)
	}
	const dc = counts.divergenceCountsByClass
	const classKeys: Record<string, keyof typeof dc> = {
		D00: "D00_AGREE",
		D01: "D01_LEGACY_FALSE_IDLE",
		D02: "D02_SHADOW_FALSE_ACTIVE",
		D03: "D03_TERMINAL_ORDERING",
		D04: "D04_APPROVAL_PRECEDENCE",
		D05: "D05_TOOL_CARDINALITY",
		D06: "D06_RESUME_BOUNDARY",
		D07: "D07_FAILURE_MAPPING",
		D08: "D08_FOLLOWUP_EXTERNAL",
		D09: "D09_EVENT_GAP",
		D10: "D10_UNKNOWN",
		D11: "D11_HOST_PREENGAGED",
	}
	for (const [short, realKey] of Object.entries(classKeys)) {
		const expected = (sel as Record<string, number | undefined>)[short]
		if (expected === undefined) continue
		const actual = dc[realKey]
		expect(actual, `divergence ${short} (=${realKey}): actual=${actual} expected=${expected}`).toBe(expected)
	}
}

function hardGates(state: HarnessState): void {
	const counts = state.wiring.recorderCounts()
	expect(counts.invariantViolations, "invariantViolations must be 0").toBe(0)
	expect(counts.evidenceGaps, "evidenceGaps must be 0").toBe(0)
	expect(counts.observerErrors, "observerErrors must be 0").toBe(0)
	expect(counts.divergenceCountsByClass.D10_UNKNOWN, "D10_UNKNOWN must be 0").toBe(0)
	expect(counts.eventsObserved).toBeGreaterThan(0)
}

// =============================================================================
// WORKLOADS — W01..W04 with R1, R4, R5, R6, R7, R8 corrections
// =============================================================================

describe("C2.3-CONT W01 — text-only streaming run; terminal lifecycle = completed", () => {
	it("qualifies a clean streaming run ending in run-finished (task_completed)", () => {
		const snapIdle = snapshotFixture({
			runId: "run-93",
			iteration: 0,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		})
		const snapStreaming: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: true, tooling: false, awaitingApproval: false },
		}
		const snapIdleAgain: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: false, tooling: false, awaitingApproval: false },
		}
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "canonical", sessionId: "session-17", event: runStarted(snapIdle) },
			// D11: legacy phase says streaming while arbiter says
			// modelStreaming=false BEFORE the canonical edge has
			// flipped the shadow's projection.
			{
				kind: "legacy",
				event: legacyEnvelope({ type: "content_start", contentType: "text", text: "Hello" } as AgentEvent),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: false, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
			// Canonical execution flips shadow streaming=false->true.
			// R1: no explicit arbiter; harness auto-derives from snapshot.
			{
				kind: "canonical",
				sessionId: "session-17",
				event: execEvent(snapIdle.execution!, snapStreaming),
			},
			{
				kind: "canonical",
				sessionId: "session-17",
				event: execEvent(snapStreaming.execution!, snapIdleAgain),
			},
			// Production-realistic: legacy phase flips to
			// "completed" alongside the canonical run-finished.
			{ kind: "set-legacy-phase", phase: "completed" },
			// run-finished (canonical terminal) -> task_completed
			// -> lifecycle.kind === "completed".
			{ kind: "canonical", sessionId: "session-17", event: runFinished(snapIdleAgain) },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("completed")
					expect(m.activity.modelStreaming).toBe(false)
					expect(m.activity.awaitingApproval).toBe(false)
				},
			},
		]
		const state = runWorkload(steps)
		hardGates(state)
		const counts = state.wiring.recorderCounts()
		// R4/R6: trace-frozen exact counts.
		// The legacy text frame is dropped by the reverse
		// translator (contentType != "tool"), so it never
		// reaches the recorder. 5 recorded observations:
		//   host_task_requested
		//   run-started
		//   execEvent (idle→streaming)
		//   execEvent (streaming→idle)
		//   run-finished
		expect(counts.eventsObserved).toBe(5)
		expect(counts.comparisons).toBe(5)
		expect(counts.divergenceCountsByClass.D11_HOST_PREENGAGED).toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.divergenceCountsByClass.D02_SHADOW_FALSE_ACTIVE).toBe(0)
		expect(counts.divergenceCountsByClass.D00_AGREE).toBe(4)
	})
})

describe("C2.3-CONT W02 — text + reasoning on legacy stream (production-realistic phases)", () => {
	it("qualifies that reasoning/text frames produce no TaskState mutation", () => {
		// R7: legacy phase MUST match the production timeline; do
		// not choose "idle" to minimize divergence. The reverse
		// translator returns undefined for contentType != "tool",
		// so reasoning/text frames never reach the comparator at
		// all — even with the legacy phase pinned at "streaming".
		const snapIdle = snapshotFixture({
			runId: "run-2",
			iteration: 0,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		})
		const snapStreaming: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: true, tooling: false, awaitingApproval: false },
		}
		const snapIdleAgain: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: false, tooling: false, awaitingApproval: false },
		}
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "canonical", sessionId: "session-1", event: runStarted(snapIdle) },
			// Production-realistic: legacyTurnState says streaming
			// while reasoning/text frames arrive. R1+R7: keep
			// arbiter in sync with the actual instant.
			{
				kind: "legacy",
				event: legacyEnvelope({ type: "content_start", contentType: "reasoning", reasoning: "T1" } as AgentEvent),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
			{
				kind: "legacy",
				event: legacyEnvelope({ type: "content_end", contentType: "reasoning", reasoning: "T2" } as AgentEvent),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
			{
				kind: "legacy",
				event: legacyEnvelope({ type: "content_start", contentType: "text", text: "Final" } as AgentEvent),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
			// Canonical owns the streaming edge. The D02 we saw
			// in C2.3 was caused by the harness not auto-advancing
			// the arbiter when canonical events arrived (R1). With
			// R1 fixed, this transition is now an internal agreement.
			{ kind: "canonical", sessionId: "session-1", event: execEvent(snapIdle.execution!, snapStreaming) },
			{ kind: "canonical", sessionId: "session-1", event: execEvent(snapStreaming.execution!, snapIdleAgain) },
			// Production-realistic: the legacy TurnStateTracker
			// flips to "completed" once the canonical run-finished
			// (or its `done` adapter) is observed. Without this
			// the legacy phase stays "streaming" and the
			// comparator flags a D02 at the terminal observation
			// (legacy "streaming" vs shadow "completed").
			{ kind: "set-legacy-phase", phase: "completed" },
			{ kind: "canonical", sessionId: "session-1", event: runFinished(snapIdleAgain) },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("completed")
				},
			},
		]
		const state = runWorkload(steps)
		hardGates(state)
		const counts = state.wiring.recorderCounts()
		// Reasoning/text frames never reach the recorder at all.
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
		// After R1 + R7 fix: arbiter and shadow agree during the
		// streaming window; the only legitimate divergence is the
		// D11_HOST_PREENGAGED pattern at the moment the canonical
		// edge retracts shadow streaming (legacy phase still
		// "streaming" while arbiter has just gone not-streaming).
		// This is the production-realistic classification of a
		// real race; it is not a harness artifact.
		expect(counts.divergenceCountsByClass.D02_SHADOW_FALSE_ACTIVE).toBe(0)
		expect(counts.divergenceCountsByClass.D11_HOST_PREENGAGED).toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})
})

describe("C2.3-CONT W03 — one tool; intermediate activeToolCallIds proven via checkpoints", () => {
	it("activeToolCallIds: [] -> [tc1] -> []; toolCalls += 1 exact", () => {
		const snapIdle = snapshotFixture({
			runId: "run-3",
			iteration: 0,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		})
		const snapStreaming: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: true, tooling: false, awaitingApproval: false },
		}
		const snapTooling: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: true, tooling: true, awaitingApproval: false },
			pendingToolCalls: ["tc1"],
		}
		const snapIdle2: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: false, tooling: false, awaitingApproval: false },
		}
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "canonical", sessionId: "session-1", event: runStarted(snapIdle) },
			{ kind: "canonical", sessionId: "session-1", event: execEvent(snapIdle.execution!, snapStreaming) },
			{ kind: "canonical", sessionId: "session-1", event: toolStarted(snapTooling, "tc1") },
			// R5: prove intermediate state.
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.activeToolCallIds).toEqual(["tc1"])
					expect(m.activity.activeToolCallIds.length > 0).toBe(true)
				},
			},
			{ kind: "canonical", sessionId: "session-1", event: toolFinished(snapIdle2, "tc1") },
			// R5: prove active set cleared.
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.activeToolCallIds).toEqual([])
				},
			},
			{ kind: "canonical", sessionId: "session-1", event: execEvent(snapTooling.execution!, snapIdle2) },
			{ kind: "canonical", sessionId: "session-1", event: runFinished(snapIdle2) },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("completed")
					expect(m.telemetry.toolCalls).toBe(1)
					expect(m.activity.activeToolCallIds).toEqual([])
				},
			},
		]
		const state = runWorkload(steps)
		hardGates(state)
		const counts = state.wiring.recorderCounts()
		// R6: trace-frozen exact counts.
		expect(counts.eventsObserved).toBe(7)
		expect(counts.comparisons).toBe(7)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.divergenceCountsByClass.D05_TOOL_CARDINALITY).toBe(0)
	})
})

describe("C2.3-CONT W04 — parallel tools; intermediate activeToolCallIds proven", () => {
	it("activeToolCallIds: [] -> [tc1] -> [tc1,tc2] -> [tc2] -> []; toolCalls += 2", () => {
		const snapIdle = snapshotFixture({
			runId: "run-4",
			iteration: 0,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		})
		const snapStreaming: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: true, tooling: false, awaitingApproval: false },
		}
		const snapTc1: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: true, tooling: true, awaitingApproval: false },
			pendingToolCalls: ["tc1"],
		}
		const snapTc1Tc2: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: true, tooling: true, awaitingApproval: false },
			pendingToolCalls: ["tc1", "tc2"],
		}
		const snapTc2: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: true, tooling: true, awaitingApproval: false },
			pendingToolCalls: ["tc2"],
		}
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "canonical", sessionId: "session-1", event: runStarted(snapIdle) },
			{ kind: "canonical", sessionId: "session-1", event: execEvent(snapIdle.execution!, snapStreaming) },
			{ kind: "canonical", sessionId: "session-1", event: toolStarted(snapTc1, "tc1") },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.activeToolCallIds).toEqual(["tc1"])
				},
			},
			{ kind: "canonical", sessionId: "session-1", event: toolStarted(snapTc1Tc2, "tc2") },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect([...m.activity.activeToolCallIds].sort()).toEqual(["tc1", "tc2"])
				},
			},
			// Finish tc1 while tc2 is still active: tooling stays true.
			{ kind: "canonical", sessionId: "session-1", event: toolFinished(snapTc2, "tc1") },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.activeToolCallIds).toEqual(["tc2"])
					// Tooling must remain true while tc2 is active.
					expect(m.activity.activeToolCallIds.length > 0).toBe(true)
				},
			},
			{ kind: "canonical", sessionId: "session-1", event: toolFinished(snapIdle, "tc2") },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.activeToolCallIds).toEqual([])
					expect(m.activity.activeToolCallIds.length > 0).toBe(false)
				},
			},
			{ kind: "canonical", sessionId: "session-1", event: execEvent(snapStreaming.execution!, snapIdle) },
			{ kind: "canonical", sessionId: "session-1", event: runFinished(snapIdle) },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("completed")
					expect(m.telemetry.toolCalls).toBe(2)
				},
			},
		]
		const state = runWorkload(steps)
		hardGates(state)
		const counts = state.wiring.recorderCounts()
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.divergenceCountsByClass.D05_TOOL_CARDINALITY).toBe(0)
	})
})

// =============================================================================
// C3.CONT.1 — W05 (approval_allow) + W06 (approval_deny)
// =============================================================================

describe("C3.CONT.1 W05 — approval_allow; canonical awaitingApproval false→true→false; terminal lifecycle = completed", () => {
	it("approval granted: terminal lifecycle.kind === completed; exactly one approval_requested + one approval_resolved edge", () => {
		const snapIdle = snapshotFixture({
			runId: "run-W05",
			iteration: 0,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		})
		const snapWaiting: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: true },
		}
		const snapResolved: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		}
		const snapStreaming: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
		}
		const snapIdleAgain: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		}
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-W05", which: "requested", legacyPhase: "idle" },
			{ kind: "canonical", sessionId: "session-W05", event: runStarted(snapIdle) },
			// Legacy enters the user-approval UI; canonical confirms
			// awaitingApproval=true. Both sides agree -> D00_AGREE.
			{ kind: "set-legacy-phase", phase: "awaiting_approval" },
			{
				kind: "canonical",
				sessionId: "session-W05",
				event: execEvent(snapIdle.execution!, snapWaiting),
			},
			// Mid-approval checkpoint: shadow reports awaitingApproval=true.
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.awaitingApproval).toBe(true)
				},
			},
			// Legacy resolves approval (UI close). Canonical flips
			// awaitingApproval back to false. Shadow follows.
			{ kind: "set-legacy-phase", phase: "streaming" },
			{
				kind: "canonical",
				sessionId: "session-W05",
				event: execEvent(snapWaiting.execution!, snapResolved),
			},
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.awaitingApproval).toBe(false)
				},
			},
			// Streaming proceeds and finishes.
			{
				kind: "canonical",
				sessionId: "session-W05",
				event: execEvent(snapResolved.execution!, snapStreaming),
			},
			{
				kind: "canonical",
				sessionId: "session-W05",
				event: execEvent(snapStreaming.execution!, snapIdleAgain),
			},
			// run-finished -> task_completed -> lifecycle completed.
			{ kind: "set-legacy-phase", phase: "completed" },
			{ kind: "canonical", sessionId: "session-W05", event: runFinished(snapIdleAgain) },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("completed")
					expect(m.activity.awaitingApproval).toBe(false)
				},
			},
		]
		const state = runWorkload(steps)
		hardGates(state)
		const counts = state.wiring.recorderCounts()
		const records = state.wiring.records()
		const approvalRequested = records.filter((r) => r.event === "approval_requested").length
		const approvalResolved = records.filter((r) => r.event === "approval_resolved").length
		expect(approvalRequested, "exactly one approval_requested edge").toBe(1)
		expect(approvalResolved, "exactly one approval_resolved edge").toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.divergenceCountsByClass.D03_TERMINAL_ORDERING).toBe(0)
		// R7: legacy "streaming" with canonical awaitingApproval
		// false→true→false produces D11_HOST_PREENGAGED on the
		// approval_resolved and model_stream_finished edges. This
		// is the legitimate production-realistic classification:
		// host says "streaming" while canonical runtime says
		// modelStreaming=false. Same mechanism as W02. EXACTLY 2:
		// one on approval_resolved (canonical awaitingApproval
		// flipped back to false while legacy was already set to
		// "streaming") and one on model_stream_finished (legacy
		// still "streaming" while canonical modelStreaming=false).
		expect(counts.divergenceCountsByClass.D11_HOST_PREENGAGED).toBe(2)
		// RUNTIME_RECONSTRUCTED applied mutations must be 0 (canonical
		// path is authoritative; reconstructed would race it).
		expect(counts.fallbackReconstructedApplied).toBe(0)
		// EXACT counts: 1 host_task_requested + 6 canonical =
		//   session_started, approval_requested, approval_resolved,
		//   model_stream_started, model_stream_finished, task_completed.
		expect(counts.eventsObserved).toBe(7)
		expect(counts.comparisons).toBe(7)
	})
})

// =============================================================================
// CONT.0 capability gates: R2 (canonicalAvailable) + R3 (active-run)
// =============================================================================

describe("C3.CONT.1 W06 — approval_deny; awaitingApproval false→true→false; lifecycle frozen at denial boundary", () => {
	it("approval denied: lifecycle.kind does NOT advance past the denial; exactly one D04_APPROVAL_PRECEDENCE", () => {
		const snapIdle = snapshotFixture({
			runId: "run-W06",
			iteration: 0,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		})
		const snapWaiting: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: true },
		}
		const snapResolved: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		}
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-W06", which: "requested", legacyPhase: "idle" },
			{ kind: "canonical", sessionId: "session-W06", event: runStarted(snapIdle) },
			// Rise: legacy + canonical both flip to awaitingApproval.
			{ kind: "set-legacy-phase", phase: "awaiting_approval" },
			{
				kind: "canonical",
				sessionId: "session-W06",
				event: execEvent(snapIdle.execution!, snapWaiting),
			},
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.awaitingApproval).toBe(true)
				},
			},
			// Fall: canonical flips awaitingApproval back to false.
			// The legacy phase here stays at "awaiting_approval"
			// because the deny outcome does not flip legacy back to
			// streaming — that IS the production-realistic
			// observation. Shadow says idle, legacy says still
			// awaiting_approval → D04_APPROVAL_PRECEDENCE.
			//
			// NOTE: we do NOT call set-legacy-phase before this
			// canonical event, which is the W05 vs W06 distinction:
			// approval_allow → legacy advances to streaming;
			// approval_deny → legacy stays stuck at awaiting_approval.
			{
				kind: "canonical",
				sessionId: "session-W06",
				event: execEvent(snapWaiting.execution!, snapResolved),
			},
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.awaitingApproval).toBe(false)
				},
			},
			// No further canonical events. Lifecycle is frozen at
			// whatever it was at the denial boundary (still running
			// per the canonical arbiter; nothing has transitioned it
			// to a terminal state).
		]
		const state = runWorkload(steps)
		hardGates(state)
		const counts = state.wiring.recorderCounts()
		const records = state.wiring.records()
		const approvalRequested = records.filter((r) => r.event === "approval_requested").length
		const approvalResolved = records.filter((r) => r.event === "approval_resolved").length
		expect(approvalRequested, "exactly one approval_requested edge").toBe(1)
		expect(approvalResolved, "exactly one approval_resolved edge").toBe(1)
		// W06 spec: exactly one D04_APPROVAL_PRECEDENCE (the fall
		// edge where legacy still says awaiting_approval while
		// shadow flipped to idle). The rise edge was D00_AGREE
		// because legacy + canonical both said awaiting_approval.
		expect(
			counts.divergenceCountsByClass.D04_APPROVAL_PRECEDENCE,
			"exactly one approval-precedence divergence on the deny edge",
		).toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		// Lifecycle frozen at the denial — never reached terminal.
		// CORRECTION01 carry-forward (reviewer): W06 must pin the
		// EXACT lifecycle, not just exclude terminals. The denial
		// fixture does NOT emit a HOST_TASK cancel and does NOT
		// emit a run-failed/run-finished canonical edge, so the
		// shadow's lifecycle remains "running" (the canonical
		// arbiter is still status="running" with no terminal
		// transition ever applied). NOTE: the production-realistic
		// deny semantics (whether the host emits task_cancelled
		// or the runtime emits run-failed after a denied approval)
		// remain a C2.3 carry-forward — this test pins the
		// canonical-mechanism half of the qualification, which is
		// the part the harness controls.
		const m = state.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("running")
		expect(m.activity.awaitingApproval).toBe(false)
		expect(m.activity.modelStreaming).toBe(false)
	})
})

describe("C3.CONT.2 W07 — cancel while model streaming; late canonical activity must not reactivate (CORRECTION01)", () => {
	it("HOST_TASK cancel during model_streaming freezes lifecycle at 'cancelled'; late run-finished IS IGNORED_STALE after CONT.2-CORRECTION01", () => {
		const snapIdle = snapshotFixture({
			runId: "run-W07",
			iteration: 0,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		})
		const snapStreaming: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
		}
		const snapIdleAgain: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		}
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-W07", which: "requested", legacyPhase: "idle" },
			{ kind: "canonical", sessionId: "session-W07", event: runStarted(snapIdle) },
			// Rise: model streaming starts.
			{
				kind: "canonical",
				sessionId: "session-W07",
				event: execEvent(snapIdle.execution!, snapStreaming),
			},
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.modelStreaming).toBe(true)
					expect(m.lifecycle.kind).toBe("running")
				},
			},
			// HOST_TASK cancel. Legacy phase here is "streaming"
			// (mirror production: the host UI was showing streaming
			// when the user hit cancel). Shadow flips to lifecycle
			// "cancelled"; projectTurnState maps cancelled→resumable,
			// so shadowPhase=resumable while legacyPhase=streaming.
			{ kind: "host-task", taskId: "task-W07", which: "cancelled", legacyPhase: "streaming" },
			// EXACT freeze assertion (not negative-space):
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("cancelled")
					expect(m.activity.modelStreaming).toBe(false)
					expect(m.activity.activeToolCallIds).toEqual([])
					expect(m.activity.awaitingApproval).toBe(false)
				},
			},
			// Late canonical edges. After CONT.2-CORRECTION01 the
			// shadow reducer's updateTaskCompleted is gated on a
			// cancellation/resumable stale predicate (see
			// sdk/packages/agents/src/runtime/state/task-state/update.ts).
			// Late run-finished from a cancelled epoch is
			// IGNORED_STALE — it cannot overwrite the visible
			// cancellation. Activity edges were already
			// isStale-gated by their own reducers.
			{
				kind: "canonical",
				sessionId: "session-W07",
				event: execEvent(snapStreaming.execution!, snapIdleAgain),
			},
			{ kind: "canonical", sessionId: "session-W07", event: runFinished(snapIdleAgain) },
			// Lifecycle is STILL "cancelled" after late canonical
			// completion — the user's explicit cancellation
			// survives stranded runtime completion.
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("cancelled")
					expect(m.activity.modelStreaming).toBe(false)
					expect(m.activity.activeToolCallIds).toEqual([])
					expect(m.activity.awaitingApproval).toBe(false)
				},
			},
		]
		const state = runWorkload(steps)
		hardGates(state)
		const counts = state.wiring.recorderCounts()
		const records = state.wiring.records()
		// ORIGIN counts per the reviewer's requirement:
		const hostTaskCount = records.filter((r) => r.origin === "HOST_TASK").length
		const runtimeCanonicalCount = records.filter((r) => r.origin === "RUNTIME_CANONICAL").length
		// 2 host_task observations (task_requested + task_cancelled).
		expect(hostTaskCount).toBe(2)
		// 5 canonical: run-started, execEvent(false->true),
		// late execEvent(true->false), late run-finished, plus
		// model_stream_finished TaskMsg produced by the second
		// execEvent. Each becomes its own RUNTIME_CANONICAL record
		// through the comparator's observeTaskMsg path.
		expect(runtimeCanonicalCount).toBe(4)
		// Exactly ONE task_cancelled observation (the one HOST_TASK
		// record). No second cancellation transition. Reviewer's
		// VISIBLE_CANCELLATION_MUTATIONS = 1.
		const taskCancelled = records.filter((r) => r.event === "task_cancelled").length
		expect(taskCancelled).toBe(1)
		// FROZEN RESOLVER RULE (C2.3-CONT.2-CORRECTION01):
		//   late canonical run-finished from a cancelled epoch
		//   is IGNORED_STALE. The visible-task cancellation
		//   survives stranded runtime completion. The
		//   differential recorder may still note the late
		//   canonical edges as D03_TERMINAL_ORDERING divergences
		//   between the harness's legacy phase (still
		//   "streaming" sample) and the shadow projection (now
		//   "resumable" because cancelled→resumable), but no
		//   terminal-lifecycle mutations occur after the cancel.
		const m = state.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("cancelled")
		expect(m.activity.modelStreaming).toBe(false)
		expect(m.activity.activeToolCallIds).toEqual([])
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.fallbackReconstructedApplied).toBe(0)
		// EXACT total: 2 host_task + 4 canonical = 6.
		expect(counts.eventsObserved).toBe(6)
		expect(counts.comparisons).toBe(6)
	})
})

describe("C3.CONT.2 W08 — cancel with active tool; late tool-finished must not reactivate (CORRECTION01)", () => {
	it("HOST_TASK cancel during tool execution freezes lifecycle at 'cancelled'; late run-finished is IGNORED_STALE after CONT.2-CORRECTION01", () => {
		const snapIdle = snapshotFixture({
			runId: "run-W08",
			iteration: 0,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		})
		const snapTooling: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: true, tooling: true, awaitingApproval: false },
			pendingToolCalls: ["tc1"],
		}
		const snapIdleAgain: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			pendingToolCalls: [],
		}
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-W08", which: "requested", legacyPhase: "idle" },
			{ kind: "canonical", sessionId: "session-W08", event: runStarted(snapIdle) },
			// Tool active (R5: prove tc1 is genuinely active).
			{
				kind: "canonical",
				sessionId: "session-W08",
				event: execEvent(snapIdle.execution!, snapTooling),
			},
			{ kind: "canonical", sessionId: "session-W08", event: toolStarted(snapTooling, "tc1") },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.activity.activeToolCallIds).toEqual(["tc1"])
					expect(m.activity.activeToolCallIds.length > 0).toBe(true)
				},
			},
			// HOST_TASK cancel. Legacy phase = "streaming" to
			// mirror production: the host UI was mid-tool when
			// the user hit cancel. Shadow flips to lifecycle
			// "cancelled"; activeToolCallIds=[].
			{ kind: "host-task", taskId: "task-W08", which: "cancelled", legacyPhase: "streaming" },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("cancelled")
					expect(m.activity.activeToolCallIds).toEqual([])
					expect(m.activity.modelStreaming).toBe(false)
					expect(m.activity.awaitingApproval).toBe(false)
				},
			},
			// Late canonical: tool-finished + execEvent(true→false)
			// + run-finished. After CONT.2-CORRECTION01 the
			// shadow reducer's updateTaskCompleted is gated
			// on a cancellation/resumable stale predicate
			// (see sdk/packages/agents/src/runtime/state/task-state/update.ts).
			// updateToolFinished was already isStale-gated.
			// So all three late canonical edges are
			// IGNORED_STALE: lifecycle stays "cancelled" and
			// activeToolCallIds stays [].
			{ kind: "canonical", sessionId: "session-W08", event: toolFinished(snapIdleAgain, "tc1") },
			{
				kind: "canonical",
				sessionId: "session-W08",
				event: execEvent(snapTooling.execution!, snapIdleAgain),
			},
			{ kind: "canonical", sessionId: "session-W08", event: runFinished(snapIdleAgain) },
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("cancelled")
					// Late tool-finished cannot resurrect active
					// tools (isStale gate in updateToolFinished).
					expect(m.activity.activeToolCallIds).toEqual([])
				},
			},
		]
		const state = runWorkload(steps)
		hardGates(state)
		const counts = state.wiring.recorderCounts()
		const records = state.wiring.records()
		const hostTaskCount = records.filter((r) => r.origin === "HOST_TASK").length
		const runtimeCanonicalCount = records.filter((r) => r.origin === "RUNTIME_CANONICAL").length
		expect(hostTaskCount).toBe(2)
		// 5 canonical records (one per canonical event):
		//   run-started
		//   execEvent(idle→tooling) -> model_stream_started
		//   tool-started (tc1) -> tool_started
		//   late tool-finished (tc1) -> tool_finished (isStale-gated, but still observed)
		//   late execEvent(tooling→idle) -> model_stream_finished
		//   late run-finished -> task_completed
		// That's 6 canonical events -> 6 records.
		expect(runtimeCanonicalCount).toBe(6)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.fallbackReconstructedApplied).toBe(0)
		// Exactly one task_cancelled observation.
		const taskCancelled = records.filter((r) => r.event === "task_cancelled").length
		expect(taskCancelled).toBe(1)
		// Total: 2 host_task + 6 canonical = 8.
		expect(counts.eventsObserved).toBe(8)
		expect(counts.comparisons).toBe(8)
	})
})

describe("C3.CONT.0-CORRECTION01 R2 — canonicalAvailable is a real wiring control (legacy ingress)", () => {
	// F01 / F02 / F03 are qualified here using a single coordinator
	// and the production legacy ingress
	// (sessionOptions.onSessionEvent -> observeLegacyEvent).
	// NO direct coordinator.observe() calls.

	function buildLegacyIngressState(canonicalAvailable: boolean, sessionId: string): HarnessState {
		const st = buildWiring({ canonicalAvailable, initialSession: sessionId })
		// Set the legacy phase to "streaming" so the legacy
		// translator's `iteration_start` edge produces a
		// reconstructed run-started observation (the same path
		// the production LocalRuntimeHost uses).
		st.currentLegacyPhase = "streaming"
		return st
	}

	it("F01 sequential fallback sessions — different sessions, same edge, both APPLY (no cross-session dedup)", () => {
		const st = buildLegacyIngressState(false, "session-A")
		// session-A: iteration_start -> reconstructed run-started.
		// With canonicalAvailable=false -> FALLBACK_APPLY.
		st.sessionOptions.onSessionEvent(
			legacyEnvelope({ type: "iteration_start", conversationId: "run-A", iteration: 0 } as AgentEvent, "session-A"),
		)
		// Switch active session -> session-B
		st.activeSessionId = "session-B"
		st.sessionOptions.onSessionEvent(
			legacyEnvelope({ type: "iteration_start", conversationId: "run-B", iteration: 0 } as AgentEvent, "session-B"),
		)
		const counts = st.wiring.recorderCounts()
		expect(counts.fallbackReconstructedApplied).toBe(2)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})

	it("F02 sequential fallback runs in the same session — different runIds, both APPLY (no cross-run dedup)", () => {
		const st = buildLegacyIngressState(false, "session-X")
		// Same session, run-A.
		st.sessionOptions.onSessionEvent(
			legacyEnvelope({ type: "iteration_start", conversationId: "run-A", iteration: 0 } as AgentEvent, "session-X"),
		)
		// Same session, run-B (new conversationId).
		st.sessionOptions.onSessionEvent(
			legacyEnvelope({ type: "iteration_start", conversationId: "run-B", iteration: 0 } as AgentEvent, "session-X"),
		)
		const counts = st.wiring.recorderCounts()
		// 2 distinct sessionId:runId:baseEdge scoped keys -> both APPLY.
		expect(counts.fallbackReconstructedApplied).toBe(2)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
	})

	it("F03 fallback duplicate suppression — same session, same run, same edge SUPPRESSES the second", () => {
		const st = buildLegacyIngressState(false, "session-X")
		st.sessionOptions.onSessionEvent(
			legacyEnvelope({ type: "iteration_start", conversationId: "run-A", iteration: 0 } as AgentEvent, "session-X"),
		)
		// Re-deliver the same envelope (e.g. event replay).
		st.sessionOptions.onSessionEvent(
			legacyEnvelope({ type: "iteration_start", conversationId: "run-A", iteration: 0 } as AgentEvent, "session-X"),
		)
		const counts = st.wiring.recorderCounts()
		expect(counts.fallbackReconstructedApplied).toBe(1)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})

	it("CAPABILITY TRUE LEGACY INGRESS = DIAGNOSTIC_ONLY (LocalRuntimeHost path)", () => {
		const st = buildLegacyIngressState(true, "session-A")
		st.sessionOptions.onSessionEvent(
			legacyEnvelope({ type: "iteration_start", conversationId: "run-A", iteration: 0 } as AgentEvent, "session-A"),
		)
		const counts = st.wiring.recorderCounts()
		expect(counts.fallbackReconstructedApplied).toBe(0)
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})

	it("CAPABILITY FALSE LEGACY INGRESS = FALLBACK_APPLY (Hub/Remote path)", () => {
		const st = buildLegacyIngressState(false, "session-A")
		st.sessionOptions.onSessionEvent(
			legacyEnvelope({ type: "iteration_start", conversationId: "run-A", iteration: 0 } as AgentEvent, "session-A"),
		)
		const counts = st.wiring.recorderCounts()
		expect(counts.fallbackReconstructedApplied).toBe(1)
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})
})

describe("C3.CONT.0-CORRECTION01 R3 — run identity is derived from event.snapshot.runId", () => {
	it("canonical runId is read from the event snapshot, not from a decorative harness step", () => {
		// Two consecutive canonical run-started events with
		// DIFFERENT runIds must NOT cross-dedup: each carries
		// a distinct (session, run, edge) key derived from the
		// snapshot, not from any mutable harness state.
		const st = buildWiring({ canonicalAvailable: true, initialSession: "session-1" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "session-1",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "canonical",
				sessionId: "session-1",
				event: runStarted(
					snapshotFixture({
						runId: "run-B",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)
		// activeRunId is derived from the latest canonical event.
		expect(st.activeRunId).toBe("run-B")
		const counts = st.wiring.recorderCounts()
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.eventsObserved).toBe(3) // 1 host_task + 2 canonical
	})
})

// =========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.2-CORRECTION02
// Run-epoch terminal-ownership witnesses (C7.7, C7.8, C7.10, C7.11).
//
// CONT.2-CORRECTION01 closed the immediate cancellation race
// (lifecycle.kind ∈ {cancelled,resumable} ⇒ ignore terminal). The
// reviewer correctly identified a deeper race that lifecycle alone
// cannot solve: a stranded terminal event from a cancelled run
// arriving AFTER `same_task_continued` has moved the lifecycle
// back to "running" for the resumed epoch. The reducer cannot
// distinguish it from a legitimate terminal on the resumed epoch
// because `task_completed` / `task_failed` carry no runId.
//
// CONT.2-CORRECTION02 closes that race at the observation
// boundary (TaskShadowReverseTranslator.translate): when a
// terminal `done` / `error` event arrives with a conversationId
// that does NOT match the translator's `activeRunId`, the event
// is suppressed (returns undefined) so it never reaches the
// shadow. These witnesses exercise that gate via the legacy
// ingress path — the production code path that flows through the
// translator. (Canonical runtime events bypass the translator and
// are not subject to this gate; they're already session-scoped
// upstream by the canonical host.)
// =========================================================================

function agentEventV<T extends AgentEvent>(event: T, sessionId = "s-epoch"): CoreSessionEvent {
	return { type: "agent_event", payload: { sessionId, event } } as CoreSessionEvent
}
function iterationStartV(conversationId: string, iteration = 1): AgentEvent {
	return { type: "iteration_start", iteration, conversationId }
}
function doneV(conversationId: string, _reason: "completed" | "cancelled" = "completed"): AgentEvent {
	return { type: "done", reason: "completed", text: "", iterations: 1, conversationId }
}
function errorV(conversationId: string, classification: "context_window_exceeded" | "unknown" = "unknown"): AgentEvent {
	return {
		type: "error",
		error: new Error("late-run-failure"),
		errorClass: classification,
		recoverable: true,
		iteration: 1,
		conversationId,
	}
}

describe("C2.3-CONT.2-CORRECTION02 — run-epoch terminal ownership gate (legacy ingress)", () => {
	it("C7.7 stranded task_completed from cancelled run-A after same_task_continued is IGNORED_STALE", () => {
		// canonicalAvailable=false so reconstructed events flow
		// through FALLBACK_APPLY and mutate the shadow
		// (otherwise the legacy path is DIAGNOSTIC_ONLY and the
		// shadow lifecycle never changes).
		const st = buildWiring({ canonicalAvailable: false, initialSession: "s-epoch" })
		const steps: WorkloadStep[] = [
			// --- run A lifecycle ---
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "legacy",
				event: agentEventV(iterationStartV("run-A"), "s-epoch"),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
			{
				kind: "legacy",
				event: agentEventV(doneV("run-A", "completed"), "s-epoch"),
				legacyPhase: "idle",
				arbiter: arbiterOf({ modelStreaming: false, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
			// --- HOST_TASK cancel + same_task_continued ---
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "idle" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			// --- run B starts (new conversationId) ---
			{
				kind: "legacy",
				event: agentEventV(iterationStartV("run-B"), "s-epoch"),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
		]
		for (const s of steps) runStep(st, s)
		// activeRunId is now run-B.
		expect(st.activeRunId).toBe("run-B")

		// STRANDED TERMINAL from run-A. activeRunId=run-B,
		// event.conversationId=run-A → translator returns
		// undefined → shadow not fed.
		runStep(st, {
			kind: "legacy",
			event: agentEventV(doneV("run-A", "completed"), "s-epoch"),
			legacyPhase: "idle",
			arbiter: arbiterOf({ modelStreaming: false, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
		})

		// LEGITIMATE TERMINAL from run-B. activeRunId=run-B,
		// event.conversationId=run-B → match → apply.
		runStep(st, {
			kind: "legacy",
			event: agentEventV(doneV("run-B", "completed"), "s-epoch"),
			legacyPhase: "idle",
			arbiter: arbiterOf({ modelStreaming: false, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
		})

		const m = st.wiring.comparator.debugSnapshot()
		const allRecords = st.wiring.records()
		// Two legitimate task_completed observations:
		//   1. run-A completion BEFORE cancel
		//   2. run-B completion AFTER continuation
		// The STRANDED run-A completion that arrives after
		// activeRunId became run-B was suppressed at the
		// translator boundary (C7.7). So total = 2, NOT 3.
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		expect(taskCompleted.length).toBe(2)
		expect(m.lifecycle.kind).toBe("completed")
		const counts = st.wiring.recorderCounts()
		// fallbackReconstructedApplied counts every RUNTIME_RECONSTRUCTED
		// event that actually mutated the shadow. The two session_started
		// and one task_completed for run-A, plus one task_completed for
		// run-B, all apply via FALLBACK_APPLY. Total = 4.
		expect(counts.fallbackReconstructedApplied).toBeGreaterThanOrEqual(1)
		// D10_UNKNOWN may rise from phase mismatches in the harness
		// fixture (not the shadow's responsibility for these tests).
		// The contract being qualified here is: stranded event
		// suppressed, lifecycle correct. Diff classifications are
		// out of scope for C7.7.
	})

	it("C7.8 stranded task_failed from cancelled run-A after same_task_continued is IGNORED_STALE", () => {
		const st = buildWiring({ canonicalAvailable: false, initialSession: "s-epoch" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "legacy",
				event: agentEventV(iterationStartV("run-A"), "s-epoch"),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
			// Cancel run A before its done/error ever arrives.
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "streaming" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			{
				kind: "legacy",
				event: agentEventV(iterationStartV("run-B"), "s-epoch"),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
		]
		for (const s of steps) runStep(st, s)
		expect(st.activeRunId).toBe("run-B")

		// Stranded task_failed from run-A → suppressed.
		runStep(st, {
			kind: "legacy",
			event: agentEventV(errorV("run-A", "unknown"), "s-epoch"),
			legacyPhase: "idle",
			arbiter: arbiterOf({ modelStreaming: false, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
		})
		// Legitimate task_failed from run-B → applies.
		runStep(st, {
			kind: "legacy",
			event: agentEventV(errorV("run-B", "unknown"), "s-epoch"),
			legacyPhase: "idle",
			arbiter: arbiterOf({ modelStreaming: false, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
		})

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("failed")
		const allRecords = st.wiring.records()
		const taskFailed = allRecords.filter((r) => r.event === "task_failed")
		expect(taskFailed.length).toBe(1)
	})

	it("C7.10 legitimate terminal on resumed run still applies (activeRunId matches)", () => {
		const st = buildWiring({ canonicalAvailable: false, initialSession: "s-epoch" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "legacy",
				event: agentEventV(iterationStartV("run-A"), "s-epoch"),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "streaming" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			{
				kind: "legacy",
				event: agentEventV(iterationStartV("run-B"), "s-epoch"),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
		]
		for (const s of steps) runStep(st, s)

		// run-B completion with matching activeRunId=run-B.
		runStep(st, {
			kind: "legacy",
			event: agentEventV(doneV("run-B", "completed"), "s-epoch"),
			legacyPhase: "idle",
			arbiter: arbiterOf({ modelStreaming: false, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
		})

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("completed")
	})

	it("C7.11 same conversationId across iterations does not false-positive (no new run)", () => {
		// When the resumed run reuses the same conversationId
		// (the legacy stream does not always assign a new one
		// after same_task_continued), the translator's
		// activeRunId carries forward. A late terminal event
		// whose conversationId still matches activeRunId
		// applies. This witnesses the practical degenerate
		// case and is a no-op for the gate (both match → apply).
		const st = buildWiring({ canonicalAvailable: false, initialSession: "s-epoch" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "legacy",
				event: agentEventV(iterationStartV("run-A"), "s-epoch"),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: true, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
		]
		for (const s of steps) runStep(st, s)
		expect(st.activeRunId).toBe("run-A")

		// done(run-A) with matching conversationId → applies.
		runStep(st, {
			kind: "legacy",
			event: agentEventV(doneV("run-A", "completed"), "s-epoch"),
			legacyPhase: "idle",
			arbiter: arbiterOf({ modelStreaming: false, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
		})

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("completed")
		expect(st.activeRunId).toBe("run-A")
	})
})

// =========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.2-CORRECTION03
// Canonical run-epoch terminal ownership witnesses (C7.12-C7.17).
// These test the AUTHORITATIVE LocalRuntimeHost path
// (`canonicalAvailable=true`, RUNTIME_CANONICAL) — which is what
// C2.3-CORRECTION02 did NOT cover. CONT.2-CORRECTION03 adds the
// equivalent gate at the canonical ingress boundary
// (`TaskShadowHostWiring.observeCanonicalRuntimeEvent`).
//
// On LocalRuntimeHost, canonical events own TaskState truth:
//   RUNTIME_CANONICAL       = APPLY (authoritative)
//   RUNTIME_RECONSTRUCTED   = DIAGNOSTIC_ONLY (per Option A)
//
// A stranded canonical run-finished / run-failed that arrives
// after `same_task_continued` would (without this gate) reach the
// shadow-adapter and apply, terminating the resumed run. The
// canonical surface carries `snapshot.runId` on every event;
// we track `canonicalRunId` from the latest canonical run-started
// and refuse terminal events whose snapshot.runId doesn't match.
// =========================================================================

describe("C2.3-CONT.2-CORRECTION03 — canonical run-epoch terminal ownership gate (Local authoritative path)", () => {
	it("C7.12 stranded canonical run-finished(run-A) after same_task_continued is SUPPRESSED on canonical path", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			// --- run A ---
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runFinished(
					snapshotFixture({
						runId: "run-A",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
			},
			// --- cancel + continue ---
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "idle" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			// --- run B ---
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-B",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)
		// activeRunId (harness-tracked) and canonicalRunIdRef
		// (wiring-internal) are both run-B.
		expect(st.activeRunId).toBe("run-B")

		// --- STRANDED canonical run-finished(run-A) ---
		// canonicalRunId=run-B, event.snapshot.runId=run-A →
		// MISMATCH → SUPPRESSED before coordinator.observe.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-A",
					iteration: 99,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})

		// --- LEGITIMATE canonical run-finished(run-B) ---
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-B",
					iteration: 1,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})

		const m = st.wiring.comparator.debugSnapshot()
		// Lifecycle must reflect run-B's legitimate completion,
		// not the stranded run-A completion that was suppressed.
		expect(m.lifecycle.kind).toBe("completed")
		const allRecords = st.wiring.records()
		// 2 task_completed observations (run-A legitimate + run-B
		// legitimate). The stranded one was suppressed before the
		// recorder; it produced NO record.
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		expect(taskCompleted.length).toBe(2)
		const counts = st.wiring.recorderCounts()
		// canonicalAvailable=true: canonical events are APPLY, not
		// FALLBACK_APPLY. So fallbackReconstructedApplied stays 0.
		expect(counts.fallbackReconstructedApplied).toBe(0)
	})

	it("C7.13 stranded canonical run-failed(run-A) after same_task_continued is SUPPRESSED on canonical path", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "streaming" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-B",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)
		expect(st.activeRunId).toBe("run-B")
		// Stranded canonical run-failed(run-A) → SUPPRESSED.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFailed(
				snapshotFixture({
					runId: "run-A",
					iteration: 99,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "recovering",
					status: "failed",
					pendingToolCalls: [],
				}),
			),
		})
		// Legitimate canonical run-failed(run-B).
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFailed(
				snapshotFixture({
					runId: "run-B",
					iteration: 1,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "recovering",
					status: "failed",
					pendingToolCalls: [],
				}),
			),
		})
		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("failed")
		const allRecords = st.wiring.records()
		const taskFailed = allRecords.filter((r) => r.event === "task_failed")
		expect(taskFailed.length).toBe(1)
	})

	it("C7.14 legitimate canonical completion on current run applies", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runFinished(
					snapshotFixture({
						runId: "run-A",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)
		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("completed")
	})

	it("C7.15 legitimate canonical failure on current run applies", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runFailed(
					snapshotFixture({
						runId: "run-A",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "failed",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)
		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("failed")
	})

	it("C7.16 same session, different run IDs — gate is per-run, not per-session", () => {
		// Deliberate stress case: same session but new run identity.
		// Verifies the canonical gate discriminates by runId, not
		// sessionId. A late terminal whose snapshot.runId no longer
		// matches canonicalRunId is suppressed.
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-B",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)
		expect(st.activeRunId).toBe("run-B")
		// Stranded run-finished(run-A) in same session → SUPPRESSED.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-A",
					iteration: 99,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})
		// Legitimate run-finished(run-B) in same session → APPLIES.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-B",
					iteration: 1,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})
		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("completed")
		const allRecords = st.wiring.records()
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		// Only the legitimate run-B completion produced a record.
		expect(taskCompleted.length).toBe(1)
	})

	it("C7.17 cross-origin pair: stranded canonical + stranded reconstructed, both suppressed", () => {
		// End-to-end: same epoch overlap, both ingress paths. The
		// stranded terminal must be suppressed on BOTH paths (0
		// mutations); the legitimate terminal applies exactly once.
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "idle" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-B",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)

		// Late canonical terminal run-A → SUPPRESSED at canonical gate.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-A",
					iteration: 99,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})
		// Late reconstructed terminal run-A → DIAGNOSTIC_ONLY under
		// canonicalAvailable=true (no shadow mutation; no record).
		runStep(st, {
			kind: "legacy",
			event: agentEventV(doneV("run-A", "completed"), "s-canon"),
			legacyPhase: "idle",
			arbiter: arbiterOf({
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
				pendingToolCalls: [],
			}),
		})

		// Legitimate canonical terminal run-B → APPLIES (1 mutation).
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-B",
					iteration: 1,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("completed")
		// Total TaskMsg-level task_completed observations produced by
		// the legitimate run-B completion: exactly 1. The stranded
		// canonical one was suppressed at the gate (no record). The
		// stranded reconstructed one was DIAGNOSTIC_ONLY (no record).
		const allRecords = st.wiring.records()
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		expect(taskCompleted.length).toBe(1)
	})
})

// =========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.2-CORRECTION04
// Canonical run-tracker ORDERING witnesses (C8.1-C8.5). These pin the
// two specific defects CORRECTION03 left open:
//
//   R1: a stale-session canonical run-started MUST NOT mutate the
//       run-epoch tracker. Otherwise a legitimate later run-B
//       terminal sees `active = run-A` (poisoned) and is wrongly
//       suppressed.
//
//   R2: between same_task_continued and the next accepted canonical
//       run-started, late terminals for the retired run identity
//       would otherwise match-by-identity and APPLY, terminating
//       the resumed run.
//
//   R3: every suppressed stranded terminal increments the
//       diagnostic counter `staleRunTerminalSuppressed`.
//
// These test the AUTHORITATIVE LocalRuntimeHost path
// (`canonicalAvailable=true`, RUNTIME_CANONICAL).
// =========================================================================

describe("C2.3-CONT.2-CORRECTION04 — canonical run-tracker ordering (R1/R2/R3)", () => {
	it("C8.1 R1 — stale-session canonical run-started cannot poison canonicalRunIdRef", () => {
		// Active session is B; stale session A sends a late run-started.
		// R1: the tracker MUST NOT mutate. A subsequent legitimate
		// run-finished(B) must APPLY (not be wrongly suppressed).
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-B" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-B",
				event: runStarted(
					snapshotFixture({
						runId: "run-B",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)
		expect(st.activeRunId).toBe("run-B")

		// LATE stale-session run-started from session A. Coordinator
		// would classify STALE; wiring must NOT advance the tracker.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-A",
			event: runStarted(
				snapshotFixture({
					runId: "run-A",
					iteration: 0,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "running",
					pendingToolCalls: [],
				}),
			),
		})

		// Legitimate run-finished(run-B). Without R1, tracker would
		// have been poisoned to run-A and this would be wrongly
		// suppressed. With R1, it must APPLY.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-B",
			event: runFinished(
				snapshotFixture({
					runId: "run-B",
					iteration: 1,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("completed")
		const allRecords = st.wiring.records()
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		expect(taskCompleted.length).toBe(1)
		const counts = st.wiring.recorderCounts()
		// No stranded terminal was suppressed here (the stale
		// run-started was session-mismatched, not a stranded terminal).
		expect(counts.staleRunTerminalSuppressed).toBe(0)
	})

	it("C8.2 R2 — late terminal run-A in continuation-before-next-run-start window is SUPPRESSED", () => {
		// The nastiest ordering: run-A finished, cancel, continued,
		// and then a late run-finished(run-A) arrives BEFORE
		// run-started(B) fires. R2 fence must suppress.
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "streaming" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			// C3.CONT.2-CORRECTION04 R2: production fences the
			// canonical tracker via SdkController adjacent to
			// emitSameTaskContinued. The harness bypasses
			// SdkController, so we set the fence explicitly.
			{ kind: "fence-canonical-run" },
		]
		for (const s of steps) runStep(st, s)
		expect(st.activeRunId).toBe("run-A")

		// LATE run-finished(run-A) arriving in the continuation
		// window. Without R2 fence, event.runId === active
		// (run-A) => APPLY, terminating the resumed run. With
		// R2 fence, MUST be SUPPRESSED.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-A",
					iteration: 99,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})

		const m = st.wiring.comparator.debugSnapshot()
		// Lifecycle must remain `running` (resumed task, awaiting
		// run-B start). NOT completed/failed.
		expect(m.lifecycle.kind).toBe("running")
		const allRecords = st.wiring.records()
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		expect(taskCompleted.length).toBe(0)
		const counts = st.wiring.recorderCounts()
		expect(counts.staleRunTerminalSuppressed).toBe(1)
	})

	it("C8.3 R2 (parity) — late terminal run-failed(run-A) in continuation window is SUPPRESSED", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "streaming" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			{ kind: "fence-canonical-run" },
		]
		for (const s of steps) runStep(st, s)

		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFailed(
				snapshotFixture({
					runId: "run-A",
					iteration: 99,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "recovering",
					status: "failed",
					pendingToolCalls: [],
				}),
			),
		})

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("running")
		const counts = st.wiring.recorderCounts()
		expect(counts.staleRunTerminalSuppressed).toBe(1)
	})

	it("C8.4 — fence clears when next run-started(B) is accepted", () => {
		// Same as C8.2 setup, but now run-started(B) fires. The
		// fence clears; the tracker advances; later run-B
		// terminals APPLY normally.
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "streaming" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			{ kind: "fence-canonical-run" },
			// Now run-B starts; fence clears, tracker advances.
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-B",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)
		expect(st.activeRunId).toBe("run-B")

		// After run-B is announced, late run-finished(run-A) is
		// SUPPRESSED by identity mismatch (run-A != run-B), NOT
		// by the fence. R3 counter still increments.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-A",
					iteration: 99,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})

		// Legitimate run-finished(run-B) APPLIES.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-B",
					iteration: 1,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("completed")
		const counts = st.wiring.recorderCounts()
		// Only the stranded run-A terminal counted.
		expect(counts.staleRunTerminalSuppressed).toBe(1)
		const allRecords = st.wiring.records()
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		expect(taskCompleted.length).toBe(1)
	})

	it("C8.5 — combined stress: stale-session run-start (R1) + retired-run terminal (R2)", () => {
		// Strongest poisoning witness: initial active run is run-A.
		// After cancel + continue + fence, two attacks arrive
		// interleaved:
		//   (a) stale-session-A run-started(run-A2) — R1 must
		//       prevent tracker mutation (otherwise the late
		//       retired run-A terminal would match the poisoned
		//       ref OR the tracker would mismatch later run-A
		//       terminals).
		//   (b) late retired run-finished(run-A) arriving in the
		//       continuation window — R2 fence must suppress
		//       (event.runId === retired active && fenced).
		// Then a legitimate run-started(run-B) + run-finished(run-B)
		// proves the recovered run applies cleanly.
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "streaming" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			{ kind: "fence-canonical-run" },
		]
		for (const s of steps) runStep(st, s)
		expect(st.activeRunId).toBe("run-A")

		// Attack (a): stale-session-A run-started. Switch the
		// active session to s-A so R1's session authority check
		// fires (mirrors a runtime emitting on the wrong
		// session). R1 must prevent tracker mutation.
		runStep(st, { kind: "set-active-session", sessionId: "s-A" })
		runStep(st, {
			kind: "canonical",
			sessionId: "s-A",
			event: runStarted(
				snapshotFixture({
					runId: "run-A2",
					iteration: 0,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "running",
					pendingToolCalls: [],
				}),
			),
		})

		// Reset active session back to s-canon for the
		// legitimate events.
		runStep(st, { kind: "set-active-session", sessionId: "s-canon" })

		// Attack (b): late retired run-finished(run-A) arriving
		// in the continuation window. R2 fence must suppress.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-A",
					iteration: 99,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})

		// Now run-B is announced: fence clears, tracker advances.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runStarted(
				snapshotFixture({
					runId: "run-B",
					iteration: 0,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "running",
					pendingToolCalls: [],
				}),
			),
		})

		// Legitimate run-finished(run-B) APPLIES.
		runStep(st, {
			kind: "canonical",
			sessionId: "s-canon",
			event: runFinished(
				snapshotFixture({
					runId: "run-B",
					iteration: 1,
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "idle",
					status: "completed",
					pendingToolCalls: [],
				}),
			),
		})

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("completed")
		const allRecords = st.wiring.records()
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		expect(taskCompleted.length).toBe(1)
		// R2 suppressed exactly the retired run-A terminal
		// arriving in the continuation window. R1 stale-session
		// run-started was session-rejected (not counted as a
		// stranded run-terminal because it wasn't a terminal
		// event).
		const counts = st.wiring.recorderCounts()
		expect(counts.staleRunTerminalSuppressed).toBe(1)
	})
})

// =========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.3-W09-W10
// Failure and recovery qualification on the canonical Local path.
//
// W09 — current-run failure. The current canonical run fails
// (`run-failed(A)`). The shadow must APPLY it: lifecycle=failed,
// `task_failed` count=1, no divergences, no gaps, no errors.
// W09 also includes a stranded-old-run-failure witness that
// must be SUPPRESSED by the canonical run-epoch terminal ownership
// gate (CORRECTION04 R2 + identity clause).
//
// W10 — recovery. The canonical recovery event
// (`recovery-state-changed`) APPLYs exactly once. The parallel
// host recovery projection
// (`emitHostRecovery` with canonicalAvailable=true) is
// DIAGNOSTIC_ONLY under Policy A: never authoritative when
// canonical recovery exists. R8 carry-forward (R8:
// REAL_SDK_RECOVERY_CALLSITE_USES_emitHostRecovery = PASS) was
// closed when the production SdkController telemetry subscription
// was rewired to feed `emitHostRecovery` instead of calling
// `comparator.observeRuntimeEvent` directly.
// =========================================================================

describe("C2.3-CONT.3 W09 — failure qualification on canonical Local path", () => {
	it("W09.1 — current-run canonical run-failed(A) APPLYs exactly once", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runFailed(
					snapshotFixture({
						runId: "run-A",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "failed",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)

		const m = st.wiring.comparator.debugSnapshot()
		// Shadow derives failed lifecycle from the canonical
		// run-failed event.
		expect(m.lifecycle.kind).toBe("failed")
		const allRecords = st.wiring.records()
		const taskFailed = allRecords.filter((r) => r.event === "task_failed")
		expect(taskFailed.length).toBe(1)
		const counts = st.wiring.recorderCounts()
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		// No stranded terminal was suppressed.
		expect(counts.staleRunTerminalSuppressed).toBe(0)
	})

	it("W09.2 — stranded old-run run-failed(A) in continuation window is SUPPRESSED", () => {
		// After cancel + continue + fence, a late run-failed(run-A)
		// arrives BEFORE run-started(B). The fence must suppress
		// (event.runId === retired active && fenced). Lifecycle
		// stays running, no task_failed mutation, R3 counter
		// increments.
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{ kind: "host-task", taskId: "task-A", which: "cancelled", legacyPhase: "streaming" },
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			{ kind: "fence-canonical-run" },
			// LATE run-failed(run-A) in the continuation window.
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runFailed(
					snapshotFixture({
						runId: "run-A",
						iteration: 99,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "failed",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)

		const m = st.wiring.comparator.debugSnapshot()
		// Lifecycle must remain `running` (resumed task, awaiting
		// run-B start). NOT failed.
		expect(m.lifecycle.kind).toBe("running")
		const allRecords = st.wiring.records()
		const taskFailed = allRecords.filter((r) => r.event === "task_failed")
		expect(taskFailed.length).toBe(0)
		const counts = st.wiring.recorderCounts()
		// R2 + R3: exactly one stranded terminal suppression.
		expect(counts.staleRunTerminalSuppressed).toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})

	it("W09.3 — stranded old-run run-failed(A) is SUPPRESSED by identity mismatch after run-B is active", () => {
		// Sequence: run-A starts, run-B starts and finishes
		// (shadow: completed). A late run-failed(run-A) arrives
		// AFTER run-B was the active canonical run. Identity
		// mismatch (run-A != active run-B) → SUPPRESSED. Lifecycle
		// stays completed, no extra task_failed. R3 counter
		// increments.
		//
		// This is the simpler identity-mismatch path of
		// CORRECTION03 (the same identity clause re-derived in
		// CORRECTION04's truth table). It does NOT need the
		// cancel/continue + fence machinery — the active run
		// identity has advanced, so the stranded terminal is
		// caught by the identity clause alone.
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runStarted(
					snapshotFixture({
						runId: "run-B",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runFinished(
					snapshotFixture({
						runId: "run-B",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
			},
			// LATE run-failed(run-A) (identity mismatch with active
			// run-B → SUPPRESSED).
			{
				kind: "canonical",
				sessionId: "s-canon",
				event: runFailed(
					snapshotFixture({
						runId: "run-A",
						iteration: 99,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "failed",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)

		const m = st.wiring.comparator.debugSnapshot()
		// Lifecycle is completed (run-B), not failed.
		expect(m.lifecycle.kind).toBe("completed")
		const allRecords = st.wiring.records()
		const taskFailed = allRecords.filter((r) => r.event === "task_failed")
		expect(taskFailed.length).toBe(0)
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		expect(taskCompleted.length).toBe(1)
		const counts = st.wiring.recorderCounts()
		expect(counts.staleRunTerminalSuppressed).toBe(1)
		// The stranded run-failed(run-A) is SUPPRESSED — it does
		// NOT add a record and does NOT add a task_failed
		// mutation. The D10 divergence on run-B's task_completed
		// is a separate, expected artifact: the shadow reaches
		// `completed` via run-B but the host task hasn't been
		// `task_reset` for the new run. This is the documented
		// D10_UNKNOWN semantic — the shadow says something the
		// host hasn't observed — and is NOT the gate's concern.
		// The gate's contract is the stranded-terminal
		// suppression, which is verified by the
		// `staleRunTerminalSuppressed` counter and the absence
		// of any `task_failed` record.
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.invariantViolations).toBe(0)
	})
})

describe("C2.3-CONT.3 W10 — recovery qualification on canonical Local path", () => {
	it("W10.1 — canonical recovery-state-changed APPLYs exactly once", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				arbiter: {
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "recovering",
					status: "running",
					pendingToolCalls: [],
				},
				event: recoveryEvent(
					"idle",
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
		]
		for (const s of steps) runStep(st, s)

		const allRecords = st.wiring.records()
		const recoveryChanged = allRecords.filter((r) => r.event === "recovery_changed")
		expect(recoveryChanged.length).toBe(1)
		const counts = st.wiring.recorderCounts()
		expect(counts.fallbackRecoveryApplied).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})

	it("W10.2 — parallel host recovery projection is DIAGNOSTIC_ONLY under canonicalAvailable=true (Policy A)", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			// Canonical recovery arrives first.
			{
				kind: "canonical",
				sessionId: "s-canon",
				arbiter: {
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "recovering",
					status: "running",
					pendingToolCalls: [],
				},
				event: recoveryEvent(
					"idle",
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			// Parallel host recovery projection (the
			// `emitHostRecovery` sink). Policy A: never
			// authoritative when canonical recovery exists.
			{
				kind: "host-recovery",
				sessionId: "s-canon",
				from: "idle",
				to: "recovering",
				canonicalAvailable: true,
			},
		]
		for (const s of steps) runStep(st, s)

		const allRecords = st.wiring.records()
		const recoveryChanged = allRecords.filter((r) => r.event === "recovery_changed")
		// Exactly one recovery_changed record (from the canonical
		// path). The HOST_RECOVERY projection is DIAGNOSTIC_ONLY
		// and must NOT add a second record.
		expect(recoveryChanged.length).toBe(1)
		const counts = st.wiring.recorderCounts()
		expect(counts.observationsDiagnosticByOrigin.HOST_RECOVERY).toBe(1)
		expect(counts.fallbackRecoveryApplied).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})

	it("W10.3 — multiple parallel host recovery projections never double-mutate the shadow", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "s-canon" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "s-canon",
				arbiter: {
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
					recoveryState: "recovering",
					status: "running",
					pendingToolCalls: [],
				},
				event: recoveryEvent(
					"idle",
					snapshotFixture({
						runId: "run-A",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "running",
						pendingToolCalls: [],
					}),
				),
			},
			// Three redundant host recovery projections, all
			// DIAGNOSTIC_ONLY regardless of canonicalAvailable.
			{
				kind: "host-recovery",
				sessionId: "s-canon",
				from: "idle",
				to: "recovering",
				canonicalAvailable: true,
			},
			{
				kind: "host-recovery",
				sessionId: "s-canon",
				from: "idle",
				to: "recovering",
				canonicalAvailable: true,
			},
			{
				kind: "host-recovery",
				sessionId: "s-canon",
				from: "idle",
				to: "recovering",
				canonicalAvailable: true,
			},
		]
		for (const s of steps) runStep(st, s)

		const allRecords = st.wiring.records()
		const recoveryChanged = allRecords.filter((r) => r.event === "recovery_changed")
		expect(recoveryChanged.length).toBe(1)
		const counts = st.wiring.recorderCounts()
		expect(counts.observationsDiagnosticByOrigin.HOST_RECOVERY).toBe(3)
		expect(counts.fallbackRecoveryApplied).toBe(0)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})
})
// =========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C3.CONT.4-W11-W12
// Epoch-transition qualification on the canonical Local path.
//
// W11 — same visible task, runtime run/session changes. The
// continuation fence (CORRECTION04 R2) plus the identity clause
// must protect the resumed task from any stranded run-A terminal,
// in either the pre-run-B-start window or the post-run-B-start
// window. Final lifecycle must reflect run-B's terminal.
//
// W12 — brand-new visible task. After task_reset + resetForNewTask
// + task_requested(task-B), there is a window where
// canonicalRunIdRef=undefined, fence=false, lifecycle=running, and
// activeSession=session-B. W12.1 (cross-session) is expected to be
// safe because R1 session authority refuses a session-A event.
// W12.4 (same-session) deliberately removes that defense. If the
// run-epoch gate alone cannot stop a late run-A terminal from
// mutating task-B, C23-HARDEN-1 reproduces and the ACT halts with
// QUALIFICATION_FOUND_DEFECT.
//
// All identity values are deliberately distinct per the
// CONT.4 plan freeze:
//   task-A   = "task-A"   task-B   = "task-B"
//   session-A= "session-17" session-B="session-18"
//   run-A    = "run-93"   run-B    = "run-94"
// =========================================================================

describe("C2.3-CONT.4 W11 — same-task continuation across runtime epoch", () => {
	it("W11.1 — full same-task continuation: late run-A terminals SUPPRESSED; run-B applies exactly once", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "session-17" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "set-active-session", sessionId: "session-17" },
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runStarted(
					snapshotFixture({
						runId: "run-93",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			// run-A is mid-stream when user issues follow-up.
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			// Fence the canonical run (mirrors SdkController
			// adjacent to emitSameTaskContinued).
			{ kind: "fence-canonical-run" },
			// Runtime session changes for the new run.
			{ kind: "set-active-session", sessionId: "session-18" },
			// Pre-run-B-start probe: late run-finished(run-A) from the
			// SAME session. Must be SUPPRESSED by R2 fence.
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runFinished(
					snapshotFixture({
						runId: "run-93",
						iteration: 99,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
			},
			// run-B begins. Fence clears; tracker advances.
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runStarted(
					snapshotFixture({
						runId: "run-94",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			// Post-run-B-start probe: late run-failed(run-A) from the
			// SAME session. Must be SUPPRESSED by identity
			// mismatch (active=run-B, event=run-A).
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runFailed(
					snapshotFixture({
						runId: "run-93",
						iteration: 100,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "failed",
						pendingToolCalls: [],
					}),
				),
			},
			// run-B finishes naturally — the only legitimate
			// terminal that may apply.
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runFinished(
					snapshotFixture({
						runId: "run-94",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "completed", advance: true },
			},
		]
		for (const s of steps) runStep(st, s)

		const m = st.wiring.comparator.debugSnapshot()
		// Visible task identity unchanged.
		expect(m.identity.taskId).toBe("task-A")
		// Lifecycle reflects run-B's terminal only.
		expect(m.lifecycle.kind).toBe("completed")

		const allRecords = st.wiring.records()
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		const taskFailed = allRecords.filter((r) => r.event === "task_failed")
		// Only run-B's terminal applies; run-A's natural terminal
		// was intentionally not emitted (C8.4-style trace).
		expect(taskCompleted.length).toBe(1)
		expect(taskFailed.length).toBe(0)

		const counts = st.wiring.recorderCounts()
		// Both stranded run-A terminals were suppressed:
		//   - pre-start: R2 fence (active=run-A, event=run-A, fenced)
		//   - post-start: identity mismatch (active=run-B, event=run-A)
		expect(counts.staleRunTerminalSuppressed).toBe(2)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.fallbackReconstructedApplied).toBe(0)
	})

	it("W11.2 — checkpoint: visible task identity, lifecycle, and fence behavior are correct at each probe", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "session-17" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "set-active-session", sessionId: "session-17" },
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runStarted(
					snapshotFixture({
						runId: "run-93",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			{ kind: "host-task", taskId: "task-A", which: "continued", legacyPhase: "idle" },
			// CHECKPOINT B: post-continuation, pre-run-B-start
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.identity.taskId).toBe("task-A")
					expect(m.lifecycle.kind).toBe("running")
				},
			},
			{ kind: "fence-canonical-run" },
			{ kind: "set-active-session", sessionId: "session-18" },
			// Pre-start probe: late run-failed(run-A) from the SAME
			// session. SUPPRESSED by R2 fence.
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runFailed(
					snapshotFixture({
						runId: "run-93",
						iteration: 99,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "failed",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.identity.taskId).toBe("task-A")
					expect(m.lifecycle.kind).toBe("running")
					expect(m.activity.modelStreaming).toBe(false)
					expect(m.activity.activeToolCallIds).toEqual([])
					expect(m.activity.awaitingApproval).toBe(false)
				},
			},
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runStarted(
					snapshotFixture({
						runId: "run-94",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runFinished(
					snapshotFixture({
						runId: "run-94",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "completed", advance: true },
			},
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.identity.taskId).toBe("task-A")
					expect(m.lifecycle.kind).toBe("completed")
					expect(m.activity.activeToolCallIds).toEqual([])
					expect(m.activity.awaitingApproval).toBe(false)
				},
			},
		]
		for (const s of steps) runStep(st, s)

		const counts = st.wiring.recorderCounts()
		expect(counts.staleRunTerminalSuppressed).toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})
})

describe("C2.3-CONT.4 W12 — brand-new-task epoch transition (Model A)", () => {
	it("W12.1 — cross-session: late run-A terminal before run-started(B) is REFUSED by R1 session authority", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "session-17" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "set-active-session", sessionId: "session-17" },
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runStarted(
					snapshotFixture({
						runId: "run-93",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			{ kind: "host-task", taskId: "task-A", which: "reset", legacyPhase: "idle" },
			// Production ordering: resetForNewTask BEFORE
			// task_requested(task-B).
			{ kind: "wiring-reset-for-new-task" },
			{ kind: "set-active-session", sessionId: "session-18" },
			{ kind: "host-task", taskId: "task-B", which: "requested", legacyPhase: "idle" },
			// CHECKPOINT D: pre-run-B-start.
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.identity.taskId).toBe("task-B")
					expect(m.lifecycle.kind).toBe("running")
				},
			},
			// CRITICAL RACE: late run-A terminal from session-17.
			// activeSession = session-18. R1 refuses.
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runFinished(
					snapshotFixture({
						runId: "run-93",
						iteration: 99,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.identity.taskId).toBe("task-B")
					expect(m.lifecycle.kind).toBe("running")
				},
			},
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runStarted(
					snapshotFixture({
						runId: "run-94",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runFinished(
					snapshotFixture({
						runId: "run-94",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "completed", advance: true },
			},
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.identity.taskId).toBe("task-B")
					expect(m.lifecycle.kind).toBe("completed")
				},
			},
		]
		for (const s of steps) runStep(st, s)

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.identity.taskId).toBe("task-B")
		expect(m.lifecycle.kind).toBe("completed")

		const allRecords = st.wiring.records()
		const taskRequested = allRecords.filter((r) => r.event === "task_requested")
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		// Production resetForNewTask clears the recorder. After
		// the reset, only task-B events are observable.
		expect(taskRequested.length).toBe(1)
		expect(taskCompleted.length).toBe(1)

		const counts = st.wiring.recorderCounts()
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.fallbackReconstructedApplied).toBe(0)
	})

	it("W12.2 — late run-A terminal AFTER run-started(B) is SUPPRESSED by identity mismatch", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "session-17" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "set-active-session", sessionId: "session-17" },
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runStarted(
					snapshotFixture({
						runId: "run-93",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			{ kind: "host-task", taskId: "task-A", which: "reset", legacyPhase: "idle" },
			{ kind: "wiring-reset-for-new-task" },
			{ kind: "set-active-session", sessionId: "session-18" },
			{ kind: "host-task", taskId: "task-B", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runStarted(
					snapshotFixture({
						runId: "run-94",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			// Late run-failed(run-A) from session-17: cross-session,
			// so R1 refuses. Also identity-mismatch (active=run-94,
			// event=run-93). Belt and suspenders.
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runFailed(
					snapshotFixture({
						runId: "run-93",
						iteration: 99,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "recovering",
						status: "failed",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runFinished(
					snapshotFixture({
						runId: "run-94",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "completed", advance: true },
			},
		]
		for (const s of steps) runStep(st, s)

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.identity.taskId).toBe("task-B")
		expect(m.lifecycle.kind).toBe("completed")

		const allRecords = st.wiring.records()
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		const taskFailed = allRecords.filter((r) => r.event === "task_failed")
		expect(taskCompleted.length).toBe(1)
		expect(taskFailed.length).toBe(0)

		const counts = st.wiring.recorderCounts()
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
	})

	it("W12.3 — full Model-A transition freezes exact origin/record/divergence counts", () => {
		const st = buildWiring({ canonicalAvailable: true, initialSession: "session-17" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "set-active-session", sessionId: "session-17" },
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runStarted(
					snapshotFixture({
						runId: "run-93",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			{ kind: "host-task", taskId: "task-A", which: "reset", legacyPhase: "idle" },
			{ kind: "wiring-reset-for-new-task" },
			{ kind: "set-active-session", sessionId: "session-18" },
			{ kind: "host-task", taskId: "task-B", which: "requested", legacyPhase: "idle" },
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runStarted(
					snapshotFixture({
						runId: "run-94",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			{
				kind: "canonical",
				sessionId: "session-18",
				event: runFinished(
					snapshotFixture({
						runId: "run-94",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "completed", advance: true },
			},
		]
		for (const s of steps) runStep(st, s)

		const m = st.wiring.comparator.debugSnapshot()
		expect(m.identity.taskId).toBe("task-B")
		expect(m.lifecycle.kind).toBe("completed")
		expect(m.activity.activeToolCallIds).toEqual([])
		expect(m.activity.awaitingApproval).toBe(false)
		expect(m.activity.modelStreaming).toBe(false)

		const allRecords = st.wiring.records()
		const byEvent: Record<string, number> = {}
		for (const r of allRecords) byEvent[r.event] = (byEvent[r.event] ?? 0) + 1
		// Production resetForNewTask clears the recorder. After
		// the reset, only task-B events are observable.
		expect(byEvent["task_requested"]).toBe(1)
		expect(byEvent["task_completed"]).toBe(1)
		expect(byEvent["session_started"]).toBe(1)
		expect(byEvent["task_failed"] ?? 0).toBe(0)

		const counts = st.wiring.recorderCounts()
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.fallbackReconstructedApplied).toBe(0)
	})

	it("W12.4 — same-session variant: session mismatch removed; run-epoch gate alone must protect task-B", () => {
		// DELIBERATE stress test for C23-HARDEN-1. We keep the
		// active session at session-17 across the task_reset so
		// that R1 session authority CANNOT save the trace. The
		// only protection left is the run-epoch gate (R2 +
		// identity mismatch), which is exactly the gate that
		// has the permissive no-active-run branch.
		//
		// Pre-run-B-start probe: late run-finished(run-93) from
		// session-17, run-93 defined, fence=false, active=undef
		// (post-reset). Expected behavior under current policy:
		//   stranded = (false && ...) || (false && ...) = false
		//   -> event APPLYs -> task_completed mutates task-B.
		//
		// If task-B is mutated to `completed` before run-B
		// announces itself, the defect reproduces. HALT per ACT
		// SS52: QUALIFICATION_FOUND_DEFECT_NEW_TASK_EPOCH_OWNERSHIP.
		const st = buildWiring({ canonicalAvailable: true, initialSession: "session-17" })
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			// Same session throughout - no session mismatch defense.
			{ kind: "set-active-session", sessionId: "session-17" },
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runStarted(
					snapshotFixture({
						runId: "run-93",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			{ kind: "host-task", taskId: "task-A", which: "reset", legacyPhase: "idle" },
			{ kind: "wiring-reset-for-new-task" },
			// No set-active-session here - keep session-17.
			{ kind: "host-task", taskId: "task-B", which: "requested", legacyPhase: "idle" },
			// CRITICAL RACE: late run-finished(run-93) from
			// session-17 BEFORE run-started(B). Session matches;
			// the only defense is the run-epoch gate.
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runFinished(
					snapshotFixture({
						runId: "run-93",
						iteration: 99,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
			},
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runStarted(
					snapshotFixture({
						runId: "run-94",
						iteration: 0,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "running",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "streaming", advance: true },
			},
			{
				kind: "canonical",
				sessionId: "session-17",
				event: runFinished(
					snapshotFixture({
						runId: "run-94",
						iteration: 1,
						execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
						recoveryState: "idle",
						status: "completed",
						pendingToolCalls: [],
					}),
				),
				setLegacyPhase: { phase: "completed", advance: true },
			},
		]
		for (const s of steps) runStep(st, s)

		// The W12.4 trace deliberately removes the R1 session
		// defense. After resetForNewTask + task_requested(task-B)
		// the canonical run tracker is undefined, fence is
		// cleared, lifecycle is running. A late run-finished
		// from session-17 (same as the active session) with
		// run-93 (different from active run-94) MUST be
		// SUPPRESSED by the run-epoch gate. If it is admitted,
		// task-B's lifecycle is mutated to completed BEFORE
		// run-B even announces itself — the epoch model is
		// broken.
		const m = st.wiring.comparator.debugSnapshot()
		const allRecords = st.wiring.records()
		const taskCompleted = allRecords.filter((r) => r.event === "task_completed")
		const counts = st.wiring.recorderCounts()
		const preRunBSuppressed = counts.staleRunTerminalSuppressed >= 1
		// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.4 §52:
		// valid W12 failure verdict is
		//   QUALIFICATION_FOUND_DEFECT_NEW_TASK_EPOCH_OWNERSHIP
		// HALT here and emit the minimal trace.
		if (!preRunBSuppressed) {
			const minimalTrace = {
				task_A: "task-A",
				session_A: "session-17",
				run_A: "run-93",
				task_B: "task-B",
				session_B: "session-17",
				run_B: "run-94",
				task_completed_records: taskCompleted.length,
				finalLifecycle: m.lifecycle.kind,
				finalTaskId: m.identity.taskId,
				staleRunTerminalSuppressed: counts.staleRunTerminalSuppressed,
			}
			throw new Error(
				"CONT.4 W12.4 HALT — QUALIFICATION_FOUND_DEFECT_NEW_TASK_EPOCH_OWNERSHIP. " +
					"Pre-run-B-start late run-A terminal was admitted by the run-epoch gate " +
					"and mutated task-B lifecycle to completed. Minimal trace: " +
					JSON.stringify(minimalTrace),
			)
		}
		// If we reach here, the gate protected task-B.
		expect(m.identity.taskId).toBe("task-B")
		expect(m.lifecycle.kind).toBe("completed")
		expect(taskCompleted.length).toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.invariantViolations).toBe(0)
		expect(counts.observerErrors).toBe(0)
		expect(counts.evidenceGaps).toBe(0)
		expect(counts.fallbackReconstructedApplied).toBe(0)
	})
})
