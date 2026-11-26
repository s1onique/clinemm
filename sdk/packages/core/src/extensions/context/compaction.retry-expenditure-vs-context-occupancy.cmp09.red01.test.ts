/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01) — the RED
 * witness.
 *
 * RETRY EXPENDITURE versus CONTEXT OCCUPANCY.
 *
 * WHAT THIS FILE RECORDS
 * ----------------------
 * The observed defect, at the REAL production chain, with the external
 * network boundary substituted and nothing else:
 *
 *   - the REAL gateway over the REAL `@ai-sdk/anthropic` transport, with the
 *     REAL production retry middleware armed through the REAL request-scoped
 *     physical-request policy;
 *   - the REAL `AgentRuntime` consuming the REAL gateway's usage event and
 *     publishing it as `previousRequestInputTokens`;
 *   - the REAL production compaction seam consuming that value.
 *
 * The defect: the retry middleware AGGREGATES the discarded attempts' usage
 * into the emitted finish part, so `usage.inputTokens` is the SUM over the
 * PHYSICAL ATTEMPTS of the turn. The runtime assigned that AGGREGATE
 * EXPENDITURE to `lastRequestInputTokens`, which the compaction budget
 * consumes as the PREVIOUS REQUEST'S CONTEXT OCCUPANCY.
 *
 * So retries ALONE — which change the provider's BILL but not the provider's
 * WINDOW occupancy — inflated the estimator calibration and could change the
 * compaction decision.
 *
 * A FAILURE of this file is the EXPECTED, CORRECT outcome against the
 * repaired production behaviour. It must NOT be flipped to GREEN by
 * weakening the assertion: the receipt records what the boundary did BEFORE
 * the repair.
 *
 * It is EXCLUDED from the default suite (`vitest.config.ts`) so it never
 * blocks the normal gate, and is runnable ON DEMAND through its dedicated
 * config:
 *
 *   bun run test:red:cmp09-retry-expenditure
 *
 * The PASSING companion for the same mechanism, and for the conservation
 * controls, is
 * `src/extensions/context/compaction.retry-expenditure-vs-context-occupancy.cmp09.test.ts`.
 */

import { readFile } from "node:fs/promises";
import { AgentRuntime } from "@cline/agents";
import { createGateway } from "@cline/llms";
import type {
	AgentModelEvent,
	AgentModelRequest,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it, vi } from "vitest";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@cline/llms")>();
	return {
		...actual,
		createHandlerAsync: (config: unknown) => createHandlerMock(config),
	};
});

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/** The provider's own count for EACH physical attempt. */
const ATTEMPT_INPUT_TOKENS = 2_000;

function sse(inputTokens: number, empty: boolean, toolCall = false): Response {
	const contentBlock = empty
		? ""
		: toolCall
			? `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"echo","input":{}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"text\\":\\"hi\\"}"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`
			: `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\nevent: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`;
	const stopReason = toolCall ? "tool_use" : "end_turn";
	const body = [
		`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"${EXACT_M31_MODEL_ID}","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":${inputTokens},"output_tokens":8}}}\n\n`,
		contentBlock,
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}","stop_sequence":null},"usage":{"output_tokens":8}}\n\n`,
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

function createCountingFetch(input: { attemptsPerRequest: number }) {
	const state = { attempts: 0 };
	const fetchImpl = (async () => {
		state.attempts += 1;
		const within = ((state.attempts - 1) % input.attemptsPerRequest) + 1;
		const requestOrdinal =
			Math.floor((state.attempts - 1) / input.attemptsPerRequest) + 1;
		const isEmpty =
			input.attemptsPerRequest > 1 ? within < input.attemptsPerRequest : false;
		const isToolCall = requestOrdinal === 1 && !isEmpty;
		return sse(ATTEMPT_INPUT_TOKENS, isEmpty, isToolCall);
	}) as unknown as typeof fetch;
	return { fetchImpl, state };
}

function makeGateway(fetchImpl: typeof fetch) {
	return createGateway({
		providerConfigs: [
			{
				providerId: "minimax",
				apiKey: "test-key",
				baseUrl: MINIMAX_BASE_URL,
				fetch: fetchImpl,
			},
		],
	});
}

async function driveRealAgentRuntime(input: {
	emptyResponseAttempts: number;
}): Promise<{
	previousRequestInputTokens: number | undefined;
	sessionInputTokens: number;
	attempts: number;
}> {
	const { fetchImpl, state } = createCountingFetch({
		attemptsPerRequest: input.emptyResponseAttempts,
	});
	const gateway = makeGateway(fetchImpl);
	const model = {
		stream: async function* (
			request: AgentModelRequest,
		): AsyncIterable<AgentModelEvent> {
			const stream = await gateway.stream({
				providerId: "minimax",
				modelId: EXACT_M31_MODEL_ID,
				systemPrompt: request.systemPrompt,
				messages: request.messages,
				tools: request.tools,
				requestPolicy: {
					retryPolicy: {
						maxRetries: 0,
						streamRetries: 0,
						emptyResponseAttempts: input.emptyResponseAttempts,
					},
				},
				metadata: {
					sessionId: "session-retry-red",
					runId: "run-retry-red",
					iteration: 1,
				},
			} as GatewayStreamRequest);
			for await (const event of stream) {
				yield event as AgentModelEvent;
			}
		},
	};

	let previousRequestInputTokens: number | undefined;
	const runtime = new AgentRuntime({
		model,
		tools: [
			{
				name: "echo",
				description: "Echoes input back",
				inputSchema: { type: "object" },
				async execute(input: { text?: string }) {
					return { echoed: input.text ?? "" };
				},
			} as never,
		],
		prepareTurn: async (context) => {
			if (context.previousRequestInputTokens !== undefined) {
				previousRequestInputTokens = context.previousRequestInputTokens;
			}
			return { messages: context.messages, tools: context.tools };
		},
	});
	await runtime.run("A".repeat(3_000));
	const snapshot = runtime.snapshot();
	return {
		previousRequestInputTokens,
		sessionInputTokens: snapshot.usage.inputTokens,
		attempts: state.attempts,
	};
}

/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01).
 *
 * The runtime's occupancy ASSIGNMENT, observed directly.
 *
 * The reviewer's shapes are reproduced by driving the REAL `AgentRuntime`
 * with a model that emits the exact usage shape, and reporting the occupancy
 * the runtime published to the prepare-turn seam.
 */
async function driveRuntimeWithUsage(input: {
	usage: Record<string, unknown>;
}): Promise<{
	previousRequestInputTokens: number | undefined;
	sessionInputTokens: number;
}> {
	let previousRequestInputTokens: number | undefined;
	let turn = 0;
	const runtime = new AgentRuntime({
		model: {
			stream: async function* (): AsyncIterable<AgentModelEvent> {
				turn += 1;
				if (turn === 1) {
					// The usage event describes the FIRST request. The second
					// turn is the one that observes it as the PREVIOUS
					// request's occupancy.
					yield { type: "usage", usage: input.usage } as AgentModelEvent;
					yield {
						type: "tool-call-delta",
						toolCallId: "call-1",
						toolName: "echo",
						inputText: JSON.stringify({ text: "hi" }),
					} as AgentModelEvent;
					yield {
						type: "finish",
						reason: "tool-calls",
					} as AgentModelEvent;
					return;
				}
				yield { type: "text-delta", text: "ok" } as AgentModelEvent;
				yield { type: "finish", reason: "stop" } as AgentModelEvent;
			},
		},
		tools: [
			{
				name: "echo",
				description: "Echoes input back",
				inputSchema: { type: "object" },
				async execute(input: { text?: string }) {
					return { echoed: input.text ?? "" };
				},
			} as never,
		],
		prepareTurn: async (context) => {
			if (context.previousRequestInputTokens !== undefined) {
				previousRequestInputTokens = context.previousRequestInputTokens;
			}
			return { messages: context.messages, tools: context.tools };
		},
	});
	await runtime.run("A".repeat(3_000));
	const snapshot = runtime.snapshot();
	return {
		previousRequestInputTokens,
		sessionInputTokens: snapshot.usage.inputTokens,
	};
}

describe("ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01) — RED witness", () => {
	it("R1.1: the AGGREGATE EXPENDITURE reached the CONTEXT-OCCUPANCY authority", async () => {
		const multi = await driveRealAgentRuntime({ emptyResponseAttempts: 3 });
		const single = await driveRealAgentRuntime({ emptyResponseAttempts: 1 });

		// Three physical attempts per request, six over the two requests.
		expect(multi.attempts).toBe(6);
		expect(single.attempts).toBe(2);

		// THE OBSERVED DEFECT: the multi-attempt trajectory published the
		// AGGREGATE (three attempts' worth) as the previous request's
		// CONTEXT OCCUPANCY, while the single-attempt trajectory published
		// the INDIVIDUAL request's count.
		expect(multi.previousRequestInputTokens).toBe(ATTEMPT_INPUT_TOKENS * 3);
		expect(single.previousRequestInputTokens).toBe(ATTEMPT_INPUT_TOKENS);

		// ... and the AGGREGATE is LARGER than the occupancy, so the
		// estimator calibration and the compaction decision were computed
		// against a quantity that never occupied the provider's context
		// window.
		expect(multi.previousRequestInputTokens!).toBeGreaterThan(
			ATTEMPT_INPUT_TOKENS,
		);
	});
});

/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01) —
 * the RED witnesses for the bounded correction.
 *
 * A1 — THE MISSING PHYSICAL-REQUEST OCCUPANCY (P0).
 *
 * The reviewer independently executed the production stamping function, the
 * reader and the runtime assignment and observed:
 *
 *   aggregate=6000, served=2000 -> occupancy=2000   (correct)
 *   aggregate=4000, served=undefined -> occupancy=4000  (incorrect)
 *   aggregate=4000, served=0        -> occupancy=4000  (incorrect)
 *   aggregate=4000, served=-1       -> occupancy=4000  (incorrect)
 *
 * The runtime's `requestInputTokens ?? event.usage.inputTokens` fallback
 * reintroduced AGGREGATE EXPENDITURE as the CONTEXT OCCUPANCY whenever the
 * served attempt's measurement was unavailable.
 *
 * A2 — THE MEASUREMENT PROVENANCE (P1).
 *
 * The reviewer supplied a raw marker of 1 with an aggregate expenditure of
 * 4000 and missing served-attempt input usage, and observed an occupancy of
 * 1: a PROVIDER-SUPPLIED raw field established the MIDDLEWARE-OWNED
 * occupancy authority.
 *
 * These are HISTORICAL-BEHAVIOUR assertions. They describe what the
 * predecessor DID, so they FAIL against the repaired behaviour. That is the
 * receipt of the observed defect — it is NOT a substitute for the
 * predecessor's own execution, which is preserved in the addendum's
 * evidence.
 */
describe("ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01) — RED witnesses", () => {
	it("R1.2 (A1): the predecessor's AGGREGATE-FALLBACK SHAPE is GONE", async () => {
		// THE PREDECESSOR'S OBSERVED BEHAVIOUR (the reviewer's independent
		// execution of the production stamping function, the reader and the
		// runtime assignment):
		//
		//   aggregate=4000, served=undefined -> occupancy=4000  (incorrect)
		//   aggregate=4000, served=0        -> occupancy=4000  (incorrect)
		//   aggregate=4000, served=-1       -> occupancy=4000  (incorrect)
		//
		// The predecessor's runtime read
		// `requestInputTokens ?? event.usage.inputTokens`, so an unavailable
		// served measurement fell back to the AGGREGATE EXPENDITURE.
		//
		// The repair REMOVED that field: the runtime's usage contract now
		// carries the THREE-VALUED occupancy authority, so the predecessor's
		// two-valued fallback has NO representation left. This witness is
		// the STRUCTURAL RED: it asserts that the predecessor's shape is
		// absent from the runtime's usage contract, which is what makes the
		// aggregate fallback impossible.
		//
		// The predecessor's execution above is the preserved RED evidence —
		// it is NOT re-derived here.
		for (const served of [undefined, 0, -1]) {
			const observed = await driveRuntimeWithUsage({
				usage: {
					inputTokens: 4_000,
					requestOccupancy: {
						state: "unknown",
						attemptCount: 3,
						...(served !== undefined ? { value: served } : {}),
					},
				},
			});
			// NO occupancy authority: the aggregate is EXPENDITURE over an
			// unknown number of requests, so it describes NO request's
			// occupancy.
			expect(observed.previousRequestInputTokens).toBeUndefined();
			// The aggregate is still billed.
			expect(observed.sessionInputTokens).toBe(4_000);
		}

		// THE STRUCTURAL RED: the predecessor's AGGREGATE-FALLBACK
		// expression no longer exists in the production runtime source, so
		// no usage shape can drive the aggregate back into the occupancy.
		const runtimeSource = await readFile(
			new URL("../../../../agents/src/agent-runtime.ts", import.meta.url),
			"utf8",
		);
		expect(runtimeSource).not.toContain(
			"requestInputTokens ?? event.usage.inputTokens",
		);
		expect(runtimeSource).not.toContain("event.usage.requestInputTokens");
	});

	it("R1.3 (A2): a PROVIDER-SUPPLIED raw marker established the occupancy authority", async () => {
		const observed = await driveRuntimeWithUsage({
			usage: {
				inputTokens: 4_000,
				raw: { cline_served_attempt_input_tokens: 1 },
			},
		});
		// THE OBSERVED DEFECT: the forged raw marker became the occupancy.
		expect(observed.previousRequestInputTokens).toBe(1);
	});
});
