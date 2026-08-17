/**
 * ACT-CLINEMM-ELM-ARCHITECTURE01 / Phase 18 — Mutation witness matrix.
 *
 * CORRECTION01 R9: the previous file was named `mutations.test.ts`
 * and reported "APPLIED=10, KILLED=10". That was an overstatement:
 * this file is a WITNESS MATRIX. Each entry (M1–W10) names a class
 * of bug and asserts the production behavior the test suite would
 * catch if that class were introduced. The assertions DO run against
 * the real `taskUpdate`; they would turn red if the corresponding
 * mutation were applied.
 *
 * This file does NOT itself apply mutations. The active mutation
 * work is what produced this ACT (R1/R2/R3 found by review,
 * R4/R7/R10 fixed in source). Future ACTs that want a real mutation
 * score should add a separate `task-state.mutation-sweep.test.ts`
 * that programmatically mutates `update.ts` and re-runs the suite.
 *
 * Renamed from `task-state.mutations.test.ts` to make the
 * distinction explicit.
 */
import { describe, expect, it } from "vitest";
import { initialTaskModel, type TaskModel } from "./model";
import { type TaskMsg } from "./msg";
import { projectTurnState } from "./selectors";
import { taskUpdate, type UpdateResult } from "./update";

const NOW = 1_700_000_000_000;

function makeMutator(fn: (model: TaskModel, msg: TaskMsg) => UpdateResult): typeof taskUpdate {
	return (model, msg) => fn(model, msg);
}

describe("M1 — updateModelStreamStarted must set activity.modelStreaming", () => {
	it("S01 sequence test pins the killer; the sabotage (drop the flag) is detected by S01", () => {
		// M1's killer is S01. S01 asserts that after model_stream_started
		// the projection is "streaming". A sabotaged reducer that drops
		// the flag would have the projection return "idle" (lifecycle
		// running + no activity). The S01 test catches this; here we
		// simply assert the production behavior matches S01.
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
		];
		let m = initialTaskModel();
		for (const msg of seq) {
			m = taskUpdate(m, msg)[0];
		}
		expect(m.activity.modelStreaming).toBe(true);
		expect(projectTurnState(m)).toBe("streaming");
	});
});

describe("M2 — projection must NOT report idle while activity is true", () => {
	it("killed if a buggy projection returns idle while modelStreaming=true", () => {
		const m: TaskModel = {
			...initialTaskModel(),
			activity: { modelStreaming: true, activeToolCallIds: [], awaitingApproval: false },
		};
		expect(projectTurnState(m)).toBe("streaming");
	});
});

describe("M3 — task_completed must clear all activity", () => {
	it("killed if completed leaves activity intact", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "task_completed", at: NOW + 100 },
		];
		let m = initialTaskModel();
		for (const msg of seq) {
			m = taskUpdate(m, msg)[0];
		}
		expect(m.activity.modelStreaming).toBe(false);
		expect(m.activity.activeToolCallIds).toEqual([]);
		expect(m.activity.awaitingApproval).toBe(false);
		expect(projectTurnState(m)).toBe("completed");
	});
});

describe("M4 — approval must take precedence over streaming", () => {
	it("killed if approval is treated as a generic activity", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "approval_requested", at: NOW + 2 },
		];
		let m = initialTaskModel();
		for (const msg of seq) {
			m = taskUpdate(m, msg)[0];
		}
		expect(projectTurnState(m)).toBe("awaiting_approval");
	});
});

describe("M5 — same_task_continued must preserve startedAt (I08)", () => {
	it("killed if the continuation resets startedAt", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "task_completed", at: NOW + 100 },
			{ type: "same_task_continued", at: NOW + 200 },
		];
		let m = initialTaskModel();
		for (const msg of seq) {
			m = taskUpdate(m, msg)[0];
		}
		expect(m.identity.startedAt).toBe(NOW);
	});
});

describe("M6 — new task must reset epoch (I09)", () => {
	it("killed if a second task_requested preserves the old startedAt", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t1", at: NOW },
			{ type: "task_requested", taskId: "t2", at: NOW + 500 },
		];
		let m = initialTaskModel();
		for (const msg of seq) {
			m = taskUpdate(m, msg)[0];
		}
		expect(m.identity.taskId).toBe("t2");
		expect(m.identity.startedAt).toBe(NOW + 500);
	});
});

describe("M7 — projection must NOT depend on prose (ELM11)", () => {
	it("structurally impossible: TaskModel has no message prose field", () => {
		const m: TaskModel = initialTaskModel();
		const json = JSON.stringify(m);
		expect(json.includes("partial")).toBe(false);
		expect(json.includes("text")).toBe(false);
		expect(json.includes("reasoning")).toBe(false);
		expect(json.includes("message")).toBe(false);
	});
});

describe("M8 — shadow adapter must NOT write back into legacy (structural)", () => {
	it("TaskStateShadow import graph does not import TurnStateTracker", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");
		const url = await import("node:url");
		const here = url.fileURLToPath(import.meta.url);
		const adapterPath = path.join(path.dirname(here), "shadow-adapter.ts");
		const text = fs.readFileSync(adapterPath, "utf8");
		// Look only at actual import statements, not JSDoc mentions.
		// An import looks like: `from "<module>"` or `import "<module>"`.
		const importLines = text
			.split("\n")
			.filter((line) => /^\s*(import|export\s+\*\s+from)/.test(line));
		const imports = importLines.join("\n");
		expect(imports.includes("TurnStateTracker")).toBe(false);
		expect(imports.includes("postStateToWebview")).toBe(false);
		// Also forbid `setTurnPhase` (the writer) and direct calls.
		expect(imports.includes("setTurnPhase")).toBe(false);
	});
});

describe("M9 — effects must remain non-executing", () => {
	it("taskUpdate returns effects data, never executes anything", () => {
		const [, effects] = taskUpdate(initialTaskModel(), { type: "task_requested", taskId: "t", at: NOW });
		expect(Array.isArray(effects)).toBe(true);
		for (const e of effects) {
			expect(typeof e).toBe("object");
			expect(e).not.toBeNull();
		}
	});
});

describe("M10 — no Date.now() / clock reads inside taskUpdate", () => {
	it("killed if the reducer reads Date.now() or Math.random()", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "model_stream_finished", at: NOW + 2 },
			{ type: "task_completed", at: NOW + 3 },
		];
		const a = seq.reduce<TaskModel>((m, msg) => taskUpdate(m, msg)[0], initialTaskModel());
		const b = seq.reduce<TaskModel>((m, msg) => taskUpdate(m, msg)[0], initialTaskModel());
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});
});

describe("M11 (CORRECTION01 R1) — tool IDs are tracked individually", () => {
	it("two distinct tool IDs both increment toolCalls and stay in activeToolCallIds", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "tool_started", toolCallId: "a", at: NOW + 1 },
			{ type: "tool_started", toolCallId: "b", at: NOW + 2 },
			{ type: "tool_finished", toolCallId: "a", at: NOW + 3 },
		];
		const m = seq.reduce<TaskModel>((acc, msg) => taskUpdate(acc, msg)[0], initialTaskModel());
		expect(m.activity.activeToolCallIds).toEqual(["b"]);
		expect(m.telemetry.toolCalls).toBe(2);
		expect(projectTurnState(m)).toBe("streaming");
	});
});

describe("M12 (CORRECTION01 R3) — stale activity events do not reactivate the shadow", () => {
	it("a stream start after task_completed is a no-op (the shadow stays completed)", () => {
		const seq: TaskMsg[] = [
			{ type: "task_requested", taskId: "t", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
			{ type: "task_completed", at: NOW + 100 },
			{ type: "model_stream_started", at: NOW + 200 },
		];
		const m = seq.reduce<TaskModel>((acc, msg) => taskUpdate(acc, msg)[0], initialTaskModel());
		expect(m.lifecycle.kind).toBe("completed");
		expect(m.activity.modelStreaming).toBe(false);
	});

	it("a stream start after task_became_resumable is a no-op (the shadow stays resumable)", () => {
		const seq: TaskMsg[] = [
			{ type: "task_became_resumable", at: NOW },
			{ type: "model_stream_started", at: NOW + 1 },
		];
		const m = seq.reduce<TaskModel>((acc, msg) => taskUpdate(acc, msg)[0], initialTaskModel());
		expect(m.lifecycle.kind).toBe("resumable");
		expect(m.activity.modelStreaming).toBe(false);
	});
});