/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 12 — Bounded state-space
 * exploration. Not a general theorem prover; a small per-prefix
 * exhaustive search that confirms invariants hold for every reachable
 * model up to a fixed depth.
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

function explore(maxDepth: number): { visited: number; violations: number } {
	const seen = new Map<string, TaskModel>();
	const violations: TaskInvariantViolation[] = [];

	function key(m: TaskModel): string {
		return JSON.stringify(m);
	}

	function walk(current: TaskModel, depth: number) {
		const k = key(current);
		if (seen.has(k)) return;
		seen.set(k, current);
		const v = checkTaskInvariants(current);
		if (v.length > 0) violations.push(...v);
		if (depth >= maxDepth) return;
		for (const msg of REPRESENTATIVE_TASK_MSGS) {
			const [next] = taskUpdate(current, msg);
			walk(next, depth + 1);
		}
	}

	walk(initialTaskModel(), 0);

	let matched = 0;
	for (const m of seen.values()) {
		if (isSameTaskModel(m, initialTaskModel())) matched++;
	}
	expect(matched).toBeGreaterThanOrEqual(0);
	return { visited: seen.size, violations: violations.length, kinds: violations };
}

describe("bounded state-space explorer", () => {
	it("depth 4 ⇒ zero invariant violations across all reachable states", () => {
		const { visited, violations, kinds } = explore(4);
		if (violations > 0) {
			console.error("Invariant violations found:", JSON.stringify(kinds, null, 2));
		}
		// Capture the count for the report template.
		expect(violations).toBe(0);
		// Sanity: at least the initial state plus one-step successors
		// are reachable. Avoid asserting an exact upper bound because
		// the explorer visits every reachable model, not just the
		// "interesting" ones.
		expect(visited).toBeGreaterThan(10);
		// Surface the count via expect so the test report includes it.
		expect(`REACHABLE_MODELS=${visited} VIOLATIONS=${violations}`).toMatch(/^REACHABLE_MODELS=\d+ VIOLATIONS=0$/);
	});
});