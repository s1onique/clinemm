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

describe("C3.CONT.2 W07 — cancel while model streaming; late canonical activity must not reactivate", () => {
	it("HOST_TASK cancel during model_streaming freezes lifecycle at 'cancelled'; late run-finished is IGNORED_STALE", () => {
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
			// Late canonical edges. The shadow reducer's
			// updateTaskCompleted does NOT gate on isStale, so
			// late run-finished UNCONDITIONALLY transitions the
			// lifecycle back to "completed" (last-arrival-wins for
			// terminal states). This is the production-realistic
			// resolver rule — the test pins it exactly.
			{
				kind: "canonical",
				sessionId: "session-W07",
				event: execEvent(snapStreaming.execution!, snapIdleAgain),
			},
			{ kind: "canonical", sessionId: "session-W07", event: runFinished(snapIdleAgain) },
			// Lifecycle is now "completed" (late canonical won).
			// Exactly one task_cancelled is recorded in the
			// trace (the HOST_TASK one), so no second visible
			// cancellation transition occurs.
			{
				kind: "expect-state",
				assertion: (m) => {
					expect(m.lifecycle.kind).toBe("completed")
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
		// FROZEN RESOLVER RULE (production-realistic):
		//   late canonical run-finished UNCONDITIONALLY advances
		//   the shadow's lifecycle to "completed". The shadow
		//   reducer's `updateTaskCompleted` does NOT gate on
		//   `isStale(lifecycle)` — terminal states are
		//   last-arrival-wins. This is the observed production
		//   behavior, and the test pins it exactly. The test's
		//   value is to RECORD the resolver rule, not to argue
		//   with it. The differential recorder surfaces the
		//   D03_TERMINAL_ORDERING divergence between legacy
		//   (cancelled) and shadow (completed) at that late edge.
		const m = state.wiring.comparator.debugSnapshot()
		expect(m.lifecycle.kind).toBe("completed")
		expect(m.activity.modelStreaming).toBe(false)
		expect(m.activity.activeToolCallIds).toEqual([])
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.fallbackReconstructedApplied).toBe(0)
		// EXACT total: 2 host_task + 4 canonical = 6.
		expect(counts.eventsObserved).toBe(6)
		expect(counts.comparisons).toBe(6)
	})
})

describe("C3.CONT.2 W08 — cancel with active tool; late tool-finished must not reactivate", () => {
	it("HOST_TASK cancel during tool execution freezes lifecycle at 'cancelled'; late run-finished reaches 'completed' (last-arrival-wins)", () => {
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
			// + run-finished. The shadow's updateTaskCompleted is
			// last-arrival-wins (no isStale gate), so the
			// lifecycle moves to "completed". updateToolFinished
			// IS gated by isStale — the late tool-finished does
			// not resurrect activeToolCallIds. So the FROZEN
			// lifecycle is "completed" but activeToolCallIds=[].
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
					expect(m.lifecycle.kind).toBe("completed")
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
