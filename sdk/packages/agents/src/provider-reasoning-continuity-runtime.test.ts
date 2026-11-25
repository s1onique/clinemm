/**
 * ACT-CLINEMM-PROVIDER-REASONING-CONTINUITY-P0-01-CORRECTION01 (P0-1).
 *
 * The REAL-runtime reasoning-continuity witness.
 *
 * THE SEAM
 * --------
 * This suite replaces ONLY the external network boundary. Everything else is
 * the production implementation:
 *
 *   synthetic Anthropic-protocol SSE bytes
 *     -> the RESOLVED @ai-sdk/anthropic adapter
 *     -> the REAL ClineMM translator (@cline/llms)
 *     -> the REAL AgentRuntime accumulation (@cline/agents)
 *     -> a REAL deterministic test tool, executed by the runtime
 *     -> the REAL follow-up request construction
 *     -> the REAL provider serializer
 *     -> the CAPTURED outbound HTTP request
 *
 * No assistant history and no tool-result message is assembled by the test.
 * The runtime builds them.
 *
 * The acceptance authority is the EXACT serialized outbound HTTP request.
 */

import { createGateway } from "@cline/llms";
import type {
	AgentMessage,
	AgentModelRequest,
	AgentTool,
	AgentToolContext,
	ITelemetryService,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "./agent-runtime";

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const MODEL_ID = "claude-sonnet-4-6";

/** A synthetic, opaque Anthropic-style signature (no cryptographic meaning). */
const SIGNATURE_A = "synthetic-opaque-signature-aa11bb22";
const SIGNATURE_B = "synthetic-opaque-signature-cc33dd44";
/** Synthetic, non-secret reasoning texts. */
const REASONING_A = "SYNTHETIC-REASONING-A";
const REASONING_B = "SYNTHETIC-REASONING-B";
const TOOL_NAME = "read_synthetic_file";
const TOOL_RESULT = "SYNTHETIC-TOOL-RESULT-OK";
const TOOL_CALL_ID = "toolu_synthetic_0001";

const MESSAGE_START =
	'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n';

const MESSAGE_STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

function thinkingBlock(
	index: number,
	text: string,
	signature: string,
): string[] {
	return [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"thinking","thinking":""}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"thinking_delta","thinking":"${text}"}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"signature_delta","signature":"${signature}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	];
}

/**
 * An EMPTY signed thinking block.
 *
 * The Anthropic Messages contract allows an empty `thinking` string; the
 * block's SIGNATURE arrives separately through the `signature_delta` event.
 * This is contract-valid and the signature is still provider-owned.
 */
function emptySignedThinkingBlock(index: number, signature: string): string[] {
	return [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"thinking","thinking":""}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"signature_delta","signature":"${signature}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	];
}

function toolUseBlock(index: number, id: string): string[] {
	return [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"tool_use","id":"${id}","name":"${TOOL_NAME}","input":{}}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	];
}

function textBlock(index: number, text: string): string[] {
	return [
		`event: content_block_start\ndata: {"type":"content_block_start","index":${index},"content_block":{"type":"text","text":""}}\n\n`,
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":${index},"delta":{"type":"text_delta","text":"${text}"}}\n\n`,
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}\n\n`,
	];
}

type CapturedBody = Record<string, unknown>;

function makeFetch(responses: (() => Response)[]) {
	const calls: CapturedBody[] = [];
	let index = 0;
	const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
		const raw = init?.body;
		calls.push(
			typeof raw === "string"
				? (JSON.parse(raw) as CapturedBody)
				: ({} as CapturedBody),
		);
		const factory = responses[Math.min(index, responses.length - 1)];
		index += 1;
		return factory();
	}) as unknown as typeof fetch;
	return { fetchImpl, calls };
}

function telemetryMock(): ITelemetryService {
	return {
		capture: () => undefined,
		captureRequired: () => undefined,
		setDistinctId: () => undefined,
		setMetadata: () => undefined,
		updateMetadata: () => undefined,
		setCommonProperties: () => undefined,
		updateCommonProperties: () => undefined,
		isEnabled: () => false,
		recordCounter: () => undefined,
		recordHistogram: () => undefined,
		recordGauge: () => undefined,
		flush: async () => undefined,
		dispose: async () => undefined,
	} as unknown as ITelemetryService;
}

/** The deterministic test tool, executed by the REAL runtime. */
function makeTool(
	executions: string[],
): AgentTool<Record<string, unknown>, { output: string }> {
	return {
		name: TOOL_NAME,
		description: "A synthetic tool used only by this test.",
		inputSchema: { type: "object", properties: {} },
		execute: async (
			_input: Record<string, unknown>,
			_ctx: AgentToolContext,
		) => {
			executions.push(TOOL_NAME);
			return { output: TOOL_RESULT };
		},
	};
}

function blocksOf(body: CapturedBody): Array<Record<string, unknown>> {
	const messages = body.messages as Array<Record<string, unknown>>;
	return messages.flatMap((message) =>
		Array.isArray(message.content)
			? (message.content as Array<Record<string, unknown>>)
			: [],
	);
}

function assistantBlocks(body: CapturedBody): Array<Record<string, unknown>> {
	const messages = body.messages as Array<Record<string, unknown>>;
	const assistant = messages.find((message) => message.role === "assistant");
	return (assistant?.content ?? []) as Array<Record<string, unknown>>;
}

const executions0: string[] = [];

describe("provider reasoning continuity through the REAL AgentRuntime", () => {
	it("RT1: replays the provider's signed reasoning, tool call and tool result in the follow-up request", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			// Turn 1: signed reasoning + a tool call.
			() =>
				new Response(
					[
						MESSAGE_START,
						...thinkingBlock(0, REASONING_A, SIGNATURE_A),
						...toolUseBlock(1, TOOL_CALL_ID),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			// Turn 2: a plain text answer, which ends the run.
			() =>
				new Response(
					[
						MESSAGE_START,
						...textBlock(0, "DONE"),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
		]);

		// The REAL gateway, with ONLY the network boundary replaced.
		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "test-key",
					baseUrl: ANTHROPIC_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		// The REAL runtime, driven by the REAL gateway's model.
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId: "anthropic",
				modelId: MODEL_ID,
			}),
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});

		const result = await runtime.run("SYNTHETIC-PROMPT");

		// The runtime really did execute the tool.
		expect(executions).toEqual([TOOL_NAME]);
		expect(result.status).toBe("completed");

		// The runtime really did make TWO provider requests.
		expect(calls).toHaveLength(2);

		// ---- THE FOLLOW-UP REQUEST (the acceptance authority) ----
		const followUp = calls[1];
		const assistant = assistantBlocks(followUp);

		// The provider-required reasoning, WITH its signature, is replayed.
		expect(assistant).toEqual([
			{
				type: "thinking",
				thinking: REASONING_A,
				signature: SIGNATURE_A,
			},
			{
				type: "tool_use",
				id: TOOL_CALL_ID,
				name: TOOL_NAME,
				input: {},
			},
		]);

		// The tool result is present exactly once, with the original id.
		const toolResults = blocksOf(followUp).filter(
			(block) => block.type === "tool_result",
		);
		expect(toolResults).toHaveLength(1);
		expect(toolResults[0].tool_use_id).toBe(TOOL_CALL_ID);
		expect(JSON.stringify(toolResults[0].content)).toContain(TOOL_RESULT);
	});

	it("RT2: keeps TWO signed thinking blocks distinct, in order, each with its OWN signature", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() =>
				new Response(
					[
						MESSAGE_START,
						...thinkingBlock(0, REASONING_A, SIGNATURE_A),
						...thinkingBlock(1, REASONING_B, SIGNATURE_B),
						...toolUseBlock(2, TOOL_CALL_ID),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			() =>
				new Response(
					[
						MESSAGE_START,
						...textBlock(0, "DONE"),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
		]);

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "test-key",
					baseUrl: ANTHROPIC_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId: "anthropic",
				modelId: MODEL_ID,
			}),
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});

		await runtime.run("SYNTHETIC-PROMPT");

		expect(executions).toEqual([TOOL_NAME]);
		expect(calls).toHaveLength(2);

		const assistant = assistantBlocks(calls[1]);
		const thinking = assistant.filter((block) => block.type === "thinking");

		// EXACT ordered equality: each block keeps its own text AND its own
		// signature. A merged A+B block, a swapped signature, a missing
		// block, a duplicate block or a reordered pair all FAIL this.
		expect(thinking).toEqual([
			{
				type: "thinking",
				thinking: REASONING_A,
				signature: SIGNATURE_A,
			},
			{
				type: "thinking",
				thinking: REASONING_B,
				signature: SIGNATURE_B,
			},
		]);

		// The tool call keeps its original position AFTER the thinking blocks.
		expect(assistant.map((block) => block.type)).toEqual([
			"thinking",
			"thinking",
			"tool_use",
		]);
		expect(assistant[2]).toEqual({
			type: "tool_use",
			id: TOOL_CALL_ID,
			name: TOOL_NAME,
			input: {},
		});

		// The ClineMM-owned origin bookkeeping NEVER reaches the provider.
		expect(JSON.stringify(calls[1])).not.toContain("__clineReasoningOrigin");
	});

	it("RT3: conserves an EMPTY signed thinking block", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() =>
				new Response(
					[
						MESSAGE_START,
						...emptySignedThinkingBlock(0, SIGNATURE_A),
						...toolUseBlock(1, TOOL_CALL_ID),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			() =>
				new Response(
					[
						MESSAGE_START,
						...textBlock(0, "DONE"),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
		]);

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "test-key",
					baseUrl: ANTHROPIC_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId: "anthropic",
				modelId: MODEL_ID,
			}),
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});

		await runtime.run("SYNTHETIC-PROMPT");

		// No EXTRA tool executions and no EXTRA inference rounds.
		expect(executions).toEqual([TOOL_NAME]);
		expect(calls).toHaveLength(2);

		const assistant = assistantBlocks(calls[1]);
		const thinking = assistant.filter((block) => block.type === "thinking");

		// The provider-owned signature survives DESPITE the empty text, and
		// NO placeholder text is fabricated.
		expect(thinking).toEqual([
			{
				type: "thinking",
				thinking: "",
				signature: SIGNATURE_A,
			},
		]);
	});

	it("RT4: keeps the Anthropic reasoning metadata OUT of tool-call records", async () => {
		// The reasoning repair must not broaden the propagation of Anthropic
		// opaque reasoning metadata into unrelated tool-call records.
		const { fetchImpl, calls } = makeFetch([
			() =>
				new Response(
					[
						MESSAGE_START,
						...thinkingBlock(0, REASONING_A, SIGNATURE_A),
						...toolUseBlock(1, TOOL_CALL_ID),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			() =>
				new Response(
					[
						MESSAGE_START,
						...textBlock(0, "DONE"),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
		]);

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "test-key",
					baseUrl: ANTHROPIC_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId: "anthropic",
				modelId: MODEL_ID,
			}),
			tools: [makeTool(executions0)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});

		await runtime.run("SYNTHETIC-PROMPT");

		// The Anthropic reasoning signature appears ONLY on the reasoning
		// block. The tool_use block carries NO reasoning metadata.
		const assistant = assistantBlocks(calls[1]);
		const toolUse = assistant.find((block) => block.type === "tool_use");
		expect(toolUse).toEqual({
			type: "tool_use",
			id: TOOL_CALL_ID,
			name: TOOL_NAME,
			input: {},
		});
	});
});

describe("MiniMax real-runtime reasoning continuity", () => {
	const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
	const M31_MODEL_ID = "MiniMax-M3.1-Flash";

	function minimaxMessageStart(): string {
		return 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n';
	}

	it("RT5: replays the MiniMax signed reasoning and keeps Low as Low on every request", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() =>
				new Response(
					[
						minimaxMessageStart(),
						...thinkingBlock(0, REASONING_A, SIGNATURE_A),
						...toolUseBlock(1, TOOL_CALL_ID),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			() =>
				new Response(
					[
						minimaxMessageStart(),
						...textBlock(0, "DONE"),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
		]);

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: MINIMAX_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId: "minimax",
				modelId: M31_MODEL_ID,
			}),
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
			modelOptions: { reasoning: { enabled: true, effort: "low" } },
		});

		await runtime.run("SYNTHETIC-PROMPT");

		expect(executions).toEqual([TOOL_NAME]);
		expect(calls).toHaveLength(2);

		// A4 CONSERVATION: Low stays Low on EVERY captured MiniMax request.
		for (const body of calls) {
			expect(body.output_config).toMatchObject({ effort: "low" });
		}

		// The provider-required signed reasoning reaches the wire.
		const assistant = assistantBlocks(calls[1]);
		expect(assistant.filter((block) => block.type === "thinking")).toEqual([
			{
				type: "thinking",
				thinking: REASONING_A,
				signature: SIGNATURE_A,
			},
		]);
	});

	it("RT6: keeps TWO MiniMax signed thinking blocks distinct, each with its OWN signature", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() =>
				new Response(
					[
						minimaxMessageStart(),
						...thinkingBlock(0, REASONING_A, SIGNATURE_A),
						...thinkingBlock(1, REASONING_B, SIGNATURE_B),
						...toolUseBlock(2, TOOL_CALL_ID),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			() =>
				new Response(
					[
						minimaxMessageStart(),
						...textBlock(0, "DONE"),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
		]);

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: MINIMAX_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId: "minimax",
				modelId: M31_MODEL_ID,
			}),
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});

		await runtime.run("SYNTHETIC-PROMPT");

		expect(executions).toEqual([TOOL_NAME]);
		expect(calls).toHaveLength(2);

		const assistant = assistantBlocks(calls[1]);
		// EXACT ordered equality: two DISTINCT blocks, each with its own text
		// and its own signature.
		expect(assistant.filter((block) => block.type === "thinking")).toEqual([
			{
				type: "thinking",
				thinking: REASONING_A,
				signature: SIGNATURE_A,
			},
			{
				type: "thinking",
				thinking: REASONING_B,
				signature: SIGNATURE_B,
			},
		]);
		// The tool call keeps its original position AFTER the thinking blocks.
		expect(assistant.map((block) => block.type)).toEqual([
			"thinking",
			"thinking",
			"tool_use",
		]);
	});
});

describe("same-adapter provider-origin conservation", () => {
	const MINI_MAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
	const ANTHROPIC_OFFICIAL_BASE_URL = "https://api.anthropic.com/v1";
	const M31_MODEL_ID = "MiniMax-M3.1-Flash";

	it("RT8: a native Anthropic signature does not cross into a MiniMax-origin request", async () => {
		// The SOURCE is the native Anthropic endpoint; the DESTINATION is the
		// MiniMax endpoint. Both use the SAME Anthropic adapter, so the
		// adapter itself cannot distinguish them — the request construction
		// must.
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() =>
				new Response(
					[
						MESSAGE_START,
						...thinkingBlock(0, REASONING_A, SIGNATURE_A),
						...toolUseBlock(1, TOOL_CALL_ID),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":10}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
			() =>
				new Response(
					[
						MESSAGE_START,
						...textBlock(0, "DONE"),
						'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n',
						MESSAGE_STOP,
					].join(""),
					{ headers: { "content-type": "text/event-stream" } },
				),
		]);

		const gateway = createGateway({
			providerConfigs: [
				{
					providerId: "anthropic",
					apiKey: "test-key",
					baseUrl: ANTHROPIC_OFFICIAL_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		const runtime = createAgentRuntime({
			model: gateway.createAgentModel({
				providerId: "anthropic",
				modelId: MODEL_ID,
			}),
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});

		await runtime.run("SYNTHETIC-PROMPT");

		// The runtime transcript is the SOURCE side.
		const sourceTranscript = runtime.snapshot().messages;

		// The SAME transcript is now replayed to a DIFFERENT endpoint
		// identity that uses the SAME adapter.
		const destinationGateway = createGateway({
			providerConfigs: [
				{
					providerId: "minimax",
					apiKey: "test-key",
					baseUrl: MINI_MAX_BASE_URL,
					fetch: fetchImpl,
				},
			],
		});
		const destinationRuntime = createAgentRuntime({
			model: destinationGateway.createAgentModel({
				providerId: "minimax",
				modelId: M31_MODEL_ID,
			}),
			tools: [makeTool(executions)],
			requestToolApproval: () => ({ approved: true }),
			telemetry: telemetryMock(),
		});
		destinationRuntime.restore(sourceTranscript);
		await destinationRuntime.run("SYNTHETIC-PROMPT");

		// The destination request is the LAST captured one.
		const destinationBody = calls[calls.length - 1];
		const destinationThinking = assistantBlocks(destinationBody).filter(
			(block) => block.type === "thinking",
		);

		// DISPOSITION: the opaque Anthropic signature produced by the SOURCE
		// endpoint is NOT replayed to the DIFFERENT-origin destination
		// endpoint. The reasoning TEXT is preserved (it is not opaque), but
		// the opaque provider metadata does not cross the origin boundary.
		expect(JSON.stringify(destinationBody)).not.toContain(SIGNATURE_A);
		for (const block of destinationThinking) {
			expect(block.signature).toBeUndefined();
		}
	});
});
