/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01
 * NO_ACTIVE_SESSION direct-production-boundary witness (POST-FIX).
 *
 * C2.4-B (commit 0b2f6265c) reproduced 8/8 B rows = FAIL_OPEN at the
 * vacuous guard. Per C2.4-B-FIXUP01 review (round-7 follow-up),
 * this file is now the post-fix invariant:
 *
 *   B1–B8  ordinary `it()` with hard `expect(...).toBe(0)` (no
 *          `it.fails` lenient pattern). Each row asserts the
 *          recorder/comparator/fence/turnPhase delta is exactly
 *          zero. With the C2.4-B-FIXUP01 guard at line 393, all
 *          8 rows pass. Without the guard, all 8 rows fail.
 *
 *   B6     the execution-state-changed fixture is a REAL edge
 *          (snapshot.execution.modelStreaming=true,
 *          previousExecution.modelStreaming=false), so the
 *          shadow adapter emits `model_stream_started`. The
 *          pre-fix fixture was all-false; edge-triggered TaskMsg
 *          production was silent.
 *
 *   B7/B8  the recovery-state-changed fixture is a REAL recovery
 *          transition (snapshot.recovery.state="recovering",
 *          previousRecovery.state="idle"), so the shadow
 *          adapter emits `recovery_changed` with a non-trivial
 *          projection. The pre-fix fixture was off/off (silent).
 *
 *   B9     behavioral tracker-poison witness. Drives:
 *               1. no-session run-started("run-poison")
 *                    (post-fix: rejected; pre-fix: admitted,
 *                     canonicalRunIdRef := "run-poison")
 *               2. switch active session on (sessionId=session-real)
 *               3. inject run-finished("run-poison")
 *                    with the active session
 *               4. inject run-finished("run-real")
 *                    with the active session
 *          Post-fix expected:
 *               step 1 → recorder delta 0
 *               step 3 → wrongActiveRun (canonicalRunIdRef is
 *                        undefined) → staleRunTerminalSuppressed
 *                        += 1
 *               step 4 → wrongActiveRun (canonicalRunIdRef is
 *                        undefined, eventRunId="run-real")
 *                        → staleRunTerminalSuppressed += 1
 *          Pre-fix (the poisoning):
 *               step 1 → recorder delta 1 (admitted)
 *               step 3 → canonicalRunIdRef=run-poison,
 *                        eventRunId=run-poison → wrongActiveRun=false
 *                        → accepted silently. NO
 *                        staleRunTerminalSuppressed increment.
 *               step 4 → wrongActiveRun (canonicalRunIdRef=
 *                        run-poison, eventRunId=run-real) →
 *                        staleRunTerminalSuppressed += 1
 *          The B9 discriminant is:
 *                        staleRunTerminalSuppressed == 2
 *                        step-3 eventsObserved == 1 (terminal)
 *          Pre-fix produces staleRunTerminalSuppressed = 1
 *          (only step-4) and step-3 eventsObserved = 2 (step-1
 *          + step-3). Post-fix produces 2 and 1.
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
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ActiveSession } from "../cline-session-factory"
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

interface MutableDeps {
	deps: {
		lifecycle: {
			getActiveSession: () => ActiveSession | undefined
			setRunning: () => void
		}
		sessionOptions: SdkSessionLifecycleOptions
		getLegacyPhase: () => "idle"
		getArbiterSnapshot: () => ReturnType<typeof emptyArbiterSnapshot>
		now: () => number
	}
	sessionCell: { current: ActiveSession | undefined }
}

function makeDeps(activeSession: ActiveSession | undefined = undefined): MutableDeps {
	const sessionCell: { current: ActiveSession | undefined } = { current: activeSession }
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
				getActiveSession: () => sessionCell.current,
				setRunning: () => undefined,
			},
			sessionOptions,
			getLegacyPhase: () => "idle",
			getArbiterSnapshot: () => emptyArbiterSnapshot(),
			now: () => 1_700_000_000_000,
		},
		sessionCell,
	}
}

function makeActiveSession(sessionId: string): ActiveSession {
	// Minimal fixture — `getActiveSession()` only reads `sessionId`
	// at the wiring boundary; the rest of the ActiveSession
	// surface is unused by the shadow wiring.
	return {
		sessionId,
		sdkHost: undefined as never,
		unsubscribe: () => undefined,
		isRunning: true,
	} as unknown as ActiveSession
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

const IDLE_EXECUTION: AgentRuntimeExecutionState = {
	modelStreaming: false,
	tooling: false,
	awaitingApproval: false,
}

// B6 needs a real edge: modelStreaming flips false → true so the
// shadow adapter emits `model_stream_started`. The previous C2.4-B
// fixture was all-false/IDLE_EXECUTION on both sides, which the
// edge-triggered adapter (shadow-adapter.ts lines 98–126) silently
// drops. With a real edge, B6 actually exercises a state-mutating
// canonical event in the projection.
function executionStateChanged(snapshot: AgentRuntimeStateSnapshot = baseSnapshot()): AgentRuntimeEvent {
	const snapshotWithExecution: AgentRuntimeStateSnapshot = {
		...snapshot,
		execution: {
			modelStreaming: true,
			tooling: false,
			awaitingApproval: false,
		} satisfies AgentRuntimeExecutionState,
	}
	return {
		type: "execution-state-changed",
		snapshot: snapshotWithExecution,
		previousExecution: { ...IDLE_EXECUTION },
	}
}

function recoverySnapshot(state: RecoveryState = "off"): AgentRuntimeRecoverySnapshot {
	return {
		state,
		tracker: { state, mode: "tool-aware" } as AgentRuntimeRecoverySnapshot["tracker"],
		secondStage: { kind: "none" } as AgentRuntimeRecoverySnapshot["secondStage"],
		episodeFailures: 0,
		maxEpisodeFailures: 3,
		circuitNoticeCount: 0,
	}
}

// B7/B8 use a real recovery transition: previousRecovery.state
// is "idle" (not "off"); snapshot.recovery.state is "recovering".
// The shadow adapter emits `recovery_changed` with a
// `projectRecoverySnapshot(...)` projection whose `state` differs
// from the previous. This is the post-fix witness that the no-
// session guard blocks a genuine state-mutating recovery edge.
function recoveryStateChanged(
	snapshot: AgentRuntimeStateSnapshot = baseSnapshot(),
	runId: string | undefined = "run-1",
): AgentRuntimeEvent {
	const snapshotWithRecovery: AgentRuntimeStateSnapshot = {
		...snapshot,
		runId,
		recovery: recoverySnapshot("recovering"),
	}
	return {
		type: "recovery-state-changed",
		snapshot: snapshotWithRecovery,
		previousRecovery: recoverySnapshot("idle"),
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

// ---------- counter capture ----------

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

function expectZeroDelta(label: string, before: Boundaries, after: Boundaries): void {
	expect(after.eventsObserved - before.eventsObserved, `[${label}] eventsObserved`).toBe(0)
	expect(after.comparisons - before.comparisons, `[${label}] comparisons`).toBe(0)
	expect(after.divergences - before.divergences, `[${label}] divergences`).toBe(0)
	expect(after.invariantViolations - before.invariantViolations, `[${label}] invariantViolations`).toBe(0)
	expect(
		after.observationsSuppressedCanonical - before.observationsSuppressedCanonical,
		`[${label}] observationsSuppressedCanonical`,
	).toBe(0)
	expect(
		after.observationsDiagnosticCanonical - before.observationsDiagnosticCanonical,
		`[${label}] observationsDiagnosticCanonical`,
	).toBe(0)
	expect(after.fallbackRecoveryApplied - before.fallbackRecoveryApplied, `[${label}] fallbackRecoveryApplied`).toBe(0)
	expect(
		after.fallbackReconstructedApplied - before.fallbackReconstructedApplied,
		`[${label}] fallbackReconstructedApplied`,
	).toBe(0)
	expect(after.staleRunTerminalSuppressed - before.staleRunTerminalSuppressed, `[${label}] staleRunTerminalSuppressed`).toBe(0)
	expect(after.observerErrors - before.observerErrors, `[${label}] observerErrors`).toBe(0)
	expect(after.evidenceGaps - before.evidenceGaps, `[${label}] evidenceGaps`).toBe(0)
	expect(after.droppedRecords - before.droppedRecords, `[${label}] droppedRecords`).toBe(0)
	expect(after.recordCount - before.recordCount, `[${label}] recordCount`).toBe(0)
	expect(after.modelTurnPhase, `[${label}] comparator.shadow.turnPhase`).toBe(before.modelTurnPhase)
}

// ---------- witnesses (HARD `expect(...).toBe(0)`; post-fix) ----------

describe("C2.4-B-FIXUP01 NO_ACTIVE_SESSION direct-production-boundary witness", () => {
	it("B1 run-started: no active session — recorder/comparator/fence delta is zero", () => {
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
			expectZeroDelta("B1 run-started", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it("B2 run-finished: no active session — recorder/comparator/fence delta is zero", () => {
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
			expectZeroDelta("B2 run-finished", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it("B3 run-failed: no active session — recorder/comparator/fence delta is zero", () => {
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
			expectZeroDelta("B3 run-failed", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it("B4 tool-started: no active session — recorder/comparator/fence delta is zero", () => {
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
			expectZeroDelta("B4 tool-started", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it("B5 tool-finished: no active session — recorder/comparator/fence delta is zero", () => {
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
			expectZeroDelta("B5 tool-finished", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it("B6 execution-state-changed (real edge: modelStreaming false \u2192 true): no active session \u2014 recorder/comparator/fence delta is zero", () => {
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
			expectZeroDelta("B6 execution-state-changed (real edge)", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it("B7 recovery-state-changed (defined runId + real transition: idle \u2192 recovering): no active session \u2014 recorder/comparator/fence delta is zero", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: recoveryStateChanged(baseSnapshot({ runId: "run-1" }), "run-1"),
			})
			const after = capture(wiring)
			expectZeroDelta("B7 recovery-state-changed (real transition, runId=defined)", before, after)
		} finally {
			wiring.dispose()
		}
	})

	it("B8 recovery-state-changed (runId === undefined + real transition: idle \u2192 recovering): no active session \u2014 recorder/comparator/fence delta is zero", () => {
		const { deps } = makeDeps()
		const wiring = createTaskShadowHostWiring(deps)
		try {
			const before = capture(wiring)
			// runId === undefined is the live C2.4-A R5 deferred row.
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: recoveryStateChanged(baseSnapshot({ runId: undefined }), undefined),
			})
			const after = capture(wiring)
			expectZeroDelta("B8 recovery-state-changed (real transition, runId=undefined)", before, after)
		} finally {
			wiring.dispose()
		}
	})

	// ---------- B9 tracker-poison witness ----------

	/**
	 * B9 — rejected pre-session `run-started` does not poison
	 * the legitimate sequence.
	 *
	 * The wiring's three closed-over refs
	 * (`canonicalRunIdRef`, `awaitingNextCanonicalRunRef`,
	 * `postResetAwaitingCanonicalRunRef`) are not directly
	 * observable. Their effect IS observable through the
	 * recorder: any admitted event increments `eventsObserved`
	 * by 1. So the B9 discriminant is the post-fix-vs-pre-fix
	 * count of admitted events across the legitimate sequence.
	 *
	 * Sequence:
	 *   step 1 (no active session): inject run-started("run-poison")
	 *   step 2: switch active session on (sessionId=session-real)
	 *   step 3 (active session): inject run-started("run-real")
	 *   step 4 (active session): inject run-finished("run-real")
	 *
	 * Post-fix expected:
	 *   step 1 → REJECTED. recorder delta = 0.
	 *   step 3 → ADMITTED. canonicalRunIdRef := run-real.
	 *            eventsObserved += 1.
	 *   step 4 → ADMITTED (canonicalRunIdRef=run-real,
	 *            eventRunId=run-real → wrongActiveRun=false).
	 *            eventsObserved += 1.
	 *   Final: eventsObserved == 2, recordCount == 2,
	 *          staleRunTerminalSuppressed == 0,
	 *          step-1 recorder delta == 0.
	 *
	 * Pre-fix (the poisoning — B1 was admitted, not rejected):
	 *   step 1 → ADMITTED. canonicalRunIdRef := run-poison.
	 *            eventsObserved += 1.
	 *   step 3 → ADMITTED. canonicalRunIdRef := run-real
	 *            (overwritten).
	 *            eventsObserved += 1.
	 *   step 4 → ADMITTED (canonicalRunIdRef=run-real,
	 *            eventRunId=run-real → wrongActiveRun=false).
	 *            eventsObserved += 1.
	 *   Final: eventsObserved == 3, recordCount == 3.
	 *
	 * The B9 discriminant is *eventsObserved == 2*. Pre-fix
	 * produces 3 (the rejected step 1 was admitted); post-fix
	 * produces 2 (step 1 was rejected, no observer state was
	 * mutated).
	 *
	 * This proves the rejected pre-session run-started does not
	 * poison the closed-over authority state in the post-fix
	 * wiring: the legitimate sequence behaves as if the rejected
	 * event never happened.
	 */
	it("B9 tracker-poison witness: rejected no-session run-started does not poison the legitimate sequence", () => {
		const { deps, sessionCell } = makeDeps(undefined)
		const wiring = createTaskShadowHostWiring(deps)
		try {
			// Step 1: no active session, REJECTED run-started(run-poison).
			const s1 = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-x",
				event: runStarted(baseSnapshot({ runId: "run-poison" })),
			})
			const s2 = capture(wiring)
			expectZeroDelta("B9 step-1 reject run-started(run-poison)", s1, s2)

			// Step 2: switch active session on.
			sessionCell.current = makeActiveSession("session-real")

			// Step 3: with active session, ADMIT run-started(run-real).
			const s3 = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-real",
				event: runStarted(baseSnapshot({ runId: "run-real" })),
			})
			const s4 = capture(wiring)
			expect(s4.eventsObserved - s3.eventsObserved).toBe(1)
			expect(s4.recordCount - s3.recordCount).toBe(1)
			expect(s4.staleRunTerminalSuppressed - s3.staleRunTerminalSuppressed).toBe(0)

			// Step 4: with active session, ADMIT run-finished(run-real).
			const s5 = capture(wiring)
			wiring.observeCanonicalRuntimeEvent({
				origin: "RUNTIME_CANONICAL",
				sessionId: "session-real",
				event: runFinished(baseSnapshot({ runId: "run-real" })),
			})
			const s6 = capture(wiring)
			expect(s6.eventsObserved - s5.eventsObserved).toBe(1)
			expect(s6.recordCount - s5.recordCount).toBe(1)
			expect(s6.staleRunTerminalSuppressed - s5.staleRunTerminalSuppressed).toBe(0)

			// Final assertion: total eventsObserved == 2.
			// Pre-fix: 3 (step-1 poisoned canonicalRunIdRef, step-3
			//   overwrote it, step-4 accepted normally).
			// Post-fix: 2 (step-1 was rejected, canonicalRunIdRef
			//   never poisoned, step-3 + step-4 accepted normally).
			expect(s6.eventsObserved).toBe(2)
			expect(s6.recordCount).toBe(2)
			expect(s6.staleRunTerminalSuppressed).toBe(0)
		} finally {
			wiring.dispose()
		}
	})
})
