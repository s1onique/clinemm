/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01).
 *
 * RETRY EXPENDITURE versus CONTEXT OCCUPANCY (Discriminator D).
 *
 * ## THE QUESTION
 * ----------------
 * `PROVIDER-USAGE-NORMALIZATION-AUTHORITY-01` established that the AI SDK's
 * `stream.usage` is the SUM over the PHYSICAL ATTEMPTS of a turn, and that the
 * production retry middleware (`retry-empty-response.ts`) aggregates the
 * discarded attempts' usage into the emitted finish part.
 *
 * The overflow-recovery chain then consumes `usage.inputTokens` through
 * `lastRequestInputTokens` -> `previousRequestInputTokens` ->
 * `actualPreviousInputTokens` -> `underestimateFactor` -> the compaction
 * BUDGET (`maxInputTokens = rawMaxInputTokens / underestimateFactor`).
 *
 * `underestimateFactor` is a CONTEXT-OCCUPANCY calibration: it compares the
 * provider's count for the PREVIOUS request against the estimator's count for
 * the CURRENT request, to learn how badly the estimator under-counts. It is
 * only meaningful when BOTH numbers describe the SAME kind of quantity — the
 * occupancy of ONE request.
 *
 * So: is AGGREGATE EXPENDITURE (the sum over N physical attempts) being
 * mistaken for SINGLE-REQUEST CONTEXT OCCUPANCY?
 *
 * If it is, then retries ALONE — which change the provider's BILL but not the
 * provider's WINDOW occupancy — can manufacture a context-window overflow and
 * change the compaction decision.
 *
 * ## WHAT THIS WITNESS DRIVES
 * ---------------------------
 * The REAL production chain, in order, with the external network boundary
 * substituted and nothing else:
 *
 *   - the REAL gateway (`createGateway`) over the REAL `@ai-sdk/anthropic`
 *     transport, with the REAL production retry middleware
 *     (`retry-empty-response.ts`) armed through the REAL request-scoped
 *     physical-request policy (`requestPolicy.retryPolicy
 *     .emptyResponseAttempts`);
 *   - the REAL `AgentRuntime` consuming the REAL gateway's usage event and
 *     publishing it as `previousRequestInputTokens`;
 *   - the REAL production compaction seam
 *     (`createContextCompactionPrepareTurn`) consuming that value and
 *     publishing its decision through the REAL diagnostics channel.
 *
 * PAIRED TRAJECTORIES with an IDENTICAL PROMPT:
 *
 *   - SINGLE  : one physical attempt, reporting N input tokens;
 *   - MULTI   : three physical attempts, EACH reporting N input tokens.
 *
 * No provider request leaves the machine. No paid inference.
 *
 * ## THE CONTROLS
 * ---------------
 *   CMP09-RETRY-01  the aggregate session input consumption GROWS with the
 *                   physical attempt count (the expenditure is real and is
 *                   conserved);
 *   CMP09-RETRY-02  the context occupancy and the estimator calibration stay
 *                   associated with the INDIVIDUAL request: the multi-attempt
 *                   trajectory's `actualPreviousInputTokens` equals the
 *                   SINGLE attempt's, NOT the aggregate;
 *   CMP09-RETRY-03  additional retries ALONE must not manufacture a
 *                   context-window overflow: the compaction verdict of the
 *                   multi-attempt trajectory equals the single-attempt one;
 *   CMP09-RETRY-04  the RED witness: on the CURRENT production behaviour the
 *                   aggregate DOES reach the context authority and DOES
 *                   change the compaction decision.
 */

import { AgentRuntime } from "@cline/agents";
import { createGateway, readPhysicalRequestOccupancy } from "@cline/llms";
import type {
	AgentModelEvent,
	AgentModelRequest,
	GatewayStreamRequest,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextCompactionPrepareTurn } from "./compaction";

const createHandlerMock = vi.fn();

vi.mock("@cline/llms", async (importOriginal) => {
	// The REAL `@cline/llms` module is required: this witness drives the REAL
	// gateway, the REAL `@ai-sdk/anthropic` transport and the REAL production
	// retry middleware. Only the handler factory (the compaction seam's
	// summarizer transport) is replaced, because the compaction decision is
	// observed BEFORE any summarizer request is issued.
	const actual = await importOriginal<typeof import("@cline/llms")>();
	return {
		...actual,
		createHandlerAsync: (config: unknown) => createHandlerMock(config),
	};
});

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/**
 * The prompt's OWN input-token count, as the provider reports it for EVERY
 * physical attempt.
 *
 * The value is deliberately LARGER than the estimator's count for the same
 * request, so the estimator is demonstrably under-counting and the
 * `underestimateFactor` calibration engages (factor > 1). Without that, the
 * aggregate could not reach the context authority at all and the witness
 * would be vacuous.
 *
 * It is also deliberately BELOW the `MAX_INPUT_UNDERESTIMATE_FACTOR` clamp
 * when divided by the estimator's count, so the INDIVIDUAL request's factor
 * is not already saturated: the aggregate's factor then differs from it,
 * which is what makes the divergence observable at the real seam.
 */
const ATTEMPT_INPUT_TOKENS = 2_000;

const SYSTEM_PROMPT =
	"You are a deterministic retry-expenditure probe. This text exists so the production estimator has a real system prompt to measure.";

/**
 * The historical MiniMax-M3.1-Flash limits, as the CATALOG declares them.
 */
const MODEL = {
	id: EXACT_M31_MODEL_ID,
	provider: "minimax",
	info: {
		maxInputTokens: 1_048_576,
		contextWindow: 1_048_576,
		family: "anthropic",
	},
} as unknown as Parameters<
	NonNullable<ReturnType<typeof createContextCompactionPrepareTurn>>
>[0]["model"];

/**
 * A synthetic Anthropic-shaped SSE response.
 *
 * `empty` produces a turn that carries NO content at all — the shape the
 * production retry middleware exists for. The provider still reports its
 * `input_tokens`, because the provider billed the request: an empty ANSWER is
 * not an un-paid request.
 *
 * `toolCall` produces a tool-use turn, so the runtime continues to a SECOND
 * iteration — which is where the runtime publishes the PREVIOUS request's
 * provider-reported input count to the prepare-turn seam.
 */
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

/**
 * The fetch substitution at the EXTERNAL network boundary.
 *
 * It counts the PHYSICAL attempts and serves the shape the retry middleware
 * needs to re-dial.
 *
 * The served sequence depends ONLY on the attempt ordinal, so the PROMPT and
 * the per-attempt provider reporting are IDENTICAL between the
 * single-attempt and the multi-attempt trajectory. Only the middleware's
 * attempt BUDGET differs.
 *
 *   attempt 1, 2 : EMPTY  (the retry trigger; each still billed, each still
 *                           reporting its own `input_tokens`)
 *   attempt 3    : a tool-use turn (so the runtime continues to iteration 2,
 *                           which is where the previous request's count is
 *                           published to the prepare-turn seam)
 *   attempt 4, 5 : EMPTY
 *   attempt 6    : a text turn (the run completes)
 *
 * With a budget of `1` the middleware makes exactly ONE physical attempt per
 * turn, so the trajectory never re-dials; with a budget of `3` the middleware
 * re-dials twice per turn, so each turn costs three physical requests and
 * the runtime reaches iteration 2.
 */
function createCountingFetch(input: { attemptsPerRequest: number }) {
	const state = { attempts: 0 };
	const fetchImpl = (async () => {
		state.attempts += 1;
		// The ordinal WITHIN the current request, and the request's ordinal.
		const within = ((state.attempts - 1) % input.attemptsPerRequest) + 1;
		const requestOrdinal =
			Math.floor((state.attempts - 1) / input.attemptsPerRequest) + 1;
		// In the SINGLE-attempt trajectory the very first physical attempt
		// must be a NON-EMPTY turn, so the runtime's first iteration
		// completes and it reaches iteration 2 (where the previous
		// request's count is published).
		//
		// In the MULTI-attempt trajectory the leading attempts are EMPTY
		// (the retry trigger); each of them still reports its own
		// `input_tokens`, and the middleware aggregates them.
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

/**
 * The IDENTICAL prompt for both trajectories.
 */
const PROMPT_MESSAGES = [
	{
		id: "user_1",
		role: "user" as const,
		content: [{ type: "text" as const, text: "A".repeat(3_000) }],
		createdAt: 1,
	},
];

interface DecisionObservation {
	requestInputTokens?: number;
	requestTriggerTokens?: number;
	rawMaxInputTokens?: number;
	actualPreviousInputTokens?: number;
	underestimateFactor?: number;
	shouldCompact?: boolean;
	compactionInitiated?: boolean;
}

function createRecordingSink() {
	const decisions: DecisionObservation[] = [];
	const sink = {
		isTraceEnabled: () => true,
		onCompactionDiagnostics: (observation: {
			payload: Record<string, unknown>;
		}) => {
			decisions.push(observation.payload as DecisionObservation);
		},
	};
	return { sink, decisions };
}

/**
 * Drive the REAL production compaction prepare-turn seam and return the
 * decision observations the production resolver published.
 */
async function driveProductionSeam(input: {
	previousRequestInputTokens?: number;
}) {
	const recorder = createRecordingSink();
	const prepareTurn = createContextCompactionPrepareTurn({
		providerId: "minimax",
		modelId: EXACT_M31_MODEL_ID,
		providerConfig: {
			providerId: "minimax",
			modelId: EXACT_M31_MODEL_ID,
		} as never,
		compaction: {
			enabled: true,
			strategy: "basic",
			preserveRecentTokens: 1,
		},
		modelBehaviorTraceSink: recorder.sink,
	});
	await prepareTurn?.({
		agentId: "agent-cmp09-retry",
		conversationId: "conv-cmp09-retry",
		parentAgentId: null,
		iteration: 1,
		abortSignal: new AbortController().signal,
		systemPrompt: SYSTEM_PROMPT,
		tools: [],
		messages: PROMPT_MESSAGES as never,
		apiMessages: PROMPT_MESSAGES as never,
		model: MODEL,
		...(input.previousRequestInputTokens !== undefined
			? { previousRequestInputTokens: input.previousRequestInputTokens }
			: {}),
	});
	return recorder.decisions;
}

/**
 * Drive the REAL gateway + the REAL retry middleware, and observe the usage
 * the production chain publishes.
 *
 * `emptyResponseAttempts` is the REAL request-scoped physical-request policy:
 * `1` makes a single attempt, `3` allows the middleware to re-dial twice.
 */
async function driveRealGateway(input: {
	emptyResponseAttempts: number;
}): Promise<{ usages: Array<Record<string, unknown>>; attempts: number }> {
	const { fetchImpl, state } = createCountingFetch({
		attemptsPerRequest: input.emptyResponseAttempts,
	});
	const gateway = makeGateway(fetchImpl);
	const request: GatewayStreamRequest = {
		providerId: "minimax",
		modelId: EXACT_M31_MODEL_ID,
		messages: PROMPT_MESSAGES as never,
		reasoning: { enabled: false },
		requestPolicy: {
			retryPolicy: {
				maxRetries: 0,
				streamRetries: 0,
				emptyResponseAttempts: input.emptyResponseAttempts,
			},
		},
		metadata: {
			sessionId: "session-retry-1",
			runId: "run-retry-1",
			iteration: 1,
		},
	};
	const stream = await gateway.stream(request);
	const usages: Array<Record<string, unknown>> = [];
	for await (const event of stream) {
		if (event.type === "usage") {
			usages.push(
				(event as unknown as { usage: Record<string, unknown> }).usage,
			);
		}
	}
	return { usages, attempts: state.attempts };
}

/**
 * Drive the REAL `AgentRuntime` with the REAL gateway as its model, and
 * observe the `previousRequestInputTokens` the runtime publishes to the
 * prepare-turn seam.
 */
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
					sessionId: "session-retry-runtime",
					runId: "run-retry-runtime",
					iteration: 1,
				},
			});
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
			// The LAST prepare-turn is the one that observes the PREVIOUS
			// request's provider-reported count: iteration 1 runs BEFORE any
			// provider request, so it carries no previous count.
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
 * The reviewer executed the production stamping function, the reader and the
 * runtime assignment and observed:
 *
 *   aggregate=6000, served=2000 -> occupancy=2000   (correct)
 *   aggregate=4000, served=undefined -> occupancy=4000  (incorrect)
 *   aggregate=4000, served=0        -> occupancy=4000  (incorrect)
 *   aggregate=4000, served=-1       -> occupancy=4000  (incorrect)
 *
 * The runtime's `requestInputTokens ?? event.usage.inputTokens` fallback
 * reintroduces AGGREGATE EXPENDITURE as the CONTEXT OCCUPANCY whenever the
 * served attempt's measurement is unavailable.
 *
 * This helper drives the REAL `AgentRuntime` with a model that emits the
 * reviewer's exact usage shapes, and reports the occupancy the runtime
 * published to the prepare-turn seam.
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
					// The usage event describes the FIRST request. The
					// second turn is the one that observes it as the
					// PREVIOUS request's occupancy.
					yield { type: "usage", usage: input.usage } as AgentModelEvent;
					// A tool call forces the runtime to a SECOND iteration,
					// which is where the previous request's occupancy is
					// published to the prepare-turn seam.
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

describe("ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01) — retry expenditure vs context occupancy", () => {
	beforeEach(() => {
		createHandlerMock.mockReset();
	});

	it("CMP09-RETRY-01: the aggregate session input consumption GROWS with the physical attempt count", async () => {
		const single = await driveRealGateway({ emptyResponseAttempts: 1 });
		const multi = await driveRealGateway({ emptyResponseAttempts: 3 });

		// The physical attempt counts are what the objective calls the paired
		// trajectories' distinguishing variable.
		expect(single.attempts).toBe(1);
		expect(multi.attempts).toBe(3);

		// The AGGREGATE the middleware emits covers EVERY physical attempt.
		expect(single.usages).toHaveLength(1);
		expect(multi.usages).toHaveLength(1);
		const singleInput = single.usages[0]!.inputTokens as number;
		const multiInput = multi.usages[0]!.inputTokens as number;

		// CONSERVATION: the aggregate expenditure grows with the attempt
		// count. This is the billing/accounting authority and it is
		// PRESERVED — it is not the defect.
		expect(multiInput).toBeGreaterThan(singleInput);
		expect(multiInput).toBe(singleInput * multi.attempts);
	});

	it("CMP09-RETRY-02/03: the context authority must stay bound to the INDIVIDUAL request, and retries alone must not manufacture an overflow", async () => {
		// The REAL runtime publishes the value the compaction seam consumes.
		const single = await driveRealAgentRuntime({
			emptyResponseAttempts: 1,
		});
		const multi = await driveRealAgentRuntime({ emptyResponseAttempts: 3 });

		// The AGGREGATE expenditure grows with the attempt count (preserved).
		// Both trajectories make the SAME number of REQUESTS (two: the tool
		// turn and the closing text turn); only the number of PHYSICAL
		// ATTEMPTS per request differs, so the expenditure is exactly the
		// attempt-count multiple.
		expect(single.attempts).toBe(2);
		expect(multi.attempts).toBe(6);
		expect(multi.sessionInputTokens).toBeGreaterThan(single.sessionInputTokens);
		expect(multi.sessionInputTokens).toBe(
			single.sessionInputTokens * (multi.attempts / single.attempts),
		);

		// THE AUTHORITY BOUNDARY: what the runtime publishes as
		// `previousRequestInputTokens` describes the OCCUPANCY of the request
		// the provider actually served, so it must be the INDIVIDUAL
		// request's count — the SAME in both trajectories, because the
		// prompt is IDENTICAL.
		expect(single.previousRequestInputTokens).toBe(ATTEMPT_INPUT_TOKENS);
		expect(multi.previousRequestInputTokens).toBe(
			single.previousRequestInputTokens,
		);

		// THE COMPACTION DECISION: the real production seam must reach the
		// SAME verdict for both trajectories. Retries alone must not
		// manufacture a context-window overflow.
		const singleDecision = (
			await driveProductionSeam({
				previousRequestInputTokens: single.previousRequestInputTokens,
			})
		)[0]!;
		const multiDecision = (
			await driveProductionSeam({
				previousRequestInputTokens: multi.previousRequestInputTokens,
			})
		)[0]!;

		expect(multiDecision.underestimateFactor).toBe(
			singleDecision.underestimateFactor,
		);
		expect(multiDecision.requestTriggerTokens).toBe(
			singleDecision.requestTriggerTokens,
		);
		expect(multiDecision.shouldCompact).toBe(singleDecision.shouldCompact);
		expect(multiDecision.compactionInitiated).toBe(
			singleDecision.compactionInitiated,
		);
	});

	it("CMP09-RETRY-04: the aggregate expenditure is PRESERVED for billing while the context authority stays on the individual request", async () => {
		// The REPAIRED boundary: the two quantities are now DISTINCT and each
		// is bound to its own authority.
		const multi = await driveRealAgentRuntime({ emptyResponseAttempts: 3 });
		const single = await driveRealAgentRuntime({ emptyResponseAttempts: 1 });

		// Three physical attempts per request, six over the two requests.
		expect(multi.attempts).toBe(6);
		expect(single.attempts).toBe(2);

		// THE CONTEXT AUTHORITY: bound to the INDIVIDUAL request, in both
		// trajectories, because the prompt is IDENTICAL.
		expect(multi.previousRequestInputTokens).toBe(ATTEMPT_INPUT_TOKENS);
		expect(single.previousRequestInputTokens).toBe(ATTEMPT_INPUT_TOKENS);

		// THE BILLING AUTHORITY: the aggregate expenditure is PRESERVED. The
		// multi-attempt trajectory consumed three times the input of the
		// single-attempt one, because the provider billed every attempt.
		expect(multi.sessionInputTokens).toBeGreaterThan(single.sessionInputTokens);
		expect(multi.sessionInputTokens).toBe(
			single.sessionInputTokens * (multi.attempts / single.attempts),
		);

		// The two quantities are NEVER conflated: the reported aggregate is
		// NOT the occupancy the compaction budget consumes, and the
		// occupancy is NOT derived by dividing the aggregate.
		expect(multi.sessionInputTokens).not.toBe(
			multi.previousRequestInputTokens!,
		);
	});

	it("CMP09-RETRY-05: the estimator calibration is computed against the INDIVIDUAL request, so retries cannot squeeze the budget", async () => {
		// The REAL production seam, driven with the REAL runtime's published
		// occupancy for each trajectory.
		const multi = await driveRealAgentRuntime({ emptyResponseAttempts: 3 });
		const single = await driveRealAgentRuntime({ emptyResponseAttempts: 1 });

		const individual = (
			await driveProductionSeam({
				previousRequestInputTokens: ATTEMPT_INPUT_TOKENS,
			})
		)[0]!;
		const multiDecision = (
			await driveProductionSeam({
				previousRequestInputTokens: multi.previousRequestInputTokens,
			})
		)[0]!;
		const singleDecision = (
			await driveProductionSeam({
				previousRequestInputTokens: single.previousRequestInputTokens,
			})
		)[0]!;

		// The calibration is the SAME in both trajectories, because the
		// occupancy it is computed against is the SAME.
		expect(multiDecision.underestimateFactor).toBe(
			singleDecision.underestimateFactor,
		);
		expect(multiDecision.underestimateFactor).toBe(
			individual.underestimateFactor,
		);

		// ... and the threshold the trigger compares against never moved.
		expect(multiDecision.requestTriggerTokens).toBe(
			individual.requestTriggerTokens,
		);
		expect(multiDecision.rawMaxInputTokens).toBe(individual.rawMaxInputTokens);

		// THE CONSEQUENCE: the aggregate would have manufactured a budget
		// squeeze that the individual request alone does not produce. That
		// squeeze is what the repair removes.
		const aggregate = (
			await driveProductionSeam({
				previousRequestInputTokens: ATTEMPT_INPUT_TOKENS * 3,
			})
		)[0]!;
		expect(aggregate.underestimateFactor!).toBeGreaterThan(
			individual.underestimateFactor!,
		);
		expect(aggregate.requestTriggerTokens!).toBeLessThan(
			individual.requestTriggerTokens!,
		);
	});
});

/**
 * ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01).
 *
 * THE UNKNOWN-OCCUPANCY AUTHORITY (A1) and THE MEASUREMENT PROVENANCE (A2).
 */
describe("ACT-CLINEMM-CMP09-CONTEXT-BUDGET-AUTHORITY-01 (ADDENDUM-01 CORRECTION-01) — occupancy authority", () => {
	it("CMP09-RETRY-06: an ESTABLISHED occupancy is the individual request's count", async () => {
		const established = await driveRuntimeWithUsage({
			usage: {
				inputTokens: 6_000,
				requestOccupancy: { state: "known", value: 2_000, attemptCount: 3 },
			},
		});
		// The established individual count wins over the aggregate.
		expect(established.previousRequestInputTokens).toBe(2_000);
		// The aggregate is still billed.
		expect(established.sessionInputTokens).toBe(6_000);
	});

	it("CMP09-RETRY-07: an EXPLICITLY UNREPORTED occupancy grants NO occupancy authority", async () => {
		// The reviewer's three shapes. In EVERY one, the aggregate must NOT
		// become the occupancy: the aggregate is EXPENDITURE over an
		// UNKNOWN number of physical attempts, so it describes no single
		// request's context occupancy at all.
		const unreportedShapes = [
			// The occupancy is explicitly UNKNOWN (multi-attempt, no served
			// measurement established).
			{
				inputTokens: 4_000,
				requestOccupancy: { state: "unknown", attemptCount: 3 },
			},
			// The occupancy is explicitly UNKNOWN with an INVALID value.
			{
				inputTokens: 4_000,
				requestOccupancy: {
					state: "unknown",
					value: 0,
					attemptCount: 3,
				},
			},
			// The occupancy is explicitly UNKNOWN with a NEGATIVE value.
			{
				inputTokens: 4_000,
				requestOccupancy: {
					state: "unknown",
					value: -1,
					attemptCount: 3,
				},
			},
			// The authority is KNOWN but its VALUE is invalid: an invalid
			// measurement grants no occupancy authority either.
			{
				inputTokens: 4_000,
				requestOccupancy: { state: "known", value: 0, attemptCount: 3 },
			},
			{
				inputTokens: 4_000,
				requestOccupancy: {
					state: "known",
					value: -1,
					attemptCount: 3,
				},
			},
		];
		for (const usage of unreportedShapes) {
			const unknown = await driveRuntimeWithUsage({ usage });
			// NO occupancy authority: the previous request's occupancy is
			// UNKNOWN, so the runtime must publish NONE.
			expect(unknown.previousRequestInputTokens).toBeUndefined();
			// The aggregate is still billed.
			expect(unknown.sessionInputTokens).toBe(4_000);
		}
	});

	it("CMP09-RETRY-08: a LEGACY single-request usage keeps the aggregate as the occupancy", async () => {
		// A provider that reports NO occupancy authority at all is the LEGACY
		// shape: the usage describes ONE request, so its input count IS that
		// request's occupancy.
		const legacy = await driveRuntimeWithUsage({
			usage: { inputTokens: 4_000 },
		});
		expect(legacy.previousRequestInputTokens).toBe(4_000);
		expect(legacy.sessionInputTokens).toBe(4_000);

		// The LEGACY shape is ALSO the "single" state: ONE physical attempt,
		// so the aggregate IS the occupancy.
		const single = await driveRuntimeWithUsage({
			usage: {
				inputTokens: 4_000,
				requestOccupancy: { state: "single", attemptCount: 1 },
			},
		});
		expect(single.previousRequestInputTokens).toBe(4_000);
		expect(single.sessionInputTokens).toBe(4_000);
	});

	it("CMP09-RETRY-09: an UNTRUSTED raw marker cannot establish occupancy authority", async () => {
		// The reviewer's A2 shape: a provider-supplied raw marker of 1
		// alongside an aggregate of 4000. A provider-owned raw field must
		// NEVER establish the middleware-owned occupancy authority.
		const forged = await driveRuntimeWithUsage({
			usage: {
				inputTokens: 4_000,
				raw: { cline_served_attempt_input_tokens: 1 },
			},
		});
		expect(forged.previousRequestInputTokens).not.toBe(1);

		// THE PROVENANCE, asserted against the PRODUCTION reader: the
		// authority is read ONLY from the middleware-owned `cline` namespace
		// of the finish part's `providerMetadata`. A provider-supplied raw
		// payload is not an input to the reader at all.
		expect(
			readPhysicalRequestOccupancy({
				anthropic: { cline_served_attempt_input_tokens: 1 },
			}),
		).toBeUndefined();
		expect(
			readPhysicalRequestOccupancy({
				cline: {
					physicalRequestOccupancy: {
						state: "known",
						value: 2_000,
						attemptCount: 3,
					},
				},
			}),
		).toEqual({ state: "known", value: 2_000, attemptCount: 3 });

		// A provider's OWN namespace cannot establish the authority either:
		// the reader requires the `cline` namespace specifically.
		expect(
			readPhysicalRequestOccupancy({
				anthropic: {
					physicalRequestOccupancy: {
						state: "known",
						value: 2_000,
						attemptCount: 3,
					},
				},
			}),
		).toBeUndefined();
	});

	it("CMP09-RETRY-10: a SUBSEQUENT request after an unreported measurement gets NO stale occupancy", async () => {
		// The FIRST request established an occupancy (2,500); the SECOND
		// request's occupancy was EXPLICITLY UNKNOWN. The THIRD request's
		// prepare-turn observes the SECOND request's occupancy — which was
		// unknown, so it must NOT inherit the first request's 2,500.
		const observed: Array<number | undefined> = [];
		let turn = 0;
		const runtime = new AgentRuntime({
			model: {
				stream: async function* (): AsyncIterable<AgentModelEvent> {
					turn += 1;
					if (turn === 1) {
						yield {
							type: "usage",
							usage: {
								inputTokens: 5_000,
								requestOccupancy: {
									state: "known",
									value: 2_500,
									attemptCount: 2,
								},
							},
						} as AgentModelEvent;
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
					if (turn === 2) {
						// The SECOND request's occupancy is EXPLICITLY UNKNOWN.
						yield {
							type: "usage",
							usage: {
								inputTokens: 9_000,
								requestOccupancy: { state: "unknown", attemptCount: 3 },
							},
						} as AgentModelEvent;
						yield {
							type: "tool-call-delta",
							toolCallId: "call-2",
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
				observed.push(context.previousRequestInputTokens);
				return { messages: context.messages, tools: context.tools };
			},
		});
		await runtime.run("A".repeat(3_000));
		// Turn 1 prepares BEFORE any request: no previous occupancy.
		// Turn 2 observes request #1's ESTABLISHED occupancy (2,500).
		// Turn 3 observes request #2's UNKNOWN occupancy: NO stale value.
		expect(observed).toHaveLength(3);
		expect(observed[0]).toBeUndefined();
		expect(observed[1]).toBe(2_500);
		expect(observed[2]).toBeUndefined();
	});
});
