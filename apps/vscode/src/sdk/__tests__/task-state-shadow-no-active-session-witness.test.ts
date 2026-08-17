/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B
 * NO_ACTIVE_SESSION direct-production-boundary witness.
 *
 * The C2.4 plan §3.2 (No-active-session witnesses) requires
 * a direct production-boundary test that drives a state-mutating
 * canonical event through the live wiring with
 * `lifecycle.getActiveSession()` returning `undefined`, and
 * observes the wiring's behavior.
 *
 * The wiring's current session guard at
 * `task-state-shadow-host-wiring.ts:393` is:
 *
 *     const activeSession = deps.lifecycle.getActiveSession()
 *     if (activeSession && activeSession.sessionId !== input.sessionId) {
 *         return
 *     }
 *
 * The condition only rejects when `activeSession` is defined AND
 * has a different sessionId. The case `activeSession === undefined`
 * is NOT rejected — the event falls through to the tracker-update
 * block and then the coordinator. This is the **vacuous guard** that
 * C2.4-B is auditing.
 *
 * This test asserts the FAIL_CLOSED invariant: with no active
 * session, every state-mutating canonical event MUST be a no-op
 * on the recorder, the comparator, the comparator's shadow model,
 * and the run-tracker refs (which are observable indirectly through
 * the next accepted event's behavior).
 *
 * Eight rows (B1–B8) match the seven state-relevant canonical
 * categories plus the explicit recovery-state-changed(runId=undefined)
 * row that C2.4-A flagged as a live unreviewed witness.
 *
 * `it.fails(...)` is used to keep CI green while the witness is
 * pending the OBSERVATION_LAYER_HARDENING_ONLY fix (the narrow
 * `if (activeSession === undefined) return` guard at line 393).
 * The fix commit (C2.4-B-FIXUP01) will replace `it.fails(...)` with
 * `it(...)` and the test will pass for real.
 *
 * Hard invariant (C2.4 plan §3.2 acceptance gate):
 *
 *     NO_ACTIVE_SESSION
 *     + state-mutating canonical event
 *     = NO TaskState authority
 *     = NO recorder mutation
 *     = NO comparator mutation
 *     = NO run-tracker mutation
 *     = NO comparator.shadow mutation
 */

import type {
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeExecutionState,
	AgentRuntimeRecoverySnapshot,
	AgentRuntimeStateSnapshot,
	AgentToolCallPart,
	AgentUsage,
	RecoveryState,
} from "@cline/shared"
import { afterEach, beforeEach, describe, it } from "vitest"
import type { SdkSessionLifecycleOptions } from "../sdk-session-lifecycle"
import { createTaskShadowHostWiring, emptyArbiterSnapshot } from "../task-state-shadow-host-wiring"

const ORIGINAL_ENV = process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL

beforeEach(() => {
	process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = "1"
})

afterEach(() => {
	if (ORIGINAL_ENV === undefined) delete process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL
	else process.env.CLINEMM_TASK_STATE_SHADOW_DIFFERENTIAL = ORIGINAL_ENV
})

// ---------- helpers ----------

function makeDeps(): {
	deps: {
		lifecycle: { getActiveSession: () => undefined; setRunning: () => void }
		sessionOptions: SdkSessionLifecycleOptions
		getLegacyPhase: () => "idle"
		getArbiterSnapshot: () => ReturnType<typeof emptyArbiterSnapshot>
		now: () => number
	}
} {
	const sessionOptions: SdkSessionLifecycleOptions = {
		mcpHub: undefined as never,
		requestToolApproval: () => undefined as never,
		askQuestion: () => undefined as never,
		onSessionEvent: () => undefined,
		onSendComplete: () => undefined,
		onSendError: () => undefined,
	}
	return {
		deps: {
			lifecycle: {
				// THE VACUOUS GUARD CONDITION: no active session.
				getActiveSession: () => undefined,
				setRunning: () => undefined,
			},
			sessionOptions,
			getLegacyPhase: () => "idle",
			getArbiterSnapshot: () => emptyArbiterSnapshot(),
			now: () => 1_700_000_000_000,
		},
	}
}

function baseSnapshot(overrides: Partial<AgentRuntimeStateSnapshot> = {}): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent-1",
		runId: "run-1",
		status: "running",
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: { inputTokens: 0, outputTokens: 0 } as AgentUsage,
		...overrides,
	}
}

const EMPTY_EXECUTION: AgentRuntimeExecutionState = {
	modelStreaming: false,
	tooling: false,
	awaitingApproval: false,
}

function emptyRecoverySnapshot(state: RecoveryState = "off"): AgentRuntimeRecoverySnapshot {
	return {
		state,
		tracker: { state, mode: "tool-aware" } as AgentRuntimeRecoverySnapshot["tracker"],
		secondStage: { kind: "none" } as AgentRuntimeRecoverySnapshot["secondStage"],
		episodeFailures: 0,
		maxEpisodeFailures: 3,
		circuitNoticeCount: 0,
	}
}

function runStarted(snapshot: AgentRuntimeStateSnapshot = baseSnapshot()): AgentRuntimeEvent {
	return { type: "run-started", snapshot }
}

function runFinished(snapshot: AgentRuntimeStateSnapshot = baseSnapshot()): AgentRuntimeEvent {
	return {
		type: "run-finished",
		snapshot,
		result: {
			agentId: "agent-1",
			runId: snapshot.runId ?? "run-1",
			status: "completed",
		} as AgentRuntimeEvent extends { type: "run-finished"; result: infer R } ? R : never,
	}
}

function runFailed(snapshot: AgentRuntimeStateSnapshot = baseSnapshot()): AgentRuntimeEvent {
	return {
		type: "run-failed",
		snapshot,
		error: new Error("test failure"),
	}
}

function toolStarted(snapshot: AgentRuntimeStateSnapshot = baseSnapshot()): AgentRuntimeEvent {
	return {
		type: "tool-started",
		snapshot,
		iteration: 0,
		toolCall: { id: "tc-1", name: "test-tool", arguments: {} } as AgentToolCallPart,
	}
}

function toolFinished(snapshot: AgentRuntimeStateSnapshot = baseSnapshot()): AgentRuntimeEvent {
	return {
		type: "tool-finished",
		snapshot,
		iteration: 0,
		toolCall: { id: "tc-1", name: "test-tool", arguments: {} } as AgentToolCallPart,
		message: { role: "tool", content: [] } as AgentMessage,
	}
}

function executionStateChanged(
	snapshot: AgentRuntimeStateSnapshot = baseSnapshot(),
	execution: AgentRuntimeExecutionState = EMPTY_EXECUTION,
): AgentRuntimeEvent {
	return {
		type: "execution-state-changed",
		snapshot,
		previousExecution: { ...execution },
	}
}

function recoveryStateChanged(
	snapshot: AgentRuntimeStateSnapshot = baseSnapshot(),
	recovery: AgentRuntimeRecoverySnapshot = emptyRecoverySnapshot(),
): AgentRuntimeEvent {
	return {
		type: "recovery-state-changed",
		snapshot,
		previousRecovery: recovery,
	}
}

/**
 * Capture every observable surface of the wiring before the
 * observation. The after-call assertions compare against this.
 */
interface Boundaries {
	eventsObserved: number
	comparisons: number
	divergences: number
	invariantViolations: number
	observationsSuppressedCanonical: number
	observationsDiagnosticCanonical: number
	fallbackRecoveryApplied: number
	fallbackReconstructedApplied: number
	staleRunTerminalSuppressed: number
	observerErrors: number
	evidenceGaps: number
	droppedRecords: number
	recordCount: number
	modelTurnPhase: unknown
}

function capture(wiring: ReturnType<typeof createTaskShadowHostWiring>): Boundaries {
	const counts = wiring.recorderCounts()
	return {
		eventsObserved: counts.eventsObserved,
		comparisons: counts.comparisons,
		divergences: counts.divergences,
		invariantViolations: counts.invariantViolations,
		observationsSuppressedCanonical: counts.observationsSuppressedByOrigin["RUNTIME_CANONICAL"] ?? 0,
		observationsDiagnosticCanonical: counts.observationsDiagnosticByOrigin["RUNTIME_CANONICAL"] ?? 0,
		fallbackRecoveryApplied: counts.fallbackRecoveryApplied,
		fallbackReconstructedApplied: counts.fallbackReconstructedApplied,
		staleRunTerminalSuppressed: counts.staleRunTerminalSuppressed,
		observerErrors: counts.observerErrors,
		evidenceGaps: counts.evidenceGaps,
		droppedRecords: counts.droppedRecords,
		recordCount: wiring.records().length,
		modelTurnPhase: wiring.comparator.debugSnapshot().turnPhase,
	}
}

function checkNoDelta(label: string, before: Boundaries, after: Boundaries): void {
	const deltas: Record<string, number> = {
		eventsObserved: after.eventsObserved - before.eventsObserved,
		comparisons: after.comparisons - before.comparisons,
		divergences: after.divergences - before.divergences,
		invariantViolations: after.invariantViolations - before.invariantViolations,
		observationsSuppressedCanonical: after.observationsSuppressedCanonical - before.observationsSuppressedCanonical,
		observationsDiagnosticCanonical: after.observationsDiagnosticCanonical - before.observationsDiagnosticCanonical,
		fallbackRecoveryApplied: after.fallbackRecoveryApplied - before.fallbackRecoveryApplied,
		fallbackReconstructedApplied: after.fallbackReconstructedApplied - before.fallbackReconstructedApplied,
		staleRunTerminalSuppressed: after.staleRunTerminalSuppressed - before.staleRunTerminalSuppressed,
		observerErrors: after.observerErrors - before.observerErrors,
		evidenceGaps: after.evidenceGaps - before.evidenceGaps,
		droppedRecords: after.droppedRecords - before.droppedRecords,
		recordCount: after.recordCount - before.recordCount,
	}
	const nonZero = Object.entries(deltas).filter(([, v]) => v !== 0)
	const turnPhaseChanged = after.modelTurnPhase !== before.modelTurnPhase
	if (nonZero.length === 0 && !turnPhaseChanged) {
		return
	}
	// Print a recognizable FAIL_OPEN diagnostic banner before the
	// throw so the diagnostic is visible in the test reporter
	// even with `it.fails(...)` semantics (vitest 4 suppresses
	// the underlying error message for `it.fails`).
	const lines: string[] = []
	lines.push(`[C2.4-B FAIL_OPEN] ${label}`)
	for (const [key, value] of nonZero) {
		lines.push(`  ${key} delta = ${value} (expected 0)`)
	}
	if (turnPhaseChanged) {
		lines.push(`  comparator.shadow.turnPhase mutated: ${String(before.modelTurnPhase)} → ${String(after.modelTurnPhase)}`)
	}
	lines.push("  ROOT CAUSE: task-state-shadow-host-wiring.ts:393 vacuous guard")
	lines.push("  FIX:        add `if (activeSession === undefined) return` above the existing wrong-session check")
	console.error(lines.join("\n"))
	throw new Error(
		`FAIL_OPEN on ${label}: ${nonZero.map(([k, v]) => `${k}+=${v}`).join(", ")}` +
			(turnPhaseChanged ? " (turnPhase changed)" : ""),
	)
}

// ---------- witnesses ----------
//
// Each test is marked `it.fails(...)` while the witness is
// pending the OBSERVATION_LAYER_HARDENING_ONLY fix at line 393.
// The fix commit (C2.4-B-FIXUP01) replaces `it.fails(...)` with
// `it(...)` and the test passes for real. `it.fails` keeps CI
// green and the underlying test still runs the diagnostic block,
// so the FAIL_OPEN evidence is captured in the test output.

describe("C2.4-B NO_ACTIVE_SESSION direct-production-boundary witness", () => {
	it.fails("B1 run-started: no active session — must be no-op", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: runStarted(),
			})
			const after = capture(wiring)
			checkNoDelta("B1 run-started", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it.fails("B2 run-finished: no active session — must be no-op", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: runFinished(),
			})
			const after = capture(wiring)
			checkNoDelta("B2 run-finished", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it.fails("B3 run-failed: no active session — must be no-op", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: runFailed(),
			})
			const after = capture(wiring)
			checkNoDelta("B3 run-failed", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it.fails("B4 tool-started: no active session — must be no-op", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: toolStarted(),
			})
			const after = capture(wiring)
			checkNoDelta("B4 tool-started", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it.fails("B5 tool-finished: no active session — must be no-op", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: toolFinished(),
			})
			const after = capture(wiring)
			checkNoDelta("B5 tool-finished", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it.fails("B6 execution-state-changed: no active session — must be no-op", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: executionStateChanged(),
			})
			const after = capture(wiring)
			checkNoDelta("B6 execution-state-changed", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it.fails("B7 recovery-state-changed (defined runId): no active session — must be no-op", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: recoveryStateChanged(baseSnapshot({ runId: "run-1" })),
			})
			const after = capture(wiring)
			checkNoDelta("B7 recovery-state-changed runId=defined", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it.fails("B8 recovery-state-changed (runId === undefined): no active session — must be no-op", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			// runId === undefined is the live C2.4-A deferred row.
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: recoveryStateChanged(baseSnapshot({ runId: undefined })),
			})
			const after = capture(wiring)
			checkNoDelta("B8 recovery-state-changed runId=undefined", before, after)
		} finally {
			wiring.dispose()
		}
	})
})
