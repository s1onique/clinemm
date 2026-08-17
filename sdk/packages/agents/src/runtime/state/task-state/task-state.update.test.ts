/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 11 — Sequence / reducer tests.
 *
 * Pure unit tests for the shadow `taskUpdate` reducer. The test
 * suite pins every canonical sequence (S01–S15) from the ACT and the
 * "this must NEVER happen" combination that proves the shadow
 * model would have caught the C04 dogfood bug class.
 *
 * No I/O, no mocks, no singletons — the reducer is pure. Every test
 * starts from `initialTaskModel()` and replays a fixed `TaskMsg`
 * sequence, asserting the resulting `projections` and the invariant
 * state at every step.
 */
import { describe, expect, it } from "vitest";
import { assertInvariants, checkTaskInvariants } from "./invariants";
import { initialTaskModel, isSameTaskModel, type TaskModel } from "./model";
import { type TaskMsg } from "./msg";
import {
	canCancel,
	canStartNewTask,
	canSubmitFollowup,
	projectControls,
	projectElapsedMs,
	projectTelemetry,
	projectThinking,
	projectTurnState,
} from "./selectors";
import { taskUpdate } from "./update";

const NOW = 1_700_000_000_000;

/**
 * Helper — replay a sequence and assert every observation's
 * invariant and final projection.
 */
function replay(msgs: readonly TaskMsg[]): {
	readonly models: readonly TaskModel[];
	readonly final: TaskModel;
} {
	let current = initialTaskModel();
	const models: TaskModel[] = [current];
	for (const m of msgs) {
		const [next] = taskUpdate(current, m);
		current = next;
		assertInvariants(current);
		models.push(current);
	}
	return { models, final: current };
}

describe("S01 text-only happy path", () => {
	it("idle → streaming → completed; NEVER reports streaming after completion", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t1", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "model_stream_finished", at: NOW + 100 },
			{ type: "task_completed", at: NOW + 200 },
		];
		const { models } = replay(seq);
		// m0: idle
		expect(projectTurnState(models[0])).toBe("idle");
		// m1: requested → running, no activity yet
		expect(models[1].lifecycle.kind).toBe("running");
		expect(projectTurnState(models[1])).toBe("idle");
		// m2: model streaming
		expect(projectTurnState(models[2])).toBe("streaming");
		expect(projectThinking(models[2])).toBe(true);
		// m3: stream finished — still running, NOT completed
		expect(models[3].lifecycle.kind).toBe("running");
		expect(projectTurnState(models[3])).toBe("idle");
		expect(projectThinking(models[3])).toBe(false);
		// m4: completed
		expect(models[4].lifecycle.kind).toBe("completed");
		expect(projectTurnState(models[4])).toBe("completed");
		expect(projectThinking(models[4])).toBe(false);
		// CRITICAL invariant: no model where streaming && projectedIdle
		for (let i = 0; i < models.length; i++) {
			const m = models[i];
			if (m.activity.modelStreaming) {
				expect(projectTurnState(m)).toBe("streaming");
			}
		}
	});
});

describe("S02 text-only stale reasoning data", () => {
	it("TaskMsg has no partial/prose field; prose cannot affect TaskModel", () => {
		// By construction. This test exists so the structural claim
		// is pinned in the test suite, not just in JSDoc.
		const m: TaskMsg = { type: "task_requested", taskId: "x", at: NOW };
		const r = JSON.stringify(m);
		expect(r.includes("partial")).toBe(false);
		expect(r.includes("text")).toBe(false);
		expect(r.includes("reasoning")).toBe(false);
	});
});

describe("S03 tool call lifecycle", () => {
	it("stream → tool started → tool finished → completion", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t3", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "c1", at: NOW + 2 },
			{ type: "tool_finished", toolCallId: "c1", at: NOW + 50 },
			{ type: "model_stream_finished", at: NOW + 60 },
			{ type: "task_completed", at: NOW + 100 },
		];
		const { models } = replay(seq);
		expect(projectTurnState(models[3])).toBe("streaming");
		expect(models[3].activity.activeToolCallIds).toEqual(["c1"]);
		expect(models[3].telemetry.toolCalls).toBe(1);
		expect(models[4].activity.activeToolCallIds).toEqual([]);
		expect(models[4].activity.modelStreaming).toBe(true);
		for (const m of models) {
			expect(m.telemetry.toolCalls).toBeGreaterThanOrEqual(0);
		}
	});
});

describe("S04 awaiting_approval precedence", () => {
	it("approval takes precedence over streaming/tooling", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t4", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "approval_requested", at: NOW + 2 },
			{ type: "tool_started", toolCallId: "c1", at: NOW + 3 },
		];
		const { models } = replay(seq);
		// m[4]: tool_started arrived while awaitingApproval=true. The
		// tool_started reducer does NOT promote to streaming because
		// awaitingApproval has higher precedence.
		expect(projectTurnState(models[4])).toBe("awaiting_approval");
		const [resolved] = taskUpdate(models[4], { type: "approval_resolved", at: NOW + 5 });
		// After approval_resolved: tooling=true (still active from m[4]),
		// awaitingApproval=false ⇒ "streaming".
		expect(projectTurnState(resolved)).toBe("streaming");
	});
});

describe("S05 cancel during model streaming", () => {
	it("task_cancelled mid-stream ⇒ resumable, no activity", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t5", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "task_cancelled", at: NOW + 5 },
		];
		const { final, models } = replay(seq);
		expect(final.lifecycle.kind).toBe("cancelled");
		expect(projectTurnState(final)).toBe("resumable");
		expect(final.activity.modelStreaming).toBe(false);
		expect(final.activity.activeToolCallIds).toEqual([]);
		const [ignoredModel] = taskUpdate(final, { type: "tool_started", toolCallId: "late", at: NOW + 6 });
		expect(ignoredModel.activity.activeToolCallIds).toEqual([]);
		expect(checkTaskInvariants(models[models.length - 1])).toEqual([]);
	});
});

describe("S06 cancel during tool", () => {
	it("task_cancelled mid-tool ⇒ resumable; tool_finished is IGNORED_STALE", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t6", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "c1", at: NOW + 2 },
			{ type: "task_cancelled", at: NOW + 3 },
		];
		const { final } = replay(seq);
		expect(final.lifecycle.kind).toBe("cancelled");
		const [afterLate] = taskUpdate(final, { type: "tool_finished", toolCallId: "c1", at: NOW + 4 });
		expect(afterLate.activity.activeToolCallIds).toEqual([]);
	});
});

describe("S07 failure", () => {
	it("task_failed ⇒ lifecycle=failed, all activity cleared", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t7", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "task_failed", classification: "rate_limit", at: NOW + 2 },
		];
		const { final } = replay(seq);
		expect(final.lifecycle.kind).toBe("failed");
		if (final.lifecycle.kind === "failed") {
			expect(final.lifecycle.reason).toBe("rate_limit");
		}
		expect(projectTurnState(final)).toBe("error");
	});
});

describe("S08 resumable", () => {
	it("task_became_resumable ⇒ lifecycle=resumable, endedAt stamped", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t8", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "task_became_resumable", at: NOW + 5 },
		];
		const { final } = replay(seq);
		expect(final.lifecycle.kind).toBe("resumable");
		expect(final.identity.endedAt).toBe(NOW + 5);
		expect(projectTurnState(final)).toBe("resumable");
	});
});

describe("S09 same-task follow-up preserves startedAt", () => {
	it("I08: same_task_continued clears endedAt, preserves startedAt", () => {
		const startedAt = NOW;
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t9", at: startedAt },
			{ type: "model_stream_started", at: startedAt + 1 },
			{ type: "task_completed", at: startedAt + 100 },
			{ type: "same_task_continued", at: startedAt + 200 },
		];
		const { models, final } = replay(seq);
		expect(models[3].identity.endedAt).toBe(startedAt + 100);
		expect(final.identity.startedAt).toBe(startedAt);
		expect(final.identity.endedAt).toBeUndefined();
		expect(final.lifecycle.kind).toBe("running");
		// same_task_continued resets activity to all-false; projection
		// becomes "idle" until the next model_stream_started / tool_started
		// event arrives. This matches the legacy host's "first
		// terminal wins within current stopped interval" semantics.
		expect(projectTurnState(final)).toBe("idle");
		// And a model_stream_started after the continuation IS streaming:
		const [postStream] = taskUpdate(final, { type: "model_stream_started", at: startedAt + 300 });
		expect(projectTurnState(postStream)).toBe("streaming");
	});
});

describe("S10 new task after completion resets epoch", () => {
	it("I09: task_requested resets startedAt and counters", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t10a", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "c", at: NOW + 2 },
			{ type: "task_completed", at: NOW + 100 },
			{ type: "task_requested", taskId: "t10b", at: NOW + 500 },
		];
		const { final } = replay(seq);
		expect(final.identity.taskId).toBe("t10b");
		expect(final.identity.startedAt).toBe(NOW + 500);
		expect(final.identity.endedAt).toBeUndefined();
		expect(final.telemetry.toolCalls).toBe(0);
		expect(final.telemetry.recoveryBudgetFailures).toBe(0);
	});
});

describe("S11 parallel tools", () => {
	it("two parallel tool-started events leave both IDs active and count both", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t11", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "a", at: NOW + 2 },
			{ type: "tool_started", toolCallId: "b", at: NOW + 3 },
		];
		const { final } = replay(seq);
		// CORRECTION01 R1: parallel tools are distinct entities. Both IDs
		// are tracked in the active set; the cumulative counter is the
		// number of distinct tool starts (not the number of batches).
		expect(final.activity.activeToolCallIds).toEqual(["a", "b"]);
		expect(final.telemetry.toolCalls).toBe(2);
	});

	it("finishing one parallel tool leaves the sibling active (R1 regression)", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t11b", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "a", at: NOW + 2 },
			{ type: "tool_started", toolCallId: "b", at: NOW + 3 },
			{ type: "tool_finished", toolCallId: "a", at: NOW + 4 },
		];
		const { final } = replay(seq);
		expect(final.activity.activeToolCallIds).toEqual(["b"]);
		expect(projectTurnState(final)).toBe("streaming");
		expect(final.telemetry.toolCalls).toBe(2);
	});

	it("a duplicate tool_started for an already-active ID is a no-op on the counter", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t11c", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "a", at: NOW + 2 },
			{ type: "tool_started", toolCallId: "a", at: NOW + 3 },
		];
		const { final } = replay(seq);
		expect(final.activity.activeToolCallIds).toEqual(["a"]);
		expect(final.telemetry.toolCalls).toBe(1);
	});
});

describe("S12 recovery episode", () => {
	it("recovery_changed folds positive deltas into the cumulative counter", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t12", at: NOW },
			{
				type: "recovery_changed",
				projection: { state: "idle", episodeFailures: 1, circuitNoticeCount: 0 },
				at: NOW + 1,
			},
			{
				type: "recovery_changed",
				projection: { state: "recovering", episodeFailures: 3, circuitNoticeCount: 0 },
				at: NOW + 2,
			},
		];
		const { final } = replay(seq);
		expect(final.recovery.state).toBe("recovering");
		expect(final.recovery.episodeFailures).toBe(3);
		expect(final.telemetry.recoveryBudgetFailures).toBe(3);
	});
});

describe("S13 control-plane denial", () => {
	it("an approval_resolved WITHOUT an active approval is a no-op", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t13", at: NOW },
			{ type: "approval_resolved", at: NOW + 1 },
		];
		const { final } = replay(seq);
		expect(final.activity.awaitingApproval).toBe(false);
		expect(final.lifecycle.kind).toBe("running");
	});
});

describe("S14 unknown tool_callId is still a tool", () => {
	it("tool_started with an arbitrary id increments the counter", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t14", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "absolutely_new", at: NOW + 2 },
		];
		const { final } = replay(seq);
		expect(final.telemetry.toolCalls).toBe(1);
	});
});

describe("S15 idempotent / no-op / stale", () => {
	it("late task_requested replaces the identity (not idempotent)", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t15", at: NOW },
			{ type: "task_requested", taskId: "t15-bogus", at: NOW + 1 },
		];
		const { final } = replay(seq);
		// Documented behavior: every task_requested resets the epoch.
		// Callers must not emit task_requested twice for the same task.
		expect(final.identity.taskId).toBe("t15-bogus");
	});

	it("stale tool_finished after completed is IGNORED_STALE", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t15s", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "task_completed", at: NOW + 100 },
			{ type: "tool_finished", toolCallId: "late", at: NOW + 200 },
		];
		const { final } = replay(seq);
		expect(final.lifecycle.kind).toBe("completed");
		expect(final.activity.activeToolCallIds).toEqual([]);
	});
});

describe("ELM02 / I14 / I15 purity guarantees", () => {
	it("taskUpdate never mutates the input model", () => {
		const m = initialTaskModel();
		const before = JSON.stringify(m);
		taskUpdate(m, { type: "task_requested", taskId: "x", at: NOW });
		const after = JSON.stringify(m);
		expect(before).toBe(after);
		expect(isSameTaskModel(m, initialTaskModel())).toBe(true);
	});

	it("two identical replays produce deeply-equal sequences", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "p", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "model_stream_finished", at: NOW + 2 },
			{ type: "task_completed", at: NOW + 3 },
		];
		const runOnce = replay(seq).models;
		const runTwice = replay(seq).models;
		expect(runOnce.length).toBe(runTwice.length);
		for (let i = 0; i < runOnce.length; i++) {
			expect(isSameTaskModel(runOnce[i], runTwice[i])).toBe(true);
		}
	});

	it("taskUpdate has zero side effects on Date.now() / Math.random()", () => {
		const m = initialTaskModel();
		const expected = taskUpdate(m, { type: "task_requested", taskId: "y", at: NOW })[0];
		for (let i = 0; i < 100; i++) {
			const [again] = taskUpdate(m, { type: "task_requested", taskId: "y", at: NOW });
			expect(isSameTaskModel(again, expected)).toBe(true);
		}
	});
});

describe("control projections", () => {
	it("canCancel is true while streaming", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "c", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
		]);
		expect(canCancel(final)).toBe(true);
	});
	it("canStartNewTask is true after completion", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "c", at: NOW },
			{ type: "task_completed", at: NOW + 1 },
		]);
		expect(canStartNewTask(final)).toBe(true);
	});
	it("canSubmitFollowup is true after completion", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "c", at: NOW },
			{ type: "task_completed", at: NOW + 1 },
		]);
		expect(canSubmitFollowup(final)).toBe(true);
	});
	it("projectControls yields a stable record", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "c", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
		]);
		expect(projectControls(final)).toEqual({
			canCancel: true,
			canStartNewTask: false,
			canSubmitFollowup: false,
		});
	});
});

describe("elapsed projection", () => {
	it("returns 0 before any task starts", () => {
		expect(projectElapsedMs(initialTaskModel(), NOW)).toBe(0);
	});
	it("computes endedAt - startedAt when terminal", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "e", at: NOW },
			{ type: "task_completed", at: NOW + 5000 },
		]);
		expect(projectElapsedMs(final, NOW + 10_000)).toBe(5000);
	});
});

describe("telemetry projection", () => {
	it("reflects toolCalls and recoveryBudgetFailures", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "c", at: NOW + 2 },
			{
				type: "recovery_changed",
				projection: { state: "idle", episodeFailures: 1, circuitNoticeCount: 0 },
				at: NOW + 3,
			},
		]);
		expect(projectTelemetry(final)).toEqual({
			toolCalls: 1,
			recoveryBudgetFailures: 1,
		});
	});
});

describe("E4-DIFF-01 ACTIVE_LEGACY_IDLE_DIVERGENCE (Phase 16)", () => {
	/**
	 * The class of bug currently observed in dogfood: visible task
	 * is actively processing while the legacy `TurnStateTracker`
	 * reports `idle`. Encoded as a shadow-vs-projection divergence.
	 *
	 * The shadow model, fed the canonical runtime events, must say
	 * `streaming`. If the legacy authority ever says `idle` while
	 * the shadow says `streaming`, the differential comparator
	 * records the divergence.
	 */
	it("model_stream_started ⇒ shadow projection = streaming, NEVER idle", () => {
		const { models } = replay([
			{ type: "task_requested", taskId: "live02", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
		]);
		expect(projectTurnState(models[1])).toBe("idle");
		expect(projectTurnState(models[2])).toBe("streaming");
		const streamingModel = models[2];
		expect(streamingModel.activity.modelStreaming).toBe(true);
		expect(projectTurnState(streamingModel)).toBe("streaming");
		// NEVER:
		expect(projectTurnState(streamingModel)).not.toBe("idle");
		expect(projectThinking(streamingModel)).not.toBe(false);
	});
});

// =========================================================================
// ACT-CLINEMM-ELM-ARCHITECTURE01-E5-E6-SHADOW-DIFFERENTIAL01-CORRECTION02-C2.3-CONT.2-CORRECTION01
// Terminal-precedence regression witnesses (C7.1–C7.6).
//
// The CONT.2 W07/W08 stateful workloads surfaced the contract gap
// that motivated this correction: a late canonical `task_completed`
// or `task_failed` would overwrite a frozen `cancelled` /
// `resumable` lifecycle, losing the user's explicit cancellation
// intent. These unit-level witnesses pin the corrected precedence
// matrix directly at the reducer boundary so a regression would
// surface here in milliseconds rather than at the stateful harness
// layer.
// =========================================================================
describe("C2.3-CONT.2-CORRECTION01 C7 — terminal-precedence policy", () => {
	it("C7.1 cancelled + late task_completed is IGNORED_STALE", () => {
		const { final, models } = replay([
			{ type: "task_requested", taskId: "c71", at: NOW },
			{ type: "task_cancelled", at: NOW + 1 },
			{ type: "task_completed", at: NOW + 2 },
		]);
		expect(final.lifecycle.kind).toBe("cancelled");
		// endedAt stamped at cancel time, NOT overwritten by late completion.
		expect(final.identity.endedAt).toBe(NOW + 1);
		// The post-cancelled model (models[2]) and the post-completed
		// model (models[3]) are structurally identical — late completion
		// is a no-op.
		expect(models[3]).toEqual(models[2]);
	});

	it("C7.2 cancelled + late task_failed is IGNORED_STALE", () => {
		const { final, models } = replay([
			{ type: "task_requested", taskId: "c72", at: NOW },
			{ type: "task_cancelled", at: NOW + 1 },
			{ type: "task_failed", classification: "rate_limit", at: NOW + 2 },
		]);
		expect(final.lifecycle.kind).toBe("cancelled");
		expect(final.identity.endedAt).toBe(NOW + 1);
		expect(models[3]).toEqual(models[2]);
	});

	it("C7.3 resumable + late task_completed is IGNORED_STALE", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "c73", at: NOW },
			{ type: "task_became_resumable", at: NOW + 1 },
			{ type: "task_completed", at: NOW + 2 },
		]);
		expect(final.lifecycle.kind).toBe("resumable");
	});

	it("C7.3 resumable + late task_failed is IGNORED_STALE", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "c73b", at: NOW },
			{ type: "task_became_resumable", at: NOW + 1 },
			{ type: "task_failed", classification: "rate_limit", at: NOW + 2 },
		]);
		expect(final.lifecycle.kind).toBe("resumable");
	});

	it("C7.4 normal completion still works (running → completed)", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "c74", at: NOW },
			{ type: "task_completed", at: NOW + 1 },
		]);
		expect(final.lifecycle.kind).toBe("completed");
		expect(final.identity.endedAt).toBe(NOW + 1);
	});

	it("C7.5 normal failure still works (running → failed)", () => {
		const { final } = replay([
			{ type: "task_requested", taskId: "c75", at: NOW },
			{ type: "task_failed", classification: "rate_limit", at: NOW + 1 },
		]);
		expect(final.lifecycle.kind).toBe("failed");
		if (final.lifecycle.kind === "failed") {
			expect(final.lifecycle.reason).toBe("rate_limit");
		}
		expect(final.identity.endedAt).toBe(NOW + 1);
	});

	it("C7.6 cancellation followed by same_task_continued + genuine completion", () => {
		// The only legitimate exit from a cancelled or resumable
		// boundary is `same_task_continued`, which is unconditional
		// (I08). After continuation, a real task_completed from
		// the resumed turn must apply normally.
		const { final } = replay([
			{ type: "task_requested", taskId: "c76", at: NOW },
			{ type: "task_cancelled", at: NOW + 1 },
			// Stranded late completion MUST be stale.
			{ type: "task_completed", at: NOW + 2 },
			// Same-task continuation is the legitimate exit.
			{ type: "same_task_continued", at: NOW + 3 },
			// Now a real completion can apply to the resumed turn.
			{ type: "task_completed", at: NOW + 4 },
		]);
		expect(final.lifecycle.kind).toBe("completed");
		expect(final.identity.endedAt).toBe(NOW + 4);
	});

	it("C7.6b terminal-to-terminal ordering remains last-arrival-wins (completed → failed)", () => {
		// Not a correctness invariant under C2.3, but the
		// narrow CORRECTION01 only freezes the
		// cancelled/resumable case. Terminal-to-terminal
		// ordering is unchanged.
		const { final } = replay([
			{ type: "task_requested", taskId: "c76b", at: NOW },
			{ type: "task_completed", at: NOW + 1 },
			{ type: "task_failed", classification: "unknown", at: NOW + 2 },
		]);
		expect(final.lifecycle.kind).toBe("failed");
	});
});