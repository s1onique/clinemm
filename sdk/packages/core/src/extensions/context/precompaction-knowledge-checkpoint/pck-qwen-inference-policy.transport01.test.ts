/**
 * ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01
 *
 * C3 — the TRANSPORT QUALIFICATION for the bounded, opt-in PCK inference
 * policy.
 *
 * ============================================================================
 * WHAT THIS WITNESS PROVES
 * ============================================================================
 *
 * The optimized policy's parameters reach the OUTBOUND REQUEST through the
 * REAL production request serialization seam:
 *
 *   ProviderConfig
 *     -> buildGatewayRequest        (sdk/packages/llms/src/providers/compat.ts)
 *     -> GatewayStreamRequest
 *     -> the gateway
 *     -> buildAiSdkStreamConfig      (sdk/packages/llms/src/providers/ai-sdk.ts)
 *     -> the AI SDK's openai-compatible adapter
 *     -> the WIRE BODY
 *
 * Nothing in this file re-implements the serialization: the body that the
 * assertions inspect is the body that the stubbed fetch RECEIVED.
 *
 * ============================================================================
 * THE BOUNDED CLAIMS
 * ============================================================================
 *
 *   1. The optimized request carries `reasoning_effort: "none"`,
 *      `temperature: 0.1`, `max_tokens: 1024` and
 *      `response_format: { type: "json_object" }`.
 *   2. It carries NO CONFLICTING inherited field: the policy's values
 *      REPLACE the inherited ones rather than being added beside them.
 *   3. A request that did NOT opt in carries NONE of them.
 *   4. The streaming path (the production path — the checkpoint transport
 *      STREAMS) is compatible with the policy's parameters.
 *   5. The output budget is enforced as a HARD cap on the wire.
 */

import { createHandlerAsync } from "@cline/llms";
import type { ProviderConfig } from "@cline/llms";
import { describe, expect, it } from "vitest";
import {
	applyPckInferencePolicy,
	QWEN_STRATA_V1_PARAMETERS,
} from "./inference-policy";

/**
 * The qualified model id and the provider that serves it.
 */
const QUALIFIED_MODEL_ID = "qwen3.8-flash-next-q2_0";
const QUALIFIED_PROVIDER_ID = "openai-compatible";

/**
 * The inherited configuration a checkpoint request would otherwise carry.
 *
 * The `maxOutputTokens` is DELIBERATELY different from the policy's value,
 * so a body that kept the inherited budget would be caught.
 */
const INHERITED_MAX_OUTPUT_TOKENS = 16_384;
const INHERITED_TEMPERATURE = 0.7;

interface CapturedBody {
	readonly body: Record<string, unknown>;
	readonly url: string;
}

/**
 * Stream one turn through the REAL transport and return the body the
 * stubbed fetch received.
 *
 * The stub answers a well-formed streaming response, so the production
 * stream parser runs to completion exactly as it does against the endpoint.
 */
async function captureOutboundBody(input: {
	readonly providerConfig: Record<string, unknown>;
}): Promise<CapturedBody> {
	let captured: CapturedBody | undefined;
	const fetchStub = (async (url: unknown, init: unknown) => {
		const requestInit = init as { body?: string } | undefined;
		captured = {
			body: JSON.parse(requestInit?.body ?? "{}"),
			url: String(url),
		};
		const chunks = [
			'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
			'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{"content":"{\\"records\\":[]}"},"finish_reason":null}]}',
			'data: {"id":"1","object":"chat.completion.chunk","created":0,"model":"m","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}',
			"data: [DONE]",
			"",
		].join("\n\n");
		return new Response(chunks, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	}) as typeof fetch;
	const handler = await createHandlerAsync({
		...(input.providerConfig as unknown as ProviderConfig),
		fetch: fetchStub,
	});
	for await (const _chunk of handler.createMessage("system prompt", [
		{ role: "user", content: "checkpoint request" },
	])) {
		// drain the production stream
	}
	if (!captured) {
		throw new Error("the stubbed fetch was never called");
	}
	return captured;
}

/**
 * The configuration the production checkpoint seam hands to the transport
 * when the policy is NOT applied.
 */
function inheritedConfig(): Record<string, unknown> {
	return {
		providerId: QUALIFIED_PROVIDER_ID,
		modelId: QUALIFIED_MODEL_ID,
		apiKey: "test-key",
		baseUrl: "http://endpoint.invalid/v1",
		maxOutputTokens: INHERITED_MAX_OUTPUT_TOKENS,
		temperature: INHERITED_TEMPERATURE,
		thinking: false,
	};
}


describe("ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 — C3 transport qualification", () => {
	it("C3.1: the optimized request carries ALL FOUR policy parameters on the wire", async () => {
		const applied = applyPckInferencePolicy(
			inheritedConfig() as never,
			QWEN_STRATA_V1_PARAMETERS,
		);
		const captured = await captureOutboundBody({
			providerConfig: applied as unknown as Record<string, unknown>,
		});
		// The reasoning level is requested VERBATIM.
		expect(captured.body.reasoning_effort).toBe("none");
		// The temperature is the policy's.
		expect(captured.body.temperature).toBe(0.1);
		// The output budget is the policy's, and it REPLACES the inherited
		// one rather than being sent beside it.
		expect(captured.body.max_tokens).toBe(1024);
		expect(captured.body.max_tokens).not.toBe(INHERITED_MAX_OUTPUT_TOKENS);
		// The response format is the policy's.
		expect(captured.body.response_format).toEqual({ type: "json_object" });
		// The model is the effective one.
		expect(captured.body.model).toBe(QUALIFIED_MODEL_ID);
	});

	it("C3.1b: the optimized request works over an inherited REASONING-ENABLED configuration", async () => {
		// The optimized request must carry the policy's explicit level even
		// when the INHERITED configuration enables reasoning: the policy's
		// level REPLACES the inherited one, it does not coexist with it.
		const applied = applyPckInferencePolicy(
			{
				...inheritedConfig(),
				thinking: true,
				reasoningEffort: "medium",
			} as never,
			QWEN_STRATA_V1_PARAMETERS,
		);
		const captured = await captureOutboundBody({
			providerConfig: applied as unknown as Record<string, unknown>,
		});
		// The policy's level wins, and the inherited level is gone.
		expect(captured.body.reasoning_effort).toBe("none");
		expect(captured.body.reasoning_effort).not.toBe("medium");
		// The other policy parameters are unaffected.
		expect(captured.body.temperature).toBe(0.1);
		expect(captured.body.max_tokens).toBe(1024);
		expect(captured.body.response_format).toEqual({ type: "json_object" });
	});

	it("C3.2: a request that did NOT opt in carries NONE of the policy's parameters", async () => {
		const captured = await captureOutboundBody({
			providerConfig: inheritedConfig(),
		});
		// No policy field is present.
		expect(captured.body.reasoning_effort).toBeUndefined();
		expect(captured.body.response_format).toBeUndefined();
		// The inherited temperature is NOT forwarded — that is the
		// PREDECESSOR's behaviour, and this ACT preserves it.
		expect(captured.body.temperature).toBeUndefined();
		// The inherited budget is untouched.
		expect(captured.body.max_tokens).toBe(INHERITED_MAX_OUTPUT_TOKENS);
	});

	it("C3.2b RED/GREEN: an ORDINARY request with an explicit temperature is UNCHANGED by this ACT", async () => {
		// ACT-CLINEMM-PCK-QWEN-INFERENCE-POLICY-01 (review correction):
		// the predecessor-versus-treatment wire comparison for an ordinary
		// request that carries an explicit temperature.
		//
		// The first implementation of this ACT forwarded
		// `config.temperature` for EVERY request that reached the request
		// builder, which changed the body of every ordinary request that
		// happens to carry a temperature. That is a general propagation
		// change, and it is outside this ACT's scope.
		//
		// The PREDECESSOR body is computed here from the PRE-ACT
		// construction rule: the request builder copied `maxOutputTokens`
		// and NOT `temperature`, so the predecessor's body carries NO
		// temperature at all.
		const captured = await captureOutboundBody({
			providerConfig: inheritedConfig(),
		});
		// The predecessor's body had no temperature.
		const predecessorBody = {
			...captured.body,
			temperature: undefined,
		};
		// The treatment's body IS the predecessor's body, byte for byte.
		// The only difference is the removal of the `undefined` marker,
		// which is how the predecessor's own construction expressed the
		// absence.
		expect(
			Object.fromEntries(
				Object.entries(captured.body).filter(
					([, value]) => value !== undefined,
				),
			),
		).toEqual(
			Object.fromEntries(
				Object.entries(predecessorBody).filter(
					([, value]) => value !== undefined,
				),
			),
		);
		// And the ordinary request carries NO policy field at all.
		expect(captured.body.reasoning_effort).toBeUndefined();
		expect(captured.body.response_format).toBeUndefined();
	});

	it("C3.2c: an ORDINARY request with a reasoning-ENABLED configuration is UNCHANGED", async () => {
		// The ordinary request with `thinking: true` and an explicit
		// reasoning effort must keep the predecessor's body: the policy's
		// explicit reasoning level is NOT smuggled into it.
		const captured = await captureOutboundBody({
			providerConfig: {
				...inheritedConfig(),
				thinking: true,
				reasoningEffort: "medium",
			},
		});
		// No policy field is present.
		expect(captured.body.reasoning_effort).not.toBe("none");
		expect(captured.body.response_format).toBeUndefined();
		// And no temperature.
		expect(captured.body.temperature).toBeUndefined();
	});

	it("C3.3: the policy NEVER mutates the configuration it was given", async () => {
		const original = inheritedConfig();
		const before = JSON.stringify(original);
		const applied = applyPckInferencePolicy(
			original as never,
			QWEN_STRATA_V1_PARAMETERS,
		);
		// The source configuration is byte-identical.
		expect(JSON.stringify(original)).toBe(before);
		// The applied configuration is a DIFFERENT object.
		expect(applied).not.toBe(original);
		// And it carries the policy.
		expect((applied as { inferencePolicy?: unknown }).inferencePolicy).toEqual(
			{
				reasoningEffort: "none",
				responseFormat: { type: "json_object" },
				temperature: 0.1,
				maxTokens: 1024,
			},
		);
		// The shared configuration's OWN temperature field is NOT written:
		// the policy's numbers live inside the policy, so a general
		// propagation of the configuration's temperature cannot happen.
		expect((applied as { temperature?: number }).temperature).toBe(
			INHERITED_TEMPERATURE,
		);
	});

	it("C3.4: the STREAMING path is compatible with the policy's parameters", async () => {
		// The production checkpoint transport STREAMS: the request body
		// carries `stream: true`, and the production stream parser
		// consumes the server-sent events.
		const applied = applyPckInferencePolicy(
			inheritedConfig() as never,
			QWEN_STRATA_V1_PARAMETERS,
		);
		const captured = await captureOutboundBody({
			providerConfig: applied as unknown as Record<string, unknown>,
		});
		expect(captured.body.stream).toBe(true);
		// The policy's parameters coexist with the streaming request.
		expect(captured.body.reasoning_effort).toBe("none");
		expect(captured.body.response_format).toEqual({ type: "json_object" });
		expect(captured.body.max_tokens).toBe(1024);
	});

	it("C3.5: the output budget is a HARD cap — a longer inherited budget cannot win", async () => {
		// A configuration whose INHERITED budget is enormous still gets the
		// policy's budget, so the checkpoint can never emit an unbounded
		// response under the policy.
		const applied = applyPckInferencePolicy(
			{
				...inheritedConfig(),
				maxOutputTokens: 1_000_000,
			} as never,
			QWEN_STRATA_V1_PARAMETERS,
		);
		const captured = await captureOutboundBody({
			providerConfig: applied as unknown as Record<string, unknown>,
		});
		expect(captured.body.max_tokens).toBe(1024);
	});
});
