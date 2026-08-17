/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 13 — Shadow adapter tests.
 */
import { describe, expect, it } from "vitest";
import type { AgentRuntimeExecutionState, AgentRuntimeRecoverySnapshot } from "@cline/shared";
import { adaptRuntimeEvent, TaskStateShadow } from "./shadow-adapter";

const NOW = 1_700_000_000_000;

function makeRecoverySnapshot(): AgentRuntimeRecoverySnapshot {
	return {
		state: "idle",
		tracker: {
			state: "idle",
			currentFamilyId: undefined,
			currentFamilyConfidence: "structured",
			currentFamilyEligible: false,
			currentToolName: undefined,
			currentToolFailureClass: undefined,
			repairAttempts: 0,
			episodeFailures: 1,
			episodeStart: NOW,
		},
		secondStage: "idle",
		episodeFailures: 1,
		maxEpisodeFailures: 5,
		circuitNoticeCount: 0,
	};
}

function makeExecutionState(): AgentRuntimeExecutionState {
	return { modelStreaming: false, tooling: false, awaitingApproval: false };
}

function snapshotBase(overrides: Partial<Parameters<typeof adaptRuntimeEvent>[0]> = {}): Parameters<
	typeof adaptRuntimeEvent
>[0] {
	return {
		type: "run-started",
		snapshot: {
			agentId: "a",
			status: "running",
			iteration: 0,
			messages: [],
			pendingToolCalls: [],
			usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
			runId: "run-1",
			recovery: makeRecoverySnapshot(),
			execution: makeExecutionState(),
		},
		...overrides,
	} as Parameters<typeof adaptRuntimeEvent>[0];
}

describe("adaptRuntimeEvent — basic mappings", () => {
	it("run-started → session_started", () => {
		const out = adaptRuntimeEvent(
			{
				type: "run-started",
				snapshot: {
					agentId: "a",
					status: "running",
					iteration: 0,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "run-1",
					recovery: makeRecoverySnapshot(),
					execution: makeExecutionState(),
				},
			},
			NOW,
		);
		expect(out).toEqual([{ type: "session_started", sessionId: "run-1", at: NOW }]);
	});

	it("run-finished → task_completed", () => {
		const out = adaptRuntimeEvent(
			{
				type: "run-finished",
				snapshot: {
					agentId: "a",
					status: "completed",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "run-1",
					recovery: makeRecoverySnapshot(),
					execution: makeExecutionState(),
				},
				result: {
					agentId: "a",
					runId: "run-1",
					status: "completed",
					iterations: 1,
					outputText: "",
					messages: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
				},
			},
			NOW,
		);
		expect(out).toEqual([{ type: "task_completed", at: NOW }]);
	});

	it("run-failed → task_failed(unknown)", () => {
		const out = adaptRuntimeEvent(
			{
				type: "run-failed",
				snapshot: {
					agentId: "a",
					status: "failed",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "run-1",
					recovery: makeRecoverySnapshot(),
					execution: makeExecutionState(),
				},
				error: new Error("x"),
			},
			NOW,
		);
		expect(out).toEqual([{ type: "task_failed", classification: "unknown", at: NOW }]);
	});

	it("execution-state-changed(modelStreaming=true) → model_stream_started", () => {
		const out = adaptRuntimeEvent(
			{
				type: "execution-state-changed",
				snapshot: {
					agentId: "a",
					status: "running",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "run-1",
					recovery: makeRecoverySnapshot(),
					execution: { modelStreaming: true, tooling: false, awaitingApproval: false },
				},
				previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			},
			NOW,
		);
		// CORRECTION01 R4: edge-triggered. Only the model_stream_started
		// transition emits; the awaitingApproval false->false
		// unchanged state emits nothing.
		expect(out).toEqual([{ type: "model_stream_started", at: NOW }]);
	});

	it("execution-state-changed(awaitingApproval=true) → approval_requested", () => {
		const out = adaptRuntimeEvent(
			{
				type: "execution-state-changed",
				snapshot: {
					agentId: "a",
					status: "running",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "run-1",
					recovery: makeRecoverySnapshot(),
					execution: { modelStreaming: true, tooling: true, awaitingApproval: true },
				},
				previousExecution: { modelStreaming: true, tooling: true, awaitingApproval: false },
			},
			NOW,
		);
		// CORRECTION01 R4: only the awaitingApproval transition emits;
		// modelStreaming true->true is unchanged, no message.
		expect(out).toEqual([{ type: "approval_requested", at: NOW }]);
	});

	it("execution-state-changed(modelStreaming=true→false) → model_stream_finished", () => {
		const out = adaptRuntimeEvent(
			{
				type: "execution-state-changed",
				snapshot: {
					agentId: "a",
					status: "running",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "run-1",
					recovery: makeRecoverySnapshot(),
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
				},
				previousExecution: { modelStreaming: true, tooling: false, awaitingApproval: false },
			},
			NOW,
		);
		expect(out).toEqual([{ type: "model_stream_finished", at: NOW }]);
	});

	it("execution-state-changed(no transition) → no TaskMsg", () => {
		const out = adaptRuntimeEvent(
			{
				type: "execution-state-changed",
				snapshot: {
					agentId: "a",
					status: "running",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "run-1",
					recovery: makeRecoverySnapshot(),
					execution: { modelStreaming: false, tooling: false, awaitingApproval: false },
				},
				previousExecution: { modelStreaming: false, tooling: false, awaitingApproval: false },
			},
			NOW,
		);
		// CORRECTION01 R4: when nothing changes, the adapter emits no
		// TaskMsg. The shadow stays where it is.
		expect(out).toEqual([]);
	});

	it("recovery-state-changed → recovery_changed", () => {
		const out = adaptRuntimeEvent(
			{
				type: "recovery-state-changed",
				snapshot: {
					agentId: "a",
					status: "running",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "run-1",
					recovery: { ...makeRecoverySnapshot(), state: "recovering", episodeFailures: 3 },
					execution: makeExecutionState(),
				},
				previousRecovery: { ...makeRecoverySnapshot() },
			},
			NOW,
		);
		expect(out).toHaveLength(1);
		expect(out[0].type).toBe("recovery_changed");
	});

	it("assistant-text-delta → empty (prose does not enter TaskModel)", () => {
		const out = adaptRuntimeEvent(
			{
				type: "assistant-text-delta",
				snapshot: {
					agentId: "a",
					status: "running",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "run-1",
					recovery: makeRecoverySnapshot(),
					execution: makeExecutionState(),
				},
				iteration: 1,
				text: "hello",
				accumulatedText: "hello",
			},
			NOW,
		);
		expect(out).toEqual([]);
	});
});

describe("TaskStateShadow — observation-only", () => {
	it("observe advances the private model", () => {
		const shadow = new TaskStateShadow();
		const obs = shadow.observe({ type: "task_requested", taskId: "t", at: NOW }, NOW);
		expect(obs.model.identity.taskId).toBe("t");
		expect(obs.projections.turnPhase).toBe("idle");
	});

	it("observeRuntimeEvent returns noop when event has no shadow analogue", () => {
		const shadow = new TaskStateShadow();
		const obs = shadow.observeRuntimeEvent(
			{
				type: "assistant-text-delta",
				snapshot: {
					agentId: "a",
					status: "running",
					iteration: 1,
					messages: [],
					pendingToolCalls: [],
					usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalCost: 0 },
					runId: "r",
					recovery: makeRecoverySnapshot(),
					execution: makeExecutionState(),
				},
				iteration: 1,
				text: "x",
				accumulatedText: "x",
			},
			NOW,
		);
		expect(obs).toBeDefined();
		expect(obs?.event).toBe("noop");
	});

	it("replay returns every observation in order", () => {
		const shadow = new TaskStateShadow();
		const obs = shadow.replay(
			[
				{ type: "task_requested", taskId: "t", at: NOW },
				{ type: "model_stream_started", at: NOW + 1 },
				{ type: "model_stream_finished", at: NOW + 2 },
				{ type: "task_completed", at: NOW + 3 },
			],
			NOW + 100,
		);
		expect(obs).toHaveLength(4);
		expect(obs[1].projections.turnPhase).toBe("streaming");
		expect(obs[3].projections.turnPhase).toBe("completed");
	});

	it("noop() reports the current model without mutation", () => {
		const shadow = new TaskStateShadow();
		const before = shadow.debugSnapshot();
		const obs = shadow.noop(NOW);
		expect(obs.model).toBe(before);
	});

	it("debugReset returns to initial", () => {
		const shadow = new TaskStateShadow();
		shadow.observe({ type: "task_requested", taskId: "t", at: NOW }, NOW);
		shadow.debugReset();
		expect(shadow.debugSnapshot().identity.taskId).toBeUndefined();
	});
});