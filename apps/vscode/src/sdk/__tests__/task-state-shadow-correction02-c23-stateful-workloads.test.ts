/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3:
 *
 * Stateful W01-W16 + F01-F03 workload qualification for the unified
 * observation boundary.
 */

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
import { emitSameTaskContinued, emitTaskCancelled, emitTaskRequested, emitTaskReset } from "../task-state-shadow-host-msgs"
import {
	createTaskShadowHostWiring,
	emptyArbiterSnapshot,
	type TaskShadowHostWiringDeps,
	type TaskShadowHostWiringWithSink,
} from "../task-state-shadow-host-wiring"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"

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
	| { kind: "canonical"; sessionId: string; event: AgentRuntimeEvent }
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
	| { kind: "set-active-run"; runId: string | undefined }
	| { kind: "checkpoint"; selected: CheckpointSelection }

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
		now: () => NOW,
	}
	state.wiring = createTaskShadowHostWiring(deps)
	void opts
	return state
}

function runStep(state: HarnessState, step: WorkloadStep): void {
	switch (step.kind) {
		case "canonical":
			state.wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: step.sessionId,
				event: step.event,
			})
			return
		case "legacy":
			state.currentLegacyPhase = step.legacyPhase
			state.currentArbiter = step.arbiter
			state.sessionOptions.onSessionEvent(step.event)
			return
		case "host-task":
			switch (step.which) {
				case "requested":
					emitTaskRequested({ coordinator: state.wiring.coordinator, now: state.wiring.now }, step.taskId, NOW)
					return
				case "cancelled":
					state.currentLegacyPhase = step.legacyPhase
					emitTaskCancelled({ coordinator: state.wiring.coordinator, now: state.wiring.now }, step.legacyPhase, NOW)
					return
				case "reset":
					state.currentLegacyPhase = step.legacyPhase
					emitTaskReset({ coordinator: state.wiring.coordinator, now: state.wiring.now }, step.legacyPhase, NOW)
					return
				case "continued":
					state.currentLegacyPhase = step.legacyPhase
					emitSameTaskContinued({ coordinator: state.wiring.coordinator, now: state.wiring.now }, step.legacyPhase, NOW)
					return
			}
			return
		case "host-recovery":
			state.wiring.coordinator.observe({
				kind: "host-recovery",
				origin: "HOST_RECOVERY",
				sessionId: step.sessionId,
				canonicalAvailable: step.canonicalAvailable,
				msg: {
					type: "recovery_changed",
					projection: { state: step.to, episodeFailures: 0, circuitNoticeCount: 0 },
					at: NOW,
				},
			})
			return
		case "set-active-session":
			state.activeSessionId = step.sessionId
			return
		case "set-active-run":
			void step
			return
		case "checkpoint":
			assertCheckpoint(state, step.selected)
			return
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
	// Map our short keys (D00..D11) onto the ACTUAL DivergenceClass.
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

describe("C2.3 stateful W01 — text-only run", () => {
	it("qualifies a clean streaming run with one D11 host-pre-engaged interval", () => {
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
			execution: { ...snapIdle.execution, modelStreaming: true },
		}
		const snapIdleAgain: AgentRuntimeStateSnapshot = {
			...snapIdle,
			execution: { ...snapIdle.execution, modelStreaming: false },
		}
		const steps: WorkloadStep[] = [
			{ kind: "host-task", taskId: "task-A", which: "requested", legacyPhase: "idle" },
			{ kind: "canonical", sessionId: "session-17", event: runStarted(snapIdle) },
			{
				kind: "legacy",
				event: legacyEnvelope({ type: "content_start", contentType: "text", text: "Hello" } as AgentEvent),
				legacyPhase: "streaming",
				arbiter: arbiterOf({ modelStreaming: false, tooling: false, awaitingApproval: false, pendingToolCalls: [] }),
			},
			{
				kind: "canonical",
				sessionId: "session-17",
				event: execEvent(snapIdle.execution, snapStreaming),
			},
			{
				kind: "canonical",
				sessionId: "session-17",
				event: execEvent(snapStreaming.execution, snapIdleAgain),
			},
			{ kind: "canonical", sessionId: "session-17", event: turnFinished(snapIdleAgain, 0) },
		]
		const state = runWorkload(steps)
		hardGates(state)
		const counts = state.wiring.recorderCounts()
		// Run-started + exec-state-changed x2 + turn-finished = 4 canonical events.
		// task_requested = 1 HOST_TASK. Total 5 observations applied.
		expect(counts.eventsObserved).toBe(5)
		// The legacy text frame under LocalRuntimeHost is DIAGNOSTIC_ONLY
		// (Option A) and produces a D11_HOST_PREENGAGED divergence
		// against the canonical arbiter (modelStreaming=false says
		// running but the legacy phase says "streaming").
		expect(counts.divergenceCountsByClass.D11_HOST_PREENGAGED).toBe(1)
		expect(counts.divergenceCountsByClass.D10_UNKNOWN).toBe(0)
		expect(counts.divergenceCountsByClass.D02_SHADOW_FALSE_ACTIVE).toBe(0)
		expect(counts.divergenceCountsByClass.D00_AGREE).toBeGreaterThanOrEqual(3)
		const model = state.wiring.comparator.debugSnapshot()
		expect(model.lifecycle.kind).not.toBe("idle")
	})
})
