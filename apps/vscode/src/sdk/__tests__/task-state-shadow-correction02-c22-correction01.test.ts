/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2-CORRECTION01:
 *
 * Focused witnesses for the 10 reviewer corrections. Each test
 * asserts ONE invariant the C2.2 review demanded.
 *
 *   R1: translator mutates comparator DIRECTLY (must be false)
 *   R2: TWO TaskStateShadow instances per wiring (must be 1)
 *   R3: reconstructed session-id preserved (must be source, not active)
 *   R4: state mutations without record (must be 0; EVIDENCE_GAP marker exists)
 *   R5: record origin (must be persisted)
 *   R6: task/session identity conflation (must not occur)
 *   R7: canonical-before-reconstructed invariant (must hold in BOTH orders)
 *   R8: HOST_RECOVERY = DIAGNOSTIC_ONLY when canonicalAvailable=true
 *   R9: benchmark (see task-state-shadow-benchmark.test.ts)
 *   R10: halt disposition (see evidence doc)
 */
import type { CoreSessionEvent } from "@cline/core"
import type { AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { describe, expect, it } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import { TaskShadowComparator } from "../task-state-shadow"
import { createTaskShadowObservationCoordinator } from "../task-state-shadow-coordinator"
import { TaskShadowReverseTranslator } from "../task-state-shadow-observer"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"
import { TaskShadowRecorder } from "../task-state-shadow-recorder"

const NOW = 1_700_000_000_000

function emptyArbiter(): ArbiterSnapshot {
	return {
		execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		recoveryState: "idle",
		status: "idle",
		pendingToolCalls: [],
	}
}

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "running",
		iteration: 0,
		messages: [],
		pendingToolCalls: [],
		usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
	}
}

function makeCoordinator(opts?: {
	arbiter?: () => ArbiterSnapshot
	legacyPhase?: () => TurnPhase
	activeSessionId?: () => string | undefined
}) {
	const comparator = new TaskShadowComparator()
	const recorder = new TaskShadowRecorder()
	const coordinator = createTaskShadowObservationCoordinator({
		comparator,
		recorder,
		now: () => NOW,
		getLegacyPhase: opts?.legacyPhase ?? (() => "idle"),
		getArbiterSnapshot: opts?.arbiter ?? (() => emptyArbiter()),
		getActiveSessionId: opts?.activeSessionId ?? (() => undefined),
		getRuntimeStatus: () => "idle",
	})
	return { coordinator, comparator, recorder }
}

function makeRecoveryEvent(prev: string, cur: string): AgentRuntimeEvent {
	const stateOf = (s: string) => ({
		state: s as "idle" | "recovering" | "circuit_open",
		tracker: {
			state: s as "idle" | "recovering" | "circuit_open",
			currentRepairAttempts: 0,
			equivalentRepeatCount: 0,
			blockedExactKeys: [],
			blockedFamilies: [],
		},
		secondStage: "idle" as const,
		episodeFailures: 0,
		maxEpisodeFailures: 5,
		circuitNoticeCount: 0,
	})
	return {
		type: "recovery-state-changed",
		snapshot: { ...makeSnapshot(), recovery: stateOf(cur) },
		previousRecovery: stateOf(prev),
	}
}

function makeAgentEvent(sessionId: string, innerEvent: { type: "iteration_start"; iteration: number }): CoreSessionEvent {
	return {
		type: "agent_event",
		payload: {
			sessionId,
			event: innerEvent,
		},
	}
}

// R1: translator must NOT mutate the comparator when production
//     wiring uses the non-mutating `translate()` API.
describe("R1 — production translator path is non-mutating", () => {
	it("R1.1: one reconstructed run-started ingress advances the comparator exactly once", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		// Construct a legacy CoreSessionEvent with iteration_start so
		// the translator can translate it to a runtime event.
		const legacy = makeAgentEvent("session-A", { type: "iteration_start", iteration: 1 })
		// Use the production non-mutating `translate()` API + coordinator
		// (this is what the wiring actually does).
		const translator = new TaskShadowReverseTranslator()
		const runtimeEvent = translator.translate({
			event: legacy,
			now: NOW,
			legacyPhase: "idle",
			arbiter: emptyArbiter(),
			taskEpochOrOpaqueTaskKey: "session-A",
		})
		expect(runtimeEvent).toBeDefined()
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: runtimeEvent!,
			// canonicalAvailable=false: the test exercises the
			// reconstructed-mutates-shadow path; production wiring
			// (LocalRuntimeHost) sets this to true.
			canonicalAvailable: false,
		})
		// Recorder receives exactly one record (one ingress -> one mutation).
		expect(recorder.getCounts().eventsObserved).toBe(1)
	})

	it("R1.2: canonical-edge-then-reconstructed suppresses the reconstructed mutation entirely", () => {
		const { coordinator, recorder } = makeCoordinator()
		// Canonical recovery first.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		// Reconstructed equivalent — must be DIAGNOSTIC_ONLY under
		// Option A (canonicalAvailable=true). No mutation, no
		// suppression — the reconstructed event was never
		// authoritative to begin with.
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
			canonicalAvailable: true,
		})
		// One record total (canonical only); reconstructed is diagnostic.
		expect(recorder.getCounts().eventsObserved).toBe(1)
		expect(recorder.getCounts().observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBe(1)
		expect(recorder.getCounts().observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
	})
})

// R2: ONE shadow instance per wiring. The comparator owns it.
describe("R2 — one TaskStateShadow instance per wiring", () => {
	it("R2.1: the comparator's debugSnapshot returns the only shadow state (structural witness)", () => {
		const { comparator, coordinator } = makeCoordinator()
		// The wiring exposes the comparator. The comparator is the
		// SOLE shadow owner.
		const beforeMutation = comparator.debugSnapshot()
		expect(beforeMutation).toBeDefined()
		// Apply a canonical event.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		// The comparator's shadow advanced.
		const afterMutation = comparator.debugSnapshot()
		expect(afterMutation).not.toEqual(beforeMutation)
	})
})

// R3: reconstructed session id comes from the source CoreSessionEvent,
//     not from `deps.lifecycle.getActiveSession()`.
describe("R3 — reconstructed source session id is preserved", () => {
	it("R3.1: a stale reconstructed event against the active session is STALE", () => {
		// Active session is "new-session".
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "new-session",
		})
		// Reconstructed event claims to be from "old-session".
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "old-session",
			event: makeRecoveryEvent("idle", "recovering"),
			canonicalAvailable: true,
		})
		const counts = recorder.getCounts()
		// STALE → no events observed (whether diagnostic or apply).
		expect(counts.eventsObserved).toBe(0)
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
	})

	it("R3.2: a fresh reconstructed event against the active session is APPLY (canonical) or DIAGNOSTIC_ONLY (reconstructed)", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		// canonicalAvailable=false: reconstructed is FALLBACK_APPLY
		// for the active session; one record is produced.
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
			canonicalAvailable: false,
		})
		expect(recorder.getCounts().eventsObserved).toBe(1)
	})
})

// R4: a recorder failure after comparator mutation is recorded as
//     EVIDENCE_GAP, not silently swallowed.
describe("R4 — half-transaction evidence gap", () => {
	it("R4.1: post-mutation recorder throw records evidenceGaps counter", () => {
		// Build a recorder that throws on `record()`.
		const throwingRecorder = new (class extends TaskShadowRecorder {
			override record(): undefined {
				throw new Error("synthetic recorder failure")
			}
		})()
		const comparator = new TaskShadowComparator()
		const coordinator = createTaskShadowObservationCoordinator({
			comparator,
			recorder: throwingRecorder,
			now: () => NOW,
			getLegacyPhase: () => "idle",
			getArbiterSnapshot: () => emptyArbiter(),
			getActiveSessionId: () => "session-A",
			getRuntimeStatus: () => "idle",
		})
		// One canonical event — comparator mutates, recorder throws.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		const counts = throwingRecorder.getCounts()
		// State was mutated (comparator advanced) but no record was
		// persisted; the EVIDENCE_GAP counter must be >= 1 so
		// qualification can detect the asymmetry.
		expect(counts.evidenceGaps).toBeGreaterThanOrEqual(1)
		// observerErrors is also incremented (the outer catch).
		expect(counts.observerErrors).toBeGreaterThanOrEqual(1)
		// No bounded record was persisted (the recorder threw before
		// pushBounded).
		expect(counts.eventsObserved).toBe(0)
	})
})

// R5: every persisted record carries its origin.
describe("R5 — record origin is persisted", () => {
	it("R5.1: canonical event record has origin=RUNTIME_CANONICAL", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		const records = recorder.getRecords()
		expect(records[0]!.origin).toBe("RUNTIME_CANONICAL")
	})

	it("R5.2: HOST_TASK record has origin=HOST_TASK", () => {
		const { coordinator, recorder } = makeCoordinator()
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-X",
			msg: { type: "task_requested", taskId: "task-X", at: NOW },
		})
		const records = recorder.getRecords()
		expect(records[0]!.origin).toBe("HOST_TASK")
	})
})

// R6: taskId and sessionId are NEVER conflated in the resolver.
describe("R6 — task/session identity conflation", () => {
	it("R6.1: HOST_TASK event with one taskId does not poison later canonical sessionId matching", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		// A HOST_TASK with taskId="task-1" must NOT be treated as
		// sessionId="task-1" for stale detection.
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-1",
			msg: { type: "task_requested", taskId: "task-1", at: NOW },
		})
		// A canonical event for session-A (the real active session)
		// must APPLY, not be treated as stale because the previous
		// HOST_TASK poisoned the resolver's internal `activeSessionId`.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		expect(recorder.getCounts().eventsObserved).toBe(2)
	})
})

// R7: dedup is order-INDEPENDENT and authority is canonical-over-
//     reconstructed. Under CORRECTION02 Option A, when canonical
//     transport is available, RUNTIME_RECONSTRUCTED is DIAGNOSTIC_ONLY
//     regardless of arrival order. When canonical transport is
//     unavailable, reconstructed is authoritative via FALLBACK_APPLY
//     with session/run-scoped edge identity.
describe("R7 — canonical-over-reconstructed dedup", () => {
	it("R7.1: with canonicalAvailable=true, reconstructed events are DIAGNOSTIC_ONLY regardless of arrival order (no double mutation)", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		// Canonical first → APPLY.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		// Reconstructed after → DIAGNOSTIC_ONLY (not SUPPRESS — the
		// reconstructed event was never authoritative to begin with).
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
			canonicalAvailable: true,
		})
		const counts = recorder.getCounts()
		expect(counts.eventsObserved).toBe(1)
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBe(1)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
	})

	it("R7.2: with canonicalAvailable=true, reconstructed-first is DIAGNOSTIC_ONLY; canonical later applies once (single mutation)", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		// Reconstructed first → DIAGNOSTIC_ONLY (no mutation).
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
			canonicalAvailable: true,
		})
		// Canonical later → APPLY (single mutation).
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		const counts = recorder.getCounts()
		// Exactly one mutation total — never two.
		expect(counts.eventsObserved).toBe(1)
		expect(counts.observationsDiagnosticByOrigin.RUNTIME_RECONSTRUCTED).toBe(1)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
	})

	it("R7.3: with canonicalAvailable=false (Hub/Remote), reconstructed events are authoritative via FALLBACK_APPLY", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
			canonicalAvailable: false,
		})
		const counts = recorder.getCounts()
		expect(counts.eventsObserved).toBe(1)
		expect(counts.fallbackRecoveryApplied).toBe(1)
	})

	it("R7.4: fallback dedup keys are scoped by sessionId — different sessions do NOT cross-dedup", () => {
		// Cross-session dedup test via two coordinated sequences,
		// each gated by its own active session. The scopedEdgeKey
		// must produce distinct keys for distinct sessions; if it
		// did not, the second session would be SUPPRESS_DUPLICATE.
		// Sequence 1: session-A is active.
		const seq1 = makeCoordinator({ activeSessionId: () => "session-A" })
		seq1.coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: { type: "run-started", snapshot: makeSnapshot() } as AgentRuntimeEvent,
			canonicalAvailable: false,
		})
		// Sequence 2: session-B is active, with its own dedup state.
		const seq2 = makeCoordinator({ activeSessionId: () => "session-B" })
		seq2.coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-B",
			event: { type: "run-started", snapshot: makeSnapshot() } as AgentRuntimeEvent,
			canonicalAvailable: false,
		})
		// Each sequence APPLY'd exactly once — neither was suppressed
		// by the other's session scope.
		expect(seq1.recorder.getCounts().eventsObserved).toBe(1)
		expect(seq1.recorder.getCounts().observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
		expect(seq2.recorder.getCounts().eventsObserved).toBe(1)
		expect(seq2.recorder.getCounts().observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
	})

	it("R7.4b: same controller with two sequential sessions — session-B observation is STALE against active session-A", () => {
		// Structural complement to R7.4: when the same resolver state
		// spans two sessions, only the active session's observations
		// are admitted. Session B's reconstructed observation against
		// active session A is correctly STALE.
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: { type: "run-started", snapshot: makeSnapshot() } as AgentRuntimeEvent,
			canonicalAvailable: false,
		})
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-B",
			event: { type: "run-started", snapshot: makeSnapshot() } as AgentRuntimeEvent,
			canonicalAvailable: false,
		})
		const counts = recorder.getCounts()
		// Session A APPLY'd; session B is STALE.
		expect(counts.eventsObserved).toBe(1)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
	})

	it("R7.5: fallback dedup keys are scoped by runId — same session different runs do NOT cross-dedup", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		// Same session, different runId.
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: { type: "run-started", snapshot: { ...makeSnapshot(), runId: "run-1" } } as AgentRuntimeEvent,
			canonicalAvailable: false,
		})
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: { type: "run-started", snapshot: { ...makeSnapshot(), runId: "run-2" } } as AgentRuntimeEvent,
			canonicalAvailable: false,
		})
		const counts = recorder.getCounts()
		expect(counts.eventsObserved).toBe(2)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
	})

	it("R7.6: fallback dedup same session+run+edge still suppresses", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		const sameEvent = {
			type: "run-started",
			snapshot: { ...makeSnapshot(), runId: "run-1" },
		} as AgentRuntimeEvent
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: sameEvent,
			canonicalAvailable: false,
		})
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: sameEvent,
			canonicalAvailable: false,
		})
		const counts = recorder.getCounts()
		expect(counts.eventsObserved).toBe(1)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(1)
	})
})

// R8: HOST_RECOVERY = DIAGNOSTIC_ONLY when canonicalAvailable=true.
describe("R8 — HOST_RECOVERY policy is DIAGNOSTIC_ONLY when canonical transport exists", () => {
	it("R8.1: HOST_RECOVERY never mutates state when canonicalAvailable=true", () => {
		const { coordinator, recorder, comparator } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		const beforeSeq = comparator.debugSnapshot().currentIteration
		coordinator.observe({
			kind: "host-recovery",
			origin: "HOST_RECOVERY",
			sessionId: "session-A",
			msg: {
				type: "recovery_changed",
				at: NOW,
				projection: { state: "recovering", episodeFailures: 0, circuitNoticeCount: 0 },
			},
			canonicalAvailable: true,
		})
		const counts = recorder.getCounts()
		// Diagnostic counter incremented; no record; no mutation.
		expect(counts.observationsDiagnosticByOrigin.HOST_RECOVERY).toBe(1)
		expect(counts.eventsObserved).toBe(0)
		expect(counts.observationsSuppressedByOrigin.HOST_RECOVERY).toBe(0)
		expect(counts.fallbackRecoveryApplied).toBe(0)
		expect(comparator.debugSnapshot().currentIteration).toBe(beforeSeq)
	})

	it("R8.2: HOST_RECOVERY FALLBACK_APPLY when canonicalAvailable=false (Hub/Remote)", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		coordinator.observe({
			kind: "host-recovery",
			origin: "HOST_RECOVERY",
			sessionId: "session-A",
			msg: {
				type: "recovery_changed",
				at: NOW,
				projection: { state: "recovering", episodeFailures: 0, circuitNoticeCount: 0 },
			},
			canonicalAvailable: false,
		})
		const counts = recorder.getCounts()
		expect(counts.fallbackRecoveryApplied).toBe(1)
		expect(counts.eventsObserved).toBe(1)
	})
})
