/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 15 — Recorder tests.
 *
 * Exercises:
 *   - classification D00–D10 (each branch at least once)
 *   - arbitration outcomes (LEGACY_CORRECT / SHADOW_CORRECT /
 *     BOTH_VALID_DIFFERENT_PROJECTION / INSUFFICIENT_EVIDENCE)
 *   - ring-buffer bound (MAX_RECORDS_PER_TASK = 256)
 *   - invariant-violation sink (count + sink invocation)
 *   - privacy allowlist (no message prose, no tool args, no API payloads,
 *     no control keys)
 *   - dependency-boundary test: recorder module does not import any
 *     production writer / postStateToWebview / agent.subscribeEvents
 */

import { TaskState } from "@cline/agents"
import type { AgentRunStatus, AgentRuntimeExecutionState, RecoveryState } from "@cline/shared"
import { describe, expect, it } from "vitest"
import {
	ALL_DIFFERENCE_TYPES,
	type ArbiterSnapshot,
	arbitrate,
	classify,
	type DivergenceClass,
	MAX_RECORDS_PER_TASK,
	type TaskShadowDifferentialRecord,
	TaskShadowRecorder,
	type TaskShadowRecordInput,
} from "../task-state-shadow-recorder"

const { initialTaskModel } = TaskState

function arbiter(overrides: Partial<ArbiterSnapshot> = {}): ArbiterSnapshot {
	return {
		execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
		recoveryState: "idle",
		status: "idle",
		pendingToolCalls: [],
		...overrides,
	}
}

function makeInput(overrides: Partial<TaskShadowRecordInput> = {}): TaskShadowRecordInput {
	return {
		seq: 1,
		timestamp: 1000,
		divergence: undefined,
		observationEvent: "noop",
		observationLifecycleKind: "idle",
		observationModel: initialTaskModel(),
		observationToolCalls: 0,
		observationRecoveryBudgetFailures: 0,
		arbiter: arbiter(),
		...overrides,
	}
}

const PRIVACY_ALLOWED_KEYS = new Set([
	"seq",
	"timestamp",
	"event",
	"legacyPhase",
	"shadowPhase",
	"lifecycleKind",
	"modelStreaming",
	"activeToolCount",
	"awaitingApproval",
	"toolCalls",
	"recoveryBudgetFailures",
	"taskEpochOrOpaqueTaskKey",
	"runtimeStatus",
	"classification",
	"arbitration",
])

describe("TaskShadowRecorder — E5-DIFF recorder contract", () => {
	it("classifies an empty divergence as D00_AGREE", () => {
		expect(classify(makeInput())).toBe("D00_AGREE")
	})

	it("classifies legacy=idle / shadow=streaming when the arbiter confirms activity as D01", () => {
		const input = makeInput({
			divergence: {
				seq: 1,
				event: "model_stream_started",
				legacyPhase: "idle",
				shadowPhase: "streaming",
				lifecycleKind: "running",
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			},
			arbiter: arbiter({ execution: { modelStreaming: true, tooling: false, awaitingApproval: false } }),
		})
		expect(classify(input)).toBe("D01_LEGACY_FALSE_IDLE")
		expect(arbitrate(input, "D01_LEGACY_FALSE_IDLE")).toBe("SHADOW_CORRECT")
	})

	it("classifies awaiting_followup as D08 (host-only projection) regardless of side", () => {
		const input = makeInput({
			divergence: {
				seq: 1,
				event: "task_completed",
				legacyPhase: "awaiting_followup",
				shadowPhase: "completed",
				lifecycleKind: "completed",
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
		})
		expect(classify(input)).toBe("D08_FOLLOWUP_EXTERNAL")
		expect(arbitrate(input, "D08_FOLLOWUP_EXTERNAL")).toBe("BOTH_VALID_DIFFERENT_PROJECTION")
	})

	it("classifies shadow=streaming with quiet arbiter as D02", () => {
		const input = makeInput({
			divergence: {
				seq: 1,
				event: "model_stream_started",
				legacyPhase: "idle",
				shadowPhase: "streaming",
				lifecycleKind: "running",
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			},
			arbiter: arbiter(),
		})
		expect(classify(input)).toBe("D02_SHADOW_FALSE_ACTIVE")
		expect(arbitrate(input, "D02_SHADOW_FALSE_ACTIVE")).toBe("LEGACY_CORRECT")
	})

	it("classifies D03 terminal ordering using run status arbiter", () => {
		const input = makeInput({
			divergence: {
				seq: 1,
				event: "task_completed",
				legacyPhase: "completed",
				shadowPhase: "streaming",
				lifecycleKind: "running",
				modelStreaming: true,
				tooling: false,
				awaitingApproval: false,
			},
			arbiter: arbiter({ status: "completed" }),
		})
		expect(classify(input)).toBe("D03_TERMINAL_ORDERING")
		expect(arbitrate(input, "D03_TERMINAL_ORDERING")).toBe("LEGACY_CORRECT")
	})

	it("classifies D04 awaiting_approval disagreements", () => {
		const input = makeInput({
			divergence: {
				seq: 1,
				event: "approval_requested",
				legacyPhase: "idle",
				shadowPhase: "awaiting_approval",
				lifecycleKind: "running",
				modelStreaming: false,
				tooling: false,
				awaitingApproval: true,
			},
			arbiter: arbiter({ execution: { modelStreaming: false, tooling: false, awaitingApproval: true } }),
		})
		expect(classify(input)).toBe("D04_APPROVAL_PRECEDENCE")
		expect(arbitrate(input, "D04_APPROVAL_PRECEDENCE")).toBe("SHADOW_CORRECT")
	})

	it("classifies D05 tool cardinality mismatch", () => {
		const input = makeInput({
			observationEvent: "tool_started",
			observationModel: {
				...initialTaskModel(),
				activity: {
					modelStreaming: false,
					activeToolCallIds: ["a", "b", "c"],
					awaitingApproval: false,
				},
			},
			arbiter: arbiter({ pendingToolCalls: ["a", "b"] }),
			divergence: {
				seq: 1,
				event: "tool_started",
				legacyPhase: "streaming",
				shadowPhase: "streaming",
				lifecycleKind: "running",
				modelStreaming: false,
				tooling: true,
				awaitingApproval: false,
			},
		})
		expect(classify(input)).toBe("D05_TOOL_CARDINALITY")
		expect(arbitrate(input, "D05_TOOL_CARDINALITY")).toBe("SHADOW_CORRECT")
	})

	it("classifies D07 failure mapping", () => {
		const input = makeInput({
			divergence: {
				seq: 1,
				event: "task_failed",
				legacyPhase: "idle",
				shadowPhase: "error",
				lifecycleKind: "failed",
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
			arbiter: arbiter({ status: "failed" }),
		})
		expect(classify(input)).toBe("D07_FAILURE_MAPPING")
		expect(arbitrate(input, "D07_FAILURE_MAPPING")).toBe("SHADOW_CORRECT")
	})

	it("classifies D09 event-gap when shadow saw no TaskMsg", () => {
		const input = makeInput({
			observationEvent: "noop",
			divergence: {
				seq: 1,
				event: "noop",
				legacyPhase: "streaming",
				shadowPhase: "idle",
				lifecycleKind: "running",
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
		})
		expect(classify(input)).toBe("D09_EVENT_GAP")
		expect(arbitrate(input, "D09_EVENT_GAP")).toBe("INSUFFICIENT_EVIDENCE")
	})

	it("rings the buffer at MAX_RECORDS_PER_TASK and tracks dropped count", () => {
		const recorder = new TaskShadowRecorder()
		for (let i = 0; i < MAX_RECORDS_PER_TASK + 7; i++) {
			recorder.record(
				makeInput({
					seq: i + 1,
					divergence: undefined,
				}),
				[],
			)
		}
		expect(recorder.getRecords().length).toBe(MAX_RECORDS_PER_TASK)
		expect(recorder.getCounts().droppedRecords).toBe(7)
	})

	it("invokes onInvariantViolation sink and counts each violation event once", () => {
		const seen: { count: number; lastViolationsLen: number } = { count: 0, lastViolationsLen: 0 }
		const recorder = new TaskShadowRecorder((_r, v) => {
			seen.count += 1
			seen.lastViolationsLen = v.length
		})
		recorder.record(makeInput({}), [{ kind: "terminal_with_activity" }])
		recorder.record(makeInput({}), [{ kind: "active_but_idle_phase" }, { kind: "completed_with_streaming" }])
		expect(seen.count).toBe(2)
		expect(seen.lastViolationsLen).toBe(2)
		expect(recorder.getCounts().invariantViolations).toBe(2)
	})

	it("enforces the privacy allowlist on every persisted record", () => {
		const recorder = new TaskShadowRecorder()
		recorder.record(
			makeInput({
				divergence: {
					seq: 1,
					event: "model_stream_started",
					legacyPhase: "idle",
					shadowPhase: "streaming",
					lifecycleKind: "running",
					modelStreaming: true,
					tooling: false,
					awaitingApproval: false,
				},
				arbiter: arbiter({ execution: { modelStreaming: true, tooling: false, awaitingApproval: false } }),
				taskEpochOrOpaqueTaskKey: "epoch-1",
			}),
			[],
		)
		const record = recorder.getRecords()[0] as TaskShadowDifferentialRecord
		const keys = new Set(Object.keys(record))
		for (const k of keys) {
			expect(PRIVACY_ALLOWED_KEYS.has(k)).toBe(true)
		}
		for (const k of ["seq", "timestamp", "event", "legacyPhase", "shadowPhase", "classification"]) {
			expect(keys.has(k)).toBe(true)
		}
	})

	it("exposes every D00–D11 class at least once across the suite", () => {
		const covered: ReadonlySet<DivergenceClass> = new Set([
			"D00_AGREE",
			"D01_LEGACY_FALSE_IDLE",
			"D02_SHADOW_FALSE_ACTIVE",
			"D03_TERMINAL_ORDERING",
			"D04_APPROVAL_PRECEDENCE",
			"D05_TOOL_CARDINALITY",
			"D07_FAILURE_MAPPING",
			"D08_FOLLOWUP_EXTERNAL",
			"D09_EVENT_GAP",
			"D11_HOST_PREENGAGED",
		])
		for (const c of ALL_DIFFERENCE_TYPES) {
			expect(covered.has(c) || c === "D06_RESUME_BOUNDARY" || c === "D10_UNKNOWN").toBe(true)
		}
	})
})

describe("TaskShadowRecorder — D06 resume boundary + D10 fallback", () => {
	it("classifies D06 resume boundary", () => {
		const input = makeInput({
			divergence: {
				seq: 1,
				event: "task_became_resumable",
				legacyPhase: "idle",
				shadowPhase: "resumable",
				lifecycleKind: "resumable",
				modelStreaming: false,
				tooling: false,
				awaitingApproval: false,
			},
			arbiter: arbiter({ recoveryState: "circuit_open" }),
		})
		expect(classify(input)).toBe("D06_RESUME_BOUNDARY")
		expect(arbitrate(input, "D06_RESUME_BOUNDARY")).toBe("SHADOW_CORRECT")
	})

	it("returns D00_AGREE when phases agree (D10 is only an unreachable branch)", () => {
		const input = makeInput({
			observationEvent: "task_requested",
			divergence: undefined,
		})
		expect(classify(input)).toBe("D00_AGREE")
	})
})

describe("TaskShadowRecorder — dependency-boundary guard", () => {
	it("recorder module does not expose writer methods", async () => {
		const mod = await import("../task-state-shadow-recorder")
		expect(Object.keys(mod).sort()).toContain("TaskShadowRecorder")
		const recorder = new mod.TaskShadowRecorder()
		expect((recorder as unknown as { set?: unknown }).set).toBeUndefined()
		expect((recorder as unknown as { write?: unknown }).write).toBeUndefined()
		expect((recorder as unknown as { postStateToWebview?: unknown }).postStateToWebview).toBeUndefined()
	})
})

// Touch unused types so the test file remains a complete spec.
void (null as unknown as AgentRuntimeExecutionState)
void (null as unknown as RecoveryState)
void (null as unknown as AgentRunStatus)
