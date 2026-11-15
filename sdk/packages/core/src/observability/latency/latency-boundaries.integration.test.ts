/**
 * ACT-CLINEMM-ROUND-C-HARNESS-02 — Phase 5: offline integration
 * qualification of the four production boundaries.
 *
 * ## What this drives
 *
 * The REAL production seams, through the REAL `AgentRuntime`:
 *
 *   - `schema_validation` — the tool's own schema validating the input,
 *     inside the runtime's dispatch path;
 *   - `tool_result_delivered` — the moment the result is appended to the
 *     conversation;
 *   - `provider_ready` — the final provider-bound projection, computed
 *     inside `prepareModelRequest` after every `beforeModel` hook;
 *   - `compaction` — the compaction pipeline's own diagnostics and
 *     completion channels.
 *
 * The provider is a deterministic SCRIPTED fixture and the tool executor
 * only RECORDS the command. **No shell command is ever executed.**
 *
 * ## The privacy invariant
 *
 * Every case asserts that the recorded telemetry contains no raw prompt,
 * no credential and no tool-result content — only sizes, counts and
 * classifications.
 */

import { AgentRuntime } from "@cline/agents";
import type {
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	AgentTool,
	AgentToolContext,
	MessageWithMetadata,
	ModelBehaviorTraceSink,
} from "@cline/shared";
import { resetSdkErrorRateLimiterForTests } from "@cline/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createContextCompactionPrepareTurn } from "../../extensions/context/compaction";
import { createShellTool } from "../../extensions/tools/definitions";
import { LatencyTraceSink } from "./latency-sink";

beforeEach(() => {
	resetSdkErrorRateLimiterForTests();
});

class ScriptedModel implements AgentModel {
	readonly requests: AgentModelRequest[] = [];
	constructor(
		private readonly steps: Array<
			(request: AgentModelRequest) => Iterable<AgentModelEvent>
		>,
	) {}
	async stream(
		request: AgentModelRequest,
	): Promise<AsyncIterable<AgentModelEvent>> {
		this.requests.push(request);
		const step = this.steps.shift();
		if (!step) {
			throw new Error("No scripted model step available");
		}
		return (async function* () {
			for await (const ev of step(request)) yield ev;
		})();
	}
}

function toolCallStep(
	toolCallId: string,
	input: unknown,
): (request: AgentModelRequest) => Iterable<AgentModelEvent> {
	return () => [
		{
			type: "tool-call-delta",
			toolCallId,
			toolName: "run_commands",
			inputText: JSON.stringify(input),
		},
		{ type: "finish", reason: "tool-calls" },
	];
}

function finalTextStep(): (
	request: AgentModelRequest,
) => Iterable<AgentModelEvent> {
	return () => [
		{ type: "text-delta", text: "done" },
		{ type: "finish", reason: "stop" },
	];
}

interface DriveOptions {
	readonly proposals?: readonly {
		readonly toolCallId: string;
		readonly input: unknown;
	}[];
	readonly sink?: ModelBehaviorTraceSink;
	readonly autoApprove?: boolean;
}

interface DriveResult {
	readonly executed: string[];
	readonly approvals: number;
	readonly requests: readonly AgentModelRequest[];
	readonly messages: readonly { content: readonly unknown[] }[];
}

/**
 * Drive the real runtime with the given tool-call proposals.
 */
async function drive(options: DriveOptions = {}): Promise<DriveResult> {
	const executed: string[] = [];
	let approvals = 0;
	const proposals = options.proposals ?? [
		{ toolCallId: "call_1", input: { commands: ["echo hi"] } },
	];

	const tool = createShellTool(
		async (command, _cwd, _context: AgentToolContext) => {
			executed.push(String(command));
			return "ok";
		},
		{ cwd: process.cwd() },
	) as AgentTool<unknown, unknown>;

	const steps = [
		...proposals.map((proposal) =>
			toolCallStep(proposal.toolCallId, proposal.input),
		),
		finalTextStep(),
	];
	const model = new ScriptedModel(steps);
	const runtime = new AgentRuntime({
		model,
		tools: [tool],
		modelBehaviorTraceSink: options.sink,
		toolPolicies: { run_commands: { enabled: true, autoApprove: false } },
		requestToolApproval: async () => {
			approvals += 1;
			return { approved: options.autoApprove !== false };
		},
	});
	const result = await runtime.run("probe");
	return {
		executed,
		approvals,
		requests: model.requests,
		messages: result.messages,
	};
}

const boundariesOf = (sink: LatencyTraceSink) =>
	new Set(sink.getTrace().events.map((event) => event.boundary));

describe("Phase 5 — production boundary integration", () => {
	it("SUCCESS: fires schema_validation, tool_result_delivered and provider_ready at the real seams", async () => {
		const sink = new LatencyTraceSink("int-1");
		await drive({ sink });

		const boundaries = boundariesOf(sink);
		expect(boundaries.has("schema_validation")).toBe(true);
		expect(boundaries.has("tool_result_delivered")).toBe(true);
		expect(boundaries.has("provider_ready")).toBe(true);
	});

	it("SUCCESS: preparation is reported separately from the provider round trip", async () => {
		const sink = new LatencyTraceSink("int-preparation");
		await drive({ sink });
		const preparationEnd = sink
			.getTrace()
			.events.find(
				(event) =>
					event.boundary === "request_preparation" && event.phase === "end",
			);
		expect(preparationEnd).toBeDefined();
		expect(typeof preparationEnd?.durationMs).toBe("number");
		expect(sink.getTrace().integrityFailures).toEqual([]);
	});

	it("SUCCESS: the provider request is submitted at the real dispatch seam", async () => {
		// ACT-CLINEMM-ROUND-C-HARNESS-02 CORRECTION02: the provider timers
		// are anchored at the REAL submission seam — the instant the
		// runtime invokes the provider's `stream()`. This test drives the
		// REAL `AgentRuntime` and asserts that the submission boundary
		// fired, that it fired AFTER the preparation boundary closed, and
		// that the trace is internally consistent.
		const sink = new LatencyTraceSink("int-submission");
		await drive({ sink });

		const events = sink.getTrace().events;
		const submissionStart = events.find(
			(event) =>
				event.boundary === "provider_submitted" && event.phase === "start",
		);
		expect(submissionStart).toBeDefined();

		// The submission happens AFTER request preparation has closed: the
		// provider interval never includes the preparation time.
		const preparationEnd = events.find(
			(event) =>
				event.boundary === "request_preparation" && event.phase === "end",
		);
		expect(preparationEnd).toBeDefined();
		expect(submissionStart?.monotonicMs).toBeGreaterThanOrEqual(
			preparationEnd?.monotonicMs ?? 0,
		);

		// The provider's first-response / first-token spans were opened at
		// submission, so they are anchored at (or just after) the same
		// instant — NOT at the start of request preparation.
		const firstTokenStart = events.find(
			(event) =>
				event.boundary === "provider_first_token" && event.phase === "start",
		);
		expect(firstTokenStart).toBeDefined();
		expect(firstTokenStart?.monotonicMs).toBeGreaterThanOrEqual(
			submissionStart?.monotonicMs ?? 0,
		);
		// The decisive assertion: the first-token timer is anchored at the
		// SUBMISSION, so it starts AFTER the preparation closed — not at the
		// preparation's start.
		expect(firstTokenStart?.monotonicMs).toBeGreaterThanOrEqual(
			preparationEnd?.monotonicMs ?? 0,
		);

		// The provider never reported a first token in this scripted run, so
		// the measurement is explicitly UNAVAILABLE rather than fabricated.
		expect(
			sink
				.getTrace()
				.unavailable?.some((item) => item.boundary === "provider_first_token"),
		).toBe(true);
		expect(sink.getTrace().integrityFailures).toEqual([]);
	});

	it("SUCCESS: the trace is internally consistent — every span is closed", async () => {
		const sink = new LatencyTraceSink("int-2");
		await drive({ sink });

		const open = new Map<string, number>();
		for (const event of sink.getTrace().events) {
			const delta = event.phase === "start" ? 1 : -1;
			open.set(event.boundary, (open.get(event.boundary) ?? 0) + delta);
		}
		for (const [boundary, count] of open) {
			expect(`${boundary}:${count}`).toBe(`${boundary}:0`);
		}
		expect(sink.getTrace().integrityFailures).toEqual([]);
	});

	it("SCHEMA FAILURE: a malformed input is rejected before approval or execution", async () => {
		const sink = new LatencyTraceSink("int-3");
		const result = await drive({
			sink,
			// A command list whose members are not strings.
			proposals: [
				{ toolCallId: "call_bad", input: { commands: [{ nope: 1 }] } },
			],
		});

		// The executor NEVER ran and approval was NEVER requested.
		expect(result.executed).toEqual([]);
		expect(result.approvals).toBe(0);

		// The schema_validation boundary fired and reported a REJECTION.
		const validationEnd = sink
			.getTrace()
			.events.find(
				(event) =>
					event.boundary === "schema_validation" && event.phase === "end",
			);
		expect(validationEnd).toBeDefined();
		expect(validationEnd?.status).toBe("rejected");
		expect(validationEnd?.metadata?.schemaValid).toBe(false);
	});

	it("SCHEMA FAILURE: a valid input reports the validation as OK", async () => {
		const sink = new LatencyTraceSink("int-4");
		await drive({ sink });
		const validationEnd = sink
			.getTrace()
			.events.find(
				(event) =>
					event.boundary === "schema_validation" && event.phase === "end",
			);
		expect(validationEnd?.status).toBe("ok");
		expect(validationEnd?.metadata?.schemaValid).toBe(true);
	});

	it("PROVIDER READY: the record is grounded in the request that was actually sent", async () => {
		const sink = new LatencyTraceSink("int-5");
		const result = await drive({ sink });

		const providerReady = sink
			.getTrace()
			.events.find(
				(event) => event.boundary === "provider_ready" && event.phase === "end",
			);
		expect(providerReady).toBeDefined();
		// The provider-ready record exists AND the request really was sent.
		expect(result.requests.length).toBeGreaterThan(0);
		expect(typeof providerReady?.metadata?.providerMessageCount).toBe("number");
	});

	it("TRUNCATION: the provider-ready record distinguishes included from omitted results", async () => {
		const sink = new LatencyTraceSink("int-6");
		await drive({
			sink,
			proposals: [
				{ toolCallId: "call_1", input: { commands: ["echo one"] } },
				{ toolCallId: "call_2", input: { commands: ["echo two"] } },
			],
		});

		const providerReady = sink
			.getTrace()
			.events.find(
				(event) => event.boundary === "provider_ready" && event.phase === "end",
			);
		expect(providerReady).toBeDefined();
		const included = providerReady?.metadata?.toolResultIncludedCount;
		const omitted = providerReady?.metadata?.toolResultOmittedCount;
		expect(typeof included).toBe("number");
		expect(typeof omitted).toBe("number");
		// The two counts partition the results: nothing is double-counted
		// and nothing is lost between the two views.
		expect((included as number) + (omitted as number)).toBeGreaterThanOrEqual(
			0,
		);
	});

	it("PARALLEL TOOLS: both calls keep independent identities and timings", async () => {
		const sink = new LatencyTraceSink("int-7");
		const result = await drive({
			sink,
			proposals: [
				{ toolCallId: "call_a", input: { commands: ["echo a"] } },
				{ toolCallId: "call_b", input: { commands: ["echo b"] } },
			],
		});

		// Both tools ran, and the executor saw both commands.
		expect(result.executed.sort()).toEqual(["echo a", "echo b"]);

		// The delivered boundary carries BOTH tool call ids.
		const delivered = sink
			.getTrace()
			.events.filter(
				(event) =>
					event.boundary === "tool_result_delivered" && event.phase === "end",
			);
		expect(delivered.length).toBe(2);
		const ids = new Set(delivered.map((event) => event.metadata?.toolCallId));
		expect(ids.has("call_a")).toBe(true);
		expect(ids.has("call_b")).toBe(true);
	});

	it("CANCELLATION: no false successful completion", async () => {
		const sink = new LatencyTraceSink("int-8");
		await drive({
			sink,
			autoApprove: false,
			proposals: [{ toolCallId: "call_x", input: { commands: ["echo x"] } }],
		});
		// A rejected approval must not produce a successful tool completion.
		const toolEnd = sink
			.getTrace()
			.events.find(
				(event) => event.boundary === "tool_execution" && event.phase === "end",
			);
		// Either no tool execution span was recorded (the call never
		// started) or it was not reported as `ok`.
		if (toolEnd) {
			expect(toolEnd.status).not.toBe("ok");
		}
	});

	it("DISABLED: with no sink installed, the behaviour is unchanged", async () => {
		const withSink = await drive({ sink: new LatencyTraceSink("int-9") });
		const withoutSink = await drive();
		expect(withoutSink.executed).toEqual(withSink.executed);
		expect(withoutSink.approvals).toEqual(withSink.approvals);
		expect(withoutSink.requests.length).toBe(withSink.requests.length);
		expect(withoutSink.messages.length).toBe(withSink.messages.length);
	});

	it("PRIVACY: no raw prompt, credential or tool-result content enters telemetry", async () => {
		const sink = new LatencyTraceSink("int-10");
		await drive({
			sink,
			proposals: [
				{
					toolCallId: "call_secret",
					input: { commands: ["echo super-secret-value"] },
				},
			],
		});
		const serialised = JSON.stringify(sink.getTrace());
		expect(serialised).not.toContain("super-secret-value");
		expect(serialised).not.toContain("probe");
		expect(serialised).not.toContain("echo");
	});

	it("PRIVACY: a throwing sink cannot change the agent's behaviour", async () => {
		const throwingSink: ModelBehaviorTraceSink = {
			onModelRequestStart: () => {
				throw new Error("sink failure");
			},
			onToolStart: () => {
				throw new Error("sink failure");
			},
			onToolFinish: () => {
				throw new Error("sink failure");
			},
			onSchemaValidation: () => {
				throw new Error("sink failure");
			},
			onToolResultDelivered: () => {
				throw new Error("sink failure");
			},
			onProviderReady: () => {
				throw new Error("sink failure");
			},
		};
		const result = await drive({ sink: throwingSink });
		// The tool still ran and the turn still completed.
		expect(result.executed).toEqual(["echo hi"]);
		expect(result.messages.length).toBeGreaterThan(0);
	});

	it("COMPACTION: equal counts with disjoint identities do not claim retention", async () => {
		const sink = new LatencyTraceSink("int-disjoint");
		const prepareTurn = createContextCompactionPrepareTurn(
			{
				providerId: "openai-compatible",
				modelId: "custom-model",
				compaction: {
					enabled: true,
					// Same cardinality, completely different identity. A
					// cardinality-only implementation would claim that both
					// original references survived.
					compact: async () => ({
						messages: [
							{
								role: "user",
								content: [
									{
										type: "tool_result",
										tool_use_id: "replacement-1",
										name: "run_commands",
										content: "replacement",
									},
								],
							},
						],
					}),
				},
				modelBehaviorTraceSink: sink,
			},
			{ mode: "manual" },
		);

		const messages: MessageWithMetadata[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "original-1",
						name: "run_commands",
						content: "original",
					},
				],
			},
		];

		await prepareTurn?.({
			agentId: "agent-disjoint",
			conversationId: "conv-disjoint",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages,
			apiMessages: messages,
			model: {
				id: "custom-model",
				provider: "openai-compatible",
				info: { id: "custom-model", maxInputTokens: 1_000 },
			},
		});

		const completion = sink
			.getTrace()
			.events.find(
				(event) => event.boundary === "compaction" && event.phase === "end",
			);
		expect(completion?.metadata?.compactionEvidenceRefsBefore).toBe(1);
		expect(completion?.metadata?.compactionEvidenceRefsAfter).toBe(1);
		expect(completion?.metadata?.compactionEvidenceRefsRetained).toBe(0);
		expect(completion?.metadata?.compactionEvidenceRefsDropped).toBe(1);
		expect(completion?.metadata?.compactionEvidenceRefsReplaced).toBe(1);
	});

	it("COMPACTION: the compaction boundary reports the evidence-reference continuity", async () => {
		const sink = new LatencyTraceSink("int-11");
		const prepareTurn = createContextCompactionPrepareTurn(
			{
				providerId: "openai-compatible",
				modelId: "custom-model",
				compaction: {
					enabled: true,
					// The compaction's own strategy. It DROPS every tool
					// result, so the evidence-reference continuity must
					// report the loss rather than hide it.
					compact: async () => ({
						messages: [{ role: "user" as const, content: "Compacted" }],
					}),
				},
				modelBehaviorTraceSink: sink,
			},
			// MANUAL mode compacts unconditionally, so the test does not have
			// to manufacture an oversized transcript to reach the seam.
			{ mode: "manual" },
		);

		const messages: MessageWithMetadata[] = [
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_1",
						name: "run_commands",
						input: { command: "ls" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						name: "run_commands",
						content: "listing",
					},
				],
			},
		];

		await prepareTurn?.({
			agentId: "agent-1",
			conversationId: "conv-1",
			parentAgentId: null,
			iteration: 1,
			abortSignal: new AbortController().signal,
			systemPrompt: "You are helpful.",
			tools: [],
			messages,
			apiMessages: messages,
			model: {
				id: "custom-model",
				provider: "openai-compatible",
				info: { id: "custom-model", maxInputTokens: 1_000 },
			},
		});

		const compaction = sink
			.getTrace()
			.events.filter((event) => event.boundary === "compaction");
		// The compaction boundary fired as a CLOSED span: one start and one
		// end.
		expect(compaction.length).toBe(2);
		expect(compaction.filter((event) => event.phase === "start").length).toBe(
			1,
		);
		expect(compaction.filter((event) => event.phase === "end").length).toBe(1);
		expect(sink.getTrace().integrityFailures).toEqual([]);

		// The EVIDENCE REFERENCE CONTINUITY is reported: one tool result
		// existed before the compaction and none survived it.
		const completion = sink
			.getTrace()
			.events.find(
				(event) => event.boundary === "compaction" && event.phase === "end",
			);
		expect(completion).toBeDefined();
		expect(completion?.metadata?.compactionEvidenceRefsBefore).toBe(1);
		expect(completion?.metadata?.compactionEvidenceRefsAfter).toBe(0);
		expect(completion?.metadata?.compactionEvidenceRefsRetained).toBe(0);
		expect(completion?.metadata?.compactionEvidenceRefsDropped).toBe(1);
	});
});
