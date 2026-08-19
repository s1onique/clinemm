/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.4-B-FIXUP01
 * NO_ACTIVE_SESSION direct-production-boundary witness — POST-FIX
 * (frozen at adbb5e2d5; production guard at wiring.ts:393).
 *
 * PRE-FIX HISTORY (frozen at 0b2f6265c):
 *   The vacuous guard `if (activeSession && activeSession.sessionId
 *   !== input.sessionId) return` is FALSE under `getActiveSession()
 *   === undefined`. The C2.4-B witness reproduced 8/8 B rows =
 *   FAIL_OPEN at that vacuous guard. See
 *   `docs/architecture/elm/task-state-e5-e6-correction02-c24-witness-evidence.md`
 *   §A for the captured pre-fix evidence.
 *
 * POST-FIX (this file, frozen at adbb5e2d5):
 *   The wiring's NO_ACTIVE_SESSION guard is added BEFORE the
 *   second session-id check:
 *
 *     if (activeSession === undefined) {
 *         return
 *     }
 *     if (activeSession.sessionId !== input.sessionId) {
 *         return
 *     }
 *
 *   The guard is observation-only: it returns BEFORE the wiring
 *   reads `canonicalRunIdRef`, BEFORE either epoch fence is
 *   touched, and BEFORE `coordinator.observe(...)`. REDUCER is
 *   unchanged (C2.3 stays closed).
 *
 * WITNESS PATTERN (B1–B8):
 *   Ordinary `it()` with hard `expect(...).toBe(0)` assertions
 *   (reviewer R4 rejected the `it.fails` lenient pattern from
 *   the pre-fix commit, because `it.fails` accepts any throw).
 *   Each row asserts the recorder/comparator/fence/turnPhase
 *   delta across the canonical-event delivery is exactly zero.
 *
 *   With the post-fix guard active, all 8 B rows pass.
 *   Without the guard (pre-fix), all 8 B rows fail because the
 *   increment of `eventsObserved` is non-zero.
 *
 *   B6 uses a REAL execution edge (snapshot.execution.modelStreaming
 *   = true, previousExecution.modelStreaming = false) so the
 *   shadow adapter (sdk/packages/agents/.../shadow-adapter.ts
 *   lines 98–126, edge-triggered) emits `model_stream_started`.
 *   The pre-fix fixture was all-false on both sides, which
 *   produced NO TaskMsg — the adapter was silently dropping the
 *   event. The new edge makes B6 actually exercise a state-
 *   mutating canonical event in the projection.
 *
 *   B7/B8 use a REAL recovery transition (previousRecovery.state
 *   = "idle", snapshot.recovery.state = "recovering") so the
 *   shadow adapter (shadow-adapter.ts line 128, NOT edge-
 *   triggered) emits `recovery_changed` with a non-trivial
 *   projection. The pre-fix fixture was off/off (silent). The
 *   new transition makes B7/B8 actually exercise a state-
 *   mutating recovery edge.
 *
 * WITNESS PATTERN (B9 — tracker-poison witness):
 *   The wiring's three closed-over refs (`canonicalRunIdRef`,
 *   `awaitingNextCanonicalRunRef`, `postResetAwaitingCanonicalRunRef`)
 *   are NOT directly observable (no test fixture should reach
 *   into private refs). The BEHAVIORAL consequence IS observable
 *   through the recorder: any admitted event increments
 *   `eventsObserved` by 1.
 *
 *     step 1 (no active session): inject run-started("run-poison")
 *     step 2:                    switch active session on
 *                                (sessionId = session-real)
 *     step 3 (active session):   inject run-started("run-real")
 *     step 4 (active session):   inject run-finished("run-real")
 *
 *     POST-FIX: step 1 REJECTED. canonicalRunIdRef stays
 *               undefined. step 3 + step 4 ADMITTED. final
 *               eventsObserved = 2, recordCount = 2,
 *               staleRunTerminalSuppressed = 0.
 *
 *     PRE-FIX:  step 1 ADMITTED (canonicalRunIdRef :=
 *               "run-poison"). step 3 ADMITTED (canonicalRunIdRef
 *               := "run-real", overwriting). step 4 ADMITTED
 *               (canonicalRunIdRef = eventRunId =
 *               "run-real" → wrongActiveRun = false). final
 *               eventsObserved = 3, recordCount = 3.
 *
 *   The B9 discriminant is `eventsObserved == 2`. Pre-fix
 *   produces 3 (the rejected step 1 was admitted). Post-fix
 *   produces 2 (step 1 was rejected; the legitimate sequence
 *   behaves as if the rejected event never happened).
 *
 *   NOTE: the original C2.4-B-FIXUP01 sketch proposed a
 *   `staleRunTerminalSuppressed == 2` discriminant. That design
 *   was rejected because the post-fix gate at line 433 sets
 *   `wrongActiveRun = (active !== undefined && eventRunId !==
 *   undefined && active !== eventRunId)`. With
 *   canonicalRunIdRef = undefined (post-fix step 3 / step 4),
 *   `wrongActiveRun = false` regardless of `eventRunId`, so no
 *   suppression fires. The legitimate-sequence
 *   `eventsObserved`-discriminant above is the actual implementation.
 *
 * HARD INVARIANT (C2.4 plan §3.2 acceptance gate):
 *
 *     NO_ACTIVE_SESSION
 *     + state-mutating canonical event
 *     = NO TaskState authority
 *     = NO recorder mutation
 *     = NO comparator mutation
 *     = NO run-tracker mutation
 *     = NO comparator.shadow mutation
 *
 * DENOMINATORS (reviewer R5):
 *   canonical event types audited = 7
 *       (run-started, run-finished, run-failed, tool-started,
 *        tool-finished, execution-state-changed,
 *        recovery-state-changed)
 *   NO_ACTIVE_SESSION boundary rows = 8
 *       (B8 is a second provenance variant of
 *        recovery-state-changed — `runId === undefined` — not
 *        an eighth event TYPE)
 *   tracker-poison witnesses       = 1 (B9)
 *   boundary-row outcome           = 9/9 PASS_CLOSED
 */

import type {
	AgentMessage,
	AgentRuntimeEvent,
	AgentRuntimeExecutionState,
	AgentRuntimeRecoverySnapshot,
	AgentRuntimeStateSnapshot,
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

function recoverySnapshot(state: RecoveryState = "idle"): AgentRuntimeRecoverySnapshot {
	return {
		state,
		tracker: {
			state,
			currentRepairAttempts: 0,
			equivalentRepeatCount: 0,
			blockedExactKeys: [],
			blockedFamilies: [],
		},
		secondStage: "idle",
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
		toolCall: {
			type: "tool-call",
			toolCallId: "tc-1",
			toolName: "test-tool",
			input: {},
		},
	}
}

function toolFinished(snapshot: AgentRuntimeStateSnapshot = baseSnapshot()): AgentRuntimeEvent {
	return {
		type: "tool-finished",
		snapshot,
		iteration: 0,
		toolCall: {
			type: "tool-call",
			toolCallId: "tc-1",
			toolName: "test-tool",
			input: {},
		},
		message: {
			id: "msg-1",
			role: "tool",
			content: [],
			createdAt: 0,
		},
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
	modelLifecycleKind: unknown
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
		modelLifecycleKind: wiring.comparator.debugSnapshot().lifecycle.kind,
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
	expect(after.modelLifecycleKind, `[${label}] comparator.shadow.lifecycle.kind`).toBe(before.modelLifecycleKind)
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
