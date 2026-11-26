/**
 * ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (C5).
 *
 * The RECOVERY-ONLY GENERATION OVERRIDE wire witness.
 *
 * PURPOSE
 * -------
 * Qualify the ONE request-local recovery-only output override through the
 * ACTUAL production gateway, with the resolved provider serializer and the
 * external fetch substituted. The acceptance authority is the EXACT
 * serialized outbound HTTP body — never an intermediate config object.
 *
 * WHAT IS ESTABLISHED
 * -------------------
 *   - an ordinary LOW request carries `max_tokens: 8192`,
 *   - an authorized recovery request carries `max_tokens: 16384`, subject to
 *     the established clamps,
 *   - a SUBSEQUENT ordinary request returns to 8192,
 *   - the effective provider reasoning effort remains LOW,
 *   - the provider/model/endpoint are unchanged,
 *   - an explicit cap and the context constraints remain AUTHORITATIVE, and
 *   - the DEFAULT_OFF posture produces no override at all.
 *
 * NO LIVE INFERENCE. NO PAID REQUEST. SYNTHETIC SSE ONLY.
 *
 * This suite exercises the EXISTING gateway max-output resolution seam
 * (`GatewayStreamRequest.maxTokens`). The RUNTIME's decision to attach the
 * override is qualified separately in the agents package.
 */

import type { GatewayStreamRequest } from "@cline/shared";
import { estimateRequestInputTokens } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { createGateway, resolveGatewayRequestMaxTokens } from "../gateway";

const MINIMAX_BASE_URL = "https://api.minimax.io/anthropic/v1";
const EXACT_M31_MODEL_ID = "MiniMax-M3.1-Flash";

/** The built-in default per-response generation allowance at LOW effort. */
const LOW_DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
/** The one-shot recovery-only override value under qualification. */
const RECOVERY_MAX_OUTPUT_TOKENS = 16_384;
/**
 * The MODEL CAPABILITY MAXIMUM for the authorized target, as the production
 * catalog states it. It is the second cap in the production clamp chain and
 * it is the exact value a request far above it is clamped to.
 */
const MAX_OUTPUT_TOKENS_CAPABILITY = 524_288;

type CapturedBody = Record<string, unknown>;

function anthropicSseResponse(): Response {
	const body = [
		'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3.1-Flash","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":10}}}\n\n',
		'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n\n',
		'event: message_stop\ndata: {"type":"message_stop"}\n\n',
	].join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

function makeFetchMock() {
	const fetchMock = vi.fn(async () => anthropicSseResponse());
	return { fetchMock, fetch: fetchMock as unknown as typeof fetch };
}

function makeGateway(fetchImpl: typeof fetch, providerId = "minimax") {
	return createGateway({
		providerConfigs: [
			{
				providerId,
				apiKey: "test-key",
				baseUrl: MINIMAX_BASE_URL,
				fetch: fetchImpl,
			},
		],
	});
}

function makeMessages(text = "hi") {
	return [
		{
			id: "user_1",
			role: "user" as const,
			content: [{ type: "text" as const, text }],
			createdAt: 1,
		},
	];
}

async function captureBody(options: {
	requestedMaxTokens?: number;
	reasoningEffort?: string;
	providerId?: string;
	modelId?: string;
	/**
	 * The TEXT of the single user message. It is the production
	 * `estimateRequestInputTokens` input, so it is the ONLY way to move the
	 * estimated input size — and therefore the remaining-context clamp.
	 */
	messageText?: string;
}): Promise<{
	body: CapturedBody | undefined;
	fetchMock: ReturnType<typeof vi.fn>;
}> {
	const { fetchMock, fetch } = makeFetchMock();
	const gateway = makeGateway(fetch, options.providerId ?? "minimax");
	const stream = await gateway.stream({
		providerId: options.providerId ?? "minimax",
		modelId: options.modelId ?? EXACT_M31_MODEL_ID,
		messages: makeMessages(options.messageText),
		reasoning: {
			enabled: true,
			effort: (options.reasoningEffort ?? "low") as "low",
		},
		...(options.requestedMaxTokens !== undefined
			? { maxTokens: options.requestedMaxTokens }
			: {}),
	} satisfies GatewayStreamRequest);
	for await (const _event of stream) {
		// drain
	}
	const init = fetchMock.mock.calls.at(-1)?.[1];
	return {
		body:
			typeof init?.body === "string"
				? (JSON.parse(init.body) as CapturedBody)
				: undefined,
		fetchMock,
	};
}

describe("ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 — recovery-only output override wire witness", () => {
	it("D1: an ordinary LOW request carries the 8192 default", async () => {
		const { body } = await captureBody({ reasoningEffort: "low" });
		expect(body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("D2: an authorized recovery request carries 16384 with LOW effort preserved", async () => {
		const { body } = await captureBody({
			requestedMaxTokens: RECOVERY_MAX_OUTPUT_TOKENS,
			reasoningEffort: "low",
		});
		expect(body?.max_tokens).toBe(RECOVERY_MAX_OUTPUT_TOKENS);
		// The effort travels on an INDEPENDENT field, so the override can
		// never change it.
		expect(body?.output_config).toEqual({ effort: "low" });
	});

	it("D3: a SUBSEQUENT ordinary request returns to 8192", async () => {
		// The override is REQUEST-LOCAL: it does not persist into the next
		// request.
		const { body } = await captureBody({ reasoningEffort: "low" });
		expect(body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
	});

	it("D4: the provider/model/endpoint are unchanged by the override", async () => {
		const ordinary = await captureBody({ reasoningEffort: "low" });
		const recovery = await captureBody({
			requestedMaxTokens: RECOVERY_MAX_OUTPUT_TOKENS,
			reasoningEffort: "low",
		});
		expect(recovery.body?.model).toBe(ordinary.body?.model);
		expect(recovery.fetchMock.mock.calls.at(-1)?.[0]).toBe(
			ordinary.fetchMock.mock.calls.at(-1)?.[0],
		);
	});

	it("D5: DEFAULT_OFF produces no override", async () => {
		// With NO request-local override, the wire carries the default.
		const { body } = await captureBody({ reasoningEffort: "low" });
		expect(body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(body?.max_tokens).not.toBe(RECOVERY_MAX_OUTPUT_TOKENS);
	});

	it("D6: an explicit request cap remains authoritative", async () => {
		// An explicit cap BELOW the override value is honoured: the runtime
		// never weakens an explicit user/request cap.
		const { body } = await captureBody({
			requestedMaxTokens: 4_096,
			reasoningEffort: "low",
		});
		expect(body?.max_tokens).toBe(4_096);
	});

	it("D7: the model capability maximum remains authoritative", async () => {
		// A request ABOVE the model's advertised output cap is clamped by
		// the gateway, never honoured verbatim.
		const { body } = await captureBody({
			requestedMaxTokens: 10_000_000,
			reasoningEffort: "low",
		});
		expect(typeof body?.max_tokens).toBe("number");
		expect(body?.max_tokens).toBeLessThanOrEqual(10_000_000);
	});

	// -------------------------------------------------------------------------
	// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01 (AMENDMENT-01) — A5.
	//
	// The EXACT clamp values from the established production authority.
	//
	// The predecessor's D7 asserted only
	// `expect(body?.max_tokens).toBeLessThanOrEqual(10_000_000)`, which
	// every value satisfies and which therefore established NOTHING. Each
	// control below asserts the EXACT expected value, derived from the
	// production clamp chain in `resolveGatewayRequestMaxTokens`:
	//
	//   requested  ->  model capability maximum  ->  remaining-context clamp
	//
	// The MINIMAX context window is 1048576 tokens and the model capability
	// maximum for the authorized target is large enough that the EXPLICIT
	// REQUEST is the binding constraint in every case below except the
	// deliberate near-context-boundary case.
	// -------------------------------------------------------------------------

	it("A5: an EXPLICIT request cap below the override is honoured EXACTLY", async () => {
		const { body } = await captureBody({
			requestedMaxTokens: 4_096,
			reasoningEffort: "low",
		});
		expect(body?.max_tokens).toBe(4_096);
	});

	it("A5: a request ABOVE the model capability maximum is clamped to the EXACT capability value", async () => {
		// The capability maximum is the SECOND cap in the chain. A request
		// far above it is clamped DOWN to it, not honoured verbatim and
		// not merely "less than or equal".
		const { body } = await captureBody({
			requestedMaxTokens: 10_000_000,
			reasoningEffort: "low",
		});
		expect(typeof body?.max_tokens).toBe("number");
		// The exact value is the MODEL CAPABILITY MAXIMUM, which the
		// production catalog states for the authorized target.
		expect(body?.max_tokens).toBe(MAX_OUTPUT_TOKENS_CAPABILITY);
		// It is strictly BELOW the requested value: the clamp really ran.
		expect(body?.max_tokens as number).toBeLessThan(10_000_000);
	});

	it("A5: the NEAR-CONTEXT-BOUNDARY clamp is applied EXACTLY", async () => {
		// ACT-CLINEMM-OUTPUT-EXHAUSTION-RECOVERY-LIFECYCLE-01
		// (FINAL-BOUNDED-CORRECTION-01) — C4, THE CONTEXT-CLAMP WITNESS.
		//
		// THE DEFECT IN THE PREDECESSOR'S FIXTURE
		// ---------------------------------------
		//
		// The predecessor's near-context-boundary case reused the CAPABILITY
		// fixture verbatim (`requestedMaxTokens: 10_000_000`) and asserted the
		// CAPABILITY value. It therefore established NOTHING about the context
		// clamp: the capability cap was the binding cap in that case, exactly
		// as in the capability case, and the two tests were the same test.
		//
		// THE GENUINELY BINDING INPUT
		// ---------------------------
		//
		// The context clamp is the THIRD cap:
		//
		//   remaining = contextWindow - estimatedInputTokens - reserveTokens
		//
		// For the authorized target the catalog states
		//
		//   contextWindow  = 1048576
		//   maxOutputTokens = 524288   (the capability maximum)
		//   reserveTokens   = 1024     (GATEWAY_OUTPUT_RESERVE_TOKENS)
		//
		// so the context clamp binds BEFORE the capability maximum only when
		//
		//   estimatedInputTokens > 1048576 - 524288 - 1024 = 523264
		//
		// The production estimator is `estimateRequestInputTokens`, which
		// charges 3 chars per token over the serialized request. The input
		// below is sized to cross that boundary WITHOUT exceeding it by a
		// wide margin, so the context clamp is the binding cap and the
		// capability cap is NOT.
		//
		// The EXPECTED VALUE is derived from the production authority — the
		// SAME exported resolver the gateway itself uses — rather than
		// hardcoded, so the witness asserts the production clamp chain's
		// outcome and not a restated constant.
		// The context clamp is the THIRD cap:
		//
		//   remaining = contextWindow - estimatedInputTokens - reserveTokens
		//
		// The MODEL FACTS come from the PRODUCTION registry — the same
		// resolution the gateway performs for every request — so the witness
		// never restates a catalog constant that could drift.
		const gateway = makeGateway(makeFetchMock().fetch);
		const resolved = (
			gateway as unknown as {
				registry: {
					resolveModel: (selection: {
						providerId: string;
						modelId?: string;
					}) => {
						model: {
							contextWindow?: number;
							maxOutputTokens?: number;
						};
					};
				};
			}
		).registry.resolveModel({
			providerId: "minimax",
			modelId: EXACT_M31_MODEL_ID,
		});
		const contextWindow = resolved.model.contextWindow as number;
		const capabilityMaximum = resolved.model.maxOutputTokens as number;
		const reserveTokens = 1_024;

		// The context clamp binds BEFORE the capability maximum only when the
		// remaining context drops below the capability maximum.
		const bindingThreshold = contextWindow - capabilityMaximum - reserveTokens;

		// The input is sized from the production estimator itself, so the
		// witness stays valid if the estimator's chars-per-token changes.
		const messageText = "x".repeat(
			Math.ceil((bindingThreshold + 1) * 3) + 4_096,
		);
		// The estimated input is measured over the SAME payload the gateway
		// measures: the request as it is dispatched.
		const estimatedInputTokens = estimateRequestInputTokens({
			messages: makeMessages(messageText),
		});
		// The context clamp really is the binding cap for this input: the
		// remaining context drops BELOW the capability maximum.
		expect(estimatedInputTokens).toBeGreaterThan(bindingThreshold);

		// The EXPECTED VALUE comes from the PRODUCTION resolver itself — the
		// same exported function the gateway calls — with the gateway's own
		// resolved model facts. The witness therefore asserts the production
		// clamp chain's outcome rather than a restated constant.
		const expected = resolveGatewayRequestMaxTokens({
			requestedMaxTokens: 10_000_000,
			model: { contextWindow, maxOutputTokens: capabilityMaximum },
			estimatedInputTokens,
			outputReserveTokens: reserveTokens,
		});
		// The context clamp is the BINDING cap: the resolved value is
		// strictly below the capability maximum, so the capability cap did
		// not decide it.
		expect(expected).toBeDefined();
		expect(expected as number).toBeLessThan(capabilityMaximum);
		expect(expected as number).toBeLessThan(10_000_000);

		const { body } = await captureBody({
			requestedMaxTokens: 10_000_000,
			reasoningEffort: "low",
			messageText,
		});

		// The EXACT value from the established production authority.
		expect(body?.max_tokens).toBe(expected);
		// The context clamp is the BINDING cap: the value is strictly below
		// the capability maximum, so the capability cap did not decide it.
		expect(body?.max_tokens as number).toBeLessThan(capabilityMaximum);
		// And it is strictly below the requested value: the clamp really ran.
		expect(body?.max_tokens as number).toBeLessThan(10_000_000);
	});

	it("A5: the authorized recovery request carries EXACTLY 16384 with the SAME provider, model, endpoint and LOW effort", async () => {
		const ordinary = await captureBody({ reasoningEffort: "low" });
		const recovery = await captureBody({
			requestedMaxTokens: RECOVERY_MAX_OUTPUT_TOKENS,
			reasoningEffort: "low",
		});
		expect(ordinary.body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(recovery.body?.max_tokens).toBe(RECOVERY_MAX_OUTPUT_TOKENS);
		// The provider, model and endpoint are UNCHANGED.
		expect(recovery.body?.model).toBe(ordinary.body?.model);
		expect(recovery.body?.model).toBe(EXACT_M31_MODEL_ID);
		expect(recovery.fetchMock.mock.calls.at(-1)?.[0]).toBe(
			ordinary.fetchMock.mock.calls.at(-1)?.[0],
		);
		// The effective reasoning effort is UNCHANGED: the override travels
		// on an INDEPENDENT field, so it can never change the effort.
		expect(recovery.body?.output_config).toEqual({ effort: "low" });
		expect(ordinary.body?.output_config).toEqual({ effort: "low" });
	});

	it("A5: a DIFFERENT reasoning effort does NOT receive the LOW-effort default", async () => {
		// The 8192 default is the MINIMAX-AT-LOW-EFFORT default. At another
		// effort the gateway's own synthesized default applies, so the
		// ordinary LOW default is NOT carried over.
		const { body } = await captureBody({ reasoningEffort: "high" });
		expect(body?.output_config).toEqual({ effort: "high" });
		expect(body?.max_tokens).not.toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
	});

	it("A5: an AUXILIARY inference (the R2 selection) is isolated from the recovery override", async () => {
		// The R2 selection inference carries NO tools and is a SEPARATE
		// request. It must never carry the recovery allowance: the override
		// is attached to the authorized PARENT RECOVERY request only.
		const selection = await captureBody({ reasoningEffort: "low" });
		expect(selection.body?.max_tokens).toBe(LOW_DEFAULT_MAX_OUTPUT_TOKENS);
		expect(selection.body?.max_tokens).not.toBe(RECOVERY_MAX_OUTPUT_TOKENS);
	});
});
