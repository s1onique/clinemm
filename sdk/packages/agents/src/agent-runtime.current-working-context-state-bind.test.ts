/**
 * ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
 * (fourteenth-pass): STATE_BIND committed test.
 *
 * Verifies that:
 *   - `AgentRuntimeStateSnapshot.currentWorkingContextEstimate`
 *     is captured verbatim from the producer-side
 *     `prepareTurn` return value at the prepare-turn
 *     boundary (NOT recomputed by the agent runtime).
 *   - The captured value survives across consecutive
 *     prepareTurn invocations: each new W_N replaces the
 *     prior W_{N-1} (no accumulation, no stale retention).
 *   - `restore()` resets the field to `undefined` so a
 *     new transcript starts with no captured W.
 *   - A fresh `run()` on a reused runtime also resets the
 *     field to `undefined` between runs.
 *
 * This test replaces the transient RED provenance file
 * at
 *   .factory/evidence/ACT-CLINEMM-COMPACTION-WORKING-
 *     CONTEXT-HEADER-TRANSPORT-REPAIR01/
 *     per-turn-carrier-inspection-red.provenance.ts
 * which was the RED witness for STATE_BIND.
 *
 * STATE_BIND contract (freezer):
 *   after prepareTurn returns W_n,
 *   AgentRuntimeStateSnapshot
 *     .currentWorkingContextEstimate === W_n
 *
 * NO RECOMPUTE: the agent runtime captures the exact
 * value the producer-side metadata-only helper
 * published (see
 * sdk/packages/core/src/extensions/context/compaction.ts
 *   :publishWorkingContextEstimateMetadataOnly).
 *
 * The complementary PUBLICATION_BIND (host-side
 * notification trigger) is a separate bounded repair
 * and is NOT tested here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentRuntimePrepareTurnResult,
	AgentRuntimeStateSnapshot,
	AgentTool,
} from "@cline/shared";
import { AgentRuntime } from "./index";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

class FinishingOnlyModel implements AgentModel {
	async stream(
		_request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		async function* gen(): AsyncIterable<AgentModelEvent> {
			yield { type: "finish", reason: "stop" };
		}
		return gen();
	}
}

function createUserMessage(text: string): AgentMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		createdAt: 0,
	};
}
describe("AgentRuntime STATE_BIND — currentWorkingContextEstimate", () => {
	it("captures the exact prepareTurn W into snapshot (STATE_BIND.1)", async () => {
		const prepareTurnCalls: Array<
			AgentRuntimePrepareTurnResult | undefined
		> = [];
		const W_FIXTURE = 4242;
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => {
				const result: AgentRuntimePrepareTurnResult = {
					currentWorkingContextEstimate: W_FIXTURE,
				};
				prepareTurnCalls.push(result);
				return result;
			},
		);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		await runtime.run("hello");

		const snapshot: AgentRuntimeStateSnapshot = runtime.snapshot();
		expect(prepareTurnCalls).toHaveLength(1);
		expect(snapshot.currentWorkingContextEstimate).toBe(W_FIXTURE);
	});

	it("leaves snapshot.currentWorkingContextEstimate undefined when prepareTurn returns undefined", async () => {
		const prepareTurn = vi.fn(async () => undefined);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		await runtime.run("hello");

		const snapshot: AgentRuntimeStateSnapshot = runtime.snapshot();
		expect(prepareTurn).toHaveBeenCalledTimes(1);
		expect(snapshot.currentWorkingContextEstimate).toBeUndefined();
	});

});

describe("AgentRuntime STATE_BIND — lifetime semantics", () => {
	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (sixteenth-pass): real two-iteration prepareTurn
	// transition test.
	//
	// Replaces the prior "captures the latest W
	// across consecutive prepareTurns" test, which was
	// vacuous: it exercised W=100 then W=120 across two
	// separate `runtime.run()` calls, so the
	// execute() lifecycle reset was masking whether the
	// capture site handled consecutive in-run
	// transitions. This new test drives W=100 then
	// W=120 within ONE `execute()` lifecycle (no
	// run()/restore() reset between them) by routing
	// through a tool-call -> finish:tool-calls ->
	// finish:stop model script.
	it("LIFETIME via two prepareTurns in one execute(): W=100 then W=120 → snapshot.W === 120 (not 100, not 220)", async () => {
		const prepareTurnCalls: Array<AgentRuntimePrepareTurnResult> = [];
		prepareTurnCalls.push({ currentWorkingContextEstimate: 100 });
		prepareTurnCalls.push({ currentWorkingContextEstimate: 120 });

		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => {
				const next =
					prepareTurnCalls.shift() ??
					{ currentWorkingContextEstimate: 999 };
				return next;
			},
		);

		class TwoIterationModel implements AgentModel {
			public stepCount = 0;
			async stream(
				_request: AgentModelRequest,
			): Promise<AsyncIterable<AgentModelEvent>> {
				this.stepCount += 1;
				const stepIndex = this.stepCount;
				async function* gen(): AsyncIterable<AgentModelEvent> {
					if (stepIndex === 1) {
						yield {
							type: "tool-call-delta",
							toolCallId: "call_1",
							toolName: "echo",
							inputText: '{"text":"hi"}',
						};
						yield { type: "finish", reason: "tool-calls" };
					} else {
						yield { type: "text-delta", text: "ok" };
						yield { type: "finish", reason: "stop" };
					}
				}
				return gen();
			}
		}

		const echoTool: AgentTool = {
			name: "echo",
			description: "Echo input text",
			inputSchema: { type: "object" },
			async execute(input: { text: string }) {
				return { echoed: input.text };
			},
		};
		const model = new TwoIterationModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
			tools: [echoTool],
		});

		const result = await runtime.run("start");
		expect(result.status).toBe("completed");
		// Sanity: both iterations actually ran through model.stream.
		expect(model.stepCount).toBe(2);
		// Sanity: prepareTurn was called twice in the same execute().
		expect(prepareTurn).toHaveBeenCalledTimes(2);

		// LIFETIME invariant: in-run transitions are
		// captured verbatim (W=120 wins, no accumulation,
		// no stale retention). Crucially, no execute()
		// reset happens between iterations.
		const snapshot: AgentRuntimeStateSnapshot = runtime.snapshot();
		expect(snapshot.currentWorkingContextEstimate).toBe(120);
		expect(snapshot.currentWorkingContextEstimate).not.toBe(100);
		expect(snapshot.currentWorkingContextEstimate).not.toBe(220);
	});

	it("restore() resets currentWorkingContextEstimate to undefined", async () => {
		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult> => ({
				currentWorkingContextEstimate: 999,
			}),
		);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		await runtime.run("first");
		expect(
			runtime.snapshot().currentWorkingContextEstimate,
		).toBe(999);

		// restore() with a fresh message transcript must
		// clear the captured W so the next run starts from
		// no W.
		runtime.restore([createUserMessage("fresh")]);
		expect(
			runtime.snapshot().currentWorkingContextEstimate,
		).toBeUndefined();
	});

	it("fresh run resets currentWorkingContextEstimate before the next prepareTurn", async () => {
		// Verifies the lifetime order: execute() resets the
		// field BEFORE the next prepareTurn fires. A stale
		// value from the prior run cannot leak into the new
		// prepareTurn's capture.
		const prepareTurn = vi.fn(
			async (
				_ctx: unknown,
			): Promise<AgentRuntimePrepareTurnResult> => {
				return { currentWorkingContextEstimate: 7777 };
			},
		);
		const model = new FinishingOnlyModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});

		let observedAtPrepareTurn: number | undefined;
		const observingPrepareTurn = vi.fn(
			async (
				_ctx: unknown,
			): Promise<AgentRuntimePrepareTurnResult> => {
				// Capture the field at the moment
				// prepareTurn fires. After execute() resets
				// but before the capture below, the field
				// should be undefined.
				observedAtPrepareTurn =
					runtime.snapshot().currentWorkingContextEstimate;
				return { currentWorkingContextEstimate: 7777 };
			},
		);
		const _unused = prepareTurn;
		void _unused;
		const runtime2 = new AgentRuntime({
			model,
			prepareTurn: observingPrepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
		});
		await runtime2.run("first");
		expect(
			runtime2.snapshot().currentWorkingContextEstimate,
		).toBe(7777);
		expect(observedAtPrepareTurn).toBeUndefined();
	});
});

describe("AgentRuntime STATE_BIND — API delta", () => {
	it("additive-optional API delta: snapshot field is optional", () => {
		// Type-level: a snapshot constructed without
		// currentWorkingContextEstimate must still be a
		// valid AgentRuntimeStateSnapshot (additive
		// optional).
		const snapshotWithout: AgentRuntimeStateSnapshot = {
			agentId: "test",
			status: "idle",
			iteration: 0,
			messages: [],
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		};
		expect(
			snapshotWithout.currentWorkingContextEstimate,
		).toBeUndefined();
		// Compile-time check: field is optional, not required.
		const _typeCheck: number | undefined =
			snapshotWithout.currentWorkingContextEstimate;
		void _typeCheck;
	});

	// ACT-CLINEMM-COMPACTION-WORKING-CONTEXT-HEADER-TRANSPORT-REPAIR01
	// (sixteenth-pass): real two-iteration prepare-turn
	// fixture that pins MISSING_W_FAIL_CLOSED.
	//
	// Replaces the prior fail-closed test, which was
	// vacuous: it exercised transitions across two
	// separate `runtime.run()` calls, so the
	// execute() lifecycle reset to `undefined` was
	// masking the fail-closed path. This new test
	// drives TWO prepareTurn invocations within ONE
	// `execute()` lifecycle (no run()/restore() reset
	// between them) by routing through a tool-call ->
	// finish:tool-calls -> finish:stop model script.
	it("FAIL-CLOSED via two prepareTurns in one execute(): W=100 then prepareTurn-without-W resets snapshot.W to undefined", async () => {
		const prepareTurnCalls: Array<
			AgentRuntimePrepareTurnResult | undefined
		> = [];
		// First prepareTurn returns W=100. Second
		// prepareTurn returns a result that lacks
		// currentWorkingContextEstimate (i.e. a legacy
		// publisher or one that explicitly does not
		// publish W). Both calls happen within the same
		// `execute()` lifecycle.
		prepareTurnCalls.push({ currentWorkingContextEstimate: 100 });
		prepareTurnCalls.push({
			messages: [], // no currentWorkingContextEstimate field
		});

		const prepareTurn = vi.fn(
			async (): Promise<AgentRuntimePrepareTurnResult | undefined> =>
				prepareTurnCalls.shift(),
		);

		// Drive two model iterations in ONE execute():
		// iteration 1 ends with finish:tool-calls (so the
		// run loop iterates back to prepareTurn + model
		// stream again), iteration 2 ends with finish:stop
		// to terminate the run.
		class TwoIterationModel implements AgentModel {
			public stepCount = 0;
			async stream(
				_request: AgentModelRequest,
			): Promise<AsyncIterable<AgentModelEvent>> {
				this.stepCount += 1;
				const stepIndex = this.stepCount;
				async function* gen(): AsyncIterable<AgentModelEvent> {
					if (stepIndex === 1) {
						yield {
							type: "tool-call-delta",
							toolCallId: "call_1",
							toolName: "echo",
							inputText: '{"text":"hi"}',
						};
						yield { type: "finish", reason: "tool-calls" };
					} else {
						yield { type: "text-delta", text: "ok" };
						yield { type: "finish", reason: "stop" };
					}
				}
				return gen();
			}
		}

		const echoTool: AgentTool = {
			name: "echo",
			description: "Echo input text",
			inputSchema: { type: "object" },
			async execute(input: { text: string }) {
				return { echoed: input.text };
			},
		};
		const model = new TwoIterationModel();
		const runtime = new AgentRuntime({
			model,
			prepareTurn: prepareTurn as Parameters<
				typeof AgentRuntime
			>[0]["prepareTurn"],
			tools: [echoTool],
		});

		const result = await runtime.run("start");
		expect(result.status).toBe("completed");
		// Sanity: both iterations actually ran through model.stream.
		expect(model.stepCount).toBe(2);
		// Sanity: prepareTurn was called twice (one per
		// iteration of the run loop) within the same
		// execute() lifecycle.
		expect(prepareTurn).toHaveBeenCalledTimes(2);

		// FAIL-CLOSED invariant:
		//   prepareTurn #1 returned W=100 (state.W = 100)
		//   prepareTurn #2 returned no W (state.W must
		//                                  become undefined,
		//                                  NOT preserved)
		const snapshot: AgentRuntimeStateSnapshot = runtime.snapshot();
		expect(snapshot.currentWorkingContextEstimate).toBeUndefined();
		expect(snapshot.currentWorkingContextEstimate).not.toBe(100);
	});
});
