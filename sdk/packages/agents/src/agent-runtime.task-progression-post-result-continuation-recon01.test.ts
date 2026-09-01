/**
 * ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-POST-RESULT-CONTINUATION-RECON01
 *
 * Single production-seam discriminator at the [5] boundary (the runtime
 * inner-loop continuation seam, owned by EPIC-CLINEMM-RUNTIME-TASK-
 * PROGRESSION01).
 *
 *   Real AgentRuntime.run("...") (sdk/packages/agents/src/agent-runtime.ts)
 *     -> real AgentTool.execute(...)               (the echo tool)
 *     -> tool result appended to state.messages
 *     -> tool-finished AgentRuntimeEvent emitted
 *     -> turn-finished AgentRuntimeEvent emitted
 *     -> while-loop body iterates                 <-- this is what we probe
 *        -> turn-started (iteration=N)
 *        -> generateAssistantMessageWithOverflowRecovery() called
 *     -> a SUBSEQUENT model request receives the
 *        tool message in its `messages` array      <-- continuation
 *                                                       reached the model
 *     -> second finish: stop
 *     -> run result.status === "completed"
 *
 * Source:
 *   .factory/evidence/ACT-CLINEMM-RUNTIME-TASK-PROGRESSION-POST-RESULT-
 *   CONTINUATION-RECON01/source-seam-map.md
 *
 * RED contract (per ACT §6): "result accepted, session event consumed,
 * continuation decision executes, BUT no continuation request/start AND
 * no explicit terminal/waiting/error outcome." If this state is
 * reachable on HEAD, RED_REPRODUCED.
 *
 * GREEN contract (CORRECTION01 — reviewer P1 fix): the semantic
 * invariant the discriminator actually proves is narrower than exact
 * bookkeeping:
 *
 *   tool result produced
 *     -> a subsequent model request happens
 *     -> that request contains the tool-result message
 *     -> runtime eventually reaches an explicit terminal outcome
 *
 * Forbidden oracles (still): exact listener cardinalities, exact
 * internal counter values, exact object identity, exact number of
 * TurnState writes. A future valid runtime may perform an extra
 * internal iteration / recovery pass / compaction pass that reuses
 * the AgentRuntime.execute() machinery (upstream #12388 cites the
 * exact pattern); freezing the count would over-fit the prototype.
 *
 * Therefore this test asserts the SEMANTIC invariant via a single
 * `continuationObserved` flag flipped by the second scripted step,
 * and weakens bookkeeping to non-strict comparisons
 * (`>= 2`, `contains`, `some(n > 1)`).
 *
 * Composite-evidence classification (per reviewer C1):
 *   AGENT_RUNTIME_INNER_LOOP = REAL_PRODUCTION_SEAM
 *   INPUT / MODEL / TOOL      = SYNTHETIC
 *   COMPOSED_EVIDENCE         = SYNTHETIC_REAL through REAL_PRODUCTION_SEAM
 *   RESULT                    = post-tool AgentRuntime continuation
 *                               reproduced successfully (NOT LIVE;
 *                               does not invalidate the upstream VSCode
 *                               symptom reports in #10537 / #10122,
 *                               only narrows the search space)
 */

import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "./index";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

class ScriptedModel implements AgentModel {
	public readonly requests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(
				request: AgentModelRequest,
			) => Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>
		>,
	) {}
	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) throw new Error("No scripted model step available");
		return toAsync(step(request));
	}
}

async function* toAsync(
	events: Iterable<AgentModelEvent> | AsyncIterable<AgentModelEvent>,
): AsyncIterable<AgentModelEvent> {
	for await (const event of events) yield event;
}

const echoTool = {
	name: "echo",
	description: "Echo input text",
	inputSchema: { type: "object" },
	async execute(input: { text: string }) {
		return { echoed: input.text };
	},
};

describe("P1_POST_RESULT_CONTINUATION_SCHEDULING", () => {
	it("schedules a subsequent iteration after a tool result is appended into the conversation store", async () => {
		// CORRECTION01 (reviewer P1): the GREEN oracle is the SEMANTIC
		// invariant (tool-result message appears in a subsequent model
		// request and the runtime reaches an explicit terminal outcome),
		// NOT exact bookkeeping. A future valid runtime may perform an
		// extra internal iteration / recovery / compaction pass that
		// reuses the AgentRuntime.execute() machinery (cf. upstream
		// #12388). We therefore:
		//   - flip `continuationObserved` from inside the second
		//     scripted step (causality obvious from the test body);
		//   - weaken bookkeeping to non-strict comparisons;
		//   - drop the exact `result.iterations === 2` freeze.
		let continuationObserved = false;
		const turnStartedIterations: number[] = [];
		const model = new ScriptedModel([
			() => [
				{
					type: "tool-call-delta",
					toolCallId: "call_1",
					toolName: "echo",
					inputText: '{"text":"hi"}',
				},
				{ type: "finish", reason: "tool-calls" },
			],
			(request) => {
				// Causal invariant: a SUBSEQUENT model request receives the
				// tool-result message produced by the previous iteration.
				// findLast (vs `.at(-1)`) makes the assertion robust to any
				// future valid runtime that injects bookkeeping messages
				// after the tool result (e.g. recovery notices, hook
				// injections).
				const toolMessage = request.messages.findLast((m) => m.role === "tool");
				expect(toolMessage).toBeDefined();
				expect(toolMessage?.content[0]).toMatchObject({
					type: "tool-result",
					toolCallId: "call_1",
				});
				continuationObserved = true;
				return [
					{ type: "text-delta", text: "after-tool" },
					{ type: "finish", reason: "stop" },
				];
			},
		]);
		const runtime = new AgentRuntime({ model, tools: [echoTool] });
		runtime.subscribe((event) => {
			if (event.type === "turn-started") {
				turnStartedIterations.push(event.iteration);
			}
		});

		const result = await runtime.run("Start");

		// (1) Causal oracle: the runtime's while-loop actually iterated
		// past the tool-result publication into a subsequent model
		// request, and that request contained the tool-result message.
		expect(continuationObserved).toBe(true);
		// (2) Bookkeeping proxies — weakened to non-strict (do not
		// over-fit to a fixed iteration count). The exact values are
		// incidental: any future valid runtime that performs an extra
		// internal iteration (recovery, compaction, etc.) would still
		// satisfy these.
		expect(model.requests.length).toBeGreaterThanOrEqual(2);
		expect(turnStartedIterations).toContain(1);
		expect(turnStartedIterations.some((n) => n > 1)).toBe(true);
		// (3) The runtime reached an explicit documented terminal outcome
		// (one of A/B/C from §5). NOT a silent stall.
		expect(result.status).toBe("completed");
		expect(result.outputText).toBe("after-tool");
	});
});
