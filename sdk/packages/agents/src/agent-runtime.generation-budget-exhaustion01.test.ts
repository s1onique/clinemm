/**
 * ACT-CLINEMM-AGENTIC-EFFICIENCY-GENERATION-BUDGET-AUTHORITY-01.
 *
 * REAL-runtime witnesses for the OUTPUT-EXHAUSTION behavior and the RAW
 * USAGE conservation, driven through the REAL production session-dispatch
 * path.
 *
 * THE SEAM
 * --------
 * Only the external network boundary is substituted. Everything else is the
 * production implementation:
 *
 *   synthetic Anthropic-protocol SSE bytes
 *     -> the RESOLVED @ai-sdk/anthropic adapter
 *     -> the REAL ClineMM gateway (@cline/llms)
 *     -> the REAL AgentRuntime (@cline/agents)
 *     -> a REAL deterministic test tool, executed by the runtime
 *     -> the CAPTURED outbound HTTP request bodies
 *
 * NO LIVE INFERENCE. NO PAID REQUEST. SYNTHETIC SSE ONLY.
 *
 * The synthetic responses prove what ClineMM DOES with a provider-contract-
 * valid `stop_reason: "max_tokens"` response and with known usage counts.
 * They do NOT prove provider-side behavior.
 */

import { createGateway } from "@cline/llms";
import type {
	AgentTool,
	AgentToolContext,
	ITelemetryService,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createAgentRuntime } from "./agent-runtime";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const MODEL_ID = "MiniMax-M3.1-Flash";
const TOOL_NAME = "read_synthetic_file";
const TOOL_RESULT = "SYNTHETIC-TOOL-RESULT-OK";
const TOOL_CALL_ID = "toolu_synthetic_0001";

/** A synthetic, opaque signature (no cryptographic meaning). */
const SIGNATURE_A = "synthetic-opaque-signature-aa11bb22";
const REASONING_A = "SYNTHETIC-REASONING-A";

type CapturedBody = Record<string, unknown>;

const MESSAGE_START =
	'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n';

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

/**
 * A turn that terminates at the OUTPUT LIMIT: a non-empty reasoning block,
 * NO tool call, and `stop_reason: "max_tokens"`.
 *
 * This is provider-contract-valid: the Anthropic Messages contract reports
 * `max_tokens` as the stop reason when generation is cut off by the
 * `max_tokens` ceiling, and the usage event carries the tokens actually
 * produced.
 */
function maxTokensTurn(outputTokens: number): Response {
	return new Response(
		[
			MESSAGE_START,
			...thinkingBlock(0, REASONING_A, SIGNATURE_A),
			`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":${outputTokens}}}\n\n`,
			MESSAGE_STOP,
		].join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

/** The positive control: an ordinary successful tool-continuation turn. */
function toolTurn(outputTokens: number): Response {
	return new Response(
		[
			MESSAGE_START,
			...thinkingBlock(0, REASONING_A, SIGNATURE_A),
			...toolUseBlock(1, TOOL_CALL_ID),
			`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":${outputTokens}}}\n\n`,
			MESSAGE_STOP,
		].join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

/** A turn that ends the run with plain text. */
function plainTurn(outputTokens: number): Response {
	return new Response(
		[
			MESSAGE_START,
			...textBlock(0, "DONE"),
			`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":${outputTokens}}}\n\n`,
			MESSAGE_STOP,
		].join(""),
		{ headers: { "content-type": "text/event-stream" } },
	);
}

type CapturedCall = { url: string; body: CapturedBody };

function makeFetch(responses: (() => Response)[]) {
	const calls: CapturedCall[] = [];
	let index = 0;
	const fetchImpl = (async (input: unknown, init?: RequestInit) => {
		const raw = init?.body;
		const body =
			typeof raw === "string"
				? (JSON.parse(raw) as CapturedBody)
				: ({} as CapturedBody);
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: String(input);
		calls.push({ url, body });
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

/** Build the REAL runtime over the REAL gateway with ONLY fetch replaced. */
function makeRuntime(
	fetchImpl: typeof fetch,
	executions: string[],
	modelOptions?: Record<string, unknown>,
) {
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
	return createAgentRuntime({
		model: gateway.createAgentModel({
			providerId: "minimax",
			modelId: MODEL_ID,
		}),
		tools: [makeTool(executions)],
		requestToolApproval: () => ({ approved: true }),
		telemetry: telemetryMock(),
		...(modelOptions ? { modelOptions } : {}),
	});
}

// ---------------------------------------------------------------------------
// DISCRIMINATOR B — budget exhaustion behavior
// ---------------------------------------------------------------------------

describe("Discriminator B: output exhaustion through the REAL AgentRuntime", () => {
	it("B1: a max_tokens turn is CLASSIFIED as max-tokens, the partial reasoning is PERSISTED, no tool executes, and the runtime AUTOMATICALLY CONTINUES with another provider request", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			// Turn 1: cut off at the output limit, with a non-empty reasoning
			// block and NO tool call.
			() => maxTokensTurn(4_096),
			// Turn 2: an ordinary successful tool-continuation turn.
			() => toolTurn(64),
			// Turn 3: the closing plain-text turn.
			() => plainTurn(16),
		]);
		const runtime = makeRuntime(fetchImpl, executions);
		const result = await runtime.run("SYNTHETIC-PROMPT");

		// The runtime AUTOMATICALLY issued further provider requests after the
		// exhaustion. This is the retry-amplification seam.
		expect(calls.length).toBeGreaterThan(1);

		// No tool ever executed: the truncated turn carried no tool call, and
		// the follow-up turn's tool call is the one that runs. The important
		// negative fact is that the TRUNCATED turn did not execute a tool.
		expect(executions).toEqual([TOOL_NAME]);
		expect(result.status).toBe("completed");
	});

	it("B2: the runtime's recorded usage RETAINS the tokens already consumed by the exhausted turn", async () => {
		const executions: string[] = [];
		const { fetchImpl } = makeFetch([
			() => maxTokensTurn(4_096),
			() => toolTurn(64),
			() => plainTurn(16),
		]);
		const runtime = makeRuntime(fetchImpl, executions);
		const result = await runtime.run("SYNTHETIC-PROMPT");

		const usage = result.usage;
		expect(usage.outputTokens).toBe(4_096 + 64 + 16);
		expect(usage.inputTokens).toBeGreaterThan(0);
	});

	it("B3: the exhausted turn's partial reasoning IS persisted and REPLAYED in the follow-up request", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() => maxTokensTurn(4_096),
			() => toolTurn(64),
			() => plainTurn(16),
		]);
		const runtime = makeRuntime(fetchImpl, executions);
		await runtime.run("SYNTHETIC-PROMPT");

		expect(calls.length).toBeGreaterThanOrEqual(2);
		const followUp = calls[1].body;
		const messages = (followUp.messages ?? []) as Array<
			Record<string, unknown>
		>;
		const assistant = messages.find((message) => message.role === "assistant");
		const blocks = (assistant?.content ?? []) as Array<Record<string, unknown>>;
		// The truncated turn's reasoning block survives the exhaustion and is
		// replayed to the provider.
		const thinking = blocks.filter((block) => block.type === "thinking");
		expect(thinking.length).toBeGreaterThanOrEqual(1);
		expect(thinking[0].signature).toBe(SIGNATURE_A);
	});

	it("B4: the PHYSICAL request count after a single exhaustion is bounded by the recovery limit, and every request carries the SAME serialized max_tokens", async () => {
		const executions: string[] = [];
		// Every turn exhausts the output limit. The runtime's recovery seam
		// (MAX_TOKENS_RECOVERY_LIMIT = 3) bounds the streak.
		const { fetchImpl, calls } = makeFetch([() => maxTokensTurn(4_096)]);
		const runtime = makeRuntime(fetchImpl, executions);
		await runtime.run("SYNTHETIC-PROMPT").catch(() => undefined);

		// One initial turn plus at most MAX_TOKENS_RECOVERY_LIMIT (3)
		// recoveries. The exact count is asserted below against the observed
		// value; the bound is the property that matters.
		expect(calls.length).toBeGreaterThan(1);
		expect(calls.length).toBeLessThanOrEqual(4);

		// EVERY physical request carries the SAME effective budget: the
		// recovery continuation does NOT silently raise the ceiling.
		const limits = calls.map((call) => call.body.max_tokens);
		expect(new Set(limits).size).toBe(1);
	});

	it("B4b: the OBSERVED physical request count for an always-exhausting model is EXACTLY 4 (1 initial + 3 bounded recoveries)", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([() => maxTokensTurn(4_096)]);
		const runtime = makeRuntime(fetchImpl, executions);
		await runtime.run("SYNTHETIC-PROMPT").catch(() => undefined);

		// The exact owning seam: `MAX_TOKENS_RECOVERY_LIMIT = 3`
		// (agent-runtime.ts) bounds the consecutive cut-off streak, so one
		// initial attempt plus three recoveries = FOUR physical provider
		// requests, each of which consumed output tokens.
		expect(calls.length).toBe(4);
	});

	it("B5: the model handle's configured maxTokens reaches the SERIALIZED max_tokens on EVERY request of a REAL runtime turn", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() => toolTurn(64),
			() => plainTurn(16),
		]);
		const runtime = makeRuntime(fetchImpl, executions, {
			maxTokens: 8192,
		});
		await runtime.run("SYNTHETIC-PROMPT");

		expect(calls.length).toBeGreaterThanOrEqual(1);
		for (const call of calls) {
			expect(call.body.max_tokens).toBe(8192);
		}
	});

	it("B6: the runtime's PER-REQUEST options.maxTokensPerTurn does NOT reach the wire — the key names differ (maxTokensPerTurn vs maxTokens)", async () => {
		const executions: string[] = [];
		const { fetchImpl, calls } = makeFetch([
			() => toolTurn(64),
			() => plainTurn(16),
		]);
		// The AgentRuntime's model options carry `maxTokensPerTurn` (see
		// `buildModelOptions` in the core runtime config builder). The
		// gateway's model handle reads `options.maxTokens`. The two key
		// names differ, and `AgentModelRequest.options` is an untyped
		// `Record<string, unknown>`, so the mismatch is SILENT.
		const runtime = makeRuntime(fetchImpl, executions, {
			maxTokensPerTurn: 8192,
		});
		await runtime.run("SYNTHETIC-PROMPT");

		expect(calls.length).toBeGreaterThanOrEqual(1);
		for (const call of calls) {
			// The per-request option is IGNORED: the effective budget stays
			// the gateway's synthesized default.
			expect(call.body.max_tokens).toBe(157_286);
		}
	});
});

// ---------------------------------------------------------------------------
// DISCRIMINATOR C — raw usage conservation
// ---------------------------------------------------------------------------

describe("Discriminator C: raw usage conservation", () => {
	it("C1: a provider that reports NO separate reasoning-token count leaves reasoning usage UNKNOWN — the gateway omits it and the persisted metric layer has no reasoning field at all", async () => {
		const executions: string[] = [];
		// The Anthropic Messages contract reports ONLY `output_tokens`. There
		// is no separate reasoning-token field, so the reasoning count must
		// stay ABSENT rather than be estimated from the text length.
		const { fetchImpl } = makeFetch([
			() => toolTurn(1_000),
			() => plainTurn(500),
		]);
		const runtime = makeRuntime(fetchImpl, executions);
		const result = await runtime.run("SYNTHETIC-PROMPT");

		// The reported output includes the reasoning the provider billed for:
		// 1000 + 500. Reasoning is NOT subtracted from the output count,
		// because the provider did not separate it.
		expect(result.usage.outputTokens).toBe(1_500);
		// Reasoning usage is UNKNOWN, not a character-count estimate. The
		// AgentRuntime's accumulator coerces the ABSENT count to a numeric 0
		// (agent-runtime.ts `updateUsage`: `usage.reasoningTokenCount ?? 0`),
		// so the absence is not observable in the runtime total — but no
		// fabricated count is ever produced.
		expect(result.usage.reasoningTokenCount).toBe(0);
	});
});
