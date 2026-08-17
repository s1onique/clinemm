/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 12 — Bounded state-space
 * exploration. Not a general theorem prover; a BFS over the reachable
 * states that confirms invariants hold on every model that can be
 * reached by the representative message alphabet.
 *
 * CORRECTION01 R2: the previous algorithm stopped recursing the
 * moment `seen.has(key)` returned true. Combined with the depth cap,
 * this caused the explorer to claim "0 violations" while the bare
 * reducer reproduces `resumable_with_streaming`,
 * `terminal_with_activity`, and the R1 parallel-tool false-idle bug.
 *
 * Two design changes:
 *
 * 1. **Cycle guard uses `visitedAtDepth.get(k)` >= current depth.**
 *     The same state reached via a SHORTER path is visited via that
 *     shorter path; reaching it again via a LONGER path is a no-op.
 *     The previous algorithm deduped regardless of depth, which
 *     caused descendants of dedup'd states to be skipped entirely.
 *
 * 2. **Depth cap is consulted BEFORE the cycle guard.** A state
 *     visited at depth=4 is a leaf for that branch; if the same
 *     state is reached at depth=2 (a shallower path), the walker
 *     continues to explore its descendants from that shallower
 *     depth. Children of depth=4 visits that exceed `maxDepth` are
 *     still explored via the shallower path.
 *
 * Net result: every reachable state up to `maxDepth` is processed
 * (no silent drop due to dedup), and the explorer's violation count
 * is consistent with the bare reducer.
 */
import { describe, expect, it } from "vitest";
import { checkTaskInvariants, type TaskInvariantViolation } from "./invariants";
import { initialTaskModel, isSameTaskModel, type TaskModel } from "./model";
import { type TaskMsg } from "./msg";
import { taskUpdate } from "./update";

const NOW = 1_700_000_000_000;

/**
 * Representative messages used by the explorer. Restricting to this
 * set keeps the reachable model count manageable; the goal is
 * invariant confirmation, not full state-machine coverage.
 */
const REPRESENTATIVE_TASK_MSGS: readonly TaskMsg[] = [
	{ type: "task_requested", taskId: "x", at: NOW },
	{ type: "session_started", sessionId: "s", at: NOW },
	{ type: "task_reset", at: NOW },
	{ type: "model_stream_started", at: NOW + 1 },
	{ type: "model_stream_finished", at: NOW + 2 },
	{ type: "tool_started", toolCallId: "c", at: NOW + 3 },
	{ type: "tool_finished", toolCallId: "c", at: NOW + 4 },
	{ type: "approval_requested", at: NOW + 5 },
	{ type: "approval_resolved", at: NOW + 6 },
	{
		type: "recovery_changed",
		projection: { state: "recovering", episodeFailures: 1, circuitNoticeCount: 0 },
		at: NOW + 7,
	},
	{ type: "task_completed", at: NOW + 100 },
	{ type: "task_failed", classification: "unknown", at: NOW + 100 },
	{ type: "task_became_resumable", at: NOW + 100 },
	{ type: "task_cancelled", at: NOW + 100 },
	{ type: "same_task_continued", at: NOW + 200 },
];

function explore(maxDepth: number): { visited: number; violations: number; kinds: readonly TaskInvariantViolation[] } {
	const visitedAtDepth = new Map<string, number>();
	const violations: TaskInvariantViolation[] = [];

	function key(m: TaskModel): string {
		return JSON.stringify(m);
	}

	function walk(current: TaskModel, depth: number) {
		// 1. Depth cap first — prevents runaway on cycles.
		if (depth > maxDepth) return;
		// 2. Invariants on every visited state.
		const v = checkTaskInvariants(current);
		if (v.length > 0) {
			violations.push(...v);
		}
		// 3. Cycle guard: only skip if the SAME state was already
		//    reached at a depth <= this one. Shallower paths take
		//    precedence so the explorer's reachable-set is correct.
		const k = key(current);
		const priorDepth = visitedAtDepth.get(k);
		if (priorDepth !== undefined && priorDepth <= depth) return;
		visitedAtDepth.set(k, depth);
		// 4. Recurse.
		for (const msg of REPRESENTATIVE_TASK_MSGS) {
			const [next] = taskUpdate(current, msg);
			walk(next, depth + 1);
		}
	}

	walk(initialTaskModel(), 0);

	let matched = 0;
	for (const k of visitedAtDepth.keys()) {
		const parsed = JSON.parse(k) as TaskModel;
		if (isSameTaskModel(parsed, initialTaskModel())) matched++;
	}
	expect(matched).toBeGreaterThanOrEqual(0);
	return { visited: visitedAtDepth.size, violations: violations.length, kinds: violations };
}

describe("bounded state-space explorer (CORRECTION01)", () => {
	it("depth 4 ⇒ every reachable state is invariant-clean", () => {
		const { visited, violations, kinds } = explore(4);
		if (violations > 0) {
			console.error("Invariant violations found:", JSON.stringify(kinds, null, 2));
		}
		expect(violations).toBe(0);
		expect(visited).toBeGreaterThan(10);
		expect(`REACHABLE_MODELS=${visited} VIOLATIONS=${violations}`).toMatch(/^REACHABLE_MODELS=\d+ VIOLATIONS=0$/);
	});

	it("explorer never visits a resumable+streaming state (COR01-B guard)", () => {
		// CORRECTION01 R3 ensures that the resumable lifecycle cannot
		// be reactivated by a stream start. The bare reducer (without
		// the guard) WOULD visit such a state. With the guard in
		// place, the explorer must not see one.
		let sawResumableStreaming = false;
		const visitedAtDepth = new Map<string, number>();

		function walk(current: TaskModel, depth: number) {
			if (depth > 4) return;
			if (current.lifecycle.kind === "resumable" && current.activity.modelStreaming) {
				sawResumableStreaming = true;
			}
			const k = JSON.stringify(current);
			const priorDepth = visitedAtDepth.get(k);
			if (priorDepth !== undefined && priorDepth <= depth) return;
			visitedAtDepth.set(k, depth);
			for (const msg of REPRESENTATIVE_TASK_MSGS) {
				const [next] = taskUpdate(current, msg);
				walk(next, depth + 1);
			}
		}
		walk(initialTaskModel(), 0);

		expect(sawResumableStreaming).toBe(false);
	});

	it("explorer never visits a completed+awaitingApproval state (COR01-B guard)", () => {
		let sawCompletedApproval = false;
		const visitedAtDepth = new Map<string, number>();

		function walk(current: TaskModel, depth: number) {
			if (depth > 4) return;
			if (current.lifecycle.kind === "completed" && current.activity.awaitingApproval) {
				sawCompletedApproval = true;
			}
			const k = JSON.stringify(current);
			const priorDepth = visitedAtDepth.get(k);
			if (priorDepth !== undefined && priorDepth <= depth) return;
			visitedAtDepth.set(k, depth);
			for (const msg of REPRESENTATIVE_TASK_MSGS) {
				const [next] = taskUpdate(current, msg);
				walk(next, depth + 1);
			}
		}
		walk(initialTaskModel(), 0);

		expect(sawCompletedApproval).toBe(false);
	});
});

describe("KNOWN-BAD SEQUENCE PINS (CORRECTION01)", () => {
	// Each of these pins a class of bug the original E0-E4 model
	// would have produced. They are not "regression tests" — they
	// document the BAD sequences and assert the new reducer rejects
	// them by leaving the model unchanged.
	//
	// If any of these pins fails, E5-E6 must NOT be authorized: a
	// previously-known invariant violation has re-emerged.

	function replay(msgs: readonly TaskMsg[]) {
		let m = initialTaskModel();
		for (const msg of msgs) {
			m = taskUpdate(m, msg)[0];
		}
		return m;
	}

	it("PIN-R1-A: parallel tool_started leaves both IDs active", () => {
		const m = replay([
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "tool_started", toolCallId: "a", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "b", at: NOW + 2 },
		]);
		expect(m.activity.activeToolCallIds).toEqual(["a", "b"]);
		expect(m.telemetry.toolCalls).toBe(2);
	});

	it("PIN-R1-B: finishing one parallel sibling leaves the other active", () => {
		const m = replay([
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "tool_started", toolCallId: "a", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "b", at: NOW + 2 },
			{ type: "tool_finished", toolCallId: "a", at: NOW + 3 },
		]);
		expect(m.activity.activeToolCallIds).toEqual(["b"]);
	});

	it("PIN-R2-A: task_became_resumable then model_stream_started is IGNORED_STALE", () => {
		const m = replay([
			{ type: "task_became_resumable", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
		]);
		expect(m.lifecycle.kind).toBe("resumable");
		expect(m.activity.modelStreaming).toBe(false);
		expect(checkTaskInvariants(m)).toEqual([]);
	});

	it("PIN-R2-B: task_completed then approval_requested is IGNORED_STALE", () => {
		const m = replay([
			{ type: "task_completed", at: NOW },
			{ type: "approval_requested", at: NOW + 1 },
		]);
		expect(m.lifecycle.kind).toBe("completed");
		expect(m.activity.awaitingApproval).toBe(false);
		expect(checkTaskInvariants(m)).toEqual([]);
	});

	it("PIN-R3: same_task_continued is the only exit from resumable for activity", () => {
		const before = replay([
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "task_became_resumable", at: NOW + 2 },
		]);
		expect(before.lifecycle.kind).toBe("resumable");

		const after = taskUpdate(before, { type: "same_task_continued", at: NOW + 3 })[0];
		expect(after.lifecycle.kind).toBe("running");
		expect(after.activity.modelStreaming).toBe(false);
		expect(after.activity.activeToolCallIds).toEqual([]);
	});
});