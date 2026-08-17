/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.2:
 *
 * Focused unified-observer tests. Each test asserts ONE of the
 * required C2.2 hard-green witnesses (T8 D11, T1/T2/T10/T12, plus
 * the U1..U12 architecture matrix from ACT §33).
 *
 * All ingresses flow through `coordinator.observe(input)`. The
 * production owner is the single source of truth.
 */
import type { AgentMessage, AgentRuntimeEvent, AgentRuntimeStateSnapshot } from "@cline/shared"
import { describe, expect, it } from "vitest"
import type { TurnPhase } from "@/shared/ExtensionMessage"
import { TaskShadowComparator } from "../task-state-shadow"
import { createTaskShadowObservationCoordinator } from "../task-state-shadow-coordinator"
import type { ArbiterSnapshot } from "../task-state-shadow-recorder"
import { TaskShadowRecorder } from "../task-state-shadow-recorder"

const NOW = 1_700_000_000_000

function makeSnapshot(): AgentRuntimeStateSnapshot {
	return {
		agentId: "agent_test",
		runId: "run_test",
		status: "running",
		iteration: 0,
		messages: [] as readonly AgentMessage[],
		pendingToolCalls: [] as readonly string[],
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		},
	}
}

function emptyArbiter(): ArbiterSnapshot {
	return {
		execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		recoveryState: "idle",
		status: "idle",
		pendingToolCalls: [],
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

function makeExecEvent(prev: boolean, cur: boolean): AgentRuntimeEvent {
	return {
		type: "execution-state-changed",
		snapshot: {
			...makeSnapshot(),
			execution: {
				modelStreaming: cur,
				tooling: false,
				awaitingApproval: false,
			},
		},
		previousExecution: {
			modelStreaming: prev,
			tooling: false,
			awaitingApproval: false,
		},
	}
}

function makeApprovalEvent(prev: boolean, cur: boolean): AgentRuntimeEvent {
	return {
		type: "execution-state-changed",
		snapshot: {
			...makeSnapshot(),
			execution: {
				modelStreaming: false,
				tooling: false,
				awaitingApproval: cur,
			},
		},
		previousExecution: {
			modelStreaming: false,
			tooling: false,
			awaitingApproval: prev,
		},
	}
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

describe("C2.2 T1/T2 — HOST_TASK ingress produces exactly one record", () => {
	it("T1.1: emitTaskRequested produces exactly one record with event=task_requested", () => {
		const { coordinator, recorder } = makeCoordinator()
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-1",
			msg: { type: "task_requested", taskId: "task-1", at: NOW },
		})
		const records = recorder.getRecords()
		expect(records.length).toBe(1)
		expect(records[0]!.event).toBe("task_requested")
	})

	it("T2.1: emitTaskCancelled produces exactly one record with event=task_cancelled", () => {
		const { coordinator, recorder } = makeCoordinator()
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-1",
			msg: { type: "task_requested", taskId: "task-1", at: NOW },
		})
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-1",
			msg: { type: "task_cancelled", at: NOW + 1 },
		})
		const records = recorder.getRecords()
		expect(records.length).toBe(2)
		expect(records.find((r) => r.event === "task_cancelled")).toBeDefined()
	})

	it("T2.2: emitTaskReset produces exactly one record with event=task_reset", () => {
		const { coordinator, recorder } = makeCoordinator()
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-1",
			msg: { type: "task_reset", at: NOW },
		})
		const records = recorder.getRecords()
		expect(records.find((r) => r.event === "task_reset")).toBeDefined()
	})

	it("T2.3: emitSameTaskContinued produces exactly one record", () => {
		const { coordinator, recorder } = makeCoordinator()
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-1",
			msg: { type: "same_task_continued", at: NOW },
		})
		const records = recorder.getRecords()
		expect(records.find((r) => r.event === "same_task_continued")).toBeDefined()
	})
})

describe("C2.2 T8 — D11_HOST_PREENGAGED closes the W12 false-active window", () => {
	it("T8.1: host-pre-engaged interval (legacy streaming, canonical running but modelStreaming=false) classifies as D11, not D02", () => {
		const arbiter: ArbiterSnapshot = {
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		}
		const { coordinator, recorder } = makeCoordinator({
			arbiter: () => arbiter,
			legacyPhase: () => "streaming",
			activeSessionId: () => "session-A",
		})
		// canonical execution event: modelStreaming stays false (post-engaged).
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeExecEvent(false, false),
		})
		const records = recorder.getRecords()
		// Exactly one record (the canonical event), classified D11.
		expect(records.length).toBe(1)
		expect(records[0]!.classification).toBe("D11_HOST_PREENGAGED")
		expect(records[0]!.arbitration).toBe("BOTH_VALID_DIFFERENT_PROJECTION")
	})

	it("T8.2: canonical modelStreaming false->true resolves D11 -> D00_AGREE", () => {
		const arbiter: ArbiterSnapshot = {
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		}
		// Pre-engaged phase.
		const { coordinator, recorder } = makeCoordinator({
			arbiter: () => arbiter,
			legacyPhase: () => "streaming",
			activeSessionId: () => "session-A",
		})
		// Pre-engaged interval (modelStreaming stays false).
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeExecEvent(false, false),
		})
		// Now canonical modelStreaming flips to true. The shadow
		// drives model_stream_started. Legacy is still streaming.
		// The shadow's projection becomes streaming — agreement.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeExecEvent(false, true),
		})
		const records = recorder.getRecords()
		// Two records: the first D11, the second D00_AGREE.
		expect(records.length).toBe(2)
		expect(records[0]!.classification).toBe("D11_HOST_PREENGAGED")
		expect(records[1]!.classification).toBe("D00_AGREE")
	})
})

describe("C2.2 T10 — canonical recovery produces exactly one record", () => {
	it("T10.1: canonical recovery-state-changed produces exactly one record", () => {
		const arbiter: ArbiterSnapshot = {
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "circuit_open",
			status: "running",
			pendingToolCalls: [],
		}
		const { coordinator, recorder } = makeCoordinator({
			arbiter: () => arbiter,
			activeSessionId: () => "session-A",
		})
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "circuit_open"),
		})
		const records = recorder.getRecords()
		expect(records.length).toBe(1)
		// shadow translates canonical recovery-state-changed to the
		// recovery_changed TaskMsg.
		expect(records[0]!.event).toBe("recovery_changed")
	})

	it("T10.2: HOST_RECOVERY is DIAGNOSTIC_ONLY when canonicalAvailable=true (Policy A: never authoritative when canonical transport exists)", () => {
		const { coordinator, recorder } = makeCoordinator()
		// Canonical recovery first.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		// Host recovery (canonicalAvailable=true). Policy A: never
		// authoritative. Increments diagnostic counter, no record,
		// no state mutation.
		coordinator.observe({
			kind: "host-recovery",
			origin: "HOST_RECOVERY",
			sessionId: "session-A",
			msg: {
				type: "recovery_changed",
				at: NOW + 1,
				projection: { state: "recovering", episodeFailures: 0, circuitNoticeCount: 0 },
			},
			canonicalAvailable: true,
		})
		const counts = recorder.getCounts()
		expect(counts.eventsObserved).toBe(1)
		expect(counts.observationsDiagnosticByOrigin.HOST_RECOVERY).toBe(1)
		expect(counts.observationsSuppressedByOrigin.HOST_RECOVERY).toBe(0)
		expect(counts.fallbackRecoveryApplied).toBe(0)
	})

	it("T10.3: HOST_RECOVERY is FALLBACK_APPLY when canonicalAvailable=false (Hub/Remote)", () => {
		const { coordinator, recorder } = makeCoordinator()
		coordinator.observe({
			kind: "host-recovery",
			origin: "HOST_RECOVERY",
			sessionId: "session-A",
			msg: {
				type: "recovery_changed",
				at: NOW,
				projection: {
					state: "recovering",
					episodeFailures: 0,
					circuitNoticeCount: 0,
				},
			},
			canonicalAvailable: false,
		})
		const counts = recorder.getCounts()
		expect(counts.fallbackRecoveryApplied).toBe(1)
		expect(counts.observationsSuppressedByOrigin.HOST_RECOVERY).toBe(0)
	})
})

describe("C2.2 T12 — exactly one observation per state-mutating ingress", () => {
	it("T12.1: every ingress kind produces exactly one record", () => {
		const arbiter: ArbiterSnapshot = {
			execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			recoveryState: "idle",
			status: "running",
			pendingToolCalls: [],
		}
		const { coordinator, recorder } = makeCoordinator({
			arbiter: () => arbiter,
			activeSessionId: () => "session-A",
		})
		// HOST_TASK
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-1",
			msg: { type: "task_requested", taskId: "task-1", at: NOW },
		})
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-1",
			msg: { type: "task_reset", at: NOW + 1 },
		})
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-2",
			msg: { type: "task_requested", taskId: "task-2", at: NOW + 2 },
		})
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-2",
			msg: { type: "task_cancelled", at: NOW + 3 },
		})
		coordinator.observe({
			kind: "host-task",
			origin: "HOST_TASK",
			taskId: "task-2",
			msg: { type: "same_task_continued", at: NOW + 4 },
		})
		// RUNTIME_CANONICAL execution
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeExecEvent(false, false),
		})
		// RUNTIME_CANONICAL recovery
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		const records = recorder.getRecords()
		const counts = recorder.getCounts()
		// 7 ingresses, all should be APPLY (no stale, no suppress).
		expect(counts.eventsObserved).toBe(7)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_CANONICAL).toBe(0)
		expect(counts.observationsSuppressedByOrigin.HOST_TASK).toBe(0)
		expect(counts.observationsSuppressedByOrigin.HOST_RECOVERY).toBe(0)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(0)
		const taskRequested = records.filter((r) => r.event === "task_requested").length
		const taskReset = records.filter((r) => r.event === "task_reset").length
		const taskCancelled = records.filter((r) => r.event === "task_cancelled").length
		const sameTaskContinued = records.filter((r) => r.event === "same_task_continued").length
		expect(taskRequested).toBe(2)
		expect(taskReset).toBe(1)
		expect(taskCancelled).toBe(1)
		expect(sameTaskContinued).toBe(1)
	})

	it("T12.2: reconstructed equivalent of a canonical edge is SUPPRESSED", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		// First canonical event establishes the edge.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		// Now a reconstructed event with the same edge arrives. It
		// is SUPPRESSED because canonical authority already produced it.
		coordinator.observe({
			kind: "runtime-reconstructed",
			origin: "RUNTIME_RECONSTRUCTED",
			sessionId: "session-A",
			event: makeRecoveryEvent("idle", "recovering"),
		})
		const counts = recorder.getCounts()
		expect(counts.eventsObserved).toBe(1)
		expect(counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(1)
		expect(counts.eventsObserved + counts.observationsSuppressedByOrigin.RUNTIME_RECONSTRUCTED).toBe(2)
	})
})

describe("C2.2 — stale session, exception isolation, and invariants", () => {
	it("U9: stale canonical event (session mismatch) does not mutate state", () => {
		const { coordinator, recorder } = makeCoordinator({
			activeSessionId: () => "session-A",
		})
		// Canonical event for a different session.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-B",
			event: makeExecEvent(false, true),
		})
		const counts = recorder.getCounts()
		expect(counts.eventsObserved).toBe(0)
	})

	it("U12: observer exception is isolated (observerError counter, no crash)", () => {
		const comparator = new TaskShadowComparator()
		const recorder = new TaskShadowRecorder()
		const coordinator = createTaskShadowObservationCoordinator({
			comparator,
			recorder,
			now: () => NOW,
			getLegacyPhase: () => {
				throw new Error("synthetic getLegacyPhase throw")
			},
			getArbiterSnapshot: () => emptyArbiter(),
			getActiveSessionId: () => undefined,
			getRuntimeStatus: () => "idle",
		})
		// Should not throw.
		coordinator.observe({
			kind: "runtime-canonical",
			origin: "RUNTIME_CANONICAL",
			sessionId: "session-A",
			event: makeExecEvent(false, true),
		})
		const counts = recorder.getCounts()
		expect(counts.observerErrors).toBeGreaterThanOrEqual(1)
	})
})
